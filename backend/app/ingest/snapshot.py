"""Build the bundled demonstration snapshot from the public FIRMS NRT feeds.

    python -m app.ingest.snapshot --window 7d --out ../data/demo

Writes ``detections.parquet`` plus ``provenance.json`` recording each source
URL, the retrieval time (UTC), HTTP Last-Modified, raw byte count, SHA-256 and
row counts, so the snapshot can be audited against the original files.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import httpx
import pandas as pd

from app.config import get_settings
from app.ingest.firms import PRODUCTS, FirmsFormatError, parse_csv, sha256, utcnow
from app.ingest.regions import assign_regions


def fetch_feed(source: str, window: str, client: httpx.Client) -> tuple[pd.DataFrame, dict]:
    prod = PRODUCTS[source]
    url = prod.feed_url(window)
    retrieved = utcnow()
    r = client.get(url)
    r.raise_for_status()
    df = parse_csv(r.content, source) if r.content.strip() else pd.DataFrame()
    meta = {
        "source": source,
        "satellite": prod.satellite,
        "instrument": prod.instrument,
        "url": url,
        "retrieved_utc": retrieved.isoformat(),
        "http_last_modified": r.headers.get("last-modified"),
        "bytes": len(r.content),
        "sha256": sha256(r.content),
        "rows": int(len(df)),
        "min_acq_utc": df["acq_datetime"].min().isoformat() if len(df) else None,
        "max_acq_utc": df["acq_datetime"].max().isoformat() if len(df) else None,
    }
    return df, meta


def build(window: str, out: Path, sources: list[str]) -> dict:
    s = get_settings()
    frames, metas, errors = [], [], []
    with httpx.Client(timeout=180, headers={"User-Agent": s.user_agent}, follow_redirects=True) as client:
        for src in sources:
            try:
                df, meta = fetch_feed(src, window, client)
                print(f"{src}: {meta['rows']} rows ({meta['bytes'] / 1e6:.1f} MB)")
                if len(df):
                    frames.append(df)
                metas.append(meta)
            except (httpx.HTTPError, FirmsFormatError) as exc:
                print(f"{src}: FAILED {exc}", file=sys.stderr)
                errors.append({"source": src, "error": str(exc)})
    if not frames:
        raise SystemExit("no data retrieved")
    df = pd.concat(frames, ignore_index=True)
    df = assign_regions(df, s.data_dir / "reference" / "ne_50m_admin_0_countries.geojson")
    out.mkdir(parents=True, exist_ok=True)
    df.drop(columns=["id"]).to_parquet(out / "detections.parquet", compression="zstd", index=False)
    prov = {
        "dataset": "NASA FIRMS active fire / thermal anomaly detections (NRT)",
        "window": window,
        "created_utc": utcnow().isoformat(),
        "rows": int(len(df)),
        "feeds": metas,
        "errors": errors,
        "citation": (
            "NASA FIRMS. MODIS Collection 6.1 and VIIRS 375 m (Collection 2) NRT Active Fire products. "
            "DOI: 10.5067/FIRMS/MODIS/MCD14DL.NRT.0061, 10.5067/FIRMS/VIIRS/VNP14IMGT_NRT.002, "
            "10.5067/FIRMS/VIIRS/VJ114IMGT_NRT.002, 10.5067/FIRMS/VIIRS/VJ214IMGT_NRT.002"
        ),
        "license": "NASA Earth science data are openly shared without restriction (NASA Earthdata data use policy).",
        "region_boundaries": "Natural Earth 1:50m Admin 0 countries (public domain)",
    }
    (out / "provenance.json").write_text(json.dumps(prov, indent=2))
    return prov


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--window", choices=["24h", "48h", "7d"], default="7d")
    p.add_argument("--out", type=Path, default=get_settings().data_dir / "demo")
    p.add_argument("--sources", nargs="*", default=list(PRODUCTS))
    a = p.parse_args()
    prov = build(a.window, a.out, a.sources)
    print(f"wrote {prov['rows']} detections to {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
