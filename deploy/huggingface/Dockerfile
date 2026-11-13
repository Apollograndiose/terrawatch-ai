# Single-container image for a Hugging Face Docker Space (also runs anywhere: docker run -p 7860:7860 ...).
# Build from the repository root:  docker build -f deploy/huggingface/Dockerfile -t terrawatch .
# Next.js listens on 7860 (public) and proxies /api/* to FastAPI on 127.0.0.1:8000 (internal only).

FROM node:22-slim AS web
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
COPY frontend/scripts ./scripts
RUN npm ci
COPY frontend/ ./
ARG TW_FRAME_ANCESTORS="https://huggingface.co"
ENV TERRAWATCH_API_URL=http://127.0.0.1:8000 TW_FRAME_ANCESTORS=$TW_FRAME_ANCESTORS NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 && rm -rf /var/lib/apt/lists/*
COPY --from=web /usr/local/bin/node /usr/local/bin/node

# Hugging Face runs Spaces as uid 1000.
RUN useradd --create-home --uid 1000 user
WORKDIR /srv

COPY backend/requirements.lock backend/requirements.lock
RUN pip install --no-cache-dir -r backend/requirements.lock
COPY ml/pyproject.toml ml/pyproject.toml
COPY ml/terrawatch_ml ml/terrawatch_ml
COPY backend/pyproject.toml backend/pyproject.toml
COPY backend/app backend/app
RUN pip install --no-cache-dir --no-deps ./ml ./backend

COPY ml/artifacts ml/artifacts
COPY ml/reports ml/reports
COPY ml/scripts ml/scripts
COPY data/demo data/demo
COPY data/reference data/reference
COPY data/flood_demo/chips.json data/flood_demo/chips.json
# Sen1Floods11 rasters are not redistributed in the repository; fetch them from the authors' public bucket at build time.
RUN python ml/scripts/fetch_flood_demo.py --out data/flood_demo

COPY --from=web /app /srv/frontend
COPY deploy/huggingface/start.sh /srv/start.sh
RUN chmod +x /srv/start.sh && mkdir -p data/cache && chown -R user data/cache

USER user
EXPOSE 7860
CMD ["/srv/start.sh"]
