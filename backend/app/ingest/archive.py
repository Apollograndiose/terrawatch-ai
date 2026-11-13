"""Historical baselines from the FIRMS yearly country archives (no key required).

    python -m app.ingest.archive --countries Australia Brazil --years 2012-2025

Source files (verified): https://firms.modaps.eosdis.nasa.gov/data/country/modis/<YEAR>/modis_<YEAR>_<Country>.csv
These are MODIS Collection 6.1 standard-processing (science quality) records
that include the FIRMS ``type`` field (0 = presumed vegetation fire,
1 = active volcano, 2 = other static land source, 3 = offshore). We keep MODIS
for the long-term baseline because it is the longest consistent record
(Terra since 2000, Aqua since 2002); VIIRS 375 m data are not directly
comparable because they detect many more, smaller fires.

Only monthly aggregates are stored, never the raw archive.
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

import httpx
import pandas as pd

from app.config import get_settings
from app.ingest.firms import FIRMS_BASE, modis_confidence_class, sha256, utcnow

AGG_COLUMNS = ["country", "year", "month", "type", "confidence_class", "daynight", "count", "frp_sum"]


def archive_url(country: str, year: int) -> str:
    return f"{FIRMS_BASE}/data/country/modis/{year}/modis_{year}_{country.replace(' ', '_')}.csv"


def aggregate(path: Path, country: str, year: int) -> pd.DataFrame:
    parts = []
    usecols = ["acq_date", "confidence", "frp", "daynight", "type"]
    for chunk in pd.read_csv(path, usecols=usecols, chunksize=500_000, dtype={"confidence": "float32"}):
        dt = pd.to_datetime(chunk["acq_date"], format="%Y-%m-%d", errors="coerce")
        g = pd.DataFrame(
            {
                "month": dt.dt.month,
                "type": pd.to_numeric(chunk["type"], errors="coerce").fillna(-1).astype(int),
                "confidence_class": modis_confidence_class(chunk["confidence"]),
                "daynight": chunk["daynight"].astype(str),
                "frp": pd.to_numeric(chunk["frp"], errors="coerce").fillna(0.0),
            }
        ).dropna(subset=["month"])
        parts.append(
            g.groupby(["month", "type", "confidence_class", "daynight"], as_index=False).agg(count=("frp", "size"), frp_sum=("frp", "sum"))
        )
    if not parts:
        return pd.DataFrame(columns=AGG_COLUMNS)
    agg = pd.concat(parts).groupby(["month", "type", "confidence_class", "daynight"], as_index=False).sum()
    agg.insert(0, "year", year)
    agg.insert(0, "country", country)
    agg["month"] = agg["month"].astype(int)
    return agg[AGG_COLUMNS]


def fetch_country_year(country: str, year: int, client: httpx.Client, tmpdir: Path) -> tuple[pd.DataFrame, dict]:
    url = archive_url(country, year)
    tmp = tmpdir / f"{country}_{year}.csv"
    with client.stream("GET", url) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for block in r.iter_bytes(1 << 20):
                f.write(block)
    digest = sha256(tmp.read_bytes())
    agg = aggregate(tmp, country, year)
    meta = {
        "country": country,
        "year": year,
        "url": url,
        "bytes": tmp.stat().st_size,
        "sha256": digest,
        "rows": int(agg["count"].sum()),
        "retrieved_utc": utcnow().isoformat(),
    }
    tmp.unlink()
    return agg, meta


def parse_years(s: str) -> list[int]:
    if "-" in s:
        a, b = s.split("-")
        return list(range(int(a), int(b) + 1))
    return [int(x) for x in s.split(",")]


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--countries", nargs="+", required=True)
    p.add_argument("--years", default="2012-2025")
    p.add_argument("--out", type=Path, default=get_settings().data_dir / "demo" / "history")
    a = p.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    prov_path = a.out / "provenance.json"
    prov = json.loads(prov_path.read_text()) if prov_path.exists() else {"files": []}
    s = get_settings()
    with (
        httpx.Client(timeout=600, headers={"User-Agent": s.user_agent}, follow_redirects=True) as client,
        tempfile.TemporaryDirectory() as td,
    ):
        for country in a.countries:
            frames = []
            dest = a.out / f"modis_{country.replace(' ', '_')}.parquet"
            for year in parse_years(a.years):
                try:
                    agg, meta = fetch_country_year(country, year, client, Path(td))
                except httpx.HTTPError as exc:
                    print(f"{country} {year}: FAILED {exc}", file=sys.stderr)
                    continue
                frames.append(agg)
                prov["files"] = [f for f in prov["files"] if not (f["country"] == country and f["year"] == year)]
                prov["files"].append(meta)
                print(f"{country} {year}: {meta['rows']} detections", flush=True)
            if frames:
                pd.concat(frames, ignore_index=True).to_parquet(dest, index=False)
    prov.update(
        {
            "dataset": "NASA FIRMS MODIS Collection 6.1 standard-processing archive (yearly country files)",
            "citation": "NASA FIRMS, MODIS Collection 6.1 Active Fire (MCD14ML), DOI: 10.5067/FIRMS/MODIS/MCD14ML",
            "note": "Monthly aggregates only. Count of detections, not count of fires.",
        }
    )
    prov_path.write_text(json.dumps(prov, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
