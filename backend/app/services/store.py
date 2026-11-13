"""In-process analytical store for FIRMS detections (DuckDB over pandas/parquet).

Why DuckDB instead of PostGIS: a week of global VIIRS+MODIS detections is
~1 M rows, which DuckDB filters and aggregates in milliseconds inside the API
process. That keeps the stack laptop-friendly with no database server. All
spatial predicates used here are bounding boxes and grid binning, which do not
need a spatial index.
"""

from __future__ import annotations

import json
import logging
import threading
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import duckdb
import httpx
import pandas as pd

from app.config import Settings
from app.ingest.firms import PRODUCTS, FirmsFormatError, detection_ids, parse_csv, utcnow
from app.ingest.regions import assign_regions
from app.models.schemas import DetectionFilter

log = logging.getLogger(__name__)


@dataclass
class FeedStatus:
    source: str
    state: str  # ok | empty | error | not_loaded
    rows: int = 0
    retrieved_utc: str | None = None
    http_last_modified: str | None = None
    latest_observation_utc: str | None = None
    message: str | None = None
    url: str | None = None


@dataclass
class Dataset:
    name: str
    df: pd.DataFrame
    loaded_utc: datetime
    provenance: dict
    feeds: list[FeedStatus] = field(default_factory=list)
    version: int = 0

    @property
    def latest(self) -> datetime | None:
        return None if self.df.empty else self.df["acq_datetime"].max().to_pydatetime()

    @property
    def earliest(self) -> datetime | None:
        return None if self.df.empty else self.df["acq_datetime"].min().to_pydatetime()


def _prepare(df: pd.DataFrame) -> pd.DataFrame:
    if "id" not in df.columns:
        df = df.copy()
        df["id"] = detection_ids(df)
    for c in ("source", "satellite", "instrument", "confidence_class", "daynight", "country", "iso3", "subregion", "continent"):
        if c in df.columns:
            df[c] = df[c].astype(str)
    return df.reset_index(drop=True)


