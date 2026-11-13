---
title: TerraWatch AI
emoji: 🛰️
colorFrom: gray
colorTo: red
sdk: docker
app_port: 7860
pinned: false
license: mit
short_description: NASA FIRMS wildfire explorer + evaluated SAR flood model
---

# TerraWatch AI — Satellite Disaster Intelligence (demo)

Interactive explorer for ~1 million real NASA FIRMS satellite fire detections, Sentinel-2 before/after imagery with a
burn-severity (dNBR) layer, and an experimental Sentinel-1 radar water-segmentation model evaluated on Sen1Floods11.

> ⚠️ **Research and education only. Not an emergency-warning system.** Hotspots are satellite thermal-anomaly
> observations, not fire perimeters; flood layers are model inferences, not verified flood maps.

* The demo starts on a bundled FIRMS snapshot (observed 2026-11-05 → 2026-11-12 UTC). "Live NRT" downloads the current
  public feeds (rate-limited to one refresh per 5 minutes).
* This free Space sleeps after a period of inactivity; the first visit afterwards takes 1–2 minutes to start.
* Place searches are forwarded to OpenStreetMap Nominatim. Sentinel-2 scenes are read from Element 84 Earth Search.

Data: NASA LANCE FIRMS; contains modified Copernicus Sentinel data (2026); Sen1Floods11 (Bonafilia et al., 2020), fetched
from the authors' bucket at build time; © OpenMapTiles © OpenStreetMap contributors; Natural Earth.
