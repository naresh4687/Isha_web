import { Router } from 'express';
import { z } from 'zod';
import { one, query, tx } from '../../db/pool.js';
import { asyncHandler, cleanText, HttpError, notFound, parse } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';

export const reviewsRouter = Router();

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(20).default(5),
  sort: z.enum(['recent', 'highest', 'lowest']).default('recent'),
});

reviewsRouter.get(
  '/products/:id/reviews',
  asyncHandler(async (req, res) => {
    const productId = parse(z.string().uuid(), req.params.id);
    const { page, pageSize, sort } = parse(listSchema, req.query);
    const order = { recent: 'r.created_at DESC', highest: 'r.rating DESC, r.created_at DESC', lowest: 'r.rating ASC, r.created_at DESC' }[sort];
    const [{ total }] = await query('SELECT count(*)::int AS total FROM reviews WHERE product_id = $1', [productId]);
    // Only the reviewer's first name and last initial are exposed publicly.
    const rows = await query(
      `SELECT r.id, r.rating, r.title, r.body, r.verified_purchase AS "verifiedPurchase", r.created_at AS "createdAt",
              split_part(u.name, ' ', 1) || coalesce(' ' || left(nullif(split_part(u.name, ' ', 2), ''), 1) || '.', '') AS author
       FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.product_id = $1 ORDER BY ${order} LIMIT $2 OFFSET $3`,
      [productId, pageSize, (page - 1) * pageSize],
    );
    res.json({ items: rows, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  }),
);

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().transform(cleanText).pipe(z.string().min(3, 'Title must be at least 3 characters').max(120)),
  body: z.string().transform(cleanText).pipe(z.string().min(10, 'Review must be at least 10 characters').max(2000)),
});

reviewsRouter.post(
  '/products/:id/reviews',
  requireAuth,
  asyncHandler(async (req, res) => {
    const productId = parse(z.string().uuid(), req.params.id);
    const body = parse(reviewSchema, req.body);
    if (/<\s*\/?\s*(script|iframe|object|embed)/i.test(body.body + body.title)) {
      throw new HttpError(400, 'Reviews cannot contain markup.', 'invalid_content');
    }
    const product = await one('SELECT id FROM products WHERE id = $1 AND is_active', [productId]);
    if (!product) throw notFound('Product not found');
    const review = await tx(async (c) => {
      const verified = await one(
        `SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE o.user_id = $1 AND oi.product_id = $2 AND o.status IN ('paid', 'shipped', 'delivered') LIMIT 1`,
        [req.user!.id, productId],
        c,
      );
      const ins = await c.query(
        `INSERT INTO reviews(product_id, user_id, rating, title, body, verified_purchase)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (product_id, user_id) DO NOTHING
         RETURNING id, rating, title, body, verified_purchase AS "verifiedPurchase", created_at AS "createdAt"`,
        [productId, req.user!.id, body.rating, body.title, body.body, Boolean(verified)],
      );
      if (!ins.rows[0]) throw new HttpError(409, 'You have already reviewed this product.', 'duplicate_review');
      await c.query(
        `UPDATE products SET rating_avg = s.avg, rating_count = s.n
         FROM (SELECT round(avg(rating)::numeric, 2) AS avg, count(*) AS n FROM reviews WHERE product_id = $1) s
         WHERE id = $1`,
        [productId],
      );
      return ins.rows[0];
    });
    res.status(201).json({ review });
  }),
);
