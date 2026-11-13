"use client";

import type { SummaryResponse, TimeseriesResponse } from "@/lib/types";
import { CONFIDENCE_COLORS, SOURCE_LABELS, fmtCompact, fmtInt, fmtNum, sourceLabel } from "@/lib/format";
import { ActivityChart } from "@/components/charts/ActivityChart";
import { BarList } from "@/components/charts/BarList";
import { EmptyNote, ErrorNote, ProvenanceTag, Stat } from "@/components/ui";

export function SummaryPanel({
  summary,
  series,
  error,
  loading,
  scopeLabel,
  onRetry,
}: {
  summary: SummaryResponse | null;
  series: TimeseriesResponse | null;
  error: string | null;
  loading: boolean;
  scopeLabel: string;
  onRetry: () => void;
}) {
  if (error) return <ErrorNote message={error} onRetry={onRetry} />;
  if (loading && !summary)
    return (
      <div className="space-y-2" aria-busy>
        <div className="skeleton h-14" />
        <div className="skeleton h-36" />
      </div>
    );
  if (!summary) return null;
  if (summary.count === 0) return <EmptyNote>No detections match the current filters in this view.</EmptyNote>;

  const day = summary.by_daynight.find((d) => d.key === "D")?.count ?? 0;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <ProvenanceTag kind="observed" />
        <span className="truncate text-[10.5px] text-faint">{scopeLabel}</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Detections" value={fmtCompact(summary.count)} sub={fmtInt(summary.count)} accent="#fb923c" />
        <Stat label="Total FRP" value={`${fmtCompact(summary.frp_sum_mw)}`} sub="MW (sum of pixels)" />
        <Stat label="Median FRP" value={fmtNum(summary.frp_p50_mw, 1)} sub={`p90 ${fmtNum(summary.frp_p90_mw, 0)} MW`} />
      </div>
      {series && series.series.length > 0 ? (
        <div>
          <div className="eyebrow mb-1">Detections per 6 h · by satellite</div>
          <ActivityChart series={series.series} sources={series.sources} bucket={series.bucket} height={130} />
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-3">
        <div>
          <div className="eyebrow mb-1.5">By source</div>
          <BarList
            label="Detections by satellite source"
            rows={summary.by_source.map((s) => ({ key: s.key, value: s.count, display: sourceLabel(s.key) }))}
            colorFor={(k) => SOURCE_LABELS[k]?.color ?? "#94a3b8"}
          />
        </div>
        <div>
          <div className="eyebrow mb-1.5">By confidence</div>
          <BarList
            label="Detections by confidence class"
            rows={summary.by_confidence.map((s) => ({ key: s.key, value: s.count }))}
            colorFor={(k) => CONFIDENCE_COLORS[k] ?? "#64748b"}
          />
        </div>
        <div>
          <div className="eyebrow mb-1.5">Top countries in view</div>
          <BarList
            label="Detections by country"
            rows={summary.by_country.slice(0, 6).map((s) => ({ key: s.key, value: s.count }))}
            color="#f97316"
          />
        </div>
      </div>
      <p className="text-[10.5px] leading-snug text-faint">
        Day overpasses {fmtInt(day)} · night {fmtInt(summary.count - day)}. Counts are satellite pixels flagged as thermal
        anomalies, not individual fires. VIIRS (375 m) records many more detections per fire than MODIS (1 km).
      </p>
    </div>
  );
}
