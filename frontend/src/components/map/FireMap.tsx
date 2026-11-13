"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MLMap, MapMouseEvent, RasterSourceSpecification } from "maplibre-gl";
import { bboxPolygon, gridToGeoJSON, pointsToGeoJSON } from "@/lib/geo";
import type { Cluster, MapResponse, PointsPayload } from "@/lib/types";
import { BASEMAP_STYLE_URL, FALLBACK_STYLE, GIBS_ATTRIBUTION, gibsTrueColorTiles, muteBasemap } from "./basemap";

export interface ViewState {
  bbox: [number, number, number, number];
  zoom: number;
}

interface Props {
  data: MapResponse | null;
  clusters: Cluster[];
  selectedCluster: Cluster | null;
  clusterPoints: PointsPayload | null;
  imageryDate: string | null;
  flyTo: { bbox?: [number, number, number, number]; center?: [number, number]; zoom?: number; key: number } | null;
  onView: (v: ViewState) => void;
  onPoint: (id: string) => void;
  onCluster: (id: string) => void;
}

const EMPTY = { type: "FeatureCollection" as const, features: [] };

export default function FireMap(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [basemapError, setBasemapError] = useState(false);
  const cb = useRef(props);
  useEffect(() => {
    cb.current = props;
  });

  // ---- initialise once
  useEffect(() => {
    let disposed = false;
    let map: MLMap | null = null;
    (async () => {
      const mod = await import("maplibre-gl");
      // maplibre-gl v5+ ships ESM named exports; older builds expose a default export.
      const maplibregl = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod;
      if (disposed || !container.current) return;
      maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      map = new maplibregl.Map({
        container: container.current,
        style: BASEMAP_STYLE_URL,
        center: [20, 10],
        zoom: 1.6,
        minZoom: 1,
        maxZoom: 14,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
      });
      mapRef.current = map;
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      map.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 110 }), "bottom-left");
      map.on("error", (e) => {
        const msg = String((e as unknown as { error?: { message?: string } }).error?.message ?? "");
        if (!map?.isStyleLoaded() && /style|tiles\.openfreemap/i.test(msg)) {
          setBasemapError(true);
          map?.setStyle(FALLBACK_STYLE);
        }
      });
      map.on("style.load", () => {
        if (!map) return;
        muteBasemap(map);
        addLayers(map);
        setReady(true);
        emitView(map, cb.current.onView);
      });
      map.on("moveend", () => map && emitView(map, cb.current.onView));
      map.on("click", "fire-points", (e: MapMouseEvent & { features?: { properties: Record<string, unknown> }[] }) => {
        const id = e.features?.[0]?.properties?.id;
        if (typeof id === "string") cb.current.onPoint(id);
      });
      map.on("click", "fire-grid", (e: MapMouseEvent & { features?: unknown[] }) => {
        map?.easeTo({ center: e.lngLat, zoom: Math.min((map?.getZoom() ?? 2) + 2.5, 12) });
      });
      map.on("click", "clusters-ring", (e: MapMouseEvent & { features?: { properties: Record<string, unknown> }[] }) => {
        const id = e.features?.[0]?.properties?.cluster_id;
        if (typeof id === "string") cb.current.onCluster(id);
      });
      for (const layer of ["fire-points", "fire-grid", "clusters-ring"]) {
        map.on("mouseenter", layer, () => map && (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", layer, () => map && (map.getCanvas().style.cursor = ""));
      }
    })();
    return () => {
      disposed = true;
      map?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // ---- data updates
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const d = props.data;
    const pts = map.getSource("fire-points") as GeoJSONSource | undefined;
    const grid = map.getSource("fire-grid") as GeoJSONSource | undefined;
    if (!d) {
      pts?.setData(EMPTY);
      grid?.setData(EMPTY);
      return;
    }
    if (d.mode === "points") {
      pts?.setData(pointsToGeoJSON(d.points) as never);
      grid?.setData(EMPTY);
    } else {
      grid?.setData(gridToGeoJSON(d.cells, d.cell_deg) as never);
      pts?.setData(EMPTY);
    }
  }, [props.data, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const fc = {
      type: "FeatureCollection" as const,
      features: props.clusters.map((c) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [c.lon, c.lat] },
        properties: { cluster_id: c.cluster_id, detections: c.detections, frp: c.frp_sum_mw },
      })),
    };
    (map.getSource("clusters") as GeoJSONSource | undefined)?.setData(fc as never);
  }, [props.clusters, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const sel = props.selectedCluster;
    (map.getSource("selected-bbox") as GeoJSONSource | undefined)?.setData((sel ? bboxPolygon(sel.bbox) : EMPTY) as never);
    (map.getSource("cluster-points") as GeoJSONSource | undefined)?.setData(
      (props.clusterPoints ? pointsToGeoJSON(props.clusterPoints) : EMPTY) as never,
    );
  }, [props.selectedCluster, props.clusterPoints, ready]);

  // ---- satellite imagery overlay (NASA GIBS)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const date = props.imageryDate;
    if (map.getLayer("gibs")) map.removeLayer("gibs");
    if (map.getSource("gibs")) map.removeSource("gibs");
    if (!date) return;
    map.addSource("gibs", {
      type: "raster",
      tiles: gibsTrueColorTiles(date),
      tileSize: 256,
      maxzoom: 9,
      attribution: GIBS_ATTRIBUTION,
    } satisfies RasterSourceSpecification);
    map.addLayer({ id: "gibs", type: "raster", source: "gibs", paint: { "raster-opacity": 0.85 } }, firstDataLayer(map));
  }, [props.imageryDate, ready]);

  // ---- camera requests
  useEffect(() => {
    const map = mapRef.current;
    const f = props.flyTo;
    if (!map || !ready || !f) return;
    if (f.bbox) {
      const [w, s, e, n] = f.bbox;
      map.fitBounds(
        [
          [w, s],
          [e, n],
        ],
        { padding: 80, maxZoom: 11, duration: 900 },
      );
    } else if (f.center) {
      map.flyTo({ center: f.center, zoom: f.zoom ?? 9, duration: 900 });
    }
  }, [props.flyTo, ready]);

  return (
    <div className="absolute inset-0">
      <div ref={container} className="h-full w-full" role="region" aria-label="Interactive map of fire detections" />
      {basemapError ? (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 rounded bg-surface-2 px-2 py-1 text-[11px] text-warn">
          Basemap unavailable — showing data on a plain background.
        </div>
      ) : null}
    </div>
  );
}

