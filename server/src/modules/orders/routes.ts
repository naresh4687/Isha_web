import express, { Router } from 'express';
import { z } from 'zod';
import { one, query, tx } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { asyncHandler, cleanText, HttpError, notFound, parse } from '../../lib/http.js';
import { requireAuth, SESSION_COOKIE } from '../../middleware/auth.js';
import { providerStatus, verifyCheckoutSignature, verifyWebhookSignature } from '../payments/provider.js';
import { cancelOrder, createCheckout, markPaid, markPaymentFailed, ORDER_COLUMNS, orderWithItems } from './service.js';

export const ordersRouter = Router();

export const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
  'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
] as const;

const text = (min: number, max: number) => z.string().transform(cleanText).pipe(z.string().min(min).max(max));

export const addressSchema = z.object({
  fullName: text(2, 80),
  phone: z
    .string()
    .transform((s) => s.replace(/[\s-]/g, '').replace(/^(\+91|0)/, ''))
    .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number')),
  line1: text(3, 120),
  line2: text(0, 120).optional(),
  city: text(2, 60),
  state: z.enum(INDIAN_STATES, { errorMap: () => ({ message: 'Select a state or union territory' }) }),
  postalCode: z.string().trim().regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit PIN code'),
  country: z.literal('IN').default('IN'),
});

const checkoutSchema = z.object({
  address: addressSchema,
  discountCode: z.string().trim().max(40).optional().transform((v) => v || undefined),
  saveAddress: z.boolean().optional().default(false),
});

ordersRouter.get('/checkout/config', (_req, res) => {
  const s = providerStatus();
  res.json({
    payments: { provider: s.provider, available: s.available, testMode: s.testMode, message: s.message },
    states: INDIAN_STATES,
    freeShippingThresholdPaise: env.FREE_SHIPPING_THRESHOLD_PAISE,
    shippingFeePaise: env.SHIPPING_FEE_PAISE,
  });
});

ordersRouter.post(
  '/checkout',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parse(checkoutSchema, req.body);
    const sessionId = req.analyticsConsent ? (req.cookies?.[SESSION_COOKIE] ?? null) : null;
    const result = await createCheckout({
      userId: req.user!.id,
      visitorId: req.visitorId,
      address: body.address,
      discountCode: body.discountCode,
      analyticsSessionId: sessionId,
    });
    if (body.saveAddress) {
      const a = body.address;
      await query(
        `INSERT INTO addresses(user_id, full_name, phone, line1, line2, city, state, postal_code, is_default)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOT EXISTS (SELECT 1 FROM addresses WHERE user_id = $1))`,
        [req.user!.id, a.fullName, a.phone, a.line1, a.line2 ?? null, a.city, a.state, a.postalCode],
      );
    }
    res.status(201).json(result);
  }),
);

