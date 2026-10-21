import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api/client';
import { useCategories } from '../hooks/useStore';
import { ErrorState, Spinner } from '../components/ui';
import { ChartCard, HBar, TrendLine } from './charts';
import { inr, inrCompact, pct } from '../lib/format';

const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() + 5.5 * 3600_000 - n * 86_400_000).toISOString().slice(0, 10);
const PRESETS: [string, number][] = [['7 days', 6], ['30 days', 29], ['90 days', 89], ['180 days', 179]];

const METRICS = {
  netSalesPaise: { label: 'Net sales', fmt: inrCompact },
  gmvPaise: { label: 'GMV', fmt: inrCompact },
  orders: { label: 'Orders', fmt: (v: number) => String(Math.round(v)) },
  conversionRate: { label: 'Conversion rate', fmt: (v: number) => pct(v) },
} as const;

function Kpi({ label, value, prev, current, invert, definition }: { label: string; value: string; prev?: number | null; current?: number | null; invert?: boolean; definition: string }) {
  let delta: { text: string; good: boolean } | null = null;
  if (prev != null && current != null && prev !== 0) {
    const d = (current - prev) / Math.abs(prev);
    delta = { text: `${d >= 0 ? '▲' : '▼'} ${Math.abs(d * 100).toFixed(1)}%`, good: invert ? d < 0 : d >= 0 };
  }
  return (
    <div className="card p-4">
      <p className="text-xs text-muted" title={definition}>{label}</p>
      <p className="mt-1 text-2xl font-medium tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted">
        {delta ? <span className={delta.good ? 'text-success' : 'text-danger'}>{delta.text} <span className="sr-only">{delta.good ? 'improvement' : 'decline'}</span></span> : '—'} vs previous period
      </p>
    </div>
  );
}

