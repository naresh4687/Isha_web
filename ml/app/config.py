"""Configuration for the recommendation / BI service. All values can be overridden by env vars."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")


@dataclass(frozen=True)
class InteractionWeights:
    """Implicit-feedback strength per interaction type (validated in evaluation; see docs/ML.md)."""

    product_view: float = 1.0
    add_to_wishlist: float = 3.0
    add_to_cart: float = 4.0
    purchase: float = 8.0
    # Ratings adjust the signal: weight += (rating - 3) * rating_scale; 5 stars => +4, 1 star => -4.
    rating_scale: float = 2.0

    def as_dict(self) -> dict:
        return dict(self.__dict__)


@dataclass(frozen=True)
class HybridWeights:
    """Weights applied to min-max normalised component scores."""

    cf: float = 0.40
    content: float = 0.25
    category: float = 0.15
    popularity: float = 0.15
    recency: float = 0.05

    def as_dict(self) -> dict:
        return dict(self.__dict__)


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv("DATABASE_URL", "postgresql://anvaya:anvaya_dev_password@localhost:5433/anvaya")
    service_token: str = os.getenv("ML_SERVICE_TOKEN", "")
    artifact_dir: Path = Path(os.getenv("ML_ARTIFACT_DIR", Path(__file__).resolve().parents[1] / "artifacts"))
    interaction_weights: InteractionWeights = field(default_factory=InteractionWeights)
    hybrid_weights: HybridWeights = field(
        default_factory=lambda: HybridWeights(**json.loads(os.getenv("ML_HYBRID_WEIGHTS", "{}")))
    )
    # Time decay of a user's own history when scoring (days).
    history_half_life_days: float = float(os.getenv("ML_HISTORY_HALF_LIFE_DAYS", "30"))
    # Trending: exponentially decayed interactions over a short window.
    trending_window_days: int = int(os.getenv("ML_TRENDING_WINDOW_DAYS", "30"))
    trending_half_life_days: float = float(os.getenv("ML_TRENDING_HALF_LIFE_DAYS", "7"))
    # Item-item CF shrinkage: sim * n / (n + lambda), where n = users who interacted with both.
    cf_shrinkage: float = float(os.getenv("ML_CF_SHRINKAGE", "10"))
    cf_neighbors: int = int(os.getenv("ML_CF_NEIGHBORS", "30"))
    # A product counts as "cold" for CF until this many distinct users interacted with it.
    cold_item_min_users: int = int(os.getenv("ML_COLD_ITEM_MIN_USERS", "5"))
    # Frequently bought together requires at least this many orders containing both products.
    fbt_min_support_orders: int = int(os.getenv("ML_FBT_MIN_SUPPORT", "3"))
    eligibility_ttl_seconds: int = int(os.getenv("ML_ELIGIBILITY_TTL", "60"))


settings = Settings()
