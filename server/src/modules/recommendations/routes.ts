import { Router, type Request } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { asyncHandler, HttpError, parse } from '../../lib/http.js';
import { requireAdmin, SESSION_COOKIE } from '../../middleware/auth.js';
import { cardsByIds } from '../catalog/service.js';

export const recommendationsRouter = Router();

interface MlItem {
  product_id: string;
  score: number;
  reasons: string[];
}
interface MlResponse {
  items: MlItem[];
  model_version?: string | null;
  strategy?: string;
}

export async function callMl<T = MlResponse>(path: string, params: Record<string, string | number | undefined> = {}, timeoutMs = 1500): Promise<T> {
  const url = new URL(path, env.ML_SERVICE_URL);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { 'X-Service-Token': env.ML_SERVICE_TOKEN }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`ML service ${res.status}`);
  return (await res.json()) as T;
}

const REASON_TEXT: Record<string, string> = {
  similar_content: 'Similar to items you viewed',
  similar_to_this: 'Similar style and use',
  bought_together: 'Often bought together',
  customers_also_engaged: 'Shoppers who liked your picks also liked this',
  category_preference: 'From a category you like',
  trending: 'Trending now',
  popular: 'Popular with customers',
  new_arrival: 'New arrival',
  same_category: 'From the same collection',
};

/** Hydrate ML output into product cards, enforcing eligibility (active + in stock) server-side. */
async function hydrate(placement: string, ml: MlResponse, k: number, exclude: string[] = []) {
  const ids = ml.items.map((i) => i.product_id).filter((id) => !exclude.includes(id));
  const cards = await cardsByIds(ids, { requireInStock: true });
  const meta = new Map(ml.items.map((i) => [i.product_id, i]));
  return {
    placement,
    source: 'model' as const,
    strategy: ml.strategy ?? null,
    modelVersion: ml.model_version ?? null,
    items: cards.slice(0, k).map((product, position) => ({
      product,
      position,
      score: Number(meta.get(product.id)!.score.toFixed(4)),
      reasons: meta.get(product.id)!.reasons.map((r) => REASON_TEXT[r] ?? r),
    })),
  };
}

/** Popularity fallback used when the ML service is unavailable: weighted recent interactions. */
async function fallbackTrending(k: number, opts: { category?: string; exclude?: string[]; sameCategoryAs?: string } = {}) {
  const rows = await query(
    `WITH recent AS (
       SELECT product_id, sum(CASE event_type WHEN 'product_view' THEN 1 WHEN 'add_to_wishlist' THEN 3 WHEN 'add_to_cart' THEN 4 ELSE 0 END) AS w
       FROM events WHERE created_at > now() - interval '14 days' AND product_id IS NOT NULL GROUP BY 1
       UNION ALL
       SELECT oi.product_id, sum(oi.quantity) * 8 FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.paid_at > now() - interval '14 days' GROUP BY 1
     )
     SELECT p.id, coalesce(sum(r.w), 0) AS score FROM products p JOIN categories c ON c.id = p.category_id
     LEFT JOIN recent r ON r.product_id = p.id
     WHERE p.is_active AND ($1::text IS NULL OR c.slug = $1) AND NOT (p.id = ANY($2::uuid[]))
       AND ($3::uuid IS NULL OR p.category_id = (SELECT category_id FROM products WHERE id = $3))
     GROUP BY p.id ORDER BY score DESC, p.rating_count DESC LIMIT $4`,
    [opts.category ?? null, opts.exclude ?? [], opts.sameCategoryAs ?? null, k * 2],
  );
  const max = Math.max(1, ...rows.map((r) => Number(r.score)));
  const cards = await cardsByIds(rows.map((r) => r.id), { requireInStock: true });
  const score = new Map(rows.map((r) => [r.id, Number(r.score) / max]));
  return cards.slice(0, k).map((product, position) => ({
    product,
    position,
    score: Number(score.get(product.id)!.toFixed(4)),
    reasons: [opts.sameCategoryAs ? REASON_TEXT.same_category : REASON_TEXT.popular],
  }));
}

const kSchema = z.coerce.number().int().min(1).max(24).default(8);
const idList = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').slice(0, 20) : []))
  .pipe(z.array(z.string().uuid()));

function identity(req: Request) {
  return {
    user_id: req.user?.id,
    // Server-side behavioural history is used only with analytics consent.
    session_id: req.analyticsConsent ? req.cookies?.[SESSION_COOKIE] : undefined,
    visitor_id: req.analyticsConsent ? req.visitorId : undefined,
  };
}

recommendationsRouter.get(
  '/personalized',
  asyncHandler(async (req, res) => {
    const q = parse(z.object({ k: kSchema, recent: idList, categories: z.string().max(400).optional() }), req.query);
    try {
      const ml = await callMl('/v1/recommend/personalized', { ...identity(req), k: q.k * 2, recent: q.recent.join(','), categories: q.categories });
      res.json(await hydrate('personalized', ml, q.k));
    } catch {
      res.json({ placement: 'personalized', source: 'fallback', strategy: 'popularity', modelVersion: null, items: await fallbackTrending(q.k) });
    }
  }),
);

recommendationsRouter.get(
  '/continue-exploring',
  asyncHandler(async (req, res) => {
    const q = parse(z.object({ k: kSchema, recent: idList }), req.query);
    try {
      const ml = await callMl('/v1/recommend/continue', { ...identity(req), k: q.k * 2, recent: q.recent.join(',') });
      res.json(await hydrate('continue_exploring', ml, q.k, q.recent));
    } catch {
      res.json({ placement: 'continue_exploring', source: 'fallback', strategy: 'popularity', modelVersion: null, items: [] });
    }
  }),
);

