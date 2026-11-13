"""Export a small, redistributable subset of Sen1Floods11 chips for the app's flood module.

    python ml/scripts/export_flood_demo.py --data ml/data/sen1floods11 --out data/flood_demo

Selection (deterministic):
* all 15 Bolivia chips (the out-of-distribution hold-out, scored with the final model);
* one chip per development event: the chip whose hand-labelled water fraction is
  closest to 25 % (scored with that event's leave-one-event-out fold model).

For each chip we write:
* s1/<id>.tif   Sentinel-1 VV/VH sigma0 dB scaled x100 to int16 (nodata -32768), deflate.
                Quantisation error <= 0.005 dB, far below speckle; the model runs on these.
* label/<id>.tif hand label (-1 nodata, 0 dry, 1 water), int8.
* jrc/<id>.tif   JRC permanent-water mask, uint8.
* s2/<id>.png    Sentinel-2 L1C true-colour preview (B4/B3/B2) from S2Hand, for context only.
* chips.json     index with event, acquisition date, bbox and which model scores it.

Licence: the Sen1Floods11 source repository states no licence, so these rasters are NOT
committed; users fetch them with ml/scripts/fetch_flood_demo.py (see docs/DATA_SOURCES.md).
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from terrawatch_ml.data import load_index, read_jrc, read_label, read_s1  # noqa: E402

BASE = "https://storage.googleapis.com/sen1floods11/v1.1"
HOLDOUT = "Bolivia"


def chip_dates(meta_path: Path) -> dict[str, str]:
    """Event acquisition dates from the dataset metadata (keyed by event/location name)."""
    gj = json.loads(meta_path.read_text())
    out = {}
    for f in gj["features"]:
        p = f["properties"]
        name = p.get("location") or p.get("name") or p.get("id")
        date = p.get("s1_date") or p.get("S1 Date") or p.get("datetime")
        if name and date:
            out[str(name).replace(" ", "-")] = str(date)[:10].replace("/", "-")
    return out


def write_tif(path: Path, arr: np.ndarray, profile: dict, dtype: str, nodata) -> None:
    prof = {
        **profile,
        "dtype": dtype,
        "count": arr.shape[0],
        "nodata": nodata,
        "compress": "deflate",
        "predictor": 2 if dtype == "int16" else 1,
        "tiled": False,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(path, "w", **prof) as dst:
        dst.write(arr.astype(dtype))


def s2_preview(chip: str, dest: Path) -> bool:
    url = f"{BASE}/data/flood_events/HandLabeled/S2Hand/{chip}_S2Hand.tif"
    with tempfile.NamedTemporaryFile(suffix=".tif") as tmp:
        try:
            tmp.write(urllib.request.urlopen(url, timeout=120).read())  # noqa: S310 (fixed https host)
            tmp.flush()
        except Exception as exc:  # pragma: no cover - network
            print(f"  S2 preview failed for {chip}: {exc}")
            return False
        with rasterio.open(tmp.name) as r:
            rgb = r.read([4, 3, 2]).astype(np.float32)  # B4, B3, B2 (bands 1..13 = B1..B12 incl. B8A)
    valid = np.all(rgb > 0, axis=0)
    img = np.clip(rgb / 3000.0, 0, 1) ** (1 / 1.4)
    rgba = np.zeros(rgb.shape[1:] + (4,), dtype=np.uint8)
    rgba[..., :3] = (np.moveaxis(img, 0, -1) * 255).astype(np.uint8)
    rgba[..., 3] = np.where(valid, 255, 0)
    dest.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(dest, optimize=True)
    return True


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--data", type=Path, default=Path("ml/data/sen1floods11"))
    p.add_argument("--out", type=Path, default=Path("data/flood_demo"))
    p.add_argument("--no-s2", action="store_true")
    a = p.parse_args()

    index = load_index(a.data)
    rows = []
    for _, r in index.iterrows():
        lab = read_label(a.data, r.chip_id)
        ok = lab != -1
        rows.append(
            {
                "chip_id": r.chip_id,
                "event": r.event,
                "official_split": r.official_split,
                "water_frac": float((lab[ok] == 1).mean()) if ok.any() else 0.0,
                "labelled": float(ok.mean()),
            }
        )
    df = pd.DataFrame(rows)
    chosen = df[df.event == HOLDOUT].copy()
    dev = df[(df.event != HOLDOUT) & (df.labelled > 0.5)].copy()
    dev["d"] = (dev["water_frac"] - 0.25).abs()
    chosen = pd.concat([chosen, dev.sort_values("d").groupby("event").head(1)])
    dates = chip_dates(a.data / "Sen1Floods11_Metadata.geojson")

    out = []
    for _, r in chosen.sort_values(["event", "chip_id"]).iterrows():
        s1, meta = read_s1(a.data, r.chip_id)
        lab = read_label(a.data, r.chip_id)
        jrc = read_jrc(a.data, r.chip_id)
        with rasterio.open(a.data / "S1Hand" / f"{r.chip_id}_S1Hand.tif") as src:
            prof = src.profile
        q = np.where(np.isfinite(s1), np.round(np.clip(s1, -327, 327) * 100), -32768)
        write_tif(a.out / "s1" / f"{r.chip_id}.tif", q, prof, "int16", -32768)
        write_tif(a.out / "label" / f"{r.chip_id}.tif", lab[None], prof, "int8", None)
        write_tif(a.out / "jrc" / f"{r.chip_id}.tif", jrc[None], prof, "uint8", None)
        has_s2 = False if a.no_s2 else s2_preview(r.chip_id, a.out / "s2" / f"{r.chip_id}.png")
        b = meta["bounds"]
        out.append(
            {
                "chip_id": r.chip_id,
                "event": r.event,
                "country": {"Mekong": "Cambodia (Mekong)", "USA": "United States"}.get(r.event, r.event.replace("-", " ")),
                # Chip names use "Mekong" for the event the metadata lists as "Cambodia".
                "date": dates.get({"Mekong": "Cambodia"}.get(r.event, r.event)),
                "bbox": [round(b[0], 6), round(b[1], 6), round(b[2], 6), round(b[3], 6)],
                "official_split": r.official_split,
                "role": "holdout" if r.event == HOLDOUT else "loeo",
                "model": "final" if r.event == HOLDOUT else f"fold:{r.event}",
                "reference_water_fraction": round(float(r.water_frac), 4),
                "has_optical": has_s2,
            }
        )
        print(f"{r.chip_id:20s} water={r.water_frac:.2f} model={out[-1]['model']}")
    (a.out / "chips.json").write_text(
        json.dumps(
            {
                "source": (
                    "Sen1Floods11 v1.1 hand-labelled chips (Bonafilia et al., 2020). "
                    "Cite the paper; licence not stated by the source repository."
                ),
                "s1_encoding": "int16 = round(sigma0_dB * 100), nodata -32768",
                "chips": out,
            },
            indent=2,
        )
    )
    print(f"exported {len(out)} chips to {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
