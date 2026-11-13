"use client";

import { useMemo, useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { qs } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { DatasetName, HistoryResponse, SummaryResponse, TimeseriesResponse } from "@/lib/types";
import { SOURCE_LABELS, fmtCompact, fmtInt, fmtNum, fmtUtc, sourceLabel } from "@/lib/format";
import { ActivityChart } from "@/components/charts/ActivityChart";
import { BarList } from "@/components/charts/BarList";
import { EmptyNote, ErrorNote, ProvenanceTag, Section, Segmented, Spinner, Stat } from "@/components/ui";

const tick = { fill: "#62718b", fontSize: 10, fontFamily: "var(--font-plex-mono)" };
const tooltipStyle = { background: "#131d31", border: "1px solid #2b3b5a", borderRadius: 8, fontSize: 11 };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function AnalyticsView() {
  const [dataset, setDataset] = useState<DatasetName>("demo");
  const [bucket, setBucket] = useState<"hour" | "6h" | "day">("6h");
  const [metric, setMetric] = useState<"count" | "frp">("count");
  const base = { dataset, confidence: ["nominal", "high"] };
  const summary = useApi<SummaryResponse>(`/api/analytics/summary${qs(base)}`);
  const ts = useApi<TimeseriesResponse>(`/api/analytics/timeseries${qs({ ...base, bucket })}`);
  const countries = useApi<{ countries: string[] }>("/api/analytics/history/countries");
  const [country, setCountry] = useState("Australia");
  const [vegOnly, setVegOnly] = useState(true);
  const hist = useApi<HistoryResponse>(`/api/analytics/history${qs({ country, vegetation_only: vegOnly })}`);

  const s = summary.data;
  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-4 p-3 sm:p-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="eyebrow">Wildfire analytics</div>
            <h1 className="text-xl font-medium">Spatial and temporal distribution of FIRMS detections</h1>
            <p className="mt-1 max-w-3xl text-[12.5px] text-muted">
              Every chart is a direct aggregate of NASA FIRMS records (nominal + high confidence). Counts are thermal-anomaly
              pixels, not fires; compare sensors with care because VIIRS resolves smaller fires than MODIS.
            </p>
          </div>
          <Segmented
            label="Dataset"
            value={dataset}
            onChange={setDataset}
            options={[
              { value: "demo", label: "Demo snapshot" },
              { value: "live", label: "Live NRT" },
            ]}
          />
        </header>

        {summary.error ? <ErrorNote message={summary.error} onRetry={summary.reload} /> : null}
        {s ? (
          <div className="panel-flat grid grid-cols-2 gap-4 p-4 md:grid-cols-5">
            <Stat label="Detections" value={fmtCompact(s.count)} sub={fmtInt(s.count)} accent="#fb923c" />
            <Stat label="Window (UTC)" value={`${fmtUtc(s.first_utc, false).slice(5)} → ${fmtUtc(s.last_utc, false).slice(5)}`} sub={s.dataset_served === "demo" ? "demo snapshot" : "live NRT"} />
            <Stat label="Summed FRP" value={`${fmtCompact(s.frp_sum_mw)} MW`} sub="sum over pixels & overpasses" />
            <Stat label="Median pixel FRP" value={`${fmtNum(s.frp_p50_mw, 1)} MW`} sub={`p90 ${fmtNum(s.frp_p90_mw, 1)} MW`} />
            <Stat label="Max pixel FRP" value={`${fmtNum(s.frp_max_mw, 0)} MW`} />
          </div>
        ) : summary.loading ? (
          <div className="skeleton h-20" />
        ) : null}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Section
            title="Observations over time · by satellite"
            className="lg:col-span-2"
            right={
              <Segmented
                label="Time bucket"
                value={bucket}
                onChange={setBucket}
                options={[
                  { value: "hour", label: "1 h" },
                  { value: "6h", label: "6 h" },
                  { value: "day", label: "1 day" },
                ]}
              />
            }
          >
            {ts.error ? <ErrorNote message={ts.error} onRetry={ts.reload} /> : null}
            {ts.data ? <ActivityChart series={ts.data.series} sources={ts.data.sources} bucket={ts.data.bucket} height={240} /> : <div className="skeleton h-60" />}
            <p className="mt-2 text-[11px] text-faint">
              The diurnal saw-tooth is an observation artefact: polar-orbiting satellites sample each location only at fixed local
              overpass times (VIIRS ~01:30/13:30, MODIS ~10:30/13:30/22:30/01:30).
            </p>
          </Section>
          <Section title="Distribution by source satellite">
            {s ? (
              <>
                <BarList
                  label="Detections by source"
                  rows={s.by_source.map((r) => ({ key: r.key, value: r.count, display: SOURCE_LABELS[r.key]?.long ?? r.key }))}
                  colorFor={(k) => SOURCE_LABELS[k]?.color ?? "#94a3b8"}
                />
                <div className="eyebrow mb-1.5 mt-4">Day vs night overpass</div>
                <BarList
                  label="Detections by overpass"
                  rows={s.by_daynight.map((r) => ({ key: r.key, value: r.count, display: r.key === "D" ? "Day" : "Night" }))}
                  colorFor={(k) => (k === "D" ? "#fbbf24" : "#818cf8")}
                />
              </>
            ) : (
              <div className="skeleton h-40" />
            )}
          </Section>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Section
            title="Geographic concentration · continent"
            right={
              <Segmented
                label="Metric"
                value={metric}
                onChange={setMetric}
                options={[
                  { value: "count", label: "Detections" },
                  { value: "frp", label: "FRP" },
                ]}
              />
            }
          >
            {s ? (
              <BarList
                label="By continent"
                rows={s.by_continent.map((r) => ({ key: r.key, value: metric === "count" ? r.count : r.frp_sum }))
                  .sort((a, b) => b.value - a.value)}
                color="#f97316"
              />
            ) : (
              <div className="skeleton h-40" />
            )}
          </Section>
          <Section title="Regional comparison · top 15 countries">
            {s ? (
              <BarList
                label="By country"
                rows={s.by_country.map((r) => ({ key: r.key, value: metric === "count" ? r.count : r.frp_sum }))
                  .sort((a, b) => b.value - a.value)}
                color="#ef4444"
              />
            ) : (
              <div className="skeleton h-40" />
            )}
          </Section>
        </div>

        <Section
          title="Historical baseline · MODIS C6.1 science-quality archive"
          right={<ProvenanceTag kind="observed" />}
        >
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <label className="text-[12px] text-muted">
              Country{" "}
              <select
                aria-label="Historical baseline country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="ml-1 rounded-md border border-line bg-surface-1 px-2 py-1 text-[12px] text-text"
              >
                {(countries.data?.countries ?? [country]).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-[12px] text-muted">
              <input type="checkbox" checked={vegOnly} onChange={(e) => setVegOnly(e.target.checked)} />
              Vegetation fires only (FIRMS type 0; excludes volcanoes, static industrial sources, offshore)
            </label>
          </div>
          {hist.error ? <ErrorNote message={hist.error} onRetry={hist.reload} /> : null}
          {hist.loading && !hist.data ? <Spinner label="Loading archive aggregates" /> : null}
          {hist.data ? <HistoryCharts h={hist.data} /> : null}
        </Section>
      </div>
    </div>
  );
}

function HistoryCharts({ h }: { h: HistoryResponse }) {
  const [year, setYear] = useState(h.years[h.years.length - 1]);
  const seasonal = useMemo(
    () =>
      h.climatology.map((c) => {
        const cur = h.monthly.find((m) => m.year === year && m.month === c.month);
        return { month: MONTHS[c.month - 1], range: [c.min, c.max], mean: Math.round(c.mean), selected: cur?.count ?? null };
      }),
    [h, year],
  );
  if (!h.years.length) return <EmptyNote>No archive data.</EmptyNote>;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div>
        <div className="eyebrow mb-1">Annual detections {h.years[0]}–{h.years[h.years.length - 1]}</div>
        <div style={{ height: 230 }} role="img" aria-label={`Annual MODIS detections for ${h.country}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={h.annual} margin={{ top: 4, right: 4, bottom: 0, left: -6 }}>
              <CartesianGrid stroke="#1f2c45" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="year" tick={tick} axisLine={false} tickLine={false} />
              <YAxis tick={tick} tickFormatter={(v) => fmtCompact(v)} axisLine={false} tickLine={false} width={44} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v, n, item) =>
                  n === "count" ? [`${fmtInt(Number(v))} (z=${fmtNum((item.payload as { anomaly_z: number | null }).anomaly_z, 2)})`, "detections"] : [v, n]
                }
              />
              <Bar dataKey="count" fill="#f97316" isAnimationActive={false} onClick={(d) => setYear(Number((d as unknown as { year: number }).year))} cursor="pointer" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-1 text-[11px] text-faint">Click a bar to compare that year with the seasonal range.</p>
      </div>
      <div>
        <div className="eyebrow mb-1">
          Monthly detections — {year} vs {h.years[0]}–{h.years[h.years.length - 1]} range and mean
        </div>
        <div style={{ height: 230 }} role="img" aria-label={`Monthly detections in ${year} compared with the multi-year range`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={seasonal} margin={{ top: 4, right: 4, bottom: 0, left: -6 }}>
              <CartesianGrid stroke="#1f2c45" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="month" tick={tick} axisLine={false} tickLine={false} />
              <YAxis tick={tick} tickFormatter={(v) => fmtCompact(v)} axisLine={false} tickLine={false} width={44} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [Array.isArray(v) ? `${fmtInt(v[0])}–${fmtInt(v[1])}` : fmtInt(Number(v)), String(n)]} />
              <Legend wrapperStyle={{ fontSize: 11, color: "#93a2bb" }} />
              <Area dataKey="range" name="min–max" fill="#38bdf8" fillOpacity={0.12} stroke="none" isAnimationActive={false} />
              <Line dataKey="mean" name="mean" stroke="#38bdf8" strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              <Line dataKey="selected" name={String(year)} stroke="#f97316" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      <p className="text-[11px] leading-snug text-faint lg:col-span-2">
        {h.note} Source: FIRMS yearly country archive files ({h.years.length} years), aggregated monthly by the ingestion pipeline
        (<span className="mono">app.ingest.archive</span>). Confidence ≥ {h.filters.min_confidence}.
        {" "}
        {sourceLabel("MODIS_NRT")} archive values are not directly comparable with the VIIRS-dominated snapshot above.
      </p>
    </div>
  );
}
