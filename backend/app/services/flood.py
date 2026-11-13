"""Flood module: Sentinel-1 SAR surface-water inference on Sen1Floods11 chips.

Terminology used throughout the API and UI:

* ``reference``: the Sen1Floods11 hand-labelled water mask (independent human
  interpretation of Sentinel-1/Sentinel-2 imagery). Treated as ground truth for
  evaluation, but note it is itself an interpretation, not a field survey.
* ``predicted_water``: model output P(water) >= threshold. Experimental.
* ``inferred_flood``: predicted water minus JRC Global Surface Water permanent
  water. This is an *inference* of flood extent, never an observation.
* ``otsu``: classic per-scene Otsu threshold baseline on VV.

Every chip is scored with a model that never saw that chip's flood event
(the final model for Bolivia, the matching leave-one-event-out fold model for
all others), so the on-screen metrics are genuine held-out results.
"""

from __future__ import annotations

import io
import json
import logging
import math
import re
import threading
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.io import MemoryFile
from rasterio.warp import transform_bounds

from terrawatch_ml.metrics import confusion, scores
from terrawatch_ml.model import WaterSegmenter, otsu_water_mask

log = logging.getLogger(__name__)
CHIP_ID = re.compile(r"^[A-Za-z-]+_\d+$")
LAYERS = ("sar", "reference", "probability", "predicted", "inferred_flood", "permanent_water", "otsu", "errors", "uncertainty", "optical")
UNCERTAIN_LOW, UNCERTAIN_HIGH = 0.25, 0.75
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_UPLOAD_PX = 2048


@dataclass
class ChipResult:
    prob: np.ndarray
    pred: np.ndarray
    otsu: np.ndarray
    s1: np.ndarray
    label: np.ndarray | None
    jrc: np.ndarray | None
    stats: dict


def _png(rgba: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buf, "PNG", optimize=True)
    return buf.getvalue()


def _sar_rgba(vv: np.ndarray) -> np.ndarray:
    v = np.clip((vv + 25.0) / 25.0, 0, 1)  # -25..0 dB stretch
    g = (np.nan_to_num(v) * 255).astype(np.uint8)
    a = np.where(np.isfinite(vv), 255, 0).astype(np.uint8)
    return np.dstack([g, g, g, a])


def _mask_rgba(mask: np.ndarray, color: tuple[int, int, int], alpha: int = 200) -> np.ndarray:
    out = np.zeros(mask.shape + (4,), dtype=np.uint8)
    out[mask] = (*color, alpha)
    return out


def _prob_rgba(prob: np.ndarray) -> np.ndarray:
    # Sequential blue ramp; transparent where P(water) < 0.1 or no data.
    p = np.nan_to_num(prob, nan=0.0)
    stops = np.array([[0.10, 30, 64, 120], [0.5, 40, 140, 220], [1.0, 150, 235, 255]])
    r = np.interp(p, stops[:, 0], stops[:, 1])
    g = np.interp(p, stops[:, 0], stops[:, 2])
    b = np.interp(p, stops[:, 0], stops[:, 3])
    a = np.where((p >= 0.1) & np.isfinite(prob), 60 + 180 * p, 0)
    return np.dstack([r, g, b, a]).astype(np.uint8)


def _json_safe(v):
    """Replace NaN/inf (e.g. precision with no predicted water) by None so the response is valid JSON."""
    if isinstance(v, dict):
        return {k: _json_safe(x) for k, x in v.items()}
    if isinstance(v, list | tuple):
        return [_json_safe(x) for x in v]
    if isinstance(v, float) and not math.isfinite(v):
        return None
    return v


def pixel_area_km2(transform, lat: float) -> float:
    return abs(transform.a) * 111.320 * math.cos(math.radians(lat)) * abs(transform.e) * 110.574


