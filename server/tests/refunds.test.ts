import { describe, expect, it } from 'vitest';
import { address, admin, customer, variantWithStock } from './helpers.js';
import { one, query } from '../src/db/pool.js';
import * as A from '../src/modules/analytics/service.js';

type Client = Awaited<ReturnType<typeof customer>>;
const stockOf = async (id: string) => (await one('SELECT stock FROM product_variants WHERE id = $1', [id]))!.stock;

/** Places and pays an order through the API, then optionally ships and delivers it as admin. */
async function paidOrder(u: Client, lines: { variantId: string; quantity: number }[], opts: { code?: string; deliver?: boolean } = {}) {
  for (const l of lines) expect((await u.post('/api/cart/items', l)).status).toBe(201);
  const co = await u.post('/api/checkout', { address, discountCode: opts.code });
  expect(co.status).toBe(201);
  await u.post('/api/payments/mock/complete', { orderId: co.body.orderId, outcome: 'success' });
  if (opts.deliver) {
    const a = await admin();
    await a.post(`/api/admin/orders/${co.body.orderId}/status`, { action: 'ship' });
    await a.post(`/api/admin/orders/${co.body.orderId}/status`, { action: 'deliver' });
  }
  return (await u.get(`/api/orders/${co.body.orderId}`)).body.order;
}

describe('partial refunds', () => {
  it('refunds units one at a time and sums exactly to the order total, shipping last', async () => {
    const u = await customer();
    const v = await variantWithStock(10, 33333);
    const order = await paidOrder(u, [{ variantId: v.id, quantity: 3 }], { code: 'WELCOME10', deliver: true });
    // subtotal 99,999; 10% = 10,000; after discount 89,999 < 99,900 so shipping 7,900; total 97,899
    expect(order).toMatchObject({ subtotalPaise: 99999, discountPaise: 10000, shippingPaise: 7900, totalPaise: 97899, status: 'delivered' });
    const itemId = order.items[0].id;
    const a = await admin();

    const r1 = await a.post(`/api/admin/orders/${order.id}/refunds`, { items: [{ orderItemId: itemId, quantity: 1 }], reason: 'damaged', restock: false });
    expect(r1.status).toBe(201);
    expect(r1.body.refund).toMatchObject({ amountPaise: 30000, shippingPaise: 0, fullyRefunded: false, status: 'delivered' });
    expect(r1.body.order).toMatchObject({ refundedPaise: 30000, status: 'delivered' });
    expect(await stockOf(v.id)).toBe(7);

    const r2 = await a.post(`/api/admin/orders/${order.id}/refunds`, { items: [{ orderItemId: itemId, quantity: 1 }], reason: 'damaged', restock: true });
    expect(r2.body.refund.amountPaise).toBe(29999);
    expect(await stockOf(v.id)).toBe(8);

    const tooMany = await a.post(`/api/admin/orders/${order.id}/refunds`, { items: [{ orderItemId: itemId, quantity: 2 }], reason: 'damaged' });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.error.code).toBe('refund_exceeds_quantity');

    const r3 = await a.post(`/api/admin/orders/${order.id}/refunds`, { items: [{ orderItemId: itemId, quantity: 1 }], reason: 'damaged' });
    expect(r3.body.refund).toMatchObject({ amountPaise: 30000 + 7900, shippingPaise: 7900, fullyRefunded: true, status: 'refunded' });
    const final = (await one('SELECT refunded_paise, total_paise, status FROM orders WHERE id = $1', [order.id]))!;
    expect(final).toEqual({ refunded_paise: 97899, total_paise: 97899, status: 'refunded' });
    const refunds = await query('SELECT amount_paise FROM refunds WHERE order_id = $1', [order.id]);
    expect(refunds.reduce((s, r) => s + r.amount_paise, 0)).toBe(97899);
    expect((await a.post(`/api/admin/orders/${order.id}/refunds`, { items: [{ orderItemId: itemId, quantity: 1 }], reason: 'x again' })).status).toBe(409);
  });

  it('attributes a partial refund only to the refunded product in analytics', async () => {
    const u = await customer();
    const book = await variantWithStock(10, 40000, 'books');
    const decor = await variantWithStock(10, 80000, 'home-decor');
    const order = await paidOrder(u, [{ variantId: book.id, quantity: 1 }, { variantId: decor.id, quantity: 1 }], { deliver: true });
    const decorLine = order.items.find((i: any) => i.productId === decor.product_id);
    const a = await admin();
    await a.post(`/api/admin/orders/${order.id}/refunds`, { items: [{ orderItemId: decorLine.id, quantity: 1 }], reason: 'chipped' });
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const f: A.Filters = { from: today, to: today, granularity: 'day', includeDemo: false };
    expect(await A.summary({ ...f, productId: book.product_id })).toMatchObject({ gmvPaise: 40000, refundsPaise: 0, netSalesPaise: 40000 });
    expect(await A.summary({ ...f, productId: decor.product_id })).toMatchObject({ gmvPaise: 80000, refundsPaise: 80000, netSalesPaise: 0 });
  });

  it('is admin-only', async () => {
    const u = await customer();
    const v = await variantWithStock(5);
    const order = await paidOrder(u, [{ variantId: v.id, quantity: 1 }], { deliver: true });
    expect((await u.post(`/api/admin/orders/${order.id}/refunds`, { items: [{ orderItemId: order.items[0].id, quantity: 1 }], reason: 'self refund' })).status).toBe(403);
  });
});

