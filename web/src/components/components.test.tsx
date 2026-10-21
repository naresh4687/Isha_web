import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ProductCard } from './ProductCard';
import { EmptyState, ErrorState, Pagination, Price, Rating } from './ui';
import { ApiError } from '../api/client';
import type { ProductCard as P } from '../api/types';

const base: P = {
  id: '1', slug: 'cork-yoga-block', title: 'Cork Yoga Block', category: { slug: 'yoga-store', name: 'Yoga Store' }, subcategory: 'Props',
  pricePaise: 79000, compareAtPaise: null, discountPct: 0, ratingAvg: 4.2, ratingCount: 41, inStock: true, lowStock: false, isNew: false,
  image: '/media/products/cork-yoga-block/0.svg', tags: [],
};
const card = (p: Partial<P>, props = {}) => render(<MemoryRouter><ProductCard product={{ ...base, ...p }} {...props} /></MemoryRouter>);

describe('ProductCard', () => {
  it('shows price, rating and links to the product', () => {
    card({});
    expect(screen.getByText('₹790')).toBeInTheDocument();
    expect(screen.getByLabelText('Rated 4.2 out of 5 from 41 reviews')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cork Yoga Block' })).toHaveAttribute('href', '/products/cork-yoga-block');
    expect(screen.getAllByRole('link')).toHaveLength(1); // image link is hidden from AT to avoid a duplicate tab stop
  });
  it('flags sold-out, discounted, low-stock and new items', () => {
    card({ inStock: false });
    expect(screen.getByText('Sold out')).toBeInTheDocument();
  });
  it('shows discount and was-price', () => {
    card({ compareAtPaise: 99000, discountPct: 20, lowStock: true });
    expect(screen.getByText('20% off', { selector: 'span.inline-flex' })).toBeInTheDocument();
    expect(screen.getByLabelText('was ₹990')).toBeInTheDocument();
    expect(screen.getByText('Only a few left')).toBeInTheDocument();
  });
  it('wishlist button is a toggle with an accessible name', async () => {
    const on = vi.fn();
    card({}, { onWishlist: on, wishlisted: false });
    const btn = screen.getByRole('button', { name: 'Add Cork Yoga Block to wishlist' });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(btn);
    expect(on).toHaveBeenCalledWith(true);
  });
});

describe('ui primitives', () => {
  it('Rating handles no reviews', () => {
    render(<Rating value={0} count={0} />);
    expect(screen.getByText('No reviews yet')).toBeInTheDocument();
  });
  it('Price renders compare-at only when provided', () => {
    const { rerender } = render(<Price price={50000} />);
    expect(screen.queryByLabelText(/was/)).toBeNull();
    rerender(<Price price={50000} compareAt={60000} discountPct={17} />);
    expect(screen.getByLabelText('was ₹600')).toBeInTheDocument();
  });
  it('ErrorState shows API messages and retries', async () => {
    const retry = vi.fn();
    render(<ErrorState error={new ApiError(503, 'Payments are not configured', 'x')} retry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Payments are not configured');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });
  it('EmptyState renders title and action', () => {
    render(<EmptyState title="Your cart is empty" action={<button>Shop</button>} />);
    expect(screen.getByRole('heading', { name: 'Your cart is empty' })).toBeInTheDocument();
  });
  it('Pagination marks the current page and disables bounds', async () => {
    const onPage = vi.fn();
    render(<Pagination page={1} totalPages={8} onPage={onPage} />);
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '1' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('…')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPage).toHaveBeenCalledWith(2);
  });
});
