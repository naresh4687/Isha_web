import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart, useCartMutations, useMe } from '../hooks/useStore';
import { EmptyState, ErrorState, InlineError, QuantityStepper, Spinner } from '../components/ui';
import { RecommendationRail } from '../components/RecommendationRail';
import { inr } from '../lib/format';
import { ProductImage } from '../components/ProductImage';
import { recentlyViewed, track } from '../lib/tracking';

export default function CartPage() {
  const [code, setCode] = useState('');
  const [applied, setApplied] = useState<string>();
  const cart = useCart(applied);
  const { setQty } = useCartMutations();
  const me = useMe();
  const nav = useNavigate();

  if (cart.isLoading) return <div className="page py-16"><Spinner label="Loading your cart" /></div>;
  if (cart.isError) return <div className="page py-16"><ErrorState error={cart.error} retry={() => cart.refetch()} /></div>;
  const c = cart.data!;
  const t = c.totals;
  const toFree = t.freeShippingThresholdPaise - (t.subtotalPaise - t.discountPaise);
  const ids = c.lines.map((l) => l.productId);

  const checkout = () => {
    track({ type: 'begin_checkout' });
    const target = `/checkout${applied && !c.discount?.error ? `?code=${encodeURIComponent(applied)}` : ''}`;
    nav(me.data ? target : `/login?next=${encodeURIComponent(target)}`);
  };

  return (
    <div className="page pt-10">
      <h1 className="text-4xl sm:text-5xl">Your cart</h1>
      {c.lines.length === 0 ? (
        <div className="mt-8">
          <EmptyState title="Your cart is empty" body="Have a look around — there's plenty of good stuff." action={<Link className="btn-primary" to="/shop">Start shopping</Link>} />
          <RecommendationRail title="Trending this week" endpoint="/api/recommendations/trending?k=4" queryKey={['trending-cart']} />
        </div>
      ) : (
        <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_380px]">
          <ul className="divide-y divide-line border-y border-line" aria-label="Cart items">
            {c.lines.map((l) => (
              <li key={l.variantId} className="flex gap-4 py-5 sm:gap-6">
                <Link to={`/products/${l.slug}`} tabIndex={-1} aria-hidden="true" className="w-24 shrink-0 overflow-hidden rounded-xl border border-line sm:w-28">
                  <ProductImage src={l.image} alt="" slug={l.slug} fit={l.imageFit} sizes="112px" />
                </Link>
                <div className="flex flex-1 flex-col gap-2">
                  <div className="flex justify-between gap-4">
                    <div>
                      <Link to={`/products/${l.slug}`} className="font-medium hover:underline">{l.title}</Link>
                      {l.variantName !== 'Standard' && <p className="text-sm text-muted">{l.variantName}</p>}
                      <p className="text-sm text-muted">{inr(l.unitPricePaise)} each</p>
                    </div>
                    <p className="font-medium tabular-nums">{inr(l.lineTotalPaise)}</p>
                  </div>
                  {!l.available && <p className="text-sm text-danger" role="alert">{l.stock === 0 ? 'Out of stock — remove to continue.' : `Only ${l.stock} available — reduce the quantity.`}</p>}
                  <div className="mt-auto flex items-center gap-4">
                    <QuantityStepper value={l.quantity} max={Math.min(20, Math.max(l.stock, 1))} disabled={setQty.isPending} label={`Quantity for ${l.title}`}
                      onChange={(n) => setQty.mutate({ variantId: l.variantId, productId: l.productId, quantity: n })} />
                    <button className="btn-link text-muted" onClick={() => setQty.mutate({ variantId: l.variantId, productId: l.productId, quantity: 0 })}>Remove</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <aside className="card h-fit p-6 lg:sticky lg:top-36" aria-label="Order summary">
            <h2 className="text-2xl">Summary</h2>
            <form className="mt-5 flex gap-2" onSubmit={(e) => { e.preventDefault(); setApplied(code.trim() || undefined); }}>
              <label htmlFor="code" className="sr-only">Discount code</label>
              <input id="code" className="input" placeholder="Discount code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} />
              <button className="btn-ghost shrink-0">Apply</button>
            </form>
            {c.discount?.error && <p className="mt-2 text-sm text-danger" role="alert">{c.discount.error}</p>}
            {c.discount && !c.discount.error && <p className="mt-2 text-sm text-success" role="status">{c.discount.code} applied</p>}
            <dl className="mt-5 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="tabular-nums">{inr(t.subtotalPaise)}</dd></div>
              {t.discountPaise > 0 && <div className="flex justify-between text-success"><dt>Discount</dt><dd className="tabular-nums">−{inr(t.discountPaise)}</dd></div>}
              <div className="flex justify-between"><dt className="text-muted">Shipping</dt><dd className="tabular-nums">{t.shippingPaise ? inr(t.shippingPaise) : 'Free'}</dd></div>
              <div className="flex justify-between border-t border-line pt-3 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{inr(t.totalPaise)}</dd></div>
            </dl>
            {toFree > 0 && <p className="mt-3 text-xs text-muted">Add {inr(toFree)} more for free shipping.</p>}
            <p className="mt-1 text-xs text-muted">Prices include GST.</p>
            {setQty.error && <div className="mt-3"><InlineError error={setQty.error} /></div>}
            <button className="btn-primary mt-6 w-full py-3" disabled={c.hasUnavailable} onClick={checkout}>
              {me.data ? 'Checkout' : 'Sign in to checkout'}
            </button>
          </aside>
        </div>
      )}
      {c.lines.length > 0 && (
        <RecommendationRail title="Complete the set" endpoint={`/api/recommendations/continue-exploring?k=4&recent=${[...ids, ...recentlyViewed()].slice(0, 20).join(',')}`} queryKey={['cart-continue', ids.join(',')]} />
      )}
    </div>
  );
}
