"""Sentinel-2 L2A before/after imagery from the Earth Search STAC API (Element 84, AWS Open Data).

* Catalog: https://earth-search.aws.element84.com/v1 (no authentication)
* Imagery: Copernicus Sentinel-2 L2A Cloud-Optimised GeoTIFFs on the AWS
  Registry of Open Data. Contains modified Copernicus Sentinel data (licence:
  free, full and open; attribution required).

Rendered products
-----------------
* ``truecolor``: B04/B03/B02 surface reflectance.
* ``swir``: B12/B8A/B04 false colour. Active flaming fronts and fresh burn
  scars stand out in SWIR; this is a standard visual aid, not a detection.
* ``dnbr``: differenced Normalised Burn Ratio, NBR = (B8A - B12)/(B8A + B12),
  dNBR = NBR_pre - NBR_post, classified with the Key & Benson (2006) USGS
  ranges. It is a spectral-index change layer, *not* machine learning and not
  field-validated burn severity. Clouds, shadows, phenology and harvest also
  change NBR.

Clouds/shadows are masked with the L2A Scene Classification Layer (SCL).
"""

from __future__ import annotations

import concurrent.futures as cf
import hashlib
import io
import json
import logging
import math
import re
from datetime import date, timedelta
from pathlib import Path

import httpx
import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.transform import from_bounds as transform_from_bounds
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import from_bounds as window_from_bounds

log = logging.getLogger(__name__)

COLLECTION = "sentinel-2-l2a"
ITEM_ID = re.compile(r"^S2[ABC]_\d{2}[A-Z]{3}_\d{8}_\d+_L2A$")
GDAL_ENV = dict(
    GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
    CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
    GDAL_HTTP_MERGE_CONSECUTIVE_RANGES="YES",
    GDAL_HTTP_MULTIPLEX="YES",
    GDAL_HTTP_VERSION=2,
    VSI_CACHE="TRUE",
    GDAL_HTTP_MAX_RETRY=3,
    GDAL_HTTP_RETRY_DELAY=1,
)
BANDS = {"truecolor": ["red", "green", "blue"], "swir": ["swir22", "nir08", "red"], "nbr": ["nir08", "swir22"]}
SCL_INVALID = {0, 1, 3, 8, 9, 10}  # no data, saturated, cloud shadow, cloud medium/high, cirrus
MAX_AOI_DEG = 0.6
MAX_PX = 1024
ITEM_CACHE_MAX = 1000

DNBR_CLASSES = [
    # (lower, upper, label, RGBA) — Key & Benson (2006), USGS FIREMON
    (-math.inf, -0.25, "Enhanced regrowth (high)", (26, 152, 80, 200)),
    (-0.25, -0.1, "Enhanced regrowth (low)", (145, 207, 96, 180)),
    (-0.1, 0.1, "Unburned / no change", (0, 0, 0, 0)),
    (0.1, 0.27, "Low severity", (255, 255, 120, 200)),
    (0.27, 0.44, "Moderate-low severity", (255, 170, 60, 210)),
    (0.44, 0.66, "Moderate-high severity", (240, 90, 40, 220)),
    (0.66, math.inf, "High severity", (160, 32, 140, 230)),
]


class ImageryError(RuntimeError):
    pass


def parse_items(item_ids: str) -> list[str]:
    ids = [i for i in item_ids.split(",") if i]
    if not 1 <= len(ids) <= 4 or not all(ITEM_ID.match(i) for i in ids):
        raise ValueError("expected 1-4 Sentinel-2 L2A item ids")
    return ids


