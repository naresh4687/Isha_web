import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { Paged, ProductDetail, Review } from '../api/types';
import { useCartMutations, useMe, useWishlist } from '../hooks/useStore';
import { Breadcrumbs, ErrorState, Field, InlineError, Price, QuantityStepper, Rating, Spinner } from '../components/ui';
import { HeartIcon, StarIcon } from '../components/Icons';
import { RecommendationRail } from '../components/RecommendationRail';
import { pushRecentlyViewed, recentlyViewed, track } from '../lib/tracking';
import { date } from '../lib/format';

function Gallery({ images, title }: { images: string[]; title: string }) {
  const [i, setI] = useState(0);
  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row">
      <div className="flex gap-3 sm:flex-col" role="tablist" aria-label="Product images">
        {images.map((src, n) => (
          <button key={src} role="tab" aria-selected={i === n} aria-label={`Image ${n + 1} of ${images.length}`} onClick={() => setI(n)}
            className={`w-16 overflow-hidden rounded-xl border bg-sunken sm:w-20 ${i === n ? 'border-ink' : 'border-line opacity-70 hover:opacity-100'}`}>
            <img src={src} alt="" className="aspect-square w-full object-cover" />
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-hidden rounded-3xl border border-line bg-sunken">
        <img src={images[i]} alt={`${title}, view ${i + 1}`} className="aspect-square w-full object-cover" width={600} height={600} />
      </div>
    </div>
  );
}

function Reviews({ product }: { product: ProductDetail }) {
  const me = useMe();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('recent');
  const list = useQuery({ queryKey: ['reviews', product.id, page, sort], queryFn: () => api<Paged<Review>>(`/api/products/${product.id}/reviews?page=${page}&sort=${sort}`) });
  const [form, setForm] = useState({ rating: 0, title: '', body: '' });
  const submit = useMutation({
    mutationFn: () => api(`/api/products/${product.id}/reviews`, { method: 'POST', json: form }),
    onSuccess: () => {
      setForm({ rating: 0, title: '', body: '' });
      qc.invalidateQueries({ queryKey: ['reviews', product.id] });
      qc.invalidateQueries({ queryKey: ['product', product.slug] });
    },
  });
  const fe = submit.error instanceof ApiError ? submit.error.fieldErrors() : {};
  const total = Object.values(product.ratingDistribution).reduce((a, b) => a + b, 0);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.rating) return;
    submit.mutate();
  };

  return (
    <section aria-labelledby="reviews" className="grid gap-10 border-t border-line py-14 lg:grid-cols-[320px_1fr]">
      <div>
        <h2 id="reviews" className="text-3xl">Reviews</h2>
        <div className="mt-4"><Rating value={product.ratingAvg} count={product.ratingCount} size="md" /></div>
        {total > 0 && (
          <dl className="mt-5 space-y-1.5">
            {[5, 4, 3, 2, 1].map((r) => (
              <div key={r} className="flex items-center gap-3 text-sm">
                <dt className="w-10 text-muted">{r} star</dt>
                <dd className="h-2 flex-1 overflow-hidden rounded-full bg-sunken"><div className="h-full rounded-full bg-accent" style={{ width: `${(product.ratingDistribution[r] / total) * 100}%` }} /></dd>
                <span className="w-8 text-right tabular-nums text-muted">{product.ratingDistribution[r]}</span>
              </div>
            ))}
          </dl>
        )}
        {me.data ? (
          <form onSubmit={onSubmit} className="card mt-8 space-y-4 p-5" noValidate>
            <h3 className="font-sans text-base font-semibold">Write a review</h3>
            <fieldset>
              <legend className="label">Your rating</legend>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((r) => (
                  <button key={r} type="button" aria-label={`${r} star${r > 1 ? 's' : ''}`} aria-pressed={form.rating === r} onClick={() => setForm({ ...form, rating: r })} className="text-accent">
                    <StarIcon amount={form.rating >= r ? 1 : 0} width={26} height={26} />
                  </button>
                ))}
              </div>
              {submit.isError && !form.rating && <p className="text-xs text-danger">Choose a rating</p>}
            </fieldset>
            <Field label="Title" htmlFor="r-title" error={fe.title}>
              <input id="r-title" className="input" value={form.title} maxLength={120} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            </Field>
            <Field label="Review" htmlFor="r-body" error={fe.body} hint="At least 10 characters. Plain text only.">
              <textarea id="r-body" className="input min-h-28" value={form.body} maxLength={2000} onChange={(e) => setForm({ ...form, body: e.target.value })} required />
            </Field>
            {submit.error && !Object.keys(fe).length && <InlineError error={submit.error} />}
            {submit.isSuccess && <p className="text-sm text-success" role="status">Thanks — your review is live.</p>}
            <button className="btn-primary w-full" disabled={submit.isPending || !form.rating}>{submit.isPending ? 'Posting…' : 'Post review'}</button>
          </form>
        ) : (
          <p className="mt-8 text-sm text-muted"><Link className="btn-link" to="/login">Sign in</Link> to write a review.</p>
        )}
      </div>
      <div>
        {list.data && list.data.total > 0 && (
          <div className="mb-4 flex justify-end">
            <label className="sr-only" htmlFor="rsort">Sort reviews</label>
            <select id="rsort" className="input w-auto py-2" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
              <option value="recent">Most recent</option>
              <option value="highest">Highest rated</option>
              <option value="lowest">Lowest rated</option>
            </select>
          </div>
        )}
        {list.isLoading ? <Spinner /> : list.isError ? <ErrorState error={list.error} retry={() => list.refetch()} /> : list.data!.items.length === 0 ? (
          <p className="text-muted">No reviews yet. Be the first to share what you think.</p>
        ) : (
          <ul className="divide-y divide-line">
            {list.data!.items.map((r) => (
              <li key={r.id} className="py-6">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex text-accent" aria-label={`${r.rating} out of 5 stars`}>{[1, 2, 3, 4, 5].map((i) => <StarIcon key={i} amount={r.rating >= i ? 1 : 0} />)}</span>
                  {r.verifiedPurchase && <span className="text-xs font-medium text-sage">Verified purchase</span>}
                </div>
                <h3 className="mt-2 font-sans text-base font-semibold">{r.title}</h3>
                <p className="mt-1 whitespace-pre-line text-sm text-ink/85">{r.body}</p>
                <p className="mt-2 text-xs text-muted">{r.author} · {date(r.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
        {list.data && list.data.totalPages > 1 && (
          <div className="mt-4 flex gap-2">
            <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <button className="btn-ghost" disabled={page >= list.data.totalPages} onClick={() => setPage(page + 1)}>More reviews</button>
          </div>
        )}
      </div>
    </section>
  );
}

export default function ProductPage() {
  const { slug } = useParams();
  const q = useQuery({ queryKey: ['product', slug], queryFn: () => api<{ product: ProductDetail }>(`/api/products/${slug}`).then((r) => r.product) });
  const p = q.data;
  const me = useMe();
  const wl = useWishlist(Boolean(me.data));
  const { add } = useCartMutations();
  const [variantId, setVariantId] = useState<string>();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [recent] = useState(() => recentlyViewed().filter((id) => id !== p?.id));

  useEffect(() => {
    if (!p) return;
    setVariantId(p.variants.find((v) => v.isDefault && v.inStock)?.id ?? p.variants.find((v) => v.inStock)?.id ?? p.variants[0]?.id);
    setQty(1);
    track({ type: 'product_view', productId: p.id });
    pushRecentlyViewed(p.id);
    document.title = p.title;
  }, [p?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isLoading)
    return (
      <div className="page grid gap-10 pt-10 lg:grid-cols-2" aria-busy>
        <div className="skeleton aspect-square rounded-3xl" />
        <div className="space-y-4"><div className="skeleton h-10 w-3/4" /><div className="skeleton h-6 w-32" /><div className="skeleton h-24 w-full" /></div>
      </div>
    );
  if (q.isError || !p)
    return (
      <div className="page py-16">
        {q.error instanceof ApiError && q.error.status === 404 ? (
          <div className="text-center"><h1 className="text-4xl">This product isn't available</h1><p className="mt-3 text-muted">It may have sold out for good or moved.</p><Link className="btn-primary mt-6" to="/shop">Browse the shop</Link></div>
        ) : <ErrorState error={q.error} retry={() => q.refetch()} />}
      </div>
    );

  const variant = p.variants.find((v) => v.id === variantId) ?? p.variants[0];
  const discount = variant.compareAtPaise && variant.compareAtPaise > variant.pricePaise ? Math.round((1 - variant.pricePaise / variant.compareAtPaise) * 100) : 0;
  const onAdd = () =>
    add.mutate({ variantId: variant.id, productId: p.id, quantity: qty }, { onSuccess: () => { setAdded(true); setTimeout(() => setAdded(false), 2500); } });

  return (
    <div className="page pt-8">
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: p.category.name, to: `/collections/${p.category.slug}` }, { label: p.title }]} />
      <div className="mt-6 grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        <Gallery images={p.images} title={p.title} />
        <div className="lg:pt-4">
          <p className="eyebrow">{p.category.name}{p.subcategory ? ` · ${p.subcategory}` : ''}</p>
          <h1 className="mt-2 text-4xl leading-tight sm:text-5xl">{p.title}</h1>
          <div className="mt-3"><a href="#reviews"><Rating value={p.ratingAvg} count={p.ratingCount} size="md" /></a></div>
          <div className="mt-5"><Price price={variant.pricePaise} compareAt={discount ? variant.compareAtPaise : null} discountPct={discount} large /></div>
          <p className="mt-1 text-xs text-muted">Inclusive of all taxes</p>

          {p.variants.length > 1 && (
            <fieldset className="mt-7">
              <legend className="label">{p.category.slug === 'clothing' ? 'Size' : 'Option'}: <span className="normal-case tracking-normal text-ink">{variant.name}</span></legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {p.variants.map((v) => (
                  <button key={v.id} type="button" onClick={() => { setVariantId(v.id); setQty(1); }} aria-pressed={v.id === variant.id} disabled={!v.inStock}
                    className={`min-w-12 rounded-full border px-4 py-2 text-sm transition ${v.id === variant.id ? 'border-ink bg-ink text-canvas' : 'border-line bg-surface hover:border-ink/40'} disabled:cursor-not-allowed disabled:line-through disabled:opacity-40`}>
                    {v.name}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <div className="mt-6">
            {variant.inStock ? (
              <p className="text-sm font-medium text-sage">{variant.maxQuantity <= 5 ? `In stock — only ${variant.maxQuantity} left` : 'In stock, ships in 1–2 days'}</p>
            ) : (
              <p className="text-sm font-medium text-danger">Out of stock</p>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <QuantityStepper value={qty} max={Math.max(1, variant.maxQuantity)} onChange={setQty} disabled={!variant.inStock} />
            <button className="btn-primary flex-1 py-3" disabled={!variant.inStock || add.isPending} onClick={onAdd}>
              {add.isPending ? 'Adding…' : variant.inStock ? 'Add to cart' : 'Sold out'}
            </button>
            {me.data ? (
              <button className="btn-ghost h-12 w-12 p-0" aria-pressed={wl.has(p.id)} aria-label={wl.has(p.id) ? 'Remove from wishlist' : 'Add to wishlist'} onClick={() => wl.toggle.mutate({ productId: p.id, on: !wl.has(p.id) })}>
                <HeartIcon filled={wl.has(p.id)} />
              </button>
            ) : null}
          </div>
          <div aria-live="polite" className="mt-3 min-h-6">
            {added && <p className="text-sm text-success">Added to your cart. <Link to="/cart" className="btn-link">View cart</Link></p>}
            {add.error && <InlineError error={add.error} />}
          </div>

          <div className="mt-8 space-y-6 border-t border-line pt-8">
            <p className="text-[15px] leading-7">{p.description}</p>
            {Object.keys(p.attributes).length > 0 && (
              <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">
                {Object.entries(p.attributes).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="capitalize text-muted">{k.replace(/([A-Z])/g, ' $1')}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            <details className="border-t border-line pt-4 text-sm">
              <summary className="cursor-pointer font-medium">Shipping & returns</summary>
              <p className="mt-2 text-muted">Free shipping on orders above ₹999, otherwise ₹79. Dispatched in 1–2 working days. Unused items can be returned within 7 days of delivery; food and opened body care are non-returnable.</p>
            </details>
          </div>
        </div>
      </div>

      <RecommendationRail title="Frequently bought together" eyebrow="Based on real orders" endpoint={`/api/recommendations/products/${p.id}/frequently-bought-together?k=3`} queryKey={['fbt', p.id]} />
      <RecommendationRail title="You may also like" eyebrow="Similar products" endpoint={`/api/recommendations/products/${p.id}/similar?k=8`} queryKey={['similar', p.id]} />
      <Reviews product={p} />
      {recent.length > 0 && <RecommendationRail title="Recently viewed" endpoint={`/api/recommendations/recently-viewed?ids=${recent.slice(0, 8).join(',')}`} queryKey={['recent-pdp', recent.join(',')]} />}
    </div>
  );
}
