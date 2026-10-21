/**
 * Synthetic demo dataset: customers, sessions, behavioural events, orders, payments, reviews.
 * Every row is flagged is_demo = true and the dashboard labels it as demo data.
 *
 * The generator has explicit latent structure so that models have something real to learn
 * (and so evaluation numbers measure that structure, not real shopper behaviour):
 *  - each customer prefers 1–2 categories,
 *  - products have a latent appeal (Zipf-like) inside each category,
 *  - a few "complement" groups are often bought together,
 *  - traffic grows over time and peaks on weekends.
 *
 * Usage: npm run seed:demo [-- --reset] [-- --days=180 --customers=1500 --anonymous=6000]
 */
import crypto from 'node:crypto';
import { pool, tx } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { seedCatalog } from './seed.js';
import { makeRng, type Rng } from './rng.js';

interface P {
  id: string;
  slug: string;
  category: string;
  createdAt: Date;
  variants: { id: string; name: string; price: number }[];
  title: string;
  appeal: number;
}

const COMPLEMENTS: string[][] = [
  ['handwoven-cotton-yoga-mat', 'cork-yoga-block', 'cotton-yoga-strap-with-metal-buckle', 'jute-mat-carry-bag'],
  ['hand-cast-brass-oil-lamp', 'cotton-wicks-long-format', 'pure-camphor-tablets'],
  ['clay-diya-set-of-twelve', 'cotton-wicks-long-format'],
  ['foxtail-millet-unpolished', 'desi-cow-ghee-bilona-method', 'the-millet-kitchen'],
  ['buckwheat-meditation-cushion', 'lavender-eye-pillow', 'breath-and-stillness-journal'],
  ['five-faced-rudraksha-mala-108-beads', 'mala-care-oil-sesame-base', 'travel-pouch-for-malas'],
  ['neem-and-turmeric-cold-process-soap', 'reetha-shikakai-hair-wash-powder', 'herbal-hair-oil-coconut-base'],
  ['tulsi-green-tea-loose-leaf', 'raw-forest-honey'],
];

const SOURCES = ['direct', 'organic_search', 'social', 'email', 'referral', 'paid_search'];
const SOURCE_W = [30, 28, 16, 10, 6, 10];
const SOURCE_CONV = { direct: 1.1, organic_search: 1, social: 0.6, email: 1.5, referral: 1.2, paid_search: 0.8 } as Record<string, number>;
const DEVICES = ['mobile', 'desktop', 'tablet'] as const;
const FIRST = ['Aarav', 'Diya', 'Ishaan', 'Meera', 'Kabir', 'Ananya', 'Rohan', 'Saanvi', 'Vikram', 'Lakshmi', 'Arjun', 'Kavya', 'Nikhil', 'Priya', 'Rahul', 'Sneha', 'Tara', 'Dev', 'Asha', 'Manav'];
const LAST = ['Sharma', 'Iyer', 'Reddy', 'Nair', 'Patel', 'Menon', 'Gupta', 'Rao', 'Das', 'Singh', 'Kulkarni', 'Pillai'];
const CITIES: [string, string, string][] = [
  ['Bengaluru', 'Karnataka', '560001'], ['Chennai', 'Tamil Nadu', '600001'], ['Mumbai', 'Maharashtra', '400001'],
  ['Pune', 'Maharashtra', '411001'], ['Hyderabad', 'Telangana', '500001'], ['Delhi', 'Delhi', '110001'],
  ['Kochi', 'Kerala', '682001'], ['Coimbatore', 'Tamil Nadu', '641001'], ['Kolkata', 'West Bengal', '700001'],
];

const DAY = 86_400_000;

function args() {
  const a = Object.fromEntries(
    process.argv.slice(2).map((s) => {
      const [k, v] = s.replace(/^--/, '').split('=');
      return [k, v ?? 'true'];
    }),
  );
  return {
    reset: a.reset === 'true',
    days: Number(a.days ?? 180),
    customers: Number(a.customers ?? 1500),
    anonymous: Number(a.anonymous ?? 6000),
    seed: Number(a.seed ?? 7),
  };
}

