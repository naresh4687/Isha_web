import { useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { Paged, ProductCard as P } from '../api/types';
import { useCategories, useMe, useWishlist } from '../hooks/useStore';
import { ProductCard, ProductCardSkeleton, ProductGrid } from '../components/ProductCard';
import { RecommendationRail } from '../components/RecommendationRail';
import { guestCategoryPrefs, recentlyViewed, setGuestCategoryPrefs } from '../lib/tracking';

function useProducts(key: string, query: string) {
  return useQuery({ queryKey: ['products', key], queryFn: () => api<Paged<P>>(`/api/products${query}`), staleTime: 60_000 });
}

function Section({ eyebrow, title, to, children }: { eyebrow?: string; title: string; to?: string; children: React.ReactNode }) {
  return (
    <section className="py-12">
      <div className="mb-7 flex items-end justify-between gap-4">
        <div>
          {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
          <h2 className="text-3xl sm:text-4xl">{title}</h2>
        </div>
        {to && <Link to={to} className="btn-link whitespace-nowrap">View all</Link>}
      </div>
      {children}
    </section>
  );
}

function ProductSection({ q }: { q: ReturnType<typeof useProducts> }) {
  const me = useMe();
  const wl = useWishlist(Boolean(me.data));
  return (
    <ProductGrid>
      {q.isLoading
        ? Array.from({ length: 4 }, (_, i) => <ProductCardSkeleton key={i} />)
        : (q.data?.items ?? []).map((p) => (
            <ProductCard key={p.id} product={p} wishlisted={wl.has(p.id)} onWishlist={me.data ? (on) => wl.toggle.mutate({ productId: p.id, on }) : undefined} />
          ))}
    </ProductGrid>
  );
}

function Hero() {
  const picks = useProducts('hero', '?sort=rating&pageSize=3&inStock=true');
  const imgs = picks.data?.items ?? [];
  return (
    <section className="page grid items-center gap-10 pb-6 pt-10 lg:grid-cols-[1.05fr_1fr] lg:pt-16">
      <div>
        <p className="eyebrow mb-4">Autumn edit</p>
        <h1 className="text-5xl leading-[1.02] sm:text-6xl lg:text-7xl">
          Considered goods
          <br />
          <em className="font-medium text-accent">for slower days</em>
        </h1>
        <p className="mt-6 max-w-lg text-lg text-muted">
          Hand-strung malas, handwoven mats, cold-pressed oils and quiet things for the home, made in small batches by people we know by name.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/collections/yoga-store" className="btn-primary px-7 py-3">Shop the practice edit</Link>
          <Link to="/collections/natural-food" className="btn-ghost px-7 py-3">Explore the pantry</Link>
        </div>
      </div>
      <div className="grid grid-cols-5 grid-rows-6 gap-3 sm:gap-4" style={{ aspectRatio: '1 / 0.95' }}>
        {[0, 1, 2].map((i) => {
          const p = imgs[i];
          const pos = ['col-span-3 row-span-6', 'col-span-2 row-span-3', 'col-span-2 row-span-3'][i];
          return p ? (
            <Link key={p.id} to={`/products/${p.slug}`} className={`${pos} group relative overflow-hidden rounded-3xl border border-line bg-sunken`}>
              <img src={`/media/products/${p.slug}/${i === 0 ? 1 : 0}.svg`} alt={p.title} className="h-full w-full object-cover transition duration-700 group-hover:scale-105" />
              {i === 0 && <span className="absolute bottom-4 left-4 rounded-full bg-surface/90 px-3 py-1.5 text-xs font-medium">{p.title}</span>}
            </Link>
          ) : (
            <div key={i} className={`${pos} skeleton rounded-3xl`} />
          );
        })}
      </div>
    </section>
  );
}

function CategoryTiles() {
  const cats = useCategories();
  const imgs = useQueries({
    queries: (cats.data ?? []).map((c) => ({
      queryKey: ['products', 'tile', c.slug],
      queryFn: () => api<Paged<P>>(`/api/products?category=${c.slug}&pageSize=1&sort=rating`),
      staleTime: 10 * 60_000,
    })),
  });
  return (
    <Section eyebrow="Browse" title="Shop by category">
      <ul className="grid grid-cols-3 gap-3 sm:gap-5 md:grid-cols-5 lg:grid-cols-9">
        {(cats.data ?? Array.from({ length: 9 }, () => null)).map((c, i) => (
          <li key={c?.slug ?? i}>
            {c ? (
              <Link to={`/collections/${c.slug}`} className="group block text-center">
                <span className="block overflow-hidden rounded-full border border-line bg-sunken">
                  {imgs[i]?.data?.items[0] ? (
                    <img src={`/media/products/${imgs[i].data!.items[0].slug}/2.svg`} alt="" className="aspect-square w-full object-cover transition duration-500 group-hover:scale-110" />
                  ) : (
                    <span className="block aspect-square" />
                  )}
                </span>
                <span className="mt-2.5 block text-[13px] font-medium leading-tight group-hover:text-accent">{c.name}</span>
              </Link>
            ) : (
              <div className="skeleton aspect-square rounded-full" />
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Optional cold-start preference picker for visitors without history. */
function PreferencePicker({ onSaved }: { onSaved: () => void }) {
  const cats = useCategories();
  const [sel, setSel] = useState<string[]>(guestCategoryPrefs());
  if (!cats.data) return null;
  return (
    <section className="card my-6 p-6 sm:p-8">
      <p className="eyebrow mb-1">Personalise</p>
      <h2 className="text-2xl">What are you here for?</h2>
      <p className="mt-1 text-sm text-muted">Optional. Pick a few and we'll tailor suggestions on this device.</p>
      <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Categories you are interested in">
        {cats.data.map((c) => {
          const on = sel.includes(c.slug);
          return (
            <button key={c.slug} type="button" aria-pressed={on} onClick={() => setSel(on ? sel.filter((x) => x !== c.slug) : [...sel, c.slug])}
              className={`rounded-full border px-4 py-2 text-sm transition ${on ? 'border-ink bg-ink text-canvas' : 'border-line bg-surface hover:border-ink/40'}`}>
              {c.name}
            </button>
          );
        })}
      </div>
      <button className="btn-primary mt-5" onClick={() => { setGuestCategoryPrefs(sel); onSaved(); }}>Save preferences</button>
    </section>
  );
}

export default function HomePage() {
  const best = useProducts('best', '?sort=bestselling&pageSize=8&inStock=true');
  const fresh = useProducts('new', '?sort=newest&pageSize=4');
  const gifts = useProducts('gifts', '?tag=gifting&pageSize=4&sort=rating');
  const recent = recentlyViewed();
  const [prefs, setPrefs] = useState(guestCategoryPrefs());
  const me = useMe();
  const hasSignal = recent.length > 0 || prefs.length > 0 || Boolean(me.data);
  const recQuery = `?k=8${recent.length ? `&recent=${recent.join(',')}` : ''}${prefs.length ? `&categories=${prefs.join(',')}` : ''}`;

  return (
    <>
      <Hero />
      <div className="page">
        <CategoryTiles />
        <Section eyebrow="Most loved" title="Bestsellers" to="/shop?sort=bestselling">
          <ProductSection q={best} />
        </Section>
        {hasSignal ? (
          <RecommendationRail title="Recommended for you" eyebrow="Picked for you" endpoint={`/api/recommendations/personalized${recQuery}`} queryKey={['personalized', recQuery, me.data?.id ?? 'anon']} showReasons />
        ) : (
          <PreferencePicker onSaved={() => setPrefs(guestCategoryPrefs())} />
        )}
        <section className="my-10 grid overflow-hidden rounded-3xl border border-line bg-surface md:grid-cols-2">
          <div className="flex flex-col justify-center p-8 sm:p-12">
            <p className="eyebrow mb-3">Curated</p>
            <h2 className="text-4xl">Gifts that feel personal</h2>
            <p className="mt-3 text-muted">Brass, copper, handloom and hand-strung pieces, wrapped in recycled paper.</p>
            <Link to="/shop?tag=gifting" className="btn-accent mt-6 self-start">Shop gifting</Link>
          </div>
          <div className="grid grid-cols-2 gap-4 bg-sunken/60 p-6">
            {(gifts.data?.items ?? []).slice(0, 4).map((p) => (
              <Link key={p.id} to={`/products/${p.slug}`} className="overflow-hidden rounded-2xl border border-line bg-sunken">
                <img src={p.image} alt={p.title} className="aspect-square w-full object-cover transition hover:scale-105" loading="lazy" />
              </Link>
            ))}
          </div>
        </section>
        <Section eyebrow="Just in" title="New arrivals" to="/shop?sort=newest">
          <ProductSection q={fresh} />
        </Section>
        <RecommendationRail title="Trending this week" eyebrow="What others are exploring" endpoint="/api/recommendations/trending?k=8" queryKey={['trending']} />
        {recent.length > 0 && (
          <>
            <RecommendationRail title="Continue exploring" endpoint={`/api/recommendations/continue-exploring?k=4&recent=${recent.join(',')}`} queryKey={['continue', recent.join(',')]} />
            <RecommendationRail title="Recently viewed" endpoint={`/api/recommendations/recently-viewed?ids=${recent.slice(0, 8).join(',')}`} queryKey={['recent', recent.join(',')]} />
          </>
        )}
        <section className="mt-12 grid gap-8 border-t border-line pt-12 sm:grid-cols-3">
          {[
            ['Made in small batches', 'We work directly with weavers, potters and farmer groups, and pay on time.'],
            ['Plastic-light packing', 'Paper, jute and cloth wherever we can; recyclable when we cannot.'],
            ['Honest descriptions', 'What it is, what it is made of, where it comes from. No miracle claims.'],
          ].map(([t, b]) => (
            <div key={t}>
              <h3 className="text-2xl">{t}</h3>
              <p className="mt-2 text-sm text-muted">{b}</p>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
