import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../api/client';
import { StarIcon } from './Icons';
import { inr } from '../lib/format';

export function Rating({ value, count, size = 'sm' }: { value: number; count?: number; size?: 'sm' | 'md' }) {
  if (!count) return <span className="text-xs text-muted">No reviews yet</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-accent" aria-label={`Rated ${value.toFixed(1)} out of 5 from ${count} reviews`}>
      <span className="inline-flex">
        {[0, 1, 2, 3, 4].map((i) => (
          <StarIcon key={i} amount={Math.max(0, Math.min(1, value - i))} width={size === 'md' ? 18 : 14} height={size === 'md' ? 18 : 14} />
        ))}
      </span>
      <span className={`${size === 'md' ? 'text-sm' : 'text-xs'} text-muted`}>
        {value.toFixed(1)} ({count})
      </span>
    </span>
  );
}

export function Price({ price, compareAt, discountPct, large }: { price: number; compareAt?: number | null; discountPct?: number; large?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span className={large ? 'text-2xl font-medium' : 'font-medium'}>{inr(price)}</span>
      {compareAt ? (
        <>
          <s className="text-sm text-muted" aria-label={`was ${inr(compareAt)}`}>{inr(compareAt)}</s>
          {discountPct ? <span className="text-xs font-semibold text-accent">{discountPct}% off</span> : null}
        </>
      ) : null}
    </span>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-ink" />
      {label}
    </span>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center">
      <div aria-hidden className="mb-4 h-14 w-14 rounded-full border border-line bg-sunken" />
      <h2 className="text-2xl">{title}</h2>
      {body && <p className="mt-2 max-w-md text-muted">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof ApiError ? error.message : 'Something went wrong while loading this.';
  return (
    <div role="alert" className="card border-danger/30 px-6 py-8 text-center">
      <p className="font-medium text-danger">{msg}</p>
      {retry && (
        <button className="btn-ghost mt-4" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function InlineError({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof ApiError ? error.message : String((error as Error).message ?? error);
  return (
    <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
      {msg}
    </p>
  );
}

export function Field({ label, error, children, hint, htmlFor }: { label: string; error?: string; hint?: string; children: ReactNode; htmlFor: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {error && (
        <p id={`${htmlFor}-error`} className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null;
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1).filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1);
  return (
    <nav aria-label="Pagination" className="mt-10 flex items-center justify-center gap-1">
      <button className="btn-ghost px-3" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      {pages.map((p, i) => (
        <span key={p} className="flex items-center">
          {i > 0 && p - pages[i - 1] > 1 && <span className="px-1 text-muted">…</span>}
          <button
            className={`h-10 min-w-10 rounded-full px-3 text-sm ${p === page ? 'bg-ink text-canvas' : 'hover:bg-sunken'}`}
            aria-current={p === page ? 'page' : undefined}
            onClick={() => onPage(p)}
          >
            {p}
          </button>
        </span>
      ))}
      <button className="btn-ghost px-3" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </nav>
  );
}

export function QuantityStepper({ value, max, onChange, disabled, label = 'Quantity' }: { value: number; max: number; onChange: (n: number) => void; disabled?: boolean; label?: string }) {
  return (
    <div className="inline-flex items-center rounded-full border border-line bg-surface" role="group" aria-label={label}>
      <button type="button" className="h-10 w-10 rounded-full text-lg disabled:opacity-40" aria-label="Decrease quantity" disabled={disabled || value <= 1} onClick={() => onChange(value - 1)}>
        −
      </button>
      <span className="w-8 text-center text-sm tabular-nums" aria-live="polite">
        {value}
      </span>
      <button type="button" className="h-10 w-10 rounded-full text-lg disabled:opacity-40" aria-label="Increase quantity" disabled={disabled || value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-xs text-muted">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden>/</span>}
            {it.to ? <Link className="hover:text-ink" to={it.to}>{it.label}</Link> : <span aria-current="page" className="text-ink">{it.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'sage' | 'danger' }) {
  const tones = {
    neutral: 'bg-surface/90 text-ink border-line',
    accent: 'bg-accent text-accent-ink border-transparent',
    sage: 'bg-sage/15 text-sage border-sage/30',
    danger: 'bg-danger/10 text-danger border-danger/30',
  };
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${tones[tone]}`}>{children}</span>;
}
