import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useCart, useCategories, useMe, useSettings } from '../hooks/useStore';
import { BagIcon, ChevronDown, CloseIcon, HeartIcon, MenuIcon, MoonIcon, SearchIcon, SunIcon, UserIcon } from './Icons';
import { getConsent, setConsent, track } from '../lib/tracking';

export const BRAND_FALLBACK = 'Anvaya';

function useBrand() {
  const s = useSettings();
  return { name: s.data?.brand?.name ?? BRAND_FALLBACK, tagline: s.data?.brand?.tagline as string | undefined, announcement: s.data?.announcement?.text as string | undefined };
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
  };
  return (
    <button type="button" onClick={toggle} className="grid h-10 w-10 place-items-center rounded-full hover:bg-sunken" aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}>
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SearchBox({ onDone }: { onDone?: () => void }) {
  const nav = useNavigate();
  const loc = useLocation();
  const [q, setQ] = useState(() => new URLSearchParams(loc.search).get('q') ?? '');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    nav(`/search?q=${encodeURIComponent(term)}`);
    onDone?.();
  };
  return (
    <form role="search" onSubmit={submit} className="relative w-full">
      <label htmlFor="site-search" className="sr-only">Search products</label>
      <input id="site-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search malas, mats, millets…" className="input rounded-full pl-10" maxLength={100} />
      <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" width={18} height={18} />
    </form>
  );
}