ordersRouter.get(
  '/addresses',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT id, full_name AS "fullName", phone, line1, line2, city, state, postal_code AS "postalCode", country, is_default AS "isDefault"
       FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC`,
      [req.user!.id],
    );
    res.json({ addresses: rows });
  }),
);

const pageSchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(10) });

ordersRouter.get(
  '/orders',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { page, pageSize } = parse(pageSchema, req.query);
    const [{ total }] = await query(`SELECT count(*)::int AS total FROM orders WHERE user_id = $1 AND status <> 'pending_payment'`, [req.user!.id]);
    const rows = await query(
      `SELECT ${ORDER_COLUMNS}, (SELECT count(*)::int FROM order_items WHERE order_id = o.id) AS "itemCount"
       FROM orders o WHERE o.user_id = $1 AND o.status <> 'pending_payment' ORDER BY o.created_at DESC LIMIT $2 OFFSET $3`,
      [req.user!.id, pageSize, (page - 1) * pageSize],
    );
    res.json({ items: rows, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  }),
);

ordersRouter.get(
  '/orders/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const order = await orderWithItems(id);
    if (!order || (order.userId !== req.user!.id && req.user!.role !== 'admin')) throw notFound('Order not found');
    const { adminNote: _n, userId: _u, ...safe } = order;
    res.json({ order: req.user!.role === 'admin' ? order : safe });
  }),
);

ordersRouter.post(
  '/orders/:id/cancel',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    await cancelOrder(id, { userId: req.user!.id, isAdmin: req.user!.role === 'admin' });
    res.json({ order: await orderWithItems(id) });
  }),
);

const returnSchema = z.object({
  items: z.array(z.object({ orderItemId: z.string().uuid(), quantity: z.number().int().min(1).max(20) })).min(1).max(50),
  reason: z.string().transform(cleanText).pipe(z.string().min(10, 'Please tell us a little more (at least 10 characters)').max(500)),
});

/** Customer return request: delivered orders, within the return window, returnable categories only. */
ordersRouter.post(
  '/orders/:id/returns',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const body = parse(returnSchema, req.body);
    const order = await orderWithItems(id);
    if (!order || order.userId !== req.user!.id) throw notFound('Order not found');
    if (!order.returnWindowOpen) {
      throw new HttpError(409, 'This order is outside the return window (7 days from delivery) or not yet delivered.', 'return_window_closed');
    }
    await tx(async (c) => {
      // Serialise concurrent requests for the same order.
      await c.query('SELECT 1 FROM orders WHERE id = $1 FOR UPDATE', [id]);
      const pending = await c.query(`SELECT items FROM return_requests WHERE order_id = $1 AND status = 'requested'`, [id]);
      const reserved = new Map<string, number>();
      for (const r of pending.rows) for (const it of r.items) reserved.set(it.orderItemId, (reserved.get(it.orderItemId) ?? 0) + it.quantity);
      const merged = new Map<string, number>();
      for (const it of body.items) merged.set(it.orderItemId, (merged.get(it.orderItemId) ?? 0) + it.quantity);
      for (const [itemId, qty] of merged) {
        const line = order.items.find((i: any) => i.id === itemId);
        if (!line) throw new HttpError(400, 'Item does not belong to this order.', 'validation_error');
        if (!line.returnable) throw new HttpError(409, `${line.title} cannot be returned (food and botanicals are non-returnable).`, 'not_returnable');
        const available = line.quantity - line.refundedQuantity - (reserved.get(itemId) ?? 0);
        if (qty > available) throw new HttpError(409, `You can return at most ${available} of ${line.title}.`, 'return_exceeds_quantity');
      }
      await c.query(`INSERT INTO return_requests(order_id, user_id, items, reason) VALUES ($1, $2, $3, $4)`, [
        id, req.user!.id, JSON.stringify([...merged].map(([orderItemId, quantity]) => ({ orderItemId, quantity }))), body.reason,
      ]);
    });
    const { adminNote: _n, userId: _u, ...safe } = (await orderWithItems(id))!;
    res.status(201).json({ order: safe });
  }),
);

// --- Payments ---------------------------------------------------------------

async function ownedPendingPayment(orderId: string, userId: string) {
  const row = await one(
    `SELECT o.id, o.status, o.user_id, p.provider, p.provider_order_id FROM orders o
     JOIN payments p ON p.order_id = o.id WHERE o.id = $1 ORDER BY p.created_at DESC LIMIT 1`,
    [orderId],
  );
  if (!row || row.user_id !== userId) throw notFound('Order not found');
  return row;
}

const verifySchema = z.object({
  orderId: z.string().uuid(),
  razorpayOrderId: z.string().min(1).max(64),
  razorpayPaymentId: z.string().min(1).max(64),
  razorpaySignature: z.string().regex(/^[a-f0-9]{64}$/),
});

ordersRouter.post(
  '/payments/razorpay/verify',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parse(verifySchema, req.body);
    const row = await ownedPendingPayment(body.orderId, req.user!.id);
    if (row.provider !== 'razorpay' || row.provider_order_id !== body.razorpayOrderId || !env.RAZORPAY_KEY_SECRET) {
      throw new HttpError(400, 'Payment does not match this order.', 'payment_mismatch');
    }
    if (!verifyCheckoutSignature(body.razorpayOrderId, body.razorpayPaymentId, body.razorpaySignature, env.RAZORPAY_KEY_SECRET)) {
      throw new HttpError(400, 'Payment verification failed. If money was deducted it will be reconciled automatically.', 'bad_signature');
    }
    await markPaid(body.orderId, body.razorpayPaymentId);
    res.json({ order: await orderWithItems(body.orderId) });
  }),
);

const failureSchema = z.object({ orderId: z.string().uuid(), reason: z.string().max(200).default('payment_failed') });

/** Client-reported failure/dismissal. It can only move a still-pending order to failed, never to paid. */
ordersRouter.post(
  '/payments/failure',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parse(failureSchema, req.body);
    await ownedPendingPayment(body.orderId, req.user!.id);
    await markPaymentFailed(body.orderId, cleanText(body.reason));
    res.json({ order: await orderWithItems(body.orderId) });
  }),
);

const mockSchema = z.object({ orderId: z.string().uuid(), outcome: z.enum(['success', 'failure']) });

/** Development-only payment simulator. Unavailable unless PAYMENT_PROVIDER=mock outside production. */
ordersRouter.post(
  '/payments/mock/complete',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (providerStatus().provider !== 'mock' || env.NODE_ENV === 'production') {
      throw new HttpError(404, 'Not found', 'not_found');
    }
    const body = parse(mockSchema, req.body);
    const row = await ownedPendingPayment(body.orderId, req.user!.id);
    if (row.provider !== 'mock') throw new HttpError(400, 'Not a simulated payment', 'payment_mismatch');
    if (row.status !== 'pending_payment') {
      if (['paid', 'shipped', 'delivered'].includes(row.status) && body.outcome === 'success') return res.json({ order: await orderWithItems(body.orderId) });
      throw new HttpError(409, 'This payment attempt is no longer open. Start checkout again.', 'payment_closed');
    }
    if (body.outcome === 'success') await markPaid(body.orderId, `mock_pay_${Date.now()}`);
    else await markPaymentFailed(body.orderId, 'simulated_failure');
    res.json({ order: await orderWithItems(body.orderId) });
  }),
);

/** Razorpay webhook (server-to-server). Mounted with a raw body parser so the signature covers exact bytes. */
export const webhookRouter = Router();
webhookRouter.post(
  '/payments/razorpay/webhook',
  express.raw({ type: 'application/json', limit: '256kb' }),
  asyncHandler(async (req, res) => {
    const signature = req.get('x-razorpay-signature');
    if (!env.RAZORPAY_WEBHOOK_SECRET || !signature || !Buffer.isBuffer(req.body)) {
      throw new HttpError(400, 'Invalid webhook', 'bad_webhook');
    }
    if (!verifyWebhookSignature(req.body, signature, env.RAZORPAY_WEBHOOK_SECRET)) {
      throw new HttpError(400, 'Invalid signature', 'bad_signature');
    }
    const event = JSON.parse(req.body.toString('utf8'));
    const entity = event?.payload?.payment?.entity;
    if (entity?.order_id) {
      const pay = await one(`SELECT order_id FROM payments WHERE provider = 'razorpay' AND provider_order_id = $1`, [entity.order_id]);
      if (pay) {
        if (event.event === 'payment.captured' || event.event === 'order.paid') await markPaid(pay.order_id, entity.id);
        else if (event.event === 'payment.failed') await markPaymentFailed(pay.order_id, String(entity.error_description ?? 'failed'));
      }
    }
    res.json({ ok: true });
  }),
);
