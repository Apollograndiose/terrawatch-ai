"use client";

import type { ConfidenceClass, DatasetInfo, Filters, SourceId } from "@/lib/types";
import { SOURCE_LABELS, fmtUtc } from "@/lib/format";
import { Segmented, Toggle } from "@/components/ui";
import { RotateCcw } from "lucide-react";

const SOURCES: SourceId[] = ["VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT", "VIIRS_SNPP_NRT", "MODIS_NRT"];
const CONF: { v: ConfidenceClass; label: string; color: string }[] = [
  { v: "high", label: "High", color: "#ef4444" },
  { v: "nominal", label: "Nominal", color: "#f97316" },
  { v: "low", label: "Low", color: "#fbbf24" },
];

export const DEFAULT_FILTERS: Filters = {
  dataset: "demo",
  start: null,
  end: null,
  sources: [],
  confidence: ["nominal", "high"],
  daynight: null,
  minFrp: null,
  iso3: null,
};

function toggle<T>(list: T[], v: T, all: T[]): T[] {
  const base = list.length ? list : all;
  const next = base.includes(v) ? base.filter((x) => x !== v) : [...base, v];
  return next.length === all.length ? [] : next;
}

export function FilterPanel({
  filters,
  onChange,
  info,
  feedRows,
  imageryDate,
  onImageryDate,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  info: DatasetInfo | undefined;
  feedRows: Record<string, number>;
  imageryDate: string | null;
  onImageryDate: (d: string | null) => void;
}) {
  const minDate = info?.earliest_observation_utc?.slice(0, 10);
  const maxDate = info?.latest_observation_utc?.slice(0, 10);
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const activeSources = filters.sources.length ? filters.sources : SOURCES;
  const activeConf = filters.confidence.length ? filters.confidence : CONF.map((c) => c.v);

  return (
    <div className="space-y-4 text-[12px]">
      <fieldset>
        <legend className="eyebrow mb-1.5">Dataset</legend>
        <Segmented
          label="Dataset"
          value={filters.dataset}
          onChange={(v) => set({ dataset: v, start: null, end: null })}
          options={[
            { value: "demo", label: "Demo snapshot" },
            { value: "live", label: "Live NRT" },
          ]}
        />
        <p className="mt-1.5 text-[11px] leading-snug text-faint">
          {filters.dataset === "demo"
            ? "Authentic FIRMS records frozen at retrieval time for reproducible exploration."
            : "Public FIRMS near-real-time feeds, refreshed on demand (no key needed)."}
        </p>
      </fieldset>

      <fieldset>
        <legend className="eyebrow mb-1.5">Observation window (UTC)</legend>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="sr-only">Start date</span>
            <input
              type="date"
              value={filters.start ?? ""}
              min={minDate}
              max={filters.end ?? maxDate}
              onChange={(e) => set({ start: e.target.value || null })}
              className="mono w-full rounded-md border border-line bg-surface-1 px-2 py-1 text-[11.5px]"
            />
          </label>
          <label className="block">
            <span className="sr-only">End date</span>
            <input
              type="date"
              value={filters.end ?? ""}
              min={filters.start ?? minDate}
              max={maxDate}
              onChange={(e) => set({ end: e.target.value || null })}
              className="mono w-full rounded-md border border-line bg-surface-1 px-2 py-1 text-[11.5px]"
            />
          </label>
        </div>
        <p className="mt-1 text-[11px] text-faint">
          Available: {fmtUtc(info?.earliest_observation_utc, false)} → {fmtUtc(info?.latest_observation_utc, false)}
        </p>
      </fieldset>

      <fieldset>
        <legend className="eyebrow mb-1.5">Satellite / instrument</legend>
        <div className="flex flex-wrap gap-1.5">
          {SOURCES.map((s) => (
            <Toggle
              key={s}
              pressed={activeSources.includes(s)}
              color={SOURCE_LABELS[s].color}
              onClick={() => set({ sources: toggle(filters.sources, s, SOURCES) })}
              title={`${SOURCE_LABELS[s].long} (${SOURCE_LABELS[s].res}) — ${feedRows[s] ?? 0} records in dataset`}
            >
              {SOURCE_LABELS[s].short}
              <span className="mono text-[10px] text-faint">{feedRows[s] ? "" : "·0"}</span>
            </Toggle>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="eyebrow mb-1.5">Detection confidence</legend>
        <div className="flex flex-wrap gap-1.5">
          {CONF.map((c) => (
            <Toggle
              key={c.v}
              pressed={activeConf.includes(c.v)}
              color={c.color}
              onClick={() => set({ confidence: toggle(filters.confidence, c.v, CONF.map((x) => x.v)) })}
            >
              {c.label}
            </Toggle>
          ))}
        </div>
        <p className="mt-1 text-[11px] leading-snug text-faint">
          VIIRS classes are native; MODIS 0–100 is mapped low &lt;30, nominal 30–79, high ≥80.
        </p>
      </fieldset>

      <fieldset>
        <legend className="eyebrow mb-1.5">Overpass</legend>
        <Segmented
          label="Day or night overpass"
          value={filters.daynight ?? "all"}
          onChange={(v) => set({ daynight: v === "all" ? null : (v as "D" | "N") })}
          options={[
            { value: "all", label: "All" },
            { value: "D", label: "Day" },
            { value: "N", label: "Night" },
          ]}
        />
      </fieldset>

      <fieldset>
        <legend className="eyebrow mb-1.5 flex w-full justify-between">
          <span>Min. fire radiative power</span>
          <span className="mono normal-case tracking-normal text-muted">{filters.minFrp ? `${filters.minFrp} MW` : "any"}</span>
        </legend>
        <input
          type="range"
          aria-label="Minimum fire radiative power in megawatts"
          min={0}
          max={100}
          step={5}
          value={filters.minFrp ?? 0}
          onChange={(e) => set({ minFrp: Number(e.target.value) || null })}
          className="w-full"
        />
      </fieldset>

      <fieldset>
        <legend className="eyebrow mb-1.5">Satellite imagery overlay</legend>
        <label className="flex items-center gap-2 text-muted">
          <input type="checkbox" checked={!!imageryDate} onChange={(e) => onImageryDate(e.target.checked ? maxDate ?? null : null)} />
          VIIRS true colour (NASA GIBS)
        </label>
        {imageryDate ? (
          <input
            type="date"
            aria-label="Imagery date"
            value={imageryDate}
            max={maxDate}
            onChange={(e) => onImageryDate(e.target.value || null)}
            className="mono mt-1.5 w-full rounded-md border border-line bg-surface-1 px-2 py-1 text-[11.5px]"
          />
        ) : null}
      </fieldset>

      <button
        type="button"
        onClick={() => onChange({ ...DEFAULT_FILTERS, dataset: filters.dataset })}
        className="inline-flex items-center gap-1.5 text-[11.5px] text-faint hover:text-text"
      >
        <RotateCcw size={12} aria-hidden /> Reset filters
      </button>
    </div>
  );
}
