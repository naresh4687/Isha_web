/**
 * Business analytics computed directly from persisted orders, order items, sessions and events.
 * Every definition here is documented in docs/METRICS.md; keep the two in sync.
 *
 * Conventions
 *  - Time zone: Asia/Kolkata. A date range [from, to] is inclusive of both calendar days.
 *  - Order-based metrics use paid_at (orders that never completed payment are excluded).
 *  - Refunds are attributed back to the original order's paid_at date (not the refund date),
 *    so a period's net sales can decrease after the fact as refunds arrive.
 *  - Discounts are allocated to order lines pro rata by line value; refunds are recorded per line
 *    (order_items.refunded_paise), so filtered totals add up to unfiltered totals.
 *  - Shipping refunds are not merchandise and are excluded from net sales.
 */
import { query, type Queryable, pool } from '../../db/pool.js';
import { env } from '../../config/env.js';

export const TZ = 'Asia/Kolkata';
export type Granularity = 'day' | 'week' | 'month';

export interface Filters {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD inclusive
  granularity: Granularity;
  category?: string;
  productId?: string;
  includeDemo: boolean;
}

const round = (n: number | null | undefined) => Math.round(Number(n ?? 0));
const ratio = (num: number, den: number) => (den > 0 ? num / den : null);

/** Previous window of equal length, immediately before `from`. */
export function previousWindow(f: Filters): Filters {
  const from = new Date(`${f.from}T00:00:00Z`);
  const to = new Date(`${f.to}T00:00:00Z`);
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const pTo = new Date(from.getTime() - 86_400_000);
  const pFrom = new Date(pTo.getTime() - (days - 1) * 86_400_000);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  return { ...f, from: d(pFrom), to: d(pTo) };
}

/** $1 start, $2 end (exclusive), $3 includeDemo, $4 category slug | null, $5 product id | null */
function params(f: Filters) {
  return [f.from, f.to, f.includeDemo, f.category ?? null, f.productId ?? null];
}

const WINDOW = `(($1::date)::timestamp AT TIME ZONE '${TZ}')`;
const WINDOW_END = `((($2::date + 1))::timestamp AT TIME ZONE '${TZ}')`;

/** Paid orders in the window, and their line items with allocated discount and refund. */
const LINES_CTE = `
  po AS (
    SELECT o.* FROM orders o
    WHERE o.paid_at >= ${WINDOW} AND o.paid_at < ${WINDOW_END} AND ($3::bool OR NOT o.is_demo)
  ),
  li AS (
    SELECT po.id AS order_id, po.user_id, po.paid_at, po.status, po.discount_code, po.acquisition_source,
           oi.product_id, oi.title, c.slug AS category_slug, c.name AS category_name, oi.quantity,
           oi.line_total_paise::numeric AS gross,
           CASE WHEN po.subtotal_paise > 0 THEN po.discount_paise::numeric * oi.line_total_paise / po.subtotal_paise ELSE 0 END AS discount,
           oi.refunded_paise::numeric AS refund
    FROM po JOIN order_items oi ON oi.order_id = po.id
    JOIN products p ON p.id = oi.product_id JOIN categories c ON c.id = p.category_id
    WHERE ($4::text IS NULL OR c.slug = $4) AND ($5::uuid IS NULL OR oi.product_id = $5)
  ),
  lv AS (
    SELECT li.*, gross - discount - refund AS net FROM li
  )`;

