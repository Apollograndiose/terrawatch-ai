export type DatasetName = "demo" | "live";
export type SourceId = "VIIRS_NOAA20_NRT" | "VIIRS_NOAA21_NRT" | "VIIRS_SNPP_NRT" | "MODIS_NRT";
export type ConfidenceClass = "low" | "nominal" | "high";

export interface Filters {
  dataset: DatasetName;
  start: string | null; // ISO date (YYYY-MM-DD), inclusive, UTC
  end: string | null; // ISO date (YYYY-MM-DD), inclusive, UTC
  sources: SourceId[];
  confidence: ConfidenceClass[];
  daynight: "D" | "N" | null;
  minFrp: number | null;
  iso3: string | null;
}

export interface ServedMeta {
  dataset_requested: DatasetName;
  dataset_served: DatasetName;
  dataset_version: number;
  fallback: boolean;
}

export interface PointsPayload {
  id: string[];
  lon: number[];
  lat: number[];
  frp: number[];
  t: string[];
  src: string[];
  conf: string[];
  dn: string[];
}

export interface GridPayload {
  lon: number[];
  lat: number[];
  n: number[];
  frp_sum: number[];
  frp_max: number[];
}

export type MapResponse = ServedMeta & { total: number } & (
    | { mode: "points"; returned: number; truncated: boolean; points: PointsPayload }
    | { mode: "grid"; cell_deg: number; cells: GridPayload }
  );

export interface FeedStatus {
  source: string;
  state: "ok" | "empty" | "error" | "not_loaded";
  rows: number;
  retrieved_utc: string | null;
  http_last_modified: string | null;
  latest_observation_utc: string | null;
  message: string | null;
  url: string | null;
}

export interface DatasetInfo {
  name: DatasetName;
  rows: number;
  earliest_observation_utc: string | null;
  latest_observation_utc: string | null;
  loaded_utc: string;
  created_utc: string | null;
  version: number;
  feeds: FeedStatus[];
}

export interface StatusResponse {
  datasets: Partial<Record<DatasetName, DatasetInfo>>;
  live: { state: string; error: string | null; window: string; cache_minutes: number; stale: boolean };
  firms_map_key_configured: boolean;
  flood_model_available: boolean;
  attribution: string[];
}

export interface Grouped {
  key: string;
  count: number;
  frp_sum: number;
}

export interface SummaryResponse extends ServedMeta {
  count: number;
  frp_sum_mw: number;
  frp_max_mw: number | null;
  frp_p50_mw: number | null;
  frp_p90_mw: number | null;
  first_utc: string | null;
  last_utc: string | null;
  by_source: Grouped[];
  by_confidence: Grouped[];
  by_daynight: Grouped[];
  by_continent: Grouped[];
  by_country: Grouped[];
}

export interface TimeseriesRow {
  t: string;
  total: number;
  frp_sum: number;
  [source: string]: number | string;
}

export interface TimeseriesResponse extends ServedMeta {
  bucket: string;
  series: TimeseriesRow[];
  sources: string[];
}

export interface Cluster {
  cluster_id: string;
  detections: number;
  lat: number;
  lon: number;
  bbox: [number, number, number, number];
  first_utc: string;
  last_utc: string;
  frp_sum_mw: number;
  frp_max_mw: number;
  active_days: number;
  high_confidence: number;
  sources: string[];
  country: string;
  iso3: string;
}

export interface ClustersResponse extends ServedMeta {
  method: { name: string; link_km: number; description: string };
  total_clusters: number;
  clusters: Cluster[];
}

export interface ClusterDetail extends ServedMeta {
  cluster: Cluster;
  timeline_6h: ({ t: string; total: number } & Record<string, number | string>)[];
  daynight: Record<string, number>;
  confidence: Record<string, number>;
  frp_histogram: { lo: number; hi: number | null; count: number }[];
  points: PointsPayload;
  points_truncated: boolean;
}

export interface DetectionRecord {
  id: string;
  latitude: number;
  longitude: number;
  acq_datetime: string;
  source: string;
  satellite: string;
  instrument: string;
  confidence_raw: string;
  confidence_class: string;
  bright_t4: number | null;
  bright_t5: number | null;
  frp: number | null;
  scan: number | null;
  track: number | null;
  daynight: string;
  version: string;
  type: number | null;
  country: string;
  iso3: string;
  subregion: string;
  continent: string;
  pixel_area_km2: number | null;
}

export interface DetectionResponse extends ServedMeta {
  detection: DetectionRecord;
  context: { radius_km: number; window_hours: number; detections: number; frp_sum_mw: number; distinct_sources: number };
  interpretation: string;
}

export interface HistoryResponse {
  country: string;
  years: number[];
  monthly: { year: number; month: number; count: number; frp_sum: number }[];
  annual: { year: number; count: number; frp_sum: number; anomaly_z: number | null }[];
  climatology: { month: number; mean: number; min: number; max: number; std: number | null }[];
  filters: { vegetation_only: boolean; min_confidence: string };
  note: string;
}

export interface SceneSummary {
  /** Comma-separated item ids of all tiles in this acquisition (mosaicked by the backend). */
  id: string;
  items: string[];
  aoi_coverage: number;
  datetime: string;
  platform: string | null;
  scene_cloud_cover: number | null;
  mgrs_tile: string | null;
  processing_baseline: string | null;
  thumbnail: string | null;
}

export interface SceneSearch {
  bbox: [number, number, number, number];
  around: string;
  windows: { before: [string, string]; after: [string, string] };
  max_scene_cloud: number;
  before: SceneSummary[];
  after: SceneSummary[];
}

export interface RenderMeta {
  item_id: string;
  datetime: string;
  platform: string | null;
  scene_cloud_cover: number | null;
  width: number;
  height: number;
  aoi_valid_fraction: number;
  product: string;
  bounds: [number, number, number, number];
  cloud_masked_fraction: number;
  png: string;
}

export interface DnbrClass {
  label: string;
  range: [number | null, number | null];
  rgba: [number, number, number, number];
  area_km2: number;
  fraction_of_valid: number;
}

export interface DnbrMeta {
  product: "dnbr";
  bounds: [number, number, number, number];
  valid_fraction: number;
  classes: DnbrClass[];
  pixel_area_km2: number;
  dnbr_stats: { p50: number | null; p95: number | null };
  method: string;
  caveat: string;
  png: string;
  pre: { item_id: string; datetime: string };
  post: { item_id: string; datetime: string };
}

export interface FloodChip {
  chip_id: string;
  event: string;
  country: string;
  date: string;
  bbox: [number, number, number, number];
  official_split: string;
  model: string;
  role: "holdout" | "loeo";
  reference_water_fraction: number;
}

export interface Scores {
  precision: number;
  recall: number;
  f1: number;
  iou: number;
  accuracy: number;
  kappa: number;
  support_water: number;
  support_total: number;
  confusion_matrix?: number[][];
}

export interface ChipStats {
  valid_fraction: number;
  pixel_area_km2: number;
  predicted_water_km2: number;
  permanent_water_km2: number | null;
  inferred_flood_km2: number | null;
  otsu_water_km2: number;
  uncertain_fraction: number;
  mean_probability_in_predicted: number | null;
  uncertainty_band: [number, number];
  reference_water_km2?: number;
  reference_labelled_fraction?: number;
  model_vs_reference?: Scores;
  otsu_vs_reference?: Scores;
  model: { name: string; role: string; trained_on_events: string[]; excluded_events: string[]; threshold: number };
}
