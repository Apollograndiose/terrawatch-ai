"""Model wrapper shared by the training pipeline and the FastAPI backend."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier

from .features import FEATURE_NAMES, compute_features, otsu_threshold

DEFAULT_PARAMS = {
    "max_iter": 300,
    "learning_rate": 0.1,
    "max_leaf_nodes": 31,
    "min_samples_leaf": 50,
    "l2_regularization": 1.0,
    "early_stopping": False,
    "random_state": 0,
}


def make_classifier(**overrides) -> HistGradientBoostingClassifier:
    return HistGradientBoostingClassifier(**{**DEFAULT_PARAMS, **overrides})


@dataclass
class WaterSegmenter:
    """Per-pixel gradient-boosted classifier for open surface water in Sentinel-1 VV/VH (dB)."""

    clf: HistGradientBoostingClassifier
    threshold: float = 0.5
    metadata: dict = field(default_factory=dict)

    def predict_proba(self, s1: np.ndarray, batch: int = 262_144) -> np.ndarray:
        """Return P(water) with shape (H, W); NaN where input is no-data."""
        X, valid = compute_features(s1)
        prob = np.full(X.shape[0], np.nan, dtype=np.float32)
        idx = np.flatnonzero(valid)
        for i in range(0, idx.size, batch):
            j = idx[i : i + batch]
            prob[j] = self.clf.predict_proba(X[j])[:, 1]
        return prob.reshape(s1.shape[1:])

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump({"clf": self.clf, "threshold": self.threshold, "metadata": self.metadata}, path, compress=3)
        path.with_suffix(".json").write_text(json.dumps(self.metadata, indent=2, default=str))

    @classmethod
    def load(cls, path: Path) -> WaterSegmenter:
        obj = joblib.load(path)
        if obj["metadata"].get("feature_names") != FEATURE_NAMES:
            raise ValueError(f"{path}: feature set mismatch; retrain the model")
        return cls(obj["clf"], obj["threshold"], obj["metadata"])


def otsu_water_mask(s1: np.ndarray) -> np.ndarray:
    """Baseline: per-scene Otsu threshold on VV backscatter (water = below threshold)."""
    vv = s1[0]
    thr = otsu_threshold(vv)
    return np.isfinite(vv) & (vv < thr)


def fixed_threshold_mask(s1: np.ndarray, thr_db: float) -> np.ndarray:
    vv = s1[0]
    return np.isfinite(vv) & (vv < thr_db)
