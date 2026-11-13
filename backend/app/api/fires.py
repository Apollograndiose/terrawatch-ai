"""Wildfire observation endpoints (NASA FIRMS hotspots and observation clusters)."""

from __future__ import annotations

import threading
from collections import OrderedDict
from typing import Annotated

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request

from app.api.deps import dataset_param, detection_filter, get_store, served_meta
from app.models.schemas import DetectionFilter
from app.services import analytics
from app.services.clustering import label_clusters, summarise_clusters
from app.services.store import Dataset, FireStore

router = APIRouter(prefix="/api/fires", tags=["wildfire"])

POINT_COLUMNS = "id, longitude, latitude, frp, acq_datetime, source, confidence_class, daynight"
_cluster_cache: OrderedDict[str, tuple[pd.DataFrame, np.ndarray, pd.DataFrame]] = OrderedDict()
_cluster_lock = threading.Lock()
LINK_KM = 1.5


def grid_cell_for_zoom(zoom: float) -> float:
    """Roughly 5 screen pixels per grid cell at the given web-mercator zoom (360 deg / 2^z / 256 px * 5)."""
    z = max(0.0, min(zoom, 12.0))
    return float(np.clip(7.03 / (2**z), 0.02, 5.0))


def _points_payload(df: pd.DataFrame) -> dict:
    return {
        "id": df["id"].tolist(),
        "lon": np.round(df["longitude"].to_numpy(), 5).tolist(),
        "lat": np.round(df["latitude"].to_numpy(), 5).tolist(),
        "frp": np.round(df["frp"].fillna(0).to_numpy(dtype=float), 2).tolist(),
        "t": [t.isoformat() for t in df["acq_datetime"]],
        "src": df["source"].tolist(),
        "conf": df["confidence_class"].tolist(),
        "dn": df["daynight"].tolist(),
    }


@router.get("/map")
def fire_map(
    request: Request,
    f: Annotated[DetectionFilter, Depends(detection_filter)],
    dataset: Annotated[str, Depends(dataset_param)],
    zoom: Annotated[float, Query(ge=0, le=22)] = 2,
    store: FireStore = Depends(get_store),
):
    """Points when the view holds few enough detections, otherwise a zoom-dependent grid aggregate."""
    ds = store.get(dataset)
    limit = request.app.state.settings.max_points
    n = int(store.sql(ds, "COUNT(*) AS n", f).iloc[0]["n"])
    meta = {**served_meta(ds, dataset), "total": n}
    if n <= limit or zoom >= 8:
        tail = f"ORDER BY frp DESC NULLS LAST LIMIT {int(limit)}"
        df = store.sql(ds, POINT_COLUMNS, f, tail)
        return {**meta, "mode": "points", "returned": len(df), "truncated": n > len(df), "points": _points_payload(df)}
    cell = grid_cell_for_zoom(zoom)
    g = analytics.grid(store, ds, f, cell)
    return {
        **meta,
        "mode": "grid",
        "cell_deg": cell,
        "cells": {
            "lon": np.round(g["lon"].to_numpy(), 4).tolist(),
            "lat": np.round(g["lat"].to_numpy(), 4).tolist(),
            "n": g["n"].astype(int).tolist(),
            "frp_sum": np.round(g["frp_sum"].fillna(0).to_numpy(dtype=float), 1).tolist(),
            "frp_max": np.round(g["frp_max"].fillna(0).to_numpy(dtype=float), 1).tolist(),
        },
    }


def _clusters(store: FireStore, ds: Dataset, f: DetectionFilter) -> tuple[pd.DataFrame, np.ndarray, pd.DataFrame]:
    key = f"{ds.name}:{ds.version}:{f.key()}"
    with _cluster_lock:
        if key in _cluster_cache:
            _cluster_cache.move_to_end(key)
            return _cluster_cache[key]
    cols = "id, latitude, longitude, acq_datetime, frp, source, confidence_class, daynight, country, iso3"
    df = store.sql(ds, cols, f)
    labels = label_clusters(df["latitude"].to_numpy(), df["longitude"].to_numpy(), LINK_KM)
    summ = summarise_clusters(df, labels)
    with _cluster_lock:
        _cluster_cache[key] = (df, labels, summ)
        while len(_cluster_cache) > 6:
            _cluster_cache.popitem(last=False)
    return df, labels, summ


def _cluster_json(r) -> dict:
    return {
        "cluster_id": r.cluster_id,
        "detections": int(r.detections),
        "lat": float(r.lat),
        "lon": float(r.lon),
        "bbox": [float(r.west), float(r.south), float(r.east), float(r.north)],
        "first_utc": r.first_utc.isoformat(),
        "last_utc": r.last_utc.isoformat(),
        "frp_sum_mw": float(r.frp_sum),
        "frp_max_mw": float(r.frp_max),
        "active_days": int(r.active_days),
        "high_confidence": int(r.high_conf),
        "sources": list(r.sources),
        "country": r.country,
        "iso3": r.iso3,
    }


