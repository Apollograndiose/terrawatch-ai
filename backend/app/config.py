"""Runtime configuration, loaded from environment variables (see .env.example)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), env_prefix="TW_", extra="ignore")

    data_dir: Path = REPO_ROOT / "data"
    ml_artifacts_dir: Path = REPO_ROOT / "ml" / "artifacts"
    ml_reports_dir: Path = REPO_ROOT / "ml" / "reports"
    flood_demo_dir: Path = REPO_ROOT / "data" / "flood_demo"

    # "demo" serves only the bundled snapshot. "live" additionally refreshes the
    # public FIRMS NRT feeds (no key needed) and falls back to the snapshot on failure.
    default_dataset: Literal["demo", "live"] = "demo"
    live_cache_minutes: int = Field(default=30, ge=5, le=24 * 60)
    live_feed_window: Literal["24h", "48h", "7d"] = "7d"

    # Optional NASA FIRMS MAP_KEY (32 lowercase alphanumerics). Read from FIRMS_MAP_KEY.
    firms_map_key: str | None = Field(default=None, validation_alias="FIRMS_MAP_KEY")

    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]
    http_timeout_s: float = 60.0
    user_agent: str = "TerraWatchAI/0.1 (research and education demo; +https://github.com/)"
    nominatim_url: str = "https://nominatim.openstreetmap.org/search"
    stac_url: str = "https://earth-search.aws.element84.com/v1"

    max_points: int = Field(default=20_000, ge=100, le=200_000)

    @field_validator("firms_map_key")
    @classmethod
    def _check_key(cls, v: str | None) -> str | None:
        if v in (None, ""):
            return None
        v = v.strip()
        if len(v) != 32 or not v.isalnum():
            raise ValueError("FIRMS_MAP_KEY must be 32 alphanumeric characters")
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()
