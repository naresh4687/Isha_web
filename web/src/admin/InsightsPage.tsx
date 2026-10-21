import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { ErrorState, Spinner } from '../components/ui';
import { ChartCard, ForecastChart, HBar } from './charts';
import { inr, inrCompact, pct } from '../lib/format';

function useMl<T = any>(path: string) {
  return useQuery({ queryKey: ['ml', path], queryFn: () => api<T>(`/api/admin/ml/${path}`), retry: false, staleTime: 60_000 });
}

function Block({ q, children }: { q: { isLoading: boolean; isError: boolean; error: unknown; refetch: () => void }; children: () => React.ReactNode }) {
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} retry={q.refetch} />;
  return <>{children()}</>;
}

const n4 = (x: number | null | undefined) => (x == null ? '—' : x.toFixed(3));

function ModelReport() {
  const q = useMl('model');
  return (
    <ChartCard title="Recommendation model — offline evaluation" subtitle="Temporal split; hyper-parameters chosen on a validation split inside the training period">
      <Block q={q}>{() => {
        const m = q.data;
        const ev = m.report?.evaluation;
        if (!ev || ev.status !== 'ok') return <p className="text-sm text-muted">{ev?.message ?? 'No evaluation report available.'}</p>;
        const ds = ev.dataset;
        const models = Object.keys(ev.results);
        return (
          <div className="space-y-5">
            <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <div><dt className="text-xs text-muted">Model version</dt><dd className="font-mono text-xs">{m.version}</dd></div>
              <div><dt className="text-xs text-muted">Interactions / users</dt><dd>{ds.interactions.toLocaleString('en-IN')} / {ds.users.toLocaleString('en-IN')}</dd></div>
              <div><dt className="text-xs text-muted">Test users (sample size)</dt><dd>{ds.test_users} warm · {ds.cold_start_test_users} cold</dd></div>
              <div><dt className="text-xs text-muted">Date range · cutoff</dt><dd className="text-xs">{ds.date_range[0].slice(0, 10)} → {ds.date_range[1].slice(0, 10)} · cut {ds.cutoff.slice(0, 10)}</dd></div>
            </dl>
            {ds.demo_data_share > 0 && (
              <p role="note" className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm">
                <strong>{pct(ds.demo_data_share, 0)} of the evaluation data is synthetic demo data.</strong> These numbers measure how well the models recover the generator's built-in preference structure; they are not evidence of real-world performance.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Offline metrics at K=10</caption>
                <thead><tr className="border-b border-line text-left text-xs text-muted">{['Model', 'Precision@10', 'Recall@10', 'NDCG@10', 'Hit rate', 'Coverage', 'Diversity (ILD)'].map((h) => <th key={h} className="py-2 pr-4 font-medium" scope="col">{h}</th>)}</tr></thead>
                <tbody>
                  {models.map((name) => {
                    const r = ev.results[name]['@10'];
                    return (
                      <tr key={name} className="border-b border-line/60 tabular-nums">
                        <th scope="row" className="py-2 pr-4 text-left font-medium">{name.replace(/_/g, ' ')}</th>
                        <td className="pr-4">{n4(r.precision)}</td><td className="pr-4">{n4(r.recall)}</td><td className="pr-4">{n4(r.ndcg)}</td>
                        <td className="pr-4">{pct(r.hit_rate)}</td><td className="pr-4">{pct(r.catalog_coverage, 0)}</td><td className="pr-4">{n4(r.intra_list_diversity)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div>
              <h3 className="text-sm font-semibold">Is the difference real? (paired bootstrap, 95% CI on ΔNDCG@10)</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {Object.entries(ev.comparisons).map(([k, c]: [string, any]) => (
                  <li key={k}><span className="font-medium">{k.replace(/_vs_cf_only$/, '').replace(/_/g, ' ')}</span> vs {c.vs.replace(/_/g, ' ')}: {c.mean_difference >= 0 ? '+' : ''}{c.mean_difference.toFixed(4)} [{c.ci95[0].toFixed(4)}, {c.ci95[1].toFixed(4)}] → <strong>{c.conclusion}</strong></li>
                ))}
              </ul>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold">Interaction weights (validated)</h3>
                <table className="mt-2 w-full text-xs">
                  <thead><tr className="text-left text-muted"><th className="py-1">Scheme</th><th>view / wish / cart / buy</th><th>Val NDCG (hybrid)</th></tr></thead>
                  <tbody>{ev.interaction_weight_validation.candidates.map((c: any) => (
                    <tr key={c.scheme} className={c.scheme === ev.interaction_weight_validation.chosen ? 'font-semibold' : ''}>
                      <td className="py-1">{c.scheme}{c.scheme === ev.interaction_weight_validation.chosen ? ' ✓' : ''}</td>
                      <td>{[c.weights.product_view, c.weights.add_to_wishlist, c.weights.add_to_cart, c.weights.purchase].join(' / ')}</td>
                      <td className="tabular-nums">{n4(c['val_ndcg@10_hybrid'])}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <div>
                <h3 className="text-sm font-semibold">Hybrid weights in production</h3>
                <p className="mt-2 text-xs text-muted">Grid of {ev.hybrid_weight_search.grid_size} combinations on validation: best {n4(ev.hybrid_weight_search['val_ndcg@10_best'])} vs default {n4(ev.hybrid_weight_search['val_ndcg@10_default'])}.</p>
                <ul className="mt-2 grid grid-cols-2 gap-1 text-xs">{Object.entries(m.weights).map(([k, v]: [string, any]) => <li key={k}>{k}: <span className="tabular-nums">{v.toFixed(3)}</span></li>)}</ul>
              </div>
            </div>
            <details className="text-sm"><summary className="cursor-pointer font-medium">Limitations</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-muted">{ev.limitations.map((l: string) => <li key={l}>{l}</li>)}</ul></details>
          </div>
        );
      }}</Block>
    </ChartCard>
  );
}

function OnlineMetrics() {
  const q = useQuery({ queryKey: ['online-metrics'], queryFn: () => api<any>('/api/admin/ml/online-metrics?days=30') });
  return (
    <ChartCard title="Live recommendation performance (30 days)" subtitle="From tracked impressions and clicks of consenting visitors">
      <Block q={q}>{() => q.data.items.length === 0 ? (
        <p className="text-sm text-muted">No recommendation impressions recorded yet. CTR and conversion appear here once visitors who accepted analytics see recommendation rails.</p>
      ) : (
        <>
          <table className="w-full text-sm"><caption className="sr-only">Online metrics by placement</caption>
            <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-2">Placement</th><th>Impressions</th><th>Clicks</th><th>CTR</th><th>Purchase conv.</th></tr></thead>
            <tbody>{q.data.items.map((r: any) => <tr key={r.placement} className="border-b border-line/60 tabular-nums"><td className="py-2">{r.placement.replace(/_/g, ' ')}</td><td>{r.impressions}</td><td>{r.clicks}</td><td>{pct(r.ctr, 2)}</td><td>{pct(r.purchaseConversion)}</td></tr>)}</tbody>
          </table>
          <p className="mt-2 text-xs text-muted">{q.data.definition}</p>
        </>
      )}</Block>
    </ChartCard>
  );
}

export default function InsightsPage() {
  const rfm = useMl('bi/rfm');
  const km = useMl('bi/segments');
  const fc = useMl('bi/forecast');
  const dm = useMl('bi/demand');
  const af = useMl('bi/affinity');
  const tick = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl">Recommendations & business intelligence</h1>
        <p className="text-sm text-muted">Served by the Python ML service. Every figure is computed from stored data; demo data is labelled.</p>
      </div>
      <ModelReport />
      <OnlineMetrics />
      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="RFM customer segments" subtitle="Rule-based recency / frequency / monetary scoring">
          <Block q={rfm}>{() => rfm.data.status !== 'ok' ? <p className="text-sm text-muted">{rfm.data.message}</p> : (
            <>
              <HBar data={rfm.data.segments} dataKey="customers" labelKey="segment" name="Customers" format={(v) => String(v)} />
              <table className="mt-4 w-full text-xs"><caption className="sr-only">RFM segments</caption>
                <thead><tr className="text-left text-muted"><th className="py-1">Segment</th><th>Customers</th><th>Share of value</th><th>Avg value</th><th>Suggested action</th></tr></thead>
                <tbody>{rfm.data.segments.map((s: any) => <tr key={s.segment} className="border-t border-line/60 align-top"><td className="py-1.5 font-medium">{s.segment}</td><td>{s.customers}</td><td>{pct(s.share_of_value)}</td><td>{inr(Math.round(s.avg_monetary_paise))}</td><td>{s.suggested_action}</td></tr>)}</tbody>
              </table>
              <p className="mt-2 text-xs text-muted">{rfm.data.definition}</p>
            </>
          )}</Block>
        </ChartCard>
        <ChartCard title="K-means segmentation" subtitle="Reported only if silhouette ≥ 0.25 and stable across seeds (ARI ≥ 0.8)">
          <Block q={km}>{() => (
            <div className="space-y-3 text-sm">
              <p><strong>{km.data.valid ? 'Validated' : 'Not validated'}</strong> — {km.data.message}</p>
              {km.data.silhouette_by_k && <p className="text-xs text-muted">Silhouette by k: {Object.entries(km.data.silhouette_by_k).map(([k, v]) => `${k}: ${v}`).join(' · ')} · stability ARI {km.data.stability_mean_ari}</p>}
              {km.data.clusters?.length > 0 && (
                <table className="w-full text-xs"><caption className="sr-only">Cluster profiles</caption>
                  <thead><tr className="text-left text-muted"><th className="py-1">Cluster</th><th>Customers</th><th>Median recency</th><th>Median orders</th><th>Median value</th></tr></thead>
                  <tbody>{km.data.clusters.map((c: any) => <tr key={c.cluster} className="border-t border-line/60"><td className="py-1.5">#{c.cluster}</td><td>{c.customers}</td><td>{Math.round(c.median_recency_days)} days</td><td>{c.median_frequency}</td><td>{inr(Math.round(c.median_monetary_paise))}</td></tr>)}</tbody>
                </table>
              )}
            </div>
          )}</Block>
        </ChartCard>
      </div>
      <ChartCard title="Sales forecast (next 14 days)" subtitle="Model chosen by rolling-origin backtest (WAPE); band is an empirical 80% interval">
        <Block q={fc}>{() => fc.data.status !== 'ok' ? <p className="text-sm text-muted">{fc.data.message}</p> : (
          <>
            <ForecastChart history={fc.data.history} forecast={fc.data.forecast} format={inrCompact} tick={tick} />
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <table className="text-xs"><caption className="mb-1 text-left font-semibold">Backtest (4 × 7-day folds)</caption>
                <thead><tr className="text-left text-muted"><th className="py-1 pr-4">Model</th><th className="pr-4">WAPE</th><th>MAE</th></tr></thead>
                <tbody>{Object.entries(fc.data.backtest.models).map(([k, v]: [string, any]) => <tr key={k} className={k === fc.data.backtest.chosen ? 'font-semibold' : ''}><td className="py-1 pr-4">{k.replace(/_/g, ' ')}{k === fc.data.backtest.chosen ? ' ✓' : ''}</td><td className="pr-4">{pct(v.wape)}</td><td>{inr(Math.round(v.mae_paise))}</td></tr>)}</tbody>
              </table>
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted">{fc.data.limitations.map((l: string) => <li key={l}>{l}</li>)}</ul>
            </div>
            <details className="mt-3 text-xs"><summary className="cursor-pointer">Forecast table</summary>
              <table className="mt-2 w-full"><thead><tr className="text-left text-muted"><th>Date</th><th>Forecast</th><th>80% interval</th></tr></thead>
                <tbody>{fc.data.forecast.map((f: any) => <tr key={f.date}><td>{f.date}</td><td>{inr(f.net_sales_paise)}</td><td>{inr(f.lower_80_paise)} – {inr(f.upper_80_paise)}</td></tr>)}</tbody></table>
            </details>
          </>
        )}</Block>
      </ChartCard>
      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="Demand estimates & reorder suggestions" subtitle="28-day sales rate, 14-day lead time, ~90% service level">
          <Block q={dm}>{() => (
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-xs"><caption className="sr-only">Demand by variant</caption>
                <thead className="sticky top-0 bg-surface"><tr className="text-left text-muted"><th className="py-1">Item</th><th>Stock</th><th>Units/day</th><th>Cover</th><th>Reorder pt.</th><th>Suggest</th></tr></thead>
                <tbody>{dm.data.items.slice(0, 40).map((i: any) => (
                  <tr key={i.variant_id} className="border-t border-line/60 tabular-nums">
                    <td className="py-1.5 font-sans">{i.needs_reorder && <span className="text-danger" aria-label="needs reorder">● </span>}{i.title}{i.variant !== 'Standard' ? ` (${i.variant})` : ''}</td>
                    <td>{i.stock}</td><td>{i.mean_daily_units}</td><td>{i.days_of_cover ?? '—'}{i.days_of_cover != null ? 'd' : ''}</td><td>{i.reorder_point}</td><td>{i.suggested_order_qty || '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
              <p className="mt-2 text-xs text-muted">{dm.data.limitations[0]}</p>
            </div>
          )}</Block>
        </ChartCard>
        <ChartCard title="Product affinity" subtitle="Pairs bought together in ≥ 3 orders, ranked by lift">
          <Block q={af}>{() => af.data.status !== 'ok' ? <p className="text-sm text-muted">{af.data.message}</p> : (
            <>
              <table className="w-full text-xs"><caption className="sr-only">Association rules</caption>
                <thead><tr className="text-left text-muted"><th className="py-1">If bought</th><th>Also bought</th><th>Orders</th><th>Confidence</th><th>Lift</th></tr></thead>
                <tbody>{af.data.rules.slice(0, 15).map((r: any, i: number) => <tr key={i} className="border-t border-line/60 tabular-nums"><td className="py-1.5 font-sans">{r.antecedent}</td><td className="font-sans">{r.consequent}</td><td>{r.orders_together}</td><td>{pct(r.confidence)}</td><td>{r.lift.toFixed(2)}</td></tr>)}</tbody>
              </table>
              <p className="mt-2 text-xs text-muted">{af.data.definition} {af.data.caveat}</p>
            </>
          )}</Block>
        </ChartCard>
      </div>
    </div>
  );
}
