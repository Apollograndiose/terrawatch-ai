import type { StyleSpecification } from "maplibre-gl";

/**
 * Basemap: OpenFreeMap "dark" vector style (OpenStreetMap data, no API key).
 * https://openfreemap.org — © OpenMapTiles © OpenStreetMap contributors.
 */
export const BASEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

/** Offline-safe fallback: a plain dark background so data layers still render if the basemap is unreachable. */
export const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#0a101c" } }],
};

/**
 * NASA GIBS daily corrected-reflectance true colour (VIIRS NOAA-20), Web Mercator WMTS.
 * Verified endpoint: /wmts/epsg3857/best/<layer>/default/<YYYY-MM-DD>/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg
 */
export function gibsTrueColorTiles(date: string, layer = "VIIRS_NOAA20_CorrectedReflectance_TrueColor"): string[] {
  return [`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`];
}

export const GIBS_ATTRIBUTION =
  'Imagery: <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener">NASA GIBS</a> / VIIRS NOAA-20 Corrected Reflectance';

/** Make an OSM-based dark style quieter so thermal data reads first. */
export function muteBasemap(map: import("maplibre-gl").Map) {
  const style = map.getStyle();
  if (!style?.layers) return;
  for (const l of style.layers) {
    try {
      if (l.type === "background") map.setPaintProperty(l.id, "background-color", "#080d18");
      if (l.type === "fill" && /water/.test(l.id)) map.setPaintProperty(l.id, "fill-color", "#0b1424");
      if (l.type === "symbol") {
        map.setPaintProperty(l.id, "text-color", "#8291ab");
        map.setPaintProperty(l.id, "text-halo-color", "#070b14");
      }
      if (l.type === "line" && /boundary|admin/.test(l.id)) map.setPaintProperty(l.id, "line-color", "#33415e");
    } catch {
      /* layer without that property */
    }
  }
}
