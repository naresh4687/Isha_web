"""Daily net-sales forecasting with simple, explainable models and a rolling-origin backtest.

Models
  - seasonal_naive: value from the same weekday last week.
  - moving_average_28: mean of the last 28 days.
  - ridge_trend_dow: ridge regression on a linear trend + day-of-week indicators.
Backtest: expanding window, 4 folds of 7-day horizons over the final 28 days. Metric: WAPE
(sum |error| / sum actual), with MAE reported too. Prediction intervals use the empirical
10th–90th percentiles of backtest errors at each horizon step (an 80% interval).
"""
from __future__ import annotations

from datetime import datetime

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge

TZ = "Asia/Kolkata"


def daily_net_sales(order_lines: pd.DataFrame, now: datetime) -> pd.Series:
    if order_lines is None or order_lines.empty:
        return pd.Series(dtype=float)
    ol = order_lines.copy()
    ol["day"] = pd.to_datetime(ol["paid_at"], utc=True).dt.tz_convert(TZ).dt.tz_localize(None).dt.normalize()
    s = ol.groupby("day")["net_paise"].sum()
    # Exclude the current (partial) day.
    end = pd.Timestamp(now).tz_convert(TZ).tz_localize(None).normalize() - pd.Timedelta(days=1)
    idx = pd.date_range(s.index.min(), end, freq="D")
    return s.reindex(idx, fill_value=0.0).astype(float)


def _features(index: pd.DatetimeIndex, origin: pd.Timestamp) -> np.ndarray:
    trend = ((index - origin).days.to_numpy() / 30.0)[:, None]
    dow = np.eye(7)[index.dayofweek]
    return np.hstack([trend, dow])


def predict(model: str, history: pd.Series, horizon: int) -> np.ndarray:
    if model == "seasonal_naive":
        last_week = history.iloc[-7:].to_numpy()
        return np.array([last_week[i % 7] for i in range(horizon)])
    if model == "moving_average_28":
        return np.full(horizon, history.iloc[-28:].mean())
    if model == "ridge_trend_dow":
        origin = history.index[0]
        reg = Ridge(alpha=1.0).fit(_features(history.index, origin), history.to_numpy())
        future = pd.date_range(history.index[-1] + pd.Timedelta(days=1), periods=horizon, freq="D")
        return np.clip(reg.predict(_features(future, origin)), 0, None)
    raise ValueError(model)


MODELS = ("seasonal_naive", "moving_average_28", "ridge_trend_dow")


def backtest(series: pd.Series, folds: int = 4, horizon: int = 7):
    results = {m: {"abs_err": [], "actual": [], "errors_by_step": [[] for _ in range(horizon)]} for m in MODELS}
    n = len(series)
    for f in range(folds):
        split = n - (folds - f) * horizon
        hist, actual = series.iloc[:split], series.iloc[split : split + horizon].to_numpy()
        for m in MODELS:
            pred = predict(m, hist, horizon)
            err = actual - pred
            results[m]["abs_err"].extend(np.abs(err))
            results[m]["actual"].extend(actual)
            for i, e in enumerate(err):
                results[m]["errors_by_step"][i].append(e)
    summary = {}
    for m, r in results.items():
        total = float(np.sum(r["actual"]))
        summary[m] = {"wape": float(np.sum(r["abs_err"]) / total) if total else None, "mae_paise": float(np.mean(r["abs_err"]))}
    return summary, results