async function insertMany(client: any, table: string, cols: string[], rows: unknown[][]) {
  const chunk = Math.floor(30000 / cols.length);
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const params: unknown[] = [];
    const values = part
      .map((r) => `(${r.map((v) => (params.push(v), `$${params.length}`)).join(',')})`)
      .join(',');
    await client.query(`INSERT INTO ${table}(${cols.join(',')}) VALUES ${values}`, params);
  }
}

export async function resetDemo(client: any = pool) {
  await client.query('DELETE FROM events WHERE is_demo');
  await client.query('DELETE FROM reviews WHERE is_demo');
  await client.query('DELETE FROM orders WHERE is_demo');
  await client.query('DELETE FROM analytics_sessions WHERE is_demo');
  await client.query('DELETE FROM carts WHERE user_id IN (SELECT id FROM users WHERE is_demo)');
  await client.query('DELETE FROM users WHERE is_demo');
  await client.query(`UPDATE products SET rating_avg = 0, rating_count = 0`);
}

export async function generateDemo(opts = args()) {
  const rng = makeRng(opts.seed);
  const now = Date.now();
  const start = now - opts.days * DAY;

  const productRows = (
    await pool.query(`
      SELECT p.id, p.slug, p.title, c.slug AS category, p.created_at,
             json_agg(json_build_object('id', v.id, 'name', v.name, 'price', v.price_paise) ORDER BY v.sort_order) AS variants
      FROM products p JOIN categories c ON c.id = p.category_id
      JOIN product_variants v ON v.product_id = p.id
      WHERE p.is_active GROUP BY p.id, c.slug ORDER BY p.slug`)
  ).rows;
  const products: P[] = productRows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    category: r.category,
    createdAt: new Date(r.created_at),
    variants: r.variants,
    appeal: 0,
  }));
  const byCat = new Map<string, P[]>();
  for (const p of products) byCat.set(p.category, [...(byCat.get(p.category) ?? []), p]);
  // Zipf-like appeal within each category, in a shuffled order.
  for (const list of byCat.values()) {
    const order = [...list].sort(() => rng.next() - 0.5);
    order.forEach((p, i) => (p.appeal = 1 / Math.pow(i + 1, 0.9)));
  }
  const bySlug = new Map(products.map((p) => [p.slug, p]));
  const complementsOf = new Map<string, P[]>();
  for (const group of COMPLEMENTS) {
    for (const s of group) {
      const others = group.filter((x) => x !== s).map((x) => bySlug.get(x)).filter(Boolean) as P[];
      complementsOf.set(s, [...(complementsOf.get(s) ?? []), ...others]);
    }
  }
  const cats = [...byCat.keys()];
  const catW = cats.map((c) => ({ 'yoga-store': 18, 'natural-food': 20, rudraksha: 12, 'body-care': 14, clothing: 12, 'health-and-immunity': 10, 'home-decor': 9, 'consecrated-products': 10, books: 6 })[c] ?? 8);

  const quality = new Map(products.map((p) => [p.id, 3.6 + rng.next() * 1.3]));

  // Time sampler with growth trend (+80% over the window) and weekend uplift.
  const sampleTime = (from = start, to = now) => {
    for (;;) {
      const t = from + rng.next() * (to - from);
      const growth = 0.55 + 0.45 * ((t - start) / (now - start));
      const dow = new Date(t).getDay();
      const weekend = dow === 0 || dow === 6 ? 1.3 : 1;
      if (rng.next() < (growth * weekend) / 1.3) return t;
    }
  };

  const pickProduct = (prefs: string[], seen: Set<string>, at: number): P => {
    for (let tries = 0; tries < 20; tries++) {
      const cat = rng.chance(0.78) ? rng.pick(prefs) : rng.weighted(cats, catW);
      const list = byCat.get(cat)!.filter((p) => p.createdAt.getTime() < at);
      if (!list.length) continue;
      const p = rng.weighted(list, list.map((x) => x.appeal));
      if (!seen.has(p.id) || tries > 10) return p;
    }
    return rng.pick(products);
  };

  const users: unknown[][] = [];
  const sessions: unknown[][] = [];
  const events: unknown[][] = [];
  const orders: unknown[][] = [];
  const items: unknown[][] = [];
  const payments: unknown[][] = [];
  const reviews: unknown[][] = [];
  const reviewed = new Set<string>();
  let orderSeq = 0;

  const ev = (type: string, visitor: string, session: string, user: string | null, product: string | null, t: number, extra: { quantity?: number; metadata?: object } = {}) =>
    events.push([type, visitor, session, user, product, extra.quantity ?? null, JSON.stringify(extra.metadata ?? {}), true, new Date(t)]);

  const simulateSession = (u: { id: string | null; visitor: string; prefs: string[]; source: string; buyer: number; name?: string; city?: [string, string, string] }, sessionStart: number, ordinal: number) => {
    const sid = `demo-s-${sessions.length}`;
    const device = rng.weighted(DEVICES, [58, 34, 8]);
    sessions.push([sid, u.visitor, u.id, u.source, null, null, '/', device, true, new Date(sessionStart), new Date(sessionStart)]);
    let t = sessionStart;
    ev('page_view', u.visitor, sid, u.id, null, t, { metadata: { path: '/' } });
    const seen = new Set<string>();
    const cart: P[] = [];
    const nViews = rng.int(1, 7);
    for (let i = 0; i < nViews; i++) {
      t += rng.int(20, 180) * 1000;
      if (rng.chance(0.15)) ev('search', u.visitor, sid, u.id, null, t, { metadata: { q: rng.pick(['mala', 'copper', 'millet', 'mat', 'soap', 'kurta', 'tea', 'lamp']) } });
      const p = pickProduct(u.prefs, seen, t);
      seen.add(p.id);
      ev('product_view', u.visitor, sid, u.id, p.id, t);
      if (u.id && rng.chance(0.08)) ev('add_to_wishlist', u.visitor, sid, u.id, p.id, t + 5000);
      if (rng.chance(0.18 + 0.25 * p.appeal * u.buyer)) {
        cart.push(p);
        ev('add_to_cart', u.visitor, sid, u.id, p.id, t + 8000, { quantity: 1 });
        for (const comp of complementsOf.get(p.slug) ?? []) {
          if (rng.chance(0.35) && comp.createdAt.getTime() < t) {
            ev('product_view', u.visitor, sid, u.id, comp.id, t + 20000);
            if (rng.chance(0.6)) {
              cart.push(comp);
              ev('add_to_cart', u.visitor, sid, u.id, comp.id, t + 30000, { quantity: 1 });
            }
          }
        }
      }
    }
    if (cart.length && rng.chance(0.06)) {
      const removed = cart.pop()!;
      ev('remove_from_cart', u.visitor, sid, u.id, removed.id, t + 40000);
    }
    sessions[sessions.length - 1][10] = new Date(t + 60000);
    if (!cart.length || !u.id) return;
    ev('begin_checkout', u.visitor, sid, u.id, null, t + 60000);
    const pBuy = Math.min(0.85, 0.42 * (SOURCE_CONV[u.source] ?? 1) * (ordinal > 0 ? 1.2 : 1));
    if (!rng.chance(pBuy)) return;

    const paidAt = t + 120000;
    const unique = [...new Map(cart.map((p) => [p.id, p])).values()];
    let subtotal = 0;
    const orderId = crypto.randomUUID();
    for (const p of unique) {
      const v = rng.pick(p.variants);
      const qty = rng.chance(0.12) ? 2 : 1;
      subtotal += v.price * qty;
      items.push([orderId, p.id, v.id, p.title, v.name, v.price, qty, v.price * qty]);
    }
    let code: string | null = null;
    let discount = 0;
    if (rng.chance(0.22)) {
      if (subtotal >= 149900 && rng.chance(0.4)) { code = 'FLAT200'; discount = 20000; }
      else if (subtotal >= 99900 && rng.chance(0.5)) { code = 'FESTIVE15'; discount = Math.round(subtotal * 0.15); }
      else { code = 'WELCOME10'; discount = Math.round(subtotal * 0.1); }
    }
    const shipping = subtotal - discount >= 99900 ? 0 : 7900;
    const total = subtotal - discount + shipping;
    const age = (now - paidAt) / DAY;
    let status = 'delivered';
    const roll = rng.next();
    if (age < 2) status = 'paid';
    else if (age < 6) status = age > 4.2 && roll < 0.5 ? 'delivered' : 'shipped';
    if (age >= 2 && roll > 0.96) status = 'cancelled';
    else if (age >= 9 && roll > 0.93) status = 'refunded';
    const refunded = status === 'cancelled' || status === 'refunded' ? total : 0;
    const city = u.city!;
    orders.push([
      orderId, u.id, status, subtotal, discount, shipping, total, refunded, code,
      JSON.stringify({ fullName: u.name, phone: '9000000000', line1: 'Demo address', city: city[0], state: city[1], postalCode: city[2], country: 'IN' }),
      sid, u.source, true, new Date(t + 90000), new Date(paidAt),
      ['shipped', 'delivered'].includes(status) ? new Date(paidAt + DAY) : null,
      status === 'delivered' ? new Date(paidAt + 4 * DAY) : null,
      status === 'cancelled' ? new Date(paidAt + DAY / 2) : null,
      status === 'refunded' ? new Date(paidAt + 8 * DAY) : null,
    ]);
    orderSeq++;
    payments.push([orderId, 'mock', `demo_order_${orderSeq}`, `demo_pay_${orderSeq}`, status === 'refunded' || status === 'cancelled' ? 'refunded' : 'captured', total, new Date(paidAt)]);
    // Never create records dated in the future.
    if (status === 'delivered' && paidAt + 6 * DAY < now) {
      for (const p of unique) {
        const key = `${p.id}:${u.id}`;
        if (reviewed.has(key) || !rng.chance(0.18)) continue;
        reviewed.add(key);
        const q = quality.get(p.id)!;
        const rating = Math.max(1, Math.min(5, Math.round(q + (rng.next() - 0.5) * 2)));
        reviews.push([p.id, u.id, rating, rating >= 4 ? 'Lovely quality' : rating === 3 ? 'Decent' : 'Not for me', rating >= 4 ? 'Well made and as described.' : 'It was fine, but not quite what I expected.', true, true, new Date(paidAt + 6 * DAY)]);
      }
    }
  };

  for (let i = 0; i < opts.customers; i++) {
    const id = crypto.randomUUID();
    const first = rng.pick(FIRST);
    const last = rng.pick(LAST);
    const joined = sampleTime();
    const prefs = [rng.weighted(cats, catW)];
    if (rng.chance(0.5)) prefs.push(rng.weighted(cats, catW));
    const source = rng.weighted(SOURCES, SOURCE_W);
    users.push([id, `demo.${i}@example.invalid`, '!demo-account-login-disabled', `${first} ${last}`, 'customer', source, true, new Date(joined)]);
    const u = { id, visitor: `demo-v-${i}`, prefs, source, buyer: 0.5 + rng.next(), name: `${first} ${last}`, city: rng.pick(CITIES) };
    const nSessions = 1 + Math.floor(-Math.log(1 - rng.next()) * 3);
    let t = joined;
    for (let s = 0; s < nSessions && t < now; s++) {
      simulateSession({ ...u, source: s === 0 ? source : rng.chance(0.6) ? 'direct' : rng.weighted(SOURCES, SOURCE_W) }, t, s);
      t += rng.int(1, 30) * DAY * rng.next() + DAY / 4;
    }
  }
  for (let i = 0; i < opts.anonymous; i++) {
    simulateSession({ id: null, visitor: `demo-anon-${i}`, prefs: [rng.weighted(cats, catW)], source: rng.weighted(SOURCES, SOURCE_W), buyer: 0.7 }, sampleTime(), 0);
  }

  await tx(async (c) => {
    if (opts.reset) await resetDemo(c);
    await insertMany(c, 'users', ['id', 'email', 'password_hash', 'name', 'role', 'acquisition_source', 'is_demo', 'created_at'], users);
    await insertMany(c, 'analytics_sessions', ['id', 'visitor_id', 'user_id', 'source', 'medium', 'campaign', 'landing_path', 'device', 'is_demo', 'started_at', 'last_seen_at'], sessions);
    await insertMany(c, 'events', ['event_type', 'visitor_id', 'session_id', 'user_id', 'product_id', 'quantity', 'metadata', 'is_demo', 'created_at'], events);
    await insertMany(c, 'orders', ['id', 'user_id', 'status', 'subtotal_paise', 'discount_paise', 'shipping_paise', 'total_paise', 'refunded_paise', 'discount_code', 'shipping_address', 'analytics_session_id', 'acquisition_source', 'is_demo', 'created_at', 'paid_at', 'shipped_at', 'delivered_at', 'cancelled_at', 'refunded_at'], orders);
    await insertMany(c, 'order_items', ['order_id', 'product_id', 'variant_id', 'title', 'variant_name', 'unit_price_paise', 'quantity', 'line_total_paise'], items);
    // Demo cancellations/refunds are full refunds: record them per line, as the refund service does.
    await c.query(`UPDATE order_items oi SET refunded_quantity = oi.quantity,
        refunded_paise = round(oi.line_total_paise - CASE WHEN o.subtotal_paise > 0 THEN o.discount_paise::numeric * oi.line_total_paise / o.subtotal_paise ELSE 0 END)
      FROM orders o WHERE o.id = oi.order_id AND o.is_demo AND o.refunded_paise > 0 AND oi.refunded_quantity = 0`);
    await insertMany(c, 'payments', ['order_id', 'provider', 'provider_order_id', 'provider_payment_id', 'status', 'amount_paise', 'created_at'], payments);
    await insertMany(c, 'reviews', ['product_id', 'user_id', 'rating', 'title', 'body', 'verified_purchase', 'is_demo', 'created_at'], reviews);
    await c.query(`UPDATE products p SET rating_avg = s.avg, rating_count = s.n
      FROM (SELECT product_id, round(avg(rating)::numeric, 2) AS avg, count(*) AS n FROM reviews GROUP BY product_id) s
      WHERE s.product_id = p.id`);
    await c.query(`INSERT INTO settings(key, value, is_public) VALUES ('demo_data', $1, false)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify({ generatedAt: new Date().toISOString(), seed: opts.seed, days: opts.days })]);
  });
  return { users: users.length, sessions: sessions.length, events: events.length, orders: orders.length, reviews: reviews.length };
}

if (process.argv[1]?.endsWith('demo.ts')) {
  const opts = args();
  migrate(false)
    .then(seedCatalog)
    .then(async () => {
      const existing = (await pool.query('SELECT count(*)::int AS n FROM users WHERE is_demo')).rows[0].n;
      if (existing && !opts.reset) {
        console.log(`Demo data already present (${existing} demo users). Re-run with -- --reset to regenerate.`);
        return;
      }
      console.log('generated demo data (is_demo = true):', await generateDemo(opts));
    })
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
