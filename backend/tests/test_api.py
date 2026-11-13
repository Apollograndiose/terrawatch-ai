"""Integration tests: the real FastAPI app on a sample of real FIRMS data and the trained model."""

import io

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from app.config import REPO_ROOT

needs_flood = pytest.mark.skipif(
    not (REPO_ROOT / "data" / "flood_demo" / "s1").exists(),
    reason="flood demo rasters not fetched (python ml/scripts/fetch_flood_demo.py)",
)


def test_health_and_status(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    s = client.get("/api/status").json()
    demo = s["datasets"]["demo"]
    assert demo["rows"] > 2900
    assert demo["latest_observation_utc"].endswith("+00:00")
    assert {f["source"] for f in demo["feeds"]} >= {"VIIRS_NOAA20_NRT", "MODIS_NRT"}
    assert s["firms_map_key_configured"] in (True, False)
    assert "attribution" in s and isinstance(s["flood_model_available"], bool)


def test_map_grid_then_points(client):
    g = client.get("/api/fires/map", params={"zoom": 2}).json()
    assert g["mode"] == "grid" and g["total"] > 500  # max_points=500 in tests
    assert sum(g["cells"]["n"]) == g["total"]
    # Zoomed in (>= 8): always points, capped at max_points (strongest FRP first) with a truncation flag.
    p = client.get("/api/fires/map", params={"zoom": 9, "bbox": "123,-21,126,-18"}).json()
    assert p["mode"] == "points" and p["returned"] <= 500
    assert p["truncated"] == (p["total"] > p["returned"])
    pts = p["points"]
    assert len(pts["id"]) == len(pts["lon"]) == p["returned"]
    assert all(123 <= x <= 126 for x in pts["lon"])
    assert pts["frp"] == sorted(pts["frp"], reverse=True)  # strongest first
    small = client.get("/api/fires/map", params={"zoom": 5, "bbox": "-60,-20,-50,-10"}).json()
    assert small["mode"] == "points" and small["total"] <= 500 and not small["truncated"]


def test_filters_reduce_counts(client):
    total = client.get("/api/analytics/summary").json()["count"]
    hi = client.get("/api/analytics/summary", params={"confidence": "high"}).json()
    assert 0 < hi["count"] < total
    assert {r["key"] for r in hi["by_confidence"]} == {"high"}
    night = client.get("/api/analytics/summary", params={"daynight": "N"}).json()
    assert {r["key"] for r in night["by_daynight"]} == {"N"}
    modis = client.get("/api/analytics/summary", params={"sources": "MODIS_NRT"}).json()
    assert {r["key"] for r in modis["by_source"]} == {"MODIS_NRT"}


def test_date_filter_and_timeseries_are_utc(client):
    ts = client.get("/api/analytics/timeseries", params={"bucket": "day"}).json()
    assert all(r["t"].endswith("T00:00:00+00:00") for r in ts["series"])
    day = ts["series"][1]["t"][:10]
    one = client.get("/api/analytics/summary", params={"start": f"{day}T00:00:00Z", "end": f"{day}T23:59:59Z"}).json()
    assert one["count"] == ts["series"][1]["total"]


@pytest.mark.parametrize(
    "params",
    [
        {"bbox": "1,2,3"},
        {"bbox": "a,b,c,d"},
        {"confidence": "extreme"},
        {"sources": "LANDSAT"},
        {"daynight": "X"},
        {"min_frp": "-1"},
        {"dataset": "prod"},
        {"start": "2026-11-10T00:00Z", "end": "2026-11-01T00:00Z"},
    ],
)
def test_invalid_input_returns_422(client, params):
    assert client.get("/api/fires/map", params=params).status_code == 422


def test_clusters_and_detail_and_detection(client):
    c = client.get("/api/fires/clusters", params={"min_detections": 3, "limit": 5}).json()
    assert c["clusters"] and "not a fire perimeter" in c["method"]["description"]
    top = c["clusters"][0]
    # Cluster ids are independent of the viewport, so a bbox around it returns the same id.
    w, s, e, n = top["bbox"]
    c2 = client.get("/api/fires/clusters", params={"min_detections": 3, "bbox": f"{w - 1},{s - 1},{e + 1},{n + 1}"}).json()
    assert top["cluster_id"] in {x["cluster_id"] for x in c2["clusters"]}
    d = client.get(f"/api/fires/clusters/{top['cluster_id']}").json()
    assert d["cluster"]["detections"] == top["detections"]
    assert sum(r["total"] for r in d["timeline_6h"]) == top["detections"]
    det_id = d["points"]["id"][0]
    det = client.get(f"/api/fires/detections/{det_id}").json()
    assert det["detection"]["id"] == det_id and det["detection"]["source"] in top["sources"]
    assert client.get("/api/fires/detections/0000000000000000").status_code == 404
    assert client.get("/api/fires/clusters/c000000000000").status_code == 404
    assert client.get("/api/fires/detections/not-an-id").status_code == 422


def test_live_falls_back_to_demo_when_not_loaded(client):
    r = client.get("/api/analytics/summary", params={"dataset": "live"}).json()
    assert r["dataset_served"] == "demo" and r["fallback"] is True


def test_history(client):
    countries = client.get("/api/analytics/history/countries").json()["countries"]
    assert "Australia" in countries
    h = client.get("/api/analytics/history", params={"country": "Australia"}).json()
    assert h["years"][0] == 2012 and len(h["monthly"]) == 12 * len(h["years"])
    allt = client.get("/api/analytics/history", params={"country": "Australia", "vegetation_only": False}).json()
    assert sum(r["count"] for r in allt["annual"]) >= sum(r["count"] for r in h["annual"])
    assert client.get("/api/analytics/history", params={"country": "Atlantis"}).status_code == 404
    assert client.get("/api/analytics/history", params={"country": "../etc"}).status_code == 422


@needs_flood
def test_flood_chip_inference_uses_held_out_model(client):
    chips = client.get("/api/flood/chips").json()["chips"]
    assert len(chips) == 25
    bol = next(c for c in chips if c["role"] == "holdout")
    r = client.get(f"/api/flood/chips/{bol['chip_id']}").json()["stats"]
    assert r["model"]["role"] == "final" and "Bolivia" in r["model"]["excluded_events"]
    assert 0 <= r["model_vs_reference"]["f1"] <= 1
    assert r["inferred_flood_km2"] <= r["predicted_water_km2"] + 1e-9
    other = next(c for c in chips if c["role"] == "loeo")
    r2 = client.get(f"/api/flood/chips/{other['chip_id']}").json()["stats"]
    assert other["event"] in r2["model"]["excluded_events"]
    png = client.get(f"/api/flood/chips/{bol['chip_id']}/layers/errors.png")
    assert png.status_code == 200 and png.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert client.get(f"/api/flood/chips/{bol['chip_id']}/layers/secret.png").status_code == 404
    assert client.get("/api/flood/chips/Nowhere_1").status_code == 404


@needs_flood
def test_every_demo_chip_returns_valid_json(client):
    """Regression: a chip with undefined metrics (e.g. no predicted water) used to return NaN and HTTP 500."""
    for c in client.get("/api/flood/chips").json()["chips"]:
        r = client.get(f"/api/flood/chips/{c['chip_id']}")
        assert r.status_code == 200, c["chip_id"]


def test_mixed_timezone_filter_is_accepted(client):
    r = client.get("/api/fires/map", params={"start": "2026-11-05T00:00:00Z", "end": "2026-11-06T00:00:00"})
    assert r.status_code == 200


@needs_flood
def test_flood_upload_roundtrip_and_validation(client):
    # Real Sentinel-1 data: a demo chip converted back to float dB.
    with rasterio.open(REPO_ROOT / "data" / "flood_demo" / "s1" / "Bolivia_103757.tif") as r:
        arr = r.read().astype("float32")
        arr = np.where(arr == -32768, np.nan, arr / 100.0)
        prof = {**r.profile, "dtype": "float32", "nodata": np.nan}
    buf = io.BytesIO()
    with rasterio.MemoryFile() as mf:
        with mf.open(**prof) as dst:
            dst.write(arr)
        buf.write(mf.read())
    res = client.post("/api/flood/predict", files={"file": ("chip.tif", buf.getvalue(), "image/tiff")})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["probability_png"].startswith("data:image/png;base64,")
    assert body["stats"]["predicted_water_km2"] > 0 and body["stats"]["warnings"] == []

    assert client.post("/api/flood/predict", files={"file": ("x.tif", b"not a tiff", "image/tiff")}).status_code == 422
    one_band = io.BytesIO()
    with rasterio.MemoryFile() as mf:
        with mf.open(
            driver="GTiff", width=8, height=8, count=1, dtype="float32", crs="EPSG:4326", transform=from_origin(0, 1, 0.001, 0.001)
        ) as dst:
            dst.write(np.zeros((1, 8, 8), "float32"))
        one_band.write(mf.read())
    r = client.post("/api/flood/predict", files={"file": ("x.tif", one_band.getvalue(), "image/tiff")})
    assert r.status_code == 422 and "2 bands" in r.json()["detail"]


def test_model_card_matches_report(client):
    card = client.get("/api/ml/model-card").json()
    assert set(card["loeo"]) >= {"model", "otsu", "fixed", "otsu_published"}
    assert card["protocol"]["holdout_events"] == ["Bolivia"]
    assert "Bolivia" not in card["protocol"]["loeo_events"]


def test_imagery_validation_without_network(client):
    assert client.get("/api/imagery/search", params={"bbox": "0,0,5,5", "around": "2026-11-01", "expand": False}).status_code == 422
    assert client.get("/api/imagery/render", params={"item": "../../x", "bbox": "0,0,0.1,0.1"}).status_code == 422
    assert client.get("/api/imagery/png/zzzz").status_code == 422
    assert client.get("/api/imagery/png/" + "0" * 24).status_code == 404


def test_security_headers(client):
    r = client.get("/api/health")
    assert r.headers["x-content-type-options"] == "nosniff"
