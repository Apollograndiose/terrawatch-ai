"""Pydantic request/response models."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

ConfidenceClass = Literal["low", "nominal", "high", "unknown"]
SourceId = Literal["VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT", "VIIRS_SNPP_NRT", "MODIS_NRT"]
DatasetName = Literal["demo", "live"]


class DetectionFilter(BaseModel):
    """Validated filter shared by all detection queries."""

    bbox: tuple[float, float, float, float] | None = None
    start: datetime | None = None
    end: datetime | None = None
    sources: tuple[SourceId, ...] = ()
    confidence: tuple[ConfidenceClass, ...] = ()
    daynight: Literal["D", "N"] | None = None
    min_frp: float | None = Field(default=None, ge=0, le=100_000)
    iso3: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")

    @field_validator("bbox")
    @classmethod
    def _bbox(cls, v):
        if v is None:
            return v
        w, s, e, n = v
        if not (-180 <= w <= 180 and -180 <= e <= 180 and -90 <= s < n <= 90):
            raise ValueError("bbox must be west,south,east,north in WGS84 degrees")
        return v

    @model_validator(mode="after")
    def _range(self):
        if self.start and self.end and self.start > self.end:
            raise ValueError("start must be before end")
        return self

    def key(self) -> str:
        return self.model_dump_json()


class Detection(BaseModel):
    id: str
    latitude: float
    longitude: float
    acq_datetime: datetime
    source: str
    satellite: str
    instrument: str
    confidence_raw: str
    confidence_class: str
    bright_t4: float | None
    bright_t5: float | None
    frp: float | None
    scan: float | None
    track: float | None
    daynight: str
    version: str
    country: str
    iso3: str
    subregion: str
    continent: str
    pixel_area_km2: float | None = Field(None, description="Approximate footprint: scan x track (km^2)")


class ApiError(BaseModel):
    code: str
    message: str
