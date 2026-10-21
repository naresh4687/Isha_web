import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { one, pool } from '../src/db/pool.js';
import os from 'node:os';
import { ASSET_DIR, applyImageManifest, planImageSync, readManifest, validateManifest, webpSize } from '../src/modules/catalog/images.js';
import { client } from './helpers.js';

const assets = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/public');
const manifest = readManifest();
const photographed = Object.keys(manifest);
const LICENCES = /^(CC0|Public domain|CC BY(-SA)? [0-9.]+)$/;

describe('product images', () => {
  it('has a manifest whose every entry points at existing local files with a permitted licence', () => {
    expect(photographed.length).toBeGreaterThan(40);
    for (const [slug, entry] of Object.entries(manifest)) {
      expect(entry.images.length).toBeGreaterThan(0);
      for (const img of entry.images) {
        expect(img.file).toMatch(new RegExp(`^${slug}/\\d+-[0-9a-f]{10}$`));
        for (const w of [400, 800]) expect(fs.statSync(path.join(assets, 'assets/products', `${img.file}-${w}.webp`)).size).toBeGreaterThan(1000);
        expect(img.alt.length).toBeGreaterThan(10);
        expect(img.source.license).toMatch(LICENCES);
        expect(img.source.page).toMatch(/^https:\/\/(commons\.wikimedia\.org\/wiki\/File:|www\.flickr\.com\/photos\/|wordpress\.org\/photos\/)/);
        expect(['contain', 'cover']).toContain(img.fit);
        expect(img.source.author).not.toMatch(/unknown/i);
      }
    }
    expect(fs.existsSync(path.join(assets, 'assets/products/fallback-brand.svg'))).toBe(true);
  });

  it('uses one canonical image across detail, listing, search, recommendations and cart', async () => {
    const slug = 'copper-water-bottle-1-l';
    const c = client();
    const detail = (await c.get(`/api/products/${slug}`)).body.product;
    const canonical = detail.images[0].src;
    expect(canonical).toMatch(/^\/assets\/products\/copper-water-bottle-1-l\/0-[0-9a-f]{10}-800\.webp$/);
    expect(detail.image).toBe(canonical);
    expect(detail.imageAlt).toBe(detail.images[0].alt);
    expect(detail.imageFit).toBe(detail.images[0].fit);
    expect(detail.images[0].credit).toMatchObject({ license: expect.stringMatching(LICENCES), sourceUrl: expect.stringContaining('commons.wikimedia.org') });

    const listed = (await c.get('/api/products?category=yoga-store&pageSize=48')).body.items.find((p: any) => p.slug === slug);
    expect(listed.image).toBe(canonical);
    const searched = (await c.get('/api/products?q=copper%20bottle')).body.items.find((p: any) => p.slug === slug);
    expect(searched.image).toBe(canonical);
    const trending = ((await c.get('/api/recommendations/trending?k=12')).body.items as any[]).map((i) => i.product ?? i);
    expect(trending.length).toBeGreaterThan(0);
    for (const p of trending) expect(p.image).toBe((await c.get(`/api/products/${p.slug}`)).body.product.image);

    const variant = await one('SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.slug = $1 AND v.stock > 0 LIMIT 1', [slug]);
    if (variant) {
      await c.post('/api/cart/items', { variantId: variant.id, quantity: 1 });
      const line = (await c.get('/api/cart')).body.cart.lines.find((l: any) => l.slug === slug);
      expect(line).toMatchObject({ image: canonical, imageAlt: detail.imageAlt });
    }
  });

  it('falls back to the generated illustration for products without a photo', async () => {
    const res = await client().get('/api/products/the-millet-kitchen');
    expect(res.body.product.image).toBe('/media/products/the-millet-kitchen/0.svg');
    expect(res.body.product.images).toHaveLength(4);
    expect(res.body.product.images[0]).toMatchObject({ credit: null, alt: 'Illustration of The Millet Kitchen' });
    expect(res.body.product.model3d).toBeNull();
    const svg = await client().get('/media/products/the-millet-kitchen/0.svg');
    expect(svg.status).toBe(200);
    expect(svg.headers['content-type']).toContain('image/svg+xml');
  });

  it('syncs idempotently and never overwrites images that did not come from the manifest', async () => {
    expect(await applyImageManifest()).toBe(0); // the seed already applied it
    const slug = photographed[0];
    const custom = [{ src: 'https://cdn.example.test/own-photo.jpg', alt: 'Own photo', width: 800, height: 800, credit: null }];
    await pool.query('UPDATE products SET images = $2 WHERE slug = $1', [slug, JSON.stringify(custom)]);
    expect(await applyImageManifest()).toBe(0);
    expect((await one('SELECT images FROM products WHERE slug = $1', [slug]))!.images).toEqual(custom);

    await pool.query(`UPDATE products SET images = '[]' WHERE slug = $1`, [slug]);
    expect(await applyImageManifest()).toBe(1);
    expect((await one('SELECT images->0->>$2 AS src FROM products WHERE slug = $1', [slug, 'src']))!.src).toMatch(/^\/assets\/products\//);
  });

  it('validates the manifest and plans a dry run with nothing left to change after seeding', async () => {
    expect(validateManifest(manifest).errors).toEqual([]);
    const plan = await planImageSync();
    expect(plan.filter((p) => p.action === 'update')).toEqual([]);
    expect(plan.filter((p) => p.action === 'not-in-catalogue')).toEqual([]);
    for (const p of plan.filter((x) => x.action === 'unchanged')) expect(p.attribution).toMatch(/·/);
    expect(plan.some((p) => p.action === 'illustration')).toBe(true);
  });

  it('rejects disallowed hosts, bad licences, corrupt files and duplicates, and then applies nothing', async () => {
    const [slug, entry] = Object.entries(manifest)[0];
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'img-'));
    fs.cpSync(path.join(ASSET_DIR, slug), path.join(tmp, slug), { recursive: true });
    const img = entry.images[0];
    expect(webpSize(fs.readFileSync(path.join(tmp, `${img.file}-800.webp`)))).toEqual({ width: 800, height: 800 });

    const bad = (patch: (e: any) => void) => { const e = structuredClone(entry); patch(e); return { [slug]: e }; };
    expect(validateManifest(bad((e) => { e.images[0].source.page = 'https://ishalife.sadhguru.org/x.jpg'; }), tmp).errors.join()).toMatch(/not allow-listed/);
    expect(validateManifest(bad((e) => { e.images[0].source.license = 'All rights reserved'; }), tmp).errors.join()).toMatch(/not permitted/);
    expect(validateManifest(bad((e) => { e.images.push(structuredClone(e.images[0])); }), tmp).errors.join()).toMatch(/duplicate/);
    fs.writeFileSync(path.join(tmp, `${img.file}-400.webp`), Buffer.from('\xff\xd8\xff\xe0 not a webp', 'latin1'));
    expect(validateManifest({ [slug]: entry }, tmp).errors.join()).toMatch(/not a valid WebP/);

    const before = (await one('SELECT images FROM products WHERE slug = $1', [slug]))!.images;
    const evil = bad((e) => { e.images[0].file = `${slug}/0-0000000000`; });
    expect(await applyImageManifest(pool, evil, tmp)).toBe(0);
    expect((await one('SELECT images FROM products WHERE slug = $1', [slug]))!.images).toEqual(before);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
