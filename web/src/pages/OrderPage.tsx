import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { Order } from '../api/types';
import { ErrorState, Field, InlineError, Spinner } from '../components/ui';
import { date, inr, ORDER_STATUS } from '../lib/format';

const STEPS = ['paid', 'shipped', 'delivered'] as const;
const RETURN_STATUS = { requested: 'Requested — awaiting review', refunded: 'Approved and refunded', rejected: 'Declined' };

function Returns({ order }: { order: Order }) {
  const qc = useQueryClient();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const pending = new Map<string, number>();
  for (const r of order.returns ?? []) if (r.status === 'requested') for (const it of r.items) pending.set(it.orderItemId, (pending.get(it.orderItemId) ?? 0) + it.quantity);
  const lines = (order.items ?? []).map((i) => ({ ...i, available: i.quantity - i.refundedQuantity - (pending.get(i.id) ?? 0) }));
  const submit = useMutation({
    mutationFn: () => api<{ order: Order }>(`/api/orders/${order.id}/returns`, {
      method: 'POST',
      json: { items: Object.entries(qty).filter(([, q]) => q > 0).map(([orderItemId, quantity]) => ({ orderItemId, quantity })), reason },
    }),
    onSuccess: (r) => {
      qc.setQueryData(['order', order.id], r.order);
      setQty({});
      setReason('');
    },
  });
  const fe = submit.error instanceof ApiError ? submit.error.fieldErrors() : {};
  const chosen = Object.values(qty).some((q) => q > 0);
  const titleOf = (id: string) => order.items?.find((i) => i.id === id)?.title ?? 'Item';
  if (!order.returnWindowOpen && !order.returns?.length) return null;
  return (
    <section aria-labelledby="returns-h" className="mt-12 border-t border-line pt-8">
      <h2 id="returns-h" className="text-3xl">Returns</h2>
      {order.returns?.length ? (
        <ul className="mt-4 space-y-3">
          {order.returns.map((r) => (
            <li key={r.id} className="card p-4 text-sm">
              <p className="font-medium">{RETURN_STATUS[r.status]} <span className="font-normal text-muted">· {date(r.createdAt)}</span></p>
              <p className="mt-1">{r.items.map((it) => `${titleOf(it.orderItemId)} × ${it.quantity}`).join(', ')}</p>
              <p className="mt-1 text-muted">“{r.reason}”</p>
              {r.adminNote && <p className="mt-1">Note from us: {r.adminNote}</p>}
            </li>
          ))}
        </ul>
      ) : null}
      {order.returnWindowOpen && (
        <form className="mt-6 space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); submit.mutate(); }}>
          <p className="text-sm text-muted">Unused items can be returned until {date(order.returnDeadline)}. Food and botanicals are non-returnable.</p>
          <ul className="space-y-2">
            {lines.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span>{l.title}{l.variantName !== 'Standard' ? ` · ${l.variantName}` : ''}</span>
                {!l.returnable ? <span className="text-muted">Not returnable</span> : l.available <= 0 ? <span className="text-muted">Already returned or requested</span> : (
                  <label className="flex items-center gap-2">Return
                    <select className="input w-auto py-1.5" value={qty[l.id] ?? 0} onChange={(e) => setQty({ ...qty, [l.id]: Number(e.target.value) })} aria-label={`Quantity of ${l.title} to return`}>
                      {Array.from({ length: l.available + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                )}
              </li>
            ))}
          </ul>
          <Field label="Reason" htmlFor="ret-reason" error={fe.reason} hint="What went wrong? This helps us improve.">
            <textarea id="ret-reason" className="input min-h-20" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {submit.error && !Object.keys(fe).length && <InlineError error={submit.error} />}
          {submit.isSuccess && <p role="status" className="text-sm text-success">Return requested. We'll review it within one working day.</p>}
          <button className="btn-ghost" disabled={!chosen || submit.isPending}>{submit.isPending ? 'Sending…' : 'Request return'}</button>
        </form>
      )}
    </section>
  );
}

export default function OrderPage() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['order', id], queryFn: () => api<{ order: Order }>(`/api/orders/${id}`).then((r) => r.order) });
  const cancel = useMutation({
    mutationFn: () => api<{ order: Order }>(`/api/orders/${id}/cancel`, { method: 'POST' }),
    onSuccess: (r) => {
      qc.setQueryData(['order', id], r.order);
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
  if (q.isLoading) return <div className="page py-16"><Spinner /></div>;
  if (q.isError) return <div className="page py-16"><ErrorState error={q.error} retry={() => q.refetch()} /></div>;
  const o = q.data!;
  const step = STEPS.indexOf(o.status as (typeof STEPS)[number]);
  const a = o.shippingAddress;

  return (
    <div className="page max-w-4xl pt-10">
      {sp.get('placed') && o.status === 'paid' && (
        <div className="mb-8 rounded-2xl border border-success/30 bg-success/5 p-6" role="status">
          <h1 className="text-3xl">Thank you — your order is confirmed</h1>
          <p className="mt-1 text-muted">We'll let you know as soon as it ships.</p>
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Order #{o.orderNumber}</p>
          <h2 className="mt-1 text-4xl">{ORDER_STATUS[o.status]}</h2>
          <p className="mt-1 text-sm text-muted">Placed {date(o.createdAt)}</p>
        </div>
        {o.cancellable && (
          <button className="btn-ghost" disabled={cancel.isPending} onClick={() => confirm(o.status === 'paid' ? 'Cancel this order? You will be refunded in full.' : 'Cancel this order?') && cancel.mutate()}>
            {cancel.isPending ? 'Cancelling…' : 'Cancel order'}
          </button>
        )}
      </div>
      {cancel.error && <div className="mt-4"><InlineError error={cancel.error} /></div>}

      {step >= 0 && (
        <ol className="mt-8 grid grid-cols-3 gap-2" aria-label="Order progress">
          {STEPS.map((s, i) => (
            <li key={s} className="text-center text-xs">
              <div className={`h-1.5 rounded-full ${i <= step ? 'bg-accent' : 'bg-sunken'}`} />
              <span className={`mt-2 block ${i <= step ? 'font-medium' : 'text-muted'}`}>{ORDER_STATUS[s]}</span>
            </li>
          ))}
        </ol>
      )}
      {o.status === 'payment_failed' && (
        <p className="mt-6 rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          Payment didn't go through{o.payment?.failureReason ? ` (${o.payment.failureReason.replace(/_/g, ' ')})` : ''}. You were not charged. <Link to="/cart" className="btn-link">Return to cart</Link>
        </p>
      )}
      {o.refundedPaise > 0 && (
        <p className="mt-6 text-sm text-muted">
          {o.refundedPaise >= o.totalPaise ? 'A full refund' : 'A partial refund'} of {inr(o.refundedPaise)} has been issued to the original payment method. Banks usually take 5–7 working days.
        </p>
      )}

      <div className="mt-10 grid gap-8 md:grid-cols-[1fr_280px]">
        <ul className="divide-y divide-line border-y border-line">
          {o.items?.map((it) => (
            <li key={it.id} className="flex gap-4 py-4">
              <img src={it.image} alt="" className="h-16 w-16 rounded-xl border border-line object-cover" />
              <div className="flex-1">
                <Link to={`/products/${it.slug}`} className="font-medium hover:underline">{it.title}</Link>
                <p className="text-sm text-muted">{it.variantName !== 'Standard' ? `${it.variantName} · ` : ''}Qty {it.quantity}</p>
                {it.refundedQuantity > 0 && <p className="text-xs text-accent">{it.refundedQuantity} refunded ({inr(it.refundedPaise)})</p>}
              </div>
              <span className="tabular-nums">{inr(it.lineTotalPaise)}</span>
            </li>
          ))}
        </ul>
        <div className="space-y-6 text-sm">
          <dl className="space-y-2">
            <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd>{inr(o.subtotalPaise)}</dd></div>
            {o.discountPaise > 0 && <div className="flex justify-between"><dt className="text-muted">Discount {o.discountCode ? `(${o.discountCode})` : ''}</dt><dd>−{inr(o.discountPaise)}</dd></div>}
            <div className="flex justify-between"><dt className="text-muted">Shipping</dt><dd>{o.shippingPaise ? inr(o.shippingPaise) : 'Free'}</dd></div>
            <div className="flex justify-between border-t border-line pt-2 font-semibold"><dt>Total</dt><dd>{inr(o.totalPaise)}</dd></div>
          </dl>
          <div>
            <h3 className="label">Ship to</h3>
            <address className="not-italic leading-6">{a.fullName}<br />{a.line1}{a.line2 ? <>, {a.line2}</> : null}<br />{a.city}, {a.state} {a.postalCode}</address>
          </div>
          {o.tax && (
            <details>
              <summary className="cursor-pointer font-medium">Tax details</summary>
              <table className="mt-2 w-full text-xs">
                <caption className="sr-only">GST included in this order</caption>
                <thead><tr className="text-left text-muted"><th className="py-1">GST rate</th><th>Taxable value</th><th>GST</th></tr></thead>
                <tbody>{o.tax.rows.map((r) => <tr key={r.rateBps}><td className="py-1">{r.rateBps / 100}%</td><td>{inr(r.taxablePaise)}</td><td>{inr(r.taxPaise)}</td></tr>)}</tbody>
              </table>
              {o.tax.split && (
                <p className="mt-1 text-xs">{o.tax.split.type === 'IGST' ? `IGST ${inr(o.tax.split.igstPaise)}` : `CGST ${inr(o.tax.split.cgstPaise)} · SGST ${inr(o.tax.split.sgstPaise)}`}</p>
              )}
              <p className="mt-1 text-xs text-muted">{o.tax.note}</p>
            </details>
          )}
          <Link to="/support" className="btn-link">Need help with this order?</Link>
        </div>
      </div>
      <Returns order={o} />
    </div>
  );
}
