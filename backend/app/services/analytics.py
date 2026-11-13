"""Descriptive statistics over filtered detections and historical archive baselines.

Every number returned here is a direct aggregate of FIRMS records. Counts are
*detections* (pixels flagged as thermal anomalies), not fires: one large fire
produces many detections, and VIIRS (375 m) records ~10x more detections than
MODIS (1 km) for the same fire, so source mix matters when comparing counts.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from app.models.schemas import DetectionFilter
from app.services.store import Dataset, FireStore


def summary(store: FireStore, ds: Dataset, f: DetectionFilter) -> dict:
    tot = store.sql(
        ds,
        "COUNT(*) AS n, SUM(frp) AS frp_sum, MAX(frp) AS frp_max, "
        "quantile_cont(frp, 0.5) AS frp_p50, quantile_cont(frp, 0.9) AS frp_p90, "
        "MIN(acq_datetime) AS first, MAX(acq_datetime) AS last",
        f,
    ).iloc[0]
    n = int(tot["n"])

    def grouped(col: str, limit: int | None = None) -> list[dict]:
        tail = f"GROUP BY {col} ORDER BY n DESC" + (f" LIMIT {int(limit)}" if limit else "")
        g = store.sql(ds, f"{col} AS key, COUNT(*) AS n, SUM(frp) AS frp_sum", f, tail)
        return [{"key": str(r.key), "count": int(r.n), "frp_sum": float(r.frp_sum or 0)} for r in g.itertuples()]

    return {
        "count": n,
        "frp_sum_mw": float(tot["frp_sum"] or 0),
        "frp_max_mw": float(tot["frp_max"]) if n else None,
        "frp_p50_mw": float(tot["frp_p50"]) if n else None,
        "frp_p90_mw": float(tot["frp_p90"]) if n else None,
        "first_utc": tot["first"].isoformat() if n else None,
        "last_utc": tot["last"].isoformat() if n else None,
        "by_source": grouped("source"),
        "by_confidence": grouped("confidence_class"),
        "by_daynight": grouped("daynight"),
        "by_continent": grouped("continent"),
        "by_country": grouped("country", 15),
    }


def timeseries(store: FireStore, ds: Dataset, f: DetectionFilter, bucket: str = "day") -> dict:
    if bucket not in ("hour", "6h", "day"):
        raise ValueError("bucket must be hour, 6h or day")
    expr = {
        "hour": "date_trunc('hour', acq_datetime)",
        "6h": "time_bucket(INTERVAL 6 HOUR, acq_datetime)",
        "day": "date_trunc('day', acq_datetime)",
    }[bucket]
    g = store.sql(ds, f"{expr} AS t, source, COUNT(*) AS n, SUM(frp) AS frp", f, "GROUP BY 1, 2 ORDER BY 1")
    if g.empty:
        return {"bucket": bucket, "series": [], "sources": []}
    piv = g.pivot_table(index="t", columns="source", values="n", aggfunc="sum", fill_value=0)
    frp = g.groupby("t")["frp"].sum()
    rows = []
    for t, r in piv.iterrows():
        row = {
            "t": pd.Timestamp(t).tz_localize("UTC").isoformat() if pd.Timestamp(t).tzinfo is None else pd.Timestamp(t).isoformat(),
            "total": int(r.sum()),
            "frp_sum": float(frp.loc[t]),
        }
        row.update({k: int(v) for k, v in r.items()})
        rows.append(row)
    return {"bucket": bucket, "series": rows, "sources": list(piv.columns)}


def grid(store: FireStore, ds: Dataset, f: DetectionFilter, cell: float) -> pd.DataFrame:
    """Aggregate detections onto a regular lon/lat grid (cell size in degrees)."""
    # Parameters in SELECT come before WHERE parameters, so inline the validated float.
    c = f"{cell:.6f}"
    return store.sql(
        ds,
        f"floor(longitude / {c}) * {c} + {c} / 2 AS lon, floor(latitude / {c}) * {c} + {c} / 2 AS lat, "
        "COUNT(*) AS n, SUM(frp) AS frp_sum, MAX(frp) AS frp_max",
        f,
        "GROUP BY 1, 2",
    )


# ----------------------------------------------------------------- historical archive
def history_countries(hist_dir: Path) -> list[str]:
    return sorted(p.stem.removeprefix("modis_").replace("_", " ") for p in hist_dir.glob("modis_*.parquet"))


def history(hist_dir: Path, country: str, vegetation_only: bool = True, min_confidence: str = "nominal") -> dict:
    path = hist_dir / f"modis_{country.replace(' ', '_')}.parquet"
    if not path.exists():
        raise FileNotFoundError(country)
    df = pd.read_parquet(path)
    if vegetation_only:
        df = df[df["type"] == 0]
    allowed = {"low": ["low", "nominal", "high"], "nominal": ["nominal", "high"], "high": ["high"]}[min_confidence]
    df = df[df["confidence_class"].isin(allowed)]
    m = df.groupby(["year", "month"], as_index=False).agg(count=("count", "sum"), frp_sum=("frp_sum", "sum"))
    years = sorted(m["year"].unique().tolist())
    full = pd.MultiIndex.from_product([years, range(1, 13)], names=["year", "month"])
    m = m.set_index(["year", "month"]).reindex(full, fill_value=0).reset_index()
    annual = m.groupby("year", as_index=False).agg(count=("count", "sum"), frp_sum=("frp_sum", "sum"))
    clim = m.groupby("month")["count"].agg(["mean", "min", "max", "std"]).reset_index()
    z = annual["count"]
    annual["anomaly_z"] = ((z - z.mean()) / z.std(ddof=1)).round(3) if len(z) > 2 else np.nan
    return {
        "country": country,
        "years": years,
        "monthly": m.to_dict(orient="records"),
        "annual": annual.replace({np.nan: None}).to_dict(orient="records"),
        "climatology": clim.replace({np.nan: None}).to_dict(orient="records"),
        "filters": {"vegetation_only": vegetation_only, "min_confidence": min_confidence},
        "note": (
            "MODIS C6.1 standard-processing detections (Terra+Aqua). Counts are detections, not fires. "
            "Terra/Aqua orbit drift after 2020-2022 changes overpass times and can bias recent counts."
        ),
    }
