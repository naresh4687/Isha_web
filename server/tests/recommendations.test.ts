import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app, client, variantWithStock } from './helpers.js';
import { query } from '../src/db/pool.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockMl(handler: (url: URL) => unknown) {
  globalThis.fetch = vi.fn(async (input: any, init?: any) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
    if (url.port !== '59999') return realFetch(input, init);
    expect(init?.headers?.['X-Service-Token']).toBe('test-token');
    return new Response(JSON.stringify(handler(url)), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as any;
}

describe('recommendation API (backend layer)', () => {
  it('drops out-of-stock and inactive products returned by the model and keeps rank order', async () => {
    const a = await variantWithStock(5);
    const oos = await variantWithStock(0);
    const inactive = await variantWithStock(5);
    const b = await variantWithStock(5);
    await query('UPDATE products SET is_active = false WHERE id = $1', [inactive.product_id]);
    mockMl(() => ({
      model_version: 'v-test',
      strategy: 'hybrid',
      items: [
        { product_id: oos.product_id, score: 0.99, reasons: ['similar_content'] },
        { product_id: a.product_id, score: 0.9, reasons: ['customers_also_engaged'] },
        { product_id: inactive.product_id, score: 0.8, reasons: ['popular'] },
        { product_id: b.product_id, score: 0.7, reasons: ['category_preference'] },
      ],
    }));
    const res = await client().get('/api/recommendations/personalized?k=4');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('model');
    expect(res.body.modelVersion).toBe('v-test');
    expect(res.body.items.map((i: any) => i.product.id)).toEqual([a.product_id, b.product_id]);
    expect(res.body.items[0].reasons).toEqual(['Shoppers who liked your picks also liked this']);
  });

  it('never returns the anchor product as similar to itself', async () => {
    const a = await variantWithStock(5);
    const b = await variantWithStock(5);
    mockMl(() => ({ items: [{ product_id: a.product_id, score: 1, reasons: [] }, { product_id: b.product_id, score: 0.5, reasons: ['similar_to_this'] }] }));
    const res = await client().get(`/api/recommendations/products/${a.product_id}/similar`);
    expect(res.body.items.map((i: any) => i.product.id)).toEqual([b.product_id]);
  });

  it('passes server-side history to the model only with analytics consent', async () => {
    const seen: URL[] = [];
    mockMl((url) => (seen.push(url), { items: [] }));
    const c = client();
    await c.get('/api/recommendations/personalized');
    expect(seen[0].searchParams.get('visitor_id')).toBeNull();
    await request(app).get('/api/recommendations/personalized').set('Cookie', 'consent=analytics; vid=abcdefabcdefabcdef12');
    expect(seen[1].searchParams.get('visitor_id')).toBe('abcdefabcdefabcdef12');
  });

  it('falls back to eligible popular products when the ML service is down', async () => {
    const res = await client().get('/api/recommendations/trending?k=6');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('fallback');
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.every((i: any) => i.product.inStock)).toBe(true);
  });

  it('returns no frequently-bought-together items without model transaction analysis', async () => {
    const a = await variantWithStock(5);
    const res = await client().get(`/api/recommendations/products/${a.product_id}/frequently-bought-together`);
    expect(res.body).toMatchObject({ source: 'fallback', items: [] });
  });

  it('validates parameters', async () => {
    expect((await client().get('/api/recommendations/products/not-a-uuid/similar')).status).toBe(400);
    expect((await client().get('/api/recommendations/personalized?k=500')).status).toBe(400);
    expect((await client().get('/api/recommendations/recently-viewed?ids=bad')).status).toBe(400);
  });

  it('hydrates recently viewed items in the given order', async () => {
    const a = await variantWithStock(5);
    const b = await variantWithStock(0);
    const res = await client().get(`/api/recommendations/recently-viewed?ids=${b.product_id},${a.product_id}`);
    expect(res.body.items.map((i: any) => i.product.id)).toEqual([b.product_id, a.product_id]);
  });
});
