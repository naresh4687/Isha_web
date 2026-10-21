"""Recommendation model components.

- ContentModel: TF-IDF over product text + one-hot category/subcategory/price band, cosine similarity.
- ItemItemCF: implicit-feedback item-item cosine similarity with significance shrinkage.
- Popularity: exponentially decayed interaction strength (trending) over a recent window.
- CoPurchase: order co-occurrence with support/confidence/lift for "frequently bought together".
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

import numpy as np
import pandas as pd
from scipy import sparse
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import normalize

from .config import InteractionWeights, settings
from .data import decay, interaction_strength


@dataclass
class Catalog:
    """Index mapping between product ids and matrix rows."""

    products: pd.DataFrame
    ids: list[str] = field(init=False)
    index: dict[str, int] = field(init=False)

    def __post_init__(self):
        self.products = self.products.reset_index(drop=True)
        self.ids = self.products["product_id"].tolist()
        self.index = {pid: i for i, pid in enumerate(self.ids)}

    def __len__(self):
        return len(self.ids)

    def rows(self, ids) -> np.ndarray:
        return np.array([self.index[i] for i in ids if i in self.index], dtype=int)


# --- Content ---------------------------------------------------------------------------------


@dataclass
class ContentModel:
    """Feature weights justify their influence: text dominates; category/subcategory anchor similarity
    in the same collection; price band keeps suggestions within a comparable price range."""

    text_weight: float = 1.0
    category_weight: float = 0.6
    subcategory_weight: float = 0.4
    price_weight: float = 0.3
    price_bands: int = 5
    similarity: np.ndarray | None = None
    vectors: sparse.csr_matrix | None = None

    @staticmethod
    def product_text(row) -> str:
        attrs = row["attributes"] or {}
        tags = " ".join(row["tags"] or [])
        # Tags and title are repeated to up-weight them relative to longer descriptions.
        return " ".join(
            [row["title"], row["title"], tags, tags, row.get("subcategory") or "", row.get("category_name", row["category"]),
             row["description"], " ".join(str(v) for v in attrs.values())]
        )

    def fit(self, catalog: Catalog) -> "ContentModel":
        p = catalog.products
        tfidf = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), sublinear_tf=True, min_df=1)
        text = tfidf.fit_transform(p.apply(self.product_text, axis=1))
        cat = pd.get_dummies(p["category"]).to_numpy(dtype=float)
        sub = pd.get_dummies(p["category"] + "/" + p["subcategory"].fillna("")).to_numpy(dtype=float)
        # Log-price quantile bands; neighbouring bands share half a unit so ₹490 and ₹520 stay close.
        logp = np.log1p(p["price"].to_numpy(dtype=float))
        edges = np.quantile(logp, np.linspace(0, 1, self.price_bands + 1)[1:-1]) if len(p) > self.price_bands else []
        band = np.searchsorted(edges, logp)
        price = np.zeros((len(p), self.price_bands))
        for i, b in enumerate(band):
            price[i, b] = 1.0
            if b > 0:
                price[i, b - 1] = 0.5
            if b < self.price_bands - 1:
                price[i, b + 1] = 0.5
        blocks = [
            normalize(text) * self.text_weight,
            sparse.csr_matrix(normalize(cat) * self.category_weight),
            sparse.csr_matrix(normalize(sub) * self.subcategory_weight),
            sparse.csr_matrix(normalize(price) * self.price_weight),
        ]
        self.vectors = normalize(sparse.hstack(blocks).tocsr())
        sim = (self.vectors @ self.vectors.T).toarray()
        np.fill_diagonal(sim, 0.0)
        self.similarity = sim
        return self

    def profile_scores(self, rows: np.ndarray, weights: np.ndarray) -> np.ndarray:
        """Score all items against a weighted profile of the given item rows."""
        if len(rows) == 0 or weights.sum() <= 0:
            return np.zeros(self.similarity.shape[0])
        prof = np.asarray(self.vectors[rows].T @ weights).ravel()
        scores = np.asarray(self.vectors @ prof).ravel()
        return scores


# --- Collaborative filtering ---------------------------------------------------------------------


def user_item_matrix(interactions: pd.DataFrame, catalog: Catalog, weights: InteractionWeights):
    df = interactions[interactions["product_id"].isin(catalog.index)].copy()
    if df.empty:
        return sparse.csr_matrix((0, len(catalog))), []
    df["w"] = interaction_strength(df, weights)
    agg = df.groupby(["user_key", "product_id"], as_index=False)["w"].sum()
    agg = agg[agg["w"] > 0]
    users = sorted(agg["user_key"].unique())
    uidx = {u: i for i, u in enumerate(users)}
    # log1p dampens repeated views of the same item.
    m = sparse.csr_matrix(
        (np.log1p(agg["w"].to_numpy()), (agg["user_key"].map(uidx).to_numpy(), agg["product_id"].map(catalog.index).to_numpy())),
        shape=(len(users), len(catalog)),
    )
    return m, users


@dataclass
class ItemItemCF:
    weights: InteractionWeights = field(default_factory=InteractionWeights)
    shrinkage: float = settings.cf_shrinkage
    neighbors: int = settings.cf_neighbors
    similarity: np.ndarray | None = None
    item_users: np.ndarray | None = None

    def fit(self, interactions: pd.DataFrame, catalog: Catalog) -> "ItemItemCF":
        m, _ = user_item_matrix(interactions, catalog, self.weights)
        n = len(catalog)
        if m.shape[0] == 0:
            self.similarity = np.zeros((n, n))
            self.item_users = np.zeros(n)
            return self
        binary = (m > 0).astype(float)
        co = (binary.T @ binary).toarray()
        self.item_users = np.diag(co).copy()
        mn = normalize(m, axis=0)
        sim = (mn.T @ mn).toarray()
        sim *= co / (co + self.shrinkage)
        np.fill_diagonal(sim, 0.0)
        # Keep only the strongest neighbours per item to reduce noise.
        if self.neighbors < n - 1:
            cutoff = -np.sort(-sim, axis=1)[:, self.neighbors - 1 : self.neighbors]
            sim = np.where(sim >= cutoff, sim, 0.0)
        self.similarity = sim
        return self

    def scores(self, rows: np.ndarray, weights: np.ndarray) -> np.ndarray:
        if len(rows) == 0:
            return np.zeros(self.similarity.shape[0])
        return weights @ self.similarity[rows]


# --- Popularity ------------------------------------------------------------------------------------


@dataclass
class Popularity:
    weights: InteractionWeights = field(default_factory=InteractionWeights)
    window_days: int = settings.trending_window_days
    half_life_days: float = settings.trending_half_life_days
    trending: np.ndarray | None = None

    def fit(self, interactions: pd.DataFrame, catalog: Catalog, now: datetime) -> "Popularity":
        t = np.zeros(len(catalog))
        df = interactions[interactions["product_id"].isin(catalog.index)]
        df = df[(df["ts"] <= pd.Timestamp(now)) & (df["ts"] > pd.Timestamp(now) - pd.Timedelta(days=self.window_days))]
        if not df.empty:
            w = interaction_strength(df, self.weights).clip(lower=0).to_numpy() * decay(df["ts"], now, self.half_life_days)
            np.add.at(t, df["product_id"].map(catalog.index).to_numpy(), w)
        self.trending = t
        return self


# --- Co-purchase ------------------------------------------------------------------------------------


@dataclass
class CoPurchase:
    min_support: int = settings.fbt_min_support_orders
    pairs: pd.DataFrame | None = None  # a, b, together, conf, lift
    n_orders: int = 0

    def fit(self, order_lines: pd.DataFrame) -> "CoPurchase":
        cols = ["a", "b", "together", "support", "confidence", "lift"]
        if order_lines is None or order_lines.empty:
            self.pairs = pd.DataFrame(columns=cols)
            return self
        ol = order_lines[order_lines["status"] != "cancelled"][["order_id", "product_id"]].drop_duplicates()
        self.n_orders = ol["order_id"].nunique()
        counts = ol.groupby("product_id")["order_id"].nunique()
        multi = ol[ol.groupby("order_id")["product_id"].transform("count") > 1]
        pairs = multi.merge(multi, on="order_id")
        pairs = pairs[pairs["product_id_x"] != pairs["product_id_y"]]
        together = pairs.groupby(["product_id_x", "product_id_y"])["order_id"].nunique().reset_index(name="together")
        together = together.rename(columns={"product_id_x": "a", "product_id_y": "b"})
        together = together[together["together"] >= self.min_support]
        together["support"] = together["together"] / self.n_orders
        together["confidence"] = together["together"] / together["a"].map(counts)
        together["lift"] = together["confidence"] / (together["b"].map(counts) / self.n_orders)
        self.pairs = together[cols].sort_values(["a", "confidence"], ascending=[True, False]).reset_index(drop=True)
        return self

    def for_product(self, product_id: str) -> pd.DataFrame:
        if self.pairs is None or self.pairs.empty:
            return self.pairs if self.pairs is not None else pd.DataFrame()
        # Require lift > 1 so we do not just surface generally popular items.
        return self.pairs[(self.pairs["a"] == product_id) & (self.pairs["lift"] > 1)]