export async function summary(f: Filters, client: Queryable = pool) {
  const [s] = await query(
    `WITH ${LINES_CTE},
     ord AS (
       SELECT order_id, user_id, status, max(discount_code) AS discount_code, sum(gross) AS gross, sum(discount) AS discount,
              sum(refund) AS refund, sum(net) AS net
       FROM lv GROUP BY order_id, user_id, status
     )
     SELECT coalesce(sum(gross), 0) AS gmv, coalesce(sum(discount), 0) AS discounts, coalesce(sum(refund), 0) AS refunds,
            coalesce(sum(net), 0) AS net_sales, count(*)::int AS orders,
            count(*) FILTER (WHERE status = 'delivered')::int AS completed_orders,
            count(*) FILTER (WHERE status IN ('cancelled', 'refunded'))::int AS cancelled_or_refunded_orders,
            count(*) FILTER (WHERE discount_code IS NOT NULL)::int AS discounted_orders,
            count(DISTINCT user_id)::int AS customers
     FROM ord`,
    params(f),
    client,
  );
  const sessions = await sessionMetrics(f, client);
  const customers = await customerMetrics(f, client);
  const gmv = round(s.gmv);
  const discounts = round(s.discounts);
  return {
    gmvPaise: gmv,
    discountsPaise: discounts,
    refundsPaise: round(s.refunds),
    netSalesPaise: round(s.net_sales),
    orders: s.orders,
    completedOrders: s.completed_orders,
    cancelledOrRefundedOrders: s.cancelled_or_refunded_orders,
    averageOrderValuePaise: s.orders ? round((gmv - discounts) / s.orders) : null,
    discountedOrderShare: ratio(s.discounted_orders, s.orders),
    customers: s.customers,
    ...sessions,
    ...customers,
  };
}

/** Session-based metrics. Category/product filters do not apply (sessions are store-wide). */
export async function sessionMetrics(f: Filters, client: Queryable = pool) {
  const [r] = await query(
    `WITH s AS (
       SELECT id FROM analytics_sessions
       WHERE started_at >= ${WINDOW} AND started_at < ${WINDOW_END} AND ($3::bool OR NOT is_demo)
     ),
     conv AS (SELECT DISTINCT analytics_session_id AS id FROM orders WHERE paid_at IS NOT NULL AND analytics_session_id IN (SELECT id FROM s)),
     carted AS (SELECT DISTINCT session_id AS id FROM events WHERE event_type = 'add_to_cart' AND session_id IN (SELECT id FROM s))
     SELECT (SELECT count(*) FROM s)::int AS sessions,
            (SELECT count(*) FROM conv)::int AS converting_sessions,
            (SELECT count(*) FROM carted)::int AS cart_sessions,
            (SELECT count(*) FROM carted WHERE id NOT IN (SELECT id FROM conv))::int AS abandoned_cart_sessions`,
    params(f).slice(0, 3),
    client,
  );
  return {
    sessions: r.sessions,
    convertingSessions: r.converting_sessions,
    conversionRate: ratio(r.converting_sessions, r.sessions),
    cartSessions: r.cart_sessions,
    abandonedCartSessions: r.abandoned_cart_sessions,
    cartAbandonmentRate: ratio(r.abandoned_cart_sessions, r.cart_sessions),
  };
}

/** New vs returning, repeat purchase rate, and period-over-period retention. Store-wide. */
export async function customerMetrics(f: Filters, client: Queryable = pool) {
  const prev = previousWindow(f);
  const [r] = await query(
    `WITH paid AS (SELECT user_id, paid_at FROM orders WHERE paid_at IS NOT NULL AND ($3::bool OR NOT is_demo)),
     cur AS (SELECT DISTINCT user_id FROM paid WHERE paid_at >= ${WINDOW} AND paid_at < ${WINDOW_END}),
     prev AS (SELECT DISTINCT user_id FROM paid
              WHERE paid_at >= (($4::date)::timestamp AT TIME ZONE '${TZ}') AND paid_at < ${WINDOW}),
     firsts AS (SELECT user_id, min(paid_at) AS first_paid FROM paid GROUP BY user_id),
     lifetime AS (SELECT user_id, count(*) AS n FROM paid WHERE paid_at < ${WINDOW_END} GROUP BY user_id)
     SELECT (SELECT count(*) FROM cur)::int AS purchasers,
            (SELECT count(*) FROM cur JOIN firsts USING (user_id) WHERE first_paid >= ${WINDOW})::int AS new_customers,
            (SELECT count(*) FROM cur JOIN lifetime USING (user_id) WHERE n >= 2)::int AS repeat_customers,
            (SELECT count(*) FROM prev)::int AS prev_purchasers,
            (SELECT count(*) FROM prev JOIN cur USING (user_id))::int AS retained`,
    [...params(f).slice(0, 3), prev.from],
    client,
  );
  return {
    purchasers: r.purchasers,
    newCustomers: r.new_customers,
    returningCustomers: r.purchasers - r.new_customers,
    repeatPurchaseRate: ratio(r.repeat_customers, r.purchasers),
    previousPeriodPurchasers: r.prev_purchasers,
    retainedCustomers: r.retained,
    retentionRate: ratio(r.retained, r.prev_purchasers),
  };
}

