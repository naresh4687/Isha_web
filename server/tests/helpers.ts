import request from 'supertest';
import { createApp } from '../src/app.js';
import { one, query } from '../src/db/pool.js';

export const app = createApp();

/** Cookie-persisting client that always sends the CSRF header. */
export function client() {
  const agent = request.agent(app);
  const h = { 'X-Requested-With': 'fetch' };
  return {
    agent,
    get: (url: string) => agent.get(url),
    post: (url: string, body?: object) => agent.post(url).set(h).send(body ?? {}),
    put: (url: string, body?: object) => agent.put(url).set(h).send(body ?? {}),
    patch: (url: string, body?: object) => agent.patch(url).set(h).send(body ?? {}),
    del: (url: string) => agent.delete(url).set(h),
  };
}

let n = 0;
export async function customer(name = 'Test Customer') {
  const c = client();
  const email = `user${Date.now()}${n++}@example.test`;
  const res = await c.post('/api/auth/register', { name, email, password: 'Passw0rd!' });
  if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
  return { ...c, user: res.body.user as { id: string; email: string } };
}

export async function admin() {
  const c = client();
  const res = await c.post('/api/auth/login', { email: 'admin@anvaya.local', password: 'ChangeMe-Admin-123' });
  if (res.status !== 200) throw new Error('admin login failed');
  return c;
}

/** A dedicated product + variant with known stock and price, so tests never share inventory. */
let seq = 0;
export async function variantWithStock(stock: number, pricePaise = 50000, category = 'books') {
  const slug = `test-product-${Date.now()}-${seq++}`;
  const p = await one(
    `INSERT INTO products(slug, title, description, category_id, tags)
     VALUES ($1, $2, 'A product created by the test suite.', (SELECT id FROM categories WHERE slug = $3), '{test}') RETURNING id`,
    [slug, `Test Product ${seq}`, category],
  );
  const v = await one(
    `INSERT INTO product_variants(product_id, sku, name, price_paise, stock, is_default) VALUES ($1, $2, 'Standard', $3, $4, true) RETURNING id`,
    [p!.id, slug.toUpperCase(), pricePaise, stock],
  );
  return { id: v!.id as string, product_id: p!.id as string, slug };
}

export const address = {
  fullName: 'Asha Rao',
  phone: '98765 43210',
  line1: '12 Lake View Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  postalCode: '560001',
};
