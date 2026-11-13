"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { SlidersHorizontal } from "lucide-react";
import { bboxParam, filterParams, qs } from "@/lib/api";
import { useApi, useDebounced } from "@/lib/hooks";
import type {
  ClusterDetail,
  ClustersResponse,
  DetectionResponse,
  Filters,
  MapResponse,
  StatusResponse,
  SummaryResponse,
  TimeseriesResponse,
} from "@/lib/types";
import { fmtInt } from "@/lib/format";
import type { ViewState } from "@/components/map/FireMap";
import { DEFAULT_FILTERS, FilterPanel } from "./FilterPanel";
import { StatusStrip } from "./StatusStrip";
import { SummaryPanel } from "./SummaryPanel";
import { ClusterList, type ClusterSort } from "./ClusterList";
import { ClusterExplorer } from "./ClusterExplorer";
import { DetectionPanel } from "./DetectionPanel";
import { SearchBox } from "./SearchBox";
import { Spinner } from "@/components/ui";

const FireMap = dynamic(() => import("@/components/map/FireMap"), {
  ssr: false,
  loading: () => (
    <div className="grid-bg absolute inset-0 grid place-items-center">
      <Spinner label="Initialising map" />
    </div>
  ),
});

type Tab = "overview" | "clusters" | "details" | "filters";

function isGlobal(b: [number, number, number, number]) {
  return b[2] - b[0] >= 300 || (b[0] === -180 && b[2] === 180);
}