def forecast(order_lines: pd.DataFrame, now: datetime, horizon: int = 14, min_history_days: int = 56) -> dict:
    s = daily_net_sales(order_lines, now)
    if len(s) < min_history_days:
        return {"status": "insufficient_data", "history_days": int(len(s)), "message": f"Forecasting needs at least {min_history_days} days of sales history."}
    summary, raw = backtest(s)
    best = min(summary, key=lambda m: summary[m]["wape"] if summary[m]["wape"] is not None else np.inf)
    pred = predict(best, s, horizon)
    # Interval from backtest errors; steps beyond the backtest horizon reuse the widest observed spread.
    steps = raw[best]["errors_by_step"]
    lo_q = [np.percentile(e, 10) for e in steps]
    hi_q = [np.percentile(e, 90) for e in steps]
    lo = np.array([lo_q[min(i, len(lo_q) - 1)] for i in range(horizon)])
    hi = np.array([hi_q[min(i, len(hi_q) - 1)] for i in range(horizon)])
    if horizon > len(steps):
        lo[len(steps):] = min(lo_q)
        hi[len(steps):] = max(hi_q)
    future = pd.date_range(s.index[-1] + pd.Timedelta(days=1), periods=horizon, freq="D")
    return {
        "status": "ok",
        "history": [{"date": d.strftime("%Y-%m-%d"), "net_sales_paise": round(v)} for d, v in s.iloc[-90:].items()],
        "history_days": int(len(s)),
        "backtest": {"folds": 4, "horizon_days": 7, "models": summary, "chosen": best},
        "forecast": [
            {"date": d.strftime("%Y-%m-%d"), "net_sales_paise": round(p), "lower_80_paise": round(max(0, p + l)), "upper_80_paise": round(max(0, p + h))}
            for d, p, l, h in zip(future, pred, lo, hi)
        ],
        "limitations": [
            "Intervals are empirical (from 4 backtest folds) and will be too narrow if the future differs from the backtest period.",
            "No holiday, promotion or stock-out effects are modelled; zero-sales days caused by stock-outs are treated as true demand.",
            "Short history: yearly seasonality cannot be estimated.",
        ],
    }


def demand(order_lines: pd.DataFrame, products: pd.DataFrame, variants: pd.DataFrame, now: datetime,
           window_days: int = 28, lead_time_days: int = 14, cover_days: int = 30, z: float = 1.28) -> dict:
    """Per-variant demand estimate and reorder suggestion (z = 1.28 ≈ 90% cycle service level).
    reorder_point = mean_daily * L + z * sd_daily * sqrt(L); suggest ordering up to reorder_point + cover."""
    end = pd.Timestamp(now)
    ol = order_lines[(order_lines["status"] != "cancelled") & (pd.to_datetime(order_lines["paid_at"], utc=True) > end - pd.Timedelta(days=window_days))].copy()
    ol["day"] = pd.to_datetime(ol["paid_at"], utc=True).dt.floor("D")
    days = pd.date_range((end - pd.Timedelta(days=window_days - 1)).floor("D"), end.floor("D"), freq="D")
    daily = ol.groupby(["variant_id", "day"])["quantity"].sum().unstack(fill_value=0).reindex(columns=days, fill_value=0)
    rows = []
    for _, v in variants.iterrows():
        series = daily.loc[v["variant_id"]].to_numpy(dtype=float) if v["variant_id"] in daily.index else np.zeros(len(days))
        mean, sd = series.mean(), series.std(ddof=1) if len(series) > 1 else 0.0
        rop = mean * lead_time_days + z * sd * np.sqrt(lead_time_days)
        suggest = max(0, int(np.ceil(rop + mean * cover_days - v["stock"]))) if mean > 0 else 0
        rows.append({
            "variant_id": v["variant_id"], "sku": v["sku"], "title": v["title"], "variant": v["name"], "stock": int(v["stock"]),
            "units_last_window": int(series.sum()), "mean_daily_units": round(float(mean), 3), "sd_daily_units": round(float(sd), 3),
            "days_of_cover": None if mean == 0 else round(float(v["stock"] / mean), 1),
            "reorder_point": round(float(rop), 1), "needs_reorder": bool(mean > 0 and v["stock"] <= rop), "suggested_order_qty": suggest,
        })
    out = pd.DataFrame(rows).sort_values(["needs_reorder", "days_of_cover"], ascending=[False, True], na_position="last")
    return {
        "status": "ok",
        "params": {"window_days": window_days, "lead_time_days": lead_time_days, "cover_days": cover_days, "service_level_z": z},
        "items": out.astype(object).where(pd.notna(out), None).to_dict(orient="records"),
        "limitations": ["Assumes stationary demand over the window and a fixed supplier lead time; observed sales understate demand during stock-outs."],
    }
