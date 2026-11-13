from datetime import date

import pandas as pd
import pytest

from app.ingest.firms import (
    FirmsFormatError,
    area_api_url,
    detection_ids,
    modis_confidence_class,
    parse_csv,
    viirs_confidence_class,
)

# Header + rows copied verbatim from the live NOAA-20 and MODIS global feeds (2026-11-13).
VIIRS_CSV = b"""latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
-19.56959,124.36334,367.2,0.44,0.38,2026-11-07,0449,N20,VIIRS,n,2.0NRT,301.2,12.4,D
-19.57001,124.36672,331.0,0.44,0.38,2026-11-07,0449,N20,VIIRS,h,2.0NRT,298.7,5.1,D
95.0,10.0,300,0.4,0.4,2026-11-07,0449,N20,VIIRS,l,2.0NRT,290,1,D
"""
MODIS_CSV = b"""latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight
-19.56959,124.36334,493.52,2.36,1.48,2026-11-07,1849,A,MODIS,100,6.1NRT,330.29,5083.19,N
10.1,20.2,310.0,1.0,1.0,2026-11-07,105,T,MODIS,25,6.1NRT,290.0,4.0,D
"""


def test_viirs_parse_normalises_schema():
    df = parse_csv(VIIRS_CSV, "VIIRS_NOAA20_NRT")
    assert len(df) == 2, "row with latitude 95 must be rejected"
    r = df.iloc[0]
    assert r.satellite == "NOAA-20" and r.instrument == "VIIRS"
    assert r.confidence_class == "nominal"
    assert str(r.acq_datetime) == "2026-11-07 04:49:00+00:00"
    assert r.bright_t4 == pytest.approx(367.2)
    assert pd.isna(r.type)


def test_modis_parse_and_time_padding():
    df = parse_csv(MODIS_CSV, "MODIS_NRT")
    assert df.iloc[0].satellite == "Aqua"
    assert df.iloc[0].confidence_class == "high"
    assert df.iloc[1].confidence_class == "low"
    # acq_time "105" must be read as 01:05 UTC
    assert df.iloc[1].acq_datetime.hour == 1 and df.iloc[1].acq_datetime.minute == 5


def test_header_only_feed_returns_empty_frame():
    # This is exactly what the Suomi-NPP feed returned during development (instrument outage).
    df = parse_csv(VIIRS_CSV.splitlines()[0] + b"\n", "VIIRS_SNPP_NRT")
    assert df.empty and "acq_datetime" in df.columns


def test_non_csv_error_message_is_rejected():
    with pytest.raises(FirmsFormatError):
        parse_csv(b"Invalid MAP_KEY.", "VIIRS_NOAA20_NRT")


def test_missing_columns_rejected():
    with pytest.raises(FirmsFormatError):
        parse_csv(b"latitude,longitude\n1,2\n", "VIIRS_NOAA20_NRT")


def test_ids_are_deterministic_and_unique():
    a = parse_csv(VIIRS_CSV, "VIIRS_NOAA20_NRT")
    b = parse_csv(VIIRS_CSV, "VIIRS_NOAA20_NRT")
    assert list(a.id) == list(b.id)
    assert a.id.is_unique and all(len(i) == 16 for i in a.id)
    assert list(detection_ids(a)) == list(a.id)


def test_confidence_mappings():
    assert list(modis_confidence_class(pd.Series(["0", "29", "30", "79", "80", "x"]))) == [
        "low",
        "low",
        "nominal",
        "nominal",
        "high",
        "unknown",
    ]
    assert list(viirs_confidence_class(pd.Series(["l", "n", "h", "?"]))) == ["low", "nominal", "high", "unknown"]


def test_area_api_url_validation():
    url = area_api_url("a" * 32, "VIIRS_NOAA20_NRT", (-10, -5, 10, 5), 3, date(2026, 11, 1))
    assert url.endswith("/VIIRS_NOAA20_NRT/-10.0000,-5.0000,10.0000,5.0000/3/2026-11-01")
    with pytest.raises(ValueError):
        area_api_url("a" * 32, "VIIRS_NOAA20_NRT", (-10, -5, 10, 5), 6, date(2026, 11, 1))
    with pytest.raises(ValueError):
        area_api_url("a" * 32, "VIIRS_NOAA20_NRT", (10, -5, -10, 5), 1, date(2026, 11, 1))
