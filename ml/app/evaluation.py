"""Offline evaluation with a temporal split.

Protocol
  1. Sort all interactions by time; the cutoff is the 80th percentile timestamp.
     Models are fit only on interactions before the cutoff ("train").
  2. Test users = users with train history AND at least one strong-intent interaction
     (add_to_cart or purchase) after the cutoff on an item they had not interacted with in train.
     Ground truth = those items. Items the user interacted with in train are excluded from ranking.
  3. Hyper-parameters (interaction weights, hybrid weights) are chosen on a validation split
     carved from the train period (its own 80/20 temporal split), never on the test period.
  4. Baselines: popularity (trending at cutoff) and content-only. CF-only is also reported.
  5. Paired bootstrap over test users estimates a 95% CI for the NDCG@10 difference between the
     hybrid and the best baseline; an improvement is only claimed if the CI excludes zero.
Ties within single-component baselines are broken by a tiny popularity term (1e-3) so that an
all-zero score vector does not produce an arbitrary catalogue-order ranking.
"""
from __future__ import annotations

import itertools
from dataclasses import replace
from datetime import datetime

import numpy as np
import pandas as pd

from .config import HybridWeights, InteractionWeights
from .data import Dataset
from .hybrid import COMPONENTS, HybridRecommender, minmax

POSITIVE_KINDS = ("add_to_cart", "purchase")

INTERACTION_SCHEMES = {
    "uniform": InteractionWeights(1, 1, 1, 1, 0),
    "default": InteractionWeights(),
    "purchase_heavy": InteractionWeights(1, 2, 3, 15, 2),
    "intent_only": InteractionWeights(0, 3, 4, 8, 2),
}

BASELINES = {
    "popularity": {"popularity": 1.0},
    "content_only": {"content": 1.0, "popularity": 1e-3},
    "cf_only": {"cf": 1.0, "popularity": 1e-3},
}


def temporal_split(inter: pd.DataFrame, quantile: float = 0.8):
    cutoff = inter["ts"].quantile(quantile)
    return inter[inter["ts"] < cutoff], inter[inter["ts"] >= cutoff], cutoff


def split_cases(train: pd.DataFrame, test: pd.DataFrame):
    seen = train.groupby("user_key")["product_id"].agg(set)
    pos = test[test["kind"].isin(POSITIVE_KINDS)].groupby("user_key")["product_id"].agg(set)
    warm, cold = {}, {}
    for user, items in pos.items():
        if user in seen.index:
            truth = items - seen[user]
            if truth:
                warm[user] = truth
        else:
            cold[user] = items
    return warm, cold


def build_tensors(rec: HybridRecommender, train: pd.DataFrame, users: list[str], now: datetime):
    """Per-user normalised component scores C[u, c, i] and candidate mask M[u, i]."""
    n = len(rec.catalog)
    active = rec.catalog.products["is_active"].to_numpy(dtype=bool)
    by_user = dict(tuple(train.groupby("user_key")))
    C = np.zeros((len(users), len(COMPONENTS), n))
    M = np.zeros((len(users), n), dtype=bool)
    for u_i, user in enumerate(users):
        hist = by_user.get(user, train.iloc[0:0])
        comps, rows, strong = rec.component_scores(hist, [], now)
        cand = active.copy()
        seen = rec.catalog.rows(hist["product_id"].unique())
        cand[seen] = False
        M[u_i] = cand
        for c_i, c in enumerate(COMPONENTS):
            C[u_i, c_i] = minmax(comps[c], cand)
    return C, M


def rank(C: np.ndarray, M: np.ndarray, weights: dict, k: int) -> np.ndarray:
    w = np.array([weights.get(c, 0.0) for c in COMPONENTS])
    s = np.einsum("uci,c->ui", C, w)
    s = np.where(M, s, -np.inf)
    # Stable sort for deterministic tie-breaking.
    return np.argsort(-s, axis=1, kind="stable")[:, :k]


