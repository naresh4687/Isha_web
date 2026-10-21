/**
 * Rule-based business insights derived from measured metrics. Each insight states the metric,
 * the observed pattern, a suggested action, and a caveat. Nothing here asserts causation.
 */
export interface Insight {
  id: string;
  severity: 'info' | 'opportunity' | 'warning';
  metric: string;
  observation: string;
  suggestion: string;
  caveat?: string;
}

const pct = (x: number | null | undefined, d = 1) => (x == null ? 'n/a' : `${(x * 100).toFixed(d)}%`);
const inr = (p: number) => `₹${Math.round(p / 100).toLocaleString('en-IN')}`;

export function buildInsights(input: {
  current: any;
  previous: any;
  categories: { name: string; shareOfNetSales: number | null; netSalesPaise: number }[];
  underperformers: { lowConversion: { title: string; views: number; viewToOrderRate: number | null }[]; minViews: number };
  inventory: { items: { title: string; variant: string; stock: number; daysOfCover: number | null; status: string }[] };
  discounts: { aovWithDiscountPaise: number | null; aovWithoutDiscountPaise: number | null; discountedOrderShare: number | null; caveat: string };
}): Insight[] {
  const out: Insight[] = [];
  const { current: c, previous: p } = input;
  const minSample = 30;

  if (c.orders >= minSample && p.orders >= minSample && p.netSalesPaise > 0) {
    const change = (c.netSalesPaise - p.netSalesPaise) / p.netSalesPaise;
    if (Math.abs(change) >= 0.1) {
      out.push({
        id: 'net-sales-change',
        severity: change > 0 ? 'info' : 'warning',
        metric: 'Net sales vs previous period',
        observation: `Net sales ${change > 0 ? 'rose' : 'fell'} ${pct(Math.abs(change))} (${inr(p.netSalesPaise)} → ${inr(c.netSalesPaise)}) on ${c.orders} vs ${p.orders} orders.`,
        suggestion: change > 0 ? 'Check which categories drove the increase and keep them well stocked.' : 'Break the decline down by category and traffic source before changing prices or promotions.',
        caveat: 'Period-over-period changes include seasonality; compare against the same period last year when that history exists.',
      });
    }
  }

  if (c.conversionRate != null && p.conversionRate != null && c.sessions >= 200 && p.sessions >= 200) {
    const delta = c.conversionRate - p.conversionRate;
    if (Math.abs(delta) >= 0.005) {
      out.push({
        id: 'conversion-change',
        severity: delta > 0 ? 'info' : 'warning',
        metric: 'Session conversion rate',
        observation: `Conversion moved from ${pct(p.conversionRate, 2)} to ${pct(c.conversionRate, 2)} across ${c.sessions.toLocaleString('en-IN')} sessions.`,
        suggestion: delta > 0 ? 'Note what changed (traffic mix, merchandising) so it can be repeated.' : 'Review the checkout funnel and traffic-source mix; a shift toward low-intent sources lowers conversion without any site problem.',
        caveat: 'Sessions are only counted for visitors who accepted analytics cookies.',
      });
    }
  }

  if (c.cartAbandonmentRate != null && c.cartSessions >= 50 && c.cartAbandonmentRate > 0.6) {
    out.push({
      id: 'cart-abandonment',
      severity: 'opportunity',
      metric: 'Cart abandonment rate',
      observation: `${pct(c.cartAbandonmentRate)} of sessions with an add-to-cart did not end in a paid order (${c.abandonedCartSessions} of ${c.cartSessions}).`,
      suggestion: 'Use the cart recovery queue for opted-in customers, and check whether shipping cost appears late in checkout.',
      caveat: 'Some abandoned sessions convert later in another session; this per-session measure overstates permanent loss.',
    });
  }

  const top = input.categories[0];
  if (top?.shareOfNetSales != null && top.shareOfNetSales > 0.35 && c.orders >= minSample) {
    out.push({
      id: 'category-concentration',
      severity: 'info',
      metric: 'Category share of net sales',
      observation: `${top.name} accounts for ${pct(top.shareOfNetSales)} of net sales in this period.`,
      suggestion: 'Protect availability in this category and use it as an entry point to cross-sell adjacent categories.',
    });
  }

  const urgent = input.inventory.items.filter((i) => i.status !== 'out_of_stock' && i.daysOfCover != null && i.daysOfCover < 14);
  if (urgent.length) {
    out.push({
      id: 'stock-cover',
      severity: 'warning',
      metric: 'Days of stock cover',
      observation: `${urgent.length} variant(s) have under 14 days of cover at the last 28 days' sales rate, e.g. ${urgent.slice(0, 3).map((i) => `${i.title} (${i.variant}: ${i.stock} left, ~${i.daysOfCover}d)`).join('; ')}.`,
      suggestion: 'Reorder these first; see the demand estimates in the BI section for quantities.',
      caveat: 'Velocity assumes the next weeks look like the last four.',
    });
  }
  const oos = input.inventory.items.filter((i) => i.status === 'out_of_stock');
  if (oos.length) {
    out.push({
      id: 'out-of-stock',
      severity: 'warning',
      metric: 'Out-of-stock variants',
      observation: `${oos.length} active variant(s) are out of stock and cannot be purchased or recommended.`,
      suggestion: 'Restock, or hide the product if it is discontinued.',
    });
  }

  const low = input.underperformers.lowConversion.slice(0, 3);
  if (low.length) {
    out.push({
      id: 'low-conversion-products',
      severity: 'opportunity',
      metric: 'View-to-order rate',
      observation: `Products with at least ${input.underperformers.minViews} views but the weakest conversion: ${low.map((l) => `${l.title} (${pct(l.viewToOrderRate)})`).join(', ')}.`,
      suggestion: 'Review their photography, description, price relative to similar items, and reviews.',
    });
  }

  const d = input.discounts;
  if (d.aovWithDiscountPaise != null && d.aovWithoutDiscountPaise != null && (d.discountedOrderShare ?? 0) > 0.05) {
    const diff = (d.aovWithDiscountPaise - d.aovWithoutDiscountPaise) / d.aovWithoutDiscountPaise;
    out.push({
      id: 'discount-aov',
      severity: 'info',
      metric: 'AOV with vs without discount code',
      observation: `Orders with a code average ${inr(d.aovWithDiscountPaise)} after discount vs ${inr(d.aovWithoutDiscountPaise)} without (${diff >= 0 ? '+' : ''}${pct(diff)}); ${pct(d.discountedOrderShare)} of orders used a code.`,
      suggestion: 'Test minimum-spend thresholds with a controlled experiment before concluding that discounts grow baskets.',
      caveat: d.caveat,
    });
  }

  if (c.repeatPurchaseRate != null && c.purchasers >= minSample) {
    out.push({
      id: 'repeat-rate',
      severity: c.repeatPurchaseRate < 0.2 ? 'opportunity' : 'info',
      metric: 'Repeat purchase rate',
      observation: `${pct(c.repeatPurchaseRate)} of this period's ${c.purchasers} purchasers have bought at least twice; ${c.newCustomers} were first-time buyers.`,
      suggestion: c.repeatPurchaseRate < 0.2 ? 'Consider post-purchase follow-ups for consumables (food, body care) where reorders are natural.' : 'Use RFM segments to reward the most frequent customers.',
    });
  }
  return out;
}
