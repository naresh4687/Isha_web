import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { Order } from '../api/types';
import { useCart, useMe, useSettings } from '../hooks/useStore';
import { ErrorState, Field, InlineError, Spinner } from '../components/ui';
import { ProductImage } from '../components/ProductImage';
import { inr } from '../lib/format';

interface CheckoutConfig {
  payments: { provider: 'razorpay' | 'mock' | null; available: boolean; testMode: boolean; message?: string };
  states: string[];
}

interface CheckoutResult {
  orderId: string;
  orderNumber: number;
  payment: { provider: 'razorpay' | 'mock'; testMode: boolean; providerOrderId: string; keyId?: string; amountPaise: number; currency: string };
}

const EMPTY = { fullName: '', phone: '', line1: '', line2: '', city: '', state: '', postalCode: '' };

/** Client-side checks mirror the server schema for instant feedback; the server remains authoritative. */
export function validateAddress(a: typeof EMPTY) {
  const e: Partial<Record<keyof typeof EMPTY, string>> = {};
  if (a.fullName.trim().length < 2) e.fullName = 'Enter the recipient’s full name';
  if (!/^[6-9]\d{9}$/.test(a.phone.replace(/[\s-]/g, '').replace(/^(\+91|0)/, ''))) e.phone = 'Enter a valid 10-digit Indian mobile number';
  if (a.line1.trim().length < 3) e.line1 = 'Enter a street address';
  if (a.city.trim().length < 2) e.city = 'Enter a city';
  if (!a.state) e.state = 'Select a state or union territory';
  if (!/^[1-9]\d{5}$/.test(a.postalCode.trim())) e.postalCode = 'Enter a valid 6-digit PIN code';
  return e;
}

function loadRazorpay(): Promise<any> {
  return new Promise((resolve, reject) => {
    if ((window as any).Razorpay) return resolve((window as any).Razorpay);
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve((window as any).Razorpay);
    s.onerror = () => reject(new Error('Could not load the payment window. Check your connection and try again.'));
    document.body.appendChild(s);
  });
}