function DataTable({ cols, rows, onRow, caption }: { cols: [string, string, (r: any) => React.ReactNode][]; rows: any[]; onRow?: (r: any) => void; caption: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            {cols.map(([k, label]) => <th key={k} scope="col" className="py-2 pr-4 font-medium">{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={`border-b border-line/60 ${onRow ? 'cursor-pointer hover:bg-sunken/60' : ''}`} onClick={onRow ? () => onRow(r) : undefined} tabIndex={onRow ? 0 : undefined} onKeyDown={onRow ? (e) => e.key === 'Enter' && onRow(r) : undefined}>
              {cols.map(([k, , render]) => <td key={k} className="py-2 pr-4 tabular-nums">{render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="py-6 text-center text-sm text-muted">No data for this selection.</p>}
    </div>
  );
}

export default function AnalyticsPage() {
  const [sp, setSp] = useSearchParams();
  const cats = useCategories();
  const f = {
    from: sp.get('from') ?? daysAgo(29),
    to: sp.get('to') ?? istToday(),
    granularity: sp.get('granularity') ?? 'day',
    category: sp.get('category') ?? '',
    productId: sp.get('productId') ?? '',
    includeDemo: sp.get('includeDemo') ?? 'true',
  };
  const [metric, setMetric] = useState<keyof typeof METRICS>('netSalesPaise');
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    setSp(next, { replace: true });
  };
  const q = useQuery({ queryKey: ['analytics', f], queryFn: () => api<any>(`/api/admin/analytics/overview${qs(f)}`), placeholderData: keepPreviousData });
  const d = q.data;
  const tick = (b: string) => {
    const dt = new Date(`${b}T00:00:00`);
    return f.granularity === 'month' ? dt.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }) : dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };
  const exportUrl = (report: string) => `/api/admin/analytics/export/${report}.csv${qs(f)}`;
  const productName = f.productId ? d?.topProducts?.find((p: any) => p.id === f.productId)?.title ?? d?.underperformers?.noSales?.find((p: any) => p.id === f.productId)?.title ?? 'Selected product' : '';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl">Business analytics</h1>
          <p className="text-sm text-muted">Computed from persisted orders, sessions and events. Dates in IST. Hover a KPI for its formula; full definitions in <code>docs/METRICS.md</code>.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {['summary', 'trend', 'categories', 'products', 'inventory', 'discounts', 'sources'].map((r) => (
            <a key={r} className="btn-ghost px-3 py-1.5 text-xs" href={exportUrl(r)} download>{r}.csv</a>
          ))}
        </div>
      </div>

      {d?.provenance && d.provenance.demoOrders > 0 && f.includeDemo === 'true' && (
        <div role="note" className="rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm">
          <strong>Demo data.</strong> This view includes {d.provenance.demoOrders.toLocaleString('en-IN')} synthetic orders and {d.provenance.demoEvents.toLocaleString('en-IN')} synthetic events generated by <code>npm run seed:demo</code> (flagged <code>is_demo</code>). They are not real business results. Real orders: {d.provenance.realOrders}.
          <button className="btn-link ml-2" onClick={() => set({ includeDemo: 'false' })}>Show real data only</button>
        </div>
      )}

      {/* Filters: one row above the charts */}
      <div className="card flex flex-wrap items-end gap-3 p-4" role="group" aria-label="Filters">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Date range presets">
          {PRESETS.map(([label, n]) => {
            const on = f.from === daysAgo(n) && f.to === istToday();
            return <button key={label} className={`rounded-full px-3 py-1.5 text-xs ${on ? 'bg-ink text-canvas' : 'border border-line'}`} onClick={() => set({ from: daysAgo(n), to: istToday() })} aria-pressed={on}>{label}</button>;
          })}
        </div>
        <label className="text-xs">From<input type="date" className="input mt-1 py-1.5" value={f.from} max={f.to} onChange={(e) => set({ from: e.target.value })} /></label>
        <label className="text-xs">To<input type="date" className="input mt-1 py-1.5" value={f.to} min={f.from} onChange={(e) => set({ to: e.target.value })} /></label>
        <label className="text-xs">Granularity
          <select className="input mt-1 py-1.5" value={f.granularity} onChange={(e) => set({ granularity: e.target.value })}>
            <option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option>
          </select>
        </label>
        <label className="text-xs">Category
          <select className="input mt-1 py-1.5" value={f.category} onChange={(e) => set({ category: e.target.value, productId: '' })}>
            <option value="">All categories</option>
            {cats.data?.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={f.includeDemo === 'true'} onChange={(e) => set({ includeDemo: e.target.checked ? 'true' : 'false' })} />Include demo data</label>
        {(f.category || f.productId) && (
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-full bg-sunken px-3 py-1.5">Drill-down: {f.productId ? productName : cats.data?.find((c) => c.slug === f.category)?.name}</span>
            <button className="btn-link" onClick={() => set({ category: '', productId: '' })}>Clear</button>
          </div>
        )}
        {q.isFetching && <Spinner label="Updating" />}
      </div>

      {q.isError ? <ErrorState error={q.error} retry={() => q.refetch()} /> : !d ? <Spinner /> : (
        <>
          <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <Kpi label="Net sales" value={inr(d.summary.netSalesPaise)} current={d.summary.netSalesPaise} prev={d.previous.netSalesPaise} definition="GMV − discounts − refunds (merchandise only; excludes shipping)" />
            <Kpi label="GMV" value={inr(d.summary.gmvPaise)} current={d.summary.gmvPaise} prev={d.previous.gmvPaise} definition="Σ line price × qty for paid orders, before discounts and refunds" />
            <Kpi label="Orders (paid)" value={String(d.summary.orders)} current={d.summary.orders} prev={d.previous.orders} definition="Orders with paid_at in range" />
            <Kpi label="Completed" value={String(d.summary.completedOrders)} current={d.summary.completedOrders} prev={d.previous.completedOrders} definition="Paid orders now delivered" />
            <Kpi label="Avg order value" value={inr(d.summary.averageOrderValuePaise)} current={d.summary.averageOrderValuePaise} prev={d.previous.averageOrderValuePaise} definition="(GMV − discounts) / paid orders" />
            <Kpi label="Conversion" value={pct(d.summary.conversionRate, 2)} current={d.summary.conversionRate} prev={d.previous.conversionRate} definition="Sessions with a paid order / consented sessions" />
            <Kpi label="Cart abandonment" value={pct(d.summary.cartAbandonmentRate)} current={d.summary.cartAbandonmentRate} prev={d.previous.cartAbandonmentRate} invert definition="Sessions with add-to-cart but no paid order / sessions with add-to-cart" />
            <Kpi label="Repeat purchase rate" value={pct(d.summary.repeatPurchaseRate)} current={d.summary.repeatPurchaseRate} prev={d.previous.repeatPurchaseRate} definition="Purchasers in range with ≥2 lifetime paid orders / purchasers in range" />
          </section>

          <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
            <ChartCard title={`${METRICS[metric].label} — ${({ day: 'daily', week: 'weekly', month: 'monthly' } as Record<string, string>)[f.granularity]}`} subtitle={`${f.from} to ${f.to}${f.category || f.productId ? ' · filtered' : ''}`}
              actions={
                <div className="flex flex-wrap gap-1" role="group" aria-label="Trend metric">
                  {(Object.keys(METRICS) as (keyof typeof METRICS)[]).map((m) => (
                    <button key={m} aria-pressed={metric === m} onClick={() => setMetric(m)} className={`rounded-full px-3 py-1 text-xs ${metric === m ? 'bg-ink text-canvas' : 'border border-line'}`}>{METRICS[m].label}</button>
                  ))}
                </div>
              }>
              <TrendLine data={d.trend} dataKey={metric} name={METRICS[metric].label} format={METRICS[metric].fmt as (v: number) => string} tick={tick} />
              {metric === 'conversionRate' && <p className="mt-2 text-xs text-muted">Conversion is store-wide; category and product filters do not apply to it.</p>}
            </ChartCard>
            <ChartCard title="Net sales by category" subtitle="Click a bar to drill down">
              <HBar data={d.categories} dataKey="netSalesPaise" labelKey="name" name="Net sales" format={inrCompact} onSelect={(r) => set({ category: r.slug, productId: '' })} />
            </ChartCard>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <ChartCard title="Customers" subtitle="Store-wide, paid orders">
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div><dt className="text-xs text-muted">Purchasers</dt><dd className="text-xl tabular-nums">{d.summary.purchasers}</dd></div>
                <div><dt className="text-xs text-muted">New / returning</dt><dd className="text-xl tabular-nums">{d.summary.newCustomers} / {d.summary.returningCustomers}</dd></div>
                <div><dt className="text-xs text-muted">Retention vs previous period</dt><dd className="text-xl tabular-nums">{pct(d.summary.retentionRate)}</dd><dd className="text-xs text-muted">{d.summary.retainedCustomers} of {d.summary.previousPeriodPurchasers}</dd></div>
                <div><dt className="text-xs text-muted">Sessions (consented)</dt><dd className="text-xl tabular-nums">{d.summary.sessions.toLocaleString('en-IN')}</dd></div>
                <div><dt className="text-xs text-muted">Discounts given</dt><dd className="text-xl tabular-nums">{inr(d.summary.discountsPaise)}</dd></div>
                <div><dt className="text-xs text-muted">Refunds</dt><dd className="text-xl tabular-nums">{inr(d.summary.refundsPaise)}</dd><dd className="text-xs text-muted">{d.summary.cancelledOrRefundedOrders} orders</dd></div>
              </dl>
            </ChartCard>
            <ChartCard title="Acquisition source" subtitle="Session source (UTM / referrer); net sales of converting sessions">
              <DataTable caption="Acquisition sources" rows={d.sources} cols={[
                ['source', 'Source', (r) => r.source.replace('_', ' ')],
                ['sessions', 'Sessions', (r) => r.sessions.toLocaleString('en-IN')],
                ['cr', 'Conv.', (r) => pct(r.conversionRate, 2)],
                ['net', 'Net sales', (r) => inrCompact(r.netSalesPaise)],
              ]} />
            </ChartCard>
            <ChartCard title="Discount usage" subtitle={`${pct(d.discounts.discountedOrderShare)} of orders used a code`}>
              <DataTable caption="Discount codes" rows={d.discounts.items} cols={[
                ['code', 'Code', (r) => r.code],
                ['orders', 'Orders', (r) => r.orders],
                ['disc', 'Discount', (r) => inrCompact(r.discountsPaise)],
                ['aov', 'AOV', (r) => inr(r.averageOrderValuePaise)],
              ]} />
              <p className="mt-3 text-xs text-muted">{d.discounts.caveat}</p>
            </ChartCard>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <ChartCard title="Top-selling products" subtitle="By net sales · click to drill down">
              <DataTable caption="Top products" rows={d.topProducts} onRow={(r) => set({ productId: r.id, category: '' })} cols={[
                ['t', 'Product', (r) => <span className="font-sans">{r.title}</span>],
                ['u', 'Units', (r) => r.units],
                ['n', 'Net sales', (r) => inr(r.netSalesPaise)],
                ['v', 'Views', (r) => r.views],
                ['c', 'View→order', (r) => pct(r.viewToOrderRate)],
              ]} />
            </ChartCard>
            <ChartCard title="Underperforming products" subtitle={`≥ ${d.underperformers.minViews} views but lowest view-to-order rate`}>
              <DataTable caption="Underperforming products" rows={d.underperformers.lowConversion} onRow={(r) => set({ productId: r.id, category: '' })} cols={[
                ['t', 'Product', (r) => r.title],
                ['v', 'Views', (r) => r.views],
                ['a', 'Add to cart', (r) => r.addToCarts],
                ['c', 'View→order', (r) => pct(r.viewToOrderRate)],
              ]} />
              {d.underperformers.noSales.length > 0 && <p className="mt-3 text-xs text-muted">No sales in this period: {d.underperformers.noSales.slice(0, 8).map((p: any) => p.title).join(', ')}{d.underperformers.noSales.length > 8 ? '…' : ''}</p>}
            </ChartCard>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
            <ChartCard title="Inventory alerts" subtitle={`${d.inventory.outOfStock} out of stock · ${d.inventory.lowStock} at or below ${d.inventory.threshold} units`}>
              <DataTable caption="Inventory alerts" rows={d.inventory.items.slice(0, 15)} cols={[
                ['s', 'Status', (r) => r.status === 'out_of_stock' ? <span className="text-danger">● Out of stock</span> : <span className="text-accent">▲ Low stock</span>],
                ['t', 'Item', (r) => `${r.title}${r.variant !== 'Standard' ? ` (${r.variant})` : ''}`],
                ['k', 'Stock', (r) => r.stock],
                ['d', 'Days of cover', (r) => r.daysOfCover ?? '—'],
              ]} />
            </ChartCard>
            <ChartCard title="Insights" subtitle="Rule-based, from the measured metrics above. Associations, not causes.">
              {d.insights.length === 0 ? <p className="text-sm text-muted">Not enough data in this period for confident insights.</p> : (
                <ul className="space-y-4">
                  {d.insights.map((i: any) => (
                    <li key={i.id} className="border-l-2 pl-3" style={{ borderColor: i.severity === 'warning' ? 'rgb(var(--danger))' : i.severity === 'opportunity' ? 'rgb(var(--accent))' : 'rgb(var(--line))' }}>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted">{i.severity} · {i.metric}</p>
                      <p className="mt-1 text-sm">{i.observation}</p>
                      <p className="mt-1 text-sm"><span className="font-medium">Suggested action:</span> {i.suggestion}</p>
                      {i.caveat && <p className="mt-1 text-xs text-muted">Caveat: {i.caveat}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}
