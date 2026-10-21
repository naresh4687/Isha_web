import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { Order, Paged, ProductCard as P, User } from '../api/types';
import { useCategories, useMe, useWishlist } from '../hooks/useStore';
import { EmptyState, ErrorState, Field, InlineError, Pagination, Spinner } from '../components/ui';
import { ProductCard, ProductGrid } from '../components/ProductCard';
import { date, inr, ORDER_STATUS } from '../lib/format';
import { guestCategoryPrefs } from '../lib/tracking';

/** Only same-site relative paths are accepted as post-login redirects (blocks //host and /\\host tricks). */
export const safeNext = (n: string | null) => (n && /^\/(?![\/\\])[^\\\s]*$/.test(n) ? n : '/account');

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const [sp] = useSearchParams();
  const next = safeNext(sp.get('next'));
  const qc = useQueryClient();
  const nav = useNavigate();
  const me = useMe();
  const [form, setForm] = useState({ name: '', email: '', password: '', marketingConsent: false });
  const m = useMutation({
    mutationFn: () =>
      mode === 'login'
        ? api<{ user: User }>('/api/auth/login', { method: 'POST', json: { email: form.email, password: form.password } })
        : api<{ user: User }>('/api/auth/register', { method: 'POST', json: { ...form, categoryPrefs: guestCategoryPrefs() } }),
    onSuccess: (r) => {
      qc.setQueryData(['me'], r.user);
      qc.invalidateQueries({ queryKey: ['cart'] });
      qc.invalidateQueries({ queryKey: ['wishlist'] });
      nav(next, { replace: true });
    },
  });
  if (me.data) return <Navigate to={next} replace />;
  const fe = m.error instanceof ApiError ? m.error.fieldErrors() : {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  return (
    <div className="page grid min-h-[70vh] place-items-center py-12">
      <form onSubmit={submit} className="card w-full max-w-md space-y-5 p-8" noValidate>
        <div>
          <h1 className="text-4xl">{mode === 'login' ? 'Welcome back' : 'Create an account'}</h1>
          <p className="mt-1 text-sm text-muted">{mode === 'login' ? 'Sign in to check out, track orders and save favourites.' : 'Takes less than a minute.'}</p>
        </div>
        {mode === 'register' && (
          <Field label="Name" htmlFor="name" error={fe.name}>
            <input id="name" className="input" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={80} />
          </Field>
        )}
        <Field label="Email" htmlFor="email" error={fe.email}>
          <input id="email" type="email" className="input" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </Field>
        <Field label="Password" htmlFor="password" error={fe.password} hint={mode === 'register' ? 'At least 8 characters, with a letter and a number.' : undefined}>
          <input id="password" type="password" className="input" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        </Field>
        {mode === 'register' && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 accent-[rgb(var(--accent))]" checked={form.marketingConsent} onChange={(e) => setForm({ ...form, marketingConsent: e.target.checked })} />
            <span>Email me occasional updates and reminders about items left in my cart. Optional; unsubscribe anytime.</span>
          </label>
        )}
        {m.error && !Object.keys(fe).length && <InlineError error={m.error} />}
        <button className="btn-primary w-full py-3" disabled={m.isPending}>{m.isPending ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
        <p className="text-center text-sm text-muted">
          {mode === 'login' ? <>New here? <Link className="btn-link" to={`/register?next=${encodeURIComponent(next)}`}>Create an account</Link></> : <>Already have an account? <Link className="btn-link" to={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link></>}
        </p>
      </form>
    </div>
  );
}

function Preferences({ user }: { user: User }) {
  const cats = useCategories();
  const qc = useQueryClient();
  const [prefs, setPrefs] = useState(user.categoryPrefs);
  const [mk, setMk] = useState(user.marketingConsent);
  const save = useMutation({
    mutationFn: () => api<{ user: User }>('/api/auth/me', { method: 'PATCH', json: { categoryPrefs: prefs, marketingConsent: mk } }),
    onSuccess: (r) => {
      qc.setQueryData(['me'], r.user);
      qc.invalidateQueries({ queryKey: ['rec'] });
    },
  });
  return (
    <section className="card p-6">
      <h2 className="text-2xl">Preferences</h2>
      <p className="mt-1 text-sm text-muted">Categories you choose here shape your recommendations.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {cats.data?.map((c) => {
          const on = prefs.includes(c.slug);
          return (
            <button key={c.slug} type="button" aria-pressed={on} onClick={() => setPrefs(on ? prefs.filter((x) => x !== c.slug) : [...prefs, c.slug])}
              className={`rounded-full border px-3.5 py-1.5 text-sm ${on ? 'border-ink bg-ink text-canvas' : 'border-line hover:border-ink/40'}`}>
              {c.name}
            </button>
          );
        })}
      </div>
      <label className="mt-5 flex items-center gap-2 text-sm">
        <input type="checkbox" className="accent-[rgb(var(--accent))]" checked={mk} onChange={(e) => setMk(e.target.checked)} />
        Email updates and cart reminders
      </label>
      <button className="btn-ghost mt-5" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save preferences'}</button>
      {save.isSuccess && <span className="ml-3 text-sm text-success" role="status">Saved</span>}
      {save.error && <div className="mt-3"><InlineError error={save.error} /></div>}
    </section>
  );
}

function ChangeEmail() {
  const qc = useQueryClient();
  const me = useMe();
  const [form, setForm] = useState({ newEmail: '', currentPassword: '' });
  const change = useMutation({
    mutationFn: () => api<{ user: User }>('/api/auth/email', { method: 'POST', json: form }),
    onSuccess: (r) => {
      qc.setQueryData(['me'], r.user);
      setForm({ newEmail: '', currentPassword: '' });
    },
  });
  const fe = change.error instanceof ApiError ? change.error.fieldErrors() : {};
  return (
    <form className="mt-4 space-y-3 border-b border-line pb-6" noValidate onSubmit={(e) => { e.preventDefault(); change.mutate(); }}>
      <p className="text-sm text-muted">Signed in as <span className="font-medium text-ink">{me.data?.email}</span></p>
      <Field label="New email" htmlFor="new-email" error={fe.newEmail}>
        <input id="new-email" type="email" autoComplete="email" className="input" value={form.newEmail} onChange={(e) => setForm({ ...form, newEmail: e.target.value })} />
      </Field>
      <Field label="Current password" htmlFor="email-pw" error={fe.currentPassword} hint="You'll sign in with the new email from now on. Other devices will be signed out.">
        <input id="email-pw" type="password" autoComplete="current-password" className="input" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
      </Field>
      {change.error && !Object.keys(fe).length && <InlineError error={change.error} />}
      {change.isSuccess && <p role="status" className="text-sm text-success">Email changed. Sign in with {change.data.user.email} from now on.</p>}
      <button className="btn-ghost" disabled={change.isPending || !form.newEmail || !form.currentPassword}>{change.isPending ? 'Saving…' : 'Change email'}</button>
    </form>
  );
}

function Security() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const change = useMutation({
    mutationFn: () => api('/api/auth/password', { method: 'POST', json: pw }),
    onSuccess: () => setPw({ currentPassword: '', newPassword: '' }),
  });
  const all = useMutation({
    mutationFn: () => api('/api/auth/logout-all', { method: 'POST' }),
    onSuccess: () => {
      qc.clear();
      nav('/login');
    },
  });
  const fe = change.error instanceof ApiError ? change.error.fieldErrors() : {};
  return (
    <section className="card p-6">
      <h2 className="text-2xl">Security</h2>
      <ChangeEmail />
      <form className="mt-4 space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); change.mutate(); }}>
        <Field label="Current password" htmlFor="cur-pw" error={fe.currentPassword}>
          <input id="cur-pw" type="password" autoComplete="current-password" className="input" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
        </Field>
        <Field label="New password" htmlFor="new-pw" error={fe.newPassword} hint="At least 8 characters, with a letter and a number. Other devices will be signed out.">
          <input id="new-pw" type="password" autoComplete="new-password" className="input" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
        </Field>
        {change.error && !Object.keys(fe).length && <InlineError error={change.error} />}
        {change.isSuccess && <p role="status" className="text-sm text-success">Password changed. Other devices have been signed out.</p>}
        <button className="btn-ghost" disabled={change.isPending || !pw.currentPassword || !pw.newPassword}>{change.isPending ? 'Saving…' : 'Change password'}</button>
      </form>
      <div className="mt-6 border-t border-line pt-4">
        <button className="btn-link" onClick={() => confirm('Sign out on every device, including this one?') && all.mutate()} disabled={all.isPending}>Sign out of all devices</button>
        {all.error && <div className="mt-2"><InlineError error={all.error} /></div>}
      </div>
    </section>
  );
}