function MegaNav() {
  const cats = useCategories();
  const [open, setOpen] = useState<string | null>(null);
  const timer = useRef<number>();
  const loc = useLocation();
  useEffect(() => setOpen(null), [loc.pathname, loc.search]);
  const show = (slug: string | null) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(slug), slug ? 80 : 150);
  };
  return (
    <nav aria-label="Product categories" className="hidden border-t border-line lg:block" onMouseLeave={() => show(null)}>
      <ul className="page flex items-center justify-center gap-1">
        {(cats.data ?? []).map((c) => (
          <li key={c.slug} className="relative" onMouseEnter={() => show(c.slug)}>
            <div className="flex items-center">
              <NavLink to={`/collections/${c.slug}`} className={({ isActive }) => `block px-3 py-3 text-[13px] font-medium tracking-wide hover:text-accent ${isActive ? 'text-accent' : ''}`}>
                {c.name}
              </NavLink>
              <button
                type="button"
                className="-ml-2 grid h-8 w-6 place-items-center text-muted hover:text-ink"
                aria-expanded={open === c.slug}
                aria-controls={`menu-${c.slug}`}
                aria-label={`${c.name} subcategories`}
                onClick={() => setOpen(open === c.slug ? null : c.slug)}
                onKeyDown={(e) => e.key === 'Escape' && setOpen(null)}
              >
                <ChevronDown width={14} height={14} />
              </button>
            </div>
            {open === c.slug && (
              <div id={`menu-${c.slug}`} className="absolute left-1/2 top-full z-40 w-[520px] -translate-x-1/2 pt-1" onKeyDown={(e) => e.key === 'Escape' && setOpen(null)}>
                <div className="card grid grid-cols-[1fr_180px] gap-6 p-6 shadow-xl shadow-ink/5">
                  <div>
                    <p className="eyebrow mb-3">Shop {c.name}</p>
                    <ul className="grid grid-cols-2 gap-y-2">
                      {c.subcategories.map((s) => (
                        <li key={s}>
                          <Link className="text-sm hover:text-accent" to={`/collections/${c.slug}?subcategory=${encodeURIComponent(s)}`}>{s}</Link>
                        </li>
                      ))}
                    </ul>
                    <Link to={`/collections/${c.slug}`} className="btn-link mt-4 inline-block">View all {c.productCount}</Link>
                  </div>
                  <p className="border-l border-line pl-5 text-sm text-muted">{c.description}</p>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

function MobileMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cats = useCategories();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button, a, input')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div ref={ref} className="absolute inset-y-0 left-0 flex w-[86vw] max-w-sm flex-col overflow-y-auto bg-canvas p-5">
        <div className="mb-5 flex items-center justify-between">
          <span className="font-serif text-2xl">Menu</span>
          <button onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full hover:bg-sunken" aria-label="Close menu"><CloseIcon /></button>
        </div>
        <SearchBox onDone={onClose} />
        <ul className="mt-6 divide-y divide-line border-y border-line">
          {(cats.data ?? []).map((c) => (
            <li key={c.slug}>
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between py-3.5 font-medium">
                  {c.name}
                  <ChevronDown className="transition group-open:rotate-180" width={16} height={16} />
                </summary>
                <ul className="pb-3 pl-3">
                  <li><Link onClick={onClose} className="block py-1.5 text-sm" to={`/collections/${c.slug}`}>All {c.name}</Link></li>
                  {c.subcategories.map((s) => (
                    <li key={s}><Link onClick={onClose} className="block py-1.5 text-sm text-muted" to={`/collections/${c.slug}?subcategory=${encodeURIComponent(s)}`}>{s}</Link></li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-col gap-3 text-sm">
          <Link onClick={onClose} to="/account">Account</Link>
          <Link onClick={onClose} to="/wishlist">Wishlist</Link>
          <Link onClick={onClose} to="/support">Help & support</Link>
        </div>
      </div>
    </div>
  );
}

function Header() {
  const brand = useBrand();
  const me = useMe();
  const cart = useCart();
  const [menu, setMenu] = useState(false);
  const count = cart.data?.itemCount ?? 0;
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/95 backdrop-blur">
      <div className="page flex h-16 items-center gap-3 lg:h-20">
        <button className="grid h-10 w-10 place-items-center rounded-full hover:bg-sunken lg:hidden" onClick={() => setMenu(true)} aria-label="Open menu" aria-haspopup="dialog">
          <MenuIcon />
        </button>
        <Link to="/" className="mr-2 flex items-center gap-2.5" aria-label={`${brand.name} home`}>
          <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden><circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="1.5" /><circle cx="16" cy="16" r="7" fill="none" stroke="rgb(var(--accent))" strokeWidth="1.5" /><circle cx="16" cy="16" r="2" fill="rgb(var(--accent))" /></svg>
          <span className="font-serif text-[26px] font-semibold leading-none tracking-tight">{brand.name}</span>
        </Link>
        <div className="mx-auto hidden w-full max-w-md md:block"><SearchBox /></div>
        <div className="ml-auto flex items-center gap-0.5 md:ml-0">
          <Link to="/search" className="grid h-10 w-10 place-items-center rounded-full hover:bg-sunken md:hidden" aria-label="Search"><SearchIcon /></Link>
          <ThemeToggle />
          <Link to={me.data ? '/account' : '/login'} className="grid h-10 w-10 place-items-center rounded-full hover:bg-sunken" aria-label={me.data ? 'Your account' : 'Sign in'}><UserIcon /></Link>
          <Link to="/wishlist" className="hidden h-10 w-10 place-items-center rounded-full hover:bg-sunken sm:grid" aria-label="Wishlist"><HeartIcon /></Link>
          <Link to="/cart" className="relative grid h-10 w-10 place-items-center rounded-full hover:bg-sunken" aria-label={`Cart, ${count} item${count === 1 ? '' : 's'}`}>
            <BagIcon />
            {count > 0 && <span className="absolute right-0.5 top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-ink">{count}</span>}
          </Link>
          {me.data?.role === 'admin' && <Link to="/admin" className="btn-ghost ml-2 hidden px-4 py-1.5 text-xs lg:inline-flex">Admin</Link>}
        </div>
      </div>
      <MegaNav />
      <MobileMenu open={menu} onClose={() => setMenu(false)} />
    </header>
  );
}

function Footer() {
  const brand = useBrand();
  const cats = useCategories();
  const cols: [string, [string, string][]][] = [
    ['Shop', (cats.data ?? []).slice(0, 6).map((c) => [c.name, `/collections/${c.slug}`])],
    ['Company', [['Our approach', '/about'], ['Sourcing', '/about#sourcing'], ['Journal', '/about#journal']]],
    ['Help', [['Contact & support', '/support'], ['Shipping & delivery', '/support#shipping'], ['Returns', '/support#returns'], ['Order history', '/account']]],
  ];
  return (
    <footer className="mt-24 border-t border-line bg-sunken/60">
      <div className="page grid gap-10 py-14 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <p className="font-serif text-3xl">{brand.name}</p>
          <p className="mt-3 max-w-xs text-sm text-muted">{brand.tagline}</p>
          <p className="mt-6 text-xs text-muted">An independent demonstration store. Not affiliated with any other retailer. Product images are illustrations.</p>
        </div>
        {cols.map(([title, links]) => (
          <div key={title}>
            <h2 className="eyebrow mb-4 font-sans">{title}</h2>
            <ul className="space-y-2.5 text-sm">
              {links.map(([label, to]) => (
                <li key={label}><Link className="hover:text-accent" to={to}>{label}</Link></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-line">
        <div className="page flex flex-col gap-2 py-5 text-xs text-muted sm:flex-row sm:justify-between">
          <p>© {new Date().getFullYear()} {brand.name}. Prices include GST.</p>
          <button className="text-left hover:text-ink" onClick={() => { document.cookie = 'consent=; path=/; max-age=0'; location.reload(); }}>Cookie preferences</button>
        </div>
      </div>
    </footer>
  );
}

function ConsentBanner() {
  const [choice, setChoice] = useState(getConsent);
  if (choice) return null;
  const pick = (v: 'analytics' | 'essential') => {
    setConsent(v);
    setChoice(v);
    if (v === 'analytics') track({ type: 'page_view', metadata: { path: location.pathname } });
  };
  return (
    <div role="region" aria-label="Cookie consent" className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-2xl rounded-2xl border border-line bg-surface p-5 shadow-2xl shadow-ink/10 sm:inset-x-6">
      <p className="text-sm">
        We use essential cookies to run the store (cart, sign-in). With your permission we also record anonymous browsing activity on this site to improve recommendations and understand what works. No advertising trackers.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn-primary" onClick={() => pick('analytics')}>Allow analytics</button>
        <button className="btn-ghost" onClick={() => pick('essential')}>Essential only</button>
      </div>
    </div>
  );
}

export function Layout() {
  const brand = useBrand();
  const loc = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    track({ type: 'page_view', metadata: { path: loc.pathname.slice(0, 200) } });
  }, [loc.pathname]);
  useEffect(() => {
    document.title = brand.name;
  }, [brand.name]);
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-canvas">Skip to content</a>
      {brand.announcement && (
        <div className="bg-ink text-canvas">
          <p className="page py-2 text-center text-xs tracking-wide">{brand.announcement}</p>
        </div>
      )}
      <Header />
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <Footer />
      <ConsentBanner />
    </div>
  );
}
