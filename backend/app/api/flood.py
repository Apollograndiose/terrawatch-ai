"""Flood module and model-card endpoints."""

from __future__ import annotations

import base64
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Path, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response

from app.services.flood import LAYERS, MAX_UPLOAD_BYTES, FloodService

router = APIRouter(prefix="/api", tags=["flood", "ml"])
CHIP = r"^[A-Za-z-]+_\d+$"


def _svc(request: Request) -> FloodService:
    svc: FloodService = request.app.state.flood
    if not svc.available:
        raise HTTPException(
            503,
            "Flood module unavailable: run `python ml/scripts/fetch_flood_demo.py` to download the "
            "Sen1Floods11 demo chips (and ml/scripts/train.py if model artifacts are missing).",
        )
    return svc


@router.get("/flood/chips")
def chips(request: Request):
    svc = _svc(request)
    return {"chips": svc.chips, "layers": list(LAYERS)}


@router.get("/flood/chips/{chip_id}")
async def chip(request: Request, chip_id: Annotated[str, Path(pattern=CHIP)]):
    svc = _svc(request)
    if chip_id not in svc.by_id:
        raise HTTPException(404, "chip not found")
    res = await run_in_threadpool(svc.analyse, chip_id)
    return {"chip": svc.by_id[chip_id], "stats": res.stats}


@router.get("/flood/chips/{chip_id}/layers/{layer}.png")
async def layer(request: Request, chip_id: Annotated[str, Path(pattern=CHIP)], layer: str):
    svc = _svc(request)
    if layer not in LAYERS:
        raise HTTPException(404, "unknown layer")
    try:
        data = await run_in_threadpool(svc.layer_png, chip_id, layer)
    except KeyError:
        raise HTTPException(404, "chip or layer not found") from None
    return Response(data, media_type="image/png", headers={"Cache-Control": "public, max-age=3600"})


@router.post("/flood/predict")
async def predict_upload(request: Request, file: Annotated[UploadFile, File(description="GeoTIFF, bands VV,VH in dB")]):
    svc = _svc(request)
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    try:
        png, stats = await run_in_threadpool(svc.predict_upload, data)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    return {"stats": stats, "probability_png": "data:image/png;base64," + base64.b64encode(png).decode()}


@router.get("/ml/model-card")
def model_card(request: Request):
    card = request.app.state.flood.model_card()
    if not card:
        raise HTTPException(404, "no evaluation report; run ml/scripts/train.py")
    return card