def metrics(topk: np.ndarray, truth_rows: list[set[int]], k: int, content_sim: np.ndarray, categories: np.ndarray, n_candidates: int):
    prec, rec_, ndcg, hits = [], [], [], []
    disc = 1 / np.log2(np.arange(2, k + 2))
    ild, catdiv = [], []
    for row, truth in zip(topk, truth_rows):
        row = row[:k]
        rel = np.array([i in truth for i in row], dtype=float)
        h = rel.sum()
        prec.append(h / k)
        rec_.append(h / len(truth))
        idcg = disc[: min(len(truth), k)].sum()
        ndcg.append(float((rel * disc[: len(row)]).sum() / idcg))
        hits.append(float(h > 0))
        if len(row) > 1:
            sub = content_sim[np.ix_(row, row)]
            ild.append(1 - sub[np.triu_indices(len(row), 1)].mean())
        catdiv.append(len(set(categories[row])) / len(row))
    coverage = len(set(topk[:, :k].ravel().tolist())) / max(1, n_candidates)
    return {
        "precision": float(np.mean(prec)),
        "recall": float(np.mean(rec_)),
        "ndcg": float(np.mean(ndcg)),
        "hit_rate": float(np.mean(hits)),
        "catalog_coverage": float(coverage),
        "intra_list_diversity": float(np.mean(ild)) if ild else None,
        "category_diversity": float(np.mean(catdiv)) if catdiv else None,
        "_ndcg_per_user": np.array(ndcg),
    }


def paired_bootstrap(a: np.ndarray, b: np.ndarray, n: int = 2000, seed: int = 0):
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(a), size=(n, len(a)))
    diffs = (a[idx] - b[idx]).mean(axis=1)
    lo, hi = np.percentile(diffs, [2.5, 97.5])
    return float((a - b).mean()), float(lo), float(hi)


def _evaluate_split(ds: Dataset, train: pd.DataFrame, cases: dict, now: datetime, iw: InteractionWeights, ks=(5, 10), weight_sets: dict | None = None):
    split_ds = replace(ds, interactions=train)
    rec = HybridRecommender.fit(split_ds, now, interaction_weights=iw)
    users = sorted(cases)
    C, M = build_tensors(rec, train, users, now)
    truth = [set(rec.catalog.rows(cases[u])) for u in users]
    cats = rec.catalog.products["category"].to_numpy()
    n_cand = int(rec.catalog.products["is_active"].sum())
    out = {}
    for name, w in (weight_sets or {}).items():
        out[name] = {k: metrics(rank(C, M, w, k), truth, k, rec.content.similarity, cats, n_cand) for k in ks}
    return out, (C, M, truth, rec)


def hybrid_grid():
    grid = []
    for cf, content, cat, pop, recency in itertools.product([0.2, 0.4, 0.6], [0.1, 0.25, 0.4], [0.0, 0.15, 0.3], [0.0, 0.15, 0.3], [0.0, 0.05]):
        s = cf + content + cat + pop + recency
        grid.append({"cf": cf / s, "content": content / s, "category": cat / s, "popularity": pop / s, "recency": recency / s})
    return grid


