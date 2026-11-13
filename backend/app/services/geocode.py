"""Place search: local Natural Earth country index first, then OpenStreetMap Nominatim.

Nominatim usage policy (https://operations.osmfoundation.org/policies/nominatim/):
max 1 request/second, identifying User-Agent, results cached, attribution
"© OpenStreetMap contributors". We enforce all four here.
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from pathlib import Path

import httpx

from app.ingest.regions import load_countries


class Geocoder:
    def __init__(self, countries_path: Path, nominatim_url: str, user_agent: str, timeout: float = 10.0):
        self.countries_path = countries_path
        self.url = nominatim_url
        self.headers = {"User-Agent": user_agent, "Accept-Language": "en"}
        self.timeout = timeout
        self._last = 0.0
        self._lock = threading.Lock()
        self._cache: OrderedDict[str, list[dict]] = OrderedDict()

    def local(self, q: str) -> list[dict]:
        props, _, _ = load_countries(str(self.countries_path))
        ql = q.lower()
        hits = [p for p in props if p["country"] and (ql in p["country"].lower() or ql == (p["iso3"] or "").lower())]
        hits.sort(key=lambda p: (not p["country"].lower().startswith(ql), len(p["country"])))
        return [
            {
                "name": p["country"],
                "kind": "country",
                "iso3": p["iso3"],
                "bbox": p["bbox"],
                "lat": (p["bbox"][1] + p["bbox"][3]) / 2,
                "lon": (p["bbox"][0] + p["bbox"][2]) / 2,
                "source": "Natural Earth",
            }
            for p in hits[:5]
        ]

    def search(self, q: str, use_remote: bool = True) -> dict:
        q = " ".join(q.split())[:120]
        if len(q) < 2:
            return {"query": q, "results": [], "remote_status": "skipped"}
        results = self.local(q)
        status = "skipped"
        if use_remote:
            key = q.lower()
            if key in self._cache:
                remote, status = self._cache[key], "cached"
            else:
                remote, status = self._remote(q)
                if status == "ok":
                    self._cache[key] = remote
                    while len(self._cache) > 500:
                        self._cache.popitem(last=False)
            seen = {r["name"] for r in results}
            results += [r for r in remote if r["name"] not in seen]
        return {"query": q, "results": results[:8], "remote_status": status}

    def _remote(self, q: str) -> tuple[list[dict], str]:
        with self._lock:
            wait = 1.05 - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
        try:
            r = httpx.get(self.url, params={"q": q, "format": "jsonv2", "limit": 5}, headers=self.headers, timeout=self.timeout)
            r.raise_for_status()
            out = []
            for it in r.json():
                s, n, w, e = (float(v) for v in it["boundingbox"])
                out.append(
                    {
                        "name": it.get("display_name", q)[:160],
                        "kind": it.get("type") or it.get("category"),
                        "bbox": [w, s, e, n],
                        "lat": float(it["lat"]),
                        "lon": float(it["lon"]),
                        "source": "OpenStreetMap Nominatim",
                    }
                )
            return out, "ok"
        except (httpx.HTTPError, ValueError, KeyError):
            return [], "error"
