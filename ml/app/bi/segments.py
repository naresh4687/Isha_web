"""Customer segmentation: rule-based RFM, plus k-means reported only when it validates."""
from __future__ import annotations

from datetime import datetime

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import adjusted_rand_score, silhouette_score
from sklearn.preprocessing import StandardScaler

SEGMENT_RULES = [
    ("Champions", lambda r, f: (r >= 4) & (f >= 4)),
    ("Loyal", lambda r, f: (r >= 3) & (f >= 4)),
    ("Potential loyalists", lambda r, f: (r >= 4) & (f >= 2)),
    ("New customers", lambda r, f: (r >= 4) & (f == 1)),
    ("At risk", lambda r, f: (r <= 2) & (f >= 3)),
    ("Hibernating", lambda r, f: (r <= 2) & (f <= 2)),
]


def rfm_table(order_lines: pd.DataFrame, now: datetime) -> pd.DataFrame:
    """Per-customer recency (days since last paid order), frequency (paid orders, excl. cancelled) and
    monetary value (net sales after discounts and refunds)."""
    ol = order_lines[order_lines["status"] != "cancelled"]
    if ol.empty:
        return pd.DataFrame(columns=["user_id", "recency_days", "frequency", "monetary_paise"])
    orders = ol.groupby(["order_id", "user_id"], as_index=False).agg(paid_at=("paid_at", "max"), net=("net_paise", "sum"))
    orders["paid_at"] = pd.to_datetime(orders["paid_at"], utc=True)
    t = orders.groupby("user_id").agg(last=("paid_at", "max"), frequency=("order_id", "nunique"), monetary_paise=("net", "sum")).reset_index()
    t["recency_days"] = (pd.Timestamp(now) - t["last"]).dt.total_seconds() / 86400
    return t[["user_id", "recency_days", "frequency", "monetary_paise"]]


def score_quintiles(s: pd.Series, higher_is_better: bool) -> pd.Series:
    """1–5 scores from percentile rank (rank-based so heavy ties, e.g. frequency = 1, stay stable)."""
    pct = s.rank(method="average", pct=True)
    if not higher_is_better:
        pct = 1 - pct + 1 / len(s)
    return np.ceil(pct * 5).clip(1, 5).astype(int)


def rfm_segments(order_lines: pd.DataFrame, now: datetime) -> dict:
    t = rfm_table(order_lines, now)
    if len(t) < 20:
        return {"status": "insufficient_data", "customers": int(len(t)), "message": "RFM needs at least 20 purchasing customers."}
    t["R"] = score_quintiles(t["recency_days"], higher_is_better=False)
    # Frequency is scored on absolute thresholds: quintiles are meaningless when most customers bought once.
    t["F"] = pd.cut(t["frequency"], bins=[0, 1, 2, 3, 5, np.inf], labels=[1, 2, 3, 4, 5]).astype(int)
    t["M"] = score_quintiles(t["monetary_paise"], higher_is_better=True)
    t["segment"] = "Needs attention"
    for name, rule in reversed(SEGMENT_RULES):
        t.loc[rule(t["R"], t["F"]), "segment"] = name
    seg = (
        t.groupby("segment")
        .agg(customers=("user_id", "count"), avg_recency_days=("recency_days", "mean"), avg_frequency=("frequency", "mean"),
             avg_monetary_paise=("monetary_paise", "mean"), total_monetary_paise=("monetary_paise", "sum"))
        .reset_index()
        .sort_values("total_monetary_paise", ascending=False)
    )
    seg["share_of_customers"] = seg["customers"] / len(t)
    seg["share_of_value"] = seg["total_monetary_paise"] / t["monetary_paise"].sum()
    actions = {
        "Champions": "Early access to new arrivals; ask for reviews.",
        "Loyal": "Recommend complementary categories they have not bought from.",
        "Potential loyalists": "Encourage a next purchase with replenishment reminders for consumables.",
        "New customers": "Onboarding: care guides and category introductions.",
        "At risk": "Win-back message (only to customers who opted in to marketing).",
        "Hibernating": "Low-cost reactivation; avoid deep discounts.",
        "Needs attention": "Personalised recommendations based on past categories.",
    }
    seg["suggested_action"] = seg["segment"].map(actions)
    return {
        "status": "ok",
        "as_of": pd.Timestamp(now).isoformat(),
        "customers": int(len(t)),
        "definition": "R = days since last paid order (quintile score, recent = 5); F = paid orders excluding cancellations (1, 2, 3, 4–5, 6+ → 1–5); M = net sales after discounts and refunds (quintile score).",
        "segments": seg.round(4).to_dict(orient="records"),
        "score_distribution": {k: t[k].value_counts().sort_index().to_dict() for k in ("R", "F", "M")},
    }


def kmeans_segments(order_lines: pd.DataFrame, now: datetime, k_range=range(2, 7), min_customers: int = 50,
                    min_silhouette: float = 0.25, min_stability: float = 0.8, seed: int = 0) -> dict:
    """K-means on log-transformed, standardised RFM. Reported as valid only if the best k has
    silhouette >= min_silhouette and is stable across seeds (mean ARI >= min_stability)."""
    t = rfm_table(order_lines, now)
    if len(t) < min_customers:
        return {"status": "insufficient_data", "valid": False, "customers": int(len(t)), "message": f"K-means needs at least {min_customers} customers."}
    X = StandardScaler().fit_transform(np.log1p(t[["recency_days", "frequency", "monetary_paise"]].to_numpy(dtype=float)))
    candidates = []
    for k in k_range:
        labels = KMeans(n_clusters=k, n_init=10, random_state=seed).fit_predict(X)
        candidates.append({"k": k, "silhouette": float(silhouette_score(X, labels, random_state=seed)), "labels": labels})
    best = max(candidates, key=lambda c: c["silhouette"])
    reruns = [KMeans(n_clusters=best["k"], n_init=10, random_state=seed + s).fit_predict(X) for s in range(1, 6)]
    stability = float(np.mean([adjusted_rand_score(best["labels"], r) for r in reruns]))
    valid = best["silhouette"] >= min_silhouette and stability >= min_stability
    t["cluster"] = best["labels"]
    profile = (
        t.groupby("cluster")
        .agg(customers=("user_id", "count"), median_recency_days=("recency_days", "median"), median_frequency=("frequency", "median"),
             median_monetary_paise=("monetary_paise", "median"))
        .reset_index()
        .sort_values("median_monetary_paise", ascending=False)
    )
    return {
        "status": "ok",
        "valid": bool(valid),
        "customers": int(len(t)),
        "chosen_k": int(best["k"]),
        "silhouette_by_k": {c["k"]: round(c["silhouette"], 4) for c in candidates},
        "stability_mean_ari": round(stability, 4),
        "criteria": {"min_silhouette": min_silhouette, "min_stability_ari": min_stability},
        "clusters": profile.round(2).to_dict(orient="records") if valid else [],
        "message": "Clusters validated." if valid else "Clusters did not meet the validation criteria; use the rule-based RFM segments instead.",
    }
