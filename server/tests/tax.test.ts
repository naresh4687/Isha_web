import { describe, expect, it } from 'vitest';
import { address, admin, customer, variantWithStock } from './helpers.js';
import { taxBreakdown } from '../src/modules/orders/service.js';

describe('taxBreakdown (pure)', () => {
  const order = { subtotalPaise: 150000, discountPaise: 15000, shippingAddress: { state: 'Karnataka' } };
  const items = [{ lineTotalPaise: 100000, gstRateBps: 1200 }, { lineTotalPaise: 50000, gstRateBps: 500 }];

  it('extracts GST from inclusive prices after the discount share', () => {
    const t = taxBreakdown(order, items, 'Karnataka')!;
    // line 1: net 90,000 at 12% -> taxable round(90,000/1.12) = 80,357, tax 9,643
    // line 2: net 45,000 at 5%  -> taxable round(45,000/1.05) = 42,857, tax 2,143
    expect(t.rows).toEqual([
      { rateBps: 500, inclusivePaise: 45000, taxablePaise: 42857, taxPaise: 2143 },
      { rateBps: 1200, inclusivePaise: 90000, taxablePaise: 80357, taxPaise: 9643 },
    ]);
    expect(t.taxPaise).toBe(11786);
    expect(t.taxablePaise + t.taxPaise).toBe(order.subtotalPaise - order.discountPaise);
    expect(t.split).toEqual({ type: 'CGST+SGST', cgstPaise: 5893, sgstPaise: 5893 });
  });

  it('uses IGST for inter-state shipments and no split when the seller state is unset', () => {
    expect(taxBreakdown(order, items, 'Tamil Nadu')!.split).toEqual({ type: 'IGST', igstPaise: 11786 });
    expect(taxBreakdown(order, items, undefined)!.split).toBeNull();
  });

  it('returns null unless every line has a configured rate', () => {
    expect(taxBreakdown(order, [{ lineTotalPaise: 100000, gstRateBps: null }, items[1]])).toBeNull();
  });
});

describe('GST configuration', () => {
  it('admin sets rates; orders snapshot the rate at checkout', async () => {
    const a = await admin();
    const u = await customer();
    expect((await u.put('/api/admin/tax-rates', { rates: [{ slug: 'books', gstRateBps: 0 }] })).status).toBe(403);
    expect((await a.put('/api/admin/tax-rates', { rates: [{ slug: 'home-decor', gstRateBps: 1200 }] })).status).toBe(200);
    expect((await a.put('/api/admin/tax-rates', { rates: [{ slug: 'nope', gstRateBps: 500 }] })).status).toBe(400);
    expect((await a.put('/api/admin/tax-rates', { rates: [{ slug: 'home-decor', gstRateBps: 9000 }] })).status).toBe(400);

    const v = await variantWithStock(5, 112000, 'home-decor');
    await u.post('/api/cart/items', { variantId: v.id });
    const co = await u.post('/api/checkout', { address });
    await u.post('/api/payments/mock/complete', { orderId: co.body.orderId, outcome: 'success' });
    const before = (await u.get(`/api/orders/${co.body.orderId}`)).body.order.tax;
    expect(before.rows).toEqual([{ rateBps: 1200, inclusivePaise: 112000, taxablePaise: 100000, taxPaise: 12000 }]);

    // Changing the category rate later does not rewrite past orders.
    await a.put('/api/admin/tax-rates', { rates: [{ slug: 'home-decor', gstRateBps: 1800 }] });
    expect((await u.get(`/api/orders/${co.body.orderId}`)).body.order.tax.rows[0].rateBps).toBe(1200);
    await a.put('/api/admin/tax-rates', { rates: [{ slug: 'home-decor', gstRateBps: null }] });
  });
});
