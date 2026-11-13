"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MapPin, Search } from "lucide-react";
import { getJSON, qs } from "@/lib/api";
import { useDebounced } from "@/lib/hooks";

interface Result {
  name: string;
  kind: string;
  bbox: [number, number, number, number];
  lat: number;
  lon: number;
  source: string;
  iso3?: string;
}

/** Place search (Natural Earth countries locally, then OSM Nominatim via the backend). */
export function SearchBox({ onSelect }: { onSelect: (r: Result) => void }) {
  const [q, setQ] = useState("");
  const [resp, setResp] = useState<{ q: string; results: Result[]; status: string | null }>({ q: "", results: [], status: null });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const dq = useDebounced(q.trim(), 450);
  // Results/status are derived from the last response that matches the current query.
  const searching = dq.length >= 2 && resp.q !== dq;
  const results = dq.length >= 2 && resp.q === dq ? resp.results : [];
  const status = dq.length < 2 ? null : searching ? "Searching…" : resp.status;
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (dq.length < 2) return;
    const ctrl = new AbortController();
    getJSON<{ results: Result[]; remote_status: string }>(`/api/geocode${qs({ q: dq })}`, ctrl.signal)
      .then((r) => {
        setResp({
          q: dq,
          results: r.results,
          status: r.results.length ? null : r.remote_status === "error" ? "Online search unavailable; no local match." : "No places found.",
        });
        setActive(0);
        setOpen(true);
      })
      .catch((e) => {
        if ((e as Error).name !== "AbortError") setResp({ q: dq, results: [], status: "Search failed." });
      });
    return () => ctrl.abort();
  }, [dq]);

  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function choose(r: Result) {
    onSelect(r);
    setQ(r.name.split(",")[0]);
    setOpen(false);
  }

  return (
    <div ref={box} className="relative w-full">
      <div className="panel flex items-center gap-2 px-2.5 py-1.5">
        <Search size={14} className="text-faint" aria-hidden />
        <input
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Search for a place or country"
          placeholder="Search a place or country…"
          value={q}
          maxLength={120}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
            else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
            else if (e.key === "Enter" && results[active]) choose(results[active]);
            else if (e.key === "Escape") setOpen(false);
          }}
          className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-faint"
        />
      </div>
      {open && results.length > 0 ? (
        <ul id={listId} role="listbox" className="panel absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-auto p-1">
          {results.map((r, i) => (
            <li
              key={`${r.name}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(r);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-[12px] ${i === active ? "bg-surface-3" : ""}`}
            >
              <MapPin size={12} className="mt-0.5 shrink-0 text-accent" aria-hidden />
              <span className="min-w-0">
                <span className="block truncate">{r.name}</span>
                <span className="block text-[10.5px] text-faint">
                  {r.kind} · {r.source}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {status && q.trim().length >= 2 ? <div className="mt-1 text-[11px] text-faint">{status}</div> : null}
    </div>
  );
}