recommendationsRouter.get(
  '/products/:productId/similar',
  asyncHandler(async (req, res) => {
    const productId = parse(z.string().uuid(), req.params.productId);
    const { k } = parse(z.object({ k: kSchema }), req.query);
    try {
      const ml = await callMl(`/v1/recommend/similar/${productId}`, { k: k * 2 });
      res.json(await hydrate('similar', ml, k, [productId]));
    } catch {
      res.json({ placement: 'similar', source: 'fallback', strategy: 'same_category', modelVersion: null, items: await fallbackTrending(k, { exclude: [productId], sameCategoryAs: productId }) });
    }
  }),
);

recommendationsRouter.get(
  '/products/:productId/frequently-bought-together',
  asyncHandler(async (req, res) => {
    const productId = parse(z.string().uuid(), req.params.productId);
    const { k } = parse(z.object({ k: z.coerce.number().int().min(1).max(6).default(3) }), req.query);
    try {
      const ml = await callMl(`/v1/recommend/fbt/${productId}`, { k: k * 2 });
      res.json(await hydrate('frequently_bought_together', ml, k, [productId]));
    } catch {
      // No fabricated pairs: without the model's transaction analysis this placement stays empty.
      res.json({ placement: 'frequently_bought_together', source: 'fallback', strategy: null, modelVersion: null, items: [] });
    }
  }),
);

recommendationsRouter.get(
  '/trending',
  asyncHandler(async (req, res) => {
    const q = parse(z.object({ k: kSchema, category: z.string().max(60).optional() }), req.query);
    try {
      const ml = await callMl('/v1/recommend/trending', { k: q.k * 2, category: q.category });
      res.json(await hydrate('trending', ml, q.k));
    } catch {
      res.json({ placement: 'trending', source: 'fallback', strategy: 'popularity', modelVersion: null, items: await fallbackTrending(q.k, { category: q.category }) });
    }
  }),
);

recommendationsRouter.get(
  '/recently-viewed',
  asyncHandler(async (req, res) => {
    const { ids } = parse(z.object({ ids: idList }), req.query);
    const cards = await cardsByIds(ids);
    res.json({ placement: 'recently_viewed', source: 'client_history', items: cards.map((product, position) => ({ product, position, score: null, reasons: [] })) });
  }),
);

// --- Admin: model report, online metrics, BI ---------------------------------------

export const mlAdminRouter = Router();
mlAdminRouter.use(requireAdmin);

const proxy = (path: string, timeout = 15000) =>
  asyncHandler(async (req, res) => {
    try {
      res.json(await callMl(path, req.query as Record<string, string>, timeout));
    } catch (err) {
      throw new HttpError(503, `ML service unavailable (${(err as Error).message}). Start it with: cd ml && make serve`, 'ml_unavailable');
    }
  });

mlAdminRouter.get('/model', proxy('/v1/model'));
mlAdminRouter.get('/bi/rfm', proxy('/v1/bi/rfm'));
mlAdminRouter.get('/bi/segments', proxy('/v1/bi/segments'));
mlAdminRouter.get('/bi/forecast', proxy('/v1/bi/forecast'));
mlAdminRouter.get('/bi/demand', proxy('/v1/bi/demand'));
mlAdminRouter.get('/bi/affinity', proxy('/v1/bi/affinity'));

/** Online recommendation metrics from tracked impressions and clicks (post-deployment CTR / conversion). */
mlAdminRouter.get(
  '/online-metrics',
  asyncHandler(async (req, res) => {
    const { days, includeDemo } = parse(
      z.object({ days: z.coerce.number().int().min(1).max(365).default(30), includeDemo: z.enum(['true', 'false']).default('true') }),
      req.query,
    );
    const rows = await query(
      `WITH imp AS (
         SELECT placement, count(*) AS impressions FROM events
         WHERE event_type = 'rec_impression' AND created_at > now() - ($1 || ' days')::interval AND ($2::bool OR NOT is_demo) GROUP BY 1
       ),
       clk AS (
         SELECT e.placement, count(*) AS clicks,
                count(*) FILTER (WHERE EXISTS (
                  SELECT 1 FROM orders o JOIN order_items oi ON oi.order_id = o.id
                  WHERE o.analytics_session_id = e.session_id AND oi.product_id = e.product_id
                    AND o.paid_at BETWEEN e.created_at AND e.created_at + interval '24 hours')) AS purchases_24h
         FROM events e WHERE e.event_type = 'rec_click' AND e.created_at > now() - ($1 || ' days')::interval AND ($2::bool OR NOT e.is_demo) GROUP BY 1
       )
       SELECT coalesce(imp.placement, clk.placement) AS placement, coalesce(impressions, 0)::int AS impressions,
              coalesce(clicks, 0)::int AS clicks, coalesce(purchases_24h, 0)::int AS "purchases24h"
       FROM imp FULL JOIN clk USING (placement) ORDER BY 1`,
      [String(days), includeDemo === 'true'],
    );
    res.json({
      days,
      definition: 'CTR = rec_click / rec_impression events (each impression = one product shown in a placement). Purchase conversion = clicks followed by a paid order containing that product in the same session within 24h / clicks.',
      items: rows.map((r) => ({ ...r, ctr: r.impressions ? r.clicks / r.impressions : null, purchaseConversion: r.clicks ? r.purchases24h / r.clicks : null })),
    });
  }),
);
