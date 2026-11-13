"""Sen1Floods11 hand-labelled chip loading and event-grouped splitting."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio

LABEL_NODATA = -1


@dataclass(frozen=True)
class Chip:
    chip_id: str
    event: str
    official_split: str


def load_index(root: Path) -> pd.DataFrame:
    df = pd.read_csv(root / "splits.csv")
    df["event"] = df["chip_id"].str.rsplit("_", n=1).str[0]
    return df


def read_s1(root: Path, chip_id: str) -> tuple[np.ndarray, dict]:
    with rasterio.open(root / "S1Hand" / f"{chip_id}_S1Hand.tif") as r:
        arr = r.read().astype(np.float32)
        meta = {"transform": r.transform, "crs": r.crs, "bounds": tuple(r.bounds), "shape": (r.height, r.width)}
    return arr, meta


def read_label(root: Path, chip_id: str) -> np.ndarray:
    with rasterio.open(root / "LabelHand" / f"{chip_id}_LabelHand.tif") as r:
        return r.read(1).astype(np.int16)


def read_published_otsu(root: Path, chip_id: str) -> np.ndarray | None:
    """The dataset authors' Otsu-threshold water mask (S1OtsuLabelHand), if downloaded."""
    p = root / "S1OtsuLabelHand" / f"{chip_id}_S1OtsuLabelHand.tif"
    if not p.exists():
        return None
    with rasterio.open(p) as r:
        return r.read(1).astype(np.int16)


def read_jrc(root: Path, chip_id: str) -> np.ndarray:
    """JRC Global Surface Water permanent-water mask resampled to the chip (1 = permanent water)."""
    p = root / "JRCWaterHand" / f"{chip_id}_JRCWaterHand.tif"
    with rasterio.open(p) as r:
        return (r.read(1) > 0).astype(np.uint8)


def event_folds(index: pd.DataFrame, holdout_events: tuple[str, ...]) -> list[tuple[str, list[str], list[str]]]:
    """Leave-one-event-out folds over events not in ``holdout_events``.

    Each fold returns (test_event, train_chip_ids, test_chip_ids). Grouping by
    flood event prevents spatial (adjacent chips) and temporal (same acquisition)
    leakage between training and evaluation data.
    """
    dev = index[~index["event"].isin(holdout_events)]
    folds = []
    for ev in sorted(dev["event"].unique()):
        folds.append((ev, dev.loc[dev.event != ev, "chip_id"].tolist(), dev.loc[dev.event == ev, "chip_id"].tolist()))
    return folds
