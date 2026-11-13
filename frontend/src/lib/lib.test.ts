import { describe, expect, it } from "vitest";
import { bboxParam, errorMessage, filterParams, qs } from "./api";
import { fmtCompact, fmtCoord, fmtPct, fmtUtc, frpColor, relativeAge, sourceLabel } from "./format";
import { bboxAreaKm2, gridToGeoJSON, imageCorners, pointsToGeoJSON } from "./geo";
import type { Filters } from "./types";

const base: Filters = {
  dataset: "demo",
  start: null,
  end: null,
  sources: [],
  confidence: [],
  daynight: null,
  minFrp: null,
  iso3: null,
};

describe("api helpers", () => {
  it("serialises only meaningful params", () => {
    expect(qs({ a: 1, b: null, c: undefined, d: "", e: [], f: ["x", "y"], g: false })).toBe("?a=1&f=x%2Cy&g=false");
    expect(qs({})).toBe("");
  });

  it("maps UI filters to inclusive UTC day bounds", () => {
    const p = filterParams({ ...base, start: "2026-11-05", end: "2026-11-06", sources: ["MODIS_NRT"], minFrp: 10 });
    expect(p.start).toBe("2026-11-05T00:00:00Z");
    expect(p.end).toBe("2026-11-06T23:59:59Z");
    expect(p.sources).toEqual(["MODIS_NRT"]);
    expect(p.min_frp).toBe(10);
  });

  it("clamps bbox values", () => {
    expect(bboxParam([-200, -95, 10, 95])).toBe("-180.0000,-90.0000,10.0000,90.0000");
    expect(bboxParam(null)).toBeNull();
  });

  it("extracts FastAPI error details", () => {
    expect(errorMessage({ detail: "bad bbox" }, 422)).toBe("bad bbox");
    expect(errorMessage({ detail: [{ msg: "a" }, { msg: "b" }] }, 422)).toBe("a; b");
    expect(errorMessage(null, 502)).toMatch(/temporarily unavailable/);
    expect(errorMessage(null, 500)).toBe("Request failed (HTTP 500)");
  });
});

describe("formatters", () => {
  it("formats UTC timestamps without local-time drift", () => {
    expect(fmtUtc("2026-11-07T18:49:00+00:00")).toBe("2026-11-07 18:49 UTC");
    expect(fmtUtc("2026-11-07T23:30:00-05:00", false)).toBe("2026-11-08");
    expect(fmtUtc(null)).toBe("—");
  });
  it("formats numbers and coordinates", () => {
    expect(fmtCompact(1_010_464)).toBe("1M");
    expect(fmtPct(0.1234)).toBe("12.3%");
    expect(fmtCoord(-19.5696, 124.3633)).toBe("19.5696° S, 124.3633° E");
    expect(sourceLabel("VIIRS_NOAA21_NRT")).toBe("NOAA-21");
    expect(sourceLabel("UNKNOWN")).toBe("UNKNOWN");
  });
  it("computes relative ages", () => {
    const now = new Date("2026-11-13T02:00:00Z");
    expect(relativeAge("2026-11-12T23:48:00Z", now)).toBe("2 h ago");
    expect(relativeAge("2026-11-13T01:30:00Z", now)).toBe("30 min ago");
    expect(relativeAge("2026-11-05T00:00:00Z", now)).toBe("8 d ago");
  });
  it("uses a monotonic fire ramp", () => {
    expect(frpColor(1)).toBe("#b91c1c");
    expect(frpColor(500)).toBe("#fef3c7");
  });
});

describe("geo conversions", () => {
  it("expands columnar points to GeoJSON", () => {
    const fc = pointsToGeoJSON({ id: ["a"], lon: [1], lat: [2], frp: [3], t: ["t"], src: ["MODIS_NRT"], conf: ["high"], dn: ["D"] });
    expect(fc.features[0].geometry).toEqual({ type: "Point", coordinates: [1, 2] });
    expect(fc.features[0].properties.conf).toBe("high");
  });
  it("builds closed grid squares clamped to web-mercator latitudes", () => {
    const fc = gridToGeoJSON({ lon: [10], lat: [84.5], n: [99], frp_sum: [1], frp_max: [1] }, 2);
    const ring = (fc.features[0].geometry as { coordinates: [number, number][][] }).coordinates[0];
    expect(ring[0]).toEqual(ring[4]);
    expect(Math.max(...ring.map((p) => p[1]))).toBe(85);
    expect(fc.features[0].properties.log_n).toBeCloseTo(2);
  });
  it("orders image corners TL, TR, BR, BL", () => {
    expect(imageCorners([0, 0, 1, 1])).toEqual([[0, 1], [1, 1], [1, 0], [0, 0]]);
  });
  it("approximates bbox area", () => {
    expect(bboxAreaKm2([0, 0, 1, 1])).toBeGreaterThan(12_000);
    expect(bboxAreaKm2([0, 0, 1, 1])).toBeLessThan(12_400);
  });
});
