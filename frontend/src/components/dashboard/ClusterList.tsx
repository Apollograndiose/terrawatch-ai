"use client";

import clsx from "clsx";
import type { ClustersResponse } from "@/lib/types";
import { fmtCompact, fmtInt, fmtUtc } from "@/lib/format";
import { EmptyNote, ErrorNote, Segmented } from "@/components/ui";

export type ClusterSort = "frp" | "detections" | "recent";

export function ClusterList({
  data,
  error,
  loading,
  selected,
  sort,
  onSort,
  onSelect,
  onRetry,
}: {
  data: ClustersResponse | null;
  error: string | null;
  loading: boolean;
  selected: string | null;
  sort: ClusterSort;
  onSort: (s: ClusterSort) => void;
  onSelect: (id: string) => void;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Segmented
          label="Sort clusters"
          value={sort}
          onChange={onSort}
          options={[
            { value: "frp", label: "FRP" },
            { value: "detections", label: "Count" },
            { value: "recent", label: "Recent" },
          ]}
        />
        {data ? <span className="mono text-[10.5px] text-faint">{fmtInt(data.total_clusters)} clusters ≥5 det.</span> : null}
      </div>
      {error ? <ErrorNote message={error} onRetry={onRetry} /> : null}
      {loading && !data ? <div className="skeleton h-40" aria-busy /> : null}
      {data && data.clusters.length === 0 ? <EmptyNote>No clusters of 5+ detections in this view.</EmptyNote> : null}
      <ol className="space-y-1" aria-label="Observation clusters">
        {data?.clusters.map((c, i) => (
          <li key={c.cluster_id}>
            <button
              type="button"
              onClick={() => onSelect(c.cluster_id)}
              aria-pressed={selected === c.cluster_id}
              className={clsx(
                "grid w-full grid-cols-[1.4rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors",
                selected === c.cluster_id ? "border-accent/50 bg-accent/10" : "border-transparent hover:border-line hover:bg-surface-2",
              )}
            >
              <span className="mono text-[10.5px] text-faint">{String(i + 1).padStart(2, "0")}</span>
              <span className="min-w-0">
                <span className="block truncate text-[12px]">{c.country}</span>
                <span className="mono block truncate text-[10.5px] text-faint">
                  {fmtUtc(c.first_utc, false).slice(5)} → {fmtUtc(c.last_utc, false).slice(5)} · {c.active_days} d
                </span>
              </span>
              <span className="text-right">
                <span className="mono block text-[12px] text-fire-2">{fmtCompact(c.frp_sum_mw)} MW</span>
                <span className="mono block text-[10.5px] text-faint">{fmtInt(c.detections)} det.</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      {data ? <p className="text-[10.5px] leading-snug text-faint">{data.method.description}</p> : null}
    </div>
  );
}
