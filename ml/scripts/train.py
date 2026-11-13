"""Train and evaluate the TerraWatch SAR surface-water model on Sen1Floods11.

    python ml/scripts/train.py --data ml/data/sen1floods11

Evaluation protocol (all numbers in ml/reports are produced by this script):

1. Leave-one-event-out (LOEO) cross-validation over the 10 development flood
   events (all hand-labelled events except Bolivia). Each event is evaluated by
   a model that never saw any chip from that event, preventing the spatial and
   temporal leakage that a random chip split allows (adjacent chips from the
   same acquisition are highly correlated).
2. A final model trained on all 10 development events is evaluated on the
   Bolivia event, which the dataset authors reserved as an out-of-distribution
   test set and which is never used for training or model selection here.
3. For comparability with published work only, a model trained on the
   official random ``train`` split is scored on the official ``test`` split.
   That split shares events with training, so it is reported as optimistic.

Baselines, evaluated on exactly the same pixels:
* Otsu: per-chip Otsu threshold on VV (classic unsupervised SAR water mapping).
* Fixed threshold: one global VV threshold chosen to maximise F1 on the
  training events of each fold.
* Published Otsu: the ``S1OtsuLabelHand`` masks distributed with Sen1Floods11
  (the dataset authors' Otsu-threshold product), scored as-is.

Metrics are computed over all valid labelled pixels (label != -1 and finite
S1). 95% CIs come from a bootstrap over chips.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from terrawatch_ml.data import event_folds, load_index, read_label, read_published_otsu, read_s1  # noqa: E402
from terrawatch_ml.features import FEATURE_NAMES, compute_features  # noqa: E402
from terrawatch_ml.metrics import bootstrap_ci, confusion, reliability, scores  # noqa: E402
from terrawatch_ml.model import (  # noqa: E402
    DEFAULT_PARAMS,
    WaterSegmenter,
    fixed_threshold_mask,
    make_classifier,
    otsu_water_mask,
)

HOLDOUT = ("Bolivia",)


def sample_chip(root: Path, chip: str, n: int, rng: np.random.Generator):
    s1, _ = read_s1(root, chip)
    y = read_label(root, chip).reshape(-1)
    X, valid = compute_features(s1)
    ok = np.flatnonzero(valid & (y != -1))
    if ok.size == 0:
        return None
    pick = rng.choice(ok, size=min(n, ok.size), replace=False)
    return X[pick], y[pick].astype(np.uint8), s1[0].reshape(-1)[pick]


def build_cache(root: Path, index: pd.DataFrame, n: int, cache: Path) -> dict:
    if cache.exists():
        z = np.load(cache, allow_pickle=True)
        return {k: z[k] for k in z.files}
    rng = np.random.default_rng(42)
    Xs, ys, vvs, chips = [], [], [], []
    for i, chip in enumerate(index.chip_id):
        r = sample_chip(root, chip, n, rng)
        if r is None:
            continue
        Xs.append(r[0])
        ys.append(r[1])
        vvs.append(r[2])
        chips.append(np.full(len(r[1]), chip, dtype=object))
        if (i + 1) % 50 == 0:
            print(f"  features {i + 1}/{len(index)}", flush=True)
    out = {"X": np.concatenate(Xs), "y": np.concatenate(ys), "vv": np.concatenate(vvs), "chip": np.concatenate(chips).astype(str)}
    cache.parent.mkdir(parents=True, exist_ok=True)
    np.savez(cache, **out)
    return out


def best_fixed_threshold(vv: np.ndarray, y: np.ndarray) -> float:
    grid = np.arange(-30, -5, 0.25)
    f1s = []
    for t in grid:
        cm = confusion(y, vv < t)
        f1s.append(scores(cm)["f1"])
    return float(grid[int(np.nanargmax(f1s))])


def evaluate_chips(root: Path, chips: list[str], model: WaterSegmenter, fixed_thr: float, collect_probs: bool = True):
    """Score model and baselines on every valid pixel of every chip."""
    per: dict[str, list] = {"model": [], "otsu": [], "fixed": [], "otsu_published": []}
    rows = []
    probs, truths = [], []
    for chip in chips:
        s1, _ = read_s1(root, chip)
        y = read_label(root, chip)
        prob = model.predict_proba(s1)
        valid = (y != -1) & np.isfinite(prob)
        t = y[valid] == 1
        preds = {
            "model": prob[valid] >= model.threshold,
            "otsu": otsu_water_mask(s1)[valid],
            "fixed": fixed_threshold_mask(s1, fixed_thr)[valid],
        }
        if model.threshold != 0.5:
            preds["model_at_0.5"] = prob[valid] >= 0.5
        pub = read_published_otsu(root, chip)
        if pub is not None:
            preds["otsu_published"] = pub[valid] == 1
        row = {
            "chip_id": chip,
            "event": chip.rsplit("_", 1)[0],
            "valid_px": int(valid.sum()),
            "water_frac": float(t.mean()) if t.size else float("nan"),
        }
        for k, p in preds.items():
            cm = confusion(t, p)
            per.setdefault(k, []).append(cm)
            s = scores(cm)
            row[f"{k}_f1"] = s["f1"]
            row[f"{k}_iou"] = s["iou"]
        rows.append(row)
        if collect_probs and t.size:
            sel = np.random.default_rng(len(rows)).choice(t.size, size=min(20_000, t.size), replace=False)
            probs.append(prob[valid][sel])
            truths.append(t[sel].astype(np.float32))
    return per, rows, (np.concatenate(probs) if probs else np.array([])), (np.concatenate(truths) if truths else np.array([]))


def summarise(per: dict) -> dict:
    out = {}
    for k, cms in per.items():
        total = np.sum(cms, axis=0) if cms else np.zeros((2, 2), int)
        out[k] = {"confusion_matrix": total.tolist(), **scores(total), "ci95": bootstrap_ci(cms)}
    return out


def fit(data: dict, mask: np.ndarray, meta: dict) -> tuple[WaterSegmenter, float]:
    clf = make_classifier()
    t0 = time.time()
    clf.fit(data["X"][mask], data["y"][mask])
    fixed = best_fixed_threshold(data["vv"][mask], data["y"][mask])
    meta = {**meta, "fit_seconds": round(time.time() - t0, 1), "train_samples": int(mask.sum()), "fixed_threshold_db": fixed}
    return WaterSegmenter(clf, 0.5, meta), fixed


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data", type=Path, default=Path("ml/data/sen1floods11"))
    p.add_argument("--samples-per-chip", type=int, default=5000)
    p.add_argument("--artifacts", type=Path, default=Path("ml/artifacts"))
    p.add_argument("--reports", type=Path, default=Path("ml/reports"))
    p.add_argument("--skip-official", action="store_true")
    a = p.parse_args()

    index = load_index(a.data)
    print(f"{len(index)} chips, events: {sorted(index.event.unique())}")
    data = build_cache(a.data, index, a.samples_per_chip, a.data / "cache" / f"samples_{a.samples_per_chip}.npz")
    chip_event = dict(zip(index.chip_id, index.event, strict=True))
    ev = np.array([chip_event[c] for c in data["chip"]])
    base_meta = {
        "task": "per-pixel open surface water segmentation (Sentinel-1 VV/VH dB)",
        "dataset": "Sen1Floods11 v1.1 hand-labelled subset (Bonafilia et al., 2020)",
        "feature_names": FEATURE_NAMES,
        "classifier": "sklearn.ensemble.HistGradientBoostingClassifier",
        "params": DEFAULT_PARAMS,
        "samples_per_chip": a.samples_per_chip,
        "sklearn_version": sklearn.__version__,
        "python": platform.python_version(),
        "created_utc": datetime.now(UTC).isoformat(),
        "threshold": 0.5,
    }

    # ---- 1. Leave-one-event-out CV -------------------------------------------------
    folds = event_folds(index, HOLDOUT)
    loeo_per = {"model": [], "otsu": [], "fixed": [], "otsu_published": []}
    loeo_rows, loeo_probs, loeo_truth, per_event = [], [], [], []
    for test_event, train_chips, test_chips in folds:
        mask = np.isin(data["chip"], train_chips)
        model, fixed = fit(
            data,
            mask,
            {
                **base_meta,
                "trained_on_events": sorted(set(ev[mask])),
                "excluded_events": [test_event, *HOLDOUT],
                "role": f"loeo_fold:{test_event}",
            },
        )
        per, rows, pr, tr = evaluate_chips(a.data, test_chips, model, fixed)
        for k in loeo_per:
            loeo_per[k] += per[k]
        loeo_rows += rows
        loeo_probs.append(pr)
        loeo_truth.append(tr)
        s = summarise(per)
        per_event.append(
            {
                "event": test_event,
                "chips": len(test_chips),
                "fixed_threshold_db": fixed,
                **{f"{k}_{m}": s[k][m] for k in s for m in ("precision", "recall", "f1", "iou")},
            }
        )
        model.save(a.artifacts / "folds" / f"{test_event}.joblib")
        print(
            f"[LOEO] {test_event:10s} model F1={s['model']['f1']:.3f} IoU={s['model']['iou']:.3f} | "
            f"otsu F1={s['otsu']['f1']:.3f} | fixed F1={s['fixed']['f1']:.3f} | "
            f"published-otsu F1={s['otsu_published']['f1']:.3f}",
            flush=True,
        )
    loeo = summarise(loeo_per)
    oof_p, oof_t = np.concatenate(loeo_probs), np.concatenate(loeo_truth)
    loeo["reliability"] = reliability(oof_t, oof_p)
    # Decision threshold chosen on pooled out-of-fold LOEO predictions only (never on Bolivia).
    grid = np.round(np.arange(0.05, 0.951, 0.025), 3)
    f1_by_thr = [scores(confusion(oof_t > 0.5, oof_p >= t))["f1"] for t in grid]
    tuned_thr = float(grid[int(np.nanargmax(f1_by_thr))])
    loeo["threshold_selection"] = {
        "grid": grid.tolist(),
        "oof_f1": [float(v) for v in f1_by_thr],
        "selected": tuned_thr,
        "note": "pooled out-of-fold predictions (<=20k sampled pixels per chip)",
    }
    print(f"[threshold] selected {tuned_thr} from LOEO out-of-fold F1", flush=True)

    # ---- 2. Final model on all development events, tested on Bolivia ----------------
    dev_mask = ~np.isin(ev, HOLDOUT)
    final, fixed = fit(
        data,
        dev_mask,
        {
            **base_meta,
            "trained_on_events": sorted(set(ev[dev_mask])),
            "excluded_events": list(HOLDOUT),
            "role": "final",
            "threshold": tuned_thr,
        },
    )
    final.threshold = tuned_thr
    bol_chips = index.loc[index.event.isin(HOLDOUT), "chip_id"].tolist()
    per, bol_rows, pr, tr = evaluate_chips(a.data, bol_chips, final, fixed)
    bolivia = summarise(per)
    bolivia["reliability"] = reliability(tr, pr)
    final.save(a.artifacts / "water_segmenter.joblib")
    print(
        f"[Bolivia] model@{tuned_thr} F1={bolivia['model']['f1']:.3f} IoU={bolivia['model']['iou']:.3f} | "
        f"model@0.5 F1={bolivia['model_at_0.5']['f1']:.3f} | published-otsu F1={bolivia['otsu_published']['f1']:.3f} | "
        f"otsu F1={bolivia['otsu']['f1']:.3f} | fixed F1={bolivia['fixed']['f1']:.3f}"
    )

    # Permutation importance on held-out Bolivia samples (model never saw them).
    from sklearn.inspection import permutation_importance

    bm = np.isin(ev, HOLDOUT)
    rng = np.random.default_rng(0)
    sel = rng.choice(np.flatnonzero(bm), size=min(30_000, int(bm.sum())), replace=False)
    pi = permutation_importance(final.clf, data["X"][sel], data["y"][sel], scoring="f1", n_repeats=3, random_state=0)
    importance = sorted(
        [
            {"feature": f, "mean": float(m), "std": float(s)}
            for f, m, s in zip(FEATURE_NAMES, pi.importances_mean, pi.importances_std, strict=True)
        ],
        key=lambda r: -r["mean"],
    )

    # ---- 3. Official random split (optimistic, for literature comparison) ----------
    official = None
    if not a.skip_official:
        tr_chips = index.loc[index.official_split == "train", "chip_id"].tolist()
        te_chips = index.loc[index.official_split == "test", "chip_id"].tolist()
        m_off, fixed_off = fit(data, np.isin(data["chip"], tr_chips), {**base_meta, "role": "official_split"})
        per, _, _, _ = evaluate_chips(a.data, te_chips, m_off, fixed_off, collect_probs=False)
        official = summarise(per)
        print(f"[official test] model F1={official['model']['f1']:.3f} | otsu F1={official['otsu']['f1']:.3f}")

    a.reports.mkdir(parents=True, exist_ok=True)
    cache_hash = hashlib.sha256(np.ascontiguousarray(data["y"]).tobytes()).hexdigest()[:16]
    report = {
        "generated_utc": datetime.now(UTC).isoformat(),
        "model": base_meta,
        "label_sample_hash": cache_hash,
        "protocol": {
            "holdout_events": list(HOLDOUT),
            "loeo_events": [f[0] for f in folds],
            "threshold_loeo": 0.5,
            "threshold_final": tuned_thr,
            "threshold_history": (
                "Initial protocol used 0.5 for the final model. After the first Bolivia evaluation showed "
                "low recall, threshold selection on LOEO out-of-fold predictions was added. Bolivia "
                "results are reported at both thresholds (model, model_at_0.5)."
            ),
            "metric_unit": "pixels (10 m), valid hand-labelled pixels only; CI = chip bootstrap, 1000 resamples",
        },
        "loeo": loeo,
        "loeo_per_event": per_event,
        "bolivia_holdout": bolivia,
        "official_random_split": official,
        "permutation_importance_bolivia": importance,
    }
    (a.reports / "metrics.json").write_text(json.dumps(report, indent=2, default=float))
    pd.DataFrame(loeo_rows + bol_rows).to_csv(a.reports / "per_chip_metrics.csv", index=False)
    print(f"wrote {a.reports / 'metrics.json'}")
    joblib.dump({"chip_event": chip_event}, a.artifacts / "chip_index.joblib")
    return 0


if __name__ == "__main__":
    sys.exit(main())
