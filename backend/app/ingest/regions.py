"""Assign detections to countries / UN subregions using Natural Earth 1:50m boundaries.

Natural Earth is public domain (https://www.naturalearthdata.com/about/terms-of-use/).
Boundaries are generalised: detections on coastlines or tiny islands may fall
outside every polygon and are reported as "Unassigned (ocean/coast)".
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
import shapely
from shapely.geometry import shape

UNASSIGNED = "Unassigned (ocean/coast)"


@lru_cache(maxsize=2)
def load_countries(path: str) -> tuple[list[dict], shapely.STRtree, list]:
    data = json.loads(Path(path).read_text())
    props, geoms = [], []
    for f in data["features"]:
        p = f["properties"]
        props.append(
            {
                "country": p.get("NAME") or p.get("ADMIN"),
                "iso3": p.get("ADM0_A3") or p.get("ISO_A3"),
                "continent": p.get("CONTINENT"),
                "subregion": p.get("SUBREGION"),
                "bbox": None,
            }
        )
        g = shape(f["geometry"])
        props[-1]["bbox"] = [round(v, 4) for v in g.bounds]
        geoms.append(g)
    return props, shapely.STRtree(geoms), geoms


def assign_regions(df: pd.DataFrame, countries_path: Path) -> pd.DataFrame:
    props, tree, _ = load_countries(str(countries_path))
    pts = shapely.points(df["longitude"].to_numpy(), df["latitude"].to_numpy())
    pair = tree.query(pts, predicate="within")  # (2, k): point idx, polygon idx
    idx = np.full(len(df), -1, dtype=np.int64)
    idx[pair[0]] = pair[1]
    names = np.array([p["country"] for p in props] + [UNASSIGNED], dtype=object)
    iso = np.array([p["iso3"] for p in props] + ["---"], dtype=object)
    sub = np.array([p["subregion"] for p in props] + [UNASSIGNED], dtype=object)
    cont = np.array([p["continent"] for p in props] + [UNASSIGNED], dtype=object)
    df = df.copy()
    df["country"] = names[idx]
    df["iso3"] = iso[idx]
    df["subregion"] = sub[idx]
    df["continent"] = cont[idx]
    return df
