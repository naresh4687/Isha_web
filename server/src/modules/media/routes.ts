import { Router } from 'express';
import { one } from '../../db/pool.js';
import { asyncHandler } from '../../lib/http.js';
import { productArt } from './productArt.js';

export const mediaRouter = Router();

mediaRouter.get(
  '/products/:slug/:view.svg',
  asyncHandler(async (req, res) => {
    const view = Number(req.params.view);
    if (!Number.isInteger(view) || view < 0 || view > 3) return res.status(404).end();
    const row = await one(
      'SELECT c.slug AS category FROM products p JOIN categories c ON c.id = p.category_id WHERE p.slug = $1',
      [req.params.slug],
    );
    if (!row) return res.status(404).end();
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(productArt(req.params.slug, row.category, view));
  }),
);
