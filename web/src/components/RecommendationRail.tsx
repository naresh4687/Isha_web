import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { RecResponse } from '../api/types';
import { track } from '../lib/tracking';
import { ProductCard, ProductCardSkeleton } from './ProductCard';
import { useMe, useWishlist } from '../hooks/useStore';

interface Props {
  title: string;
  eyebrow?: string;
  endpoint: string;
  queryKey: unknown[];
  enabled?: boolean;
  showReasons?: boolean;
  viewAll?: string;
  hideWhenEmpty?: boolean;
}

export function RecommendationRail({ title, eyebrow, endpoint, queryKey, enabled = true, showReasons, viewAll, hideWhenEmpty = true }: Props) {
  const q = useQuery({ queryKey: ['rec', ...queryKey], queryFn: () => api<RecResponse>(endpoint), enabled, staleTime: 60_000 });
  const me = useMe();
  const wl = useWishlist(Boolean(me.data));
  const ref = useRef<HTMLElement>(null);
  const logged = useRef(false);

  // One impression event per product when the rail first becomes visible.
  useEffect(() => {
    const el = ref.current;
    if (!el || !q.data?.items.length || logged.current) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !logged.current) {
        logged.current = true;
        q.data!.items.forEach((it) =>
          track({ type: 'rec_impression', productId: it.product.id, placement: q.data!.placement, metadata: { position: it.position, modelVersion: q.data!.modelVersion ?? undefined } }),
        );
        io.disconnect();
      }
    }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, [q.data]);

  if (!enabled) return null;
  if (q.isError || (q.data && !q.data.items.length && hideWhenEmpty)) return null;

  return (
    <section ref={ref} aria-labelledby={`rail-${queryKey.join('-')}`} className="py-10">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
          <h2 id={`rail-${queryKey.join('-')}`} className="text-3xl">{title}</h2>
        </div>
        {viewAll && <Link to={viewAll} className="btn-link whitespace-nowrap">View all</Link>}
      </div>
      <div className={`-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-6 sm:overflow-visible sm:px-0 lg:grid-cols-4`}>
        {q.isLoading
          ? Array.from({ length: 4 }, (_, i) => <div key={i} className="w-[44vw] shrink-0 sm:w-auto"><ProductCardSkeleton /></div>)
          : q.data!.items.map((it) => (
              <div key={it.product.id} className="w-[44vw] shrink-0 snap-start sm:w-auto">
                <ProductCard
                  product={it.product}
                  placement={q.data!.placement}
                  position={it.position}
                  reason={showReasons ? it.reasons[0] : undefined}
                  wishlisted={wl.has(it.product.id)}
                  onWishlist={me.data ? (on) => wl.toggle.mutate({ productId: it.product.id, on }) : undefined}
                />
              </div>
            ))}
      </div>
    </section>
  );
}
