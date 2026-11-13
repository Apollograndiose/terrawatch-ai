"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TimeseriesRow } from "@/lib/types";
import { SOURCE_LABELS, fmtCompact, fmtInt, sourceLabel } from "@/lib/format";

const tick = { fill: "#62718b", fontSize: 10, fontFamily: "var(--font-plex-mono)" };

function fmtTick(iso: string, bucket: string) {
  const d = new Date(iso);
  const day = `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return bucket === "day" ? day : `${day} ${String(d.getUTCHours()).padStart(2, "0")}h`;
}

/** Stacked detections per time bucket, by source. */
export function ActivityChart({
  series,
  sources,
  bucket,
  height = 150,
}: {
  series: TimeseriesRow[];
  sources: string[];
  bucket: string;
  height?: number;
}) {
  return (
    <div style={{ height }} role="img" aria-label={`Detections per ${bucket} by satellite source`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="#1f2c45" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="t" tick={tick} tickFormatter={(v) => fmtTick(v, bucket)} minTickGap={28} axisLine={false} tickLine={false} />
          <YAxis tick={tick} tickFormatter={(v) => fmtCompact(v)} axisLine={false} tickLine={false} width={44} />
          <Tooltip
            contentStyle={{ background: "#131d31", border: "1px solid #2b3b5a", borderRadius: 8, fontSize: 11 }}
            labelStyle={{ color: "#93a2bb" }}
            labelFormatter={(v) => `${fmtTick(String(v), bucket)} UTC`}
            formatter={(v, name) => [fmtInt(Number(v)), sourceLabel(String(name))]}
          />
          {sources.map((s) => (
            <Area
              key={s}
              type="monotone"
              dataKey={s}
              stackId="1"
              stroke={SOURCE_LABELS[s]?.color ?? "#94a3b8"}
              fill={SOURCE_LABELS[s]?.color ?? "#94a3b8"}
              fillOpacity={0.22}
              strokeWidth={1.2}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
