"use client";

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ComposedChart, Tooltip, XAxis, YAxis } from "recharts";
import { useApi } from "@/lib/hooks";
import { fmtInt, fmtNum, fmtUtc } from "@/lib/format";
import { ErrorNote, ProvenanceTag, Section, Spinner } from "@/components/ui";

const tick = { fill: "#62718b", fontSize: 10, fontFamily: "var(--font-plex-mono)" };
const tooltipStyle = { background: "#131d31", border: "1px solid #2b3b5a", borderRadius: 8, fontSize: 11 };

interface MethodScores {
  precision: number;
  recall: number;
  f1: number;
  iou: number;
  accuracy: number;
  kappa: number;
  support_water: number;
  support_total: number;
  confusion_matrix: number[][];
  ci95: Record<string, [number, number]>;
}
type Block = Record<string, MethodScores> & { reliability?: { bins: { mean_prob: number; observed_freq: number; count: number }[]; ece: number; brier: number }; threshold_selection?: { grid: number[]; oof_f1: number[]; selected: number; note: string } };
interface Card {
  generated_utc: string;
  model: { task: string; dataset: string; classifier: string; params: Record<string, unknown>; feature_names: string[]; samples_per_chip: number; sklearn_version: string };
  protocol: { holdout_events: string[]; loeo_events: string[]; threshold_loeo: number; threshold_final: number; threshold_history: string; metric_unit: string };
  loeo: Block;
  loeo_per_event: Record<string, number | string>[];
  bolivia_holdout: Block;
  official_random_split: Block | null;
  permutation_importance_bolivia: { feature: string; mean: number; std: number }[];
}

const METHOD_LABEL: Record<string, string> = {
  model: "TerraWatch HGB model",
  "model_at_0.5": "HGB model @ 0.5 (pre-registered)",
  fixed: "Fixed VV threshold (fit on train events)",
  otsu: "Per-chip Otsu on VV",
  otsu_published: "Published Otsu masks (scene-level)",
};
const METHOD_COLOR: Record<string, string> = { model: "#c084fc", fixed: "#38bdf8", otsu: "#fbbf24", otsu_published: "#34d399" };

function methods(b: Block) {
  return Object.keys(b).filter((k) => k in METHOD_LABEL);
}

