import time
from types import SimpleNamespace

import pandas as pd
import pytest
from fastapi.testclient import TestClient

import app.api as api
from app.hybrid import HybridRecommender
from tests.conftest import NOW, make_dataset


@pytest.fixture
def client(monkeypatch):
    ds = make_dataset()
    api.state.model = HybridRecommender.fit(ds, NOW, version="vtest")
    api.state.report = {"ok": True}
    api.state.eligible = set(ds.products["product_id"]) - {"yoga-mat-1"}
    api.state.eligible_at = time.time() + 10_000
    monkeypatch.setattr(api, "_history", lambda u, v, s, recent: pd.DataFrame(
        {"user_key": "x", "product_id": recent, "kind": "product_view", "ts": pd.Timestamp(NOW), "rating": None}))
    monkeypatch.setattr(api, "utcnow", lambda: NOW)
    monkeypatch.setattr(api, "settings", SimpleNamespace(service_token="tok", eligibility_ttl_seconds=60))
    return TestClient(api.app)


H = {"X-Service-Token": "tok"}


def test_requires_service_token(client):
    assert client.get("/v1/recommend/trending").status_code == 401
    assert client.get("/v1/recommend/trending", headers={"X-Service-Token": "wrong"}).status_code == 401
    r = client.get("/v1/recommend/trending?k=3", headers=H)
    assert r.status_code == 200 and len(r.json()["items"]) == 3


def test_endpoints_return_ids_scores_reasons_only(client):
    r = client.get("/v1/recommend/personalized?k=4&recent=not-a-uuid", headers=H).json()
    assert r["strategy"] == "cold_start" and r["model_version"] == "vtest"
    assert set(r["items"][0]) == {"product_id", "score", "reasons"}
    sim = client.get("/v1/recommend/similar/yoga-mat-0?k=5", headers=H)
    assert sim.status_code == 422  # ids must be UUIDs
    assert "yoga-mat-1" not in [i["product_id"] for i in client.get("/v1/recommend/trending?k=30", headers=H).json()["items"]]
    assert client.get("/v1/recommend/trending?k=999", headers=H).status_code == 422


def test_health_is_public(client):
    assert client.get("/health").json() == {"ok": True, "model_loaded": True, "version": "vtest"}


def test_retrain_requires_token_and_swaps_model(client, monkeypatch):
    from contextlib import nullcontext

    assert client.post("/v1/model/retrain").status_code == 401
    new_model = HybridRecommender.fit(make_dataset(seed=9), NOW, version="vnew")
    monkeypatch.setattr(api.state, "conn_factory", lambda: nullcontext(None))
    monkeypatch.setattr(api, "train", lambda c: {"evaluation": {"status": "ok"}})
    monkeypatch.setattr(api, "load_latest", lambda: (new_model, {"ok": True}))
    r = client.post("/v1/model/retrain", headers=H)
    assert r.status_code == 200 and r.json() == {"version": "vnew", "evaluation_status": "ok"}
    assert client.get("/health").json()["version"] == "vnew"