class FireStore:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._lock = threading.RLock()
        self._refresh_lock = threading.Lock()
        self.datasets: dict[str, Dataset] = {}
        self.live_state: str = "not_loaded"
        self.live_error: str | None = None
        self._con = duckdb.connect(":memory:")
        # All bucketing (date_trunc, time_bucket) and returned timestamps must be UTC.
        self._con.execute("SET GLOBAL TimeZone = 'UTC'")

    # ------------------------------------------------------------------ loading
    def load_demo(self) -> Dataset:
        d = self.settings.data_dir / "demo"
        path = d / "detections.parquet"
        if not path.exists():
            raise FileNotFoundError(f"demo snapshot not found at {path}; run `python -m app.ingest.snapshot`")
        prov = json.loads((d / "provenance.json").read_text()) if (d / "provenance.json").exists() else {}
        df = _prepare(pd.read_parquet(path))
        feeds = [
            FeedStatus(
                source=f["source"],
                state="ok" if f["rows"] else "empty",
                rows=f["rows"],
                retrieved_utc=f["retrieved_utc"],
                http_last_modified=f.get("http_last_modified"),
                latest_observation_utc=f.get("max_acq_utc"),
                url=f["url"],
                message=None if f["rows"] else "Feed contained a header only (no detections) at retrieval time.",
            )
            for f in prov.get("feeds", [])
        ]
        ds = Dataset("demo", df, utcnow(), prov, feeds)
        self._register(ds)
        return ds

    def refresh_live(self, client: httpx.Client | None = None) -> Dataset | None:
        """Download the public FIRMS NRT feeds. Thread-safe; returns None on total failure."""
        if not self._refresh_lock.acquire(blocking=False):
            return self.datasets.get("live")
        try:
            self.live_state = "refreshing"
            own = client is None
            client = client or httpx.Client(
                timeout=self.settings.http_timeout_s, headers={"User-Agent": self.settings.user_agent}, follow_redirects=True
            )
            frames, feeds = [], []
            window = self.settings.live_feed_window
            try:
                for src, prod in PRODUCTS.items():
                    url = prod.feed_url(window)
                    try:
                        r = client.get(url)
                        r.raise_for_status()
                        df = parse_csv(r.content, src) if r.content.strip() else pd.DataFrame()
                        if len(df):
                            frames.append(df)
                        feeds.append(
                            FeedStatus(
                                source=src,
                                state="ok" if len(df) else "empty",
                                rows=len(df),
                                url=url,
                                retrieved_utc=utcnow().isoformat(),
                                http_last_modified=r.headers.get("last-modified"),
                                latest_observation_utc=df["acq_datetime"].max().isoformat() if len(df) else None,
                                message=None if len(df) else "Feed returned no detections (possible instrument outage).",
                            )
                        )
                    except (httpx.HTTPError, FirmsFormatError) as exc:
                        log.warning("live feed %s failed: %s", src, exc)
                        feeds.append(FeedStatus(source=src, state="error", url=url, message=str(exc)[:300]))
            finally:
                if own:
                    client.close()
            if not frames:
                self.live_state = "error"
                self.live_error = "All FIRMS feeds failed or were empty; serving the demo snapshot instead."
                return None
            df = pd.concat(frames, ignore_index=True)
            df = assign_regions(df, self.settings.data_dir / "reference" / "ne_50m_admin_0_countries.geojson")
            cache = self.settings.data_dir / "cache"
            cache.mkdir(parents=True, exist_ok=True)
            df.drop(columns=["id"]).to_parquet(cache / "live.parquet", index=False)
            prov = {
                "dataset": "NASA FIRMS NRT (live)",
                "window": window,
                "created_utc": utcnow().isoformat(),
                "feeds": [f.__dict__ for f in feeds],
            }
            (cache / "live_provenance.json").write_text(json.dumps(prov, indent=2))
            ds = Dataset("live", _prepare(df), utcnow(), prov, feeds)
            self._register(ds)
            self.live_state, self.live_error = "ok", None
            return ds
        except Exception as exc:  # pragma: no cover - defensive
            log.exception("live refresh failed")
            self.live_state, self.live_error = "error", str(exc)[:300]
            return None
        finally:
            self._refresh_lock.release()

    def live_is_stale(self) -> bool:
        ds = self.datasets.get("live")
        if ds is None:
            return True
        return (utcnow() - ds.loaded_utc).total_seconds() > self.settings.live_cache_minutes * 60

    def _register(self, ds: Dataset) -> None:
        with self._lock:
            prev = self.datasets.get(ds.name)
            ds.version = (prev.version + 1) if prev else 1
            self.datasets[ds.name] = ds
            # Materialise as a DuckDB table so concurrent cursors can query it.
            self._con.register("_incoming", ds.df)
            self._con.execute(f"CREATE OR REPLACE TABLE det_{ds.name} AS SELECT * FROM _incoming")
            self._con.unregister("_incoming")

    def get(self, name: str) -> Dataset:
        ds = self.datasets.get(name)
        if ds is None:
            if name == "live":
                # Graceful fallback, surfaced to the client through `dataset_served`.
                return self.datasets["demo"]
            raise KeyError(name)
        return ds

    # ------------------------------------------------------------------ queries
    def _where(self, f: DetectionFilter) -> tuple[str, list]:
        clauses, params = [], []
        if f.bbox is not None:
            w, s, e, n = f.bbox
            clauses.append("latitude BETWEEN ? AND ?")
            params += [s, n]
            if w <= e:
                clauses.append("longitude BETWEEN ? AND ?")
                params += [w, e]
            else:  # bbox crosses the antimeridian
                clauses.append("(longitude >= ? OR longitude <= ?)")
                params += [w, e]
        if f.start is not None:
            clauses.append("acq_datetime >= ?")
            params.append(f.start)
        if f.end is not None:
            clauses.append("acq_datetime <= ?")
            params.append(f.end)
        if f.sources:
            clauses.append(f"source IN ({','.join('?' * len(f.sources))})")
            params += list(f.sources)
        if f.confidence:
            clauses.append(f"confidence_class IN ({','.join('?' * len(f.confidence))})")
            params += list(f.confidence)
        if f.daynight:
            clauses.append("daynight = ?")
            params.append(f.daynight)
        if f.min_frp is not None:
            clauses.append("frp >= ?")
            params.append(f.min_frp)
        if f.iso3:
            clauses.append("iso3 = ?")
            params.append(f.iso3)
        return (" WHERE " + " AND ".join(clauses)) if clauses else "", params

    def sql(self, ds: Dataset, select: str, f: DetectionFilter, tail: str = "", extra: list | None = None) -> pd.DataFrame:
        where, params = self._where(f)
        q = f"SELECT {select} FROM det_{ds.name}{where} {tail}"
        with self._lock:
            cur = self._con.cursor()
        try:
            return cur.execute(q, params + (extra or [])).df()
        finally:
            cur.close()

    def filtered(self, ds: Dataset, f: DetectionFilter, columns: str = "*") -> pd.DataFrame:
        return self.sql(ds, columns, f)

    def by_id(self, ds: Dataset, det_id: str) -> pd.Series | None:
        m = ds.df["id"] == det_id
        if not m.any():
            return None
        return ds.df.loc[m].iloc[0]


def history_dir(settings: Settings) -> Path:
    return settings.data_dir / "demo" / "history"
