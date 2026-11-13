"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, getJSON } from "./api";

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** True while a refetch is running and stale data is still displayed. */
  refreshing: boolean;
}

interface Settled<T> {
  key: string | null;
  data: T | null;
  error: string | null;
}

/**
 * Fetch JSON for `url`, aborting stale requests when `url` changes.
 * Pass `null` to skip. Previous data stays visible during refetches.
 * Loading flags are derived from whether the last settled request matches the current key,
 * so no state is set synchronously inside the effect.
 */
export function useApi<T>(url: string | null, deps: unknown[] = []): AsyncState<T> & { reload: () => void } {
  const [nonce, setNonce] = useState(0);
  const [settled, setSettled] = useState<Settled<T>>({ key: null, data: null, error: null });
  const key = url ? `${url}#${nonce}#${JSON.stringify(deps)}` : null;

  useEffect(() => {
    if (!url || !key) return;
    const ctrl = new AbortController();
    getJSON<T>(url, ctrl.signal)
      .then((data) => setSettled({ key, data, error: null }))
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        const msg = e instanceof ApiError ? e.message : "Unexpected error while loading data.";
        setSettled((s) => ({ key, data: s.data, error: msg }));
      });
    return () => ctrl.abort();
  }, [url, key]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  if (!url) return { data: null, error: null, loading: false, refreshing: false, reload };
  const done = settled.key === key;
  return {
    data: settled.data,
    error: done ? settled.error : null,
    loading: !done && settled.data === null,
    refreshing: !done && settled.data !== null,
    reload,
  };
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
