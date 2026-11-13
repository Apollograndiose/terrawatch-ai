#!/bin/bash
# Runs the API (internal) and the web app (public) in one container; exits if either process dies.
set -euo pipefail

cd /srv/backend
uvicorn app.main:app --host 127.0.0.1 --port 8000 --proxy-headers --forwarded-allow-ips 127.0.0.1 &

cd /srv/frontend
node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port "${PORT:-7860}" &

wait -n
exit $?
