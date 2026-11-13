"""Segmentation metrics with chip-level bootstrap confidence intervals."""

from __future__ import annotations

import numpy as np


def confusion(y_true: np.ndarray, y_pred: np.ndarray) -> np.ndarray:
    """2x2 confusion matrix [[TN, FP], [FN, TP]] over valid pixels (labels in {0,1})."""
    t = y_true.astype(bool)
    p = y_pred.astype(bool)
    return np.array([[np.sum(~t & ~p), np.sum(~t & p)], [np.sum(t & ~p), np.sum(t & p)]], dtype=np.int64)


def scores(cm: np.ndarray) -> dict[str, float]:
    tn, fp, fn, tp = (float(v) for v in cm.ravel())
    total = tn + fp + fn + tp

    def div(a: float, b: float) -> float:
        return a / b if b else float("nan")

    precision = div(tp, tp + fp)
    recall = div(tp, tp + fn)
    f1 = div(2 * tp, 2 * tp + fp + fn)
    iou = div(tp, tp + fp + fn)
    acc = div(tp + tn, total)
    pe = div((tp + fp) * (tp + fn) + (tn + fn) * (tn + fp), total * total)
    kappa = div(acc - pe, 1 - pe) if total else float("nan")
    return {
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "iou": iou,
        "accuracy": acc,
        "kappa": kappa,
        "support_water": tp + fn,
        "support_total": total,
    }


def bootstrap_ci(
    per_chip_cms: list[np.ndarray], n_boot: int = 1000, seed: int = 0, metrics: tuple[str, ...] = ("precision", "recall", "f1", "iou")
) -> dict[str, list[float]]:
    """95% percentile CI by resampling chips with replacement (pixels within a chip are not independent)."""
    if not per_chip_cms:
        return {}
    rng = np.random.default_rng(seed)
    cms = np.stack(per_chip_cms)
    out: dict[str, list[float]] = {m: [] for m in metrics}
    for _ in range(n_boot):
        idx = rng.integers(0, len(cms), len(cms))
        s = scores(cms[idx].sum(0))
        for m in metrics:
            out[m].append(s[m])
    return {m: [float(np.nanpercentile(v, 2.5)), float(np.nanpercentile(v, 97.5))] for m, v in out.items()}


def reliability(y_true: np.ndarray, prob: np.ndarray, bins: int = 10) -> dict:
    edges = np.linspace(0, 1, bins + 1)
    idx = np.clip(np.digitize(prob, edges) - 1, 0, bins - 1)
    rows = []
    ece = 0.0
    for b in range(bins):
        m = idx == b
        if not m.any():
            continue
        conf = float(prob[m].mean())
        acc = float(y_true[m].mean())
        rows.append(
            {"bin_low": float(edges[b]), "bin_high": float(edges[b + 1]), "mean_prob": conf, "observed_freq": acc, "count": int(m.sum())}
        )
        ece += m.mean() * abs(conf - acc)
    brier = float(np.mean((prob - y_true) ** 2))
    return {"bins": rows, "ece": float(ece), "brier": brier}
