"""NASA FIRMS active-fire ingestion: download, validate and normalise.

Two access paths are supported, both verified against the live service:

1. Public near-real-time global CSV feeds (no key):
   https://firms.modaps.eosdis.nasa.gov/data/active_fire/<product>/csv/<file>_{24h,48h,7d}.csv
2. The FIRMS Area API (free MAP_KEY required, 1-5 day windows, any date):
   https://firms.modaps.eosdis.nasa.gov/api/area/csv/<MAP_KEY>/<SOURCE>/<W,S,E,N>/<DAYS>/<YYYY-MM-DD>

Detections are *thermal-anomaly observations* at the centre of a VIIRS
(375 m) or MODIS (1 km) pixel. They are not fire perimeters or burned area.
"""

from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass
from datetime import UTC, date, datetime

import numpy as np
import pandas as pd

FIRMS_BASE = "https://firms.modaps.eosdis.nasa.gov"


@dataclass(frozen=True)
class FeedProduct:
    source: str  # FIRMS Area-API source id, also our canonical source key
    satellite: str
    instrument: str
    path: str  # path of the global NRT feed, without window suffix
    resolution_m: int

    def feed_url(self, window: str) -> str:
        return f"{FIRMS_BASE}/data/active_fire/{self.path}_Global_{window}.csv"


PRODUCTS: dict[str, FeedProduct] = {
    p.source: p
    for p in (
        FeedProduct("VIIRS_NOAA20_NRT", "NOAA-20", "VIIRS", "noaa-20-viirs-c2/csv/J1_VIIRS_C2", 375),
        FeedProduct("VIIRS_NOAA21_NRT", "NOAA-21", "VIIRS", "noaa-21-viirs-c2/csv/J2_VIIRS_C2", 375),
        FeedProduct("VIIRS_SNPP_NRT", "Suomi NPP", "VIIRS", "suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2", 375),
        FeedProduct("MODIS_NRT", "Terra/Aqua", "MODIS", "modis-c6.1/csv/MODIS_C6_1", 1000),
    )
}

# Satellite codes used in FIRMS CSVs.
SATELLITE_CODES = {"N": "Suomi NPP", "N20": "NOAA-20", "1": "NOAA-20", "N21": "NOAA-21", "T": "Terra", "A": "Aqua"}

CANONICAL_COLUMNS = [
    "id",
    "latitude",
    "longitude",
    "acq_datetime",
    "source",
    "satellite",
    "instrument",
    "confidence_raw",
    "confidence_class",
    "bright_t4",
    "bright_t5",
    "frp",
    "scan",
    "track",
    "daynight",
    "version",
    "type",
]


class FirmsFormatError(ValueError):
    """Raised when a FIRMS payload does not match the documented schema."""


def modis_confidence_class(conf: pd.Series) -> pd.Series:
    """Map MODIS 0-100 confidence to FIRMS' documented classes.

    FIRMS FAQ: low < 30, nominal 30-79, high >= 80 (Giglio et al., MODIS C6 user guide).
    """
    c = pd.to_numeric(conf, errors="coerce")
    out = np.where(c >= 80, "high", np.where(c >= 30, "nominal", "low"))
    return pd.Series(np.where(c.isna(), "unknown", out), index=conf.index)


def viirs_confidence_class(conf: pd.Series) -> pd.Series:
    mapping = {"l": "low", "n": "nominal", "h": "high", "low": "low", "nominal": "nominal", "high": "high"}
    return conf.astype(str).str.strip().str.lower().map(mapping).fillna("unknown")


