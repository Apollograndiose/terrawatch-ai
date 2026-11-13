"""Spatial grouping of hotspot detections into *observation clusters*.

Method: detections are snapped to an approximately equal-distance grid
(``link_km`` cells, longitude scaled by cos(latitude)); occupied cells that
touch (8-neighbourhood) are joined with connected components. This is
single-linkage clustering with a maximum gap of roughly 1-2 cells, equivalent
in spirit to DBSCAN with ``min_samples=1`` but O(n) on a million points.

A cluster is a *group of thermal-anomaly detections that are close in space
within the selected time window*. It is not a fire perimeter, does not measure
burned area, and may merge separate fires or split one large fire. Clusters
are deterministic algorithmic groupings, not machine-learning output.
"""

from __future__ import annotations

import hashlib

import numpy as np
import pandas as pd
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

KM_PER_DEG_LAT = 110.574
KM_PER_DEG_LON_EQ = 111.320


def label_clusters(lat: np.ndarray, lon: np.ndarray, link_km: float = 1.5) -> np.ndarray:
    if lat.size == 0:
        return np.zeros(0, dtype=np.int64)
    cy = np.floor(lat * KM_PER_DEG_LAT / link_km).astype(np.int64)
    cx = np.floor(lon * KM_PER_DEG_LON_EQ * np.cos(np.radians(lat)) / link_km).astype(np.int64)
    cells = pd.DataFrame({"cx": cx, "cy": cy})
    uniq = cells.drop_duplicates().reset_index(drop=True)
    uniq["cid"] = np.arange(len(uniq))
    key = pd.MultiIndex.from_frame(uniq[["cx", "cy"]])
    lookup = pd.Series(uniq["cid"].to_numpy(), index=key)
    rows, cols = [uniq["cid"].to_numpy()], [uniq["cid"].to_numpy()]
    for dx, dy in ((1, 0), (0, 1), (1, 1), (1, -1)):
        nb = pd.MultiIndex.from_arrays([uniq["cx"].to_numpy() + dx, uniq["cy"].to_numpy() + dy])
        hit = lookup.reindex(nb).to_numpy()
        ok = ~np.isnan(hit)
        rows.append(uniq["cid"].to_numpy()[ok])
        cols.append(hit[ok].astype(np.int64))
    r = np.concatenate(rows)
    c = np.concatenate(cols)
    g = coo_matrix((np.ones(r.size, dtype=np.int8), (r, c)), shape=(len(uniq), len(uniq)))
    _, comp = connected_components(g, directed=False)
    cell_of_point = cells.merge(uniq, on=["cx", "cy"], how="left")["cid"].to_numpy()
    return comp[cell_of_point]


def summarise_clusters(df: pd.DataFrame, labels: np.ndarray, min_detections: int = 1) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame()
    t_s = df["acq_datetime"].array.as_unit("s").asi8
    d = df.assign(
        cluster=labels, day=t_s // 86_400, row=np.arange(len(df)), is_high=(df["confidence_class"] == "high").to_numpy().astype(np.int32)
    )
    g = d.groupby("cluster", sort=False)
    out = g.agg(
        detections=("id", "size"),
        lat=("latitude", "mean"),
        lon=("longitude", "mean"),
        west=("longitude", "min"),
        east=("longitude", "max"),
        south=("latitude", "min"),
        north=("latitude", "max"),
        first_utc=("acq_datetime", "min"),
        last_utc=("acq_datetime", "max"),
        frp_sum=("frp", "sum"),
        frp_max=("frp", "max"),
        active_days=("day", "nunique"),
        high_conf=("is_high", "sum"),
        anchor_row=("row", "min"),
    )
    out = out[out["detections"] >= min_detections].copy()
    if out.empty:
        return out
    keep = d[d["cluster"].isin(out.index)]
    # Dominant country and the set of contributing sources, computed with grouped counts (vectorised).
    cc = keep.groupby(["cluster", "country", "iso3"], sort=False).size().reset_index(name="n")
    cc = cc.sort_values("n", ascending=False).drop_duplicates("cluster").set_index("cluster")
    out["country"] = cc["country"]
    out["iso3"] = cc["iso3"]
    names = sorted(keep["source"].unique())
    bit = keep["source"].map({n: 1 << i for i, n in enumerate(names)}).astype(np.int64)
    mask = keep.assign(bit=bit)[["cluster", "source", "bit"]].drop_duplicates(["cluster", "source"])
    mask = mask.groupby("cluster")["bit"].sum()
    decode = {m: [n for i, n in enumerate(names) if m & (1 << i)] for m in mask.unique()}
    out["sources"] = mask.map(decode)
    out["anchor"] = df["id"].to_numpy()[out["anchor_row"].to_numpy()]
    out["cluster_id"] = out["anchor"].map(lambda a: "c" + hashlib.blake2b(a.encode(), digest_size=6).hexdigest())
    return out.drop(columns=["anchor", "anchor_row"]).sort_values(["frp_sum", "detections"], ascending=False).reset_index()
