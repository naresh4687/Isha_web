import { Router } from 'express';
import { z } from 'zod';
import { one, query, tx } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { asyncHandler, cleanText, HttpError, notFound, parse } from '../../lib/http.js';
import { requireAdmin } from '../../middleware/auth.js';
import { cancelOrder, ORDER_COLUMNS, orderWithItems, refundOrder } from '../orders/service.js';
import { refundItems } from '../orders/refunds.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

const slugify = (s: string) => s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const text = (min: number, max: number) => z.string().transform(cleanText).pipe(z.string().min(min).max(max));

const variantSchema = z.object({
  id: z.string().uuid().optional(),
  sku: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9-_]+$/),
  name: text(1, 60),
  pricePaise: z.number().int().positive().max(100_000_000),
  compareAtPaise: z.number().int().positive().nullable().optional(),
  stock: z.number().int().min(0).max(100_000).optional(),
});

const productSchema = z.object({
  title: text(3, 140),
  description: text(10, 4000),
  categorySlug: z.string().max(60),
  subcategory: text(1, 60).nullable().optional(),
  tags: z.array(text(1, 40)).max(20).default([]),
  attributes: z.record(z.string().max(40), z.string().max(200)).default({}),
  isActive: z.boolean().default(true),
  variants: z.array(variantSchema).min(1).max(20),
});

const listSchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().max(60).optional(),
  lowStock: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

adminRouter.get(
  '/products',
  asyncHandler(async (req, res) => {
    const p = parse(listSchema, req.query);
    const where = ['true'];
    const args: unknown[] = [];
    if (p.q) { args.push(`%${p.q}%`); where.push(`(p.title ILIKE $${args.length} OR v.sku ILIKE $${args.length})`); }
    if (p.category) { args.push(p.category); where.push(`c.slug = $${args.length}`); }
    if (p.lowStock === 'true') { args.push(env.LOW_STOCK_THRESHOLD); where.push(`v.stock <= $${args.length}`); }
    const base = `FROM products p JOIN categories c ON c.id = p.category_id JOIN product_variants v ON v.product_id = p.id WHERE ${where.join(' AND ')}`;
    const [{ total }] = await query(`SELECT count(DISTINCT p.id)::int AS total ${base}`, args);
    args.push(p.pageSize, (p.page - 1) * p.pageSize);
    const rows = await query(
      `SELECT p.id, p.slug, p.title, p.is_active AS "isActive", c.name AS category, p.is_demo AS "isDemo",
              json_agg(json_build_object('id', v.id, 'sku', v.sku, 'name', v.name, 'pricePaise', v.price_paise,
                'compareAtPaise', v.compare_at_paise, 'stock', v.stock) ORDER BY v.sort_order) AS variants
       ${base} GROUP BY p.id, c.name ORDER BY p.title LIMIT $${args.length - 1} OFFSET $${args.length}`,
      args,
    );
    res.json({ items: rows, page: p.page, pageSize: p.pageSize, total, totalPages: Math.max(1, Math.ceil(total / p.pageSize)), lowStockThreshold: env.LOW_STOCK_THRESHOLD });
  }),
);

adminRouter.get(
  '/products/:id',
  asyncHandler(async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const product = await one(
      `SELECT p.id, p.slug, p.title, p.description, c.slug AS "categorySlug", p.subcategory, p.tags, p.attributes, p.is_active AS "isActive"
       FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = $1`,
      [id],
    );
    if (!product) throw notFound();
    product.variants = await query(
      `SELECT id, sku, name, price_paise AS "pricePaise", compare_at_paise AS "compareAtPaise", stock FROM product_variants WHERE product_id = $1 ORDER BY sort_order`,
      [id],
    );
    res.json({ product });
  }),
);

async function categoryId(slug: string, c: any) {
  const cat = await one('SELECT id, subcategories FROM categories WHERE slug = $1', [slug], c);
  if (!cat) throw new HttpError(400, 'Unknown category', 'validation_error');
  return cat.id as number;
}

adminRouter.post(
  '/products',
  asyncHandler(async (req, res) => {
    const b = parse(productSchema, req.body);
    const id = await tx(async (c) => {
      const catId = await categoryId(b.categorySlug, c);
      let slug = slugify(b.title);
      if (await one('SELECT 1 FROM products WHERE slug = $1', [slug], c)) slug = `${slug}-${Date.now().toString(36)}`;
      const p = await one(
        `INSERT INTO products(slug, title, description, category_id, subcategory, tags, attributes, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [slug, b.title, b.description, catId, b.subcategory ?? null, b.tags, JSON.stringify(b.attributes), b.isActive],
        c,
      );
      for (const [i, v] of b.variants.entries()) {
        const vr = await one(
          `INSERT INTO product_variants(product_id, sku, name, price_paise, compare_at_paise, stock, is_default, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [p!.id, v.sku, v.name, v.pricePaise, v.compareAtPaise ?? null, v.stock ?? 0, i === 0, i],
          c,
        );
        if (v.stock) {
          await c.query(`INSERT INTO inventory_adjustments(variant_id, delta, reason, actor_id) VALUES ($1, $2, 'admin', $3)`, [vr!.id, v.stock, req.user!.id]);
        }
      }
      return p!.id;
    }).catch((err) => {
      if (err?.code === '23505') throw new HttpError(409, 'A variant with that SKU already exists.', 'duplicate_sku');
      throw err;
    });
    res.status(201).json({ id });
  }),
);

