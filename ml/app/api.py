"""Internal recommendation + BI service. Only the backend calls it, authenticated with a shared
service token; it never returns personal data beyond product ids, scores and reason codes."""
from __future__ import annotations

import hmac
import logging
import threading
import time
import uuid
from contextlib import asynccontextmanager

import pandas as pd
from fastapi import Depends, FastAPI, Header, HTTPException, Query

from .bi.forecast import demand, forecast
from .bi.segments import kmeans_segments, rfm_segments
from .config import settings
from .data import _df, connect, load_dataset, load_history, load_user_prefs, utcnow
from .hybrid import HybridRecommender
from .train import load_latest, train

log = logging.getLogger("ml")


class State:
    def __init__(self):
        self.model: HybridRecommender | None = None
        self.report: dict | None = None
        self.eligible: set[str] | None = None
        self.eligible_at = 0.0
        self.lock = threading.Lock()
        self.conn_factory = connect

    def conn(self):
        return self.conn_factory()

    def eligible_ids(self) -> set[str]:
        """Active, in-stock product ids, refreshed from the database every `eligibility_ttl_seconds`."""
        if self.eligible is None or time.time() - self.eligible_at > settings.eligibility_ttl_seconds:
            with self.conn() as c:
                df = _df(c, "SELECT p.id::text AS id FROM products p WHERE p.is_active AND (SELECT coalesce(sum(stock), 0) FROM product_variants WHERE product_id = p.id) > 0")
            self.eligible = set(df["id"])
            self.eligible_at = time.time()
        return self.eligible


state = State()


def load_or_train():
    model, report = load_latest()
    if model is None:
        log.warning("No model artifact found; training one now.")
        with state.conn() as c:
            out = train(c)
        model, report = load_latest()
    state.model, state.report = model, report


@asynccontextmanager
async def lifespan(_app):
    if state.model is None:
        load_or_train()
    yield


app = FastAPI(title="Recommendation & BI service", lifespan=lifespan, docs_url=None, redoc_url=None)


def require_token(x_service_token: str = Header(default="")):
    if not settings.service_token or not hmac.compare_digest(x_service_token, settings.service_token):
        raise HTTPException(status_code=401, detail="invalid service token")


def model() -> HybridRecommender:
    if state.model is None:
        raise HTTPException(status_code=503, detail="model not loaded")
    return state.model


def _ids(csv: str | None, limit: int = 20) -> list[str]:
    out = []
    for x in (csv or "").split(",")[:limit]:
        try:
            out.append(str(uuid.UUID(x.strip())))
        except ValueError:
            continue
    return out


def _history(user_id, visitor_id, session_id, recent: list[str]) -> pd.DataFrame:
    with state.conn() as c:
        h = load_history(c, user_id, visitor_id, session_id)
    if recent:
        # Client-side recently viewed items (no server tracking needed) count as views, newest first.
        now = utcnow()
        extra = pd.DataFrame({"user_key": "client", "product_id": recent, "kind": "product_view",
                              "ts": [pd.Timestamp(now) - pd.Timedelta(minutes=i) for i in range(len(recent))], "rating": None})
        h = pd.concat([h, extra], ignore_index=True) if not h.empty else extra
    return h


def _out(recs, strategy: str | None = None):
    return {"items": [{"product_id": r.product_id, "score": round(r.score, 6), "reasons": r.reasons} for r in recs],
            "model_version": state.model.version if state.model else None, "strategy": strategy}


def _uuid_or_none(v: str | None) -> str | None:
    if not v:
        return None
    try:
        return str(uuid.UUID(v))
    except ValueError:
        raise HTTPException(status_code=422, detail="invalid id")


@app.get("/health")
def health():
    return {"ok": True, "model_loaded": state.model is not None, "version": state.model.version if state.model else None}


@app.get("/v1/recommend/personalized", dependencies=[Depends(require_token)])
def personalized(user_id: str | None = None, visitor_id: str | None = Query(None, max_length=64), session_id: str | None = Query(None, max_length=64),
                 recent: str | None = None, categories: str | None = Query(None, max_length=400), k: int = Query(12, ge=1, le=48)):
    m = model()
    user_id = _uuid_or_none(user_id)
    hist = _history(user_id, visitor_id, session_id, _ids(recent))
    prefs = [c for c in (categories or "").split(",") if c][:9]
    if user_id:
        with state.conn() as c:
            prefs = list(dict.fromkeys(prefs + load_user_prefs(c, user_id)))
    recs, strategy = m.recommend(hist, k=k, prefs=prefs, now=utcnow(), eligible_ids=state.eligible_ids())
    return _out(recs, strategy)


