.PHONY: setup data flood-data train api web test test-network e2e lint

PY := .venv/bin/python

setup:            ## Create venv, install backend + ML + frontend deps
	python3 -m venv .venv
	$(PY) -m pip install -U pip
	$(PY) -m pip install -r backend/requirements.lock -e ./ml -e "./backend[dev]"
	npm --prefix frontend ci

flood-data:       ## Fetch the 25 Sen1Floods11 demo chips (~45 MB)
	$(PY) ml/scripts/fetch_flood_demo.py

data:             ## Rebuild the FIRMS demo snapshot and archive baselines from NASA (optional)
	cd backend && ../$(PY) -m app.ingest.snapshot --window 7d
	cd backend && ../$(PY) -m app.ingest.archive --countries Australia Brazil Canada "United States" Greece Portugal Indonesia --years 2012-2025

train:            ## Download Sen1Floods11 (~720 MB) and reproduce training + evaluation (~15 min)
	$(PY) ml/scripts/download_sen1floods11.py --out ml/data/sen1floods11
	$(PY) ml/scripts/train.py --data ml/data/sen1floods11
	$(PY) ml/scripts/render_report.py

api:              ## Run the FastAPI backend on :8000
	cd backend && ../.venv/bin/uvicorn app.main:app --port 8000 --reload

web:              ## Run the Next.js frontend on :3000
	npm --prefix frontend run dev

test:             ## Offline backend, ML and frontend unit tests
	cd backend && ../$(PY) -m pytest -m "not network"
	cd ml && ../$(PY) -m pytest tests
	npm --prefix frontend run lint && npm --prefix frontend run typecheck && npm --prefix frontend test

test-network:     ## Live checks against FIRMS, Earth Search and GIBS
	cd backend && ../$(PY) -m pytest -m network

e2e:              ## Playwright end-to-end tests (starts both servers)
	cd frontend && npx playwright test
