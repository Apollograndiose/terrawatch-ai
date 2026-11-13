"use client";

import { fmtCompact } from "@/lib/format";

/** Accessible horizontal bar list (real <ul>, values readable by screen readers). */
export function BarList({
  rows,
  color = "#38bdf8",
  label,
  format = fmtCompact,
  colorFor,
}: {
  rows: { key: string; value: number; display?: string }[];
  color?: string;
  label: string;
  format?: (n: number) => string;
  colorFor?: (key: string) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul aria-label={label} className="space-y-1">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,7.5rem)_1fr_3.2rem] items-center gap-2 text-[11.5px]">
          <span className="truncate text-muted" title={r.display ?? r.key}>
            {r.display ?? r.key}
          </span>
          <span className="h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
            <span
              className="block h-full rounded-full"
              style={{ width: `${(r.value / max) * 100}%`, background: colorFor?.(r.key) ?? color }}
            />
          </span>
          <span className="mono text-right text-text/90">{format(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}