function ScoreTable({ block, caption }: { block: Block; caption: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-[12px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-faint">
            <th className="py-1 text-left font-normal">Method</th>
            <th className="text-right font-normal">Precision</th>
            <th className="text-right font-normal">Recall</th>
            <th className="text-right font-normal">F1 (95% CI)</th>
            <th className="text-right font-normal">IoU (95% CI)</th>
            <th className="text-right font-normal">κ</th>
          </tr>
        </thead>
        <tbody>
          {methods(block).map((k) => {
            const m = block[k] as MethodScores;
            return (
              <tr key={k} className={k === "model" ? "text-text" : "text-muted"}>
                <td className="py-1 pr-3">
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: METHOD_COLOR[k] ?? "#94a3b8" }} />
                  {METHOD_LABEL[k]}
                </td>
                <td className="mono text-right">{fmtNum(m.precision, 3)}</td>
                <td className="mono text-right">{fmtNum(m.recall, 3)}</td>
                <td className="mono text-right">
                  {fmtNum(m.f1, 3)} <span className="text-faint">[{fmtNum(m.ci95?.f1?.[0], 2)}–{fmtNum(m.ci95?.f1?.[1], 2)}]</span>
                </td>
                <td className="mono text-right">
                  {fmtNum(m.iou, 3)} <span className="text-faint">[{fmtNum(m.ci95?.iou?.[0], 2)}–{fmtNum(m.ci95?.iou?.[1], 2)}]</span>
                </td>
                <td className="mono text-right">{fmtNum(m.kappa, 3)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Confusion({ m, title }: { m: MethodScores; title: string }) {
  const [[tn, fp], [fn, tp]] = m.confusion_matrix;
  const tot = tn + fp + fn + tp;
  const cell = (v: number, label: string, cls: string) => (
    <div className={`rounded p-2 text-center ${cls}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="mono text-[13px]">{fmtInt(v)}</div>
      <div className="mono text-[10px] opacity-70">{((100 * v) / tot).toFixed(1)}%</div>
    </div>
  );
  return (
    <figure>
      <figcaption className="eyebrow mb-1.5">{title}</figcaption>
      <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-1 text-[11px]">
        <span />
        <span className="text-center text-faint">pred. dry</span>
        <span className="text-center text-faint">pred. water</span>
        <span className="pr-1 text-right text-faint">ref. dry</span>
        {cell(tn, "TN", "bg-surface-2")}
        {cell(fp, "FP", "bg-err/10 text-err")}
        <span className="pr-1 text-right text-faint">ref. water</span>
        {cell(fn, "FN", "bg-warn/10 text-warn")}
        {cell(tp, "TP", "bg-ok/10 text-ok")}
      </div>
    </figure>
  );
}

export default function ModelView() {
  const card = useApi<Card>("/api/ml/model-card");
  if (card.error) return <div className="mx-auto max-w-xl p-6"><ErrorNote message={card.error} onRetry={card.reload} /></div>;
  if (!card.data) return <div className="p-6"><Spinner label="Loading evaluation report" /></div>;
  const c = card.data;
  const perEvent = c.loeo_per_event.map((r) => ({
    event: String(r.event),
    model: r.model_f1 as number,
    fixed: r.fixed_f1 as number,
    otsu: r.otsu_f1 as number,
    otsu_published: r.otsu_published_f1 as number,
  }));
  const rel = c.loeo.reliability;
  const thr = c.loeo.threshold_selection;
  const bol = c.bolivia_holdout;
  const loeoModel = c.loeo.model as MethodScores;
  const bolModel = bol.model as MethodScores;
  const bolFixed = bol.fixed as MethodScores;
  const bolPub = bol.otsu_published as MethodScores | undefined;
  const worst = [...perEvent].sort((a, b) => a.model - b.model).slice(0, 2);

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-4 p-3 sm:p-5">
        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow">Model card</span>
            <ProvenanceTag kind="ai" />
          </div>
          <h1 className="text-xl font-medium">Sentinel-1 SAR surface-water segmentation</h1>
          <p className="max-w-3xl text-[12.5px] leading-relaxed text-muted">
            {c.model.task}. Trained on the <b className="text-text">{c.model.dataset}</b> with a{" "}
            <span className="mono">{c.model.classifier.split(".").pop()}</span> over {c.model.feature_names.length} engineered
            per-pixel features ({c.model.samples_per_chip.toLocaleString()} sampled pixels per chip). Report generated{" "}
            {fmtUtc(c.generated_utc)} by <span className="mono">ml/scripts/train.py</span>; all values below are read from{" "}
            <span className="mono">ml/reports/metrics.json</span>.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Headline label="Leave-one-event-out F1 (10 events)" v={loeoModel.f1} ci={loeoModel.ci95.f1} note={`IoU ${fmtNum(loeoModel.iou, 3)} · threshold ${c.protocol.threshold_loeo}`} />
          <Headline label={`Bolivia hold-out F1 (threshold ${c.protocol.threshold_final})`} v={bolModel.f1} ci={bolModel.ci95.f1} note={`IoU ${fmtNum(bolModel.iou, 3)} · precision ${fmtNum(bolModel.precision, 2)} · recall ${fmtNum(bolModel.recall, 2)}`} />
          <Headline label="Bolivia: best baseline F1" v={Math.max(bolFixed.f1, bolPub?.f1 ?? 0)} ci={(bolPub && bolPub.f1 > bolFixed.f1 ? bolPub : bolFixed).ci95.f1} note={bolPub && bolPub.f1 > bolFixed.f1 ? "published scene-level Otsu" : "fixed VV threshold"} muted />
        </div>

        <Section title="1 · Leave-one-event-out cross-validation (primary result)">
          <p className="mb-2 text-[12px] text-muted">
            Each of the {c.protocol.loeo_events.length} development events is predicted by a model trained only on the other events.
            Pixels pooled across events; CI from a 1000× bootstrap over chips. {c.protocol.metric_unit}.
          </p>
          <ScoreTable block={c.loeo} caption="Leave-one-event-out scores" />
        </Section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Section title="F1 by held-out event">
            <div style={{ height: 260 }} role="img" aria-label="F1 per held-out event for the model and baselines">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={perEvent} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke="#1f2c45" strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="event" tick={tick} axisLine={false} tickLine={false} interval={0} angle={-30} textAnchor="end" height={48} />
                  <YAxis tick={tick} domain={[0, 1]} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNum(Number(v), 3), METHOD_LABEL[String(n)] ?? n]} />
                  <Legend wrapperStyle={{ fontSize: 10.5 }} formatter={(v) => METHOD_LABEL[String(v)] ?? v} />
                  {(["model", "otsu_published", "fixed", "otsu"] as const).map((k) => (
                    <Bar key={k} dataKey={k} fill={METHOD_COLOR[k]} isAnimationActive={false} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Section>
          <Section title="Confusion matrices (pixels)">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Confusion m={loeoModel} title="LOEO pooled · model" />
              <Confusion m={bolModel} title="Bolivia hold-out · model" />
            </div>
          </Section>
        </div>

        <Section title="2 · Out-of-distribution test: Bolivia (never used for training or selection)">
          <ScoreTable block={bol} caption="Bolivia hold-out scores" />
          <p className="mt-2 text-[11.5px] leading-relaxed text-muted">{c.protocol.threshold_history}</p>
        </Section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {rel ? (
            <Section title={`Calibration · LOEO out-of-fold (ECE ${fmtNum(rel.ece, 3)}, Brier ${fmtNum(rel.brier, 3)})`}>
              <div style={{ height: 230 }} role="img" aria-label="Reliability diagram">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={rel.bins} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                    <CartesianGrid stroke="#1f2c45" strokeDasharray="2 4" />
                    <XAxis type="number" dataKey="mean_prob" domain={[0, 1]} tick={tick} name="predicted" />
                    <YAxis type="number" domain={[0, 1]} tick={tick} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtNum(Number(v), 3)} />
                    <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="#62718b" strokeDasharray="4 4" />
                    <Line dataKey="observed_freq" stroke="#c084fc" dot={{ r: 3 }} isAnimationActive={false} />
                    <Scatter dataKey="observed_freq" fill="#c084fc" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[11px] text-faint">Predicted P(water) (x) vs observed water frequency (y). Diagonal = perfect calibration.</p>
            </Section>
          ) : null}
          {thr ? (
            <Section title={`Decision threshold selection (selected ${thr.selected})`}>
              <div style={{ height: 230 }} role="img" aria-label="Out-of-fold F1 by decision threshold">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={thr.grid.map((t, i) => ({ t, f1: thr.oof_f1[i] }))} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                    <CartesianGrid stroke="#1f2c45" strokeDasharray="2 4" />
                    <XAxis dataKey="t" tick={tick} type="number" domain={[0, 1]} />
                    <YAxis tick={tick} domain={["auto", "auto"]} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtNum(Number(v), 3)} />
                    <ReferenceLine x={thr.selected} stroke="#c084fc" strokeDasharray="3 3" />
                    <ReferenceLine x={0.5} stroke="#62718b" strokeDasharray="2 4" />
                    <Line dataKey="f1" stroke="#38bdf8" dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[11px] text-faint">{thr.note}. Bolivia was not used.</p>
            </Section>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Section title="Permutation importance on Bolivia (Δ F1 when shuffled)">
            <div style={{ height: 260 }} role="img" aria-label="Permutation feature importance">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={c.permutation_importance_bolivia.slice(0, 10)} margin={{ top: 0, right: 8, bottom: 0, left: 30 }}>
                  <XAxis type="number" tick={tick} />
                  <YAxis type="category" dataKey="feature" tick={tick} width={90} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtNum(Number(v), 4)} />
                  <Bar dataKey="mean" fill="#c084fc" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Section>
          <Section title="Known failure modes (from the evaluation)">
            <ul className="list-disc space-y-1.5 pl-4 text-[12px] leading-snug text-muted">
              <li>
                Weakest held-out events: <b className="text-text">{worst.map((w) => `${w.event} (F1 ${fmtNum(w.model, 2)}, precision ${fmtNum(c.loeo_per_event.find((r) => r.event === w.event)?.model_precision as number, 2)})`).join(", ")}</b>.
                Low precision means false positives; in these arid scenes, dry sand and smooth bare soil are radar-dark like open water.
              </li>
              <li>
                Bolivia: precision {fmtNum(bolModel.precision, 2)} but recall {fmtNum(bolModel.recall, 2)}. The model misses water there.
                A likely cause is flooded vegetation, whose double-bounce returns are bright rather than dark.
                Under-confidence on Bolivia is also visible: out-of-distribution ECE {fmtNum(bol.reliability?.ece, 3)} vs {fmtNum(rel?.ece, 3)} in cross-validation.
              </li>
              <li>Wind-roughened or shallow water, radar shadow in steep terrain and urban flooding are not modelled. No DEM/HAND input is used.</li>
              <li>
                The published scene-level Otsu masks (thresholds computed on whole Sentinel-1 scenes, i.e. more context than a 5 km chip) are a
                strong baseline: the model leads in pooled cross-validation (F1 {fmtNum(loeoModel.f1, 3)} vs {fmtNum((c.loeo.otsu_published as MethodScores | undefined)?.f1, 3)})
                but is clearly beaten on Bolivia (F1 {fmtNum(bolModel.f1, 3)} vs {fmtNum(bolPub?.f1, 3)}).
              </li>
              <li>Labels are 10 m human interpretations at one date per event; there is no temporal pre/post change detection in this model.</li>
            </ul>
          </Section>
        </div>

        {c.official_random_split ? (
          <Section title="3 · Official random split (optimistic; for literature comparison only)">
            <p className="mb-2 text-[12px] text-muted">
              The official Sen1Floods11 train/test split places chips from the same events on both sides, so spatially adjacent chips leak
              information. These scores are expected to overstate generalisation.
            </p>
            <ScoreTable block={c.official_random_split} caption="Official random split scores" />
          </Section>
        ) : null}

        <Section title="Reproduce">
          <pre className="mono overflow-x-auto rounded-md bg-surface-0 p-3 text-[11.5px] text-muted">
{`python ml/scripts/download_sen1floods11.py --out ml/data/sen1floods11   # ~720 MB, public bucket
python ml/scripts/train.py --data ml/data/sen1floods11                 # ~15 min on 8 CPU cores
python ml/scripts/export_flood_demo.py                                 # app demo chips`}
          </pre>
          <p className="mt-2 text-[11px] text-faint">
            Hyper-parameters (fixed a priori, no tuning on test data): {Object.entries(c.model.params).map(([k, v]) => `${k}=${v}`).join(", ")}. scikit-learn {c.model.sklearn_version}.
          </p>
        </Section>
      </div>
    </div>
  );
}

function Headline({ label, v, ci, note, muted }: { label: string; v: number; ci?: [number, number]; note: string; muted?: boolean }) {
  return (
    <div className="panel-flat p-3">
      <div className="eyebrow">{label}</div>
      <div className={`mono mt-1 text-2xl ${muted ? "text-muted" : "text-ai"}`}>{fmtNum(v, 3)}</div>
      <div className="mono text-[11px] text-faint">95% CI {ci ? `${fmtNum(ci[0], 3)}–${fmtNum(ci[1], 3)}` : "—"}</div>
      <div className="mt-1 text-[11px] text-muted">{note}</div>
    </div>
  );
}
