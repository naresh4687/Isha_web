"""Train, evaluate and publish a model version.

    python -m app.train            # evaluate + fit on all data + save artifact + record model_versions row
    python -m app.train --no-db-record
"""
from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib

from .config import HybridWeights, settings
from .data import connect, load_dataset, utcnow
from .evaluation import INTERACTION_SCHEMES, evaluate
from .hybrid import HybridRecommender


def train(conn, artifact_dir: Path = settings.artifact_dir, record: bool = True, now: datetime | None = None) -> dict:
    t0 = time.time()
    ds = load_dataset(conn)
    report = evaluate(ds)
    now = now or utcnow()
    version = now.strftime("v%Y%m%d-%H%M%S")

    # Production weights: use tuned hybrid weights only if they beat defaults on validation.
    weights = HybridWeights()
    iw = INTERACTION_SCHEMES["default"]
    if report.get("status") == "ok":
        iw = INTERACTION_SCHEMES[report["interaction_weight_validation"]["chosen"]]
        hs = report["hybrid_weight_search"]
        if hs["val_ndcg@10_best"] > hs["val_ndcg@10_default"]:
            weights = HybridWeights(**hs["best_weights"])
    model = HybridRecommender.fit(ds, now, weights=weights, interaction_weights=iw, version=version)

    artifact_dir.mkdir(parents=True, exist_ok=True)
    path = artifact_dir / f"model-{version}.joblib"
    joblib.dump(model, path)
    (artifact_dir / "latest.txt").write_text(path.name)
    report_out = {"version": version, "trained_at": now.isoformat(), "weights": weights.as_dict(), "interaction_weights": iw.as_dict(),
                  "training_seconds": round(time.time() - t0, 2), "evaluation": report}
    (artifact_dir / f"report-{version}.json").write_text(json.dumps(report_out, indent=2, default=str))

    if record:
        with conn.cursor() as cur:
            cur.execute("UPDATE model_versions SET is_active = false WHERE kind = 'hybrid_recommender'")
            cur.execute(
                """INSERT INTO model_versions(kind, params, metrics, dataset, artifact_path, is_active)
                   VALUES ('hybrid_recommender', %s, %s, %s, %s, true)""",
                (json.dumps({"version": version, "weights": weights.as_dict(), "interaction_weights": iw.as_dict()}),
                 json.dumps({k: v for k, v in report.items() if k in ("results", "comparisons", "cold_start", "status")}, default=str),
                 json.dumps(report.get("dataset", {}), default=str), str(path)),
            )
    return report_out


def load_latest(artifact_dir: Path = settings.artifact_dir) -> tuple[HybridRecommender | None, dict | None]:
    latest = artifact_dir / "latest.txt"
    if not latest.exists():
        return None, None
    name = latest.read_text().strip()
    model = joblib.load(artifact_dir / name)
    rpath = artifact_dir / name.replace("model-", "report-").replace(".joblib", ".json")
    report = json.loads(rpath.read_text()) if rpath.exists() else None
    return model, report


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-db-record", action="store_true")
    args = ap.parse_args()
    with connect() as conn:
        out = train(conn, record=not args.no_db_record)
    ev = out["evaluation"]
    print(f"model {out['version']} trained in {out['training_seconds']}s")
    if ev.get("status") != "ok":
        print(ev)
    else:
        d = ev["dataset"]
        print(f"dataset: {d['interactions']} interactions, {d['users']} users, {d['test_users']} test users, demo share {d['demo_data_share']:.0%}")
        print(f"interaction weights chosen on validation: {ev['interaction_weight_validation']['chosen']}")
        print(f"{'model':16s} {'P@10':>7s} {'R@10':>7s} {'NDCG@10':>8s} {'cov':>6s} {'ILD':>6s}")
        for m, r in ev["results"].items():
            x = r["@10"]
            print(f"{m:16s} {x['precision']:7.4f} {x['recall']:7.4f} {x['ndcg']:8.4f} {x['catalog_coverage']:6.2f} {x['intra_list_diversity']:6.3f}")
        for m, c in ev["comparisons"].items():
            print(f"{m} vs {c['vs']}: ΔNDCG@10 = {c['mean_difference']:+.4f}, 95% CI [{c['ci95'][0]:+.4f}, {c['ci95'][1]:+.4f}] -> {c['conclusion']}")
