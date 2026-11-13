"""Shared FastAPI dependencies and query-parameter parsing."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import HTTPException, Query, Request
from pydantic import ValidationError

from app.models.schemas import DetectionFilter
from app.services.store import Dataset, FireStore


def get_store(request: Request) -> FireStore:
    return request.app.state.store


def parse_bbox(bbox: str | None) -> tuple[float, float, float, float] | None:
    if not bbox:
        return None
    try:
        parts = tuple(float(x) for x in bbox.split(","))
    except ValueError:
        raise HTTPException(422, "bbox must be four comma-separated numbers: west,south,east,north") from None
    if len(parts) != 4:
        raise HTTPException(422, "bbox must have exactly four values")
    return parts  # type: ignore[return-value]


def _csv(v: str | None) -> tuple[str, ...]:
    return tuple(x.strip() for x in v.split(",") if x.strip()) if v else ()


def detection_filter(
    bbox: Annotated[str | None, Query(description="west,south,east,north (WGS84)")] = None,
    start: Annotated[datetime | None, Query(description="ISO-8601 UTC start")] = None,
    end: Annotated[datetime | None, Query(description="ISO-8601 UTC end")] = None,
    sources: Annotated[str | None, Query(description="comma-separated FIRMS sources")] = None,
    confidence: Annotated[str | None, Query(description="comma-separated: low,nominal,high")] = None,
    daynight: Annotated[str | None, Query(pattern="^[DN]$")] = None,
    min_frp: Annotated[float | None, Query(ge=0)] = None,
    iso3: Annotated[str | None, Query(pattern="^[A-Z]{3}$")] = None,
) -> DetectionFilter:
    try:
        return DetectionFilter(
            bbox=parse_bbox(bbox),
            start=start,
            end=end,
            sources=_csv(sources),
            confidence=_csv(confidence),
            daynight=daynight,
            min_frp=min_frp,
            iso3=iso3,
        )
    except ValidationError as exc:
        raise HTTPException(
            422, [{"loc": e["loc"], "msg": e["msg"]} for e in exc.errors(include_url=False, include_context=False)]
        ) from None


def dataset_param(dataset: Annotated[str, Query(pattern="^(demo|live)$")] = "demo") -> str:
    return dataset


def resolve(store: FireStore, name: str) -> Dataset:
    return store.get(name)


def served_meta(ds: Dataset, requested: str) -> dict:
    return {
        "dataset_requested": requested,
        "dataset_served": ds.name,
        "dataset_version": ds.version,
        "fallback": requested != ds.name,
    }
