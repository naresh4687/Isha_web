from datetime import timedelta

import numpy as np
import pandas as pd
import pytest

from app.config import HybridWeights, InteractionWeights
from app.data import interaction_strength
from app.hybrid import HybridRecommender, minmax
from app.models import Catalog, ContentModel, CoPurchase, ItemItemCF


def hist(*items, kind="product_view", ts=None):
    ts = ts or pd.Timestamp("2026-05-30", tz="UTC")
    return pd.DataFrame({"user_key": "x", "product_id": list(items), "kind": kind, "ts": [ts] * len(items), "rating": None})


@pytest.fixture
def rec(dataset, now):
    return HybridRecommender.fit(dataset, now, version="test")


def test_interaction_weights_rank_signal_strength():
    df = pd.DataFrame({"kind": ["product_view", "add_to_wishlist", "add_to_cart", "purchase", "rating", "rating", "unknown"],
                       "rating": [None, None, None, None, 5, 1, None]})
    s = interaction_strength(df, InteractionWeights()).tolist()
    assert s == [1.0, 3.0, 4.0, 8.0, 4.0, -4.0, 0.0]
    assert s[0] < s[1] < s[2] < s[3]


def test_minmax_normalises_over_candidates_only():
    x = np.array([5.0, 1.0, 3.0, 100.0])
    mask = np.array([True, True, True, False])
    assert minmax(x, mask).tolist() == [1.0, 0.0, 0.5, 0.0]
    assert minmax(np.ones(3), np.ones(3, bool)).tolist() == [0.0, 0.0, 0.0]


def test_content_similarity_prefers_same_subcategory(dataset):
    cat = Catalog(dataset.products)
    cm = ContentModel().fit(cat)
    i = cat.index["yoga-mat-0"]
    top = cat.ids[int(np.argmax(cm.similarity[i]))]
    assert top == "yoga-mat-1"
    assert cm.similarity[i, i] == 0.0
    assert np.allclose(cm.similarity, cm.similarity.T)


def test_item_item_cf_links_co_interacted_items(dataset):
    cat = Catalog(dataset.products)
    cf = ItemItemCF().fit(dataset.interactions, cat)
    i = cat.index["food-millet-0"]
    sims = cf.similarity[i]
    food = [cat.index[p] for p in cat.ids if p.startswith("food")]
    other = [cat.index[p] for p in cat.ids if not p.startswith("food")]
    assert sims[food].mean() > sims[other].mean()


def test_personalized_recommendations_follow_history_and_exclude_seen(rec):
    h = hist("books-recipes-0", "books-journal-0", "books-essays-1")
    recs, strategy = rec.recommend(h, k=5)
    assert strategy == "hybrid"
    ids = [r.product_id for r in recs]
    assert len(ids) == 5 and len(set(ids)) == 5
    assert not set(ids) & {"books-recipes-0", "books-journal-0", "books-essays-1"}
    assert sum(i.startswith("books") for i in ids) >= 3
    assert all(r.reasons for r in recs)
    assert [r.score for r in recs] == sorted([r.score for r in recs], reverse=True)


def test_ineligible_products_are_never_returned(dataset, now):
    p = dataset.products.copy()
    p.loc[p["product_id"] == "books-recipes-1", "stock"] = 0
    p.loc[p["product_id"] == "books-journal-1", "is_active"] = False
    ds = type(dataset)(products=p, interactions=dataset.interactions, order_lines=dataset.order_lines)
    r = HybridRecommender.fit(ds, now)
    banned = {"books-recipes-1", "books-journal-1", "books-picture-0"}
    eligible = set(p["product_id"]) - {"books-picture-0"}  # simulate a live eligibility list
    h = hist("books-recipes-0", "books-essays-0")
    outputs = [
        [x.product_id for x in r.recommend(h, k=30, eligible_ids=eligible)[0]],
        [x.product_id for x in r.similar("books-recipes-0", k=30, eligible_ids=eligible)],
        [x.product_id for x in r.trending(k=30, eligible_ids=eligible)],
        [x.product_id for x in r.continue_exploring(h, k=30, eligible_ids=eligible)],
        [x.product_id for x in r.frequently_bought_together("books-recipes-0", k=30, eligible_ids=eligible)],
        [x.product_id for x in r.recommend(hist(), k=30, eligible_ids=eligible)[0]],
    ]
    for out in outputs:
        assert not banned & set(out)


def test_cold_start_user_gets_popular_and_new_items_and_respects_preferences(rec):
    recs, strategy = rec.recommend(hist(), k=6)
    assert strategy == "cold_start"
    assert len(recs) == 6
    prefs, _ = rec.recommend(hist(), k=6, prefs=["books"])
    assert sum(r.product_id.startswith("books") for r in prefs) > sum(r.product_id.startswith("books") for r in recs)
    assert any("category_preference" in r.reasons for r in prefs)


def test_current_session_interactions_personalise_immediately(rec):
    """A brand-new visitor who has just viewed yoga items gets yoga-leaning results."""
    recs, strategy = rec.recommend(hist("yoga-mat-0", "yoga-block-1"), k=5)
    assert strategy == "hybrid"
    assert sum(r.product_id.startswith("yoga") for r in recs) >= 3


def test_new_product_uses_content_similarity_only(dataset, now):
    p = dataset.products.copy()
    new = p.iloc[0].copy()
    new["product_id"], new["title"], new["created_at"] = "yoga-mat-new", "Mat yoga item new", now - timedelta(days=1)
    ds = type(dataset)(products=pd.concat([p, new.to_frame().T], ignore_index=True), interactions=dataset.interactions, order_lines=dataset.order_lines)
    r = HybridRecommender.fit(ds, now)
    assert r.cf.item_users[r.catalog.index["yoga-mat-new"]] == 0
    sims = r.similar("yoga-mat-new", k=3)
    assert len(sims) == 3
    assert sims[0].product_id.startswith("yoga-mat")
    assert all(s.reasons == ["similar_to_this"] for s in sims)


def test_frequently_bought_together_requires_support():
    lines = pd.DataFrame(
        [{"order_id": f"o{i}", "product_id": p, "status": "delivered"} for i in range(4) for p in ("a", "b")]
        + [{"order_id": "o9", "product_id": p, "status": "delivered"} for p in ("a", "c")]
        + [{"order_id": f"x{i}", "product_id": "d", "status": "delivered"} for i in range(5)]
    )
    cp = CoPurchase(min_support=3).fit(lines)
    pairs = cp.for_product("a")
    assert pairs["b"].tolist() == ["b"]  # a+c appears once, below support
    assert pairs.iloc[0]["confidence"] == pytest.approx(4 / 5)
    assert CoPurchase(min_support=3).fit(pd.DataFrame(columns=["order_id", "product_id", "status"])).for_product("a").empty


def test_weights_are_configurable(rec):
    h = hist("food-ghee-0")
    pop_only, _ = rec.recommend(h, k=5, weights=HybridWeights(cf=0, content=0, category=0, popularity=1, recency=0))
    trending = [r.product_id for r in rec.trending(k=10)]
    assert [r.product_id for r in pop_only] == [t for t in trending if t != "food-ghee-0"][:5]


def test_unknown_product_returns_empty(rec):
    assert rec.similar("nope") == []
    assert rec.frequently_bought_together("nope") == []
