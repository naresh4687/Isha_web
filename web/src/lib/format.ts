/** Whole rupees from ₹1,000 up (allocated aggregates carry fractional paise); exact paise below. */
export const inr = (paise: number | null | undefined) =>
  paise == null ? '—' : `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: paise % 100 === 0 || Math.abs(paise) >= 100000 ? 0 : 2 })}`;

export const inrCompact = (paise: number) => {
  const r = paise / 100;
  if (r >= 1e7) return `₹${(r / 1e7).toFixed(2)} Cr`;
  if (r >= 1e5) return `₹${(r / 1e5).toFixed(2)} L`;
  if (r >= 1e3) return `₹${(r / 1e3).toFixed(1)}k`;
  return `₹${Math.round(r)}`;
};

export const pct = (x: number | null | undefined, digits = 1) => (x == null ? '—' : `${(x * 100).toFixed(digits)}%`);

export const date = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const ORDER_STATUS: Record<string, string> = {
  pending_payment: 'Awaiting payment',
  payment_failed: 'Payment failed',
  paid: 'Confirmed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};
