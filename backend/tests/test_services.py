import numpy as np
import pandas as pd
import pytest
from pydantic import ValidationError

from app.api.fires import grid_cell_for_zoom
from app.config import REPO_ROOT, Settings
from app.ingest.regions import UNASSIGNED, assign_regions
from app.models.schemas import DetectionFilter
from app.services.clustering import label_clusters, summarise_clusters
from app.services.imagery import expand_bbox, parse_items, validate_aoi

COUNTRIES = REPO_ROOT / "data" / "reference" / "ne_50m_admin_0_countries.geojson"


def test_clusters_link_close_points_and_split_distant_ones():
    # Two groups ~1 km apart internally, ~50 km apart from each other.
    lat = np.array([-19.600, -19.605, -19.610, -20.050, -20.055])
    lon = np.array([124.600, 124.605, 124.610, 124.600, 124.603])
    lab = label_clusters(lat, lon, link_km=1.5)
    assert lab[0] == lab[1] == lab[2]
    assert lab[3] == lab[4]
    assert lab[0] != lab[3]


def test_clusters_empty():
    assert label_clusters(np.array([]), np.array([])).size == 0


def test_cluster_summary_fields():
    t = pd.to_datetime(["2026-11-05T01:00Z", "2026-11-06T01:00Z", "2026-11-06T13:00Z"], utc=True)
    df = pd.DataFrame(
        {
            "id": ["a" * 16, "b" * 16, "c" * 16],
            "latitude": [1.0, 1.001, 1.002],
            "longitude": [2.0, 2.001, 2.002],
            "acq_datetime": t,
            "frp": [1.0, 2.0, 3.0],
            "source": ["MODIS_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA20_NRT"],
            "confidence_class": ["high", "nominal", "high"],
            "country": ["X"] * 3,
            "iso3": ["XXX"] * 3,
        }
    )
    s = summarise_clusters(df, label_clusters(df.latitude.to_numpy(), df.longitude.to_numpy()))
    assert len(s) == 1
    r = s.iloc[0]
    assert r.detections == 3 and r.active_days == 2 and r.high_conf == 2
    assert r.frp_sum == pytest.approx(6.0) and r.sources == ["MODIS_NRT", "VIIRS_NOAA20_NRT"]
    assert r.cluster_id.startswith("c") and len(r.cluster_id) == 13


def test_region_assignment_uses_natural_earth():
    df = pd.DataFrame({"latitude": [-25.0, 48.85, 0.0], "longitude": [134.0, 2.35, -30.0]})
    out = assign_regions(df, COUNTRIES)
    assert list(out.iso3[:2]) == ["AUS", "FRA"]
    assert out.country.iloc[2] == UNASSIGNED


def test_filter_validation():
    with pytest.raises(ValidationError):
        DetectionFilter(bbox=(0, 10, 5, 5))
    with pytest.raises(ValidationError):
        DetectionFilter(start="2026-11-06T00:00Z", end="2026-11-05T00:00Z")
    with pytest.raises(ValidationError):
        DetectionFilter(iso3="aus")
    assert DetectionFilter(bbox=(170, -50, -170, -30)).bbox[0] == 170  # antimeridian allowed


def test_grid_cell_scales_with_zoom():
    assert grid_cell_for_zoom(2) > grid_cell_for_zoom(5) > grid_cell_for_zoom(8)
    assert grid_cell_for_zoom(30) >= 0.02


def test_imagery_aoi_guards():
    assert validate_aoi((10, 10, 10.5, 10.5))
    with pytest.raises(ValueError):
        validate_aoi((10, 10, 12, 10.5))
    b = expand_bbox((124.0, -19.0, 124.001, -18.999))
    assert b[2] - b[0] > 0.05  # padded to a viewable extent
    assert parse_items("S2A_51KXU_20261112_1_L2A,S2B_51KXT_20261112_0_L2A") == ["S2A_51KXU_20261112_1_L2A", "S2B_51KXT_20261112_0_L2A"]
    for bad in ["", "../etc/passwd", "S2A_51KXU_20261112_1_L2A;rm", ",".join(["S2A_51KXU_20261112_1_L2A"] * 5)]:
        with pytest.raises(ValueError):
            parse_items(bad)


def test_settings_reject_malformed_map_key():
    with pytest.raises(ValidationError):
        Settings(FIRMS_MAP_KEY="short")
    assert Settings(FIRMS_MAP_KEY="").firms_map_key is None