def evaluate(ds: Dataset, ks=(5, 10), quantile: float = 0.8, seed: int = 0) -> dict:
    inter = ds.interactions
    if len(inter) < 200:
        return {"status": "insufficient_data", "message": f"Only {len(inter)} interactions; at least 200 are needed for a meaningful temporal evaluation."}
    train, test, cutoff = temporal_split(inter, quantile)
    warm, cold = split_cases(train, test)

    # --- validation split inside the train period -------------------------------------------------
    v_train, v_test, v_cutoff = temporal_split(train, quantile)
    v_cases, _ = split_cases(v_train, v_test)
    default_w = HybridWeights().as_dict()
    scheme_results = []
    for name, iw in INTERACTION_SCHEMES.items():
        res, _ = _evaluate_split(ds, v_train, v_cases, v_cutoff.to_pydatetime(warn=False), iw, ks=(10,), weight_sets={"cf_only": BASELINES["cf_only"], "hybrid": default_w})
        scheme_results.append({"scheme": name, "weights": iw.as_dict(), "val_ndcg@10_cf_only": res["cf_only"][10]["ndcg"], "val_ndcg@10_hybrid": res["hybrid"][10]["ndcg"]})
    best_scheme = max(scheme_results, key=lambda r: (r["val_ndcg@10_hybrid"], r["scheme"] == "default"))
    chosen_iw = INTERACTION_SCHEMES[best_scheme["scheme"]]

    _, (C, M, truth, vrec) = _evaluate_split(ds, v_train, v_cases, v_cutoff.to_pydatetime(warn=False), chosen_iw, ks=(10,), weight_sets={})
    cats = vrec.catalog.products["category"].to_numpy()
    n_cand = int(vrec.catalog.products["is_active"].sum())
    grid_scores = []
    for w in hybrid_grid():
        m = metrics(rank(C, M, w, 10), truth, 10, vrec.content.similarity, cats, n_cand)
        grid_scores.append((m["ndcg"], w))
    default_val = metrics(rank(C, M, default_w, 10), truth, 10, vrec.content.similarity, cats, n_cand)["ndcg"]
    best_val, best_w = max(grid_scores, key=lambda t: t[0])

    # --- test period -----------------------------------------------------------------------------------
    weight_sets = {**BASELINES, "hybrid_default": default_w, "hybrid_tuned": best_w}
    results, (C, M, truth, rec) = _evaluate_split(ds, train, warm, cutoff.to_pydatetime(warn=False), chosen_iw, ks=ks, weight_sets=weight_sets)

    k_main = max(ks)
    baselines = ["popularity", "content_only"]
    best_base = max(baselines, key=lambda b: results[b][k_main]["ndcg"])
    comparisons = {}
    for model in ("hybrid_tuned", "hybrid_default", "cf_only"):
        diff, lo, hi = paired_bootstrap(results[model][k_main]["_ndcg_per_user"], results[best_base][k_main]["_ndcg_per_user"], seed=seed)
        comparisons[model] = {
            "vs": best_base, "metric": f"ndcg@{k_main}", "mean_difference": diff, "ci95": [lo, hi],
            "conclusion": "better" if lo > 0 else "worse" if hi < 0 else "no significant difference",
        }
    # Does blending add anything over the strongest single component?
    for model in ("hybrid_tuned", "hybrid_default"):
        diff, lo, hi = paired_bootstrap(results[model][k_main]["_ndcg_per_user"], results["cf_only"][k_main]["_ndcg_per_user"], seed=seed)
        comparisons[f"{model}_vs_cf_only"] = {
            "vs": "cf_only", "metric": f"ndcg@{k_main}", "mean_difference": diff, "ci95": [lo, hi],
            "conclusion": "better" if lo > 0 else "worse" if hi < 0 else "no significant difference",
        }

    # Cold-start users: no train history. Strategy = popularity + new arrivals (no personal signal).
    cold_report = None
    if cold:
        users = sorted(cold)
        Cc, Mc = build_tensors(rec, train.iloc[0:0], users, cutoff.to_pydatetime(warn=False))
        tc = [set(rec.catalog.rows(cold[u])) for u in users]
        cold_report = {
            "n_users": len(users),
            "popularity": _strip(metrics(rank(Cc, Mc, {"popularity": 1.0}, k_main), tc, k_main, rec.content.similarity, cats, n_cand)),
            "cold_start_strategy": _strip(metrics(rank(Cc, Mc, {"popularity": 0.55, "recency": 0.15}, k_main), tc, k_main, rec.content.similarity, cats, n_cand)),
        }

    clean = {m: {f"@{k}": _strip(v) for k, v in by_k.items()} for m, by_k in results.items()}
    return {
        "status": "ok",
        "dataset": {
            "interactions": int(len(inter)),
            "users": int(inter["user_key"].nunique()),
            "products": int(len(ds.products)),
            "date_range": [inter["ts"].min().isoformat(), inter["ts"].max().isoformat()],
            "cutoff": cutoff.isoformat(),
            "train_interactions": int(len(train)),
            "test_interactions": int(len(test)),
            "test_users": len(warm),
            "cold_start_test_users": len(cold),
            "demo_data_share": round(ds.is_demo_share, 4),
            "positive_kinds": list(POSITIVE_KINDS),
        },
        "interaction_weight_validation": {"candidates": scheme_results, "chosen": best_scheme["scheme"]},
        "hybrid_weight_search": {"grid_size": len(grid_scores), "best_weights": best_w, "val_ndcg@10_best": best_val, "val_ndcg@10_default": default_val},
        "results": clean,
        "comparisons": comparisons,
        "cold_start": cold_report,
        "limitations": [
            "Demo data share is reported above; on synthetic data these metrics measure the generator's built-in structure, not real shopper behaviour.",
            "Offline metrics on logged data are biased toward what was previously shown; online CTR and conversion are tracked separately after deployment.",
            "Item availability at test time is unknown historically, so evaluation ranks all active products regardless of current stock.",
            "Binary relevance: any add-to-cart or purchase after the cutoff counts equally as relevant.",
        ],
    }


def _strip(m: dict) -> dict:
    return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in m.items() if not k.startswith("_")}
