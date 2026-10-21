import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api/client';
import type { Paged, ProductCard as P } from '../api/types';
import { useCategories, useMe, useWishlist } from '../hooks/useStore';
import { ProductCard, ProductCardSkeleton, ProductGrid } from '../components/ProductCard';
import { Breadcrumbs, EmptyState, ErrorState, Pagination } from '../components/ui';
import { track } from '../lib/tracking';

const SORTS = [
  ['relevance', 'Featured'],
  ['bestselling', 'Bestselling'],
  ['newest', 'Newest'],
  ['price_asc', 'Price: low to high'],
  ['price_desc', 'Price: high to low'],
  ['rating', 'Top rated'],
] as const;

const PRICE_BANDS: [string, number | undefined, number | undefined][] = [
  ['Under ₹500', undefined, 500],
  ['₹500 – ₹1,500', 500, 1500],
  ['₹1,500 – ₹3,000', 1500, 3000],
  ['Over ₹3,000', 3000, undefined],
];

export default function ListingPage({ mode }: { mode: 'category' | 'search' | 'all' }) {
  const { slug } = useParams();
  const [sp, setSp] = useSearchParams();
  const cats = useCategories();
  const me = useMe();
  const wl = useWishlist(Boolean(me.data));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const cat = cats.data?.find((c) => c.slug === slug);

  const params = {
    q: mode === 'search' ? sp.get('q') ?? '' : undefined,
    category: mode === 'category' ? slug : sp.get('category') ?? undefined,
    subcategory: sp.get('subcategory') ?? undefined,
    tag: sp.get('tag') ?? undefined,
    minPrice: sp.get('minPrice') ?? undefined,
    maxPrice: sp.get('maxPrice') ?? undefined,
    inStock: sp.get('inStock') ?? undefined,
    minRating: sp.get('minRating') ?? undefined,
    sort: sp.get('sort') ?? (mode === 'search' ? 'relevance' : 'bestselling'),
    page: sp.get('page') ?? '1',
    pageSize: 12,
  };
  const searchEmpty = mode === 'search' && !params.q;
  const q = useQuery({
    queryKey: ['products', 'list', params],
    queryFn: () => api<Paged<P>>(`/api/products${qs(params)}`),
    placeholderData: keepPreviousData,
    enabled: !searchEmpty,
  });

  useEffect(() => {
    if (mode === 'search' && params.q && q.data && !q.isPlaceholderData) track({ type: 'search', metadata: { q: params.q, resultCount: q.data.total } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.q, q.data?.total]);

  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (!('page' in patch)) next.delete('page');
    setSp(next);
  };

  const title = mode === 'category' ? cat?.name ?? '' : mode === 'search' ? (params.q ? `Results for “${params.q}”` : 'Search') : params.tag ? `${params.tag[0].toUpperCase()}${params.tag.slice(1)}` : 'All products';
  const activeBand = PRICE_BANDS.findIndex(([, lo, hi]) => String(lo ?? '') === (params.minPrice ?? '') && String(hi ?? '') === (params.maxPrice ?? ''));

  const filters = (
    <div className="space-y-8">
      {mode === 'category' && cat && cat.subcategories.length > 0 && (
        <fieldset>
          <legend className="label">Type</legend>
          <div className="mt-2 flex flex-wrap gap-2 lg:flex-col lg:items-start">
            {[undefined, ...cat.subcategories].map((s) => (
              <button key={s ?? 'all'} type="button" aria-pressed={params.subcategory === s} onClick={() => set({ subcategory: s })}
                className={`rounded-full px-3 py-1.5 text-sm lg:px-0 lg:py-0.5 ${params.subcategory === s ? 'bg-ink text-canvas lg:bg-transparent lg:font-semibold lg:text-ink lg:underline lg:underline-offset-4' : 'border border-line lg:border-0 hover:text-accent'}`}>
                {s ?? 'All'}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {mode !== 'category' && cats.data && (
        <div>
          <label className="label" htmlFor="f-category">Category</label>
          <select id="f-category" className="input" value={params.category ?? ''} onChange={(e) => set({ category: e.target.value || undefined, subcategory: undefined })}>
            <option value="">All categories</option>
            {cats.data.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        </div>
      )}
      <fieldset>
        <legend className="label">Price</legend>
        <div className="mt-2 space-y-2">
          {PRICE_BANDS.map(([label, lo, hi], i) => (
            <label key={label} className="flex cursor-pointer items-center gap-2.5 text-sm">
              <input type="radio" name="price" className="accent-[rgb(var(--accent))]" checked={activeBand === i}
                onChange={() => set({ minPrice: lo?.toString(), maxPrice: hi?.toString() })} />
              {label}
            </label>
          ))}
          {activeBand >= 0 && <button className="btn-link" onClick={() => set({ minPrice: undefined, maxPrice: undefined })}>Clear price</button>}
        </div>
      </fieldset>
      <fieldset>
        <legend className="label">Availability & rating</legend>
        <label className="mt-2 flex cursor-pointer items-center gap-2.5 text-sm">
          <input type="checkbox" className="accent-[rgb(var(--accent))]" checked={params.inStock === 'true'} onChange={(e) => set({ inStock: e.target.checked ? 'true' : undefined })} />
          In stock only
        </label>
        <label className="mt-2 flex cursor-pointer items-center gap-2.5 text-sm">
          <input type="checkbox" className="accent-[rgb(var(--accent))]" checked={params.minRating === '4'} onChange={(e) => set({ minRating: e.target.checked ? '4' : undefined })} />
          4 stars & up
        </label>
      </fieldset>
    </div>
  );

  return (
    <div className="page pb-10 pt-8">
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, ...(mode === 'category' ? [{ label: 'Shop', to: '/shop' }, { label: cat?.name ?? '…' }] : [{ label: mode === 'search' ? 'Search' : 'Shop' }])]} />
      <header className="mb-8 mt-4 max-w-3xl">
        <h1 className="text-4xl sm:text-5xl">{title || <span aria-hidden className="skeleton inline-block h-[1em] w-56 align-middle" />}</h1>
        {mode === 'category' && (cat ? <p className="mt-3 text-muted">{cat.description}</p> : <p aria-hidden className="skeleton mt-3 h-6 w-2/3" />)}
      </header>

      {mode === 'search' && (
        <form className="mb-8 max-w-xl md:hidden" role="search" onSubmit={(e) => { e.preventDefault(); const v = new FormData(e.currentTarget).get('q'); set({ q: String(v ?? '') }); }}>
          <label htmlFor="q-mobile" className="sr-only">Search</label>
          <input id="q-mobile" name="q" defaultValue={params.q} className="input rounded-full" placeholder="Search products" />
        </form>
      )}

      <div className="flex items-center justify-between gap-4 border-y border-line py-3">
        <button className="btn-ghost px-4 py-2 lg:hidden" onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen} aria-controls="filters">
          Filters
        </button>
        <p className="hidden text-sm text-muted lg:block" aria-live="polite">{q.data ? `${q.data.total} product${q.data.total === 1 ? '' : 's'}` : ''}</p>
        <div className="flex items-center gap-2">
          <label htmlFor="sort" className="text-sm text-muted">Sort</label>
          <select id="sort" className="input w-auto py-2" value={params.sort} onChange={(e) => set({ sort: e.target.value })}>
            {SORTS.filter(([v]) => v !== 'relevance' || mode === 'search').map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-[220px_1fr]">
        <aside id="filters" className={`${filtersOpen ? 'block' : 'hidden'} lg:block`} aria-label="Filters">{filters}</aside>
        <div>
          {searchEmpty ? (
            <EmptyState title="What are you looking for?" body="Search by product, material or use — for example “copper”, “millet” or “cushion”." />
          ) : q.isError ? (
            <ErrorState error={q.error} retry={() => q.refetch()} />
          ) : q.data && q.data.items.length === 0 ? (
            <EmptyState title="Nothing matches yet" body="Try removing a filter or searching for something broader." action={<button className="btn-ghost" onClick={() => setSp(mode === 'search' ? { q: params.q ?? '' } : {})}>Clear filters</button>} />
          ) : (
            <div className={q.isPlaceholderData ? 'opacity-60 transition-opacity' : ''} aria-busy={q.isFetching}>
              <ProductGrid>
                {q.isLoading
                  ? Array.from({ length: 8 }, (_, i) => <ProductCardSkeleton key={i} />)
                  : q.data!.items.map((p) => (
                      <ProductCard key={p.id} product={p} wishlisted={wl.has(p.id)} onWishlist={me.data ? (on) => wl.toggle.mutate({ productId: p.id, on }) : undefined} />
                    ))}
              </ProductGrid>
              {q.data && <Pagination page={q.data.page} totalPages={q.data.totalPages} onPage={(p) => { set({ page: String(p) }); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />}
            </div>
          )}
          {mode === 'category' && slug === 'health-and-immunity' && (
            <p className="mt-10 text-xs text-muted">These products are foods and botanicals. They are not intended to diagnose, treat, cure or prevent any disease. Consult a qualified practitioner before using herbal products if you are pregnant, nursing, or taking medication.</p>
          )}
        </div>
      </div>
    </div>
  );
}