export default function CheckoutPage() {
  const [sp] = useSearchParams();
  const code = sp.get('code') ?? undefined;
  const me = useMe();
  const brand = useSettings().data?.brand?.name ?? 'Store';
  const cart = useCart(code);
  const qc = useQueryClient();
  const nav = useNavigate();
  const config = useQuery({ queryKey: ['checkout-config'], queryFn: () => api<CheckoutConfig>('/api/checkout/config') });
  const saved = useQuery({ queryKey: ['addresses'], queryFn: () => api<{ addresses: (typeof EMPTY & { id: string })[] }>('/api/addresses').then((r) => r.addresses), enabled: Boolean(me.data) });
  const [addr, setAddr] = useState(EMPTY);
  const [save, setSave] = useState(true);
  const [errors, setErrors] = useState<Partial<Record<keyof typeof EMPTY, string>>>({});
  const [pending, setPending] = useState<CheckoutResult | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

  useEffect(() => {
    const a = saved.data?.[0];
    if (a) setAddr({ fullName: a.fullName, phone: a.phone, line1: a.line1, line2: a.line2 ?? '', city: a.city, state: a.state, postalCode: a.postalCode });
  }, [saved.data]);

  const finish = (order: Order) => {
    qc.invalidateQueries({ queryKey: ['cart'] });
    qc.invalidateQueries({ queryKey: ['orders'] });
    nav(`/orders/${order.id}?placed=1`, { replace: true });
  };

  const fail = async (orderId: string, reason: string) => {
    try {
      await api('/api/payments/failure', { method: 'POST', json: { orderId, reason } });
    } catch {
      /* the reservation also expires automatically */
    }
    setPending(null);
    setPayError('Payment was not completed, so you have not been charged. Your cart is unchanged — you can try again.');
    qc.invalidateQueries({ queryKey: ['cart'] });
  };

  const place = useMutation({
    mutationFn: () => api<CheckoutResult>('/api/checkout', { method: 'POST', json: { address: { ...addr, line2: addr.line2 || undefined }, discountCode: code, saveAddress: save } }),
    onSuccess: async (r) => {
      setPayError(null);
      if (r.payment.provider === 'mock') return setPending(r);
      try {
        const Razorpay = await loadRazorpay();
        const rzp = new Razorpay({
          key: r.payment.keyId,
          order_id: r.payment.providerOrderId,
          amount: r.payment.amountPaise,
          currency: r.payment.currency,
          name: brand,
          description: `Order #${r.orderNumber}`,
          prefill: { name: addr.fullName, email: me.data?.email, contact: addr.phone },
          handler: async (resp: any) => {
            try {
              const v = await api<{ order: Order }>('/api/payments/razorpay/verify', {
                method: 'POST',
                json: { orderId: r.orderId, razorpayOrderId: resp.razorpay_order_id, razorpayPaymentId: resp.razorpay_payment_id, razorpaySignature: resp.razorpay_signature },
              });
              finish(v.order);
            } catch (e) {
              setPayError(e instanceof ApiError ? e.message : 'We could not confirm the payment. If money was deducted, it will be reconciled automatically.');
            }
          },
          modal: { ondismiss: () => fail(r.orderId, 'dismissed') },
        });
        rzp.on('payment.failed', (resp: any) => fail(r.orderId, resp?.error?.description ?? 'payment_failed'));
        rzp.open();
      } catch (e) {
        fail(r.orderId, 'checkout_script_failed');
        setPayError((e as Error).message);
      }
    },
  });

  const simulate = useMutation({
    mutationFn: (outcome: 'success' | 'failure') => api<{ order: Order }>('/api/payments/mock/complete', { method: 'POST', json: { orderId: pending!.orderId, outcome } }),
    onSuccess: (r) => {
      if (r.order.status === 'paid') finish(r.order);
      else {
        setPending(null);
        setPayError('Simulated payment failure: nothing was charged and your stock reservation was released. You can try again.');
        qc.invalidateQueries({ queryKey: ['cart'] });
      }
    },
  });

  if (me.isLoading || cart.isLoading || config.isLoading) return <div className="page py-16"><Spinner /></div>;
  if (!me.data) return <Navigate to={`/login?next=${encodeURIComponent('/checkout')}`} replace />;
  if (cart.isError || config.isError) return <div className="page py-16"><ErrorState error={cart.error ?? config.error} /></div>;
  const c = cart.data!;
  if (!c.lines.length && !pending) return <Navigate to="/cart" replace />;
  const pay = config.data!.payments;
  const serverErrors = place.error instanceof ApiError ? place.error.details?.fieldErrors?.address : undefined;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = validateAddress(addr);
    setErrors(v);
    if (Object.keys(v).length) {
      document.getElementById(`a-${Object.keys(v)[0]}`)?.focus();
      return;
    }
    place.mutate();
  };

  const input = (key: keyof typeof EMPTY, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <Field label={label} htmlFor={`a-${key}`} error={errors[key]}>
      <input id={`a-${key}`} className={`input ${errors[key] ? 'border-danger' : ''}`} value={addr[key]} aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `a-${key}-error` : undefined}
        onChange={(e) => setAddr({ ...addr, [key]: e.target.value })} {...props} />
    </Field>
  );

  return (
    <div className="page pt-10">
      <h1 className="text-4xl sm:text-5xl">Checkout</h1>
      {!pay.available && (
        <div role="alert" className="mt-6 rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">{pay.message ?? 'Payments are currently unavailable.'}</div>
      )}
      {pay.available && pay.testMode && (
        <div className="mt-6 rounded-xl border border-accent/40 bg-accent/10 p-4 text-sm">
          <strong>Test mode.</strong> {pay.provider === 'mock' ? 'This store is running the development payment simulator. No real payment is taken and no card details are requested.' : 'Razorpay test keys are configured; use Razorpay test cards only.'}
        </div>
      )}
      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_380px]">
        {pending ? (
          <section className="card p-6" aria-labelledby="sim">
            <h2 id="sim" className="text-2xl">Payment simulator</h2>
            <p className="mt-2 text-sm text-muted">Order #{pending.orderNumber} is reserved for 30 minutes. Choose an outcome to continue. This screen only exists in development builds.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button className="btn-primary" disabled={simulate.isPending} onClick={() => simulate.mutate('success')}>Simulate successful payment</button>
              <button className="btn-ghost" disabled={simulate.isPending} onClick={() => simulate.mutate('failure')}>Simulate failed payment</button>
            </div>
            {simulate.error && <div className="mt-4"><InlineError error={simulate.error} /></div>}
          </section>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-8" aria-label="Shipping address">
            <section>
              <h2 className="text-2xl">Shipping address</h2>
              <p className="mt-1 text-sm text-muted">We currently ship within India.</p>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">{input('fullName', 'Full name', { autoComplete: 'name', maxLength: 80 })}</div>
                {input('phone', 'Mobile number', { autoComplete: 'tel', inputMode: 'tel', maxLength: 16, placeholder: '98765 43210' })}
                {input('postalCode', 'PIN code', { autoComplete: 'postal-code', inputMode: 'numeric', maxLength: 6 })}
                <div className="sm:col-span-2">{input('line1', 'Address', { autoComplete: 'address-line1', maxLength: 120 })}</div>
                <div className="sm:col-span-2">{input('line2', 'Apartment, landmark (optional)', { autoComplete: 'address-line2', maxLength: 120 })}</div>
                {input('city', 'City', { autoComplete: 'address-level2', maxLength: 60 })}
                <Field label="State / UT" htmlFor="a-state" error={errors.state}>
                  <select id="a-state" className={`input ${errors.state ? 'border-danger' : ''}`} value={addr.state} aria-invalid={Boolean(errors.state)} onChange={(e) => setAddr({ ...addr, state: e.target.value })} autoComplete="address-level1">
                    <option value="">Select…</option>
                    {config.data!.states.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </Field>
              </div>
              <label className="mt-4 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} className="accent-[rgb(var(--accent))]" />
                Save this address for next time
              </label>
            </section>
            {serverErrors && <InlineError error={new Error(serverErrors.join(' '))} />}
            {place.error && !serverErrors && <InlineError error={place.error} />}
            {payError && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{payError}</p>}
            <button className="btn-primary w-full py-3 sm:w-auto sm:px-10" disabled={!pay.available || place.isPending || c.hasUnavailable}>
              {place.isPending ? 'Placing order…' : `Pay ${inr(c.totals.totalPaise)}`}
            </button>
            <p className="text-xs text-muted">Card and UPI details are entered only in the payment provider’s window; we never see or store them.</p>
          </form>
        )}
        <aside className="card h-fit p-6" aria-label="Order summary">
          <h2 className="text-2xl">Your order</h2>
          <ul className="mt-4 space-y-3">
            {c.lines.map((l) => (
              <li key={l.variantId} className="flex items-center gap-3 text-sm">
                <ProductImage src={l.image} alt="" slug={l.slug} sizes="48px" className="aspect-square h-12 w-12 shrink-0 rounded-lg border border-line" />
                <span className="flex-1">{l.title}{l.variantName !== 'Standard' ? ` · ${l.variantName}` : ''} × {l.quantity}</span>
                <span className="tabular-nums">{inr(l.lineTotalPaise)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-5 space-y-2 border-t border-line pt-4 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd>{inr(c.totals.subtotalPaise)}</dd></div>
            {c.totals.discountPaise > 0 && <div className="flex justify-between text-success"><dt>Discount ({c.discount?.code})</dt><dd>−{inr(c.totals.discountPaise)}</dd></div>}
            <div className="flex justify-between"><dt className="text-muted">Shipping</dt><dd>{c.totals.shippingPaise ? inr(c.totals.shippingPaise) : 'Free'}</dd></div>
            <div className="flex justify-between border-t border-line pt-3 text-base font-semibold"><dt>Total</dt><dd>{inr(c.totals.totalPaise)}</dd></div>
          </dl>
          <Link to="/cart" className="btn-link mt-4 inline-block">Edit cart</Link>
        </aside>
      </div>
    </div>
  );
}
