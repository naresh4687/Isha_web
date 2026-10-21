import bcrypt from 'bcryptjs';
import { pool, tx } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { env } from '../src/config/env.js';
import { catalog } from './catalog.js';
import { applyImageManifest } from '../src/modules/catalog/images.js';
import { makeRng } from './rng.js';

const slugify = (s: string) =>
  s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export async function seedCatalog() {
  const rng = makeRng(42);
  await tx(async (c) => {
    const settings: [string, unknown, boolean][] = [
      ['brand', { name: env.BRAND_NAME, tagline: 'Considered goods for a quieter life' }, true],
      ['announcement', { text: 'Free shipping on orders above ₹999 · Easy 7-day returns on unused items' }, true],
      ['catalog_is_sample', true, true],
    ];
    for (const [key, value, isPublic] of settings) {
      await c.query(
        `INSERT INTO settings(key, value, is_public) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO NOTHING`,
        [key, JSON.stringify(value), isPublic],
      );
    }

    for (const [i, cat] of catalog.entries()) {
      const { rows } = await c.query(
        `INSERT INTO categories(slug, name, description, subcategories, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
           subcategories = EXCLUDED.subcategories, sort_order = EXCLUDED.sort_order
         RETURNING id`,
        [cat.slug, cat.name, cat.description, cat.subcategories, i],
      );
      const categoryId = rows[0].id;
      for (const p of cat.products) {
        const slug = slugify(p.title);
        const daysAgo = p.newDaysAgo ?? rng.int(60, 400);
        const ins = await c.query(
          `INSERT INTO products(slug, title, description, category_id, subcategory, tags, attributes, is_demo, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true, now() - ($8 || ' days')::interval)
           ON CONFLICT (slug) DO NOTHING RETURNING id`,
          [slug, p.title, p.blurb, categoryId, p.sub, p.tags, JSON.stringify(p.attrs), String(daysAgo)],
        );
        if (!ins.rows[0]) continue;
        const productId = ins.rows[0].id;
        const variants = p.variants ?? [{ name: 'Standard', price: p.price, compareAt: p.compareAt }];
        for (const [vi, v] of variants.entries()) {
          // Mostly healthy stock, with some low-stock and out-of-stock items for realistic UI/alerts.
          const roll = rng.next();
          const stock = roll < 0.06 ? 0 : roll < 0.16 ? rng.int(1, 4) : rng.int(12, 80);
          const { rows: vr } = await c.query(
            `INSERT INTO product_variants(product_id, sku, name, price_paise, compare_at_paise, stock, is_default, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [
              productId,
              `${slug.slice(0, 24).toUpperCase()}-${vi + 1}`,
              v.name,
              v.price * 100,
              v.compareAt ? v.compareAt * 100 : null,
              stock,
              vi === 0,
              vi,
            ],
          );
          await c.query(
            `INSERT INTO inventory_adjustments(variant_id, delta, reason) VALUES ($1, $2, 'seed')`,
            [vr[0].id, stock],
          );
        }
      }
    }
    await applyImageManifest(c);

    const codes: [string, 'percent' | 'fixed', number, number][] = [
      ['WELCOME10', 'percent', 10, 0],
      ['FLAT200', 'fixed', 20000, 149900],
      ['FESTIVE15', 'percent', 15, 99900],
    ];
    for (const [code, kind, value, min] of codes) {
      await c.query(
        `INSERT INTO discount_codes(code, kind, value, min_subtotal_paise) VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO NOTHING`,
        [code, kind, value, min],
      );
    }

    const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@anvaya.local';
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword && env.NODE_ENV === 'production') {
      throw new Error('ADMIN_PASSWORD must be set to seed an admin in production');
    }
    const password = adminPassword ?? 'ChangeMe-Admin-123';
    const { rowCount } = await c.query(
      `INSERT INTO users(email, password_hash, name, role) VALUES ($1, $2, 'Store Admin', 'admin')
       ON CONFLICT (email) DO NOTHING`,
      [adminEmail, await bcrypt.hash(password, 12)],
    );
    if (rowCount && !adminPassword) {
      console.log(`Seeded dev admin ${adminEmail} / ${password} (set ADMIN_PASSWORD to override)`);
    }
  });
}

if (process.argv[1]?.endsWith('seed.ts')) {
  migrate()
    .then(seedCatalog)
    .then(async () => {
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM products');
      console.log(`catalog seeded: ${rows[0].n} products`);
      await pool.end();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