export async function trend(f: Filters, client: Queryable = pool) {
  const g = f.granularity;
  const rows = await query(
    `WITH ${LINES_CTE},
     b AS (
       SELECT date_trunc('${g}', paid_at AT TIME ZONE '${TZ}')::date AS bucket, sum(gross) AS gmv, sum(net) AS net,
              count(DISTINCT order_id) AS orders, sum(quantity) AS units
       FROM lv GROUP BY 1
     ),
     series AS (
       SELECT generate_series(date_trunc('${g}', $1::date::timestamp), date_trunc('${g}', $2::date::timestamp), interval '1 ${g}')::date AS bucket
     )
     SELECT to_char(series.bucket, 'YYYY-MM-DD') AS bucket, coalesce(b.gmv, 0) AS gmv, coalesce(b.net, 0) AS net,
            coalesce(b.orders, 0)::int AS orders, coalesce(b.units, 0)::int AS units
     FROM series LEFT JOIN b USING (bucket) ORDER BY series.bucket`,
    params(f),
    client,
  );
  // Sessions per bucket for a conversion trend.
  const sess = await query(
    `SELECT to_char(date_trunc('${g}', s.started_at AT TIME ZONE '${TZ}'), 'YYYY-MM-DD') AS bucket, count(*)::int AS sessions,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM orders o WHERE o.analytics_session_id = s.id AND o.paid_at IS NOT NULL))::int AS converting
     FROM analytics_sessions s WHERE s.started_at >= ${WINDOW} AND s.started_at < ${WINDOW_END} AND ($3::bool OR NOT s.is_demo)
     GROUP BY 1`,
    params(f).slice(0, 3),
    client,
  );
  const sMap = new Map(sess.map((s) => [s.bucket, s]));
  return rows.map((r) => {
    const s = sMap.get(r.bucket);
    return {
      bucket: r.bucket,
      gmvPaise: round(r.gmv),
      netSalesPaise: round(r.net),
      orders: r.orders,
      units: r.units,
      sessions: s?.sessions ?? 0,
      conversionRate: s ? ratio(s.converting, s.sessions) : null,
    };
  });
}

export async function byCategory(f: Filters, client: Queryable = pool) {
  const rows = await query(
    `WITH ${LINES_CTE}
     SELECT category_slug AS slug, category_name AS name, sum(gross) AS gmv, sum(net) AS net, sum(discount) AS discount,
            sum(quantity)::int AS units, count(DISTINCT order_id)::int AS orders
     FROM lv GROUP BY 1, 2 ORDER BY net DESC`,
    params(f),
    client,
  );
  const total = rows.reduce((s, r) => s + Number(r.net), 0);
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    gmvPaise: round(r.gmv),
    netSalesPaise: round(r.net),
    discountsPaise: round(r.discount),
    units: r.units,
    orders: r.orders,
    shareOfNetSales: ratio(Number(r.net), total),
  }));
}

/**
 * Product performance: sales from order lines, funnel counts from events.
 * viewToOrderRate = orders containing the product / product_view events (both in window).
 */
