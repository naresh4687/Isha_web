import { useState, type FormEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, qs } from '../api/client';
import { useCategories } from '../hooks/useStore';
import { ErrorState, Field, InlineError, Pagination, Spinner } from '../components/ui';
import { ProductImage } from '../components/ProductImage';
import { date, inr, ORDER_STATUS } from '../lib/format';

function TaxRates() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['tax-rates'], queryFn: () => api<any>('/api/admin/tax-rates') });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api('/api/admin/tax-rates', { method: 'PUT', json: { rates: Object.entries(edits).map(([slug, v]) => ({ slug, gstRateBps: v === '' ? null : Math.round(Number(v) * 100) })) } }),
    onSuccess: () => { setEdits({}); qc.invalidateQueries({ queryKey: ['tax-rates'] }); },
  });
  if (q.isLoading || q.isError) return null;
  return (
    <details className="card p-4">
      <summary className="cursor-pointer text-sm font-semibold">GST rates by category</summary>
      <p className="mt-2 text-xs text-muted">
        Set the rate that applies to each category's HSN code (confirm with your tax adviser). Blank = not configured; order tax breakdowns are shown only when every line has a rate.
        Rates are copied onto orders at checkout. Seller state: {q.data.sellerState ?? 'not set (SELLER_STATE) — CGST/SGST vs IGST split is hidden'}.
      </p>
      <form className="mt-3 grid gap-2 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {q.data.items.map((c: any) => (
          <label key={c.slug} className="flex items-center justify-between gap-2 text-xs">{c.name}
            <span className="flex items-center gap-1">
              <input className="input w-20 py-1" inputMode="decimal" placeholder="—" aria-label={`GST % for ${c.name}`}
                value={edits[c.slug] ?? (c.gstRateBps == null ? '' : String(c.gstRateBps / 100))} onChange={(e) => setEdits({ ...edits, [c.slug]: e.target.value.replace(/[^0-9.]/g, '') })} />%
            </span>
          </label>
        ))}
        <div className="sm:col-span-3">
          {save.error && <InlineError error={save.error} />}
          <button className="btn-ghost px-3 py-1 text-xs" disabled={!Object.keys(edits).length || save.isPending}>Save rates</button>
        </div>
      </form>
    </details>
  );
}