class FloodService:
    def __init__(self, demo_dir: Path, artifacts_dir: Path, reports_dir: Path):
        self.demo_dir = demo_dir
        self.artifacts_dir = artifacts_dir
        self.reports_dir = reports_dir
        self._models: dict[str, WaterSegmenter] = {}
        self._cache: OrderedDict[str, ChipResult] = OrderedDict()
        self._lock = threading.Lock()
        idx = demo_dir / "chips.json"
        listed: list[dict] = json.loads(idx.read_text())["chips"] if idx.exists() else []
        # Rasters are fetched separately (ml/scripts/fetch_flood_demo.py); only serve chips present on disk.
        self.chips = [c for c in listed if (demo_dir / "s1" / f"{c['chip_id']}.tif").exists()]
        self.missing_rasters = len(listed) - len(self.chips)
        self.by_id = {c["chip_id"]: c for c in self.chips}

    @property
    def available(self) -> bool:
        return bool(self.chips) and (self.artifacts_dir / "water_segmenter.joblib").exists()

    def model(self, name: str) -> WaterSegmenter:
        if name not in self._models:
            path = self.artifacts_dir / ("water_segmenter.joblib" if name == "final" else f"folds/{name.removeprefix('fold:')}.joblib")
            if not path.exists():
                raise FileNotFoundError(f"model artifact {path.name} missing; run ml/scripts/train.py")
            self._models[name] = WaterSegmenter.load(path)
        return self._models[name]

    def model_card(self) -> dict:
        p = self.reports_dir / "metrics.json"
        return json.loads(p.read_text()) if p.exists() else {}

    # ------------------------------------------------------------------ chips
    def _read(self, chip_id: str):
        if not CHIP_ID.match(chip_id) or chip_id not in self.by_id:
            raise KeyError(chip_id)
        with rasterio.open(self.demo_dir / "s1" / f"{chip_id}.tif") as r:
            raw = r.read().astype(np.float32)
            s1 = np.where(raw == -32768, np.nan, raw / 100.0)
            transform = r.transform
        with rasterio.open(self.demo_dir / "label" / f"{chip_id}.tif") as r:
            label = r.read(1).astype(np.int16)
        with rasterio.open(self.demo_dir / "jrc" / f"{chip_id}.tif") as r:
            jrc = r.read(1) > 0
        return s1, label, jrc, transform

    def analyse(self, chip_id: str) -> ChipResult:
        with self._lock:
            if chip_id in self._cache:
                self._cache.move_to_end(chip_id)
                return self._cache[chip_id]
        meta = self.by_id.get(chip_id)
        if meta is None:
            raise KeyError(chip_id)
        s1, label, jrc, transform = self._read(chip_id)
        model = self.model(meta["model"])
        prob = model.predict_proba(s1)
        pred = np.isfinite(prob) & (prob >= model.threshold)
        otsu = otsu_water_mask(s1)
        stats = self._stats(prob, pred, otsu, label, jrc, transform, meta["bbox"])
        stats["model"] = {
            "name": meta["model"],
            "role": model.metadata.get("role"),
            "trained_on_events": model.metadata.get("trained_on_events"),
            "excluded_events": model.metadata.get("excluded_events"),
            "threshold": model.threshold,
        }
        res = ChipResult(prob, pred, otsu, s1, label, jrc, stats)
        with self._lock:
            self._cache[chip_id] = res
            while len(self._cache) > 24:
                self._cache.popitem(last=False)
        return res

    @staticmethod
    def _stats(prob, pred, otsu, label, jrc, transform, bbox) -> dict:
        lat = (bbox[1] + bbox[3]) / 2
        px = pixel_area_km2(transform, lat)
        valid = np.isfinite(prob)
        unc = valid & (prob > UNCERTAIN_LOW) & (prob < UNCERTAIN_HIGH)
        out = {
            "valid_fraction": float(valid.mean()),
            "pixel_area_km2": px,
            "predicted_water_km2": float(pred.sum() * px),
            "permanent_water_km2": float((jrc & valid).sum() * px) if jrc is not None else None,
            "inferred_flood_km2": float((pred & ~jrc).sum() * px) if jrc is not None else None,
            "otsu_water_km2": float(otsu.sum() * px),
            "uncertain_fraction": float(unc.sum() / max(valid.sum(), 1)),
            "mean_probability_in_predicted": float(np.nanmean(prob[pred])) if pred.any() else None,
            "uncertainty_band": [UNCERTAIN_LOW, UNCERTAIN_HIGH],
        }
        if label is not None:
            ok = valid & (label != -1)
            t = label[ok] == 1
            out["reference_water_km2"] = float(t.sum() * px)
            out["reference_labelled_fraction"] = float(ok.mean())
            out["model_vs_reference"] = scores(confusion(t, pred[ok]))
            out["model_vs_reference"]["confusion_matrix"] = confusion(t, pred[ok]).tolist()
            out["otsu_vs_reference"] = scores(confusion(t, otsu[ok]))
        return _json_safe(out)

    def layer_png(self, chip_id: str, layer: str) -> bytes:
        if layer not in LAYERS:
            raise ValueError(f"unknown layer {layer}")
        if layer == "optical":
            p = self.demo_dir / "s2" / f"{chip_id}.png"
            if chip_id not in self.by_id or not p.exists():
                raise KeyError(chip_id)
            return p.read_bytes()
        r = self.analyse(chip_id)
        if layer == "sar":
            rgba = _sar_rgba(r.s1[0])
        elif layer == "reference":
            rgba = _mask_rgba(r.label == 1, (255, 255, 255), 210)
            rgba[r.label == -1] = (120, 120, 140, 70)
        elif layer == "probability":
            rgba = _prob_rgba(r.prob)
        elif layer == "predicted":
            rgba = _mask_rgba(r.pred, (56, 189, 248), 210)
        elif layer == "inferred_flood":
            rgba = _mask_rgba(r.pred & ~r.jrc, (34, 211, 238), 220)
        elif layer == "permanent_water":
            rgba = _mask_rgba(r.jrc, (37, 99, 235), 220)
        elif layer == "otsu":
            rgba = _mask_rgba(r.otsu, (250, 204, 21), 200)
        elif layer == "errors":
            ok = r.label != -1
            t = r.label == 1
            rgba = np.zeros(r.pred.shape + (4,), dtype=np.uint8)
            rgba[ok & t & r.pred] = (52, 211, 153, 190)  # true positive
            rgba[ok & ~t & r.pred] = (248, 113, 113, 220)  # false positive
            rgba[ok & t & ~r.pred] = (251, 191, 36, 220)  # false negative
        else:  # uncertainty
            p = np.nan_to_num(r.prob, nan=0.0)
            u = 1 - np.abs(2 * p - 1)  # 1 at p=0.5, 0 at p in {0,1}
            rgba = np.zeros(p.shape + (4,), dtype=np.uint8)
            rgba[..., 0], rgba[..., 1], rgba[..., 2] = 236, 72, 153
            rgba[..., 3] = np.where(np.isfinite(r.prob), (u**1.5) * 230, 0).astype(np.uint8)
        return _png(rgba)

    # ------------------------------------------------------------------ uploads
    def predict_upload(self, data: bytes) -> tuple[bytes, dict]:
        """Run the final model on a user GeoTIFF: 2 bands (VV, VH) in dB, <= 2048 px per side."""
        if len(data) > MAX_UPLOAD_BYTES:
            raise ValueError("file too large (max 25 MB)")
        if data[:4] not in (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+"):
            raise ValueError("not a GeoTIFF")
        try:
            with MemoryFile(data) as mf, mf.open() as r:
                if r.count < 2:
                    raise ValueError("expected 2 bands (VV, VH in dB)")
                if r.width > MAX_UPLOAD_PX or r.height > MAX_UPLOAD_PX:
                    raise ValueError(f"raster too large (max {MAX_UPLOAD_PX} px per side)")
                if r.crs is None:
                    raise ValueError("raster has no CRS")
                s1 = r.read([1, 2]).astype(np.float32)
                if r.nodata is not None:
                    s1[s1 == r.nodata] = np.nan
                bounds = transform_bounds(r.crs, "EPSG:4326", *r.bounds)
                transform, crs = r.transform, r.crs
        except rasterio.errors.RasterioError as exc:
            raise ValueError("could not read GeoTIFF") from exc
        finite = s1[np.isfinite(s1)]
        if finite.size == 0:
            raise ValueError("raster contains no valid data")
        med = float(np.median(finite))
        warnings = []
        if med > 1.0 or med < -40:
            warnings.append(f"median value {med:.2f} does not look like sigma0 in dB (expected about -25..-5)")
        if not crs.is_geographic:
            warnings.append("raster is projected; overlay corners are approximated in WGS84")
        model = self.model("final")
        prob = model.predict_proba(s1)
        pred = np.isfinite(prob) & (prob >= model.threshold)
        lat = (bounds[1] + bounds[3]) / 2
        px = pixel_area_km2(transform, lat) if crs.is_geographic else abs(transform.a * transform.e) / 1e6
        valid = np.isfinite(prob)
        stats = {
            "bounds": list(bounds),
            "shape": list(s1.shape[1:]),
            "predicted_water_km2": float(pred.sum() * px),
            "valid_fraction": float(valid.mean()),
            "uncertain_fraction": float((valid & (prob > UNCERTAIN_LOW) & (prob < UNCERTAIN_HIGH)).sum() / max(valid.sum(), 1)),
            "warnings": warnings,
            "caveat": (
                "Experimental prediction on user data. The model was trained on Sen1Floods11 GEE sigma0 dB chips; "
                "differently processed imagery (e.g. RTC gamma0, no speckle handling) causes distribution shift."
            ),
        }
        return _png(_prob_rgba(prob)), _json_safe(stats)
