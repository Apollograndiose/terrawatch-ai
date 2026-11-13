"""Analytics endpoints over FIRMS detections and historical archive baselines."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.api.deps import dataset_param, detection_filter, get_store, served_meta
from app.models.schemas import DetectionFilter
from app.services import analytics
from app.services.store import FireStore, history_dir

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/summary")
def summary(
    f: Annotated[DetectionFilter, Depends(detection_filter)],
    dataset: Annotated[str, Depends(dataset_param)],
    store: FireStore = Depends(get_store),
):
    ds = store.get(dataset)
    return {**served_meta(ds, dataset), **analytics.summary(store, ds, f)}


@router.get("/timeseries")
def timeseries(
    f: Annotated[DetectionFilter, Depends(detection_filter)],
    dataset: Annotated[str, Depends(dataset_param)],
    bucket: Annotated[str, Query(pattern="^(hour|6h|day)$")] = "6h",
    store: FireStore = Depends(get_store),
):
    ds = store.get(dataset)
    return {**served_meta(ds, dataset), **analytics.timeseries(store, ds, f, bucket)}


@router.get("/history/countries")
def history_countries(request: Request):
    return {"countries": analytics.history_countries(history_dir(request.app.state.settings))}


@router.get("/history")
def history(
    request: Request,
    country: Annotated[str, Query(min_length=2, max_length=60, pattern=r"^[A-Za-z .'-]+$")],
    vegetation_only: bool = True,
    min_confidence: Annotated[str, Query(pattern="^(low|nominal|high)$")] = "nominal",
):
    try:
        return analytics.history(history_dir(request.app.state.settings), country, vegetation_only, min_confidence)
    except FileNotFoundError:
        raise HTTPException(404, f"no archive baseline for {country}; run app.ingest.archive") from None
