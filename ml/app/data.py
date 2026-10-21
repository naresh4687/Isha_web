"""Read-only data access. Produces tidy DataFrames used by every model, so models are testable
with in-memory fixtures and never depend on the database directly."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import psycopg

from .config import InteractionWeights, settings

INTERACTION_COLUMNS = ["user_key", "product_id", "kind", "ts", "rating"]


@dataclass
class Dataset:
    products: pd.DataFrame  # product_id, title, description, tags(list), category, subcategory, attributes(dict), price, created_at, is_active, stock
    interactions: pd.DataFrame  # user_key, product_id, kind, ts, rating
    order_lines: pd.DataFrame  # order_id, user_id, product_id, variant_id, quantity, net_paise, paid_at, status, is_demo
    is_demo_share: float = 0.0


def connect(url: str | None = None):
    # prepare_threshold=None: no server-side prepared statements, which are unsafe behind
    # transaction-pooling proxies such as PgBouncer (e.g. Neon's "-pooler" endpoints).
    return psycopg.connect(url or settings.database_url, autocommit=True, prepare_threshold=None)


def _df(conn, sql: str, params: tuple = ()) -> pd.DataFrame:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        cols = [c.name for c in cur.description]
        return pd.DataFrame(cur.fetchall(), columns=cols)


PRODUCTS_SQL = """
SELECT p.id::text AS product_id, p.title, p.description, p.tags, c.slug AS category, c.name AS category_name,
       p.subcategory, p.attributes, p.created_at, p.is_active,
       (SELECT price_paise FROM product_variants WHERE product_id = p.id ORDER BY is_default DESC, sort_order LIMIT 1) AS price,
       (SELECT coalesce(sum(stock), 0) FROM product_variants WHERE product_id = p.id) AS stock
