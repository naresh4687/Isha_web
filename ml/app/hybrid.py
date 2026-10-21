"""Hybrid recommender: combines normalised component scores with configurable weights,
applies eligibility rules, handles cold start, and explains results with reason codes."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

import numpy as np
import pandas as pd

from .config import HybridWeights, InteractionWeights, settings
from .data import Dataset, decay, interaction_strength
from .models import Catalog, ContentModel, CoPurchase, ItemItemCF, Popularity

COMPONENTS = ("cf", "content", "category", "popularity", "recency")
REASONS = {
    "cf": "customers_also_engaged",
    "content": "similar_content",
    "category": "category_preference",
    "popularity": "trending",
    "recency": "new_arrival",
}


def minmax(x: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Min-max normalise over candidate items only; constant vectors become zeros (no signal)."""
    out = np.zeros_like(x, dtype=float)
    if not mask.any():
        return out
    v = x[mask]
    lo, hi = v.min(), v.max()
    if hi - lo <= 1e-12:
        return out
    out[mask] = (v - lo) / (hi - lo)
    return out


@dataclass
class Recommendation:
    product_id: str
    score: float
    reasons: list[str]


@dataclass
class HybridRecommender:
    catalog: Catalog
    content: ContentModel
    cf: ItemItemCF
    popularity: Popularity
    copurchase: CoPurchase
    trained_at: datetime
    weights: HybridWeights = field(default_factory=HybridWeights)
    interaction_weights: InteractionWeights = field(default_factory=InteractionWeights)
    history_half_life_days: float = settings.history_half_life_days
    cold_item_min_users: int = settings.cold_item_min_users
    version: str = "untrained"

    @classmethod
    def fit(cls, ds: Dataset, now: datetime, weights: HybridWeights | None = None,
            interaction_weights: InteractionWeights | None = None, version: str = "dev") -> "HybridRecommender":
        iw = interaction_weights or InteractionWeights()
        catalog = Catalog(ds.products)
        inter = ds.interactions[ds.interactions["ts"] <= pd.Timestamp(now)]
        lines = ds.order_lines
        if lines is not None and not lines.empty:
            lines = lines[pd.to_datetime(lines["paid_at"], utc=True) <= pd.Timestamp(now)]
        return cls(
            catalog=catalog,
            content=ContentModel().fit(catalog),
            cf=ItemItemCF(weights=iw).fit(inter, catalog),
            popularity=Popularity(weights=iw).fit(inter, catalog, now),
            copurchase=CoPurchase().fit(lines),
            trained_at=now,
            weights=weights or HybridWeights(),
            interaction_weights=iw,
            version=version,
        )

    # --- helpers -----------------------------------------------------------------------------

    def eligible_mask(self, eligible_ids: set[str] | None) -> np.ndarray:
        p = self.catalog.products
        mask = p["is_active"].to_numpy(dtype=bool) & (p["stock"].to_numpy() > 0)
        if eligible_ids is not None:
            mask &= p["product_id"].isin(eligible_ids).to_numpy()
        return mask

    def history_vector(self, history: pd.DataFrame, now: datetime) -> tuple[np.ndarray, np.ndarray, set[int]]:
        """Collapse a shopper's history into (rows, weights) with time decay, plus strongly-engaged rows."""
        h = history[history["product_id"].isin(self.catalog.index)]
        if h.empty:
            return np.array([], dtype=int), np.array([]), set()
        w = interaction_strength(h, self.interaction_weights).to_numpy() * decay(h["ts"], now, self.history_half_life_days)
        agg = pd.Series(w).groupby(h["product_id"].to_numpy()).sum()
        agg = agg[agg > 0]
        rows = self.catalog.rows(agg.index)
        strong = set(self.catalog.rows(h.loc[h["kind"].isin(["add_to_cart", "purchase", "add_to_wishlist"]), "product_id"].unique()))
        return rows, np.log1p(agg.to_numpy()), strong

    def category_affinity(self, rows: np.ndarray, weights: np.ndarray, prefs: list[str]) -> np.ndarray:
        cats = self.catalog.products["category"].to_numpy()
        score = np.zeros(len(self.catalog))
        if len(rows):
            share = pd.Series(weights).groupby(cats[rows]).sum()
            share = share / share.sum()
            score += pd.Series(cats).map(share).fillna(0).to_numpy()
        if prefs:
            score += np.isin(cats, prefs) * 0.5
        return score

    def recency_score(self, now: datetime) -> np.ndarray:
        created = pd.to_datetime(self.catalog.products["created_at"], utc=True)
        age = (pd.Timestamp(now) - created).dt.total_seconds().to_numpy() / 86400
        return np.exp(-np.clip(age, 0, None) / 30.0)

    def component_scores(self, history: pd.DataFrame, prefs: list[str], now: datetime):
        rows, w, strong = self.history_vector(history, now)
        comps = {
            "cf": self.cf.scores(rows, w),
            "content": self.content.profile_scores(rows, w),
            "category": self.category_affinity(rows, w, prefs),
            "popularity": self.popularity.trending,
            "recency": self.recency_score(now),
        }
        return comps, rows, strong

    def _rank(self, comps: dict, weights: dict, candidates: np.ndarray, k: int) -> list[Recommendation]:
        norm = {c: minmax(comps[c], candidates) for c in COMPONENTS}
        total = sum(weights[c] * norm[c] for c in COMPONENTS)
        total = np.where(candidates, total, -np.inf)
        order = np.argsort(-total, kind="stable")[:k]
        out = []
        for i in order:
            if not np.isfinite(total[i]):
                break
            contrib = sorted(((weights[c] * norm[c][i], c) for c in COMPONENTS), reverse=True)
            reasons = [REASONS[c] for v, c in contrib[:2] if v > 0.02]
            out.append(Recommendation(self.catalog.ids[i], float(total[i]), reasons or ["popular"]))
        return out

    # --- public API ------------------------------------------------------------------------------

    def recommend(self, history: pd.DataFrame, k: int = 10, prefs: list[str] | None = None, now: datetime | None = None,
                  eligible_ids: set[str] | None = None, exclude_interacted: bool = True,
                  weights: HybridWeights | None = None) -> tuple[list[Recommendation], str]:
        """Personalised ranking. Cold start (no usable history) falls back to popularity, new arrivals
        and any declared category preferences; current-session interactions count as history."""
        now = now or self.trained_at
        prefs = prefs or []
        comps, rows, strong = self.component_scores(history, prefs, now)
        candidates = self.eligible_mask(eligible_ids)
        if exclude_interacted and len(rows):
            candidates[list(set(rows.tolist()) | strong)] = False
        if len(rows) == 0:
            wts = {"cf": 0.0, "content": 0.0, "category": 0.3 if prefs else 0.0, "popularity": 0.55, "recency": 0.15}
            return self._rank(comps, wts, candidates, k), "cold_start"
        wts = (weights or self.weights).as_dict()
        return self._rank(comps, wts, candidates, k), "hybrid"

    def similar(self, product_id: str, k: int = 8, eligible_ids: set[str] | None = None) -> list[Recommendation]:
        """Item-to-item: content similarity blended with CF; new/cold items rely on content alone."""
        i = self.catalog.index.get(product_id)
        if i is None:
            return []
        content = self.content.similarity[i]
        cf = self.cf.similarity[i]
        warm = self.cf.item_users is not None and self.cf.item_users[i] >= self.cold_item_min_users
        candidates = self.eligible_mask(eligible_ids)
        candidates[i] = False
        c_n, f_n = minmax(content, candidates), minmax(cf, candidates)
        w_cf = 0.4 if warm else 0.0
        total = np.where(candidates, (1 - w_cf) * c_n + w_cf * f_n, -np.inf)
        order = np.argsort(-total, kind="stable")[:k]
        out = []
        for j in order:
            if not np.isfinite(total[j]) or total[j] <= 0:
                continue
            reasons = ["similar_to_this"] + (["customers_also_engaged"] if w_cf and f_n[j] > 0.3 else [])
            out.append(Recommendation(self.catalog.ids[j], float(total[j]), reasons))
        return out

    def trending(self, k: int = 8, category: str | None = None, eligible_ids: set[str] | None = None) -> list[Recommendation]:
        candidates = self.eligible_mask(eligible_ids)
        if category:
            candidates &= (self.catalog.products["category"] == category).to_numpy()
        t = self.popularity.trending
        n = minmax(t, candidates)
        total = np.where(candidates, n, -np.inf)
        order = np.argsort(-total, kind="stable")[:k]
        return [Recommendation(self.catalog.ids[j], float(total[j]), ["trending" if t[j] > 0 else "popular"]) for j in order if np.isfinite(total[j])]

    def frequently_bought_together(self, product_id: str, k: int = 3, eligible_ids: set[str] | None = None) -> list[Recommendation]:
        """Only pairs observed together in at least `min_support` orders, with lift > 1. Empty otherwise."""
        pairs = self.copurchase.for_product(product_id)
        if pairs is None or pairs.empty:
            return []
        mask = self.eligible_mask(eligible_ids)
        out = []
        for _, r in pairs.iterrows():
            j = self.catalog.index.get(r["b"])
            if j is not None and mask[j]:
                out.append(Recommendation(r["b"], float(r["confidence"]), ["bought_together"]))
            if len(out) >= k:
                break
        return out

    def continue_exploring(self, history: pd.DataFrame, k: int = 8, now: datetime | None = None,
                           eligible_ids: set[str] | None = None) -> list[Recommendation]:
        """Unseen items from the categories in the shopper's most recent activity."""
        now = now or self.trained_at
        recent = history.sort_values("ts").tail(10)
        recent = recent[recent["product_id"].isin(self.catalog.index)]
        if recent.empty:
            return []
        cats = set(self.catalog.products.iloc[self.catalog.rows(recent["product_id"])]["category"])
        comps, rows, strong = self.component_scores(recent, list(cats), now)
        candidates = self.eligible_mask(eligible_ids) & self.catalog.products["category"].isin(cats).to_numpy()
        seen = set(self.catalog.rows(history["product_id"].unique()).tolist())
        if seen:
            candidates[list(seen)] = False
        wts = {"cf": 0.35, "content": 0.35, "category": 0.0, "popularity": 0.2, "recency": 0.1}
        recs = self._rank(comps, wts, candidates, k)
        for r in recs:
            r.reasons = ["category_preference"] + [x for x in r.reasons if x != "category_preference"][:1]
        return recs