def validate_aoi(bbox: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    w, s, e, n = bbox
    if not (-180 <= w < e <= 180 and -85 <= s < n <= 85):
        raise ValueError("invalid bbox")
    if (e - w) > MAX_AOI_DEG or (n - s) > MAX_AOI_DEG:
        raise ValueError(f"area too large for imagery rendering (max {MAX_AOI_DEG} degrees per side)")
    return bbox


def expand_bbox(bbox: tuple[float, float, float, float], min_km: float = 6.0) -> tuple[float, float, float, float]:
    """Pad a cluster bbox to a sensible viewing extent (at least ``min_km`` per side)."""
    w, s, e, n = bbox
    lat = (s + n) / 2
    min_lat = min_km / 110.574
    min_lon = min_km / (111.320 * max(math.cos(math.radians(lat)), 0.1))
    cx, cy = (w + e) / 2, (s + n) / 2
    hw = max((e - w) * 0.65, min_lon / 2)
    hh = max((n - s) * 0.65, min_lat / 2)
    hw, hh = min(hw, MAX_AOI_DEG / 2), min(hh, MAX_AOI_DEG / 2)
    return (round(cx - hw, 5), round(cy - hh, 5), round(cx + hw, 5), round(cy + hh, 5))


class ImageryService:
    def __init__(self, stac_url: str, cache_dir: Path, user_agent: str, timeout: float = 60.0):
        self.stac_url = stac_url.rstrip("/")
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.headers = {"User-Agent": user_agent}
        self.timeout = timeout
        self._item_cache: dict[str, dict] = {}

    # ----------------------------------------------------------------- catalog
    def search(
        self, bbox, around: date, days_before: int = 60, days_after: int = 30, max_cloud: float = 40.0, today: date | None = None
    ) -> dict:
        validate_aoi(bbox)
        today = today or date.today()
        windows = {
            "before": (around - timedelta(days=days_before), around - timedelta(days=1)),
            "after": (around, min(around + timedelta(days=days_after), today)),
        }
        out = {}
        with httpx.Client(timeout=self.timeout, headers=self.headers) as client:
            for key, (a, b) in windows.items():
                if b < a:
                    out[key] = []
                    continue
                body = {
                    "collections": [COLLECTION],
                    "bbox": list(bbox),
                    "datetime": f"{a.isoformat()}T00:00:00Z/{b.isoformat()}T23:59:59Z",
                    "limit": 50,
                    "query": {"eo:cloud_cover": {"lt": max_cloud}},
                    "sortby": [{"field": "properties.datetime", "direction": "desc" if key == "before" else "asc"}],
                }
                r = client.post(f"{self.stac_url}/search", json=body)
                if r.status_code != 200:
                    raise ImageryError(f"STAC search failed: HTTP {r.status_code}")
                feats = r.json().get("features", [])
                for f in feats:
                    self._remember(f["id"], f)
                out[key] = self._acquisitions(feats, bbox)
        return {
            "bbox": list(bbox),
            "around": around.isoformat(),
            "windows": {k: [a.isoformat(), b.isoformat()] for k, (a, b) in windows.items()},
            "max_scene_cloud": max_cloud,
            **out,
        }

    @staticmethod
    def _acquisitions(feats: list[dict], bbox) -> list[dict]:
        """Group tiles from the same satellite pass (platform + UTC date) and report AOI coverage."""
        from shapely.geometry import box, shape
        from shapely.ops import unary_union

        aoi = box(*bbox)
        groups: dict[tuple, list[dict]] = {}
        for f in feats:
            p = f["properties"]
            groups.setdefault((p.get("platform"), p["datetime"][:10]), []).append(f)
        out = []
        for (_, _), fs in groups.items():
            fs = sorted(fs, key=lambda f: f["properties"].get("eo:cloud_cover") or 0)[:4]
            cover = unary_union([shape(f["geometry"]) for f in fs]).intersection(aoi).area / aoi.area
            summ = ImageryService._summarise(fs[0])
            summ.update(
                {
                    "id": ",".join(f["id"] for f in fs),
                    "items": [f["id"] for f in fs],
                    "aoi_coverage": round(float(cover), 3),
                    "scene_cloud_cover": float(np.mean([f["properties"].get("eo:cloud_cover") or 0 for f in fs])),
                    "mgrs_tile": ",".join(sorted({str(ImageryService._summarise(f)["mgrs_tile"]) for f in fs})),
                }
            )
            out.append(summ)
        # Keep the catalogue order (by date) but drop passes that barely touch the AOI.
        return [a for a in out if a["aoi_coverage"] >= 0.2]

    @staticmethod
    def _summarise(f: dict) -> dict:
        p = f["properties"]
        return {
            "id": f["id"],
            "datetime": p["datetime"],
            "platform": p.get("platform"),
            "scene_cloud_cover": p.get("eo:cloud_cover"),
            "mgrs_tile": p.get("grid:code") or p.get("s2:mgrs_tile"),
            "processing_baseline": p.get("s2:processing_baseline"),
            "thumbnail": f.get("assets", {}).get("thumbnail", {}).get("href"),
        }

    def item(self, item_id: str) -> dict:
        if not ITEM_ID.match(item_id):
            raise ValueError("invalid Sentinel-2 item id")
        if item_id in self._item_cache:
            return self._item_cache[item_id]
        with httpx.Client(timeout=self.timeout, headers=self.headers) as client:
            r = client.get(f"{self.stac_url}/collections/{COLLECTION}/items/{item_id}")
        if r.status_code == 404:
            raise ImageryError("Sentinel-2 item not found")
        if r.status_code != 200:
            raise ImageryError(f"STAC item lookup failed: HTTP {r.status_code}")
        return self._remember(item_id, r.json())

    def _remember(self, item_id: str, item: dict) -> dict:
        """Bounded STAC item cache (dicts keep insertion order, so the oldest entry is evicted first)."""
        self._item_cache.pop(item_id, None)
        self._item_cache[item_id] = item
        while len(self._item_cache) > ITEM_CACHE_MAX:
            self._item_cache.pop(next(iter(self._item_cache)))
        return item

    # ----------------------------------------------------------------- reading
    @staticmethod
    def _grid(bbox) -> tuple[int, int, rasterio.Affine]:
        w, s, e, n = bbox
        lat = (s + n) / 2
        km_w = (e - w) * 111.320 * math.cos(math.radians(lat))
        km_h = (n - s) * 110.574
        scale = min(MAX_PX / max(km_w, km_h) / 100.0, 1.0)  # <= 10 m native
        width = max(64, int(round(km_w * 100 * scale)))
        height = max(64, int(round(km_h * 100 * scale)))
        return width, height, transform_from_bounds(w, s, e, n, width, height)

    def _read_band(self, href: str, bbox, width: int, height: int, dst_transform, categorical: bool) -> np.ndarray:
        dst = np.full((height, width), np.nan, dtype=np.float32)
        with rasterio.Env(**GDAL_ENV), rasterio.open(href) as src:
            b = transform_bounds("EPSG:4326", src.crs, *bbox, densify_pts=21)
            win = window_from_bounds(*b, transform=src.transform).round_offsets().round_lengths()
            # Read at roughly output resolution so COG overviews are used.
            native_px = max(win.width, win.height)
            factor = max(1, int(native_px / max(width, height)))
            out_shape = (max(1, int(win.height / factor)), max(1, int(win.width / factor)))
            data = src.read(
                1,
                window=win,
                out_shape=out_shape,
                boundless=True,
                fill_value=0,
                resampling=Resampling.nearest if categorical else Resampling.average,
            ).astype(np.float32)
            wt = src.window_transform(win) * rasterio.Affine.scale(win.width / out_shape[1], win.height / out_shape[0])
            reproject(
                data,
                dst,
                src_transform=wt,
                src_crs=src.crs,
                src_nodata=0,
                dst_transform=dst_transform,
                dst_crs="EPSG:4326",
                dst_nodata=np.nan,
                resampling=Resampling.nearest if categorical else Resampling.bilinear,
            )
        return dst

    def read_reflectance(self, item_ids: str, bbox, names: list[str]) -> tuple[dict[str, np.ndarray], np.ndarray, dict]:
        """Read and mosaic up to 4 tiles of one acquisition (comma-separated ids) onto a WGS84 grid."""
        ids = parse_items(item_ids)
        parts = [self._read_one(i, bbox, names) for i in ids]
        refl, valid, meta = parts[0]
        for r2, v2, _ in parts[1:]:
            # Take the next tile's pixels where the mosaic has no data yet, or where it is masked (cloud) and the
            # next tile is clear. Validity is updated only where pixels were taken, so it always describes the
            # reflectance actually in the mosaic.
            hole = ~np.all([np.isfinite(refl[n]) for n in names], axis=0)
            has2 = np.all([np.isfinite(r2[n]) for n in names], axis=0)
            take = has2 & (hole | (v2 & ~valid))
            for n in names:
                refl[n][take] = r2[n][take]
            valid = np.where(take, v2, valid)
        has = np.all([np.isfinite(refl[n]) for n in names], axis=0)
        valid &= has
        meta.update(
            {"item_id": ",".join(ids), "items": ids, "aoi_valid_fraction": float(valid.mean()), "aoi_data_fraction": float(has.mean())}
        )
        return refl, valid, meta

    def _read_one(self, item_id: str, bbox, names: list[str]) -> tuple[dict[str, np.ndarray], np.ndarray, dict]:
        item = self.item(item_id)
        width, height, tr = self._grid(bbox)
        jobs = {n: item["assets"][n] for n in names}
        jobs["scl"] = item["assets"]["scl"]
        with cf.ThreadPoolExecutor(len(jobs)) as ex:
            futs = {k: ex.submit(self._read_band, a["href"], bbox, width, height, tr, k == "scl") for k, a in jobs.items()}
            raw = {k: f.result() for k, f in futs.items()}
        refl = {}
        for n in names:
            rb = (jobs[n].get("raster:bands") or [{}])[0]
            scale, offset = float(rb.get("scale", 1e-4)), float(rb.get("offset", 0.0))
            refl[n] = raw[n] * scale + offset
        scl = raw["scl"]
        valid = np.isfinite(scl) & ~np.isin(np.nan_to_num(scl, nan=0).astype(int), list(SCL_INVALID))
        for n in names:
            valid &= np.isfinite(refl[n])
        meta = {
            "item_id": item_id,
            "datetime": item["properties"]["datetime"],
            "platform": item["properties"].get("platform"),
            "scene_cloud_cover": item["properties"].get("eo:cloud_cover"),
            "width": width,
            "height": height,
            "aoi_valid_fraction": float(valid.mean()),
        }
        return refl, valid, meta

    # ----------------------------------------------------------------- products
    def render(self, item_id: str, bbox, product: str) -> tuple[bytes, dict]:
        if product not in ("truecolor", "swir"):
            raise ValueError("product must be truecolor or swir")
        validate_aoi(bbox)
        key = self._key("render", item_id, bbox, product)
        cached = self._cache_get(key)
        if cached:
            return cached
        refl, valid, meta = self.read_reflectance(item_id, bbox, BANDS[product])
        rgb = np.stack([refl[b] for b in BANDS[product]], axis=-1)
        hi = 0.3 if product == "truecolor" else 0.5
        img = np.clip(np.nan_to_num(rgb, nan=0) / hi, 0, 1) ** (1 / 1.6)
        rgba = np.zeros(img.shape[:2] + (4,), dtype=np.uint8)
        rgba[..., :3] = (img * 255).astype(np.uint8)
        has = np.all(np.isfinite(rgb), axis=-1) & (np.nansum(rgb, axis=-1) > 0)
        rgba[..., 3] = np.where(has, 255, 0)
        # Keep clouds visible but dim them so masked pixels are obvious.
        cloud = has & ~valid
        rgba[cloud, :3] = (rgba[cloud, :3] * 0.45 + 70).astype(np.uint8)
        meta.update({"product": product, "bounds": list(bbox), "cloud_masked_fraction": float(cloud.mean())})
        return self._cache_put(key, rgba, meta)

    def dnbr(self, pre_id: str, post_id: str, bbox) -> tuple[bytes, dict]:
        validate_aoi(bbox)
        key = self._key("dnbr", pre_id, post_id, bbox)
        cached = self._cache_get(key)
        if cached:
            return cached
        with cf.ThreadPoolExecutor(2) as ex:
            fa = ex.submit(self.read_reflectance, pre_id, bbox, BANDS["nbr"])
            fb = ex.submit(self.read_reflectance, post_id, bbox, BANDS["nbr"])
            (ra, va, ma), (rb, vb, mb) = fa.result(), fb.result()

        def nbr(r):
            with np.errstate(invalid="ignore", divide="ignore"):
                return (r["nir08"] - r["swir22"]) / (r["nir08"] + r["swir22"])

        d = nbr(ra) - nbr(rb)
        valid = va & vb & np.isfinite(d)
        rgba = np.zeros(d.shape + (4,), dtype=np.uint8)
        lat = (bbox[1] + bbox[3]) / 2
        px_km2 = ((bbox[2] - bbox[0]) / d.shape[1] * 111.320 * math.cos(math.radians(lat))) * ((bbox[3] - bbox[1]) / d.shape[0] * 110.574)
        classes = []
        for lo, hi, label, color in DNBR_CLASSES:
            m = valid & (d >= lo) & (d < hi)
            rgba[m] = color
            classes.append(
                {
                    "label": label,
                    "range": [None if math.isinf(lo) else lo, None if math.isinf(hi) else hi],
                    "rgba": list(color),
                    "area_km2": round(float(m.sum() * px_km2), 3),
                    "fraction_of_valid": float(m.sum() / max(valid.sum(), 1)),
                }
            )
        rgba[~valid] = (90, 90, 110, 90)
        meta = {
            "product": "dnbr",
            "bounds": list(bbox),
            "pre": ma,
            "post": mb,
            "valid_fraction": float(valid.mean()),
            "classes": classes,
            "pixel_area_km2": px_km2,
            "dnbr_stats": {
                "p50": float(np.nanpercentile(d[valid], 50)) if valid.any() else None,
                "p95": float(np.nanpercentile(d[valid], 95)) if valid.any() else None,
            },
            "method": "dNBR = NBR(pre) - NBR(post); NBR=(B8A-B12)/(B8A+B12); Key & Benson (2006) classes; SCL cloud/shadow mask",
            "caveat": "Spectral-index change, not machine learning and not field-validated burn severity.",
        }
        return self._cache_put(key, rgba, meta)

    # ----------------------------------------------------------------- cache
    def _key(self, *parts) -> str:
        return hashlib.sha256(json.dumps(parts, default=str).encode()).hexdigest()[:24]

    def _cache_get(self, key: str):
        png, js = self.cache_dir / f"{key}.png", self.cache_dir / f"{key}.json"
        if png.exists() and js.exists():
            return png.read_bytes(), json.loads(js.read_text())
        return None

    def _cache_put(self, key: str, rgba: np.ndarray, meta: dict):
        buf = io.BytesIO()
        Image.fromarray(rgba, "RGBA").save(buf, "PNG", optimize=True)
        data = buf.getvalue()
        meta["cache_key"] = key
        (self.cache_dir / f"{key}.png").write_bytes(data)
        (self.cache_dir / f"{key}.json").write_text(json.dumps(meta))
        return data, meta

    def cached_png(self, key: str) -> bytes | None:
        if not re.fullmatch(r"[0-9a-f]{24}", key):
            return None
        p = self.cache_dir / f"{key}.png"
        return p.read_bytes() if p.exists() else None