function emitView(map: MLMap, onView: (v: ViewState) => void) {
  const b = map.getBounds();
  let w = b.getWest();
  let e = b.getEast();
  if (e - w >= 360) {
    w = -180;
    e = 180;
  } else {
    w = ((((w + 180) % 360) + 360) % 360) - 180;
    e = ((((e + 180) % 360) + 360) % 360) - 180;
  }
  onView({ bbox: [w, Math.max(b.getSouth(), -90), e, Math.min(b.getNorth(), 90)], zoom: map.getZoom() });
}

function firstDataLayer(map: MLMap): string | undefined {
  return map.getLayer("fire-grid") ? "fire-grid" : undefined;
}

function addLayers(map: MLMap) {
  const src = (id: string) => {
    if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: EMPTY });
  };
  ["fire-grid", "fire-points", "clusters", "selected-bbox", "cluster-points"].forEach(src);

  map.addLayer({
    id: "fire-grid",
    type: "fill",
    source: "fire-grid",
    paint: {
      "fill-color": [
        "interpolate",
        ["linear"],
        ["get", "log_n"],
        0,
        "#7f1d1d",
        0.8,
        "#b91c1c",
        1.6,
        "#ef4444",
        2.4,
        "#f97316",
        3.1,
        "#fbbf24",
        3.8,
        "#fef3c7",
      ],
      "fill-opacity": ["interpolate", ["linear"], ["get", "log_n"], 0, 0.28, 1.5, 0.55, 3, 0.85],
      "fill-antialias": false,
    },
  });
  map.addLayer({
    id: "fire-points-glow",
    type: "circle",
    source: "fire-points",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 3, 8, 7, 12, 14],
      "circle-color": "#f97316",
      "circle-opacity": 0.14,
      "circle-blur": 1,
    },
  });
  map.addLayer({
    id: "fire-points",
    type: "circle",
    source: "fire-points",
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        3,
        ["interpolate", ["linear"], ["get", "frp"], 0, 1.4, 100, 3],
        9,
        ["interpolate", ["linear"], ["get", "frp"], 0, 2.6, 100, 6],
        13,
        ["interpolate", ["linear"], ["get", "frp"], 0, 5, 100, 10],
      ],
      "circle-color": ["step", ["get", "frp"], "#b91c1c", 3, "#ef4444", 10, "#f97316", 30, "#fbbf24", 100, "#fef3c7"],
      "circle-stroke-width": ["case", ["==", ["get", "conf"], "low"], 0.8, 0],
      "circle-stroke-color": "#fde68a",
      "circle-opacity": ["case", ["==", ["get", "conf"], "low"], 0.55, 0.95],
    },
  });
  map.addLayer({
    id: "selected-bbox",
    type: "line",
    source: "selected-bbox",
    paint: { "line-color": "#38bdf8", "line-width": 1.2, "line-dasharray": [3, 2] },
  });
  map.addLayer({
    id: "cluster-points",
    type: "circle",
    source: "cluster-points",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 2.5, 12, 7],
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": "#38bdf8",
      "circle-stroke-width": 0.6,
      "circle-stroke-opacity": 0.45,
    },
  });
  map.addLayer({
    id: "clusters-ring",
    type: "circle",
    source: "clusters",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["sqrt", ["get", "detections"]], 2, 7, 30, 13, 90, 22],
      "circle-color": "rgba(56,189,248,0.06)",
      "circle-stroke-color": "#38bdf8",
      "circle-stroke-width": 1.2,
      "circle-stroke-opacity": 0.85,
    },
  });
  map.addLayer({
    id: "clusters-label",
    type: "symbol",
    source: "clusters",
    minzoom: 3,
    layout: {
      "text-field": ["to-string", ["get", "detections"]],
      "text-size": 10,
      "text-font": ["Noto Sans Regular"],
      "text-allow-overlap": false,
    },
    paint: { "text-color": "#bae6fd", "text-halo-color": "#070b14", "text-halo-width": 1.2 },
  });
}