describe('customer returns', () => {
  it('requires a delivered order inside the return window', async () => {
    const u = await customer();
    const v = await variantWithStock(5);
    const paid = await paidOrder(u, [{ variantId: v.id, quantity: 1 }]);
    expect(paid.returnWindowOpen).toBe(false);
    const early = await u.post(`/api/orders/${paid.id}/returns`, { items: [{ orderItemId: paid.items[0].id, quantity: 1 }], reason: 'Changed my mind about it.' });
    expect(early.status).toBe(409);

    const late = await paidOrder(u, [{ variantId: v.id, quantity: 1 }], { deliver: true });
    await query(`UPDATE orders SET delivered_at = now() - interval '8 days' WHERE id = $1`, [late.id]);
    expect((await u.post(`/api/orders/${late.id}/returns`, { items: [{ orderItemId: late.items[0].id, quantity: 1 }], reason: 'Changed my mind about it.' })).body.error.code).toBe('return_window_closed');
  });

  it('rejects non-returnable categories, over-quantity and other customers', async () => {
    const u = await customer();
    const food = await variantWithStock(5, 30000, 'natural-food');
    const book = await variantWithStock(5, 30000, 'books');
    const order = await paidOrder(u, [{ variantId: food.id, quantity: 1 }, { variantId: book.id, quantity: 2 }], { deliver: true });
    const foodLine = order.items.find((i: any) => i.productId === food.product_id);
    const bookLine = order.items.find((i: any) => i.productId === book.product_id);
    expect(foodLine.returnable).toBe(false);
    expect((await u.post(`/api/orders/${order.id}/returns`, { items: [{ orderItemId: foodLine.id, quantity: 1 }], reason: 'Did not like the taste.' })).body.error.code).toBe('not_returnable');
    expect((await u.post(`/api/orders/${order.id}/returns`, { items: [{ orderItemId: bookLine.id, quantity: 1 }], reason: 'short' })).status).toBe(400);
    const ok = await u.post(`/api/orders/${order.id}/returns`, { items: [{ orderItemId: bookLine.id, quantity: 1 }], reason: 'Arrived with a bent cover.' });
    expect(ok.status).toBe(201);
    expect(ok.body.order.returns[0]).toMatchObject({ status: 'requested' });
    // One unit is already pending, so asking for two more exceeds what was bought.
    expect((await u.post(`/api/orders/${order.id}/returns`, { items: [{ orderItemId: bookLine.id, quantity: 2 }], reason: 'Second copy also bent.' })).body.error.code).toBe('return_exceeds_quantity');
    const other = await customer();
    expect((await other.post(`/api/orders/${order.id}/returns`, { items: [{ orderItemId: bookLine.id, quantity: 1 }], reason: 'Not my order at all.' })).status).toBe(404);
  });

  it('admin approval refunds and restocks; rejection records a note; decisions are final', async () => {
    const u = await customer();
    const v = await variantWithStock(5, 50000);
    const order = await paidOrder(u, [{ variantId: v.id, quantity: 2 }], { deliver: true });
    const line = order.items[0];
    expect(await stockOf(v.id)).toBe(3);
    await u.post(`/api/orders/${order.id}/returns`, { items: [{ orderItemId: line.id, quantity: 1 }], reason: 'Arrived with a bent cover.' });
    await u.post(`/api/orders/${order.id}/returns`, { items: [{ orderItemId: line.id, quantity: 1 }], reason: 'Second one is the wrong colour.' });
    const a = await admin();
    const list = (await a.get('/api/admin/returns?status=requested')).body.items.filter((r: any) => r.orderId === order.id);
    expect(list).toHaveLength(2);
    expect(list[0].items[0]).toMatchObject({ quantity: 1, unitPricePaise: 50000 });

    const approve = await a.post(`/api/admin/returns/${list[0].id}/approve`, { restock: true });
    expect(approve.status).toBe(200);
    expect(approve.body.refund).toMatchObject({ amountPaise: 50000, fullyRefunded: false });
    expect(await stockOf(v.id)).toBe(4);
    expect((await a.post(`/api/admin/returns/${list[0].id}/approve`, {})).status).toBe(409);

    expect((await a.post(`/api/admin/returns/${list[1].id}/reject`, { note: 'Colour matches the listing.' })).status).toBe(200);
    expect((await a.post(`/api/admin/returns/${list[1].id}/approve`, {})).status).toBe(409);
    const after = (await u.get(`/api/orders/${order.id}`)).body.order;
    expect(after.refundedPaise).toBe(50000);
    expect(after.status).toBe('delivered');
    expect(after.returns.map((r: any) => r.status).sort()).toEqual(['refunded', 'rejected']);
    expect(after.returns.find((r: any) => r.status === 'rejected').adminNote).toBe('Colour matches the listing.');
    expect((await u.get('/api/admin/returns')).status).toBe(403);
  });
});
