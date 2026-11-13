"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, ImageSource, Map as MLMap } from "maplibre-gl";
import { imageCorners, pointsToGeoJSON } from "@/lib/geo";
import type { PointsPayload } from "@/lib/types";
import { BASEMAP_STYLE_URL, muteBasemap } from "./basemap";

export interface Overlay {
  url: string;
  bounds: [number, number, number, number];
  opacity: number;
}

interface Props {
  bounds: [number, number, number, number];
  left: Overlay | null;
  right: Overlay | null;
  rightChange: Overlay | null; // optional change layer drawn on the right map
  leftChange?: Overlay | null; // optional overlay drawn on the left map
  points: PointsPayload | null;
  showPoints: boolean;
  mode: "swipe" | "side";
  leftLabel: React.ReactNode;
  rightLabel: React.ReactNode;
}

type ML = typeof import("maplibre-gl");

async function loadML(): Promise<ML> {
  const mod = await import("maplibre-gl");
  const ml = ((mod as unknown as { default?: ML }).default ?? mod) as ML;
  ml.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
  return ml;
}

function setImage(map: MLMap, id: string, o: Overlay | null, before?: string) {
  const src = map.getSource(id) as ImageSource | undefined;
  if (!o) {
    if (map.getLayer(id)) map.removeLayer(id);
    if (src) map.removeSource(id);
    return;
  }
  if (src) {
    src.updateImage({ url: o.url, coordinates: imageCorners(o.bounds) });
    map.setPaintProperty(id, "raster-opacity", o.opacity);
  } else {
    map.addSource(id, { type: "image", url: o.url, coordinates: imageCorners(o.bounds) });
    map.addLayer({ id, type: "raster", source: id, paint: { "raster-opacity": o.opacity, "raster-fade-duration": 0 } }, before);
  }
}

/** Two camera-synchronised MapLibre maps for before/after comparison (swipe or side-by-side). */
export default function SwipeMap(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const aRef = useRef<HTMLDivElement>(null);
  const bRef = useRef<HTMLDivElement>(null);
  const maps = useRef<{ a: MLMap; b: MLMap } | null>(null);
  const [ready, setReady] = useState(0);
  const [split, setSplit] = useState(50);

  useEffect(() => {
    let off = false;
    const created: MLMap[] = [];
    (async () => {
      const ml = await loadML();
      if (off || !aRef.current || !bRef.current) return;
      const [w, s, e, n] = p.bounds;
      const opts = { style: BASEMAP_STYLE_URL, bounds: [[w, s], [e, n]] as [[number, number], [number, number]], fitBoundsOptions: { padding: 20 }, dragRotate: false, attributionControl: false as const };
      const a = new ml.Map({ container: aRef.current, ...opts });
      const b = new ml.Map({ container: bRef.current, ...opts, attributionControl: { compact: true } });
      created.push(a, b);
      b.addControl(new ml.NavigationControl({ showCompass: false }), "bottom-right");
      b.addControl(new ml.ScaleControl({ unit: "metric" }), "bottom-left");
      // Camera sync without feedback loops.
      let syncing = false;
      const sync = (from: MLMap, to: MLMap) => () => {
        if (syncing) return;
        syncing = true;
        to.jumpTo({ center: from.getCenter(), zoom: from.getZoom(), bearing: from.getBearing(), pitch: from.getPitch() });
        syncing = false;
      };
      a.on("move", sync(a, b));
      b.on("move", sync(b, a));
      let loaded = 0;
      for (const m of [a, b]) {
        m.on("style.load", () => {
          muteBasemap(m);
          m.addSource("pts", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
          m.addLayer({
            id: "pts",
            type: "circle",
            source: "pts",
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 1.6, 13, 5],
              "circle-color": "rgba(0,0,0,0)",
              "circle-stroke-color": "#fb923c",
              "circle-stroke-width": 0.9,
              "circle-stroke-opacity": 0.75,
            },
          });
          loaded += 1;
          if (loaded === 2) setReady((r) => r + 1);
        });
      }
      maps.current = { a, b };
    })();
    return () => {
      off = true;
      created.forEach((m) => m.remove());
      maps.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = maps.current;
    if (!m || !ready) return;
    setImage(m.a, "img", p.left, "pts");
    setImage(m.b, "img", p.right, "pts");
    setImage(m.b, "change", p.rightChange, "pts");
    setImage(m.a, "change", p.leftChange ?? null, "pts");
  }, [p.left, p.right, p.rightChange, p.leftChange, ready]);

  useEffect(() => {
    const m = maps.current;
    if (!m || !ready) return;
    const fc = p.showPoints && p.points ? pointsToGeoJSON(p.points) : { type: "FeatureCollection" as const, features: [] };
    (m.a.getSource("pts") as GeoJSONSource).setData(fc as never);
    (m.b.getSource("pts") as GeoJSONSource).setData(fc as never);
  }, [p.points, p.showPoints, ready]);

  useEffect(() => {
    const m = maps.current;
    if (!m) return;
    requestAnimationFrame(() => {
      m.a.resize();
      m.b.resize();
    });
  }, [p.mode]);

  // Re-frame when the target bounds change (e.g. a different flood chip is selected).
  const boundsKey = p.bounds.join(",");
  useEffect(() => {
    const m = maps.current;
    if (!m || !ready) return;
    const [w, s, e, n] = p.bounds;
    m.b.fitBounds([[w, s], [e, n]], { padding: 20, duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundsKey, ready]);

  const swipe = p.mode === "swipe";
  return (
    <div ref={wrap} className={swipe ? "relative h-full w-full" : "grid h-full w-full grid-cols-1 gap-1 md:grid-cols-2"}>
      <div className={swipe ? "absolute inset-0" : "relative min-h-[40vh]"}>
        <div ref={aRef} className="h-full w-full" role="region" aria-label="Before image map" />
        <div className="pointer-events-none absolute left-2 top-2">{p.leftLabel}</div>
      </div>
      <div className={swipe ? "absolute inset-0" : "relative min-h-[40vh]"} style={swipe ? { clipPath: `inset(0 0 0 ${split}%)` } : undefined}>
        <div ref={bRef} className="h-full w-full" role="region" aria-label="After image map" />
        <div className="pointer-events-none absolute right-2 top-2">{p.rightLabel}</div>
      </div>
      {swipe ? (
        <>
          <div className="pointer-events-none absolute inset-y-0 w-px bg-accent shadow-[0_0_8px_#38bdf8]" style={{ left: `${split}%` }} />
          <input
            type="range"
            min={0}
            max={100}
            step={0.5}
            value={split}
            onChange={(e) => setSplit(Number(e.target.value))}
            aria-label="Swipe position between before and after imagery"
            className="absolute bottom-10 left-1/2 w-56 -translate-x-1/2"
          />
        </>
      ) : null}
    </div>
  );
}
