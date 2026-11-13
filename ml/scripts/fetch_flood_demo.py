"""Fetch the 25 flood demo chips listed in data/flood_demo/chips.json from the public Sen1Floods11 bucket.

    python ml/scripts/fetch_flood_demo.py            # ~45 MB download, ~27 MB on disk

The Sen1Floods11 rasters are not committed to this repository because the
dataset's source repository does not state a licence. This script reproduces
exactly the files written by export_flood_demo.py, without the full 720 MB
dataset.
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import urllib.request
from pathlib import Path

import numpy as np
import rasterio

sys.path.insert(0, str(Path(__file__).resolve().parent))
from export_flood_demo import s2_preview, write_tif  # noqa: E402

BASE = "https://storage.googleapis.com/sen1floods11/v1.1/data/flood_events/HandLabeled"


def fetch(layer: str, chip: str, tmp: Path) -> Path:
    p = tmp / f"{chip}_{layer}.tif"
    p.write_bytes(urllib.request.urlopen(f"{BASE}/{layer}/{chip}_{layer}.tif", timeout=120).read())  # noqa: S310
    return p


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=Path("data/flood_demo"))
    ap.add_argument("--no-s2", action="store_true")
    a = ap.parse_args()
    chips = json.loads((a.out / "chips.json").read_text())["chips"]
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        for c in chips:
            cid = c["chip_id"]
            if (a.out / "s1" / f"{cid}.tif").exists() and (a.no_s2 or (a.out / "s2" / f"{cid}.png").exists()):
                continue
            with rasterio.open(fetch("S1Hand", cid, tmp)) as r:
                s1, prof = r.read().astype(np.float32), r.profile
            with rasterio.open(fetch("LabelHand", cid, tmp)) as r:
                lab = r.read(1)
            with rasterio.open(fetch("JRCWaterHand", cid, tmp)) as r:
                jrc = (r.read(1) > 0).astype(np.uint8)
            q = np.where(np.isfinite(s1), np.round(np.clip(s1, -327, 327) * 100), -32768)
            write_tif(a.out / "s1" / f"{cid}.tif", q, prof, "int16", -32768)
            write_tif(a.out / "label" / f"{cid}.tif", lab[None], prof, "int8", None)
            write_tif(a.out / "jrc" / f"{cid}.tif", jrc[None], prof, "uint8", None)
            if not a.no_s2:
                s2_preview(cid, a.out / "s2" / f"{cid}.png")
            print(f"fetched {cid}")
    print(f"{len(chips)} chips ready in {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
