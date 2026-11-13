"""Live checks against the real external services. Run with: pytest -m network

These verify that each integration still works as documented; they are
excluded from the default run so CI does not depend on third-party uptime.
"""

from datetime import date, timedelta

import httpx
import pytest

from app.ingest.firms import PRODUCTS, parse_csv
from app.services.imagery import ImageryService

pytestmark = pytest.mark.network
UA = {"User-Agent": "TerraWatchAI-tests/0.1"}


@pytest.mark.parametrize("source", ["VIIRS_NOAA20_NRT", "MODIS_NRT"])
def test_firms_global_feed_parses(source):
    r = httpx.get(PRODUCTS[source].feed_url("24h"), headers=UA, timeout=120, follow_redirects=True)
    r.raise_for_status()
    df = parse_csv(r.content, source)
    assert len(df) > 100
    assert df.acq_datetime.max() > df.acq_datetime.max().now(tz="UTC") - timedelta(days=3)


def test_firms_country_archive_available():
    r = httpx.head("https://firms.modaps.eosdis.nasa.gov/data/country/modis/2024/modis_2024_Greece.csv", headers=UA, timeout=60)
    assert r.status_code == 200


def test_earth_search_sentinel2(tmp_path):
    svc = ImageryService("https://earth-search.aws.element84.com/v1", tmp_path, "TerraWatchAI-tests/0.1")
    res = svc.search((136.3, -20.3, 136.8, -19.95), date.today() - timedelta(days=20))
    assert res["before"] or res["after"]
    acq = (res["before"] or res["after"])[0]
    png, meta = svc.render(acq["id"], tuple(res["bbox"]), "truecolor")
    assert png[:4] == b"\x89PNG" and meta["aoi_data_fraction"] > 0.5


def test_gibs_tile():
    d = (date.today() - timedelta(days=3)).isoformat()
    url = f"https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/{d}/GoogleMapsCompatible_Level9/2/1/1.jpg"
    r = httpx.get(url, headers=UA, timeout=60)
    assert r.status_code == 200 and r.headers["content-type"].startswith("image/")
