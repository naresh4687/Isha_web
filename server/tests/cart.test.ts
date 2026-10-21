import { describe, expect, it } from 'vitest';
import { client, customer, variantWithStock } from './helpers.js';

describe('cart', () => {
  it('persists a guest cart across requests via the visitor cookie', async () => {
    const c = client();
    const v = await variantWithStock(10, 30000);
    const add = await c.post('/api/cart/items', { variantId: v.id, quantity: 2 });
    expect(add.status).toBe(201);
    const again = await c.get('/api/cart');
    expect(again.body.cart.lines).toHaveLength(1);
    expect(again.body.cart.lines[0]).toMatchObject({ variantId: v.id, quantity: 2, lineTotalPaise: 60000 });
    expect(again.body.cart.itemCount).toBe(2);
    // A different visitor sees an empty cart.
    expect((await client().get('/api/cart')).body.cart.lines).toHaveLength(0);
  });

  it('adds to an existing line, sets quantity, and removes at zero', async () => {
    const c = client();
    const v = await variantWithStock(10);
    await c.post('/api/cart/items', { variantId: v.id, quantity: 1 });
    await c.post('/api/cart/items', { variantId: v.id, quantity: 2 });
    expect((await c.get('/api/cart')).body.cart.lines[0].quantity).toBe(3);
    const set = await c.patch(`/api/cart/items/${v.id}`, { quantity: 5 });
    expect(set.body.cart.lines[0].quantity).toBe(5);
    const zero = await c.patch(`/api/cart/items/${v.id}`, { quantity: 0 });
    expect(zero.body.cart.lines).toHaveLength(0);
  });

  it('refuses quantities above available stock and out-of-stock items', async () => {
    const c = client();
    const low = await variantWithStock(2);
    const res = await c.post('/api/cart/items', { variantId: low.id, quantity: 3 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'insufficient_stock', details: { available: 2 } });
    const oos = await variantWithStock(0);
    expect((await c.post('/api/cart/items', { variantId: oos.id })).body.error.code).toBe('out_of_stock');
  });

  it('validates input', async () => {
    const c = client();
    expect((await c.post('/api/cart/items', { variantId: 'nope' })).status).toBe(400);
    const v = await variantWithStock(50);
    expect((await c.post('/api/cart/items', { variantId: v.id, quantity: 21 })).status).toBe(400);
    expect((await c.post('/api/cart/items', { variantId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
  });

  it('merges the guest cart into the account cart on sign-in', async () => {
    const u = await customer();
    const v1 = await variantWithStock(10);
    await u.post('/api/cart/items', { variantId: v1.id, quantity: 1 });
    await u.post('/api/auth/logout');

    const v2 = await variantWithStock(10);
    await u.post('/api/cart/items', { variantId: v1.id, quantity: 2 });
    await u.post('/api/cart/items', { variantId: v2.id, quantity: 1 });
    const login = await u.post('/api/auth/login', { email: u.user.email, password: 'Passw0rd!' });
    expect(login.status).toBe(200);
    const cart = (await u.get('/api/cart')).body.cart;
    const byId = Object.fromEntries(cart.lines.map((l: any) => [l.variantId, l.quantity]));
    expect(byId).toEqual({ [v1.id]: 3, [v2.id]: 1 });
  });

  it('applies valid discount codes and explains invalid ones', async () => {
    const c = client();
    const v = await variantWithStock(10, 50000);
    await c.post('/api/cart/items', { variantId: v.id, quantity: 1 });
    const ok = (await c.get('/api/cart?discountCode=welcome10')).body.cart;
    expect(ok.discount).toEqual({ code: 'WELCOME10' });
    expect(ok.totals.discountPaise).toBe(5000);
    const min = (await c.get('/api/cart?discountCode=FLAT200')).body.cart;
    expect(min.discount.error).toMatch(/more to use this code/);
    expect(min.totals.discountPaise).toBe(0);
    expect((await c.get('/api/cart?discountCode=NOPE')).body.cart.discount.error).toMatch(/not valid/);
  });
});

describe('wishlist', () => {
  it('requires sign-in and supports add/list/remove', async () => {
    const anon = client();
    expect((await anon.get('/api/wishlist')).status).toBe(401);
    const u = await customer();
    const v = await variantWithStock(3);
    expect((await u.post('/api/wishlist', { productId: v.product_id })).status).toBe(201);
    expect((await u.post('/api/wishlist', { productId: v.product_id })).status).toBe(201); // idempotent
    expect((await u.get('/api/wishlist')).body.items.map((p: any) => p.id)).toEqual([v.product_id]);
    await u.del(`/api/wishlist/${v.product_id}`);
    expect((await u.get('/api/wishlist')).body.items).toHaveLength(0);
  });
});