@app.get("/v1/recommend/continue", dependencies=[Depends(require_token)])
def continue_exploring(user_id: str | None = None, visitor_id: str | None = Query(None, max_length=64), session_id: str | None = Query(None, max_length=64),
                       recent: str | None = None, k: int = Query(8, ge=1, le=48)):
    hist = _history(_uuid_or_none(user_id), visitor_id, session_id, _ids(recent))
    return _out(model().continue_exploring(hist, k=k, now=utcnow(), eligible_ids=state.eligible_ids()), "continue_exploring")


@app.get("/v1/recommend/similar/{product_id}", dependencies=[Depends(require_token)])
def similar(product_id: str, k: int = Query(8, ge=1, le=48)):
    return _out(model().similar(_uuid_or_none(product_id), k=k, eligible_ids=state.eligible_ids()), "content+cf")


@app.get("/v1/recommend/fbt/{product_id}", dependencies=[Depends(require_token)])
def fbt(product_id: str, k: int = Query(3, ge=1, le=12)):
    return _out(model().frequently_bought_together(_uuid_or_none(product_id), k=k, eligible_ids=state.eligible_ids()), "co_purchase")


@app.get("/v1/recommend/trending", dependencies=[Depends(require_token)])
def trending(k: int = Query(8, ge=1, le=48), category: str | None = Query(None, max_length=60)):
    return _out(model().trending(k=k, category=category, eligible_ids=state.eligible_ids()), "trending")


@app.get("/v1/model", dependencies=[Depends(require_token)])
def model_info():
    m = model()
    return {"version": m.version, "trained_at": m.trained_at.isoformat(), "weights": m.weights.as_dict(),
            "interaction_weights": m.interaction_weights.as_dict(), "report": state.report}


@app.post("/v1/model/reload", dependencies=[Depends(require_token)])
def reload():
    with state.lock:
        load_or_train()
    return {"version": state.model.version}


# --- BI -----------------------------------------------------------------------------------------------


def _orders(include_demo: bool):
    with state.conn() as c:
        return load_dataset(c, include_demo=include_demo)


@app.get("/v1/bi/rfm", dependencies=[Depends(require_token)])
def bi_rfm(includeDemo: bool = True):
    return rfm_segments(_orders(includeDemo).order_lines, utcnow())


@app.get("/v1/bi/segments", dependencies=[Depends(require_token)])
def bi_segments(includeDemo: bool = True):
    return kmeans_segments(_orders(includeDemo).order_lines, utcnow())


@app.get("/v1/bi/forecast", dependencies=[Depends(require_token)])
def bi_forecast(includeDemo: bool = True, horizon: int = Query(14, ge=7, le=56)):
    return forecast(_orders(includeDemo).order_lines, utcnow(), horizon=horizon)


@app.get("/v1/bi/demand", dependencies=[Depends(require_token)])
def bi_demand(includeDemo: bool = True, leadTimeDays: int = Query(14, ge=1, le=120)):
    ds = _orders(includeDemo)
    with state.conn() as c:
        variants = _df(c, """SELECT v.id::text AS variant_id, v.sku, v.name, v.stock, p.title FROM product_variants v
                             JOIN products p ON p.id = v.product_id WHERE p.is_active""")
    return demand(ds.order_lines, ds.products, variants, utcnow(), lead_time_days=leadTimeDays)


@app.get("/v1/bi/affinity", dependencies=[Depends(require_token)])
def bi_affinity(includeDemo: bool = True, limit: int = Query(20, ge=1, le=100)):
    from .models import CoPurchase

    ds = _orders(includeDemo)
    cp = CoPurchase().fit(ds.order_lines)
    titles = dict(zip(ds.products["product_id"], ds.products["title"]))
    pairs = cp.pairs
    if pairs is None or pairs.empty:
        return {"status": "insufficient_data", "orders": cp.n_orders, "rules": [], "message": f"No product pair appears together in at least {cp.min_support} orders."}
    rules = pairs[pairs["lift"] > 1].sort_values(["lift", "together"], ascending=False).head(limit)
    return {
        "status": "ok",
        "orders": cp.n_orders,
        "min_support_orders": cp.min_support,
        "definition": "support = orders with A and B / all orders; confidence = P(B | A); lift = confidence / P(B). Lift > 1 means bought together more often than chance.",
        "caveat": "Co-occurrence does not show that one product causes purchase of the other.",
        "rules": [{"antecedent": titles.get(r.a, r.a), "consequent": titles.get(r.b, r.b), "orders_together": int(r.together),
                   "support": round(r.support, 4), "confidence": round(r.confidence, 4), "lift": round(r.lift, 3)} for r in rules.itertuples()],
    }
