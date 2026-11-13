"""Sentinel-2 imagery comparison endpoints."""

from __future__ import annotations

from datetime import date
from typing import Annotated

import httpx
from fastapi import APIRouter, HTTPException, Path, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from rasterio.errors import RasterioError

from app.api.deps import parse_bbox
from app.services.imagery import ImageryError, expand_bbox

router = APIRouter(prefix="/api/imagery", tags=["imagery"])
ITEM = r"^S2[ABC]_\d{2}[A-Z]{3}_\d{8}_\d+_L2A(,S2[ABC]_\d{2}[A-Z]{3}_\d{8}_\d+_L2A){0,3}$"


def _svc(request: Request):
    return request.app.state.imagery


def _bbox(bbox: str):
    b = parse_bbox(bbox)
    if b is None:
        raise HTTPException(422, "bbox required")
    return b


async def _guard(fn, *args):
    try:
        return await run_in_threadpool(fn, *args)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    except (ImageryError, httpx.HTTPError, RasterioError) as exc:
        raise HTTPException(502, f"Imagery provider unavailable: {str(exc)[:200]}") from None


@router.get("/search")
async def search(request: Request, bbox: str, around: date, max_cloud: Annotated[float, Query(ge=0, le=100)] = 40, expand: bool = True):
    b = _bbox(bbox)
    if expand:
        b = expand_bbox(b)
    return await _guard(_svc(request).search, b, around, 60, 30, max_cloud)


@router.get("/render")
async def render(
    request: Request,
    item: Annotated[str, Query(pattern=ITEM)],
    bbox: str,
    product: Annotated[str, Query(pattern="^(truecolor|swir)$")] = "truecolor",
):
    _, meta = await _guard(_svc(request).render, item, _bbox(bbox), product)
    return {**meta, "png": f"/api/imagery/png/{meta['cache_key']}"}


@router.get("/dnbr")
async def dnbr(request: Request, pre: Annotated[str, Query(pattern=ITEM)], post: Annotated[str, Query(pattern=ITEM)], bbox: str):
    if pre == post:
        raise HTTPException(422, "pre and post scenes must differ")
    _, meta = await _guard(_svc(request).dnbr, pre, post, _bbox(bbox))
    return {**meta, "png": f"/api/imagery/png/{meta['cache_key']}"}


@router.get("/png/{key}")
def png(request: Request, key: Annotated[str, Path(pattern="^[0-9a-f]{24}$")]):
    data = _svc(request).cached_png(key)
    if data is None:
        raise HTTPException(404, "image not rendered")
    return Response(data, media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})
