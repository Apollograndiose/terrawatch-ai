"""TerraWatch AI API (FastAPI)."""

from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.api import analytics, fires, flood, imagery, system
from app.config import Settings, get_settings
from app.services.flood import FloodService
from app.services.geocode import Geocoder
from app.services.imagery import ImageryService
from app.services.store import FireStore

log = logging.getLogger("terrawatch")


def create_app(settings: Settings | None = None, load_live: bool | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        store = FireStore(settings)
        store.load_demo()
        app.state.store = store
        app.state.settings = settings
        app.state.imagery = ImageryService(settings.stac_url, settings.data_dir / "cache" / "imagery", settings.user_agent)
        app.state.flood = FloodService(settings.flood_demo_dir, settings.ml_artifacts_dir, settings.ml_reports_dir)
        app.state.geocoder = Geocoder(
            settings.data_dir / "reference" / "ne_50m_admin_0_countries.geojson", settings.nominatim_url, settings.user_agent
        )
        live = settings.default_dataset == "live" if load_live is None else load_live
        if live:
            threading.Thread(target=store.refresh_live, daemon=True).start()
        yield

    app = FastAPI(
        title="TerraWatch AI API",
        version="0.1.0",
        description="Satellite disaster intelligence: NASA FIRMS wildfire observations, Sentinel-2 imagery "
        "comparison and an experimental Sentinel-1 SAR surface-water model. Research/education only.",
        lifespan=lifespan,
    )
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET", "POST"], allow_headers=["*"])

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        return response

    for r in (system.router, fires.router, analytics.router, imagery.router, flood.router):
        app.include_router(r)
    return app


app = create_app()
