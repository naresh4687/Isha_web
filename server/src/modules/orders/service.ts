import { one, query, tx, type Queryable } from '../../db/pool.js';
import { HttpError } from '../../lib/http.js';
import { env } from '../../config/env.js';
import { cartLines, computeTotals, evaluateDiscount, getOrCreateCartId, type DiscountRow } from '../cart/service.js';
import { providerStatus, razorpayCreateOrder } from '../payments/provider.js';
import { primaryImage } from '../catalog/images.js';
import { NON_RETURNABLE_CATEGORIES, refundItems, RETURN_WINDOW_DAYS } from './refunds.js';

export const PENDING_ORDER_TTL_MIN = 30;

export interface ShippingAddress {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: 'IN';
}

async function releaseStock(c: Queryable, orderId: string) {
  const items = await query('SELECT variant_id, quantity FROM order_items WHERE order_id = $1', [orderId], c);
  for (const it of items) {
    await c.query('UPDATE product_variants SET stock = stock + $2 WHERE id = $1', [it.variant_id, it.quantity]);
    await c.query(
      `INSERT INTO inventory_adjustments(variant_id, delta, reason, order_id) VALUES ($1, $2, 'order_released', $3)`,
      [it.variant_id, it.quantity, orderId],
    );
  }
}

async function releaseDiscount(c: Queryable, code: string | null) {
  if (code) await c.query('UPDATE discount_codes SET used_count = GREATEST(used_count - 1, 0) WHERE code = $1', [code]);
}

/** Cancel stale pending orders (abandoned payment windows) and return their stock. */
export async function expirePendingOrders(userId?: string) {
  const stale = await query(
    `SELECT id FROM orders WHERE status = 'pending_payment'
       AND (created_at < now() - ($1 || ' minutes')::interval ${userId ? 'OR user_id = $2' : ''})`,
    userId ? [String(PENDING_ORDER_TTL_MIN), userId] : [String(PENDING_ORDER_TTL_MIN)],
  );
  for (const { id } of stale) {
    await tx(async (c) => {
      const o = await one(
        `UPDATE orders SET status = 'payment_failed' WHERE id = $1 AND status = 'pending_payment' RETURNING discount_code`,
        [id],
        c,
      );
      if (!o) return;
      await c.query(`UPDATE payments SET status = 'failed', failure_reason = 'expired', updated_at = now() WHERE order_id = $1 AND status = 'created'`, [id]);
      await releaseStock(c, id);
      await releaseDiscount(c, o.discount_code);
    });
  }
  return stale.length;
}

