import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { asyncHandler, HttpError, parse } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { cardsByIds } from '../catalog/service.js';
import { cartSummary, MAX_LINE_QTY, setLineQuantity } from './service.js';

export const cartRouter = Router();

const owner = (req: any) => ({ userId: req.user?.id, visitorId: req.visitorId });
const codeSchema = z.string().trim().max(40).optional();

cartRouter.get(
  '/cart',
  asyncHandler(async (req, res) => {
    const code = parse(codeSchema, req.query.discountCode);
    res.json({ cart: await cartSummary(owner(req), code || undefined) });
  }),
);

const addSchema = z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(1).max(MAX_LINE_QTY).default(1) });
cartRouter.post(
  '/cart/items',
  asyncHandler(async (req, res) => {
    const body = parse(addSchema, req.body);
    await setLineQuantity(owner(req), body.variantId, body.quantity, 'add');
    res.status(201).json({ cart: await cartSummary(owner(req)) });
  }),
);

const setSchema = z.object({ quantity: z.number().int().min(0).max(MAX_LINE_QTY) });
cartRouter.patch(
  '/cart/items/:variantId',
  asyncHandler(async (req, res) => {
    const variantId = parse(z.string().uuid(), req.params.variantId);
    const body = parse(setSchema, req.body);
    await setLineQuantity(owner(req), variantId, body.quantity, 'set');
    res.json({ cart: await cartSummary(owner(req)) });
  }),
);

cartRouter.delete(
  '/cart/items/:variantId',
  asyncHandler(async (req, res) => {
    const variantId = parse(z.string().uuid(), req.params.variantId);
    await setLineQuantity(owner(req), variantId, 0, 'set');
    res.json({ cart: await cartSummary(owner(req)) });
  }),
);

// Wishlist (signed-in customers only).
cartRouter.get(
  '/wishlist',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query('SELECT product_id FROM wishlist_items WHERE user_id = $1 ORDER BY created_at DESC', [req.user!.id]);
    res.json({ items: await cardsByIds(rows.map((r) => r.product_id)) });
  }),
);

cartRouter.post(
  '/wishlist',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { productId } = parse(z.object({ productId: z.string().uuid() }), req.body);
    const exists = await query('SELECT 1 FROM products WHERE id = $1 AND is_active', [productId]);
    if (!exists.length) throw new HttpError(404, 'Product not found', 'not_found');
    await query('INSERT INTO wishlist_items(user_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user!.id, productId]);
    res.status(201).json({ ok: true });
  }),
);

cartRouter.delete(
  '/wishlist/:productId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const productId = parse(z.string().uuid(), req.params.productId);
    await query('DELETE FROM wishlist_items WHERE user_id = $1 AND product_id = $2', [req.user!.id, productId]);
    res.json({ ok: true });
  }),
);
