"use client";

import Link from "next/link";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ImageIcon, X } from "lucide-react";
import type { ClusterDetail } from "@/lib/types";
import { SOURCE_LABELS, fmtCoord, fmtInt, fmtNum, fmtUtc, sourceLabel } from "@/lib/format";
import { bboxAreaKm2 } from "@/lib/geo";
import { ErrorNote, KeyValue, ProvenanceTag, Spinner } from "@/components/ui";

const tick = { fill: "#62718b", fontSize: 10, fontFamily: "var(--font-plex-mono)" };

export function ClusterExplorer({
  detail,
  loading,
  error,
  onClose,
  onRetry,
}: {
  detail: ClusterDetail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
}) {
  const c = detail?.cluster;
  const compareHref = c
    ? `/compare?bbox=${c.bbox.map((v) => v.toFixed(4)).join(",")}&date=${c.first_utc.slice(0, 10)}&label=${encodeURIComponent(
        `${c.country} cluster ${c.cluster_id}`,
      )}`
    : "#";
  return (
    <div className="space-y-3 fade-in">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="eyebrow">Observation cluster</div>
          <h2 className="truncate text-[15px] font-medium">{c ? `${c.country}` : "Loading…"}</h2>
          {c ? <div className="mono text-[10.5px] text-faint">{c.cluster_id}</div> : null}
        </div>
        <button type="button" onClick={onClose} aria-label="Close cluster explorer" className="rounded p-1 text-faint hover:bg-surface-3 hover:text-text">
          <X size={16} />
        </button>
      </div>
      {error ? <ErrorNote message={error} onRetry={onRetry} /> : null}
      {loading && !detail ? <Spinner label="Loading cluster" /> : null}
      {c && detail ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            <ProvenanceTag kind="observed" />
            <ProvenanceTag kind="derived" />
          </div>
          <KeyValue
            rows={[
              ["Centroid", fmtCoord(c.lat, c.lon)],
              ["First detection", fmtUtc(c.first_utc)],
              ["Last detection", fmtUtc(c.last_utc)],
              ["Days with detections", String(c.active_days)],
              ["Detections", fmtInt(c.detections)],
              ["High confidence", `${fmtInt(c.high_confidence)} (${fmtNum((100 * c.high_confidence) / c.detections, 0)}%)`],
              ["Sum FRP", `${fmtInt(c.frp_sum_mw)} MW`],
              ["Max pixel FRP", `${fmtNum(c.frp_max_mw, 1)} MW`],
              ["Detection bbox", `${fmtNum(bboxAreaKm2(c.bbox), 0)} km²`],
              ["Instruments", c.sources.map(sourceLabel).join(", ")],
            ]}
          />
          <p className="rounded-md border border-line bg-surface-2/60 p-2 text-[11px] leading-snug text-muted">
            The dashed box is the bounding box of the grouped detections, not a fire perimeter or burned-area estimate. Summed FRP
            double-counts fire seen by several overpasses and is shown only for relative ranking.
          </p>

          <div>
            <div className="eyebrow mb-1">Detections per 6 h</div>
            <div style={{ height: 120 }} role="img" aria-label="Cluster detections over time by satellite">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={detail.timeline_6h} margin={{ top: 2, right: 2, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke="#1f2c45" strokeDasharray="2 4" vertical={false} />
                  <XAxis
                    dataKey="t"
                    tick={tick}
                    tickFormatter={(v) => fmtUtc(String(v)).slice(5, 13)}
                    minTickGap={24}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis tick={tick} axisLine={false} tickLine={false} width={40} />
                  <Tooltip
                    contentStyle={{ background: "#131d31", border: "1px solid #2b3b5a", borderRadius: 8, fontSize: 11 }}
                    labelFormatter={(v) => fmtUtc(String(v))}
                    formatter={(v, n) => [fmtInt(Number(v)), sourceLabel(String(n))]}
                  />
                  {Object.keys(SOURCE_LABELS)
                    .filter((s) => detail.timeline_6h.some((r) => typeof r[s] === "number"))
                    .map((s) => (
                      <Bar key={s} dataKey={s} stackId="a" fill={SOURCE_LABELS[s].color} isAnimationActive={false} />
                    ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div>
            <div className="eyebrow mb-1">Pixel FRP distribution (MW)</div>
            <div style={{ height: 90 }} role="img" aria-label="Histogram of fire radiative power per detection">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={detail.frp_histogram.map((b) => ({ ...b, label: b.hi ? `${b.lo}–${b.hi}` : `${b.lo}+` }))} margin={{ top: 2, right: 2, bottom: 0, left: -18 }}>
                  <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} interval={0} />
                  <YAxis tick={tick} axisLine={false} tickLine={false} width={40} />
                  <Tooltip contentStyle={{ background: "#131d31", border: "1px solid #2b3b5a", borderRadius: 8, fontSize: 11 }} />
                  <Bar dataKey="count" fill="#f97316" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <Link
            href={compareHref}
            className="flex items-center justify-center gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-[12px] font-medium text-accent hover:bg-accent/20"
          >
            <ImageIcon size={14} aria-hidden /> Compare Sentinel-2 imagery before / after
          </Link>
          <p className="text-[10.5px] text-faint">
            No AI model is applied to wildfire detections in this version; the platform&apos;s ML component is the SAR flood
            model (see Flood and Model pages).
          </p>
        </>
      ) : null}
    </div>
  );
}
