"use client";

import { useState } from "react";
import clsx from "clsx";
import { RefreshCw } from "lucide-react";
import type { DatasetName, StatusResponse } from "@/lib/types";
import { fmtInt, fmtUtc, relativeAge, sourceLabel } from "@/lib/format";

export function StatusStrip({
  status,
  dataset,
  servedFallback,
  onRefreshed,
}: {
  status: StatusResponse | null;
  dataset: DatasetName;
  servedFallback: boolean;
  onRefreshed: () => void;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const info = status?.datasets[dataset] ?? (dataset === "live" ? status?.datasets.demo : undefined);
  const latest = info?.latest_observation_utc ?? null;
  const live = status?.live;
  const isLive = dataset === "live" && !servedFallback;
  const refreshing = live?.state === "refreshing";

  async function refresh() {
    setMsg(null);
    try {
      const r = await fetch("/api/live/refresh", { method: "POST" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) setMsg(body.detail ?? `Refresh failed (HTTP ${r.status})`);
      // Progress text comes from the polled live state, so it disappears when the download finishes.
      onRefreshed();
    } catch {
      setMsg("Cannot reach the API.");
    }
  }

  return (
    <div className="panel flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2 text-[11.5px]" aria-live="polite">
      <div className="flex items-center gap-2">
        <span
          className={clsx(
            "h-2 w-2 rounded-full",
            isLive ? "pulse-dot bg-ok" : dataset === "live" ? "bg-warn" : "bg-accent",
          )}
          aria-hidden
        />
        <span className="font-medium">
          {isLive ? "Live NRT feed" : dataset === "live" ? "Live unavailable — demo snapshot shown" : "Demo snapshot"}
        </span>
      </div>
      <div className="text-muted">
        Latest observation <span className="mono text-text">{fmtUtc(latest)}</span>{" "}
        <span className="text-faint">({relativeAge(latest)})</span>
      </div>
      <div className="hidden text-muted sm:block">
        <span className="mono text-text">{fmtInt(info?.rows)}</span> detections loaded
      </div>
      <div className="hidden flex-wrap items-center gap-1.5 sm:flex">
        {info?.feeds.map((f) => (
          <span
            key={f.source}
            title={f.message ?? `${f.rows} rows · retrieved ${fmtUtc(f.retrieved_utc)} · ${f.url ?? ""}`}
            className={clsx(
              "mono rounded border px-1.5 py-px text-[10px]",
              f.state === "ok" && "border-ok/30 text-ok",
              f.state === "empty" && "border-warn/40 text-warn",
              f.state === "error" && "border-err/40 text-err",
            )}
          >
            {sourceLabel(f.source)} {f.state === "ok" ? "✓" : f.state === "empty" ? "empty" : "error"}
          </span>
        ))}
      </div>
      {dataset === "live" ? (
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-muted hover:text-text disabled:opacity-50"
        >
          <RefreshCw size={12} className={refreshing ? "animate-spin" : undefined} aria-hidden />
          {refreshing ? "Refreshing…" : "Refresh feeds"}
        </button>
      ) : null}
      {dataset === "live" && refreshing ? (
        <div className="w-full text-[11px] text-muted">Downloading FIRMS feeds…</div>
      ) : msg || live?.error ? (
        <div className="w-full text-[11px] text-warn">{msg ?? live?.error}</div>
      ) : null}
    </div>
  );
}
