import type { Filters } from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Extract a human-readable message from a FastAPI error body. */
export function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object" && "detail" in body) {
    const d = (body as { detail: unknown }).detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) {
      return d
        .map((e) => (typeof e === "object" && e && "msg" in e ? String((e as { msg: unknown }).msg) : String(e)))
        .join("; ");
    }
  }
  if (status === 502 || status === 503 || status === 504) return "The data service is temporarily unavailable.";
  return `Request failed (HTTP ${status})`;
}

export async function getJSON<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { signal, headers: { Accept: "application/json" } });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "Cannot reach the TerraWatch API. Is the backend running on port 8000?");
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) throw new ApiError(res.status, errorMessage(body, res.status));
  return body as T;
}

export type QueryValue = string | number | boolean | null | undefined | string[];

export function qs(params: Record<string, QueryValue>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") continue;
    if (Array.isArray(v)) {
      if (v.length) sp.set(k, v.join(","));
    } else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Convert UI filters into backend query parameters. Dates are whole UTC days, end inclusive. */
export function filterParams(f: Filters, extra: Record<string, QueryValue> = {}): Record<string, QueryValue> {
  return {
    dataset: f.dataset,
    start: f.start ? `${f.start}T00:00:00Z` : null,
    end: f.end ? `${f.end}T23:59:59Z` : null,
    sources: f.sources,
    confidence: f.confidence,
    daynight: f.daynight,
    min_frp: f.minFrp,
    iso3: f.iso3,
    ...extra,
  };
}

export function bboxParam(b: [number, number, number, number] | null | undefined): string | null {
  if (!b) return null;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const [w, s, e, n] = b;
  return [clamp(w, -180, 180), clamp(s, -90, 90), clamp(e, -180, 180), clamp(n, -90, 90)]
    .map((v) => v.toFixed(4))
    .join(",");
}
