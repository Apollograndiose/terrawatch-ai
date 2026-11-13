# Scientific methodology

This document explains what each output means, how it is computed and where it can mislead. The platform separates
**observed data**, **derived (algorithmic) products** and **experimental ML predictions**, and the UI labels each one.

## 1. Wildfire observations (NASA FIRMS)

**Data.** MODIS Collection 6.1 (Terra/Aqua, ~1 km at nadir) and VIIRS 375 m Collection 2 (NOAA-20, NOAA-21, Suomi NPP)
near-real-time active fire products, obtained from the public global 24 h/48 h/7 d CSV feeds. Each record is the centre of a
pixel in which the detection algorithm found one or more thermal anomalies at overpass time.

**What a detection is not.** A detection is not a fire perimeter, not burned area and not a count of fires. One fire can
produce hundreds of detections, while small or short-lived fires, and fires under cloud or thick smoke, may produce none.
Off-nadir pixels are much larger than nadir pixels (scan × track is shown in the explorer). NRT feeds lack the archive's
`type` field, so gas flares, industry and volcanoes are not removed from the live map.

**Normalisation** (`app/ingest/firms.py`). VIIRS and MODIS columns are mapped to one schema (`bright_t4/t5`, `frp`,
`scan`, `track`, ...). Acquisition date + HHMM become a UTC timestamp, with zero-padding for times such as `105` → 01:05.
Out-of-range coordinates and unparsable rows are dropped. Each detection gets a deterministic 64-bit id from
(source, lat, lon, minute).

**Confidence.** VIIRS classes (l/n/h) are used as published. MODIS 0–100 confidence is mapped to the FIRMS-documented
classes: low < 30, nominal 30–79, high ≥ 80. The default view shows nominal + high.

**Regions.** Points are assigned to Natural Earth 1:50m admin-0 polygons (STRtree point-in-polygon). Coastal or
small-island points can fall outside the generalised polygons and are reported as "Unassigned".

## 2. Observation clusters (derived, not ML)

Detections are snapped to a ~1.5 km equal-distance grid (longitude scaled by cos φ). Occupied cells that touch
(8-neighbourhood) are joined by connected components over the selected time window. This is single-linkage grouping with a
maximum gap of ~1.5–3 km, equivalent in spirit to DBSCAN with `min_samples = 1`, and runs in O(n) on 1 M points (< 1 s).

*Limitations.* In landscapes with widespread burning (e.g. Sahel savanna in the dry season), chains of nearby detections
merge into very large clusters. A single fire can also split across cloud gaps. Clusters are therefore never called
"events". Summed FRP adds every overpass and is used only to rank clusters relative to each other.

## 3. Historical baselines

MODIS C6.1 *standard-processing* yearly country files (2012–2025) are streamed and aggregated monthly by `type`,
confidence and day/night; only aggregates are stored. MODIS is used because it is the longest consistent record. VIIRS
counts are not comparable because VIIRS detects many more, smaller fires. Terra and Aqua orbit drift in recent years shifts
overpass times and can bias trends. The z-score per year is descriptive only.

## 4. Sentinel-2 imagery comparison

* Scenes are found in Earth Search (`sentinel-2-l2a`) within 60 days before and 30 days after the cluster's first detection,
  with scene cloud < 40 %. Tiles from the same pass (platform + date) are grouped and mosaicked, and passes covering < 20 % of
  the area of interest are dropped.
* Bands are read from COGs at near-output resolution (overviews), reprojected to a WGS84 grid of ≤ 1024 px, and converted to
  surface reflectance with each asset's published `scale`/`offset` (which handles the processing-baseline 04.00 offset).
* The Scene Classification Layer masks no-data, saturation, cloud shadow, medium/high cloud and cirrus.
* **dNBR** = NBR(pre) − NBR(post), with NBR = (B8A − B12)/(B8A + B12), classified with the Key & Benson (2006) USGS FIREMON
  ranges. It is an uncalibrated spectral-index change layer: phenology, harvest, residual cloud, sun angle and
  pre-fire scene choice all change it. No field validation was performed.

## 5. Flood module: SAR surface-water model (experimental ML)

**Task.** Per-pixel classification of open surface water in a single Sentinel-1 GRD IW acquisition (VV, VH σ⁰ in dB, 10 m).

**Dataset.** Sen1Floods11 hand-labelled subset (Bonafilia et al. 2020): 446 chips of 512 × 512 px from 11 flood events on
6 continents (2016–2019), labelled by analysts using Sentinel-1 and Sentinel-2. Labels mark all water (permanent + flood);
JRC Global Surface Water supplies a permanent-water mask. Limitations: one date per event, 11 events, human labelling
errors, and Earth Engine-specific pre-processing (thermal-noise removal, terrain correction, dB).

**Features** (`terrawatch_ml/features.py`, 22 per pixel):
* VV, VH, VV − VH (cross-pol ratio in dB);
* NaN-aware local mean and standard deviation of VV and VH in 3, 7 and 15 px windows (speckle suppression + texture);
* Lee (1980) filtered VV/VH (7 × 7, ENL 4.4, computed in linear power);
* scene-relative terms: distance from the chip median and from the chip's own Otsu threshold;
* local valid-data fraction.

**Model.** `HistGradientBoostingClassifier` (300 iterations, 31 leaves, L2 = 1, min leaf 50), trained on 5,000 uniformly
sampled labelled pixels per chip (sampling preserves class priors). Hyper-parameters were fixed before evaluation.

**Evaluation (leakage control).** Leave-one-event-out cross-validation over the 10 development events, plus Bolivia held
out entirely (the dataset authors' own out-of-distribution test). The decision threshold was selected on pooled
out-of-fold predictions. Baselines: per-chip Otsu on VV, a single VV threshold fitted on training events, and the
dataset authors' published scene-level Otsu masks. 95 % CIs come from a chip-level bootstrap. Full results are in
[MODEL_EVALUATION.md](MODEL_EVALUATION.md).

**Inferred flood** = predicted water ∧ ¬ JRC permanent water. This is an inference from one image, not a pre/post change
detection, and errors in either layer propagate.

**Uncertainty** is shown as 1 − |2p − 1| per pixel (largest where P(water) ≈ 0.5), with the fraction of pixels in
0.25 < p < 0.75. Probabilities are well calibrated in cross-validation but under-confident on Bolivia, so they are not
reliable probabilities under distribution shift.

## 6. What the platform does not do

* No fire spread prediction, risk scoring or alerting.
* No ML on wildfire detections in this version: clusters and dNBR are deterministic algorithms.
* No pre/post SAR change detection; Sentinel-1 for arbitrary new events is accepted only as user-uploaded GeoTIFFs.
* It does not replace official products such as Copernicus EMS rapid mapping, national fire agencies or MODIS/VIIRS
  burned-area products.
