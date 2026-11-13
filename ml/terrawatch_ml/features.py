"""Per-pixel feature engineering for Sentinel-1 SAR surface-water segmentation.

Input: a (2, H, W) float32 array of Sentinel-1 GRD backscatter in decibels
(band 0 = VV, band 1 = VH), NaN where no data. This matches the Sen1Floods11
"S1Hand" chips (sigma0, dB, 10 m, processed in Google Earth Engine).

Design notes
------------
* Open water is a specular reflector, so it appears dark (low backscatter) in
  both polarisations. Single-pixel values are corrupted by multiplicative
  speckle, so we add local statistics at several window sizes and a Lee-filtered
  value, computed in linear power and converted back to dB.
* Scene-to-scene calibration and incidence-angle differences shift the whole
  histogram, so we add scene-relative features: distance from the chip median
  and from the chip's own Otsu threshold. These are unsupervised per-scene
  statistics (no labels are used).
* All filters are NaN-aware: no-data pixels contribute neither weight nor value.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage

WINDOWS = (3, 7, 15)
ENL = 4.4  # Equivalent number of looks for Sentinel-1 IW GRD high resolution (ESA product spec)

FEATURE_NAMES: list[str] = (
    ["vv", "vh", "vv_minus_vh"]
    + [f"{b}_mean{w}" for w in WINDOWS for b in ("vv", "vh")]
    + [f"{b}_std{w}" for w in WINDOWS for b in ("vv", "vh")]
    + ["vv_lee7", "vh_lee7", "vv_rel_median", "vh_rel_median", "vv_rel_otsu", "vh_rel_otsu", "valid_frac7"]
)


def otsu_threshold(values: np.ndarray, bins: int = 256) -> float:
    """Otsu (1979) threshold maximising between-class variance. NaNs ignored."""
    v = values[np.isfinite(values)]
    if v.size < 16:
        return float("nan")
    lo, hi = np.percentile(v, [0.5, 99.5])
    if hi <= lo:
        return float(lo)
    hist, edges = np.histogram(np.clip(v, lo, hi), bins=bins, range=(lo, hi))
    centers = (edges[:-1] + edges[1:]) / 2
    w0 = np.cumsum(hist)
    w1 = w0[-1] - w0
    m0 = np.cumsum(hist * centers)
    mu0 = np.divide(m0, w0, out=np.zeros_like(m0, dtype=float), where=w0 > 0)
    mu1 = np.divide(m0[-1] - m0, w1, out=np.zeros_like(m0, dtype=float), where=w1 > 0)
    between = w0 * w1 * (mu0 - mu1) ** 2
    return float(centers[int(np.argmax(between))])


def _nan_box(x: np.ndarray, size: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """NaN-aware local mean, std and valid fraction over a size x size window."""
    valid = np.isfinite(x)
    xf = np.where(valid, x, 0.0).astype(np.float64)
    w = ndimage.uniform_filter(valid.astype(np.float64), size, mode="reflect")
    s1 = ndimage.uniform_filter(xf, size, mode="reflect")
    s2 = ndimage.uniform_filter(xf * xf, size, mode="reflect")
    with np.errstate(invalid="ignore", divide="ignore"):
        mean = np.where(w > 1e-6, s1 / w, np.nan)
        var = np.where(w > 1e-6, s2 / w - mean**2, np.nan)
    return mean, np.sqrt(np.clip(var, 0, None)), w


def lee_filter_db(db: np.ndarray, size: int = 7, enl: float = ENL) -> np.ndarray:
    """Classic Lee (1980) speckle filter applied in linear power, returned in dB."""
    lin = np.power(10.0, db / 10.0)
    mean, std, _ = _nan_box(lin, size)
    var = std**2
    cu2 = 1.0 / enl
    with np.errstate(invalid="ignore", divide="ignore"):
        var_x = (var - mean**2 * cu2) / (1 + cu2)
        k = np.clip(np.where(var > 0, var_x / var, 0.0), 0.0, 1.0)
    out = mean + k * (lin - mean)
    with np.errstate(invalid="ignore", divide="ignore"):
        return 10.0 * np.log10(np.clip(out, 1e-6, None))


def compute_features(s1: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Return (features[H*W, F] float32, valid_mask[H*W] bool)."""
    if s1.ndim != 3 or s1.shape[0] != 2:
        raise ValueError(f"expected (2, H, W) VV/VH array, got {s1.shape}")
    vv = s1[0].astype(np.float64)
    vh = s1[1].astype(np.float64)
    # Clamp physically implausible values (GEE dB products occasionally contain extremes).
    vv = np.where(np.isfinite(vv), np.clip(vv, -50, 10), np.nan)
    vh = np.where(np.isfinite(vh), np.clip(vh, -50, 10), np.nan)
    valid = np.isfinite(vv) & np.isfinite(vh)

    feats: list[np.ndarray] = [vv, vh, vv - vh]
    means, stds = [], []
    valid7 = None
    for w in WINDOWS:
        for band in (vv, vh):
            m, s, wf = _nan_box(band, w)
            means.append(m)
            stds.append(s)
            if w == 7:
                valid7 = wf
    feats += means + stds
    feats += [lee_filter_db(vv), lee_filter_db(vh)]
    vv_med = np.nanmedian(vv) if valid.any() else np.nan
    vh_med = np.nanmedian(vh) if valid.any() else np.nan
    feats += [vv - vv_med, vh - vh_med, vv - otsu_threshold(vv), vh - otsu_threshold(vh)]
    feats.append(valid7 if valid7 is not None else valid.astype(float))
    X = np.stack([f.reshape(-1) for f in feats], axis=1).astype(np.float32)
    assert X.shape[1] == len(FEATURE_NAMES)
    return X, valid.reshape(-1)