export default function Dashboard() {
  const [filters, setFiltersState] = useState<Filters>(DEFAULT_FILTERS);
  const [view, setView] = useState<ViewState | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [sort, setSort] = useState<ClusterSort>("frp");
  const [clusterId, setClusterId] = useState<string | null>(null);
  const [detectionId, setDetectionId] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<{ bbox?: [number, number, number, number]; center?: [number, number]; zoom?: number; key: number } | null>(null);
  const [imageryDate, setImageryDate] = useState<string | null>(null);

  const status = useApi<StatusResponse>("/api/status");
  // Poll status while the live dataset is refreshing.
  useEffect(() => {
    if (status.data?.live.state !== "refreshing") return;
    const t = setInterval(status.reload, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.data?.live.state]);

  const dview = useDebounced(view, 250);
  const viewBbox = dview && !isGlobal(dview.bbox) ? bboxParam(dview.bbox) : null;
  const fp = useMemo(() => filterParams(filters), [filters]);
  const version = status.data?.datasets[filters.dataset]?.version ?? 0;

  const mapUrl = dview ? `/api/fires/map${qs({ ...fp, bbox: viewBbox, zoom: dview.zoom.toFixed(2) })}` : null;
  const mapData = useApi<MapResponse>(mapUrl, [version]);
  const summary = useApi<SummaryResponse>(dview ? `/api/analytics/summary${qs({ ...fp, bbox: viewBbox })}` : null, [version]);
  const series = useApi<TimeseriesResponse>(dview ? `/api/analytics/timeseries${qs({ ...fp, bbox: viewBbox, bucket: "6h" })}` : null, [version]);
  const clusters = useApi<ClustersResponse>(
    dview ? `/api/fires/clusters${qs({ ...fp, bbox: viewBbox, sort, limit: 40, min_detections: 5 })}` : null,
    [version],
  );
  const clusterDetail = useApi<ClusterDetail>(clusterId ? `/api/fires/clusters/${clusterId}${qs(fp)}` : null, [version]);
  const detection = useApi<DetectionResponse>(detectionId ? `/api/fires/detections/${detectionId}${qs({ dataset: filters.dataset })}` : null);

  // A selected cluster may no longer exist under new filters, so clear it together with the change.
  function setFilters(f: Filters) {
    setFiltersState(f);
    setClusterId(null);
  }

  const info = status.data?.datasets[filters.dataset] ?? status.data?.datasets.demo;
  const feedRows = Object.fromEntries((info?.feeds ?? []).map((f) => [f.source, f.rows]));
  const servedFallback = !!mapData.data?.fallback;

  function selectCluster(id: string) {
    setClusterId(id);
    setDetectionId(null);
    setTab("details");
    const c = clusters.data?.clusters.find((x) => x.cluster_id === id);
    if (c) setFlyTo({ bbox: c.bbox, key: Date.now() });
  }

  const md = mapData.data;
  const mapNote = md
    ? md.mode === "grid"
      ? `${fmtInt(md.total)} detections · aggregated to ${md.cell_deg.toFixed(2)}° cells — zoom in or click a cell for individual detections`
      : `${fmtInt(md.returned)} of ${fmtInt(md.total)} detections${md.truncated ? " (strongest FRP shown)" : ""}`
    : null;

  const tabs: { id: Tab; label: string; mobileOnly?: boolean }[] = [
    { id: "filters", label: "Filters", mobileOnly: true },
    { id: "overview", label: "Overview" },
    { id: "clusters", label: "Clusters" },
    { id: "details", label: "Explorer" },
  ];

  return (
    <div className="absolute inset-0 flex flex-col lg:flex-row">
      {/* Left rail (desktop) */}
      <aside className="hidden w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r border-line bg-surface-0 p-3 lg:flex" aria-label="Filters">
        <SearchBox
          onSelect={(r) => {
            setFlyTo({ bbox: r.bbox, key: Date.now() });
          }}
        />
        <FilterPanel filters={filters} onChange={setFilters} info={info} feedRows={feedRows} imageryDate={imageryDate} onImageryDate={setImageryDate} />
      </aside>

      {/* Map */}
      <div className="relative min-h-[45vh] flex-1 lg:min-h-0">
        <FireMap
          data={md}
          clusters={clusters.data?.clusters ?? []}
          selectedCluster={clusterDetail.data?.cluster ?? null}
          clusterPoints={clusterDetail.data?.points ?? null}
          imageryDate={imageryDate}
          flyTo={flyTo}
          onView={setView}
          onPoint={(id) => {
            setDetectionId(id);
            setClusterId(null);
            setTab("details");
          }}
          onCluster={selectCluster}
        />
        <div className="pointer-events-none absolute inset-x-2 top-2 flex flex-col gap-2 sm:inset-x-3 sm:top-3">
          <div className="pointer-events-auto lg:hidden">
            <SearchBox onSelect={(r) => setFlyTo({ bbox: r.bbox, key: Date.now() })} />
          </div>
          <div className="pointer-events-auto">
            <StatusStrip status={status.data} dataset={filters.dataset} servedFallback={servedFallback} onRefreshed={status.reload} />
          </div>
        </div>
        <div className="pointer-events-none absolute bottom-9 left-3 flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-1 sm:max-w-[45%]">
          {mapData.error ? (
            <div role="alert" className="pointer-events-auto rounded-md bg-err/15 px-2 py-1 text-[11.5px] text-err">
              {mapData.error}{" "}
              <button className="underline" onClick={mapData.reload}>
                Retry
              </button>
            </div>
          ) : null}
          {mapData.loading || mapData.refreshing ? (
            <div className="rounded-md bg-surface-2/90 px-2 py-1">
              <Spinner label="Loading detections" />
            </div>
          ) : mapNote ? (
            <div className="mono rounded-md bg-surface-0/80 px-2 py-0.5 text-[10.5px] text-muted">{mapNote}</div>
          ) : null}
          {md && md.total === 0 && !mapData.loading ? (
            <div className="rounded-md bg-surface-2/90 px-2 py-1 text-[11.5px] text-muted">No detections match these filters here.</div>
          ) : null}
        </div>
        <Legend />
      </div>

      {/* Right panel */}
      <aside className="flex h-[48vh] w-full shrink-0 flex-col border-t border-line bg-surface-0 lg:h-auto lg:w-[23rem] lg:border-l lg:border-t-0" aria-label="Analysis panel">
        <div role="tablist" aria-label="Panels" className="flex shrink-0 gap-1 border-b border-line px-2 pt-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={clsx(
                "rounded-t-md px-3 py-1.5 text-[12px]",
                t.mobileOnly && "lg:hidden",
                tab === t.id ? "bg-surface-2 text-text" : "text-faint hover:text-muted",
              )}
            >
              {t.id === "filters" ? <SlidersHorizontal size={13} className="mr-1 inline" aria-hidden /> : null}
              {t.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto p-3">
          {tab === "filters" ? (
            <FilterPanel filters={filters} onChange={setFilters} info={info} feedRows={feedRows} imageryDate={imageryDate} onImageryDate={setImageryDate} />
          ) : null}
          {tab === "overview" ? (
            <SummaryPanel
              summary={summary.data}
              series={series.data}
              loading={summary.loading}
              error={summary.error}
              onRetry={summary.reload}
              scopeLabel={viewBbox ? "Current map view" : "Global"}
            />
          ) : null}
          {tab === "clusters" ? (
            <ClusterList
              data={clusters.data}
              loading={clusters.loading}
              error={clusters.error}
              selected={clusterId}
              sort={sort}
              onSort={setSort}
              onSelect={selectCluster}
              onRetry={clusters.reload}
            />
          ) : null}
          {tab === "details" ? (
            clusterId ? (
              <ClusterExplorer
                detail={clusterDetail.data}
                loading={clusterDetail.loading}
                error={clusterDetail.error}
                onRetry={clusterDetail.reload}
                onClose={() => {
                  setClusterId(null);
                  setTab("clusters");
                }}
              />
            ) : detectionId ? (
              <DetectionPanel data={detection.data} loading={detection.loading} error={detection.error} onClose={() => setDetectionId(null)} />
            ) : (
              <p className="text-[12px] text-muted">
                Select a cluster from the <button className="text-accent underline" onClick={() => setTab("clusters")}>Clusters</button> list or
                click a hotspot on the map to inspect the original FIRMS observation attributes.
              </p>
            )
          ) : null}
        </div>
        <footer className="shrink-0 border-t border-line px-3 py-1.5 text-[10px] leading-snug text-faint">
          Data: NASA FIRMS (MODIS C6.1, VIIRS 375 m NRT). Hotspots are satellite thermal-anomaly observations, not mapped fire
          boundaries.
        </footer>
      </aside>
    </div>
  );
}

function Legend() {
  const stops = [
    ["#b91c1c", "<3"],
    ["#ef4444", "3–10"],
    ["#f97316", "10–30"],
    ["#fbbf24", "30–100"],
    ["#fef3c7", "≥100"],
  ];
  return (
    <div className="panel absolute bottom-8 right-12 hidden px-2.5 py-2 text-[10.5px] sm:block" aria-label="Map legend">
      <div className="eyebrow mb-1">Pixel FRP (MW)</div>
      <div className="flex items-center gap-2">
        {stops.map(([c, l]) => (
          <span key={l} className="flex items-center gap-1 text-muted">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
            {l}
          </span>
        ))}
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-muted">
        <span className="h-3 w-3 rounded-full border border-accent" /> observation cluster (≥5)
        <span className="ml-1 h-2.5 w-2.5 rounded-full border border-fire-1 opacity-60" /> low confidence
      </div>
    </div>
  );
}
