"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import clsx from "clsx";
import { Upload } from "lucide-react";
import { useApi } from "@/lib/hooks";
import type { ChipStats, FloodChip, Scores } from "@/lib/types";
import { fmtInt, fmtNum, fmtPct } from "@/lib/format";
import { EmptyNote, ErrorNote, KeyValue, ProvenanceTag, Section, Segmented, Spinner } from "@/components/ui";

const SwipeMap = dynamic(() => import("@/components/map/SwipeMap"), { ssr: false, loading: () => <Spinner label="Initialising maps" /> });

type Base = "sar" | "optical";
type LeftOverlay = "none" | "reference" | "otsu" | "permanent_water";
type RightOverlay = "probability" | "predicted" | "inferred_flood" | "errors" | "uncertainty";

const RIGHT_OPTS: { value: RightOverlay; label: string; help: string }[] = [
  { value: "probability", label: "P(water)", help: "Model probability of open water, 0.1–1 (transparent below 0.1)." },
  { value: "predicted", label: "Predicted water", help: "Pixels with P(water) ≥ the model's decision threshold." },
  { value: "inferred_flood", label: "Inferred flood", help: "Predicted water minus JRC permanent water. An inference, not an observation." },
  { value: "errors", label: "Errors vs reference", help: "Green = agrees on water, red = false positive, amber = missed water (vs hand labels)." },
  { value: "uncertainty", label: "Uncertainty", help: "Magenta intensity = 1 − |2p − 1|; brightest where P(water) ≈ 0.5." },
];
const LEFT_OPTS: { value: LeftOverlay; label: string }[] = [
  { value: "reference", label: "Hand labels" },
  { value: "otsu", label: "Otsu baseline" },
  { value: "permanent_water", label: "JRC permanent" },
  { value: "none", label: "None" },
];

function layerUrl(chip: string, layer: string) {
  return `/api/flood/chips/${encodeURIComponent(chip)}/layers/${layer}.png`;
}

