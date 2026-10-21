import type { ReactNode } from 'react';
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

/** Shared chart styling: hairline recessive grid, 2px lines, text in ink tokens (never series colours). */
export const S1 = 'var(--series-1)';
export const S2 = 'var(--series-2)';
const axis = { stroke: 'rgb(var(--line))', tick: { fill: 'rgb(var(--muted))', fontSize: 11 }, tickLine: false };

export function ChartCard({ title, subtitle, children, actions }: { title: string; subtitle?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-sans text-base font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function TooltipBox({ active, payload, label, format, labelFormat }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium">{labelFormat ? labelFormat(label) : label}</p>
      {payload.filter((p: any) => p.value != null && !p.dataKey?.toString().startsWith('_')).map((p: any) => (
        <p key={p.dataKey} className="flex items-center gap-2 text-ink">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.stroke ?? p.fill }} aria-hidden />
          <span className="text-muted">{p.name}</span>
          <span className="ml-auto tabular-nums">{format(p.value, p.dataKey)}</span>
        </p>
      ))}
    </div>
  );
}

export function TrendLine({ data, dataKey, name, format, tick, height = 260 }: { data: any[]; dataKey: string; name: string; format: (v: number) => string; tick: (v: string) => string; height?: number }) {
  return (
    <div style={{ height }} role="img" aria-label={`${name} over time line chart; values are listed in the exported trend report`}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="bucket" {...axis} tickFormatter={tick} minTickGap={24} />
          <YAxis {...axis} axisLine={false} tickFormatter={format} width={64} />
          <Tooltip cursor={{ stroke: 'rgb(var(--muted))', strokeWidth: 1 }} content={<TooltipBox format={format} labelFormat={tick} />} />
          <Line type="monotone" dataKey={dataKey} name={name} stroke={S1} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'rgb(var(--surface))' }} isAnimationActive={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function HBar({ data, dataKey, labelKey, name, format, onSelect, height }: { data: any[]; dataKey: string; labelKey: string; name: string; format: (v: number) => string; onSelect?: (row: any) => void; height?: number }) {
  return (
    <div style={{ height: height ?? Math.max(160, data.length * 34) }} role="img" aria-label={`${name} by ${labelKey} bar chart`}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barCategoryGap={6}>
          <CartesianGrid horizontal={false} stroke="var(--grid)" />
          <XAxis type="number" {...axis} tickFormatter={format} />
          <YAxis type="category" dataKey={labelKey} {...axis} axisLine={false} width={150} />
          <Tooltip cursor={{ fill: 'rgb(var(--sunken))' }} content={<TooltipBox format={format} />} />
          <Bar dataKey={dataKey} name={name} fill={S1} radius={[0, 4, 4, 0]} maxBarSize={22} onClick={onSelect ? (d: any) => onSelect(d.payload ?? d) : undefined} style={{ cursor: onSelect ? 'pointer' : undefined }} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Actuals vs forecast with an 80% interval band. One axis, two series, legend + direct labels. */
export function ForecastChart({ history, forecast, format, tick }: { history: { date: string; net_sales_paise: number }[]; forecast: { date: string; net_sales_paise: number; lower_80_paise: number; upper_80_paise: number }[]; format: (v: number) => string; tick: (v: string) => string }) {
  const data = [
    ...history.map((h) => ({ date: h.date, actual: h.net_sales_paise })),
    ...forecast.map((f) => ({ date: f.date, forecast: f.net_sales_paise, _band: [f.lower_80_paise, f.upper_80_paise] })),
  ];
  return (
    <div>
      <div className="mb-2 flex gap-4 text-xs text-muted" aria-hidden>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4" style={{ background: S1 }} />Actual net sales</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4" style={{ background: S2 }} />Forecast</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-4 rounded-sm opacity-25" style={{ background: S2 }} />80% interval</span>
      </div>
      <div style={{ height: 280 }} role="img" aria-label="Daily net sales, actual and forecast with 80% interval; values are in the table below">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="date" {...axis} tickFormatter={tick} minTickGap={28} />
            <YAxis {...axis} axisLine={false} tickFormatter={format} width={64} />
            <Tooltip cursor={{ stroke: 'rgb(var(--muted))', strokeWidth: 1 }} content={<TooltipBox format={format} labelFormat={tick} />} />
            <Area dataKey="_band" stroke="none" fill={S2} fillOpacity={0.18} isAnimationActive={false} />
            <Line dataKey="actual" name="Actual" stroke={S1} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line dataKey="forecast" name="Forecast" stroke={S2} strokeWidth={2} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
