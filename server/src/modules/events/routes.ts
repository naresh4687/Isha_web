import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import { z } from 'zod';
import { pool, query } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { asyncHandler, cleanText, HttpError, parse } from '../../lib/http.js';
import { SESSION_COOKIE, setSessionCookie } from '../../middleware/auth.js';

export const eventsRouter = Router();

/** Client-reportable events. Purchases are never accepted from clients; they come from verified orders. */
export const CLIENT_EVENT_TYPES = [
  'page_view', 'product_view', 'search', 'add_to_wishlist', 'remove_from_wishlist',
  'add_to_cart', 'remove_from_cart', 'begin_checkout', 'rec_impression', 'rec_click',
] as const;

const PRODUCT_EVENTS = new Set(['product_view', 'add_to_wishlist', 'remove_from_wishlist', 'add_to_cart', 'remove_from_cart', 'rec_click', 'rec_impression']);
const PLACEMENTS = ['personalized', 'similar', 'frequently_bought_together', 'trending', 'recently_viewed', 'continue_exploring'] as const;

// Data minimisation: metadata is limited to a few short, typed fields; free-form payloads are rejected.
const metadataSchema = z
  .object({
    path: z.string().max(200).regex(/^\/[^\s]*$/).optional(),
    q: z.string().max(100).transform(cleanText).optional(),
    position: z.number().int().min(0).max(100).optional(),
    resultCount: z.number().int().min(0).max(10000).optional(),
    modelVersion: z.string().max(40).optional(),
  })
  .strict()
  .default({});

const eventSchema = z
  .object({
    type: z.enum(CLIENT_EVENT_TYPES),
    productId: z.string().uuid().optional(),
    quantity: z.number().int().min(1).max(20).optional(),
    placement: z.enum(PLACEMENTS).optional(),
    metadata: metadataSchema,
  })
  .strict()
  .superRefine((e, ctx) => {
    if (PRODUCT_EVENTS.has(e.type) && !e.productId) {
      ctx.addIssue({ code: 'custom', message: `${e.type} requires productId`, path: ['productId'] });
    }
    if ((e.type === 'rec_click' || e.type === 'rec_impression') && !e.placement) {
      ctx.addIssue({ code: 'custom', message: `${e.type} requires placement`, path: ['placement'] });
    }
  });

const SOURCES = ['direct', 'organic_search', 'social', 'email', 'referral', 'paid_search', 'other'] as const;
const batchSchema = z
  .object({
    context: z
      .object({
        source: z.enum(SOURCES).default('direct'),
        medium: z.string().max(40).optional(),
        campaign: z.string().max(80).optional(),
        landingPath: z.string().max(200).optional(),
        device: z.enum(['mobile', 'tablet', 'desktop']).optional(),
      })
      .strict()
      .default({}),
    events: z.array(eventSchema).min(1).max(25),
  })
  .strict();

const limiter = rateLimit({
  windowMs: 60_000,
  limit: env.NODE_ENV === 'test' ? 10_000 : 120,
  keyGenerator: (req) => req.visitorId,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many events' } },
});

eventsRouter.post(
  '/events',
  limiter,
  asyncHandler(async (req, res) => {
    // Without analytics consent nothing is stored. The response says so, which keeps clients simple.
    if (!req.analyticsConsent) return res.status(202).json({ accepted: 0, reason: 'no_consent' });
    const body = parse(batchSchema, req.body);

    const productIds = [...new Set(body.events.map((e) => e.productId).filter(Boolean))] as string[];
    if (productIds.length) {
      const found = await query('SELECT id FROM products WHERE id = ANY($1::uuid[])', [productIds]);
      if (found.length !== productIds.length) {
        const known = new Set(found.map((r) => r.id));
        throw new HttpError(400, 'Unknown productId', 'validation_error', { unknown: productIds.filter((id) => !known.has(id)) });
      }
    }

    // 30-minute sliding analytics session.
    let sessionId: string = req.cookies?.[SESSION_COOKIE];
    const valid = typeof sessionId === 'string' && /^[a-f0-9-]{36}$/.test(sessionId);
    if (valid) {
      const upd = await pool.query(
        `UPDATE analytics_sessions SET last_seen_at = now(), user_id = coalesce(user_id, $2)
         WHERE id = $1 AND visitor_id = $3 AND last_seen_at > now() - interval '30 minutes'`,
        [sessionId, req.user?.id ?? null, req.visitorId],
      );
      if (upd.rowCount !== 1) sessionId = '';
    }
    if (!valid || !sessionId) {
      sessionId = crypto.randomUUID();
      const ctx = body.context;
      await pool.query(
        `INSERT INTO analytics_sessions(id, visitor_id, user_id, source, medium, campaign, landing_path, device)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [sessionId, req.visitorId, req.user?.id ?? null, ctx.source, ctx.medium ?? null, ctx.campaign ?? null, ctx.landingPath ?? null, ctx.device ?? null],
      );
    }
    setSessionCookie(res, sessionId);

    const params: unknown[] = [];
    const values = body.events.map((e) => {
      const row = [e.type, req.visitorId, sessionId, req.user?.id ?? null, e.productId ?? null, e.quantity ?? null, e.placement ?? null, JSON.stringify(e.metadata)];
      return `(${row.map((v) => (params.push(v), `$${params.length}`)).join(',')})`;
    });
    await pool.query(
      `INSERT INTO events(event_type, visitor_id, session_id, user_id, product_id, quantity, placement, metadata) VALUES ${values.join(',')}`,
      params,
    );
    res.status(202).json({ accepted: body.events.length });
  }),
);
