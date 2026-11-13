# Limitations and roadmap

## Current limitations (honest list)

**Wildfire**
* Hotspots are pixel-centre observations; clusters are single-linkage groupings that can merge neighbouring fires in
  heavily burned landscapes. No perimeter, burned-area or spread modelling.
* The live map does not remove static industrial sources or volcanoes (the NRT feeds lack the archive `type` field).
* Historical baselines are pre-aggregated for 7 countries only. Others require running `app.ingest.archive`.
* FIRMS Area API (custom dates beyond the 7-day feed) is implemented as a URL builder with key validation but has not
  been exercised against the live service (no MAP_KEY was available).
* No machine learning is applied to wildfire detections in this version.

**Imagery**
* dNBR is not field-validated. Scene choice, phenology and residual cloud affect it, and AOIs are capped at 0.6° per side.
* First render of a scene takes 2–15 s (remote COG reads). Results are cached on local disk only.

**Flood / ML**
* One-date water segmentation, not pre/post change detection. "Inferred flood" depends on JRC permanent water.
* The model is beaten by the published scene-level Otsu masks on the Bolivia hold-out and is weakest on arid scenes
  (see MODEL_EVALUATION.md). Probabilities are miscalibrated under distribution shift.
* Uploaded GeoTIFFs must already be σ⁰ dB VV/VH. RTC gamma⁰ or other processing chains introduce a distribution shift.
* Demo chips come from 2016–2019 events, so the module does not monitor current floods.

**Engineering**
* Docker/compose files are untested (Docker was unavailable and CI does not build images). CI runs only the offline
  test suites; the live-network checks are run manually with `pytest -m network` and `E2E_NETWORK=1`.
* No authentication or user accounts; designed as a public read-only research tool.

## Roadmap

1. **Flood change detection:** pull pre/post Sentinel-1 RTC from Microsoft Planetary Computer for user-selected events,
   with HAND/DEM masking (MERIT Hydro or Copernicus DEM) to suppress terrain false positives.
2. **U-Net baseline** on Sen1Floods11 (PyTorch, optional extra) using the same LOEO + Bolivia protocol; add scene-level
   context to close the gap with published Otsu.
3. **Wildfire ML (narrow, labelled):** classify NRT detections as vegetation fire vs. static/industrial source using
   archive `type` labels, with temporal (train ≤ 2023, test 2024) and country-held-out splits.
4. **Space-time clustering** (ST-DBSCAN / fire-event tracking à la FIRED/GlobFire) validated against MCD64A1 burned area.
5. **PostGIS + scheduled ingestion** for multi-year archives and polygon AOI queries; vector tiles for > 1 M points.
6. New modules: drought (SMAP/NDVI anomalies), deforestation (GLAD alerts), hurricanes (IBTrACS tracks + flood overlay).