export async function products(f: Filters, client: Queryable = pool) {
  const rows = await query(
    `WITH ${LINES_CTE},
     sales AS (SELECT product_id, sum(gross) AS gmv, sum(net) AS net, sum(quantity) AS units, count(DISTINCT order_id) AS orders FROM lv GROUP BY 1),
     ev AS (
       SELECT product_id, count(*) FILTER (WHERE event_type = 'product_view') AS views,
              count(*) FILTER (WHERE event_type = 'add_to_cart') AS carts
       FROM events WHERE product_id IS NOT NULL AND created_at >= ${WINDOW} AND created_at < ${WINDOW_END} AND ($3::bool OR NOT is_demo)
       GROUP BY 1
     ),
     stock AS (SELECT product_id, sum(stock) AS stock FROM product_variants GROUP BY 1)
     SELECT p.id, p.slug, p.title, c.slug AS category_slug, c.name AS category, p.is_active,
            coalesce(sales.gmv, 0) AS gmv, coalesce(sales.net, 0) AS net, coalesce(sales.units, 0)::int AS units,
            coalesce(sales.orders, 0)::int AS orders, coalesce(ev.views, 0)::int AS views, coalesce(ev.carts, 0)::int AS carts,
            coalesce(stock.stock, 0)::int AS stock, p.rating_avg AS rating, p.created_at
     FROM products p JOIN categories c ON c.id = p.category_id
     LEFT JOIN sales ON sales.product_id = p.id LEFT JOIN ev ON ev.product_id = p.id LEFT JOIN stock ON stock.product_id = p.id
     WHERE ($4::text IS NULL OR c.slug = $4) AND ($5::uuid IS NULL OR p.id = $5)
     ORDER BY net DESC, p.title`,
    params(f),
    client,
  );
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    categorySlug: r.category_slug,
    category: r.category,
    isActive: r.is_active,
    gmvPaise: round(r.gmv),
    netSalesPaise: round(r.net),
    units: r.units,
    orders: r.orders,
    views: r.views,
    addToCarts: r.carts,
    viewToOrderRate: ratio(r.orders, r.views),
    stock: r.stock,
    rating: Number(r.rating),
    createdAt: r.created_at,
  }));
}

/**
 * Underperformers: active products with meaningful traffic but weak conversion, or no sales at all.
 * "Meaningful traffic" = at least the median view count among products with any views (minimum 10).
 */
export function underperformers(rows: Awaited<ReturnType<typeof products>>) {
  const active = rows.filter((r) => r.isActive);
  const viewed = active.map((r) => r.views).filter((v) => v > 0).sort((a, b) => a - b);
  const median = viewed.length ? viewed[Math.floor(viewed.length / 2)] : 0;
  const minViews = Math.max(10, median);
  const rated = active.filter((r) => r.views >= minViews);
  const rates = rated.map((r) => r.viewToOrderRate ?? 0).sort((a, b) => a - b);
  const p25 = rates.length ? rates[Math.floor(rates.length * 0.25)] : 0;
  return {
    minViews,
    lowConversion: rated
      .filter((r) => (r.viewToOrderRate ?? 0) <= p25)
      .sort((a, b) => (a.viewToOrderRate ?? 0) - (b.viewToOrderRate ?? 0))
      .slice(0, 10),
    noSales: active.filter((r) => r.units === 0).slice(0, 20),
  };
}

/** Inventory with velocity: days of cover = stock / average daily units over the last 28 days (store-wide). */
export async function inventory(f: Pick<Filters, 'includeDemo' | 'category'>, client: Queryable = pool) {
  const rows = await query(
    `WITH vel AS (
       SELECT oi.variant_id, sum(oi.quantity)::numeric / 28 AS daily
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.paid_at > now() - interval '28 days' AND o.status NOT IN ('cancelled', 'refunded') AND ($1::bool OR NOT o.is_demo)
       GROUP BY 1
     )
     SELECT v.id, v.sku, v.name AS variant, p.title, p.slug, c.name AS category, v.stock, coalesce(vel.daily, 0) AS daily
     FROM product_variants v JOIN products p ON p.id = v.product_id JOIN categories c ON c.id = p.category_id
     LEFT JOIN vel ON vel.variant_id = v.id
     WHERE p.is_active AND ($2::text IS NULL OR c.slug = $2)
     ORDER BY v.stock ASC, daily DESC`,
    [f.includeDemo, f.category ?? null],
    client,
  );
  const items = rows.map((r) => ({
    variantId: r.id,
    sku: r.sku,
    variant: r.variant,
    title: r.title,
    slug: r.slug,
    category: r.category,
    stock: r.stock,
    avgDailyUnits28d: Number(Number(r.daily).toFixed(2)),
    daysOfCover: Number(r.daily) > 0 ? Math.floor(r.stock / Number(r.daily)) : null,
    status: r.stock === 0 ? 'out_of_stock' : r.stock <= env.LOW_STOCK_THRESHOLD ? 'low_stock' : 'ok',
  }));
  return {
    threshold: env.LOW_STOCK_THRESHOLD,
    totalUnits: items.reduce((s, i) => s + i.stock, 0),
    outOfStock: items.filter((i) => i.status === 'out_of_stock').length,
    lowStock: items.filter((i) => i.status === 'low_stock').length,
    items,
  };
}

