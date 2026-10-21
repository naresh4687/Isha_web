from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from app.bi.forecast import backtest, daily_net_sales, demand, forecast
from app.bi.segments import kmeans_segments, rfm_segments, rfm_table

NOW = datetime(2026, 6, 1, 12, tzinfo=timezone.utc)


def lines_from(orders):
    return pd.DataFrame([{"order_id": f"o{i}", "user_id": u, "product_id": "p", "variant_id": "v1", "quantity": q,
                          "net_paise": float(n), "paid_at": NOW - timedelta(days=d), "status": s, "is_demo": False}
                         for i, (u, d, n, q, s) in enumerate(orders)])


def test_rfm_table_definitions():
    ol = lines_from([("a", 1, 1000, 1, "delivered"), ("a", 10, 500, 1, "delivered"), ("b", 40, 300, 1, "delivered"), ("b", 2, 999, 1, "cancelled")])
    t = rfm_table(ol, NOW).set_index("user_id")
    assert t.loc["a", "frequency"] == 2 and t.loc["a", "monetary_paise"] == 1500
    assert round(t.loc["a", "recency_days"]) == 1
    assert t.loc["b", "frequency"] == 1 and round(t.loc["b", "recency_days"]) == 40  # cancelled order ignored


def test_rfm_segments_cover_all_customers():
    rng = np.random.default_rng(0)
    orders = [(f"u{u}", float(rng.uniform(0, 180)), float(rng.uniform(200, 5000)), 1, "delivered") for u in range(60) for _ in range(rng.integers(1, 6))]
    r = rfm_segments(lines_from(orders), NOW)
    assert r["status"] == "ok"
    assert sum(s["customers"] for s in r["segments"]) == 60
    assert abs(sum(s["share_of_value"] for s in r["segments"]) - 1) < 1e-6
    assert all(s["suggested_action"] for s in r["segments"])


def test_rfm_and_kmeans_refuse_tiny_samples():
    ol = lines_from([("a", 1, 100, 1, "delivered")])
    assert rfm_segments(ol, NOW)["status"] == "insufficient_data"
    assert kmeans_segments(ol, NOW)["valid"] is False


def test_kmeans_validation_flags_unstructured_data():
    rng = np.random.default_rng(1)
    # Two well separated groups: frequent recent big spenders vs one-off lapsed buyers.
    orders = [(f"a{u}", float(rng.uniform(0, 10)), float(rng.uniform(4000, 6000)), 1, "delivered") for u in range(40) for _ in range(5)]
    orders += [(f"b{u}", float(rng.uniform(150, 180)), float(rng.uniform(100, 300)), 1, "delivered") for u in range(40)]
    good = kmeans_segments(lines_from(orders), NOW)
    assert good["valid"] and good["chosen_k"] >= 2
    assert good["clusters"]
    assert kmeans_segments(lines_from(orders), NOW) == good  # reproducible


def seasonal_lines(days=120, base=10000, weekend=6000):
    rows = []
    for d in range(1, days + 1):
        day = NOW - timedelta(days=d)
        amount = base + (weekend if day.astimezone(timezone(timedelta(hours=5, minutes=30))).weekday() >= 5 else 0)
        rows.append(("u", d, amount, 1, "delivered"))
    return lines_from(rows)


def test_forecast_backtest_prefers_seasonal_model_on_weekly_pattern():
    r = forecast(seasonal_lines(), NOW, horizon=14)
    assert r["status"] == "ok"
    assert r["backtest"]["chosen"] in ("seasonal_naive", "ridge_trend_dow")
    assert r["backtest"]["models"][r["backtest"]["chosen"]]["wape"] < r["backtest"]["models"]["moving_average_28"]["wape"]
    assert len(r["forecast"]) == 14
    for f in r["forecast"]:
        assert f["lower_80_paise"] <= f["net_sales_paise"] <= f["upper_80_paise"]
    assert r["limitations"]


def test_forecast_requires_history():
    assert forecast(seasonal_lines(days=20), NOW)["status"] == "insufficient_data"


def test_daily_series_is_gap_filled_and_excludes_today():
    ol = lines_from([("u", 0.1, 500, 1, "delivered"), ("u", 3, 700, 1, "delivered")])
    s = daily_net_sales(ol, NOW)
    assert s.sum() == 700 and len(s) == 3 and (s == 0).sum() == 2


def test_demand_reorder_logic():
    ol = lines_from([("u", d, 100, 2, "delivered") for d in range(1, 28)])
    variants = pd.DataFrame([{"variant_id": "v1", "sku": "S1", "name": "Std", "stock": 10, "title": "Thing"},
                             {"variant_id": "v2", "sku": "S2", "name": "Std", "stock": 10, "title": "Idle"}])
    r = demand(ol, None, variants, NOW, lead_time_days=14)
    by = {i["sku"]: i for i in r["items"]}
    assert by["S1"]["mean_daily_units"] > 1.8 and by["S1"]["needs_reorder"] is True
    assert by["S1"]["suggested_order_qty"] > 0
    assert by["S2"] == {**by["S2"], "needs_reorder": False, "suggested_order_qty": 0, "days_of_cover": None}
