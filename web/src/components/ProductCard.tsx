import { Link } from 'react-router-dom';
import type { ProductCard as P } from '../api/types';
import { Badge, Price, Rating } from './ui';
import { HeartIcon } from './Icons';
import { track } from '../lib/tracking';
import { ProductImage } from './ProductImage';

interface Props {
  product: P;
  onWishlist?: (on: boolean) => void;
  wishlisted?: boolean;
  placement?: string;
  position?: number;
  reason?: string;
}

export function ProductCard({ product: p, onWishlist, wishlisted, placement, position, reason }: Props) {
  const onClick = () => {
    if (placement) track({ type: 'rec_click', productId: p.id, placement, metadata: { position } });
  };
  return (
    <article className="group relative flex flex-col">
      <Link to={`/products/${p.slug}`} onClick={onClick} tabIndex={-1} aria-hidden="true" className="block overflow-hidden rounded-2xl border border-line">
        <ProductImage
          src={p.image}
          alt=""
          slug={p.slug}
          sizes="(min-width: 1024px) 22vw, (min-width: 768px) 30vw, 46vw"
          imgClassName={`motion-safe:duration-500 motion-safe:group-hover:scale-[1.03] ${p.inStock ? '' : 'grayscale-[30%] !opacity-60'}`}
        />
      </Link>
      <div className="pointer-events-none absolute left-3 top-3 flex flex-col items-start gap-1.5">
        {!p.inStock ? <Badge>Sold out</Badge> : p.discountPct ? <Badge tone="accent">{p.discountPct}% off</Badge> : p.isNew ? <Badge tone="sage">New</Badge> : null}
      </div>
      {onWishlist && (
        <button
          type="button"
          onClick={() => onWishlist(!wishlisted)}
          aria-pressed={wishlisted}
          aria-label={wishlisted ? `Remove ${p.title} from wishlist` : `Add ${p.title} to wishlist`}
          className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-surface/90 text-ink shadow-sm transition hover:text-accent"
        >
          <HeartIcon filled={wishlisted} width={18} height={18} />
        </button>
      )}
      <div className="mt-3 flex flex-1 flex-col gap-1">
        <p className="eyebrow">{p.category.name}</p>
        <h3 className="font-sans text-[15px] font-medium leading-snug">
          <Link to={`/products/${p.slug}`} onClick={onClick} className="hover:underline hover:decoration-line hover:underline-offset-4">
            {p.title}
          </Link>
        </h3>
        <Rating value={p.ratingAvg} count={p.ratingCount} />
        <div className="mt-auto pt-1">
          <Price price={p.pricePaise} compareAt={p.compareAtPaise} discountPct={p.discountPct} />
        </div>
        {p.inStock && p.lowStock && <p className="text-xs font-medium text-accent">Only a few left</p>}
        {reason && <p className="text-xs text-muted">{reason}</p>}
      </div>
    </article>
  );
}

export function ProductCardSkeleton() {
  return (
    <div aria-hidden>
      <div className="skeleton aspect-square w-full rounded-2xl" />
      <div className="skeleton mt-3 h-3 w-20" />
      <div className="skeleton mt-2 h-4 w-4/5" />
      <div className="skeleton mt-2 h-4 w-16" />
    </div>
  );
}

export function ProductGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 md:grid-cols-3 lg:grid-cols-4">{children}</div>;
}
