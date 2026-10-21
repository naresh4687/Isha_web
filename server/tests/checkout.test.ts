import { describe, expect, it } from 'vitest';
import { address, admin, customer, variantWithStock } from './helpers.js';
import { one, query } from '../src/db/pool.js';
import { computeTotals, evaluateDiscount } from '../src/modules/cart/service.js';

const stockOf = async (id: string) => (await one('SELECT stock FROM product_variants WHERE id = $1', [id]))!.stock;

describe('order totals (pure)', () => {
  it('adds shipping below the free-shipping threshold, measured after discount', () => {
    expect(computeTotals([{ unitPricePaise: 50000, quantity: 1 }])).toMatchObject({ subtotalPaise: 50000, shippingPaise: 7900, totalPaise: 57900 });
    expect(computeTotals([{ unitPricePaise: 50000, quantity: 2 }])).toMatchObject({ subtotalPaise: 100000, shippingPaise: 0, totalPaise: 100000 });
    // 1000 - 10% = 900 < 999 threshold, so shipping applies.
    expect(computeTotals([{ unitPricePaise: 100000, quantity: 1 }], 10000)).toMatchObject({ discountPaise: 10000, shippingPaise: 7900, totalPaise: 97900 });
    expect(computeTotals([])).toMatchObject({ subtotalPaise: 0, shippingPaise: 0, totalPaise: 0 });
  });

  it('caps a discount at the subtotal', () => {
    expect(computeTotals([{ unitPricePaise: 10000, quantity: 1 }], 50000).discountPaise).toBe(10000);
  });

  it('evaluates discount rules', () => {
    const base = { code: 'X', kind: 'percent' as const, value: 15, min_subtotal_paise: 99900, max_uses: null, used_count: 0, starts_at: null, ends_at: null, is_active: true };
    expect(evaluateDiscount(base, 200000)).toEqual({ discountPaise: 30000 });
    expect(evaluateDiscount(base, 50000)).toHaveProperty('error');
    expect(evaluateDiscount({ ...base, kind: 'fixed', value: 20000, min_subtotal_paise: 0 }, 15000)).toEqual({ discountPaise: 15000 });
    expect(evaluateDiscount({ ...base, max_uses: 3, used_count: 3 }, 200000)).toHaveProperty('error');
    expect(evaluateDiscount({ ...base, ends_at: new Date('2000-01-01') }, 200000)).toHaveProperty('error');
    expect(evaluateDiscount({ ...base, is_active: false }, 200000)).toHaveProperty('error');
    expect(evaluateDiscount(null, 200000)).toHaveProperty('error');
  });
});

