import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { app, customer, address, variantWithStock } from './helpers.js';
import { query } from '../src/db/pool.js';
import { verifyCheckoutSignature, verifyWebhookSignature } from '../src/modules/payments/provider.js';

describe('Razorpay signature verification', () => {
  it('accepts the documented HMAC and rejects tampering', () => {
    const sig = crypto.createHmac('sha256', 'secret').update('order_1|pay_1').digest('hex');
    expect(verifyCheckoutSignature('order_1', 'pay_1', sig, 'secret')).toBe(true);
    expect(verifyCheckoutSignature('order_1', 'pay_2', sig, 'secret')).toBe(false);
    expect(verifyCheckoutSignature('order_1', 'pay_1', sig, 'other')).toBe(false);
    expect(verifyCheckoutSignature('order_1', 'pay_1', 'abc', 'secret')).toBe(false);
  });

  it('verifies webhook bodies byte-for-byte', () => {
    const body = Buffer.from('{"event":"payment.captured"}');
    const sig = crypto.createHmac('sha256', 'wh').update(body).digest('hex');
    expect(verifyWebhookSignature(body, sig, 'wh')).toBe(true);
    expect(verifyWebhookSignature(Buffer.from('{"event":"payment.captured" }'), sig, 'wh')).toBe(false);
  });
});

describe('webhook endpoint', () => {
  it('rejects unsigned and badly signed webhooks', async () => {
    expect((await request(app).post('/api/payments/razorpay/webhook').set('Content-Type', 'application/json').send('{}')).status).toBe(400);
    const res = await request(app).post('/api/payments/razorpay/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', 'deadbeef').send('{}');
    expect(res.status).toBe(400);
  });

  it('marks a razorpay order paid on a correctly signed payment.captured event', async () => {
    const u = await customer();
    const v = await variantWithStock(3);
    await u.post('/api/cart/items', { variantId: v.id });
    const co = await u.post('/api/checkout', { address });
    // Simulate an order created through Razorpay (the test env uses the mock provider for checkout).
    await query(`UPDATE payments SET provider = 'razorpay', provider_order_id = 'order_TEST123' WHERE order_id = $1`, [co.body.orderId]);
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_TEST1', order_id: 'order_TEST123' } } } });
    const sig = crypto.createHmac('sha256', 'whsec_test').update(body).digest('hex');
    const res = await request(app).post('/api/payments/razorpay/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', sig).send(body);
    expect(res.status).toBe(200);
    const [o] = await query('SELECT o.status, p.status AS pay, p.provider_payment_id FROM orders o JOIN payments p ON p.order_id = o.id WHERE o.id = $1', [co.body.orderId]);
    expect(o).toEqual({ status: 'paid', pay: 'captured', provider_payment_id: 'pay_TEST1' });
  });

  it('rejects client-side verification with an invalid signature', async () => {
    const u = await customer();
    const v = await variantWithStock(3);
    await u.post('/api/cart/items', { variantId: v.id });
    const co = await u.post('/api/checkout', { address });
    await query(`UPDATE payments SET provider = 'razorpay', provider_order_id = 'order_X' WHERE order_id = $1`, [co.body.orderId]);
    const res = await u.post('/api/payments/razorpay/verify', { orderId: co.body.orderId, razorpayOrderId: 'order_X', razorpayPaymentId: 'pay_X', razorpaySignature: 'a'.repeat(64) });
    expect(res.status).toBe(400);
    expect((await query('SELECT status FROM orders WHERE id = $1', [co.body.orderId]))[0].status).toBe('pending_payment');
  });

  it('accepts client-side verification with a valid signature', async () => {
    const u = await customer();
    const v = await variantWithStock(3);
    await u.post('/api/cart/items', { variantId: v.id });
    const co = await u.post('/api/checkout', { address });
    await query(`UPDATE payments SET provider = 'razorpay', provider_order_id = 'order_OK' WHERE order_id = $1`, [co.body.orderId]);
    const sig = crypto.createHmac('sha256', 'rzp_secret_test').update('order_OK|pay_OK').digest('hex');
    const wrongOrder = await u.post('/api/payments/razorpay/verify', { orderId: co.body.orderId, razorpayOrderId: 'order_OTHER', razorpayPaymentId: 'pay_OK', razorpaySignature: sig });
    expect(wrongOrder.status).toBe(400);
    const res = await u.post('/api/payments/razorpay/verify', { orderId: co.body.orderId, razorpayOrderId: 'order_OK', razorpayPaymentId: 'pay_OK', razorpaySignature: sig });
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('paid');
  });
});
