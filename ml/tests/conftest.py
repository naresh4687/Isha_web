from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import pytest

from app.data import Dataset

NOW = datetime(2026, 6, 1, tzinfo=timezone.utc)
CATS = {"yoga": ["mat", "block", "strap", "cushion", "bolster"], "food": ["millet", "ghee", "honey", "jaggery", "oil"], "books": ["recipes", "journal", "essays", "picture", "guide"]}


def make_products():
    rows = []
    for cat, words in CATS.items():
        for i, w in enumerate(words):
            for j in range(2):
                rows.append({
                    "product_id": f"{cat}-{w}-{j}", "title": f"{w.title()} {cat} item {j}",
                    "description": f"A {w} for {cat} lovers. Handmade {w} with natural materials.",
                    "tags": [cat, w], "category": cat, "category_name": cat.title(), "subcategory": w,
                    "attributes": {"material": "cotton" if cat != "food" else "organic"},
                    "created_at": NOW - timedelta(days=200 - 10 * i), "is_active": True, "stock": 10,
                    "price": float(200 + 100 * i + 30 * j),
                })
    return pd.DataFrame(rows)


def make_dataset(seed=0, users=150, days=120):
    rng = np.random.default_rng(seed)
    products = make_products()
    by_cat = {c: products[products["category"] == c]["product_id"].tolist() for c in CATS}
    inter, lines = [], []
    oid = 0
    for u in range(users):
        cat = list(CATS)[u % 3]
        for _ in range(rng.integers(3, 9)):
            ts = NOW - timedelta(days=float(rng.uniform(0, days)))
            pid = by_cat[cat][rng.integers(0, len(by_cat[cat]))] if rng.random() < 0.85 else products["product_id"].iloc[rng.integers(0, len(products))]
            inter.append({"user_key": f"u{u}", "product_id": pid, "kind": "product_view", "ts": ts, "rating": None})
            if rng.random() < 0.4:
                inter.append({"user_key": f"u{u}", "product_id": pid, "kind": "add_to_cart", "ts": ts + timedelta(minutes=1), "rating": None})
                if rng.random() < 0.5:
                    oid += 1
                    inter.append({"user_key": f"u{u}", "product_id": pid, "kind": "purchase", "ts": ts + timedelta(minutes=5), "rating": None})
                    lines.append({"order_id": f"o{oid}", "user_id": f"u{u}", "product_id": pid, "variant_id": f"{pid}-v", "quantity": 1,
                                  "net_paise": 50000.0, "paid_at": ts + timedelta(minutes=5), "status": "delivered", "is_demo": True})
    df = pd.DataFrame(inter)
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    return Dataset(products=products, interactions=df.sort_values("ts").reset_index(drop=True), order_lines=pd.DataFrame(lines), is_demo_share=1.0)


@pytest.fixture
def dataset():
    return make_dataset()


@pytest.fixture
def now():
    return NOW