def normalise(raw: pd.DataFrame, source: str) -> pd.DataFrame:
    """Convert a FIRMS CSV (VIIRS or MODIS, NRT or archive) into the canonical schema."""
    if source not in PRODUCTS and not source.startswith(("VIIRS", "MODIS")):
        raise FirmsFormatError(f"unknown source {source!r}")
    required = {"latitude", "longitude", "acq_date", "acq_time", "confidence", "frp"}
    missing = required - set(raw.columns)
    if missing:
        raise FirmsFormatError(f"FIRMS payload missing columns: {sorted(missing)}")
    instrument = "MODIS" if source.startswith("MODIS") else "VIIRS"
    df = pd.DataFrame(index=raw.index)
    df["latitude"] = pd.to_numeric(raw["latitude"], errors="coerce")
    df["longitude"] = pd.to_numeric(raw["longitude"], errors="coerce")
    t = raw["acq_time"].astype(str).str.zfill(4)
    df["acq_datetime"] = pd.to_datetime(raw["acq_date"].astype(str) + t, format="%Y-%m-%d%H%M", utc=True, errors="coerce")
    df["source"] = source
    sat = raw.get("satellite", pd.Series(index=raw.index, dtype=object)).astype(str).str.strip()
    df["satellite"] = sat.map(SATELLITE_CODES).fillna(PRODUCTS[source].satellite if source in PRODUCTS else sat)
    df["instrument"] = instrument
    df["confidence_raw"] = raw["confidence"].astype(str).str.strip()
    df["confidence_class"] = (
        modis_confidence_class(raw["confidence"]) if instrument == "MODIS" else viirs_confidence_class(raw["confidence"])
    )
    df["bright_t4"] = pd.to_numeric(raw.get("bright_ti4", raw.get("brightness")), errors="coerce")
    df["bright_t5"] = pd.to_numeric(raw.get("bright_ti5", raw.get("bright_t31")), errors="coerce")
    df["frp"] = pd.to_numeric(raw["frp"], errors="coerce")
    df["scan"] = pd.to_numeric(raw.get("scan"), errors="coerce")
    df["track"] = pd.to_numeric(raw.get("track"), errors="coerce")
    df["daynight"] = raw.get("daynight", pd.Series("", index=raw.index)).astype(str).str.strip()
    df["version"] = raw.get("version", pd.Series("", index=raw.index)).astype(str).str.strip()
    df["type"] = (
        pd.to_numeric(raw["type"], errors="coerce").astype("Int8") if "type" in raw else pd.Series(pd.NA, index=raw.index, dtype="Int8")
    )

    valid = df["latitude"].between(-90, 90) & df["longitude"].between(-180, 180) & df["acq_datetime"].notna()
    df = df[valid].copy()
    if df.empty:
        return empty_frame()
    df["id"] = detection_ids(df)
    df = df.drop_duplicates("id")
    df["latitude"] = df["latitude"].astype("float64")
    df["longitude"] = df["longitude"].astype("float64")
    for c in ("bright_t4", "bright_t5", "frp", "scan", "track"):
        df[c] = df[c].astype("float32")
    return df[CANONICAL_COLUMNS].reset_index(drop=True)


def detection_ids(df: pd.DataFrame) -> pd.Series:
    """Deterministic 64-bit id from (source, lat, lon, acquisition minute), hex encoded."""
    key = pd.DataFrame(
        {
            "s": df["source"].astype(str),
            "la": np.round(df["latitude"].to_numpy(dtype="float64") * 1e5).astype("int64"),
            "lo": np.round(df["longitude"].to_numpy(dtype="float64") * 1e5).astype("int64"),
            "t": df["acq_datetime"].dt.strftime("%Y%m%d%H%M").astype(str),
        }
    )
    h = pd.util.hash_pandas_object(key, index=False).to_numpy(dtype="uint64")
    return pd.Series([f"{v:016x}" for v in h.tolist()], index=df.index, dtype=object)


def empty_frame() -> pd.DataFrame:
    df = pd.DataFrame({c: pd.Series(dtype=object) for c in CANONICAL_COLUMNS})
    df["acq_datetime"] = pd.Series(dtype="datetime64[ns, UTC]")
    for c in ("latitude", "longitude"):
        df[c] = df[c].astype("float64")
    return df


def parse_csv(payload: bytes, source: str) -> pd.DataFrame:
    text = payload.decode("utf-8", errors="replace").lstrip()
    if not text:
        raise FirmsFormatError("empty payload")
    first = text.splitlines()[0]
    if "latitude" not in first:
        # The Area API returns plain-text error messages (e.g. invalid MAP_KEY).
        raise FirmsFormatError(f"FIRMS returned a non-CSV response: {first[:200]!r}")
    raw = pd.read_csv(io.StringIO(text), dtype={"acq_time": str, "confidence": str, "satellite": str, "version": str})
    return normalise(raw, source)


def area_api_url(map_key: str, source: str, bbox: tuple[float, float, float, float], days: int, start: date) -> str:
    if not 1 <= days <= 5:
        raise ValueError("FIRMS Area API accepts a day range of 1-5")
    w, s, e, n = bbox
    if not (-180 <= w < e <= 180 and -90 <= s < n <= 90):
        raise ValueError("invalid bbox")
    area = f"{w:.4f},{s:.4f},{e:.4f},{n:.4f}"
    return f"{FIRMS_BASE}/api/area/csv/{map_key}/{source}/{area}/{days}/{start.isoformat()}"


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def utcnow() -> datetime:
    return datetime.now(UTC)