export async function createCheckout(input: {
  userId: string;
  visitorId: string;
  address: ShippingAddress;
  discountCode?: string;
  analyticsSessionId?: string | null;
}) {
  const status = providerStatus();
  if (!status.available) throw new HttpError(503, status.message ?? 'Payments unavailable', 'payments_unavailable');

  // A customer has at most one open payment attempt; starting a new one releases the old reservation.
  await expirePendingOrders(input.userId);

  const order = await tx(async (c) => {
    const cartId = await getOrCreateCartId({ userId: input.userId, visitorId: input.visitorId }, c);
    const lines = await cartLines(cartId, c, true);
    if (!lines.length) throw new HttpError(400, 'Your cart is empty.', 'empty_cart');
    const unavailable = lines.filter((l) => !l.available);
    if (unavailable.length) {
      throw new HttpError(409, 'Some items in your cart are no longer available in that quantity.', 'insufficient_stock', {
        items: unavailable.map((l) => ({ variantId: l.variantId, title: l.title, available: l.stock })),
      });
    }
    const subtotal = lines.reduce((s, l) => s + l.lineTotalPaise, 0);
    let discountPaise = 0;
    let code: string | null = null;
    if (input.discountCode) {
      const d = await one<DiscountRow>('SELECT * FROM discount_codes WHERE code = $1 FOR UPDATE', [input.discountCode], c);
      const result = evaluateDiscount(d, subtotal);
      if ('error' in result) throw new HttpError(400, result.error, 'invalid_discount');
      discountPaise = result.discountPaise;
      code = d!.code;
      await c.query('UPDATE discount_codes SET used_count = used_count + 1 WHERE code = $1', [code]);
    }
    const totals = computeTotals(lines, discountPaise);
    const source = (
      await one('SELECT source FROM analytics_sessions WHERE id = $1', [input.analyticsSessionId ?? ''], c)
    )?.source ?? null;
    const o = await one(
      `INSERT INTO orders(user_id, status, subtotal_paise, discount_paise, shipping_paise, total_paise, discount_code,
                          shipping_address, analytics_session_id, acquisition_source)
       VALUES ($1, 'pending_payment', $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, order_number AS "orderNumber", total_paise AS "totalPaise"`,
      [input.userId, totals.subtotalPaise, totals.discountPaise, totals.shippingPaise, totals.totalPaise, code,
        JSON.stringify(input.address), input.analyticsSessionId ?? null, source],
      c,
    );
    for (const l of lines) {
      await c.query(
        `INSERT INTO order_items(order_id, product_id, variant_id, title, variant_name, unit_price_paise, quantity, line_total_paise, gst_rate_bps)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [o!.id, l.productId, l.variantId, l.title, l.variantName, l.unitPricePaise, l.quantity, l.lineTotalPaise, l.gstRateBps],
      );
      // Conditional decrement: the row lock above plus this guard prevents overselling.
      const upd = await c.query('UPDATE product_variants SET stock = stock - $2 WHERE id = $1 AND stock >= $2', [l.variantId, l.quantity]);
      if (upd.rowCount !== 1) throw new HttpError(409, `${l.title} just sold out.`, 'insufficient_stock');
      await c.query(
        `INSERT INTO inventory_adjustments(variant_id, delta, reason, order_id) VALUES ($1, $2, 'order_reserved', $3)`,
        [l.variantId, -l.quantity, o!.id],
      );
    }
    return { ...o!, totals };
  });

  try {
    let providerOrderId: string;
    if (status.provider === 'razorpay') {
      providerOrderId = (await razorpayCreateOrder(order.totalPaise, `order_${order.orderNumber}`)).id;
    } else {
      providerOrderId = `mock_${order.id}`;
    }
    await query(
      `INSERT INTO payments(order_id, provider, provider_order_id, status, amount_paise) VALUES ($1, $2, $3, 'created', $4)`,
      [order.id, status.provider, providerOrderId, order.totalPaise],
    );
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      totals: order.totals,
      payment: {
        provider: status.provider,
        testMode: status.testMode,
        providerOrderId,
        keyId: status.provider === 'razorpay' ? env.RAZORPAY_KEY_ID : undefined,
        amountPaise: order.totalPaise,
        currency: 'INR',
      },
    };
  } catch (err) {
    await markPaymentFailed(order.id, 'provider_order_failed');
    throw err;
  }
}

/** Idempotently mark an order as paid after a verified provider confirmation. */
export async function markPaid(orderId: string, providerPaymentId: string) {
  return tx(async (c) => {
    const o = await one('SELECT id, user_id, status FROM orders WHERE id = $1 FOR UPDATE', [orderId], c);
    if (!o) throw new HttpError(404, 'Order not found', 'not_found');
    if (['paid', 'shipped', 'delivered'].includes(o.status)) return { alreadyPaid: true };
    if (o.status === 'payment_failed') {
      // Money arrived after the reservation lapsed: re-reserve if possible, otherwise flag for staff.
      const items = await query('SELECT variant_id, quantity FROM order_items WHERE order_id = $1', [orderId], c);
      let short = false;
      for (const it of items) {
        const upd = await c.query('UPDATE product_variants SET stock = stock - $2 WHERE id = $1 AND stock >= $2', [it.variant_id, it.quantity]);
        if (upd.rowCount !== 1) short = true;
      }
      if (short) await c.query(`UPDATE orders SET admin_note = 'Paid after reservation expired; stock insufficient - review manually.' WHERE id = $1`, [orderId]);
    } else if (o.status !== 'pending_payment') {
      await c.query(`UPDATE orders SET admin_note = $2 WHERE id = $1`, [orderId, `Payment captured while order was ${o.status}; refund may be required.`]);
      return { alreadyPaid: false, flagged: true };
    }
    await c.query(`UPDATE orders SET status = 'paid', paid_at = now() WHERE id = $1`, [orderId]);
    await c.query(
      `UPDATE payments SET status = 'captured', provider_payment_id = $2, updated_at = now() WHERE order_id = $1`,
      [orderId, providerPaymentId],
    );
    // Clear only the purchased lines from the cart; anything added meanwhile stays.
    await c.query(
      `DELETE FROM cart_items ci USING carts ct, order_items oi
       WHERE ci.cart_id = ct.id AND ct.user_id = $2 AND oi.order_id = $1 AND oi.variant_id = ci.variant_id`,
      [orderId, o.user_id],
    );
    return { alreadyPaid: false };
  });
}

export async function markPaymentFailed(orderId: string, reason: string) {
  return tx(async (c) => {
    const o = await one(
      `UPDATE orders SET status = 'payment_failed' WHERE id = $1 AND status = 'pending_payment' RETURNING discount_code`,
      [orderId],
      c,
    );
    if (!o) return false;
    await c.query(
      `UPDATE payments SET status = 'failed', failure_reason = $2, updated_at = now() WHERE order_id = $1 AND status = 'created'`,
      [orderId, reason.slice(0, 200)],
    );
    await releaseStock(c, orderId);
    await releaseDiscount(c, o.discount_code);
    return true;
  });
}

/** Cancel before shipment. Paid orders are refunded in full through the provider. */
export async function cancelOrder(orderId: string, actor: { userId: string; isAdmin: boolean }) {
  const order = await one('SELECT * FROM orders WHERE id = $1', [orderId]);
  if (!order || (!actor.isAdmin && order.user_id !== actor.userId)) throw new HttpError(404, 'Order not found', 'not_found');
  if (!['pending_payment', 'paid'].includes(order.status)) {
    throw new HttpError(409, 'This order can no longer be cancelled. Please contact support for a return.', 'not_cancellable');
  }
  if (order.status === 'pending_payment') {
    await markPaymentFailed(orderId, 'cancelled_by_customer');
    await query(`UPDATE orders SET status = 'cancelled', cancelled_at = now() WHERE id = $1`, [orderId]);
    return;
  }
  await refundItems(orderId, {
    lines: 'all',
    restock: true,
    reason: actor.isAdmin ? 'cancelled_by_admin' : 'cancelled_by_customer',
    actorId: actor.userId,
    finalStatus: 'cancelled',
    allowedStatuses: ['paid'],
  });
}

/** Admin refund of everything not yet refunded on a shipped/delivered order. */
export async function refundOrder(orderId: string, restock: boolean, actorId?: string) {
  await refundItems(orderId, { lines: 'all', restock, reason: 'admin_full_refund', actorId, finalStatus: 'refunded', allowedStatuses: ['shipped', 'delivered'] });
}

export const ORDER_COLUMNS = `o.id, o.order_number AS "orderNumber", o.status, o.subtotal_paise AS "subtotalPaise",
  o.discount_paise AS "discountPaise", o.shipping_paise AS "shippingPaise", o.total_paise AS "totalPaise",
  o.refunded_paise AS "refundedPaise", o.discount_code AS "discountCode", o.shipping_address AS "shippingAddress",
  o.created_at AS "createdAt", o.paid_at AS "paidAt", o.shipped_at AS "shippedAt", o.delivered_at AS "deliveredAt",
  o.cancelled_at AS "cancelledAt", o.refunded_at AS "refundedAt"`;

export async function orderWithItems(orderId: string) {
  const order = await one(`SELECT ${ORDER_COLUMNS}, o.user_id AS "userId", o.admin_note AS "adminNote" FROM orders o WHERE o.id = $1`, [orderId]);
  if (!order) return null;
  const items = await query(
    `SELECT oi.id, oi.product_id AS "productId", p.slug, p.images, oi.title, oi.variant_name AS "variantName",
            oi.unit_price_paise AS "unitPricePaise", oi.quantity, oi.line_total_paise AS "lineTotalPaise",
            oi.refunded_quantity AS "refundedQuantity", oi.refunded_paise AS "refundedPaise", oi.gst_rate_bps AS "gstRateBps",
            NOT (c.slug = ANY($2)) AS "returnable"
     FROM order_items oi JOIN products p ON p.id = oi.product_id JOIN categories c ON c.id = p.category_id
     WHERE oi.order_id = $1 ORDER BY oi.id`,
    [orderId, NON_RETURNABLE_CATEGORIES],
  );
  const payment = await one(
    `SELECT provider, status, failure_reason AS "failureReason" FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [orderId],
  );
  return {
    ...order,
    items: items.map(({ images, ...i }) => ({ ...i, ...primaryImage(i.slug, i.title, images) })),
    payment,
    cancellable: ['pending_payment', 'paid'].includes(order.status),
    ...(await returnInfo(order)),
    tax: taxBreakdown(order, items),
  };
}

/**
 * GST contained in tax-inclusive prices, on each line's value after its share of the order discount.
 * Shipping is excluded. Returns null unless every line has a configured rate.
 */
export function taxBreakdown(
  order: { subtotalPaise: number; discountPaise: number; shippingAddress: { state?: string } },
  items: { lineTotalPaise: number; gstRateBps: number | null }[],
  sellerState = env.SELLER_STATE,
) {
  if (!items.length || items.some((i) => i.gstRateBps == null)) return null;
  const byRate = new Map<number, { inclusivePaise: number; taxablePaise: number; taxPaise: number }>();
  for (const i of items) {
    const net = Math.round(i.lineTotalPaise - (order.subtotalPaise > 0 ? (order.discountPaise * i.lineTotalPaise) / order.subtotalPaise : 0));
    const taxable = Math.round((net * 10000) / (10000 + i.gstRateBps!));
    const r = byRate.get(i.gstRateBps!) ?? { inclusivePaise: 0, taxablePaise: 0, taxPaise: 0 };
    r.inclusivePaise += net;
    r.taxablePaise += taxable;
    r.taxPaise += net - taxable;
    byRate.set(i.gstRateBps!, r);
  }
  const rows = [...byRate].sort(([a], [b]) => a - b).map(([rateBps, r]) => ({ rateBps, ...r }));
  const taxPaise = rows.reduce((s, r) => s + r.taxPaise, 0);
  const intraState = sellerState ? sellerState === order.shippingAddress?.state : null;
  return {
    rows,
    taxablePaise: rows.reduce((s, r) => s + r.taxablePaise, 0),
    taxPaise,
    split: intraState === null ? null : intraState
      ? { type: 'CGST+SGST' as const, cgstPaise: Math.floor(taxPaise / 2), sgstPaise: taxPaise - Math.floor(taxPaise / 2) }
      : { type: 'IGST' as const, igstPaise: taxPaise },
    note: 'GST included in prices, on merchandise after discounts; shipping excluded. Summary only, not a GST tax invoice.',
  };
}

async function returnInfo(order: any) {
  const requests = await query(
    `SELECT id, items, reason, status, admin_note AS "adminNote", created_at AS "createdAt", resolved_at AS "resolvedAt"
     FROM return_requests WHERE order_id = $1 ORDER BY created_at DESC`,
    [order.id],
  );
  const deadline = order.deliveredAt ? new Date(new Date(order.deliveredAt).getTime() + RETURN_WINDOW_DAYS * 86_400_000) : null;
  return {
    returns: requests,
    returnDeadline: deadline?.toISOString() ?? null,
    returnWindowOpen: order.status === 'delivered' && deadline !== null && deadline > new Date(),
  };
}
