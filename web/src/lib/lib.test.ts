import { inr, inrCompact, pct } from './format';
import { validateAddress } from '../pages/CheckoutPage';
import { ApiError, qs } from '../api/client';
import { safeNext } from '../pages/AccountPages';

describe('formatting', () => {
  it('formats paise as INR with Indian grouping', () => {
    expect(inr(12345600)).toBe('₹1,23,456');
    expect(inr(99950)).toBe('₹999.5');
    expect(inr(7900)).toBe('₹79');
    expect(inr(null)).toBe('—');
    expect(inrCompact(56254280)).toBe('₹5.63 L');
    expect(pct(0.14372, 2)).toBe('14.37%');
    expect(pct(null)).toBe('—');
  });
});

describe('address validation', () => {
  const ok = { fullName: 'Asha Rao', phone: '+91 98765-43210', line1: '12 Lake View', line2: '', city: 'Pune', state: 'Maharashtra', postalCode: '411001' };
  it('accepts a valid Indian address', () => expect(validateAddress(ok)).toEqual({}));
  it('rejects bad PIN, phone and missing state', () => {
    const e = validateAddress({ ...ok, postalCode: '011001', phone: '12345', state: '' });
    expect(Object.keys(e).sort()).toEqual(['phone', 'postalCode', 'state']);
  });
});

describe('api helpers', () => {
  it('builds query strings without empty values', () => {
    expect(qs({ a: 1, b: '', c: undefined, d: 'x y' })).toBe('?a=1&d=x+y');
    expect(qs({})).toBe('');
  });
  it('flattens field errors', () => {
    expect(new ApiError(400, 'x', 'validation_error', { fieldErrors: { email: ['Invalid email'] } }).fieldErrors()).toEqual({ email: 'Invalid email' });
  });
});

describe('post-login redirect', () => {
  it('allows same-site paths only', () => {
    expect(safeNext('/checkout?code=X')).toBe('/checkout?code=X');
    for (const bad of ['//evil.com', '/\\evil.com', '/\\/evil.com', 'https://evil.com', '/ok\\..', null, '']) expect(safeNext(bad)).toBe('/account');
  });
});
