import type { GridPayload, PointsPayload } from "./types";

export interface FC<P> {
  type: "FeatureCollection";
  features: { type: "Feature"; id?: number; geometry: GeoJSONGeometry; properties: P }[];
}
type GeoJSONGeometry =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "Polygon"; coordinates: [number, number][][] };

export interface PointProps {
  id: string;
  frp: number;
  t: string;
  src: string;
  conf: string;
  dn: string;
}

/** Columnar detection payload -> GeoJSON points (kept columnar on the wire to shrink payloads ~3x). */
export function pointsToGeoJSON(p: PointsPayload): FC<PointProps> {
  const features = new Array(p.id.length);
  for (let i = 0; i < p.id.length; i++) {
    features[i] = {
      type: "Feature",
      id: i,
      geometry: { type: "Point", coordinates: [p.lon[i], p.lat[i]] },
      properties: { id: p.id[i], frp: p.frp[i], t: p.t[i], src: p.src[i], conf: p.conf[i], dn: p.dn[i] },
    };
  }
  return { type: "FeatureCollection", features };
}

export interface CellProps {
  n: number;
  frp_sum: number;
  frp_max: number;
  log_n: number;
}

/** Grid aggregate -> square polygons of `cell` degrees centred on each cell. */
export function gridToGeoJSON(g: GridPayload, cell: number): FC<CellProps> {
  const h = cell / 2;
  const features = new Array(g.n.length);
  for (let i = 0; i < g.n.length; i++) {
    const x = g.lon[i];
    const y = g.lat[i];
    const s = Math.max(-85, y - h);
    const n = Math.min(85, y + h);
    features[i] = {
      type: "Feature",
      id: i,
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [x - h, s],
            [x + h, s],
            [x + h, n],
            [x - h, n],
            [x - h, s],
          ],
        ],
      },
      properties: { n: g.n[i], frp_sum: g.frp_sum[i], frp_max: g.frp_max[i], log_n: Math.log10(g.n[i] + 1) },
    };
  }
  return { type: "FeatureCollection", features };
}

export function bboxPolygon(b: [number, number, number, number]): FC<Record<string, never>> {
  const [w, s, e, n] = b;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [w, s],
              [e, s],
              [e, n],
              [w, n],
              [w, s],
            ],
          ],
        },
        properties: {},
      },
    ],
  };
}

/** Image source corner order expected by MapLibre: top-left, top-right, bottom-right, bottom-left. */
export function imageCorners(b: [number, number, number, number]): [[number, number], [number, number], [number, number], [number, number]] {
  const [w, s, e, n] = b;
  return [
    [w, n],
    [e, n],
    [e, s],
    [w, s],
  ];
}

/** Approximate area of a lon/lat bbox in km^2 (spherical, fine for small boxes). */
export function bboxAreaKm2(b: [number, number, number, number]): number {
  const [w, s, e, n] = b;
  const lat = ((s + n) / 2) * (Math.PI / 180);
  return (e - w) * 111.32 * Math.cos(lat) * (n - s) * 110.574;
}
