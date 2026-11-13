"""Health, data-status and geocoding endpoints."""

from __future__ import annotations

import threading
import time
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool

router = APIRouter(tags=["system"])
_last_refresh = {"t": 0.0}
REFRESH_COOLDOWN_S = 300


@router.get("/api/health")
def health():
    return {"status": "ok"}


def _ds_info(ds) -> dict:
    return {
        "name": ds.name,
        "rows": int(len(ds.df)),
        "earliest_observation_utc": ds.earliest.isoformat() if ds.earliest else None,
        "latest_observation_utc": ds.latest.isoformat() if ds.latest else None,
        "loaded_utc": ds.loaded_utc.isoformat(),
        "created_utc": ds.provenance.get("created_utc"),
        "version": ds.version,
        "feeds": [f.__dict__ for f in ds.feeds],
    }


@router.get("/api/status")
def status(request: Request):
    store = request.app.state.store
    s = request.app.state.settings
    flood = request.app.state.flood
    return {
        # Copy first: a background refresh may add the "live" entry while we iterate.
        "datasets": {k: _ds_info(v) for k, v in list(store.datasets.items())},
        "live": {
            "state": store.live_state,
            "error": store.live_error,
            "window": s.live_feed_window,
            "cache_minutes": s.live_cache_minutes,
            "stale": store.live_is_stale(),
        },
        "firms_map_key_configured": s.firms_map_key is not None,
        "flood_model_available": flood.available,
        "attribution": [
            "NASA FIRMS (MODIS C6.1, VIIRS 375 m NRT) — NASA LANCE/FIRMS, openly shared",
            "Copernicus Sentinel-2 L2A via Element 84 Earth Search / AWS Open Data — contains modified Copernicus Sentinel data",
            "Sen1Floods11 (Bonafilia et al., 2020) — Sentinel-1 chips and hand labels",
            "JRC Global Surface Water (Pekel et al., 2016) — permanent water reference",
            "NASA GIBS / Worldview imagery layers",
            "Natural Earth boundaries (public domain); © OpenStreetMap contributors (search, basemap)",
        ],
    }


@router.post("/api/live/refresh")
def refresh_live(request: Request):
    store = request.app.state.store
    now = time.monotonic()
    if store.live_state == "refreshing":
        return {"state": "refreshing"}
    # The cooldown applies even after a failed refresh so repeated requests cannot hammer the FIRMS servers.
    if _last_refresh["t"] and now - _last_refresh["t"] < REFRESH_COOLDOWN_S:
        raise HTTPException(429, f"live data was refreshed recently; try again in {int(REFRESH_COOLDOWN_S - (now - _last_refresh['t']))} s")
    _last_refresh["t"] = now
    store.live_state = "refreshing"
    threading.Thread(target=store.refresh_live, daemon=True).start()
    return {"state": "refreshing"}


@router.get("/api/geocode")
async def geocode(request: Request, q: Annotated[str, Query(min_length=2, max_length=120)], remote: bool = True):
    return await run_in_threadpool(request.app.state.geocoder.search, q, remote)
