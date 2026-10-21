import { one, query, tx, type Queryable, pool } from '../../db/pool.js';
import { HttpError } from '../../lib/http.js';
import { primaryImage } from '../catalog/images.js';
import { env } from '../../config/env.js';

export const MAX_LINE_QTY = 20;

export interface Owner {
  userId?: string;
  visitorId: string;
}

export async function getOrCreateCartId(owner: Owner, client: Queryable = pool): Promise<string> {
  if (owner.userId) {
    const row = await one(
      `INSERT INTO carts(user_id) VALUES ($1)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = carts.updated_at RETURNING id`,
      [owner.userId],
      client,
    );
    return row!.id;
  }
  const row = await one(
    `INSERT INTO carts(visitor_id) VALUES ($1)
     ON CONFLICT (visitor_id) DO UPDATE SET updated_at = carts.updated_at RETURNING id`,
    [owner.visitorId],
    client,
  );
  return row!.id;
}

export interface CartLine {
  variantId: string;
  productId: string;
  slug: string;
  title: string;
  variantName: string;
  unitPricePaise: number;
  compareAtPaise: number | null;
  quantity: number;
  lineTotalPaise: number;
  stock: number;
  available: boolean;
  image: string;
  imageAlt: string;
  imageFit: 'contain' | 'cover';
  gstRateBps: number | null;
}

export async function cartLines(cartId: string, client: Queryable = pool, lock = false): Promise<CartLine[]> {
  const rows = await query(
    `SELECT ci.variant_id AS "variantId", p.id AS "productId", p.slug, p.title, v.name AS "variantName",
            v.price_paise AS "unitPricePaise", v.compare_at_paise AS "compareAtPaise", ci.quantity,
            v.stock, p.is_active AS active, p.images, c.gst_rate_bps AS "gstRateBps"
     FROM cart_items ci JOIN product_variants v ON v.id = ci.variant_id JOIN products p ON p.id = v.product_id
     JOIN categories c ON c.id = p.category_id
     WHERE ci.cart_id = $1 ORDER BY ci.added_at ${lock ? 'FOR UPDATE OF v' : ''}`,
    [cartId],
    client,
  );
  return rows.map((r) => ({
    variantId: r.variantId,
    productId: r.productId,
    slug: r.slug,
    title: r.title,
    variantName: r.variantName,
    unitPricePaise: r.unitPricePaise,
    compareAtPaise: r.compareAtPaise,
    quantity: r.quantity,
    lineTotalPaise: r.unitPricePaise * r.quantity,
    stock: r.stock,
    available: r.active && r.stock >= r.quantity,
    ...primaryImage(r.slug, r.title, r.images),
    gstRateBps: r.gstRateBps,
  }));
}

export interface DiscountRow {
  code: string;
  kind: 'percent' | 'fixed';
  value: number;
  min_subtotal_paise: number;
  max_uses: number | null;
  used_count: number;
  starts_at: Date | null;
  ends_at: Date | null;
  is_active: boolean;
}

/** Pure validation of a discount against a subtotal. Returns discount paise or an error message. */
export function evaluateDiscount(d: DiscountRow | null, subtotalPaise: number, now = new Date()): { discountPaise: number } | { error: string } {
  if (!d || !d.is_active) return { error: 'This code is not valid.' };
  if (d.starts_at && now < d.starts_at) return { error: 'This code is not active yet.' };
  if (d.ends_at && now > d.ends_at) return { error: 'This code has expired.' };
  if (d.max_uses != null && d.used_count >= d.max_uses) return { error: 'This code has reached its usage limit.' };
  if (subtotalPaise < d.min_subtotal_paise) {
    return { error: `Add items worth ₹${Math.ceil((d.min_subtotal_paise - subtotalPaise) / 100)} more to use this code.` };
  }
  const raw = d.kind === 'percent' ? Math.round((subtotalPaise * d.value) / 100) : d.value;
  return { discountPaise: Math.min(raw, subtotalPaise) };
}

export interface Totals {
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  totalPaise: number;
  freeShippingThresholdPaise: number;
}

