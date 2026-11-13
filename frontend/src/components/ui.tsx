"use client";

import clsx from "clsx";
import { AlertTriangle, BrainCircuit, Info, Loader2, Satellite } from "lucide-react";
import type { ReactNode } from "react";

export function Stat({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: string }) {
  return (
    <div className="min-w-0">
      <div className="eyebrow truncate">{label}</div>
      <div className="mono mt-0.5 truncate text-[19px] font-medium leading-tight" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      {sub ? <div className="mt-0.5 truncate text-[11px] text-faint">{sub}</div> : null}
    </div>
  );
}

export function Section({ title, right, children, className }: { title: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx("panel-flat p-3", className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="eyebrow">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-[12px] text-muted">
      <Loader2 size={14} className="animate-spin" aria-hidden />
      {label}
    </span>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-err/30 bg-err/10 p-2.5 text-[12px] text-err">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-text/90">{message}</div>
        {onRetry ? (
          <button onClick={onRetry} className="mt-1 text-[11.5px] font-medium text-accent hover:underline">
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-line bg-surface-2/60 p-2.5 text-[12px] text-muted">
      <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

/** Visual provenance tag: observed satellite data vs experimental model output vs derived algorithm. */
export function ProvenanceTag({ kind, className }: { kind: "observed" | "ai" | "derived" | "reference"; className?: string }) {
  const cfg = {
    observed: { label: "Observed satellite data", cls: "border-accent/40 bg-accent/10 text-accent", Icon: Satellite },
    ai: { label: "Experimental AI prediction", cls: "border-ai/40 bg-ai/10 text-ai", Icon: BrainCircuit },
    derived: { label: "Derived (algorithmic, not ML)", cls: "border-warn/40 bg-warn/10 text-warn", Icon: Info },
    reference: { label: "Human reference labels", cls: "border-ok/40 bg-ok/10 text-ok", Icon: Info },
  }[kind];
  const { Icon } = cfg;
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium", cfg.cls, className)}>
      <Icon size={11} aria-hidden />
      {cfg.label}
    </span>
  );
}

export function KeyValue({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-faint">{k}</dt>
          <dd className="mono min-w-0 truncate text-right text-text/90" title={typeof v === "string" ? v : undefined}>
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Toggle({
  pressed,
  onClick,
  children,
  title,
  color,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
  color?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      title={title}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] transition-colors",
        pressed ? "border-line-strong bg-surface-3 text-text" : "border-line bg-transparent text-faint hover:text-muted",
      )}
    >
      {color ? <span className="h-2 w-2 rounded-full" style={{ background: pressed ? color : "transparent", border: `1px solid ${color}` }} /> : null}
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line bg-surface-1 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "rounded px-2 py-1 text-[11.5px] transition-colors",
            value === o.value ? "bg-surface-3 text-text" : "text-faint hover:text-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
