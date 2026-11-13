"use client";

import { X } from "lucide-react";
import type { DetectionResponse } from "@/lib/types";
import { SOURCE_LABELS, fmtCoord, fmtInt, fmtNum, fmtUtc } from "@/lib/format";
import { ErrorNote, KeyValue, ProvenanceTag, Spinner } from "@/components/ui";

const TYPE_LABELS: Record<number, string> = {
  0: "presumed vegetation fire",
  1: "active volcano",
  2: "other static land source",
  3: "offshore",
};

export function DetectionPanel({
  data,
  loading,
  error,
  onClose,
}: {
  data: DetectionResponse | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const d = data?.detection;
  const viirs = d?.instrument === "VIIRS";
  return (
    <div className="space-y-3 fade-in">
      <div className="flex items-start justify-between">
        <div>
          <div className="eyebrow">Single detection</div>
          <h2 className="text-[15px] font-medium">{d ? `${SOURCE_LABELS[d.source]?.long ?? d.source}` : "Loading…"}</h2>
          {d ? <div className="mono text-[10.5px] text-faint">id {d.id}</div> : null}
        </div>
        <button type="button" onClick={onClose} aria-label="Close detection details" className="rounded p-1 text-faint hover:bg-surface-3 hover:text-text">
          <X size={16} />
        </button>
      </div>
      {error ? <ErrorNote message={error} /> : null}
      {loading && !data ? <Spinner label="Loading detection" /> : null}
      {d && data ? (
        <>
          <ProvenanceTag kind="observed" />
          <KeyValue
            rows={[
              ["Pixel centre", fmtCoord(d.latitude, d.longitude)],
              ["Acquired", fmtUtc(d.acq_datetime)],
              ["Satellite", d.satellite],
              ["Instrument", `${d.instrument} (${SOURCE_LABELS[d.source]?.res ?? "?"})`],
              ["Overpass", d.daynight === "D" ? "Day" : d.daynight === "N" ? "Night" : d.daynight],
              ["Confidence", `${d.confidence_class} (raw “${d.confidence_raw}”)`],
              ["FRP", `${fmtNum(d.frp, 2)} MW`],
              [viirs ? "Bright. I4" : "Bright. 21/22", `${fmtNum(d.bright_t4, 2)} K`],
              [viirs ? "Bright. I5" : "Bright. 31", `${fmtNum(d.bright_t5, 2)} K`],
              ["Scan × track", `${fmtNum(d.scan, 2)} × ${fmtNum(d.track, 2)} km`],
              ["Footprint ≈", `${fmtNum(d.pixel_area_km2, 2)} km²`],
              ["Product version", d.version],
              ["FIRMS type", d.type === null ? "n/a in NRT feed" : `${d.type} — ${TYPE_LABELS[d.type] ?? "?"}`],
              ["Country", `${d.country} (${d.iso3})`],
              ["Region", `${d.subregion}`],
            ]}
          />
          <div className="rounded-md border border-line bg-surface-2/60 p-2 text-[11px] text-muted">
            <span className="mono text-text">{fmtInt(data.context.detections)}</span> other detections within {data.context.radius_km} km and
            ±{data.context.window_hours} h, from {data.context.distinct_sources} source(s).
          </div>
          <p className="text-[11px] leading-snug text-faint">{data.interpretation}</p>
        </>
      ) : null}
    </div>
  );
}
