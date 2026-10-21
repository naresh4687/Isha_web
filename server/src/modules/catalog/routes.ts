import { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../../db/pool.js';
import { asyncHandler, notFound, parse } from '../../lib/http.js';
import { CARD_FROM, CARD_SELECT, listProducts, SORTS, toCard } from './service.js';

export const catalogRouter = Router();

catalogRouter.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const rows = await query(`
      SELECT c.slug, c.name, c.description, c.subcategories,
             count(p.id) FILTER (WHERE p.is_active)::int AS "productCount"
      FROM categories c LEFT JOIN products p ON p.category_id = c.id
      GROUP BY c.id ORDER BY c.sort_order`);
    res.json({ categories: rows });
  }),
);

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')
  .optional();

const listSchema = z
  .object({
    q: z.string().trim().max(100).optional().transform((v) => v || undefined),
    category: z.string().max(60).optional(),
    subcategory: z.string().max(60).optional(),
    tag: z.string().max(60).optional(),
    minPrice: z.coerce.number().min(0).max(1_000_000).optional(),
    maxPrice: z.coerce.number().min(0).max(1_000_000).optional(),
    inStock: bool,
    minRating: z.coerce.number().min(0).max(5).optional(),
    sort: z.enum(SORTS).default('relevance'),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    pageSize: z.coerce.number().int().min(1).max(48).default(12),
    ids: z
      .string()
      .optional()
      .transform((v) => (v ? v.split(',').slice(0, 48) : undefined))
      .pipe(z.array(z.string().uuid()).optional()),
  })
  .refine((v) => v.minPrice == null || v.maxPrice == null || v.minPrice <= v.maxPrice, {
    message: 'minPrice must not exceed maxPrice',
    path: ['minPrice'],
  });

catalogRouter.get(
  '/products',
  asyncHandler(async (req, res) => {
    const params = parse(listSchema, req.query);
    res.json(await listProducts(params));
  }),
);

catalogRouter.get(
  '/products/:slug',
  asyncHandler(async (req, res) => {
    const row = await one(
      `SELECT ${CARD_SELECT}, p.description, p.attributes, p.category_id ${CARD_FROM}
       WHERE p.is_active AND (p.slug = $1 OR p.id::text = $1)`,
      [req.params.slug],
    );
    if (!row) throw notFound('Product not found');
    const variants = await query(
      `SELECT id, sku, name, price_paise AS "pricePaise", compare_at_paise AS "compareAtPaise",
              stock > 0 AS "inStock", LEAST(stock, 20) AS "maxQuantity", is_default AS "isDefault"
       FROM product_variants WHERE product_id = $1 ORDER BY sort_order`,
      [row.id],
    );
    const distribution = await query(
      `SELECT rating, count(*)::int AS n FROM reviews WHERE product_id = $1 GROUP BY rating`,
      [row.id],
    );
    res.json({
      product: {
        ...toCard(row),
        description: row.description,
        attributes: row.attributes,
        images: [0, 1, 2, 3].map((n) => `/media/products/${row.slug}/${n}.svg`),
        variants,
        ratingDistribution: Object.fromEntries([1, 2, 3, 4, 5].map((r) => [r, distribution.find((d) => d.rating === r)?.n ?? 0])),
      },
    });
  }),
);

catalogRouter.get(
  '/settings/public',
  asyncHandler(async (_req, res) => {
    const rows = await query('SELECT key, value FROM settings WHERE is_public');
    res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  }),
);
