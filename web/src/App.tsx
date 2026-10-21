import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Link, useRouteError } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import HomePage from './pages/HomePage';
import ListingPage from './pages/ListingPage';
import ProductPage from './pages/ProductPage';
import CartPage from './pages/CartPage';
import { AboutPage, AccountPage, AuthPage, NotFoundPage, SupportPage, WishlistPage } from './pages/AccountPages';

// Checkout and admin (with charts) are split into separate chunks.
const CheckoutPage = lazy(() => import('./pages/CheckoutPage'));
const OrderPage = lazy(() => import('./pages/OrderPage'));
const AdminLayout = lazy(() => import('./admin/AdminLayout').then((m) => ({ default: m.AdminLayout })));
const AnalyticsPage = lazy(() => import('./admin/AnalyticsPage'));
const InsightsPage = lazy(() => import('./admin/InsightsPage'));
const ProductsAdmin = lazy(() => import('./admin/ManagePages').then((m) => ({ default: m.ProductsAdmin })));
const ProductEditor = lazy(() => import('./admin/ManagePages').then((m) => ({ default: m.ProductEditor })));
const OrdersAdmin = lazy(() => import('./admin/ManagePages').then((m) => ({ default: m.OrdersAdmin })));
const SupportAdmin = lazy(() => import('./admin/ManagePages').then((m) => ({ default: m.SupportAdmin })));

const S = (el: ReactNode) => <Suspense fallback={<div className="page py-16"><Spinner /></div>}>{el}</Suspense>;

function RouteError() {
  const err = useRouteError() as Error;
  return (
    <div className="grid min-h-screen place-items-center p-6 text-center">
      <div role="alert">
        <h1 className="font-serif text-4xl">Something went wrong</h1>
        <p className="mt-2 text-muted">{import.meta.env.DEV ? err?.message : 'Please refresh the page or try again shortly.'}</p>
        <Link to="/" className="btn-primary mt-6" reloadDocument>Back to home</Link>
      </div>
    </div>
  );
}

export const routes = [
  {
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/shop', element: <ListingPage mode="all" key="all" /> },
      { path: '/search', element: <ListingPage mode="search" key="search" /> },
      { path: '/collections/:slug', element: <ListingPage mode="category" key="category" /> },
      { path: '/products/:slug', element: <ProductPage /> },
      { path: '/cart', element: <CartPage /> },
      { path: '/checkout', element: S(<CheckoutPage />) },
      { path: '/orders/:id', element: S(<OrderPage />) },
      { path: '/account', element: <AccountPage /> },
      { path: '/wishlist', element: <WishlistPage /> },
      { path: '/login', element: <AuthPage mode="login" key="login" /> },
      { path: '/register', element: <AuthPage mode="register" key="register" /> },
      { path: '/support', element: <SupportPage /> },
      { path: '/about', element: <AboutPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    path: '/admin',
    element: S(<AdminLayout />),
    errorElement: <RouteError />,
    children: [
      { index: true, element: S(<AnalyticsPage />) },
      { path: 'insights', element: S(<InsightsPage />) },
      { path: 'products', element: S(<ProductsAdmin />) },
      { path: 'products/:id', element: S(<ProductEditor />) },
      { path: 'orders', element: S(<OrdersAdmin />) },
      { path: 'support', element: S(<SupportAdmin />) },
    ],
  },
];

export const router = createBrowserRouter(routes);
