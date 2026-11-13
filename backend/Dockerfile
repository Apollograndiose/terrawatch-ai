# Build from the repository root:  docker build -f backend/Dockerfile -t terrawatch-api .
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv
# rasterio/shapely/duckdb ship manylinux wheels with GDAL/GEOS bundled; no system GIS libraries needed.
COPY backend/requirements.lock backend/requirements.lock
RUN pip install --no-cache-dir -r backend/requirements.lock
COPY ml/pyproject.toml ml/pyproject.toml
COPY ml/terrawatch_ml ml/terrawatch_ml
COPY backend/pyproject.toml backend/pyproject.toml
COPY backend/app backend/app
RUN pip install --no-cache-dir --no-deps ./ml ./backend
COPY ml/artifacts ml/artifacts
COPY ml/reports ml/reports
COPY data/demo data/demo
COPY data/reference data/reference
COPY data/flood_demo data/flood_demo
RUN useradd --create-home --uid 10001 app && mkdir -p data/cache && chown -R app data/cache
USER app
WORKDIR /srv/backend
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/health')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