@router.get("/clusters")
def clusters(
    f: Annotated[DetectionFilter, Depends(detection_filter)],
    dataset: Annotated[str, Depends(dataset_param)],
    min_detections: Annotated[int, Query(ge=1, le=10_000)] = 5,
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    sort: Annotated[str, Query(pattern="^(frp|detections|recent)$")] = "frp",
    store: FireStore = Depends(get_store),
):
    ds = store.get(dataset)
    # Cluster over the full filtered window (ignoring the viewport) so cluster ids stay stable while
    # panning; the viewport only selects which clusters are listed (by centroid).
    _, _, summ = _clusters(store, ds, f.model_copy(update={"bbox": None}))
    s = summ[summ["detections"] >= min_detections] if not summ.empty else summ
    if f.bbox is not None and not s.empty:
        w, so, e, n = f.bbox
        in_lon = s["lon"].between(w, e) if w <= e else (s["lon"] >= w) | (s["lon"] <= e)
        s = s[in_lon & s["lat"].between(so, n)]
    if not s.empty:
        col = {"frp": "frp_sum", "detections": "detections", "recent": "last_utc"}[sort]
        s = s.sort_values(col, ascending=False)
    return {
        **served_meta(ds, dataset),
        "method": {
            "name": "grid single-linkage (connected components)",
            "link_km": LINK_KM,
            "description": "Detections closer than ~1.5-3 km within the selected time window are grouped. "
            "A cluster is not a fire perimeter and is not ML output.",
        },
        "total_clusters": int(len(s)),
        "clusters": [_cluster_json(r) for r in s.head(limit).itertuples()],
    }


@router.get("/clusters/{cluster_id}")
def cluster_detail(
    cluster_id: Annotated[str, Path(pattern="^c[0-9a-f]{12}$")],
    f: Annotated[DetectionFilter, Depends(detection_filter)],
    dataset: Annotated[str, Depends(dataset_param)],
    store: FireStore = Depends(get_store),
):
    ds = store.get(dataset)
    df, labels, summ = _clusters(store, ds, f.model_copy(update={"bbox": None}))
    row = summ[summ["cluster_id"] == cluster_id] if not summ.empty else summ
    if row.empty:
        raise HTTPException(404, "cluster not found for these filters")
    r = next(row.itertuples())
    members = df[labels == r.cluster].sort_values("acq_datetime")
    tl = members.assign(t=members["acq_datetime"].dt.floor("6h")).groupby(["t", "source"]).size().unstack(fill_value=0)
    timeline = [{"t": t.isoformat(), **{k: int(v) for k, v in row_.items()}, "total": int(row_.sum())} for t, row_ in tl.iterrows()]
    frp = members["frp"].dropna().to_numpy()
    hist_edges = [0, 5, 10, 25, 50, 100, 250, 500, 1000, 1e9]
    counts, _ = np.histogram(frp, bins=hist_edges)
    sample = members.sort_values("frp", ascending=False).head(3000)
    return {
        **served_meta(ds, dataset),
        "cluster": _cluster_json(r),
        "timeline_6h": timeline,
        "daynight": members["daynight"].value_counts().to_dict(),
        "confidence": members["confidence_class"].value_counts().to_dict(),
        "frp_histogram": [
            {"lo": hist_edges[i], "hi": hist_edges[i + 1] if i + 1 < len(hist_edges) - 1 else None, "count": int(c)}
            for i, c in enumerate(counts)
        ],
        "points": _points_payload(sample),
        "points_truncated": len(members) > len(sample),
    }


@router.get("/detections/{det_id}")
def detection(
    det_id: Annotated[str, Path(pattern="^[0-9a-f]{16}$")],
    dataset: Annotated[str, Depends(dataset_param)],
    store: FireStore = Depends(get_store),
):
    ds = store.get(dataset)
    row = store.by_id(ds, det_id)
    if row is None:
        raise HTTPException(404, "detection not found")
    rec = {k: (None if (isinstance(v, float) and np.isnan(v)) or v is pd.NA else v) for k, v in row.to_dict().items()}
    rec["acq_datetime"] = row["acq_datetime"].isoformat()
    for k in ("bright_t4", "bright_t5", "frp", "scan", "track"):
        rec[k] = None if rec.get(k) is None else round(float(rec[k]), 3)
    rec["type"] = None if pd.isna(row.get("type")) else int(row["type"])
    rec["pixel_area_km2"] = round(float(row["scan"] * row["track"]), 3) if pd.notna(row["scan"]) and pd.notna(row["track"]) else None
    lat, lon, t = float(row["latitude"]), float(row["longitude"]), row["acq_datetime"]
    dlat = 5 / 110.574
    dlon = 5 / (111.32 * max(np.cos(np.radians(lat)), 0.05))
    near = DetectionFilter(
        bbox=(max(lon - dlon, -180), max(lat - dlat, -90), min(lon + dlon, 180), min(lat + dlat, 90)),
        start=t - pd.Timedelta(hours=48),
        end=t + pd.Timedelta(hours=48),
    )
    ctx = store.sql(ds, "COUNT(*) AS n, SUM(frp) AS frp, COUNT(DISTINCT source) AS s", near).iloc[0]
    return {
        **served_meta(ds, dataset),
        "detection": rec,
        "context": {
            "radius_km": 5,
            "window_hours": 48,
            "detections": int(ctx["n"]) - 1,
            "frp_sum_mw": float(ctx["frp"] or 0),
            "distinct_sources": int(ctx["s"]),
        },
        "interpretation": (
            "A FIRMS detection marks a pixel containing one or more thermal anomalies at overpass time. "
            "Location is the pixel centre; the true fire may be anywhere within the pixel footprint."
        ),
    }
