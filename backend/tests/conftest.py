"""Shared fixtures.

The API fixture runs the real application against a 3,000-row sample of the
actual FIRMS demo snapshot (backend/tests/fixtures/detections_sample.parquet),
the real Natural Earth boundaries, the real flood demo chips and the trained
model artifacts. External HTTP is never called by default; tests that hit real
services are marked ``network``.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import REPO_ROOT, Settings
from app.main import create_app

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="session")
def data_dir(tmp_path_factory) -> Path:
    d = tmp_path_factory.mktemp("data")
    (d / "demo").mkdir()
    shutil.copy(FIXTURES / "detections_sample.parquet", d / "demo" / "detections.parquet")
    shutil.copy(FIXTURES / "provenance.json", d / "demo" / "provenance.json")
    shutil.copytree(REPO_ROOT / "data" / "reference", d / "reference")
    hist = REPO_ROOT / "data" / "demo" / "history"
    if hist.exists():
        shutil.copytree(hist, d / "demo" / "history")
    return d


@pytest.fixture(scope="session")
def settings(data_dir: Path) -> Settings:
    return Settings(data_dir=data_dir, flood_demo_dir=REPO_ROOT / "data" / "flood_demo", max_points=500)


@pytest.fixture(scope="session")
def client(settings: Settings):
    app = create_app(settings, load_live=False)
    with TestClient(app) as c:
        yield c
