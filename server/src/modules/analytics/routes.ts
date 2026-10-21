import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError, parse } from '../../lib/http.js';
import { requireAdmin } from '../../middleware/auth.js';
import * as A from './service.js';
import { buildInsights } from './insights.js';

export const analyticsRouter = Router();
analyticsRouter.use(requireAdmin);

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() + 5.5 * 3600_000 - n * 86_400_000).toISOString().slice(0, 10);

const filterSchema = z
  .object({
    from: date.optional(),
    to: date.optional(),
    granularity: z.enum(['day', 'week', 'month']).default('day'),
    category: z.string().max(60).optional().transform((v) => v || undefined),
    productId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
    includeDemo: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  })
  .transform((v) => ({ ...v, from: v.from ?? daysAgo(29), to: v.to ?? today() }))
  .refine((v) => v.from <= v.to, { message: 'from must be on or before to', path: ['from'] })
  .refine((v) => (new Date(v.to).getTime() - new Date(v.from).getTime()) / 86_400_000 <= 731, { message: 'Range is limited to two years', path: ['from'] });

const filters = (q: unknown): A.Filters => parse(filterSchema, q);

analyticsRouter.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const f = filters(req.query);
    const prev = A.previousWindow(f);
    const [current, previous, trend, categories, products, inventory, discounts, sources, provenance] = await Promise.all([
      A.summary(f),
      A.summary(prev),
      A.trend(f),
      A.byCategory(f),
      A.products(f),
      A.inventory(f),
      A.discounts(f),
      A.sources(f),
      A.dataProvenance(),
    ]);
    const under = A.underperformers(products);
    res.json({
      filters: f,
      previousWindow: { from: prev.from, to: prev.to },
      provenance,
      summary: current,
      previous,
      trend,
      categories,
      topProducts: products.filter((p) => p.units > 0).slice(0, 10),
      underperformers: under,
      inventory: { ...inventory, items: inventory.items.filter((i) => i.status !== 'ok').slice(0, 50) },
      discounts,
      sources,
      insights: buildInsights({ current, previous, categories, underperformers: under, inventory, discounts }),
    });
  }),
);

analyticsRouter.get(
  '/products',
  asyncHandler(async (req, res) => {
    res.json({ items: await A.products(filters(req.query)) });
  }),
);

analyticsRouter.get(
  '/inventory',
  asyncHandler(async (req, res) => {
    res.json(await A.inventory(filters(req.query)));
  }),
);

// --- CSV export -----------------------------------------------------------------

function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    if (v == null) return '';
    let s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
    // Neutralise spreadsheet formula injection.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

const REPORTS: Record<string, (f: A.Filters) => Promise<Record<string, unknown>[]>> = {
  summary: async (f) => [await A.summary(f)],
  trend: A.trend,
  categories: A.byCategory,
  products: A.products,
  inventory: async (f) => (await A.inventory(f)).items,
  discounts: async (f) => (await A.discounts(f)).items,
  sources: A.sources,
};

analyticsRouter.get(
  '/export/:report.csv',
  asyncHandler(async (req, res) => {
    const fn = REPORTS[req.params.report];
    if (!fn) throw new HttpError(404, 'Unknown report', 'not_found');
    const f = filters(req.query);
    const rows = await fn(f);
    const demo = f.includeDemo ? '# includes demo data (is_demo = true rows)\n' : '';
    res
      .type('text/csv')
      .set('Content-Disposition', `attachment; filename="${req.params.report}_${f.from}_${f.to}.csv"`)
      .send(`# ${req.params.report} ${f.from}..${f.to} (Asia/Kolkata); money in paise; definitions in docs/METRICS.md\n${demo}${toCsv(rows)}`);
  }),
);
