# Deployment

The app is two processes: the FastAPI backend (`:8000`, ~1.5 GB RAM with the 1 M-row snapshot loaded) and the Next.js
frontend (`:3000`). The frontend proxies `/api/*` to `TERRAWATCH_API_URL`, so only the frontend needs to be public.

> Status: local runs and the production `next build` were verified. The Dockerfiles and the cloud recipes below were
> written but **not executed** in this build environment (Docker was not installed). Treat them as a starting point.

## Docker Compose (single host)

```bash
python ml/scripts/fetch_flood_demo.py     # optional: include flood demo chips in the API image
docker compose up --build                 # http://localhost:3000
```

Set `FIRMS_MAP_KEY` and `TW_DEFAULT_DATASET=live` in the environment or an `.env` file to start with live feeds.

## Split hosting

**Backend** (Render, Railway, Fly.io, Cloud Run, or any container host):
* Build with `backend/Dockerfile` from the repository root (it copies `ml/`, `data/demo`, `data/reference`, `data/flood_demo`).
* Allocate ≥ 2 GB RAM. Expose port 8000. Health check: `GET /api/health`.
* Env: `TW_CORS_ORIGINS='["https://your-frontend.example"]'` (only needed if browsers call the API directly),
  optional `FIRMS_MAP_KEY`, `TW_DEFAULT_DATASET=live`.
* `data/cache/` (live parquet, rendered imagery) is ephemeral and safe to lose; mount a volume to keep it across restarts.

**Frontend** (Vercel or any Node 22 host):
* Root directory `frontend/`, build `npm run build`, start `npm start`.
* Env: `TERRAWATCH_API_URL=https://your-api.example` (used by the rewrite proxy at build and run time).

## Production hardening checklist

* Put the API behind a reverse proxy with request-rate limits (the imagery endpoints do outbound COG reads).
* Keep `/api/live/refresh` cooldown (5 min) or protect it. It downloads ~85 MB from FIRMS.
* Schedule `python -m app.ingest.snapshot` (e.g. daily) if you want a refreshed demo snapshot. Commit only with provenance.
* Configure HTTPS and a Content-Security-Policy that allows `tiles.openfreemap.org`, `gibs.earthdata.nasa.gov` and same-origin `/api`.
* Pin image digests and run `pip-audit` / `npm audit` in CI.
