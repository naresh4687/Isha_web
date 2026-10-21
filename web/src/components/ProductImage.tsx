import { useEffect, useRef, useState } from 'react';

/** Local placeholder shown when both the photo and the generated illustration fail. Never fails itself. */
export const FALLBACK_IMAGE = '/assets/products/fallback.svg';

/** Local product photos are generated at 400 and 800 px wide (`…-400.webp`, `…-800.webp`). */
export function srcSetFor(src: string) {
  if (!src.startsWith('/assets/products/') || !src.endsWith('-800.webp')) return undefined;
  return `${src.slice(0, -'-800.webp'.length)}-400.webp 400w, ${src} 800w`;
}

/** Ordered sources to try: the image, then the product's illustration, then the local placeholder. */
export function fallbackChain(src: string, slug?: string) {
  const chain = [src];
  if (slug && !src.startsWith('/media/')) chain.push(`/media/products/${encodeURIComponent(slug)}/0.svg`);
  chain.push(FALLBACK_IMAGE);
  return [...new Set(chain.filter(Boolean))];
}

interface Props {
  src: string;
  alt: string;
  /** Enables the illustration fallback for this product. */
  slug?: string;
  /** Rendered width hint for responsive selection, e.g. "(min-width: 1024px) 25vw, 50vw". */
  sizes?: string;
  /** Above-the-fold images load eagerly; everything else is lazy. */
  eager?: boolean;
  width?: number;
  height?: number;
  /** Classes for the frame (shape, border, aspect ratio). */
  className?: string;
  /** Extra classes for the <img> (e.g. hover zoom). */
  imgClassName?: string;
}

/**
 * Product photo in a fixed-ratio frame: placeholder while loading, object-cover without stretching,
 * and a bounded fallback chain so a missing file never shows a broken-image icon or loops.
 */
export function ProductImage({ src, alt, slug, sizes = '(min-width: 1024px) 25vw, 50vw', eager, width = 800, height = 800, className = 'aspect-square', imgClassName = '' }: Props) {
  const chain = fallbackChain(src, slug);
  const [step, setStep] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  useEffect(() => { setStep(0); setLoaded(false); }, [src]);
  // A cached image can finish before React attaches onLoad.
  useEffect(() => { if (ref.current?.complete && ref.current.naturalWidth) setLoaded(true); }, [step, src]);

  const current = chain[Math.min(step, chain.length - 1)];
  const onError = () => {
    if (step < chain.length - 1) { setLoaded(false); setStep(step + 1); }
    else setLoaded(true); // last resort failed too: stop, keep the neutral frame
  };

  return (
    <span className={`relative block overflow-hidden bg-sunken ${className}`}>
      {!loaded && <span aria-hidden className="absolute inset-0 bg-sunken motion-safe:animate-pulse" />}
      <img
        ref={ref}
        key={current}
        src={current}
        srcSet={srcSetFor(current)}
        sizes={srcSetFor(current) ? sizes : undefined}
        alt={alt}
        width={width}
        height={height}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        // @ts-expect-error fetchpriority is valid HTML; React 18 types lag behind
        fetchpriority={eager ? 'high' : undefined}
        onLoad={() => setLoaded(true)}
        onError={onError}
        data-fallback={step > 0 ? step : undefined}
        className={`h-full w-full object-cover transition duration-300 ${loaded ? 'opacity-100' : 'opacity-0'} ${imgClassName}`}
      />
    </span>
  );
}
