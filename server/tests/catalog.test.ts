import { describe, expect, it } from 'vitest';
import { client, variantWithStock } from './helpers.js';
import { query } from '../src/db/pool.js';

const c = client();

describe('product listing', () => {
  it('lists active products with pagination metadata', async () => {
    const res = await c.get('/api/products?pageSize=5&page=2');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(5);
    expect(res.body.page).toBe(2);
    expect(res.body.total).toBeGreaterThanOrEqual(70);
    expect(res.body.totalPages).toBe(Math.ceil(res.body.total / 5));
    const p = res.body.items[0];
    expect(p).toMatchObject({ id: expect.any(String), slug: expect.any(String), pricePaise: expect.any(Number), image: expect.stringMatching(/^\/media\/products\//) });
  });

  it('filters by category and subcategory', async () => {
    const res = await c.get('/api/products?category=yoga-store&subcategory=Mats&pageSize=48');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    for (const p of res.body.items) {
      expect(p.category.slug).toBe('yoga-store');
      expect(p.subcategory).toBe('Mats');
    }
  });

  it('filters by price range (rupees) and sorts by price', async () => {
    const res = await c.get('/api/products?minPrice=300&maxPrice=900&sort=price_asc&pageSize=48');
    const prices = res.body.items.map((p: any) => p.pricePaise);
    expect(prices.length).toBeGreaterThan(3);
    expect(prices.every((x: number) => x >= 30000 && x <= 90000)).toBe(true);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });

  it('excludes out-of-stock products when inStock=true', async () => {
    const v = await variantWithStock(0);
    const all = await c.get(`/api/products?ids=${v.product_id}`);
    expect(all.body.items).toHaveLength(1);
    expect(all.body.items[0].inStock).toBe(false);
    const inStock = await c.get(`/api/products?ids=${v.product_id}&inStock=true`);
    expect(inStock.body.items).toHaveLength(0);
  });

  it('hides inactive products', async () => {
    const v = await variantWithStock(5);
    await query('UPDATE products SET is_active = false WHERE id = $1', [v.product_id]);
    const res = await c.get(`/api/products?ids=${v.product_id}`);
    expect(res.body.items).toHaveLength(0);
    expect((await c.get(`/api/products/${v.slug}`)).status).toBe(404);
  });

  it('searches with full text and tolerates typos', async () => {
    const exact = await c.get('/api/products?q=copper');
    expect(exact.body.items.length).toBeGreaterThan(0);
    expect(exact.body.items.every((p: any) => /copper/i.test(p.title) || p.tags.includes('copper'))).toBe(true);
    const typo = await c.get('/api/products?q=coper');
    expect(typo.body.items.map((p: any) => p.title)).toEqual(expect.arrayContaining([expect.stringMatching(/Copper/)]));
    const none = await c.get('/api/products?q=zzzzqqqq');
    expect(none.body.total).toBe(0);
    expect(none.body.items).toEqual([]);
  });

  it('rejects invalid query parameters with a 400', async () => {
    expect((await c.get('/api/products?minPrice=900&maxPrice=100')).status).toBe(400);
    expect((await c.get('/api/products?sort=sideways')).status).toBe(400);
    expect((await c.get('/api/products?pageSize=1000')).status).toBe(400);
    const bad = await c.get('/api/products?ids=not-a-uuid');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('validation_error');
  });

  it('returns product detail with variants and gallery, and 404 for unknown slugs', async () => {
    const list = await c.get('/api/products?category=clothing&pageSize=1');
    const slug = list.body.items[0].slug;
    const res = await c.get(`/api/products/${slug}`);
    expect(res.status).toBe(200);
    expect(res.body.product.variants.length).toBeGreaterThan(0);
    expect(res.body.product.images).toHaveLength(4);
    expect(res.body.product.ratingDistribution).toHaveProperty('5');
    expect((await c.get('/api/products/does-not-exist')).status).toBe(404);
  });

  it('lists categories with the nine-category taxonomy', async () => {
    const res = await c.get('/api/categories');
    expect(res.body.categories.map((x: any) => x.name)).toEqual([
      'Rudraksha', 'Consecrated Products', 'Yoga Store', 'Natural Food', 'Health and Immunity', 'Clothing', 'Body Care', 'Home Decor', 'Books',
    ]);
  });
});
