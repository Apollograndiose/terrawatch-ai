import numpy as np
import pandas as pd
import pytest

from terrawatch_ml.data import event_folds
from terrawatch_ml.features import FEATURE_NAMES, compute_features, lee_filter_db, otsu_threshold
from terrawatch_ml.metrics import bootstrap_ci, confusion, reliability, scores
from terrawatch_ml.model import fixed_threshold_mask, make_classifier, otsu_water_mask


def synthetic_scene(seed=0, h=64, w=64):
    """Test-only synthetic SAR: dark 'water' block (-22 dB) in brighter land (-9 dB) with speckle."""
    rng = np.random.default_rng(seed)
    truth = np.zeros((h, w), bool)
    truth[16:48, 8:30] = True
    vv = np.where(truth, -22.0, -9.0) + rng.normal(0, 1.5, (h, w))
    vh = vv - 7 + rng.normal(0, 1.0, (h, w))
    s1 = np.stack([vv, vh]).astype(np.float32)
    s1[:, :4, :4] = np.nan  # no-data corner
    return s1, truth


def test_feature_matrix_shape_and_nan_handling():
    s1, _ = synthetic_scene()
    X, valid = compute_features(s1)
    assert X.shape == (64 * 64, len(FEATURE_NAMES))
    assert valid.sum() == 64 * 64 - 16
    assert np.isfinite(X[valid]).all(), "features must be finite wherever the input is valid"


def test_feature_input_validation():
    with pytest.raises(ValueError):
        compute_features(np.zeros((3, 8, 8), np.float32))


def test_otsu_separates_bimodal():
    rng = np.random.default_rng(1)
    v = np.concatenate([rng.normal(-22, 1, 5000), rng.normal(-9, 1, 5000)])
    t = otsu_threshold(v)
    # Otsu's criterion is flat across an empty gap, so any threshold between the modes is optimal.
    assert -20 < t < -11
    assert ((v < t) == (np.arange(v.size) < 5000)).mean() > 0.99
    assert np.isnan(otsu_threshold(np.array([np.nan] * 10)))


def test_lee_filter_reduces_speckle_variance():
    rng = np.random.default_rng(2)
    db = -10 + rng.normal(0, 2.0, (64, 64))
    assert np.nanstd(lee_filter_db(db)) < np.nanstd(db)


def test_baselines_on_synthetic_scene():
    s1, truth = synthetic_scene()
    for mask in (otsu_water_mask(s1), fixed_threshold_mask(s1, -15)):
        f1 = scores(confusion(truth, mask))["f1"]
        assert f1 > 0.9


def test_classifier_learns_synthetic_water():
    s1, truth = synthetic_scene(3)
    X, valid = compute_features(s1)
    clf = make_classifier(max_iter=30)
    y = truth.reshape(-1)
    clf.fit(X[valid], y[valid])
    s2, truth2 = synthetic_scene(4)
    X2, v2 = compute_features(s2)
    pred = clf.predict(X2[v2])
    assert scores(confusion(truth2.reshape(-1)[v2], pred))["f1"] > 0.9


def test_metrics_known_values():
    cm = confusion(np.array([1, 1, 0, 0, 1]), np.array([1, 0, 0, 1, 1]))
    assert cm.tolist() == [[1, 1], [1, 2]]
    s = scores(cm)
    assert s["precision"] == pytest.approx(2 / 3) and s["recall"] == pytest.approx(2 / 3)
    assert s["iou"] == pytest.approx(0.5) and s["f1"] == pytest.approx(2 / 3)
    assert np.isnan(scores(np.array([[5, 0], [0, 0]]))["precision"])


def test_bootstrap_ci_brackets_point_estimate():
    rng = np.random.default_rng(0)
    cms = [confusion(rng.random(200) < 0.3, rng.random(200) < 0.3) for _ in range(30)]
    ci = bootstrap_ci(cms, n_boot=200)
    point = scores(np.sum(cms, 0))["f1"]
    assert ci["f1"][0] <= point <= ci["f1"][1]


def test_reliability_perfect_calibration():
    rng = np.random.default_rng(0)
    p = rng.random(50_000)
    y = (rng.random(50_000) < p).astype(float)
    r = reliability(y, p)
    assert r["ece"] < 0.02


def test_event_folds_have_no_leakage():
    idx = pd.DataFrame({"chip_id": [f"{e}_{i}" for e in ["A", "B", "C", "Bolivia"] for i in range(3)]})
    idx["event"] = idx.chip_id.str.split("_").str[0]
    folds = event_folds(idx, ("Bolivia",))
    assert [f[0] for f in folds] == ["A", "B", "C"]
    for ev, train, test in folds:
        assert not set(train) & set(test)
        assert all(c.startswith(ev) for c in test)
        assert not any(c.startswith(ev) or c.startswith("Bolivia") for c in train)
