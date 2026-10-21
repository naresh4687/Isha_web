import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { admin, app, client, customer } from './helpers.js';
import { query } from '../src/db/pool.js';

describe('authentication', () => {
  it('registers, reads /me, logs out and logs back in', async () => {
    const c = client();
    const email = `auth${Date.now()}@example.test`;
    const reg = await c.post('/api/auth/register', { name: 'Kabir', email, password: 'Secur3pass' });
    expect(reg.status).toBe(201);
    expect(reg.body.user).toMatchObject({ email, role: 'customer' });
    expect(reg.body.user).not.toHaveProperty('password_hash');
    const cookie = (reg.headers['set-cookie'] as unknown as string[]).find((x: string) => x.startsWith('auth='));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect((await c.get('/api/auth/me')).body.user.email).toBe(email);
    await c.post('/api/auth/logout');
    expect((await c.get('/api/auth/me')).body.user).toBeNull();
    expect((await c.post('/api/auth/login', { email, password: 'wrong-pass1' })).status).toBe(401);
    expect((await c.post('/api/auth/login', { email: email.toUpperCase(), password: 'Secur3pass' })).status).toBe(200);
  });

  it('enforces password rules and unique emails', async () => {
    const c = client();
    expect((await c.post('/api/auth/register', { name: 'A', email: 'weak@example.test', password: 'short' })).status).toBe(400);
    expect((await c.post('/api/auth/register', { name: 'A', email: 'weak@example.test', password: 'allletters' })).status).toBe(400);
    const u = await customer();
    const dup = await c.post('/api/auth/register', { name: 'B', email: u.user.email, password: 'Passw0rd!' });
    expect(dup.status).toBe(409);
  });

  it('never lets placeholder (demo) accounts sign in', async () => {
    await query(`INSERT INTO users(email, password_hash, name, is_demo) VALUES ('demo.x@example.invalid', '!demo-account-login-disabled', 'Demo', true) ON CONFLICT DO NOTHING`);
    const res = await client().post('/api/auth/login', { email: 'demo.x@example.invalid', password: '!demo-account-login-disabled' });
    expect(res.status).toBe(401);
  });

  it('rejects tampered tokens', async () => {
    const res = await request(app).get('/api/auth/me').set('Cookie', 'auth=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.bad');
    expect(res.body.user).toBeNull();
  });

  it('requires the CSRF header on state-changing requests', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.c', password: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf');
  });
});

describe('administrator permissions', () => {
  const adminRoutes = ['/api/admin/products', '/api/admin/orders', '/api/admin/analytics/overview', '/api/admin/ml/online-metrics', '/api/admin/support'];

  it('returns 401 for anonymous users', async () => {
    for (const r of adminRoutes) expect((await client().get(r)).status, r).toBe(401);
  });

  it('returns 403 for customers', async () => {
    const u = await customer();
    for (const r of adminRoutes) expect((await u.get(r)).status, r).toBe(403);
    expect((await u.post('/api/admin/inventory/adjust', { variantId: '00000000-0000-4000-8000-000000000000', delta: 5 })).status).toBe(403);
  });

  it('allows administrators', async () => {
    const a = await admin();
    for (const r of adminRoutes) expect((await a.get(r)).status, r).toBe(200);
  });

  it('takes role changes into effect immediately (role is read from the database)', async () => {
    const u = await customer();
    await query(`UPDATE users SET role = 'admin' WHERE id = $1`, [u.user.id]);
    expect((await u.get('/api/admin/products')).status).toBe(200);
    await query(`UPDATE users SET role = 'customer' WHERE id = $1`, [u.user.id]);
    expect((await u.get('/api/admin/products')).status).toBe(403);
  });
});

describe('admin product and inventory management', () => {
  it('creates a product, adjusts inventory with audit trail, and blocks negative stock', async () => {
    const a = await admin();
    const sku = `ADM-${Date.now()}`;
    const created = await a.post('/api/admin/products', {
      title: 'Admin Created Planter',
      description: 'A planter created through the admin API.',
      categorySlug: 'home-decor',
      subcategory: 'Planters',
      tags: ['planter'],
      variants: [{ sku, name: 'Standard', pricePaise: 45000, stock: 3 }],
    });
    expect(created.status).toBe(201);
    const detail = await a.get(`/api/admin/products/${created.body.id}`);
    const variantId = detail.body.product.variants[0].id;
    expect((await a.post('/api/admin/inventory/adjust', { variantId, delta: 7, reason: 'restock' })).body.variant.stock).toBe(10);
    expect((await a.post('/api/admin/inventory/adjust', { variantId, delta: -11 })).status).toBe(409);
    const audit = await query('SELECT delta, reason FROM inventory_adjustments WHERE variant_id = $1 ORDER BY id', [variantId]);
    expect(audit).toEqual([{ delta: 3, reason: 'admin' }, { delta: 7, reason: 'restock' }]);
    expect((await a.post('/api/admin/products', { title: 'Dup', description: 'Duplicate SKU product.', categorySlug: 'books', variants: [{ sku, name: 'x', pricePaise: 100 }] })).status).toBe(409);
    expect((await a.post('/api/admin/products', { title: 'Bad', description: 'Unknown category here.', categorySlug: 'nope', variants: [{ sku: 'ZZ-1', name: 'x', pricePaise: 100 }] })).status).toBe(400);
  });
});

describe('session revocation', () => {
  async function twoDevices() {
    const a = await customer();
    const b = client();
    expect((await b.post('/api/auth/login', { email: a.user.email, password: 'Passw0rd!' })).status).toBe(200);
    return { a, b };
  }

  it('sign out everywhere revokes all sessions', async () => {
    const { a, b } = await twoDevices();
    expect((await b.get('/api/auth/me')).body.user).not.toBeNull();
    expect((await a.post('/api/auth/logout-all')).status).toBe(200);
    expect((await a.get('/api/auth/me')).body.user).toBeNull();
    expect((await b.get('/api/auth/me')).body.user).toBeNull();
    expect((await b.get('/api/orders')).status).toBe(401);
  });

  it('password change keeps this session, revokes others, and enforces the policy', async () => {
    const { a, b } = await twoDevices();
    const wrong = await a.post('/api/auth/password', { currentPassword: 'nope', newPassword: 'N3wpassword' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.details.fieldErrors.currentPassword).toBeTruthy();
    expect((await a.post('/api/auth/password', { currentPassword: 'Passw0rd!', newPassword: 'short' })).status).toBe(400);
    expect((await a.post('/api/auth/password', { currentPassword: 'Passw0rd!', newPassword: 'Passw0rd!' })).status).toBe(400);
    expect((await a.post('/api/auth/password', { currentPassword: 'Passw0rd!', newPassword: 'N3wpassword' })).status).toBe(200);
    expect((await a.get('/api/auth/me')).body.user.email).toBe(a.user.email);
    expect((await b.get('/api/auth/me')).body.user).toBeNull();
    const c = client();
    expect((await c.post('/api/auth/login', { email: a.user.email, password: 'Passw0rd!' })).status).toBe(401);
    expect((await c.post('/api/auth/login', { email: a.user.email, password: 'N3wpassword' })).status).toBe(200);
  });

  it('requires authentication', async () => {
    expect((await client().post('/api/auth/logout-all')).status).toBe(401);
    expect((await client().post('/api/auth/password', { currentPassword: 'x', newPassword: 'N3wpassword' })).status).toBe(401);
  });
});
