import { Link, Navigate, NavLink, Outlet } from 'react-router-dom';
import { useMe } from '../hooks/useStore';
import { Spinner } from '../components/ui';

const NAV = [
  ['/admin', 'Analytics', true],
  ['/admin/insights', 'Recommendations & BI', false],
  ['/admin/products', 'Products & inventory', false],
  ['/admin/orders', 'Orders', false],
  ['/admin/support', 'Support & recovery', false],
] as const;

/** Client-side gate for navigation only; every admin API route is authorised server-side. */
export function AdminLayout() {
  const me = useMe();
  if (me.isLoading) return <div className="page py-16"><Spinner /></div>;
  if (!me.data) return <Navigate to="/login?next=/admin" replace />;
  if (me.data.role !== 'admin')
    return (
      <div className="page py-16 text-center">
        <h1 className="text-4xl">Administrator access required</h1>
        <Link className="btn-primary mt-6" to="/">Back to the store</Link>
      </div>
    );
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <Link to="/" className="font-serif text-xl font-semibold">← Store</Link>
          <nav aria-label="Admin" className="-mx-1 flex flex-1 gap-1 overflow-x-auto">
            {NAV.map(([to, label, end]) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) => `whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm ${isActive ? 'bg-ink text-canvas' : 'hover:bg-sunken'}`}>
                {label}
              </NavLink>
            ))}
          </nav>
          <span className="text-xs text-muted">{me.data.email}</span>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
