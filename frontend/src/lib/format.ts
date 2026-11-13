export const SOURCE_LABELS: Record<string, { short: string; long: string; res: string; color: string }> = {
  VIIRS_NOAA20_NRT: { short: "NOAA-20", long: "VIIRS · NOAA-20", res: "375 m", color: "#38bdf8" },
  VIIRS_NOAA21_NRT: { short: "NOAA-21", long: "VIIRS · NOAA-21", res: "375 m", color: "#818cf8" },
  VIIRS_SNPP_NRT: { short: "Suomi NPP", long: "VIIRS · Suomi NPP", res: "375 m", color: "#2dd4bf" },
  MODIS_NRT: { short: "MODIS", long: "MODIS · Terra/Aqua", res: "1 km", color: "#f472b6" },
};

export function sourceLabel(s: string): string {
  return SOURCE_LABELS[s]?.short ?? s;
}

export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

export function fmtCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

/** UTC timestamp formatted as "2026-11-07 18:49 UTC". */
export function fmtUtc(iso: string | null | undefined, withTime = true): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (v: number) => String(v).padStart(2, "0");
  const date = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  return withTime ? `${date} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC` : date;
}

export function fmtCoord(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lon).toFixed(4)}° ${ew}`;
}

export function relativeAge(iso: string | null | undefined, now?: Date): string {
  if (!iso) return "—";
  const ms = (now ?? new Date()).getTime() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export const CONFIDENCE_COLORS: Record<string, string> = {
  high: "#ef4444",
  nominal: "#f97316",
  low: "#fbbf24",
  unknown: "#64748b",
};

/** FRP (MW) -> fire colour ramp. Thresholds follow the long-tailed FRP distribution. */
export function frpColor(frp: number): string {
  if (frp >= 100) return "#fef3c7";
  if (frp >= 30) return "#fbbf24";
  if (frp >= 10) return "#f97316";
  if (frp >= 3) return "#ef4444";
  return "#b91c1c";
}