export default function FloodView() {
  const chips = useApi<{ chips: FloodChip[] }>("/api/flood/chips");
  const [sel, setSel] = useState<string | null>(null);
  const list = chips.data?.chips ?? [];
  const chip = list.find((c) => c.chip_id === sel) ?? list[0] ?? null;
  const stats = useApi<{ chip: FloodChip; stats: ChipStats }>(chip ? `/api/flood/chips/${chip.chip_id}` : null);
  const [leftBase, setLeftBase] = useState<Base>("sar");
  const [rightBase, setRightBase] = useState<Base>("sar");
  const [leftOv, setLeftOv] = useState<LeftOverlay>("reference");
  const [rightOv, setRightOv] = useState<RightOverlay>("predicted");
  const [opacity, setOpacity] = useState(0.85);
  const [mode, setMode] = useState<"swipe" | "side">("swipe");
  const [upload, setUpload] = useState<{ png: string; stats: Record<string, unknown> & { bounds: [number, number, number, number] } } | null>(null);

  const ready = !!chip && !!stats.data; // overlays are rendered only after the model has run
  const ov = useMemo(() => {
    if (!chip) return null;
    const b = chip.bbox;
    const base = (k: Base) => ({ url: layerUrl(chip.chip_id, k === "sar" ? "sar" : "optical"), bounds: b, opacity: 1 });
    return {
      left: base(leftBase),
      right: base(rightBase),
      leftChange: ready && leftOv !== "none" ? { url: layerUrl(chip.chip_id, leftOv), bounds: b, opacity } : null,
      rightChange: ready ? { url: layerUrl(chip.chip_id, rightOv), bounds: b, opacity } : null,
    };
  }, [chip, leftBase, rightBase, leftOv, rightOv, opacity, ready]);

  if (chips.error) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <ErrorNote message={chips.error} onRetry={chips.reload} />
      </div>
    );
  }

  const holdout = list.filter((c) => c.role === "holdout");
  const loeo = list.filter((c) => c.role === "loeo");
  const s = stats.data?.stats;

  return (
    <div className="absolute inset-0 flex flex-col lg:flex-row">
      <aside className="max-h-[32vh] w-full shrink-0 overflow-y-auto border-b border-line bg-surface-0 p-3 lg:max-h-none lg:w-64 lg:border-b-0 lg:border-r" aria-label="Flood chips">
        <div className="eyebrow">Flood module</div>
        <h1 className="text-[15px] font-medium">Sentinel-1 SAR surface water</h1>
        <p className="mt-1 text-[11.5px] leading-snug text-muted">
          Real Sen1Floods11 chips (5 × 5 km, 10 m). Every chip is scored by a model that never saw its flood event.
        </p>
        {chips.loading ? <div className="mt-3"><Spinner /></div> : null}
        <ChipGroup title="Held-out test event — final model" chips={holdout} sel={chip?.chip_id} onSel={setSel} />
        <ChipGroup title="Cross-validation events — fold model" chips={loeo} sel={chip?.chip_id} onSel={setSel} />
      </aside>

      <div className="relative min-h-[50vh] flex-1">
        {chip && ov ? (
          <SwipeMap
            bounds={upload ? upload.stats.bounds : chip.bbox}
            left={upload ? null : ov.left}
            right={upload ? null : ov.right}
            leftChange={upload ? null : ov.leftChange}
            rightChange={upload ? { url: upload.png, bounds: upload.stats.bounds, opacity } : ov.rightChange}
            points={null}
            showPoints={false}
            mode={mode}
            leftLabel={<MapTag side="Left" text={upload ? "Basemap" : `${leftBase === "sar" ? "S1 VV" : "S2 optical"} + ${LEFT_OPTS.find((o) => o.value === leftOv)?.label}`} />}
            rightLabel={<MapTag side="Right" text={upload ? "Uploaded scene · P(water)" : `${rightBase === "sar" ? "S1 VV" : "S2 optical"} + ${RIGHT_OPTS.find((o) => o.value === rightOv)?.label}`} ai />}
          />
        ) : (
          <div className="grid-bg absolute inset-0" />
        )}
        {stats.loading ? (
          <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-md bg-surface-2/95 px-3 py-1.5">
            <Spinner label="Running model on chip" />
          </div>
        ) : null}
        <div className="panel absolute bottom-3 left-3 right-3 flex flex-wrap items-end gap-x-4 gap-y-2 p-2.5 text-[11.5px] sm:right-auto">
          <div>
            <div className="eyebrow mb-1">Left</div>
            <div className="flex gap-1.5">
              <Segmented label="Left base image" value={leftBase} onChange={setLeftBase} options={[{ value: "sar", label: "SAR" }, { value: "optical", label: "Optical" }]} />
              <select aria-label="Left overlay" value={leftOv} onChange={(e) => setLeftOv(e.target.value as LeftOverlay)} className="rounded-md border border-line bg-surface-1 px-1.5 text-[11.5px]">
                {LEFT_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <div className="eyebrow mb-1">Right (model)</div>
            <div className="flex gap-1.5">
              <Segmented label="Right base image" value={rightBase} onChange={setRightBase} options={[{ value: "sar", label: "SAR" }, { value: "optical", label: "Optical" }]} />
              <select aria-label="Right overlay" value={rightOv} onChange={(e) => setRightOv(e.target.value as RightOverlay)} className="rounded-md border border-line bg-surface-1 px-1.5 text-[11.5px]">
                {RIGHT_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <label>
            <span className="eyebrow">Overlay {Math.round(opacity * 100)}%</span>
            <input type="range" min={0} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="block w-28" />
          </label>
          <Segmented label="Layout" value={mode} onChange={setMode} options={[{ value: "swipe", label: "Swipe" }, { value: "side", label: "Side" }]} />
          <p className="basis-full text-[10.5px] text-faint">{RIGHT_OPTS.find((o) => o.value === rightOv)?.help}</p>
        </div>
      </div>

      <aside className="max-h-[60vh] w-full shrink-0 space-y-3 overflow-y-auto border-t border-line bg-surface-0 p-3 lg:max-h-none lg:w-[22rem] lg:border-l lg:border-t-0" aria-label="Chip analysis">
        {chip ? (
          <>
            <div>
              <div className="eyebrow">{chip.role === "holdout" ? "Held-out test chip" : "Cross-validation chip"}</div>
              <h2 className="text-[15px] font-medium">{chip.country} · {chip.chip_id.split("_")[1]}</h2>
              <div className="mono text-[10.5px] text-faint">Sentinel-1 acquisition {chip.date ?? "n/a"} · official split “{chip.official_split}”</div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <ProvenanceTag kind="observed" />
              <ProvenanceTag kind="ai" />
              <ProvenanceTag kind="reference" />
            </div>
            {stats.error ? <ErrorNote message={stats.error} onRetry={stats.reload} /> : null}
            {s ? <ChipMetrics s={s} /> : stats.loading ? <div className="skeleton h-48" /> : null}
          </>
        ) : null}
        <UploadPanel onResult={setUpload} active={!!upload} />
        <p className="text-[10.5px] leading-snug text-faint">
          Experimental research output. Do not use for evacuation, insurance or any operational decision. Reference labels are
          human interpretations of satellite imagery, not field surveys.
        </p>
      </aside>
    </div>
  );
}

function MapTag({ side, text, ai }: { side: string; text: string; ai?: boolean }) {
  return (
    <div className={clsx("panel px-2 py-1 text-[11px]", ai && "border-ai/40")}>
      <div className="eyebrow">{side}</div>
      <div className={ai ? "text-ai" : undefined}>{text}</div>
    </div>
  );
}

function ChipGroup({ title, chips, sel, onSel }: { title: string; chips: FloodChip[]; sel?: string; onSel: (id: string) => void }) {
  if (!chips.length) return null;
  return (
    <div className="mt-4">
      <div className="eyebrow mb-1.5">{title}</div>
      <ul className="space-y-0.5">
        {chips.map((c) => (
          <li key={c.chip_id}>
            <button
              type="button"
              onClick={() => onSel(c.chip_id)}
              aria-pressed={sel === c.chip_id}
              className={clsx(
                "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[12px]",
                sel === c.chip_id ? "bg-accent/10 text-text ring-1 ring-accent/40" : "text-muted hover:bg-surface-2",
              )}
            >
              <span className="truncate">{c.role === "holdout" ? c.chip_id.replace("_", " #") : c.country}</span>
              <span className="mono text-[10.5px] text-faint" title="Hand-labelled water fraction">
                {fmtPct(c.reference_water_fraction, 0)} water
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScoreRow({ name, s, highlight }: { name: string; s?: Scores; highlight?: boolean }) {
  return (
    <tr className={highlight ? "text-text" : "text-muted"}>
      <td className="py-0.5 pr-2">{name}</td>
      {(["precision", "recall", "f1", "iou"] as const).map((k) => (
        <td key={k} className="mono py-0.5 text-right">{s ? fmtNum(s[k], 3) : "—"}</td>
      ))}
    </tr>
  );
}

function ChipMetrics({ s }: { s: ChipStats }) {
  const cm = s.model_vs_reference?.confusion_matrix;
  return (
    <div className="space-y-3">
      <Section title="Agreement with hand labels (this chip)">
        {s.reference_water_km2 !== undefined && s.reference_water_km2 < 0.01 ? (
          <EmptyNote>The reference shows (almost) no water here, so precision/recall are undefined; check false positives on the error map.</EmptyNote>
        ) : null}
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="text-faint">
              <th className="text-left font-normal">Method</th>
              <th className="text-right font-normal">Prec.</th>
              <th className="text-right font-normal">Recall</th>
              <th className="text-right font-normal">F1</th>
              <th className="text-right font-normal">IoU</th>
            </tr>
          </thead>
          <tbody>
            <ScoreRow name="Model (HGB)" s={s.model_vs_reference} highlight />
            <ScoreRow name="Otsu baseline" s={s.otsu_vs_reference} />
          </tbody>
        </table>
        {cm ? (
          <div className="mt-2 grid grid-cols-2 gap-1 text-center text-[10.5px]" aria-label="Confusion matrix (pixels)">
            <div className="rounded bg-surface-2 p-1">TN <span className="mono block text-text">{fmtInt(cm[0][0])}</span></div>
            <div className="rounded bg-err/10 p-1 text-err">FP <span className="mono block">{fmtInt(cm[0][1])}</span></div>
            <div className="rounded bg-warn/10 p-1 text-warn">FN <span className="mono block">{fmtInt(cm[1][0])}</span></div>
            <div className="rounded bg-ok/10 p-1 text-ok">TP <span className="mono block">{fmtInt(cm[1][1])}</span></div>
          </div>
        ) : null}
        <p className="mt-2 text-[10.5px] text-faint">
          Single-chip scores are noisy; see the Model page for event-level results with confidence intervals.
        </p>
      </Section>
      <Section title="Areas (km²)">
        <KeyValue
          rows={[
            ["Predicted water", fmtNum(s.predicted_water_km2, 2)],
            ["  of which JRC permanent", fmtNum(s.permanent_water_km2, 2)],
            ["Inferred flood extent", fmtNum(s.inferred_flood_km2, 2)],
            ["Hand-labelled water", fmtNum(s.reference_water_km2, 2)],
            ["Otsu baseline water", fmtNum(s.otsu_water_km2, 2)],
          ]}
        />
      </Section>
      <Section title="Model & uncertainty">
        <KeyValue
          rows={[
            ["Model", s.model.role === "final" ? "final (all 10 dev events)" : s.model.role],
            ["Decision threshold", fmtNum(s.model.threshold, 3)],
            ["Never trained on", s.model.excluded_events.join(", ")],
            ["Uncertain pixels", `${fmtPct(s.uncertain_fraction, 1)} (P in ${s.uncertainty_band[0]}–${s.uncertainty_band[1]})`],
            ["Mean P in predicted", fmtNum(s.mean_probability_in_predicted, 3)],
            ["Valid SAR pixels", fmtPct(s.valid_fraction, 0)],
          ]}
        />
      </Section>
    </div>
  );
}

function UploadPanel({ onResult, active }: { onResult: (r: { png: string; stats: Record<string, unknown> & { bounds: [number, number, number, number] } } | null) => void; active: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<Record<string, unknown> | null>(null);
  async function send(file: File) {
    setErr(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/flood/predict", { method: "POST", body: fd });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof body.detail === "string" ? body.detail : `Upload failed (HTTP ${r.status})`);
      onResult({ png: body.probability_png, stats: body.stats });
      setInfo(body.stats);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title="Run on your own Sentinel-1 GeoTIFF">
      <p className="mb-2 text-[11px] leading-snug text-muted">
        2 bands (VV, VH) in σ⁰ dB, ≤ 2048 px per side, ≤ 25 MB. Processed in memory and not stored.
      </p>
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-line-strong px-3 py-3 text-[12px] text-muted hover:border-accent hover:text-text">
        <Upload size={14} aria-hidden /> {busy ? "Running model…" : "Choose GeoTIFF"}
        <input type="file" accept=".tif,.tiff,image/tiff" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && send(e.target.files[0])} />
      </label>
      {err ? <div className="mt-2"><ErrorNote message={err} /></div> : null}
      {active && info ? (
        <div className="mt-2 space-y-1 text-[11px]">
          <ProvenanceTag kind="ai" />
          <KeyValue rows={[["Predicted water", `${fmtNum(info.predicted_water_km2 as number, 2)} km²`], ["Uncertain", fmtPct(info.uncertain_fraction as number, 1)]]} />
          {(info.warnings as string[]).map((w) => <div key={w} className="text-warn">{w}</div>)}
          <p className="text-faint">{String(info.caveat)}</p>
          <button className="text-accent underline" onClick={() => { onResult(null); setInfo(null); }}>Back to demo chips</button>
        </div>
      ) : null}
    </Section>
  );
}
