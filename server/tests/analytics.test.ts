/**
 * Analytics calculations against a hand-computed fixture (January 2025, Asia/Kolkata).
 * Expected values are derived in comments so the definitions in docs/METRICS.md can be audited.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { one, query } from '../src/db/pool.js';
import * as A from '../src/modules/analytics/service.js';
import { admin, variantWithStock } from './helpers.js';

const F: A.Filters = { from: '2025-01-01', to: '2025-01-31', granularity: 'day', includeDemo: false };
const ADDR = JSON.stringify({ city: 'Fixture' });

async function user(email: string, demo = false) {
  return (await one(`INSERT INTO users(email, password_hash, name, is_demo) VALUES ($1, 'x', 'Fixture', $2) RETURNING id`, [email, demo]))!.id as string;
}

async function order(o: { user: string; status: string; paidAt: string | null; lines: [{ id: string; product_id: string }, number, number][]; discount?: number; code?: string; shipping?: number; refunded?: boolean; session?: string; demo?: boolean }) {
  const subtotal = o.lines.reduce((s, [, price, qty]) => s + price * qty, 0);
  const total = subtotal - (o.discount ?? 0) + (o.shipping ?? 0);
  const row = await one(
    `INSERT INTO orders(user_id, status, subtotal_paise, discount_paise, shipping_paise, total_paise, refunded_paise, discount_code, shipping_address, analytics_session_id, is_demo, created_at, paid_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, coalesce($12::timestamptz, '2025-01-26T10:00:00+05:30'), $12) RETURNING id`,
    [o.user, o.status, subtotal, o.discount ?? 0, o.shipping ?? 0, total, o.refunded ? total : 0, o.code ?? null, ADDR, o.session ?? null, o.demo ?? false, o.paidAt],
  );
  for (const [v, price, qty] of o.lines) {
    await query(
      `INSERT INTO order_items(order_id, product_id, variant_id, title, variant_name, unit_price_paise, quantity, line_total_paise, refunded_quantity, refunded_paise)
       VALUES ($1, $2, $3, 'x', 'x', $4, $5, $6, $7, $8)`,
      // Full refunds: each line refunds its value net of its share of the order discount.
      [row!.id, v.product_id, v.id, price, qty, price * qty, o.refunded ? qty : 0,
        o.refunded ? Math.round(price * qty - ((o.discount ?? 0) * price * qty) / subtotal) : 0],
    );
  }
}

async function session(id: string, startedAt: string, events: string[], productId: string) {
  await query(`INSERT INTO analytics_sessions(id, visitor_id, source, started_at, last_seen_at) VALUES ($1, $1, 'email', $2, $2)`, [id, startedAt]);
  for (const e of events) {
    await query(`INSERT INTO events(event_type, visitor_id, session_id, product_id, created_at) VALUES ($1, $2, $2, $3, $4)`, [e, id, e === 'page_view' ? null : productId, startedAt]);
  }
}

let P1: { id: string; product_id: string }, P2: { id: string; product_id: string };

beforeAll(async () => {
  P1 = await variantWithStock(10, 100000, 'yoga-store'); // ₹1,000
  P2 = await variantWithStock(10, 50000, 'books'); // ₹500
  const u1 = await user('fx1@example.test');
  const u2 = await user('fx2@example.test');
  const u3 = await user('fx3@example.test');
  const u4 = await user('fx4@example.test');
  const ud = await user('fxdemo@example.test', true);
  const ts = (d: string) => `${d}T12:00:00+05:30`;

  await session('fx-s1', ts('2025-01-10'), ['page_view', 'product_view', 'add_to_cart'], P1.product_id);
  await session('fx-s2', ts('2025-01-12'), ['product_view'], P1.product_id);
  await session('fx-s3', ts('2025-01-14'), ['product_view', 'add_to_cart'], P2.product_id); // abandoned
  await session('fx-s4', ts('2025-01-25'), ['add_to_cart'], P2.product_id);
  await session('fx-s5', ts('2025-01-28'), ['page_view'], P2.product_id);

  // Previous window (December 2024): A (u1), G (u4)
  await order({ user: u1, status: 'delivered', paidAt: ts('2024-12-15'), lines: [[P1, 100000, 1]] });
  await order({ user: u4, status: 'delivered', paidAt: ts('2024-12-20'), lines: [[P2, 50000, 1]], shipping: 7900 });
  // January
  await order({ user: u1, status: 'delivered', paidAt: ts('2025-01-10'), lines: [[P1, 100000, 1]], session: 'fx-s1' }); // B
  await order({ user: u2, status: 'delivered', paidAt: ts('2025-01-12'), lines: [[P1, 100000, 1], [P2, 50000, 2]], discount: 20000, code: 'FLAT200', session: 'fx-s2' }); // C
  await order({ user: u2, status: 'refunded', paidAt: ts('2025-01-20'), lines: [[P2, 50000, 1]], shipping: 7900, refunded: true }); // D
  await order({ user: u3, status: 'paid', paidAt: ts('2025-01-25'), lines: [[P2, 50000, 1]], shipping: 7900, session: 'fx-s4' }); // E
  await order({ user: u3, status: 'pending_payment', paidAt: null, lines: [[P1, 100000, 1]] }); // F: never paid
  await order({ user: u3, status: 'paid', paidAt: '2025-02-01T00:30:00+05:30', lines: [[P1, 100000, 1]] }); // H: 1 Feb IST (31 Jan UTC) -> excluded
  await order({ user: ud, status: 'delivered', paidAt: ts('2025-01-15'), lines: [[P1, 100000, 3]], demo: true }); // demo
});

describe('summary metrics', () => {
  it('computes GMV, discounts, refunds, net sales and order counts', async () => {
    const s = await A.summary(F);
    // GMV = B 1000 + C (1000 + 2*500) + D 500 + E 500 = ₹4,000 (excludes F unpaid, H outside window, demo)
    expect(s.gmvPaise).toBe(400000);
    expect(s.discountsPaise).toBe(20000);
    // D refunded in full: merchandise portion = 500 - 0 discount = ₹500 (shipping refund is not merchandise)
    expect(s.refundsPaise).toBe(50000);
    expect(s.netSalesPaise).toBe(330000);
    expect(s.orders).toBe(4);
    expect(s.completedOrders).toBe(2);
    expect(s.cancelledOrRefundedOrders).toBe(1);
    // AOV = (GMV - discounts) / orders = 3800 / 4
    expect(s.averageOrderValuePaise).toBe(95000);
    expect(s.discountedOrderShare).toBe(0.25);
  });

  it('computes session conversion and cart abandonment', async () => {
    const s = await A.sessionMetrics(F);
    expect(s.sessions).toBe(5);
    expect(s.convertingSessions).toBe(3); // s1 (B), s2 (C), s4 (E)
    expect(s.conversionRate).toBeCloseTo(0.6);
    expect(s.cartSessions).toBe(3); // s1, s3, s4
    expect(s.abandonedCartSessions).toBe(1); // s3
    expect(s.cartAbandonmentRate).toBeCloseTo(1 / 3);
  });

  it('computes new vs returning, repeat purchase and retention', async () => {
    const c = await A.customerMetrics(F);
    expect(c.purchasers).toBe(3);
    expect(c.newCustomers).toBe(2); // u2, u3 first paid in January
    expect(c.returningCustomers).toBe(1); // u1
    expect(c.repeatPurchaseRate).toBeCloseTo(2 / 3); // u1 (A,B), u2 (C,D)
    expect(c.previousPeriodPurchasers).toBe(2); // u1, u4
    expect(c.retainedCustomers).toBe(1);
    expect(c.retentionRate).toBe(0.5);
  });

  it('includes demo rows only when asked', async () => {
    const s = await A.summary({ ...F, includeDemo: true });
    expect(s.gmvPaise).toBe(400000 + 300000);
    expect(s.orders).toBe(5);
  });
});

describe('breakdowns', () => {
  it('allocates discounts and refunds to categories so they sum to the total', async () => {
    const cats = await A.byCategory(F);
    const by = Object.fromEntries(cats.map((c) => [c.slug, c]));
    // yoga-store: B 1000 + C 1000 (discount share 200*1000/2000 = 100)
    expect(by['yoga-store']).toMatchObject({ gmvPaise: 200000, discountsPaise: 10000, netSalesPaise: 190000, units: 2, orders: 2 });
    // books: C 1000 (discount 100) + D 500 (refunded) + E 500
    expect(by.books).toMatchObject({ gmvPaise: 200000, discountsPaise: 10000, netSalesPaise: 140000, units: 4, orders: 3 });
    expect(cats.reduce((s, c) => s + c.netSalesPaise, 0)).toBe(330000);
  });

  it('filters by category and product', async () => {
    const yoga = await A.summary({ ...F, category: 'yoga-store' });
    expect(yoga).toMatchObject({ gmvPaise: 200000, netSalesPaise: 190000, orders: 2 });
    const p2 = await A.summary({ ...F, productId: P2.product_id });
    expect(p2).toMatchObject({ gmvPaise: 200000, refundsPaise: 50000, orders: 3 });
  });

  it('builds a gap-filled daily trend and a monthly roll-up', async () => {
    const daily = await A.trend(F);
    expect(daily).toHaveLength(31);
    const d = Object.fromEntries(daily.map((r) => [r.bucket, r]));
    expect(d['2025-01-10']).toMatchObject({ gmvPaise: 100000, netSalesPaise: 100000, orders: 1, sessions: 1, conversionRate: 1 });
    expect(d['2025-01-20']).toMatchObject({ gmvPaise: 50000, netSalesPaise: 0, orders: 1 });
    expect(d['2025-01-02']).toMatchObject({ gmvPaise: 0, orders: 0, conversionRate: null });
    expect(daily.reduce((s, r) => s + r.netSalesPaise, 0)).toBe(330000);
    const monthly = await A.trend({ ...F, granularity: 'month' });
    expect(monthly).toEqual([expect.objectContaining({ bucket: '2025-01-01', gmvPaise: 400000, orders: 4 })]);
  });

  it('reports discount usage per code', async () => {
    const d = await A.discounts(F);
    const flat = d.items.find((i) => i.code === 'FLAT200')!;
    expect(flat).toMatchObject({ orders: 1, discountsPaise: 20000, averageOrderValuePaise: 180000 });
    expect(d.aovWithoutDiscountPaise).toBe(Math.round((100000 + 50000 + 50000) / 3));
  });

  it('reports product views and view-to-order rate', async () => {
    const rows = await A.products(F);
    const p1 = rows.find((r) => r.id === P1.product_id)!;
    expect(p1).toMatchObject({ units: 2, orders: 2, views: 2, addToCarts: 1, viewToOrderRate: 1 });
  });

  it('computes previous windows of equal length', () => {
    expect(A.previousWindow(F)).toMatchObject({ from: '2024-12-01', to: '2024-12-31' });
    expect(A.previousWindow({ ...F, from: '2025-03-01', to: '2025-03-07' })).toMatchObject({ from: '2025-02-22', to: '2025-02-28' });
  });
});

describe('analytics API', () => {
  it('serves the overview and CSV exports to admins', async () => {
    const a = await admin();
    const res = await a.get('/api/admin/analytics/overview?from=2025-01-01&to=2025-01-31&includeDemo=false');
    expect(res.status).toBe(200);
    expect(res.body.summary.netSalesPaise).toBe(330000);
    expect(Array.isArray(res.body.insights)).toBe(true);
    const csv = await a.get('/api/admin/analytics/export/categories.csv?from=2025-01-01&to=2025-01-31&includeDemo=false');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toMatch(/^# categories 2025-01-01\.\.2025-01-31/);
    expect(csv.text).toMatch(/yoga-store/);
    expect((await a.get('/api/admin/analytics/overview?from=2025-02-01&to=2025-01-01')).status).toBe(400);
    expect((await a.get('/api/admin/analytics/export/secrets.csv')).status).toBe(404);
  });
});