FROM products p JOIN categories c ON c.id = p.category_id
ORDER BY p.id
"""


def load_products(conn) -> pd.DataFrame:
    df = _df(conn, PRODUCTS_SQL)
    df["price"] = df["price"].astype(float)
    df["stock"] = df["stock"].astype(int)
    return df


def load_dataset(conn, include_demo: bool = True) -> Dataset:
    products = load_products(conn)
    demo = "" if include_demo else "AND NOT e.is_demo"
    events = _df(
        conn,
        f"""SELECT coalesce(e.user_id::text, 'v:' || e.visitor_id) AS user_key, e.product_id::text AS product_id,
                   e.event_type AS kind, e.created_at AS ts, NULL::int AS rating, e.is_demo
            FROM events e WHERE e.product_id IS NOT NULL
              AND e.event_type IN ('product_view', 'add_to_wishlist', 'add_to_cart') {demo}""",
    )
    odemo = "" if include_demo else "AND NOT o.is_demo"
    order_lines = _df(
        conn,
        f"""SELECT o.id::text AS order_id, o.user_id::text AS user_id, oi.product_id::text AS product_id,
                   oi.variant_id::text AS variant_id, oi.quantity,
                   oi.line_total_paise - CASE WHEN o.subtotal_paise > 0 THEN o.discount_paise::numeric * oi.line_total_paise / o.subtotal_paise ELSE 0 END
                     - oi.refunded_paise AS net_paise,
                   o.paid_at, o.status, o.is_demo
            FROM orders o JOIN order_items oi ON oi.order_id = o.id
            WHERE o.paid_at IS NOT NULL {odemo}""",
    )
    if not order_lines.empty:
        order_lines["net_paise"] = order_lines["net_paise"].astype(float)
    reviews = _df(
        conn,
        f"""SELECT r.user_id::text AS user_key, r.product_id::text AS product_id, 'rating' AS kind, r.created_at AS ts, r.rating, r.is_demo
            FROM reviews r {'' if include_demo else 'WHERE NOT r.is_demo'}""",
    )
    purchases = (
        order_lines[~order_lines["status"].isin(["cancelled"])]
        .assign(user_key=lambda d: d["user_id"], kind="purchase", ts=lambda d: d["paid_at"], rating=None)
        [["user_key", "product_id", "kind", "ts", "rating", "is_demo"]]
        if not order_lines.empty
        else pd.DataFrame(columns=INTERACTION_COLUMNS + ["is_demo"])
    )
    frames = [f for f in (events, purchases, reviews) if not f.empty]
    inter = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=INTERACTION_COLUMNS + ["is_demo"])
    demo_share = float(inter["is_demo"].mean()) if len(inter) else 0.0
    inter = inter[INTERACTION_COLUMNS]
    inter["ts"] = pd.to_datetime(inter["ts"], utc=True)
    return Dataset(products=products, interactions=inter.sort_values("ts").reset_index(drop=True), order_lines=order_lines, is_demo_share=demo_share)


def load_history(conn, user_id: str | None, visitor_id: str | None, session_id: str | None, days: int = 180) -> pd.DataFrame:
    """Recent interactions for one shopper (account and/or consented anonymous visitor)."""
    if not (user_id or visitor_id or session_id):
        return pd.DataFrame(columns=INTERACTION_COLUMNS)
    events = _df(
        conn,
        """SELECT product_id::text AS product_id, event_type AS kind, created_at AS ts, NULL::int AS rating
           FROM events WHERE product_id IS NOT NULL AND event_type IN ('product_view', 'add_to_wishlist', 'add_to_cart')
             AND created_at > now() - make_interval(days => %s)
             AND ((%s::uuid IS NOT NULL AND user_id = %s::uuid) OR (%s::text IS NOT NULL AND visitor_id = %s) OR (%s::text IS NOT NULL AND session_id = %s))
           ORDER BY created_at DESC LIMIT 500""",
        (days, user_id, user_id, visitor_id, visitor_id, session_id, session_id),
    )
    frames = [events]
    if user_id:
        frames.append(
            _df(
                conn,
                """SELECT oi.product_id::text AS product_id, 'purchase' AS kind, o.paid_at AS ts, NULL::int AS rating
                   FROM orders o JOIN order_items oi ON oi.order_id = o.id
                   WHERE o.user_id = %s::uuid AND o.paid_at IS NOT NULL AND o.status <> 'cancelled'""",
                (user_id,),
            )
        )
        frames.append(
            _df(conn, "SELECT product_id::text AS product_id, 'rating' AS kind, created_at AS ts, rating FROM reviews WHERE user_id = %s::uuid", (user_id,))
        )
    frames = [f for f in frames if not f.empty]
    if not frames:
        return pd.DataFrame(columns=INTERACTION_COLUMNS)
    h = pd.concat(frames, ignore_index=True)
    h["ts"] = pd.to_datetime(h["ts"], utc=True)
    h["user_key"] = user_id or f"v:{visitor_id}"
    return h[INTERACTION_COLUMNS]


def load_user_prefs(conn, user_id: str | None) -> list[str]:
    if not user_id:
        return []
    df = _df(conn, "SELECT category_prefs FROM users WHERE id = %s::uuid", (user_id,))
    return list(df.iloc[0]["category_prefs"]) if len(df) else []


def interaction_strength(df: pd.DataFrame, weights: InteractionWeights) -> pd.Series:
    """Per-row signal strength. Ratings shift preference up or down; unknown kinds contribute 0."""
    base = df["kind"].map(
        {
            "product_view": weights.product_view,
            "add_to_wishlist": weights.add_to_wishlist,
            "add_to_cart": weights.add_to_cart,
            "purchase": weights.purchase,
            "rating": 0.0,
        }
    ).fillna(0.0)
    rating = pd.to_numeric(df["rating"], errors="coerce")
    adj = ((rating - 3) * weights.rating_scale).where(df["kind"] == "rating", 0.0).fillna(0.0)
    return base + adj


def decay(ts: pd.Series, now: datetime, half_life_days: float) -> np.ndarray:
    age = (pd.Timestamp(now) - ts).dt.total_seconds().to_numpy() / 86400.0
    return np.power(0.5, np.clip(age, 0, None) / half_life_days)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