export function ProductsAdmin() {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [lowStock, setLowStock] = useState(false);
  const [page, setPage] = useState(1);
  const qc = useQueryClient();
  const params = { q, category, lowStock: lowStock ? 'true' : undefined, page };
  const list = useQuery({ queryKey: ['admin-products', params], queryFn: () => api<any>(`/api/admin/products${qs(params)}`), placeholderData: keepPreviousData });
  const cats = useCategories();
  const adjust = useMutation({
    mutationFn: (v: { variantId: string; delta: number }) => api('/api/admin/inventory/adjust', { method: 'POST', json: { ...v, reason: v.delta > 0 ? 'restock' : 'admin' } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-products'] }),
  });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-4xl">Products & inventory</h1>
        <Link to="/admin/products/new" className="btn-primary">New product</Link>
      </div>
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <label className="text-xs">Search<input className="input mt-1 py-1.5" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Title or SKU" /></label>
        <label className="text-xs">Category
          <select className="input mt-1 py-1.5" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
            <option value="">All</option>{cats.data?.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={lowStock} onChange={(e) => { setLowStock(e.target.checked); setPage(1); }} />Low stock only (≤ {list.data?.lowStockThreshold ?? 5})</label>
      </div>
      <TaxRates />
      {adjust.error && <InlineError error={adjust.error} />}
      {list.isLoading ? <Spinner /> : list.isError ? <ErrorState error={list.error} /> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Products</caption>
            <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="p-3">Product</th><th className="p-3">Category</th><th className="p-3">Variant / SKU</th><th className="p-3">Price</th><th className="p-3">Stock</th><th className="p-3">Adjust stock</th></tr></thead>
            <tbody>
              {list.data.items.map((p: any) => p.variants.map((v: any, i: number) => (
                <tr key={v.id} className="border-b border-line/60">
                  {i === 0 && <td className="p-3 align-top" rowSpan={p.variants.length}><div className="flex items-center gap-3"><ProductImage src={p.image} alt="" slug={p.slug} sizes="40px" className="aspect-square h-10 w-10 shrink-0 rounded-lg border border-line" /><div><Link className="font-medium hover:underline" to={`/admin/products/${p.id}`}>{p.title}</Link>{!p.isActive && <span className="ml-2 text-xs text-danger">hidden</span>}{!p.hasPhoto && <span className="block text-xs text-muted">illustration only</span>}</div></div></td>}
                  {i === 0 && <td className="p-3 align-top text-muted" rowSpan={p.variants.length}>{p.category}</td>}
                  <td className="p-3">{v.name} <span className="font-mono text-xs text-muted">{v.sku}</span></td>
                  <td className="p-3 tabular-nums">{inr(v.pricePaise)}</td>
                  <td className={`p-3 tabular-nums ${v.stock === 0 ? 'text-danger' : v.stock <= list.data.lowStockThreshold ? 'text-accent' : ''}`}>{v.stock}{v.stock === 0 ? ' · out' : v.stock <= list.data.lowStockThreshold ? ' · low' : ''}</td>
                  <td className="p-3">
                    <form className="flex gap-1" onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const n = Number(new FormData(e.currentTarget).get('d')); if (n) adjust.mutate({ variantId: v.id, delta: n }); e.currentTarget.reset(); }}>
                      <label className="sr-only" htmlFor={`d-${v.id}`}>Stock change for {v.sku}</label>
                      <input id={`d-${v.id}`} name="d" type="number" className="input w-20 py-1" placeholder="±" />
                      <button className="btn-ghost px-3 py-1 text-xs" disabled={adjust.isPending}>Apply</button>
                    </form>
                  </td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      )}
      {list.data && <Pagination page={list.data.page} totalPages={list.data.totalPages} onPage={setPage} />}
    </div>
  );
}

interface VariantForm { id?: string; sku: string; name: string; price: string; compareAt: string; stock: string }

export function ProductEditor() {
  const { id } = useParams();
  const isNew = id === 'new';
  const nav = useNavigate();
  const qc = useQueryClient();
  const cats = useCategories();
  const q = useQuery({ queryKey: ['admin-product', id], queryFn: () => api<any>(`/api/admin/products/${id}`).then((r) => r.product), enabled: !isNew });
  const [form, setForm] = useState<any>(null);
  const p = form ?? (isNew
    ? { title: '', description: '', categorySlug: 'books', subcategory: '', tags: '', attributes: '', isActive: true, variants: [{ sku: '', name: 'Standard', price: '', compareAt: '', stock: '0' }] }
    : q.data && {
        ...q.data,
        tags: q.data.tags.join(', '),
        attributes: Object.entries(q.data.attributes).map(([k, v]) => `${k}: ${v}`).join('\n'),
        variants: q.data.variants.map((v: any) => ({ id: v.id, sku: v.sku, name: v.name, price: String(v.pricePaise / 100), compareAt: v.compareAtPaise ? String(v.compareAtPaise / 100) : '', stock: String(v.stock) })),
      });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: p.title, description: p.description, categorySlug: p.categorySlug, subcategory: p.subcategory || null, isActive: p.isActive,
        tags: p.tags.split(',').map((t: string) => t.trim()).filter(Boolean),
        attributes: Object.fromEntries(p.attributes.split('\n').map((l: string) => l.split(':')).filter((x: string[]) => x.length >= 2).map(([k, ...v]: string[]) => [k.trim(), v.join(':').trim()])),
        variants: p.variants.map((v: VariantForm) => ({ id: v.id, sku: v.sku, name: v.name, pricePaise: Math.round(Number(v.price) * 100), compareAtPaise: v.compareAt ? Math.round(Number(v.compareAt) * 100) : null, stock: v.id ? undefined : Number(v.stock || 0) })),
      };
      return isNew ? api<{ id: string }>('/api/admin/products', { method: 'POST', json: body }) : api(`/api/admin/products/${id}`, { method: 'PUT', json: body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-products'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      nav('/admin/products');
    },
  });
  if (!isNew && q.isLoading) return <Spinner />;
  if (!isNew && q.isError) return <ErrorState error={q.error} />;
  const upd = (patch: any) => setForm({ ...p, ...patch });
  const fe = save.error instanceof ApiError ? save.error.fieldErrors() : {};
  const sub = cats.data?.find((c) => c.slug === p.categorySlug)?.subcategories ?? [];
  return (
    <form className="max-w-3xl space-y-5" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <h1 className="text-4xl">{isNew ? 'New product' : 'Edit product'}</h1>
      <Field label="Title" htmlFor="p-title" error={fe.title}><input id="p-title" className="input" value={p.title} onChange={(e) => upd({ title: e.target.value })} /></Field>
      <Field label="Description" htmlFor="p-desc" error={fe.description}><textarea id="p-desc" className="input min-h-28" value={p.description} onChange={(e) => upd({ description: e.target.value })} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" htmlFor="p-cat"><select id="p-cat" className="input" value={p.categorySlug} onChange={(e) => upd({ categorySlug: e.target.value, subcategory: '' })}>{cats.data?.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</select></Field>
        <Field label="Subcategory" htmlFor="p-sub"><select id="p-sub" className="input" value={p.subcategory ?? ''} onChange={(e) => upd({ subcategory: e.target.value })}><option value="">—</option>{sub.map((s) => <option key={s}>{s}</option>)}</select></Field>
      </div>
      <Field label="Tags (comma separated)" htmlFor="p-tags" hint="Used for search, collections and content-based recommendations."><input id="p-tags" className="input" value={p.tags} onChange={(e) => upd({ tags: e.target.value })} /></Field>
      <Field label="Attributes (one “key: value” per line)" htmlFor="p-attr"><textarea id="p-attr" className="input min-h-20 font-mono text-xs" value={p.attributes} onChange={(e) => upd({ attributes: e.target.value })} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={p.isActive} onChange={(e) => upd({ isActive: e.target.checked })} />Visible in store</label>
      {!isNew && q.data && (
        <section className="card p-4" aria-labelledby="p-img">
          <h2 id="p-img" className="font-sans text-sm font-semibold">Images</h2>
          {q.data.images.length ? (
            <ul className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4">
              {q.data.images.map((img: any, n: number) => (
                <li key={img.src} className="text-xs text-muted">
                  <ProductImage src={img.src} alt={img.alt} slug={q.data.slug} sizes="120px" className="aspect-square rounded-lg border border-line" />
                  <p className="mt-1">{n === 0 ? 'Primary · ' : ''}{img.credit?.license ?? 'own work'}</p>
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-xs text-muted">No photos — the store shows generated illustrations.</p>}
          <p className="mt-2 text-xs text-muted">Photos are managed in web/public/assets/products/manifest.json and synced on server start.</p>
        </section>
      )}
      <fieldset className="card space-y-3 p-4">
        <legend className="px-1 text-sm font-semibold">Variants</legend>
        {p.variants.map((v: VariantForm, i: number) => (
          <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {(['sku', 'name', 'price', 'compareAt', 'stock'] as const).map((k) => (
              <label key={k} className="text-xs">{{ sku: 'SKU', name: 'Name', price: 'Price ₹', compareAt: 'Compare-at ₹', stock: v.id ? 'Stock (use adjust)' : 'Initial stock' }[k]}
                <input className="input mt-1 py-1.5" value={v[k]} disabled={k === 'stock' && Boolean(v.id)} inputMode={['price', 'compareAt', 'stock'].includes(k) ? 'decimal' : undefined}
                  onChange={(e) => upd({ variants: p.variants.map((x: VariantForm, j: number) => (j === i ? { ...x, [k]: e.target.value } : x)) })} />
              </label>
            ))}
          </div>
        ))}
        <button type="button" className="btn-ghost text-xs" onClick={() => upd({ variants: [...p.variants, { sku: '', name: '', price: '', compareAt: '', stock: '0' }] })}>Add variant</button>
      </fieldset>
      {save.error && <InlineError error={save.error} />}
      <div className="flex gap-2"><button className="btn-primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</button><Link className="btn-ghost" to="/admin/products">Cancel</Link></div>
    </form>
  );
}

function ReturnsQueue() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-returns'], queryFn: () => api<any>('/api/admin/returns?status=requested') });
  const decide = useMutation({
    mutationFn: (v: { id: string; approve: boolean; restock?: boolean; note?: string }) =>
      v.approve ? api(`/api/admin/returns/${v.id}/approve`, { method: 'POST', json: { restock: v.restock } }) : api(`/api/admin/returns/${v.id}/reject`, { method: 'POST', json: { note: v.note } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-returns'] });
      qc.invalidateQueries({ queryKey: ['admin-orders'] });
    },
  });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} />;
  return (
    <section className="card p-5" aria-labelledby="ret-q">
      <h2 id="ret-q" className="font-sans text-base font-semibold">Return requests awaiting review ({q.data.items.length})</h2>
      {decide.error && <div className="mt-2"><InlineError error={decide.error} /></div>}
      {q.data.items.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing to review.</p> : (
        <ul className="mt-3 divide-y divide-line">
          {q.data.items.map((r: any) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
              <div>
                <p><Link className="font-medium hover:underline" to={`/orders/${r.orderId}`}>#{r.orderNumber}</Link> · {r.email} · requested {date(r.createdAt)} (delivered {date(r.deliveredAt)})</p>
                <p className="mt-1">{r.items.map((i: any) => `${i.title}${i.variantName !== 'Standard' ? ` (${i.variantName})` : ''} × ${i.quantity}`).join(', ')}</p>
                <p className="mt-1 text-muted">“{r.reason}”</p>
              </div>
              <div className="flex flex-wrap gap-1">
                <button className="btn-ghost px-3 py-1 text-xs" disabled={decide.isPending} onClick={() => confirm('Approve and refund these items?') && decide.mutate({ id: r.id, approve: true, restock: confirm('Return the items to stock?') })}>Approve & refund</button>
                <button className="btn-ghost px-3 py-1 text-xs" disabled={decide.isPending} onClick={() => { const note = prompt('Reason for declining (shown to the customer):'); if (note && note.trim().length >= 3) decide.mutate({ id: r.id, approve: false, note }); }}>Decline</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RefundPanel({ orderId, onDone }: { orderId: string; onDone: () => void }) {
  const q = useQuery({ queryKey: ['order', orderId], queryFn: () => api<any>(`/api/orders/${orderId}`).then((r) => r.order) });
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(false);
  const refund = useMutation({
    mutationFn: () => api<any>(`/api/admin/orders/${orderId}/refunds`, { method: 'POST', json: { items: Object.entries(qty).filter(([, n]) => n > 0).map(([orderItemId, quantity]) => ({ orderItemId, quantity })), reason, restock } }),
    onSuccess: onDone,
  });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} />;
  return (
    <form className="space-y-2 rounded-xl bg-sunken/60 p-3 text-xs" onSubmit={(e) => { e.preventDefault(); refund.mutate(); }}>
      {q.data.items.map((i: any) => {
        const left = i.quantity - i.refundedQuantity;
        return (
          <label key={i.id} className="flex items-center justify-between gap-2">
            <span>{i.title} ({left} of {i.quantity} refundable)</span>
            <select className="input w-auto py-1" value={qty[i.id] ?? 0} disabled={left === 0} onChange={(e) => setQty({ ...qty, [i.id]: Number(e.target.value) })}>
              {Array.from({ length: left + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        );
      })}
      <input className="input py-1" placeholder="Reason (e.g. damaged in transit)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Refund reason" />
      <label className="flex items-center gap-2"><input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} />Return items to stock</label>
      <p className="text-muted">Amount is computed by the server (line value net of discount; shipping refunded with the last unit).</p>
      {refund.error && <InlineError error={refund.error} />}
      <button className="btn-primary px-3 py-1 text-xs" disabled={refund.isPending || reason.trim().length < 3 || !Object.values(qty).some((n) => n > 0)}>Issue refund</button>
    </form>
  );
}

export function OrdersAdmin() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['admin-orders', status, page], queryFn: () => api<any>(`/api/admin/orders${qs({ status, page })}`), placeholderData: keepPreviousData });
  const act = useMutation({
    mutationFn: (v: { id: string; action: string; restock?: boolean }) => api(`/api/admin/orders/${v.id}/status`, { method: 'POST', json: { action: v.action, restock: v.restock } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-orders'] }),
  });
  const [refunding, setRefunding] = useState<string | null>(null);
  const actions: Record<string, [string, string][]> = { paid: [['ship', 'Mark shipped'], ['cancel', 'Cancel & refund']], shipped: [['deliver', 'Mark delivered'], ['refund', 'Refund all']], delivered: [['refund', 'Refund all']], pending_payment: [['cancel', 'Cancel']] };
  return (
    <div className="space-y-5">
      <h1 className="text-4xl">Orders</h1>
      <ReturnsQueue />
      <label className="text-xs">Status
        <select className="input ml-2 inline-block w-auto py-1.5" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All</option>{Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      {act.error && <InlineError error={act.error} />}
      {list.isLoading ? <Spinner /> : list.isError ? <ErrorState error={list.error} /> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm"><caption className="sr-only">Orders</caption>
            <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="p-3">#</th><th className="p-3">Date</th><th className="p-3">Customer</th><th className="p-3">Status</th><th className="p-3">Total</th><th className="p-3">Actions</th></tr></thead>
            <tbody>{list.data.items.map((o: any) => (
              <tr key={o.id} className="border-b border-line/60">
                <td className="p-3"><Link className="hover:underline" to={`/orders/${o.id}`}>{o.orderNumber}</Link>{o.isDemo && <span className="ml-1 text-[10px] uppercase text-muted">demo</span>}</td>
                <td className="p-3 text-muted">{date(o.createdAt)}</td>
                <td className="p-3">{o.customerEmail}</td>
                <td className="p-3">{ORDER_STATUS[o.status]}{o.adminNote && <p className="text-xs text-danger">{o.adminNote}</p>}</td>
                <td className="p-3 tabular-nums">{inr(o.totalPaise)}{o.refundedPaise > 0 && o.refundedPaise < o.totalPaise && <p className="text-xs text-accent">−{inr(o.refundedPaise)} refunded</p>}</td>
                <td className="p-3"><div className="flex flex-wrap gap-1">{['shipped', 'delivered'].includes(o.status) && (
                  <button className="btn-ghost px-3 py-1 text-xs" aria-expanded={refunding === o.id} onClick={() => setRefunding(refunding === o.id ? null : o.id)}>Refund items…</button>
                )}{(actions[o.status] ?? []).map(([a, label]) => (
                  <button key={a} className="btn-ghost px-3 py-1 text-xs" disabled={act.isPending} onClick={() => confirm(`${label} for order #${o.orderNumber}?`) && act.mutate({ id: o.id, action: a, restock: a === 'refund' ? confirm('Return the items to stock?') : undefined })}>{label}</button>
                ))}</div>{refunding === o.id && <div className="mt-2"><RefundPanel orderId={o.id} onDone={() => { setRefunding(null); qc.invalidateQueries({ queryKey: ['admin-orders'] }); }} /></div>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {list.data && <Pagination page={list.data.page} totalPages={list.data.totalPages} onPage={setPage} />}
    </div>
  );
}

export function SupportAdmin() {
  const qc = useQueryClient();
  const tickets = useQuery({ queryKey: ['admin-support'], queryFn: () => api<any>('/api/admin/support') });
  const recovery = useQuery({ queryKey: ['admin-recovery'], queryFn: () => api<any>('/api/admin/cart-recovery') });
  const refresh = useMutation({ mutationFn: () => api<any>('/api/admin/cart-recovery/refresh', { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-recovery'] }) });
  const setTask = useMutation({ mutationFn: (v: { id: string; status: string }) => api(`/api/admin/cart-recovery/${v.id}`, { method: 'PATCH', json: { status: v.status } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-recovery'] }) });
  const close = useMutation({ mutationFn: (id: string) => api(`/api/admin/support/${id}/close`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-support'] }) });
  return (
    <div className="grid gap-8 xl:grid-cols-2">
      <section className="space-y-4">
        <h1 className="text-3xl">Support tickets</h1>
        {tickets.isLoading ? <Spinner /> : tickets.isError ? <ErrorState error={tickets.error} /> : tickets.data.items.length === 0 ? <p className="text-sm text-muted">No tickets.</p> : (
          <ul className="space-y-3">{tickets.data.items.map((t: any) => (
            <li key={t.id} className="card p-4 text-sm">
              <div className="flex justify-between gap-2"><span className="font-medium">{t.subject} · {t.name} &lt;{t.email}&gt;</span><span className="text-xs text-muted">{date(t.createdAt)}</span></div>
              {t.orderNumber && <p className="text-xs text-muted">Order #{t.orderNumber}</p>}
              <p className="mt-2 whitespace-pre-line">{t.message}</p>
              {t.status === 'open' ? <button className="btn-ghost mt-3 px-3 py-1 text-xs" onClick={() => close.mutate(t.id)}>Close</button> : <p className="mt-2 text-xs text-muted">Closed</p>}
            </li>
          ))}</ul>
        )}
      </section>
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3"><h2 className="text-3xl">Cart recovery</h2><button className="btn-ghost text-xs" onClick={() => refresh.mutate()} disabled={refresh.isPending}>Find abandoned carts</button></div>
        <p className="text-sm text-muted">Signed-in customers who opted in to marketing and left items in their cart for 24h+. {recovery.data?.note}</p>
        {refresh.data && <p className="text-sm" role="status">{refresh.data.created} new task(s).</p>}
        {recovery.isLoading ? <Spinner /> : recovery.isError ? <ErrorState error={recovery.error} /> : recovery.data.items.length === 0 ? <p className="text-sm text-muted">No open recovery tasks.</p> : (
          <table className="w-full text-sm"><caption className="sr-only">Recovery tasks</caption>
            <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-2">Customer</th><th>Cart</th><th>Idle since</th><th>Status</th></tr></thead>
            <tbody>{recovery.data.items.map((t: any) => (
              <tr key={t.id} className="border-b border-line/60">
                <td className="py-2">{t.name}<br /><span className="text-xs text-muted">{t.email}</span></td>
                <td className="tabular-nums">{inr(t.cartValuePaise)} · {t.lineCount} lines</td>
                <td>{date(t.cartUpdatedAt)}</td>
                <td><select aria-label={`Status for ${t.email}`} className="input py-1 text-xs" value={t.status} onChange={(e) => setTask.mutate({ id: t.id, status: e.target.value })}>{['open', 'contacted', 'recovered', 'dismissed'].map((s) => <option key={s}>{s}</option>)}</select></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>
    </div>
  );
}