/** Updates product fields and variant prices. Stock is changed only via /inventory adjustments (audited). */
adminRouter.put(
  '/products/:id',
  asyncHandler(async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const b = parse(productSchema, req.body);
    await tx(async (c) => {
      const catId = await categoryId(b.categorySlug, c);
      const upd = await c.query(
        `UPDATE products SET title = $2, description = $3, category_id = $4, subcategory = $5, tags = $6, attributes = $7,
           is_active = $8, updated_at = now() WHERE id = $1`,
        [id, b.title, b.description, catId, b.subcategory ?? null, b.tags, JSON.stringify(b.attributes), b.isActive],
      );
      if (upd.rowCount !== 1) throw notFound();
      for (const [i, v] of b.variants.entries()) {
        if (v.id) {
          await c.query(
            `UPDATE product_variants SET sku = $3, name = $4, price_paise = $5, compare_at_paise = $6, sort_order = $7, is_default = $8
             WHERE id = $1 AND product_id = $2`,
            [v.id, id, v.sku, v.name, v.pricePaise, v.compareAtPaise ?? null, i, i === 0],
          );
        } else {
          await c.query(
            `INSERT INTO product_variants(product_id, sku, name, price_paise, compare_at_paise, stock, is_default, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [id, v.sku, v.name, v.pricePaise, v.compareAtPaise ?? null, v.stock ?? 0, i === 0, i],
          );
        }
      }
    }).catch((err) => {
      if (err?.code === '23505') throw new HttpError(409, 'A variant with that SKU already exists.', 'duplicate_sku');
      throw err;
    });
    res.json({ ok: true });
  }),
);

const adjustSchema = z.object({
  variantId: z.string().uuid(),
  delta: z.number().int().min(-100_000).max(100_000).refine((n) => n !== 0, 'delta must be non-zero'),
  reason: z.enum(['admin', 'restock']).default('admin'),
});

adminRouter.post(
  '/inventory/adjust',
  asyncHandler(async (req, res) => {
    const b = parse(adjustSchema, req.body);
    const row = await tx(async (c) => {
      const r = await one(
        'UPDATE product_variants SET stock = stock + $2 WHERE id = $1 AND stock + $2 >= 0 RETURNING id, stock',
        [b.variantId, b.delta],
        c,
      );
      if (!r) throw new HttpError(409, 'Adjustment would make stock negative or variant not found.', 'invalid_adjustment');
      await c.query(`INSERT INTO inventory_adjustments(variant_id, delta, reason, actor_id) VALUES ($1, $2, $3, $4)`, [b.variantId, b.delta, b.reason, req.user!.id]);
      return r;
    });
    res.json({ variant: row });
  }),
);

const ordersSchema = z.object({
  status: z.enum(['pending_payment', 'payment_failed', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded']).optional(),
  q: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

adminRouter.get(
  '/orders',
  asyncHandler(async (req, res) => {
    const p = parse(ordersSchema, req.query);
    const where = ['true'];
    const args: unknown[] = [];
    if (p.status) { args.push(p.status); where.push(`o.status = $${args.length}`); }
    if (p.q) { args.push(p.q); where.push(`o.order_number = $${args.length}`); }
    const w = where.join(' AND ');
    const [{ total }] = await query(`SELECT count(*)::int AS total FROM orders o WHERE ${w}`, args);
    args.push(p.pageSize, (p.page - 1) * p.pageSize);
    const rows = await query(
      `SELECT ${ORDER_COLUMNS}, u.email AS "customerEmail", o.is_demo AS "isDemo", o.admin_note AS "adminNote"
       FROM orders o JOIN users u ON u.id = o.user_id WHERE ${w} ORDER BY o.created_at DESC LIMIT $${args.length - 1} OFFSET $${args.length}`,
      args,
    );
    res.json({ items: rows, page: p.page, pageSize: p.pageSize, total, totalPages: Math.max(1, Math.ceil(total / p.pageSize)) });
  }),
);

const transitions: Record<string, string[]> = { paid: ['shipped'], shipped: ['delivered'] };
const statusSchema = z.object({ action: z.enum(['ship', 'deliver', 'cancel', 'refund']), restock: z.boolean().default(false) });

adminRouter.post(
  '/orders/:id/status',
  asyncHandler(async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const b = parse(statusSchema, req.body);
    if (b.action === 'cancel') await cancelOrder(id, { userId: req.user!.id, isAdmin: true });
    else if (b.action === 'refund') await refundOrder(id, b.restock, req.user!.id);
    else {
      const next = b.action === 'ship' ? 'shipped' : 'delivered';
      const col = next === 'shipped' ? 'shipped_at' : 'delivered_at';
      const from = Object.entries(transitions).find(([, to]) => to.includes(next))![0];
      const upd = await query(`UPDATE orders SET status = $2, ${col} = now() WHERE id = $1 AND status = $3 RETURNING id`, [id, next, from]);
      if (!upd.length) throw new HttpError(409, `Order must be ${from} to mark it ${next}.`, 'invalid_status');
    }
    res.json({ order: await orderWithItems(id) });
  }),
);

const partialRefundSchema = z.object({
  items: z.array(z.object({ orderItemId: z.string().uuid(), quantity: z.number().int().min(1).max(100) })).min(1).max(50),
  restock: z.boolean().default(false),
  reason: z.string().transform(cleanText).pipe(z.string().min(3).max(300)),
});

/** Partial refund of specific units (e.g. a damaged item) without a customer return request. */
adminRouter.post(
  '/orders/:id/refunds',
  asyncHandler(async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const b = parse(partialRefundSchema, req.body);
    const result = await refundItems(id, { lines: b.items, restock: b.restock, reason: b.reason, actorId: req.user!.id });
    res.status(201).json({ refund: result, order: await orderWithItems(id) });
  }),
);

adminRouter.get(
  '/returns',
  asyncHandler(async (req, res) => {
    const { status } = parse(z.object({ status: z.enum(['requested', 'refunded', 'rejected']).optional() }), req.query);
    const rows = await query(
      `SELECT r.id, r.order_id AS "orderId", o.order_number AS "orderNumber", u.email, r.reason, r.status, r.admin_note AS "adminNote",
              r.created_at AS "createdAt", o.delivered_at AS "deliveredAt",
              (SELECT json_agg(json_build_object('orderItemId', oi.id, 'title', oi.title, 'variantName', oi.variant_name,
                 'quantity', (x->>'quantity')::int, 'unitPricePaise', oi.unit_price_paise))
               FROM jsonb_array_elements(r.items) x JOIN order_items oi ON oi.id = (x->>'orderItemId')::uuid) AS items
       FROM return_requests r JOIN orders o ON o.id = r.order_id JOIN users u ON u.id = r.user_id
       WHERE ($1::text IS NULL OR r.status = $1) ORDER BY r.created_at DESC LIMIT 200`,
      [status ?? null],
    );
    res.json({ items: rows });
  }),
);

adminRouter.post(
  '/returns/:id/approve',
  asyncHandler(async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const { restock } = parse(z.object({ restock: z.boolean().default(true) }), req.body);
    const result = await tx(async (c) => {
      const r = await one(`SELECT * FROM return_requests WHERE id = $1 FOR UPDATE`, [id], c);
      if (!r) throw notFound('Return request not found');
      if (r.status !== 'requested') throw new HttpError(409, `Return request is already ${r.status}.`, 'invalid_status');
      const refund = await refundItems(r.order_id, { lines: r.items, restock, reason: 'customer_return', actorId: req.user!.id, returnRequestId: id }, c);
      await c.query(`UPDATE return_requests SET status = 'refunded', resolved_at = now() WHERE id = $1`, [id]);
      return refund;
    });
    res.json({ refund: result });
  }),
);

adminRouter.post(
  '/returns/:id/reject',
  asyncHandler(async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const { note } = parse(z.object({ note: z.string().transform(cleanText).pipe(z.string().min(3).max(500)) }), req.body);
    const upd = await query(`UPDATE return_requests SET status = 'rejected', admin_note = $2, resolved_at = now() WHERE id = $1 AND status = 'requested' RETURNING id`, [id, note]);
    if (!upd.length) throw new HttpError(409, 'Return request is not open.', 'invalid_status');
    res.json({ ok: true });
  }),
);

adminRouter.get(
  '/tax-rates',
  asyncHandler(async (_req, res) => {
    res.json({ items: await query(`SELECT slug, name, gst_rate_bps AS "gstRateBps" FROM categories ORDER BY sort_order`), sellerState: env.SELLER_STATE ?? null });
  }),
);

adminRouter.put(
  '/tax-rates',
  asyncHandler(async (req, res) => {
    const b = parse(z.object({ rates: z.array(z.object({ slug: z.string().max(60), gstRateBps: z.number().int().min(0).max(4000).nullable() })).min(1).max(50) }), req.body);
    await tx(async (c) => {
      for (const r of b.rates) {
        const upd = await c.query('UPDATE categories SET gst_rate_bps = $2 WHERE slug = $1', [r.slug, r.gstRateBps]);
        if (upd.rowCount !== 1) throw new HttpError(400, `Unknown category ${r.slug}`, 'validation_error');
      }
    });
    res.json({ ok: true });
  }),
);

adminRouter.get(
  '/discounts',
  asyncHandler(async (_req, res) => {
    res.json({ items: await query(`SELECT code, kind, value, min_subtotal_paise AS "minSubtotalPaise", max_uses AS "maxUses", used_count AS "usedCount", starts_at AS "startsAt", ends_at AS "endsAt", is_active AS "isActive" FROM discount_codes ORDER BY code`) });
  }),
);

const discountSchema = z
  .object({
    code: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/),
    kind: z.enum(['percent', 'fixed']),
    value: z.number().int().positive(),
    minSubtotalPaise: z.number().int().min(0).default(0),
    maxUses: z.number().int().positive().nullable().optional(),
    startsAt: z.coerce.date().nullable().optional(),
    endsAt: z.coerce.date().nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .refine((d) => d.kind !== 'percent' || d.value <= 90, { message: 'Percent discounts are capped at 90', path: ['value'] });

adminRouter.put(
  '/discounts',
  asyncHandler(async (req, res) => {
    const d = parse(discountSchema, req.body);
    await query(
      `INSERT INTO discount_codes(code, kind, value, min_subtotal_paise, max_uses, starts_at, ends_at, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (code) DO UPDATE SET kind = $2, value = $3, min_subtotal_paise = $4, max_uses = $5, starts_at = $6, ends_at = $7, is_active = $8`,
      [d.code.toUpperCase(), d.kind, d.value, d.minSubtotalPaise, d.maxUses ?? null, d.startsAt ?? null, d.endsAt ?? null, d.isActive],
    );
    res.json({ ok: true });
  }),
);

adminRouter.get(
  '/support',
  asyncHandler(async (_req, res) => {
    res.json({ items: await query(`SELECT id, name, email, subject, message, order_number AS "orderNumber", status, created_at AS "createdAt" FROM support_tickets ORDER BY created_at DESC LIMIT 200`) });
  }),
);

adminRouter.post(
  '/support/:id/close',
  asyncHandler(async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    await query(`UPDATE support_tickets SET status = 'closed' WHERE id = $1`, [id]);
    res.json({ ok: true });
  }),
);

// --- Cart recovery workflow ---------------------------------------------------
// Abandoned carts: signed-in customers with items untouched for 24h+, who opted in to marketing contact.
adminRouter.post(
  '/cart-recovery/refresh',
  asyncHandler(async (_req, res) => {
    const rows = await query(
      `INSERT INTO cart_recovery_tasks(cart_id, user_id)
       SELECT ct.id, ct.user_id FROM carts ct JOIN users u ON u.id = ct.user_id
       WHERE u.marketing_consent AND ct.updated_at < now() - interval '24 hours'
         AND EXISTS (SELECT 1 FROM cart_items ci WHERE ci.cart_id = ct.id)
       ON CONFLICT (cart_id) DO NOTHING RETURNING id`,
    );
    res.json({ created: rows.length });
  }),
);

adminRouter.get(
  '/cart-recovery',
  asyncHandler(async (_req, res) => {
    const rows = await query(
      `SELECT t.id, t.status, t.note, t.created_at AS "createdAt", u.name, u.email, ct.updated_at AS "cartUpdatedAt",
              coalesce(sum(ci.quantity * v.price_paise), 0)::int AS "cartValuePaise", count(ci.variant_id)::int AS "lineCount"
       FROM cart_recovery_tasks t JOIN users u ON u.id = t.user_id JOIN carts ct ON ct.id = t.cart_id
       LEFT JOIN cart_items ci ON ci.cart_id = ct.id LEFT JOIN product_variants v ON v.id = ci.variant_id
       GROUP BY t.id, u.id, ct.id ORDER BY t.created_at DESC LIMIT 200`,
    );
    res.json({ items: rows, note: 'Email delivery is not configured; mark tasks as contacted after reaching out manually.' });
  }),
);

adminRouter.patch(
  '/cart-recovery/:id',
  asyncHandler(async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const b = parse(z.object({ status: z.enum(['open', 'contacted', 'recovered', 'dismissed']), note: z.string().max(500).optional() }), req.body);
    await query(`UPDATE cart_recovery_tasks SET status = $2, note = coalesce($3, note), updated_at = now() WHERE id = $1`, [id, b.status, b.note ?? null]);
    res.json({ ok: true });
  }),
);
