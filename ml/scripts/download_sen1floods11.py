"""Download the hand-labelled subset of the Sen1Floods11 dataset.

Source: Bonafilia et al. (2020), "Sen1Floods11: a georeferenced dataset to train
and test deep learning flood algorithms for Sentinel-1", CVPR Workshops.
Public bucket: gs://sen1floods11 (served over HTTPS by storage.googleapis.com).

Downloads (per chip): S1Hand (VV, VH sigma0 dB), LabelHand (-1 nodata, 0 dry,
1 water), JRCWaterHand (JRC permanent-water mask), S1OtsuLabelHand (the
authors' Otsu-threshold baseline masks). S2Hand (13-band optical) is
large, so it is only fetched for chips passed through --s2-for (used for the
interface's optical context view).

Usage:
    python ml/scripts/download_sen1floods11.py --out ml/data/sen1floods11
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import csv
import io
import sys
import time
import urllib.request
from pathlib import Path

BASE = "https://storage.googleapis.com/sen1floods11/v1.1"
SPLITS = {
    "train": "splits/flood_handlabeled/flood_train_data.csv",
    "valid": "splits/flood_handlabeled/flood_valid_data.csv",
    "test": "splits/flood_handlabeled/flood_test_data.csv",
    "bolivia": "splits/flood_handlabeled/flood_bolivia_data.csv",
}
LAYERS = ("S1Hand", "LabelHand", "JRCWaterHand", "S1OtsuLabelHand")


def fetch(url: str, retries: int = 4) -> bytes:
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:  # noqa: S310 (fixed https host)
                return r.read()
        except Exception:  # pragma: no cover - network
            if attempt == retries - 1:
                raise
            time.sleep(2**attempt)
    raise RuntimeError("unreachable")


def chip_ids() -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for split, rel in SPLITS.items():
        text = fetch(f"{BASE}/{rel}").decode()
        ids = []
        for row in csv.reader(io.StringIO(text)):
            if row and row[0].endswith("_S1Hand.tif"):
                ids.append(row[0].removesuffix("_S1Hand.tif"))
        out[split] = ids
    return out


def download_one(chip: str, layer: str, out: Path) -> str:
    dest = out / layer / f"{chip}_{layer}.tif"
    if dest.exists() and dest.stat().st_size > 0:
        return "cached"
    dest.parent.mkdir(parents=True, exist_ok=True)
    data = fetch(f"{BASE}/data/flood_events/HandLabeled/{layer}/{chip}_{layer}.tif")
    tmp = dest.with_suffix(".part")
    tmp.write_bytes(data)
    tmp.replace(dest)
    return "downloaded"


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", type=Path, default=Path("ml/data/sen1floods11"))
    p.add_argument("--s2-for", nargs="*", default=[], help="chip ids to also fetch S2Hand for")
    p.add_argument("--workers", type=int, default=8)
    args = p.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    splits = chip_ids()
    with open(args.out / "splits.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["chip_id", "official_split", "event"])
        for split, ids in splits.items():
            for cid in ids:
                w.writerow([cid, split, cid.rsplit("_", 1)[0]])
    meta = fetch(f"{BASE}/Sen1Floods11_Metadata.geojson")
    (args.out / "Sen1Floods11_Metadata.geojson").write_bytes(meta)

    jobs = [(c, layer) for ids in splits.values() for c in ids for layer in LAYERS]
    jobs += [(c, "S2Hand") for c in args.s2_for]
    print(f"{sum(len(v) for v in splits.values())} chips, {len(jobs)} files")
    done = 0
    with cf.ThreadPoolExecutor(args.workers) as ex:
        futs = {ex.submit(download_one, c, layer, args.out): (c, layer) for c, layer in jobs}
        for fut in cf.as_completed(futs):
            fut.result()
            done += 1
            if done % 100 == 0:
                print(f"  {done}/{len(jobs)}", flush=True)
    print("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