export function AccountPage() {
  const me = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [page, setPage] = useState(1);
  const orders = useQuery({ queryKey: ['orders', page], queryFn: () => api<Paged<Order>>(`/api/orders?page=${page}`), enabled: Boolean(me.data) });
  const logout = useMutation({
    mutationFn: () => api('/api/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      qc.clear();
      nav('/');
    },
  });
  if (me.isLoading) return <div className="page py-16"><Spinner /></div>;
  if (!me.data) return <Navigate to="/login?next=/account" replace />;
  return (
    <div className="page pt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Account</p>
          <h1 className="mt-1 text-4xl sm:text-5xl">Hello, {me.data.name.split(' ')[0]}</h1>
          <p className="mt-1 text-sm text-muted">{me.data.email}</p>
        </div>
        <button className="btn-ghost" onClick={() => logout.mutate()}>Sign out</button>
      </div>
      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_360px]">
        <section aria-labelledby="orders-h">
          <h2 id="orders-h" className="text-3xl">Order history</h2>
          <div className="mt-5">
            {orders.isLoading ? <Spinner /> : orders.isError ? <ErrorState error={orders.error} retry={() => orders.refetch()} /> : orders.data!.items.length === 0 ? (
              <EmptyState title="No orders yet" body="When you place an order it will appear here." action={<Link className="btn-primary" to="/shop">Shop now</Link>} />
            ) : (
              <>
                <ul className="divide-y divide-line border-y border-line">
                  {orders.data!.items.map((o) => (
                    <li key={o.id}>
                      <Link to={`/orders/${o.id}`} className="flex flex-wrap items-center justify-between gap-3 py-4 hover:bg-sunken/50 sm:px-3">
                        <span><span className="font-medium">#{o.orderNumber}</span> <span className="text-sm text-muted">· {date(o.createdAt)} · {o.itemCount} item{o.itemCount === 1 ? '' : 's'}</span></span>
                        <span className="flex items-center gap-4"><span className="text-sm">{ORDER_STATUS[o.status]}</span><span className="tabular-nums font-medium">{inr(o.totalPaise)}</span></span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <Pagination page={orders.data!.page} totalPages={orders.data!.totalPages} onPage={setPage} />
              </>
            )}
          </div>
        </section>
        <div className="space-y-6">
          <Preferences user={me.data} />
          <Security />
        </div>
      </div>
    </div>
  );
}

export function WishlistPage() {
  const me = useMe();
  const wl = useWishlist(Boolean(me.data));
  if (me.isLoading) return <div className="page py-16"><Spinner /></div>;
  if (!me.data) return <div className="page py-16"><EmptyState title="Save your favourites" body="Sign in to keep a wishlist across devices." action={<Link to="/login?next=/wishlist" className="btn-primary">Sign in</Link>} /></div>;
  const items = (wl.list.data ?? []) as unknown as P[];
  return (
    <div className="page pt-10">
      <h1 className="text-4xl sm:text-5xl">Wishlist</h1>
      <div className="mt-8">
        {wl.list.isLoading ? <Spinner /> : wl.list.isError ? <ErrorState error={wl.list.error} /> : items.length === 0 ? (
          <EmptyState title="Nothing saved yet" body="Tap the heart on any product to save it here." action={<Link to="/shop" className="btn-primary">Browse products</Link>} />
        ) : (
          <ProductGrid>{items.map((p) => <ProductCard key={p.id} product={p} wishlisted onWishlist={(on) => wl.toggle.mutate({ productId: p.id, on })} />)}</ProductGrid>
        )}
      </div>
    </div>
  );
}

export function SupportPage() {
  const me = useMe();
  const [f, setF] = useState({ name: me.data?.name ?? '', email: me.data?.email ?? '', subject: 'order', message: '', orderNumber: '' });
  const m = useMutation({ mutationFn: () => api('/api/support', { method: 'POST', json: { ...f, orderNumber: f.orderNumber || undefined } }) });
  const fe = m.error instanceof ApiError ? m.error.fieldErrors() : {};
  const faqs = [
    ['shipping', 'How long does delivery take?', 'Orders are dispatched within 1–2 working days. Metro cities usually receive them in 3–5 days, elsewhere 5–8 days. Shipping is free above ₹999, otherwise ₹79.'],
    ['returns', 'What is the return policy?', 'Unused items in original condition can be returned within 7 days of delivery. Food, opened body care and personalised items cannot be returned for hygiene reasons.'],
    ['cancel', 'Can I cancel an order?', 'Yes, until it ships. Open the order from your account and choose “Cancel order”; paid orders are refunded in full to the original payment method.'],
    ['care', 'How do I care for a rudraksha mala?', 'Keep it dry, avoid soap and perfume, and condition it occasionally with a little oil. Store it in a cloth pouch.'],
  ];
  return (
    <div className="page max-w-5xl pt-10">
      <h1 className="text-4xl sm:text-5xl">Help & support</h1>
      <div className="mt-10 grid gap-12 md:grid-cols-2">
        <section aria-labelledby="faq">
          <h2 id="faq" className="text-3xl">Common questions</h2>
          <div className="mt-4 divide-y divide-line border-y border-line">
            {faqs.map(([id, q, a]) => (
              <details key={id} id={id} className="group py-4">
                <summary className="cursor-pointer list-none font-medium">{q}</summary>
                <p className="mt-2 text-sm text-muted">{a}</p>
              </details>
            ))}
          </div>
        </section>
        <section aria-labelledby="contact">
          <h2 id="contact" className="text-3xl">Write to us</h2>
          {m.isSuccess ? (
            <p className="card mt-4 p-6" role="status">Thanks — we've received your message and usually reply within one working day.</p>
          ) : (
            <form className="mt-4 space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" htmlFor="s-name" error={fe.name}><input id="s-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
                <Field label="Email" htmlFor="s-email" error={fe.email}><input id="s-email" type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Topic" htmlFor="s-subject">
                  <select id="s-subject" className="input" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })}>
                    <option value="order">An order</option><option value="returns">Returns</option><option value="product">A product</option><option value="payment">Payment</option><option value="other">Something else</option>
                  </select>
                </Field>
                <Field label="Order number (optional)" htmlFor="s-order" error={fe.orderNumber}><input id="s-order" inputMode="numeric" className="input" value={f.orderNumber} onChange={(e) => setF({ ...f, orderNumber: e.target.value.replace(/\D/g, '') })} /></Field>
              </div>
              <Field label="Message" htmlFor="s-msg" error={fe.message}><textarea id="s-msg" className="input min-h-32" value={f.message} maxLength={3000} onChange={(e) => setF({ ...f, message: e.target.value })} /></Field>
              {m.error && !Object.keys(fe).length && <InlineError error={m.error} />}
              <button className="btn-primary" disabled={m.isPending}>{m.isPending ? 'Sending…' : 'Send message'}</button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}

export function AboutPage() {
  return (
    <div className="page max-w-3xl pt-12">
      <p className="eyebrow">Our approach</p>
      <h1 className="mt-2 text-5xl">Fewer, better things</h1>
      <div className="mt-6 space-y-5 text-lg leading-8 text-ink/85">
        <p>We stock a small range of everyday goods for practice, kitchen and home, chosen for how they are made and how long they last.</p>
        <p id="sourcing">We buy directly from producer groups and small workshops, and we describe products plainly: material, origin, size and care. We don't make health claims.</p>
        <p id="journal">This is a demonstration store. Product names and descriptions are original placeholders. Photos are representative, freely licensed images (see <Link className="underline underline-offset-2" to="/image-credits">image credits</Link>), not pictures of the exact items.</p>
      </div>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="page grid min-h-[60vh] place-items-center text-center">
      <div>
        <p className="eyebrow">404</p>
        <h1 className="mt-2 text-5xl">This page wandered off</h1>
        <p className="mt-3 text-muted">The link may be old, or the page may have moved.</p>
        <Link to="/" className="btn-primary mt-6">Back to home</Link>
      </div>
    </div>
  );
}