export async function discounts(f: Filters, client: Queryable = pool) {
  const rows = await query(
    `WITH ${LINES_CTE},
     ord AS (SELECT order_id, discount_code, sum(gross) AS gross, sum(discount) AS discount, sum(net) AS net FROM lv GROUP BY 1, 2)
     SELECT coalesce(discount_code::text, '(none)') AS code, count(*)::int AS orders, sum(gross) AS gmv, sum(discount) AS discount,
            sum(net) AS net, avg(gross - discount) AS aov
     FROM ord GROUP BY 1 ORDER BY orders DESC`,
    params(f),
    client,
  );
  const items = rows.map((r) => ({
    code: r.code,
    orders: r.orders,
    gmvPaise: round(r.gmv),
    discountsPaise: round(r.discount),
    netSalesPaise: round(r.net),
    averageOrderValuePaise: round(r.aov),
  }));
  const withCode = items.filter((i) => i.code !== '(none)');
  const without = items.find((i) => i.code === '(none)');
  const dOrders = withCode.reduce((s, i) => s + i.orders, 0);
  const totalOrders = dOrders + (without?.orders ?? 0);
  return {
    items,
    discountedOrders: dOrders,
    discountedOrderShare: ratio(dOrders, totalOrders),
    aovWithDiscountPaise: dOrders ? round(withCode.reduce((s, i) => s + i.averageOrderValuePaise * i.orders, 0) / dOrders) : null,
    aovWithoutDiscountPaise: without?.averageOrderValuePaise ?? null,
    caveat: 'Associational only: customers who use codes may differ from those who do not (e.g. codes with minimum spend select for larger baskets).',
  };
}

export async function sources(f: Filters, client: Queryable = pool) {
  const rows = await query(
    `WITH s AS (
       SELECT id, source FROM analytics_sessions
       WHERE started_at >= ${WINDOW} AND started_at < ${WINDOW_END} AND ($3::bool OR NOT is_demo)
     ),
     o AS (
       SELECT o.analytics_session_id, ((o.total_paise - o.shipping_paise) - (SELECT coalesce(sum(refunded_paise), 0) FROM order_items WHERE order_id = o.id))::numeric AS net
       FROM orders o WHERE o.paid_at IS NOT NULL AND o.analytics_session_id IN (SELECT id FROM s)
     )
     SELECT s.source, count(DISTINCT s.id)::int AS sessions, count(DISTINCT o.analytics_session_id)::int AS converting,
            coalesce(sum(o.net), 0) AS net
     FROM s LEFT JOIN o ON o.analytics_session_id = s.id GROUP BY 1 ORDER BY sessions DESC`,
    params(f).slice(0, 3),
    client,
  );
  return rows.map((r) => ({
    source: r.source,
    sessions: r.sessions,
    convertingSessions: r.converting,
    conversionRate: ratio(r.converting, r.sessions),
    netSalesPaise: round(r.net),
  }));
}

export async function dataProvenance(client: Queryable = pool) {
  const [r] = await query(
    `SELECT (SELECT count(*) FROM orders WHERE is_demo)::int AS demo_orders, (SELECT count(*) FROM orders WHERE NOT is_demo)::int AS real_orders,
            (SELECT count(*) FROM events WHERE is_demo)::int AS demo_events, (SELECT count(*) FROM events WHERE NOT is_demo)::int AS real_events,
            (SELECT value FROM settings WHERE key = 'demo_data') AS demo_meta`,
    [],
    client,
  );
  return { demoOrders: r.demo_orders, realOrders: r.real_orders, demoEvents: r.demo_events, realEvents: r.real_events, demoMeta: r.demo_meta };
}
