import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { one } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { asyncHandler, cleanText, parse } from '../../lib/http.js';

export const supportRouter = Router();

const schema = z.object({
  name: z.string().transform(cleanText).pipe(z.string().min(2).max(80)),
  email: z.string().email().max(254),
  subject: z.enum(['order', 'returns', 'product', 'payment', 'other']),
  message: z.string().transform(cleanText).pipe(z.string().min(10, 'Please add a little more detail').max(3000)),
  orderNumber: z.coerce.number().int().positive().optional(),
});

supportRouter.post(
  '/support',
  rateLimit({ windowMs: 60 * 60_000, limit: env.NODE_ENV === 'test' ? 1000 : 10, standardHeaders: 'draft-7', legacyHeaders: false }),
  asyncHandler(async (req, res) => {
    const b = parse(schema, req.body);
    const t = await one(
      `INSERT INTO support_tickets(user_id, email, name, subject, message, order_number)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at AS "createdAt"`,
      [req.user?.id ?? null, b.email, b.name, b.subject, b.message, b.orderNumber ?? null],
    );
    res.status(201).json({ ticket: t });
  }),
);
