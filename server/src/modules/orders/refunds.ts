/**
 * Line-level refunds. Every refund path (customer cancellation, admin full refund, approved
 * return, admin partial refund) goes through refundItems so amounts are computed one way:
 *
 *   line net value   = line total − (order discount × line total / subtotal)
 *   refunded so far  = round(line net × refunded_quantity / quantity)
 *
 * Refunding k more units moves refunded_paise to round(net × (refunded_qty + k) / qty), so a line
 * fully refunded in several steps sums to exactly its net value. Shipping is refunded only when
 * the last unit of the order is refunded, as the remainder that brings the total to total_paise.
 */
import type pg from 'pg';
import { one, query, tx } from '../../db/pool.js';
import { HttpError } from '../../lib/http.js';
import { razorpayRefund } from '../payments/provider.js';

export interface RefundLine {
  orderItemId: string;
  quantity: number;
}

export interface RefundOptions {
  lines: RefundLine[] | 'all';
  restock: boolean;
  reason: string;
  actorId?: string;
  returnRequestId?: string;
  /** Status once every unit is refunded. */
  finalStatus?: 'cancelled' | 'refunded';
  /** Allowed current statuses (defaults to any paid status). */
  allowedStatuses?: string[];
}

export async function refundItems(orderId: string, opts: RefundOptions, client?: pg.PoolClient) {
  const run = async (c: pg.PoolClient) => {
    const order = await one('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId], c);
    if (!order) throw new HttpError(404, 'Order not found', 'not_found');
    const allowed = opts.allowedStatuses ?? ['paid', 'shipped', 'delivered'];
    if (!order.paid_at || !allowed.includes(order.status)) {
      throw new HttpError(409, `Order in status "${order.status}" cannot be refunded here.`, 'invalid_status');
    }
    const items = await query(
      `SELECT id, variant_id, quantity, line_total_paise, refunded_quantity, refunded_paise FROM order_items WHERE order_id = $1 ORDER BY id FOR UPDATE`,
      [orderId],
      c,
    );
    const byId = new Map(items.map((i) => [i.id, i]));
    const wanted = new Map<string, number>();
    if (opts.lines === 'all') {
      for (const i of items) if (i.quantity > i.refunded_quantity) wanted.set(i.id, i.quantity - i.refunded_quantity);
    } else {
      for (const l of opts.lines) wanted.set(l.orderItemId, (wanted.get(l.orderItemId) ?? 0) + l.quantity);
    }
    if (!wanted.size) throw new HttpError(409, 'Nothing left to refund on this order.', 'nothing_to_refund');

    let merchandise = 0;
    const changes: { item: any; qty: number; delta: number }[] = [];
    for (const [id, qty] of wanted) {
      const item = byId.get(id);
      if (!item) throw new HttpError(400, 'Item does not belong to this order.', 'validation_error');
      if (qty <= 0 || item.refunded_quantity + qty > item.quantity) {
        throw new HttpError(409, `Only ${item.quantity - item.refunded_quantity} unit(s) of an item can still be refunded.`, 'refund_exceeds_quantity');
      }
      const net = item.line_total_paise - (order.subtotal_paise > 0 ? (order.discount_paise * item.line_total_paise) / order.subtotal_paise : 0);
      const target = Math.round((net * (item.refunded_quantity + qty)) / item.quantity);
      const delta = target - item.refunded_paise;
      merchandise += delta;
      changes.push({ item, qty, delta });
    }
    const fullAfter = items.every((i) => i.refunded_quantity + (wanted.get(i.id) ?? 0) === i.quantity);
    const shipping = fullAfter ? Math.max(0, order.total_paise - order.refunded_paise - merchandise) : 0;
    const amount = merchandise + shipping;
    if (amount <= 0) throw new HttpError(409, 'Nothing left to refund on this order.', 'nothing_to_refund');

    const payment = await one(`SELECT * FROM payments WHERE order_id = $1 AND status IN ('captured', 'refunded') ORDER BY created_at DESC LIMIT 1`, [orderId], c);
    let providerRefundId: string | null = null;
    if (payment?.provider === 'razorpay') {
      const r = (await razorpayRefund(payment.provider_payment_id, amount)) as { id?: string };
      providerRefundId = r?.id ?? null;
    }

    for (const ch of changes) {
      await c.query('UPDATE order_items SET refunded_quantity = refunded_quantity + $2, refunded_paise = refunded_paise + $3 WHERE id = $1', [ch.item.id, ch.qty, ch.delta]);
      if (opts.restock) {
        await c.query('UPDATE product_variants SET stock = stock + $2 WHERE id = $1', [ch.item.variant_id, ch.qty]);
        await c.query(`INSERT INTO inventory_adjustments(variant_id, delta, reason, order_id, actor_id) VALUES ($1, $2, 'order_released', $3, $4)`, [ch.item.variant_id, ch.qty, orderId, opts.actorId ?? null]);
      }
    }
    const status = fullAfter ? opts.finalStatus ?? 'refunded' : order.status;
    await c.query(
      `UPDATE orders SET refunded_paise = refunded_paise + $2, refunded_at = now(), status = $3,
         cancelled_at = CASE WHEN $3 = 'cancelled' THEN now() ELSE cancelled_at END WHERE id = $1`,
      [orderId, amount, status],
    );
    if (fullAfter) await c.query(`UPDATE payments SET status = 'refunded', updated_at = now() WHERE order_id = $1 AND status = 'captured'`, [orderId]);
    const refund = await one(
      `INSERT INTO refunds(order_id, amount_paise, shipping_paise, items, reason, restocked, provider_refund_id, return_request_id, actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [orderId, amount, shipping, JSON.stringify(changes.map((ch) => ({ orderItemId: ch.item.id, quantity: ch.qty, amountPaise: ch.delta }))),
        opts.reason, opts.restock, providerRefundId, opts.returnRequestId ?? null, opts.actorId ?? null],
      c,
    );
    return { refundId: refund!.id as string, amountPaise: amount, shippingPaise: shipping, fullyRefunded: fullAfter, status };
  };
  return client ? run(client) : tx(run);
}

export const RETURN_WINDOW_DAYS = 7;
/** Store policy: food and botanicals are not returnable. */
export const NON_RETURNABLE_CATEGORIES = ['natural-food', 'health-and-immunity'];
