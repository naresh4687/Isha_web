import { query, type Queryable, pool } from '../../db/pool.js';
import { env } from '../../config/env.js';

export interface ProductCard {
  id: string;
  slug: string;
  title: string;
  category: { slug: string; name: string };
  subcategory: string | null;
  pricePaise: number;
  compareAtPaise: number | null;
  discountPct: number;
  ratingAvg: number;
  ratingCount: number;
  inStock: boolean;
  lowStock: boolean;
  isNew: boolean;
  image: string;
  tags: string[];
}

/** Columns + joins producing a ProductCard row; the default variant sets the displayed price. */
export const CARD_SELECT = `
  p.id, p.slug, p.title, p.subcategory, p.tags, p.rating_avg AS "ratingAvg", p.rating_count AS "ratingCount",
  json_build_object('slug', c.slug, 'name', c.name) AS category,
  dv.price_paise AS "pricePaise", dv.compare_at_paise AS "compareAtPaise",
  coalesce(st.total_stock, 0) > 0 AS "inStock",
  coalesce(st.total_stock, 0) BETWEEN 1 AND ${Number(env.LOW_STOCK_THRESHOLD)} AS "lowStock",
  p.created_at > now() - interval '30 days' AS "isNew"`;

export const CARD_FROM = `
  FROM products p
  JOIN categories c ON c.id = p.category_id
  JOIN LATERAL (SELECT price_paise, compare_at_paise FROM product_variants
                WHERE product_id = p.id ORDER BY is_default DESC, sort_order LIMIT 1) dv ON true
  LEFT JOIN LATERAL (SELECT sum(stock) AS total_stock FROM product_variants WHERE product_id = p.id) st ON true`;

export function toCard(row: any): ProductCard {
  const compare = row.compareAtPaise && row.compareAtPaise > row.pricePaise ? row.compareAtPaise : null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    category: row.category,
    subcategory: row.subcategory,
    pricePaise: row.pricePaise,
    compareAtPaise: compare,
    discountPct: compare ? Math.round((1 - row.pricePaise / compare) * 100) : 0,
    ratingAvg: Number(row.ratingAvg),
    ratingCount: row.ratingCount,
    inStock: row.inStock,
    lowStock: row.lowStock,
    isNew: row.isNew,
    image: `/media/products/${row.slug}/0.svg`,
    tags: row.tags,
  };
}

export const SORTS = ['relevance', 'newest', 'price_asc', 'price_desc', 'rating', 'bestselling'] as const;
export type Sort = (typeof SORTS)[number];

export interface ListParams {
  q?: string;
  category?: string;
  subcategory?: string;
  tag?: string;
  minPrice?: number; // rupees
  maxPrice?: number;
  inStock?: boolean;
  minRating?: number;
  sort: Sort;
  page: number;
  pageSize: number;
  ids?: string[];
}

export async function listProducts(params: ListParams, client: Queryable = pool) {
  const where: string[] = ['p.is_active'];
  const args: unknown[] = [];
  const add = (v: unknown) => (args.push(v), `$${args.length}`);

  let rank = '0';
  if (params.q) {
    const q = add(params.q);
    where.push(`(p.search_vector @@ websearch_to_tsquery('english', ${q}) OR word_similarity(${q}, p.title) >= 0.5 OR p.title ILIKE '%' || ${q} || '%')`);
    rank = `(ts_rank(p.search_vector, websearch_to_tsquery('english', ${q})) + word_similarity(${q}, p.title))`;
  }
  if (params.category) where.push(`c.slug = ${add(params.category)}`);
  if (params.subcategory) where.push(`p.subcategory = ${add(params.subcategory)}`);
  if (params.tag) where.push(`${add(params.tag)} = ANY(p.tags)`);
  if (params.minPrice != null) where.push(`dv.price_paise >= ${add(Math.round(params.minPrice * 100))}`);
  if (params.maxPrice != null) where.push(`dv.price_paise <= ${add(Math.round(params.maxPrice * 100))}`);
  if (params.inStock) where.push('coalesce(st.total_stock, 0) > 0');
  if (params.minRating) where.push(`p.rating_avg >= ${add(params.minRating)}`);
  if (params.ids?.length) where.push(`p.id = ANY(${add(params.ids)}::uuid[])`);

  const sort = params.sort === 'relevance' && !params.q ? 'bestselling' : params.sort;
  const needsSales = sort === 'bestselling';
  const salesJoin = needsSales
    ? `LEFT JOIN LATERAL (SELECT coalesce(sum(oi.quantity), 0) AS units FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE oi.product_id = p.id AND o.paid_at > now() - interval '90 days'
           AND o.status NOT IN ('cancelled', 'refunded')) sales ON true`
    : '';
  const order: Record<Sort, string> = {
    relevance: `${rank} DESC, p.title`,
    newest: 'p.created_at DESC',
    price_asc: 'dv.price_paise ASC, p.title',
    price_desc: 'dv.price_paise DESC, p.title',
    rating: 'p.rating_avg DESC, p.rating_count DESC',
    bestselling: needsSales ? 'sales.units DESC, p.rating_count DESC, p.title' : 'p.title',
  };

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const [{ total }] = await query(`SELECT count(*)::int AS total ${CARD_FROM} ${whereSql}`, args, client);
  const limit = add(params.pageSize);
  const offset = add((params.page - 1) * params.pageSize);
  const rows = await query(
    `SELECT ${CARD_SELECT} ${CARD_FROM} ${salesJoin} ${whereSql} ORDER BY ${order[sort]}, p.id LIMIT ${limit} OFFSET ${offset}`,
    args,
    client,
  );
  return {
    items: rows.map(toCard),
    page: params.page,
    pageSize: params.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
  };
}

/** Hydrate product cards for a set of ids, preserving the given order and dropping ineligible products. */
export async function cardsByIds(ids: string[], opts: { requireInStock?: boolean } = {}) {
  if (!ids.length) return [];
  const rows = await query(
    `SELECT ${CARD_SELECT} ${CARD_FROM} WHERE p.is_active AND p.id = ANY($1::uuid[])
     ${opts.requireInStock ? 'AND coalesce(st.total_stock, 0) > 0' : ''}`,
    [ids],
  );
  const byId = new Map(rows.map((r) => [r.id, toCard(r)]));
  return ids.map((id) => byId.get(id)).filter(Boolean) as ProductCard[];
}
