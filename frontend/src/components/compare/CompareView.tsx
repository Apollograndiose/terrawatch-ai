"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { qs } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { DnbrMeta, MapResponse, RenderMeta, SceneSearch, SceneSummary } from "@/lib/types";
import { fmtNum, fmtPct, fmtUtc } from "@/lib/format";
import { EmptyNote, ErrorNote, ProvenanceTag, Segmented, Spinner } from "@/components/ui";

const SwipeMap = dynamic(() => import("@/components/map/SwipeMap"), { ssr: false, loading: () => <Spinner label="Initialising maps" /> });

type Product = "truecolor" | "swir";

function parseBbox(s: string | null): [number, number, number, number] | null {
  if (!s) return null;
  const v = s.split(",").map(Number);
  return v.length === 4 && v.every(Number.isFinite) ? (v as [number, number, number, number]) : null;
}

function SceneSelect({ label, scenes, value, onChange }: { label: string; scenes: SceneSummary[]; value: string | null; onChange: (id: string) => void }) {
  return (
    <label className="block">
      <span className="eyebrow">{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="mono mt-1 w-full rounded-md border border-line bg-surface-1 px-2 py-1 text-[11.5px]"
      >
        {scenes.map((s) => (
          <option key={s.id} value={s.id}>
            {s.datetime.slice(0, 10)} · {s.platform?.replace("sentinel-", "S") ?? ""} · cloud {fmtNum(s.scene_cloud_cover, 0)}% · AOI {Math.round(s.aoi_coverage * 100)}%
            {s.items.length > 1 ? ` · ${s.items.length} tiles` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Among the 3 acquisitions closest to the event date, prefer full AOI coverage, then low cloud. */
function defaultScene(list: SceneSummary[]): string | null {
  if (!list.length) return null;
  const near = list.slice(0, 3);
  const score = (s: SceneSummary) => (1 - s.aoi_coverage) * 100 + (s.scene_cloud_cover ?? 100);
  return [...near].sort((a, b) => score(a) - score(b))[0].id;
}

function DateTag({ side, meta }: { side: string; meta: RenderMeta | null }) {
  return (
    <div className="panel px-2 py-1 text-[11px]">
      <div className="eyebrow">{side}</div>
      {meta ? (
        <div className="mono">
          {fmtUtc(meta.datetime)} · {meta.platform}
        </div>
      ) : (
        <div className="text-faint">no scene</div>
      )}
    </div>
  );
}

export default function CompareView() {
  const sp = useSearchParams();
  const bbox = parseBbox(sp.get("bbox"));
  const date = sp.get("date");
  const label = sp.get("label") ?? "Selected area";
  const [product, setProduct] = useState<Product>("swir");
  const [mode, setMode] = useState<"swipe" | "side">("swipe");
  const [opacity, setOpacity] = useState(1);
  const [changeOn, setChangeOn] = useState(false);
  const [changeOpacity, setChangeOpacity] = useState(0.8);
  const [showPoints, setShowPoints] = useState(true);
  const [preChoice, setPre] = useState<string | null>(null);
  const [postChoice, setPost] = useState<string | null>(null);

  const valid = bbox && date && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const search = useApi<SceneSearch>(valid ? `/api/imagery/search${qs({ bbox: bbox!.join(","), around: date })}` : null);
  const aoi = search.data?.bbox ?? null;

  // User choice if made, otherwise the best default for the current search results.
  const pre = search.data ? (preChoice && search.data.before.some((s) => s.id === preChoice) ? preChoice : defaultScene(search.data.before)) : null;
  const post = search.data ? (postChoice && search.data.after.some((s) => s.id === postChoice) ? postChoice : defaultScene(search.data.after)) : null;

  const aoiStr = aoi ? aoi.join(",") : null;
  const before = useApi<RenderMeta>(pre && aoiStr ? `/api/imagery/render${qs({ item: pre, bbox: aoiStr, product })}` : null);
  const after = useApi<RenderMeta>(post && aoiStr ? `/api/imagery/render${qs({ item: post, bbox: aoiStr, product })}` : null);
  const change = useApi<DnbrMeta>(changeOn && pre && post && aoiStr ? `/api/imagery/dnbr${qs({ pre, post, bbox: aoiStr })}` : null);
  const pts = useApi<MapResponse>(
    aoiStr && date
      ? `/api/fires/map${qs({ dataset: "demo", bbox: aoiStr, zoom: 12, confidence: ["nominal", "high"] })}`
      : null,
  );

  const left = useMemo(() => (before.data ? { url: before.data.png, bounds: before.data.bounds, opacity } : null), [before.data, opacity]);
  const right = useMemo(() => (after.data ? { url: after.data.png, bounds: after.data.bounds, opacity } : null), [after.data, opacity]);
  const rightChange = useMemo(
    () => (changeOn && change.data ? { url: change.data.png, bounds: change.data.bounds, opacity: changeOpacity } : null),
    [change.data, changeOn, changeOpacity],
  );

  if (!valid) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorNote message="Missing or invalid bbox/date. Open the comparison from a cluster in the Wildfire explorer." />
        <Link href="/" className="mt-3 inline-block text-[12px] text-accent">
          ← Back to map
        </Link>
      </div>
    );
  }

  const busy = before.loading || after.loading || (changeOn && change.loading);
  return (
    <div className="absolute inset-0 flex flex-col lg:flex-row">
      <aside className="w-full shrink-0 space-y-4 overflow-y-auto border-b border-line bg-surface-0 p-3 lg:w-80 lg:border-b-0 lg:border-r">
        <Link href="/" className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-text">
          <ArrowLeft size={13} aria-hidden /> Back to wildfire map
        </Link>
        <div>
          <div className="eyebrow">Imagery comparison</div>
          <h1 className="text-[15px] font-medium">{label}</h1>
          <p className="mono mt-0.5 text-[10.5px] text-faint">
            first detection {date} · AOI {aoi ? aoi.map((v) => v.toFixed(3)).join(", ") : "…"}
          </p>
        </div>
        <ProvenanceTag kind="observed" />
        {search.error ? <ErrorNote message={search.error} onRetry={search.reload} /> : null}
        {search.loading ? <Spinner label="Searching Sentinel-2 catalogue" /> : null}
        {search.data ? (
          <div className="space-y-3">
            {search.data.before.length === 0 ? (
              <EmptyNote>No Sentinel-2 scene with &lt;{search.data.max_scene_cloud}% cloud in the 60 days before.</EmptyNote>
            ) : (
              <SceneSelect label="Before (pre-detection)" scenes={search.data.before} value={pre} onChange={setPre} />
            )}
            {search.data.after.length === 0 ? (
              <EmptyNote>No Sentinel-2 scene with &lt;{search.data.max_scene_cloud}% cloud after the first detection yet.</EmptyNote>
            ) : (
              <SceneSelect label="After" scenes={search.data.after} value={post} onChange={setPost} />
            )}
            <div>
              <div className="eyebrow mb-1">Band combination</div>
              <Segmented
                label="Band combination"
                value={product}
                onChange={setProduct}
                options={[
                  { value: "swir", label: "SWIR (B12/B8A/B4)" },
                  { value: "truecolor", label: "True colour" },
                ]}
              />
            </div>
            <div>
              <div className="eyebrow mb-1">View</div>
              <Segmented
                label="Comparison layout"
                value={mode}
                onChange={setMode}
                options={[
                  { value: "swipe", label: "Swipe" },
                  { value: "side", label: "Side by side" },
                ]}
              />
            </div>
            <label className="block">
              <span className="eyebrow">Imagery opacity {Math.round(opacity * 100)}%</span>
              <input type="range" min={0} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="w-full" />
            </label>
            <label className="flex items-center gap-2 text-[12px] text-muted">
              <input type="checkbox" checked={showPoints} onChange={(e) => setShowPoints(e.target.checked)} /> FIRMS hotspots (demo snapshot)
            </label>
            <div className="rounded-md border border-line p-2">
              <label className="flex items-center gap-2 text-[12px]">
                <input type="checkbox" checked={changeOn} onChange={(e) => setChangeOn(e.target.checked)} disabled={!pre || !post} />
                Change layer: dNBR on “after” map
              </label>
              {changeOn ? (
                <div className="mt-2 space-y-2">
                  <ProvenanceTag kind="derived" />
                  <label className="block">
                    <span className="eyebrow">Change opacity {Math.round(changeOpacity * 100)}%</span>
                    <input type="range" min={0} max={1} step={0.05} value={changeOpacity} onChange={(e) => setChangeOpacity(Number(e.target.value))} className="w-full" />
                  </label>
                  {change.error ? <ErrorNote message={change.error} onRetry={change.reload} /> : null}
                  {change.data ? <DnbrLegend meta={change.data} /> : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        {before.error ? <ErrorNote message={`Before: ${before.error}`} onRetry={before.reload} /> : null}
        {after.error ? <ErrorNote message={`After: ${after.error}`} onRetry={after.reload} /> : null}
        {before.data && after.data ? (
          <div className="text-[11px] leading-snug text-faint">
            Cloud/shadow masked (SCL) in AOI: before {fmtPct(before.data.cloud_masked_fraction, 0)}, after {fmtPct(after.data.cloud_masked_fraction, 0)}.
            Masked pixels are dimmed.
          </div>
        ) : null}
        <p className="text-[10.5px] leading-snug text-faint">
          Contains modified Copernicus Sentinel data, Sentinel-2 L2A COGs via Element 84 Earth Search (AWS Open Data). Imagery is
          fetched live and cached by the backend; nothing is synthesised. Orange rings mark FIRMS pixel centres, not fire extent.
        </p>
      </aside>
      <div className="relative min-h-[55vh] flex-1">
        {aoi ? (
          <SwipeMap
            bounds={aoi}
            left={left}
            right={right}
            rightChange={rightChange}
            points={pts.data?.mode === "points" ? pts.data.points : null}
            showPoints={showPoints}
            mode={mode}
            leftLabel={<DateTag side="Before" meta={before.data} />}
            rightLabel={<DateTag side="After" meta={after.data} />}
          />
        ) : (
          <div className="grid-bg absolute inset-0" />
        )}
        {busy ? (
          <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-md bg-surface-2/95 px-3 py-1.5">
            <Spinner label="Reading Sentinel-2 COGs (first render can take 5–15 s)" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DnbrLegend({ meta }: { meta: DnbrMeta }) {
  return (
    <div className="space-y-1 text-[11px]">
      <div className="eyebrow">dNBR classes (Key &amp; Benson 2006)</div>
      <ul className="space-y-0.5">
        {meta.classes
          .filter((c) => c.label !== "Unburned / no change")
          .map((c) => (
            <li key={c.label} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: `rgba(${c.rgba[0]},${c.rgba[1]},${c.rgba[2]},${c.rgba[3] / 255})` }} />
              <span className="flex-1 text-muted">{c.label}</span>
              <span className="mono">{fmtNum(c.area_km2, 1)} km²</span>
            </li>
          ))}
      </ul>
      <p className="text-faint">
        Valid (cloud-free in both) {fmtPct(meta.valid_fraction, 0)} of AOI. {meta.caveat}
      </p>
    </div>
  );
}
