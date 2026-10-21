import numpy as np
import pandas as pd

from app.evaluation import evaluate, metrics, paired_bootstrap, temporal_split, split_cases
from tests.conftest import make_dataset


def test_ranking_metrics_on_hand_computed_example():
    topk = np.array([[0, 1, 2, 3], [4, 5, 6, 7]])
    truth = [{1, 9}, {4}]
    sim = np.zeros((10, 10))
    cats = np.array(["a", "a", "b", "b", "a", "b", "c", "d", "a", "a"])
    m = metrics(topk, truth, 4, sim, cats, n_candidates=10)
    assert m["precision"] == (1 / 4 + 1 / 4) / 2
    assert m["recall"] == (1 / 2 + 1) / 2
    # user 1: hit at rank 2 -> 1/log2(3); ideal for 2 relevant items: 1 + 1/log2(3)
    u1 = (1 / np.log2(3)) / (1 + 1 / np.log2(3))
    assert np.isclose(m["ndcg"], (u1 + 1.0) / 2)
    assert m["hit_rate"] == 1.0
    assert m["catalog_coverage"] == 0.8
    assert m["intra_list_diversity"] == 1.0
    assert m["category_diversity"] == (2 / 4 + 4 / 4) / 2


def test_temporal_split_has_no_leakage():
    ds = make_dataset()
    train, test, cutoff = temporal_split(ds.interactions)
    assert train["ts"].max() < cutoff <= test["ts"].min()
    warm, _ = split_cases(train, test)
    seen = train.groupby("user_key")["product_id"].agg(set)
    for user, items in warm.items():
        assert not items & seen[user]


def test_evaluation_is_reproducible_and_reports_required_fields():
    a = evaluate(make_dataset(seed=3))
    b = evaluate(make_dataset(seed=3))
    assert a == b
    assert a["status"] == "ok"
    for model in ("popularity", "content_only", "cf_only", "hybrid_default", "hybrid_tuned"):
        for k in ("@5", "@10"):
            r = a["results"][model][k]
            assert {"precision", "recall", "ndcg", "catalog_coverage", "intra_list_diversity"} <= r.keys()
            assert 0 <= r["ndcg"] <= 1
    d = a["dataset"]
    assert d["test_users"] > 0 and d["date_range"][0] < d["cutoff"] < d["date_range"][1]
    assert a["comparisons"]["hybrid_tuned"]["conclusion"] in ("better", "worse", "no significant difference")
    assert a["limitations"]


def test_hybrid_beats_popularity_when_preferences_exist():
    """On data with strong per-user category preferences, personalisation should help."""
    r = evaluate(make_dataset(seed=1, users=240))
    assert r["results"]["hybrid_default"]["@10"]["ndcg"] > r["results"]["popularity"]["@10"]["ndcg"]


def test_insufficient_data_is_reported_not_faked():
    ds = make_dataset(users=3)
    ds.interactions = ds.interactions.head(50)
    assert evaluate(ds)["status"] == "insufficient_data"


def test_paired_bootstrap_ci():
    a = np.array([0.5] * 50)
    diff, lo, hi = paired_bootstrap(a, a)
    assert diff == lo == hi == 0
    diff, lo, hi = paired_bootstrap(a + 0.1, a)
    assert np.isclose(diff, 0.1) and lo > 0
