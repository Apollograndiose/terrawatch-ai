# Data sources, licences and verification

"Verified" means the endpoint was called and its response parsed during development on **2026-11-12/13 (UTC)**. The
opt-in test suite `pytest -m network` repeats these checks.

| Source | Endpoint used | Auth | Verified | Licence / terms |
|---|---|---|---|---|
| NASA FIRMS NRT global feeds (MODIS C6.1, VIIRS NOAA-20, NOAA-21, S-NPP) | `https://firms.modaps.eosdis.nasa.gov/data/active_fire/<product>/csv/<file>_Global_{24h,48h,7d}.csv` | none | ✅ (Suomi-NPP feed returned header only, i.e. no detections, at verification time) | NASA Earth science data are openly shared without restriction; acknowledge LANCE FIRMS |
| NASA FIRMS Area API | `https://firms.modaps.eosdis.nasa.gov/api/area/csv/<MAP_KEY>/<SOURCE>/<W,S,E,N>/<1-5>/<date>` | free MAP_KEY | ⚠️ URL builder + key validation implemented and unit-tested; not called (no key available in this build) | as above |
| NASA FIRMS yearly country archive (MODIS C6.1 SP) | `https://firms.modaps.eosdis.nasa.gov/data/country/modis/<YEAR>/modis_<YEAR>_<Country>.csv` | none | ✅ 98 country-years ingested | as above |
| Element 84 Earth Search (Sentinel-2 L2A COGs on AWS) | `https://earth-search.aws.element84.com/v1` (`/search`, `/collections/sentinel-2-l2a/items/<id>`) | none | ✅ search, multi-tile mosaics, dNBR | Copernicus Sentinel data: free, full and open; "Contains modified Copernicus Sentinel data [year]" |
| NASA GIBS WMTS | `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/<date>/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg` | none | ✅ | NASA open data; acknowledge GIBS |
| Sen1Floods11 v1.1 | `https://storage.googleapis.com/sen1floods11/v1.1/...` | none | ✅ 446 chips downloaded | **No licence file in the source repository** (github.com/cloudtostreet/Sen1Floods11); a third-party mirror tags it CC BY 4.0, unconfirmed. Rasters are therefore not committed; they are fetched by script. Cite the paper. |
| JRC Global Surface Water | bundled in Sen1Floods11 (`JRCWaterHand`) | — | ✅ | EC JRC, free with attribution (Pekel et al. 2016) |
| Natural Earth Admin-0 1:50m | `github.com/nvkelso/natural-earth-vector` | none | ✅ committed in `data/reference` | Public domain |
| OpenFreeMap basemap | `https://tiles.openfreemap.org/styles/dark` | none | ✅ | © OpenMapTiles © OpenStreetMap contributors (ODbL) |
| OSM Nominatim | `https://nominatim.openstreetmap.org/search` | none | ✅ | ODbL; usage policy: ≤ 1 req/s, identifying User-Agent, caching (all enforced in `services/geocode.py`) |

Privacy note: place searches typed by a user are forwarded to Nominatim (after the local country lookup). Nothing else
leaves the backend except requests to the data providers above.

## Bundled demo data (committed)

* `data/demo/detections.parquet`: 1,010,464 FIRMS NRT detections (NOAA-20 467,458; NOAA-21 452,955; MODIS 90,051;
  S-NPP 0), observed 2026-11-05 00:00 → 2026-11-12 23:48 UTC, retrieved 2026-11-13 01:54 UTC. `provenance.json` lists
  each feed URL, HTTP Last-Modified, byte count and SHA-256 of the raw CSV.
* `data/demo/history/*.parquet`: monthly aggregates of the MODIS archive for Australia, Brazil, Canada, Greece, Indonesia,
  Portugal and the United States (2012–2025), with per-file SHA-256 in `provenance.json`.
* `backend/tests/fixtures/detections_sample.parquet`: 2,997 rows sampled from the snapshot above (not synthetic).

## Citations

* NASA FIRMS. MODIS C6.1 NRT: doi:10.5067/FIRMS/MODIS/MCD14DL.NRT.0061. VIIRS 375 m NRT: doi:10.5067/FIRMS/VIIRS/VNP14IMGT_NRT.002,
  doi:10.5067/FIRMS/VIIRS/VJ114IMGT_NRT.002, doi:10.5067/FIRMS/VIIRS/VJ214IMGT_NRT.002.
* Schroeder, W. et al. (2014). The New VIIRS 375 m active fire detection data product. *Remote Sensing of Environment* 143, 85–96.
* Giglio, L., Schroeder, W., Justice, C. (2016). The collection 6 MODIS active fire detection algorithm and fire products. *RSE* 178, 31–41.
* Bonafilia, D., Tellman, B., Anderson, T., Issenberg, E. (2020). Sen1Floods11: a georeferenced dataset to train and test deep learning flood algorithms for Sentinel-1. CVPR Workshops, 210–211.
* Pekel, J.-F. et al. (2016). High-resolution mapping of global surface water and its long-term changes. *Nature* 540, 418–422.
* Key, C.H., Benson, N.C. (2006). Landscape assessment: ground measure of severity, the Composite Burn Index; and remote sensing of severity, the Normalized Burn Ratio. USDA FS RMRS-GTR-164-CD.
* Lee, J.-S. (1980). Digital image enhancement and noise filtering by use of local statistics. *IEEE TPAMI* 2(2), 165–168.
* Otsu, N. (1979). A threshold selection method from gray-level histograms. *IEEE TSMC* 9(1), 62–66.

We acknowledge the use of data and imagery from LANCE FIRMS operated by NASA's Earth Science Data and Information System
(ESDIS) with funding provided by NASA Headquarters.