describe('checkout', () => {
  it('requires authentication', async () => {
    const u = await customer();
    await u.post('/api/auth/logout');
    expect((await u.post('/api/checkout', { address })).status).toBe(401);
  });

  it('validates the shipping address', async () => {
    const u = await customer();
    const v = await variantWithStock(5);
    await u.post('/api/cart/items', { variantId: v.id });
    const bad = await u.post('/api/checkout', { address: { ...address, postalCode: '012345', phone: '12345', state: 'Atlantis' } });
    expect(bad.status).toBe(400);
    const details = JSON.stringify(bad.body.error.details);
    expect(details).toMatch(/PIN code/);
    expect(details).toMatch(/mobile number/);
    expect(details).toMatch(/state or union territory/);
  });

  it('rejects an empty cart', async () => {
    const u = await customer();
    const res = await u.post('/api/checkout', { address });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('empty_cart');
  });

  it('reserves stock, records discount usage, and on payment success marks paid and clears the cart', async () => {
    const u = await customer();
    const v = await variantWithStock(5, 60000);
    await u.post('/api/cart/items', { variantId: v.id, quantity: 2 });
    const before = (await one(`SELECT used_count FROM discount_codes WHERE code = 'FESTIVE15'`))!.used_count;

    const co = await u.post('/api/checkout', { address, discountCode: 'FESTIVE15' });
    expect(co.status).toBe(201);
    expect(co.body.totals).toMatchObject({ subtotalPaise: 120000, discountPaise: 18000, shippingPaise: 0, totalPaise: 102000 });
    expect(co.body.payment).toMatchObject({ provider: 'mock', testMode: true, amountPaise: 102000 });
    expect(await stockOf(v.id)).toBe(3);
    expect((await one(`SELECT used_count FROM discount_codes WHERE code = 'FESTIVE15'`))!.used_count).toBe(before + 1);

    const paid = await u.post('/api/payments/mock/complete', { orderId: co.body.orderId, outcome: 'success' });
    expect(paid.status).toBe(200);
    expect(paid.body.order.status).toBe('paid');
    expect(paid.body.order.paidAt).toBeTruthy();
    expect((await u.get('/api/cart')).body.cart.lines).toHaveLength(0);
    expect(await stockOf(v.id)).toBe(3);

    // Idempotent: a second confirmation changes nothing.
    const again = await u.post('/api/payments/mock/complete', { orderId: co.body.orderId, outcome: 'success' });
    expect(again.status).toBe(200);
    expect(again.body.order.status).toBe('paid');
    expect(await stockOf(v.id)).toBe(3);

    const history = await u.get('/api/orders');
    expect(history.body.items.map((o: any) => o.id)).toContain(co.body.orderId);
  });

  it('on payment failure releases stock and discount usage and keeps the cart', async () => {
    const u = await customer();
    const v = await variantWithStock(4, 70000);
    await u.post('/api/cart/items', { variantId: v.id, quantity: 2 });
    const before = (await one(`SELECT used_count FROM discount_codes WHERE code = 'WELCOME10'`))!.used_count;
    const co = await u.post('/api/checkout', { address, discountCode: 'WELCOME10' });
    expect(await stockOf(v.id)).toBe(2);

    const failed = await u.post('/api/payments/mock/complete', { orderId: co.body.orderId, outcome: 'failure' });
    expect(failed.body.order.status).toBe('payment_failed');
    expect(failed.body.order.payment).toMatchObject({ status: 'failed', failureReason: 'simulated_failure' });
    expect(await stockOf(v.id)).toBe(4);
    expect((await one(`SELECT used_count FROM discount_codes WHERE code = 'WELCOME10'`))!.used_count).toBe(before);
    expect((await u.get('/api/cart')).body.cart.lines).toHaveLength(1);

    // A closed attempt cannot be flipped to paid by the client.
    const again = await u.post('/api/payments/mock/complete', { orderId: co.body.orderId, outcome: 'success' });
    expect(again.status).toBe(409);
    expect((await one('SELECT status FROM orders WHERE id = $1', [co.body.orderId]))!.status).toBe('payment_failed');
  });

  it('prevents overselling the last unit', async () => {
    const a = await customer();
    const b = await customer();
    const v = await variantWithStock(1);
    await a.post('/api/cart/items', { variantId: v.id });
    await b.post('/api/cart/items', { variantId: v.id });
    const first = await a.post('/api/checkout', { address });
    expect(first.status).toBe(201);
    const second = await b.post('/api/checkout', { address });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('insufficient_stock');
    expect(await stockOf(v.id)).toBe(0);
  });

  it('starting a new checkout releases the previous pending reservation', async () => {
    const u = await customer();
    const v = await variantWithStock(3);
    await u.post('/api/cart/items', { variantId: v.id, quantity: 2 });
    const first = await u.post('/api/checkout', { address });
    expect(await stockOf(v.id)).toBe(1);
    const second = await u.post('/api/checkout', { address });
    expect(second.status).toBe(201);
    expect(await stockOf(v.id)).toBe(1);
    expect((await one('SELECT status FROM orders WHERE id = $1', [first.body.orderId]))!.status).toBe('payment_failed');
  });

  it('lets customers cancel a paid order before shipment, refunding and restocking', async () => {
    const u = await customer();
    const v = await variantWithStock(5, 40000);
    await u.post('/api/cart/items', { variantId: v.id, quantity: 1 });
    const co = await u.post('/api/checkout', { address });
    await u.post('/api/payments/mock/complete', { orderId: co.body.orderId, outcome: 'success' });
    expect(await stockOf(v.id)).toBe(4);
    const cancel = await u.post(`/api/orders/${co.body.orderId}/cancel`);
    expect(cancel.status).toBe(200);
    expect(cancel.body.order).toMatchObject({ status: 'cancelled', refundedPaise: cancel.body.order.totalPaise });
    expect(await stockOf(v.id)).toBe(5);

    // Shipped orders cannot be cancelled by the customer.
    await u.post('/api/cart/items', { variantId: v.id, quantity: 1 });
    const co2 = await u.post('/api/checkout', { address });
    await u.post('/api/payments/mock/complete', { orderId: co2.body.orderId, outcome: 'success' });
    const adm = await admin();
    expect((await adm.post(`/api/admin/orders/${co2.body.orderId}/status`, { action: 'ship' })).body.order.status).toBe('shipped');
    expect((await u.post(`/api/orders/${co2.body.orderId}/cancel`)).status).toBe(409);
  });

  it('hides other customers\' orders', async () => {
    const a = await customer();
    const b = await customer();
    const v = await variantWithStock(5);
    await a.post('/api/cart/items', { variantId: v.id });
    const co = await a.post('/api/checkout', { address });
    expect((await b.get(`/api/orders/${co.body.orderId}`)).status).toBe(404);
    expect((await b.post(`/api/orders/${co.body.orderId}/cancel`)).status).toBe(404);
    expect((await b.post('/api/payments/mock/complete', { orderId: co.body.orderId, outcome: 'success' })).status).toBe(404);
    expect((await one('SELECT status FROM orders WHERE id = $1', [co.body.orderId]))!.status).toBe('pending_payment');
  });
});

describe('reviews', () => {
  it('validates, marks verified purchases, rejects duplicates and updates the aggregate', async () => {
    const u = await customer('Meera Iyer');
    const v = await variantWithStock(5);
    expect((await u.post(`/api/products/${v.product_id}/reviews`, { rating: 6, title: 'Hi', body: 'short' })).status).toBe(400);
    expect((await u.post(`/api/products/${v.product_id}/reviews`, { rating: 5, title: 'Nice', body: '<script>alert(1)</script> lovely' })).status).toBe(400);

    await u.post('/api/cart/items', { variantId: v.id });
    const co = await u.post('/api/checkout', { address });
    await u.post('/api/payments/mock/complete', { orderId: co.body.orderId, outcome: 'success' });
    const ok = await u.post(`/api/products/${v.product_id}/reviews`, { rating: 4, title: 'Well made', body: 'Sturdy and exactly as pictured.' });
    expect(ok.status).toBe(201);
    expect(ok.body.review.verifiedPurchase).toBe(true);
    expect((await u.post(`/api/products/${v.product_id}/reviews`, { rating: 1, title: 'Again', body: 'Trying to review twice.' })).status).toBe(409);
    const list = await u.get(`/api/products/${v.product_id}/reviews`);
    expect(list.body.items[0].author).toBe('Meera I.');
    expect(list.body.items[0]).not.toHaveProperty('email');
    const p = await query('SELECT rating_avg, rating_count FROM products WHERE id = $1', [v.product_id]);
    expect(p[0]).toMatchObject({ rating_avg: 4, rating_count: 1 });
  });
});