/** Order totals. Prices are tax-inclusive (GST included in listed price). Shipping is free at/above threshold after discount. */
export function computeTotals(lines: { unitPricePaise: number; quantity: number }[], discountPaise = 0): Totals {
  const subtotalPaise = lines.reduce((s, l) => s + l.unitPricePaise * l.quantity, 0);
  const discount = Math.min(discountPaise, subtotalPaise);
  const afterDiscount = subtotalPaise - discount;
  const shippingPaise = subtotalPaise === 0 || afterDiscount >= env.FREE_SHIPPING_THRESHOLD_PAISE ? 0 : env.SHIPPING_FEE_PAISE;
  return {
    subtotalPaise,
    discountPaise: discount,
    shippingPaise,
    totalPaise: afterDiscount + shippingPaise,
    freeShippingThresholdPaise: env.FREE_SHIPPING_THRESHOLD_PAISE,
  };
}

export async function cartSummary(owner: Owner, discountCode?: string) {
  const cartId = await getOrCreateCartId(owner);
  const lines = await cartLines(cartId);
  let discountPaise = 0;
  let discount: { code: string; error?: string } | null = null;
  if (discountCode) {
    const d = await one<DiscountRow>('SELECT * FROM discount_codes WHERE code = $1', [discountCode]);
    const subtotal = lines.reduce((s, l) => s + l.lineTotalPaise, 0);
    const result = evaluateDiscount(d, subtotal);
    if ('error' in result) discount = { code: discountCode, error: result.error };
    else {
      discountPaise = result.discountPaise;
      discount = { code: d!.code };
    }
  }
  return {
    id: cartId,
    lines,
    itemCount: lines.reduce((s, l) => s + l.quantity, 0),
    totals: computeTotals(lines, discountPaise),
    discount,
    hasUnavailable: lines.some((l) => !l.available),
  };
}

export async function setLineQuantity(owner: Owner, variantId: string, quantity: number, mode: 'set' | 'add') {
  return tx(async (c) => {
    const variant = await one(
      `SELECT v.stock, p.is_active FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1`,
      [variantId],
      c,
    );
    if (!variant || !variant.is_active) throw new HttpError(404, 'This product is no longer available.', 'not_found');
    const cartId = await getOrCreateCartId(owner, c);
    const existing = await one('SELECT quantity FROM cart_items WHERE cart_id = $1 AND variant_id = $2', [cartId, variantId], c);
    const target = mode === 'add' ? (existing?.quantity ?? 0) + quantity : quantity;
    if (target <= 0) {
      await c.query('DELETE FROM cart_items WHERE cart_id = $1 AND variant_id = $2', [cartId, variantId]);
    } else {
      if (variant.stock <= 0) throw new HttpError(409, 'This item is out of stock.', 'out_of_stock');
      const capped = Math.min(target, MAX_LINE_QTY);
      if (capped > variant.stock) {
        throw new HttpError(409, `Only ${variant.stock} left in stock.`, 'insufficient_stock', { available: variant.stock });
      }
      await c.query(
        `INSERT INTO cart_items(cart_id, variant_id, quantity) VALUES ($1, $2, $3)
         ON CONFLICT (cart_id, variant_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
        [cartId, variantId, capped],
      );
    }
    await c.query('UPDATE carts SET updated_at = now() WHERE id = $1', [cartId]);
  });
}

/** On sign-in, move a guest cart's items into the user's cart (summing quantities, capped by stock). */
export async function mergeGuestCart(visitorId: string, userId: string) {
  await tx(async (c) => {
    const guest = await one('SELECT id FROM carts WHERE visitor_id = $1 AND user_id IS NULL', [visitorId], c);
    if (!guest) return;
    const userCartId = await getOrCreateCartId({ userId, visitorId }, c);
    await c.query(
      `INSERT INTO cart_items(cart_id, variant_id, quantity, added_at)
       SELECT $2, gi.variant_id, LEAST(gi.quantity, $3, v.stock), gi.added_at
       FROM cart_items gi JOIN product_variants v ON v.id = gi.variant_id
       WHERE gi.cart_id = $1 AND v.stock > 0
       ON CONFLICT (cart_id, variant_id) DO UPDATE SET quantity = LEAST(cart_items.quantity + EXCLUDED.quantity, $3,
         (SELECT stock FROM product_variants WHERE id = EXCLUDED.variant_id))`,
      [guest.id, userCartId, MAX_LINE_QTY],
    );
    await c.query('DELETE FROM carts WHERE id = $1', [guest.id]);
  });
}
