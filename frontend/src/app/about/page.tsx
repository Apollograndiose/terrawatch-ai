import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Methods & data" };

const SOURCES: { name: string; provider: string; use: string; access: string; license: string; href: string }[] = [
  {
    name: "FIRMS active fire (MODIS C6.1, VIIRS 375 m NOAA-20/21, S-NPP)",
    provider: "NASA LANCE / FIRMS",
    use: "Hotspot map, clusters, analytics (NRT global CSV feeds; demo snapshot)",
    access: "Public, no key (global feeds). Optional free MAP_KEY for the Area API.",
    license: "NASA open data policy; cite DOIs listed in the README",
    href: "https://firms.modaps.eosdis.nasa.gov/",
  },
  {
    name: "FIRMS yearly country archive (MODIS C6.1 SP)",
    provider: "NASA FIRMS",
    use: "2012–2025 monthly historical baselines (incl. FIRMS ‘type’ field)",
    access: "Public, no key",
    license: "NASA open data policy",
    href: "https://firms.modaps.eosdis.nasa.gov/country/",
  },
  {
    name: "Sentinel-2 L2A (COG)",
    provider: "ESA Copernicus via Element 84 Earth Search / AWS Open Data",
    use: "Before/after true-colour & SWIR imagery, dNBR change layer",
    access: "Public STAC API, no key",
    license: "Copernicus free & open licence (attribution required)",
    href: "https://earth-search.aws.element84.com/v1",
  },
  {
    name: "Sen1Floods11 (hand-labelled subset)",
    provider: "Bonafilia et al. 2020 / Cloud to Street",
    use: "Training & evaluation of the SAR water model; flood demo chips",
    access: "Public GCS bucket (rasters fetched by script, not committed)",
    license: "Not stated by the source repo; cite Bonafilia et al. 2020",
    href: "https://github.com/cloudtostreet/Sen1Floods11",
  },
  {
    name: "JRC Global Surface Water (permanent water, via Sen1Floods11)",
    provider: "EC JRC (Pekel et al. 2016)",
    use: "Separating permanent water from inferred flood",
    access: "Bundled with Sen1Floods11 chips",
    license: "Free, with attribution",
    href: "https://global-surface-water.appspot.com/",
  },
  {
    name: "VIIRS corrected reflectance (daily true colour)",
    provider: "NASA GIBS",
    use: "Optional global imagery overlay on the wildfire map",
    access: "Public WMTS, no key",
    license: "NASA open data policy",
    href: "https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api",
  },
  {
    name: "Natural Earth Admin-0 (1:50m) · OpenFreeMap / OpenStreetMap · Nominatim",
    provider: "Natural Earth · OpenFreeMap · OSM contributors",
    use: "Country assignment · dark basemap · place search",
    access: "Public",
    license: "Public domain · ODbL (© OpenStreetMap contributors)",
    href: "https://www.naturalearthdata.com/",
  },
];

export default function AboutPage() {
  return (
    <div className="absolute inset-0 overflow-y-auto">
      <article className="mx-auto max-w-4xl space-y-8 p-4 text-[13px] leading-relaxed text-muted sm:p-6">
        <header>
          <div className="eyebrow">Methods &amp; data</div>
          <h1 className="mt-1 text-2xl font-medium text-text">How TerraWatch AI works, and what it cannot tell you</h1>
          <p className="mt-2">
            TerraWatch AI is a research and education platform. It is <b className="text-text">not</b> an emergency warning system and
            must not be used for evacuation, firefighting or insurance decisions. Official sources (national fire and hydrological
            agencies, Copernicus EMS) take precedence.
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="text-[15px] font-medium text-text">Three kinds of output, always labelled</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li><b className="text-accent">Observed satellite data</b>: FIRMS detections and Sentinel imagery shown as distributed.</li>
            <li><b className="text-warn">Derived (algorithmic, not ML)</b>: observation clusters, analytics aggregates, dNBR change layer.</li>
            <li><b className="text-ai">Experimental AI prediction</b>: the Sentinel-1 surface-water model (flood module only).</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-[15px] font-medium text-text">Wildfire observations</h2>
          <p>
            Each FIRMS record marks a satellite pixel (375 m VIIRS, ~1 km MODIS at nadir, larger off-nadir) in which a thermal anomaly
            was detected at overpass time. The point is the pixel centre. A record is not a fire perimeter, does not measure burned
            area, and may be a non-vegetation heat source (gas flares, industry, volcanoes). NRT feeds lack the archive&apos;s
            <span className="mono"> type</span> field, so static sources are not removed from the live map. Confidence uses the native
            VIIRS classes; MODIS 0–100 is mapped to low (&lt;30), nominal (30–79), high (≥80).
          </p>
          <p>
            <b className="text-text">Observation clusters</b> group detections whose ~1.5 km grid cells touch (8-neighbour connected
            components over the selected window). This is deterministic single-linkage grouping, not an “event” model: it can merge
            neighbouring fires in heavily burned savanna and split a fire across data gaps. The cluster box is the bounding box of its
            detections. Summed FRP counts each overpass, so it is a relative activity index, not energy released.
          </p>
          <p>
            <b className="text-text">Historical baselines</b> use the MODIS Collection 6.1 standard-processing archive (Terra + Aqua), the longest
            consistent record, aggregated monthly by the ingestion pipeline. Terra/Aqua orbit drift in recent years shifts overpass
            times, which can bias trends.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-[15px] font-medium text-text">Imagery comparison</h2>
          <p>
            Sentinel-2 L2A scenes are found through the Earth Search STAC API, tiles from the same pass are mosaicked, and the
            requested area is read directly from cloud-optimised GeoTIFFs and reprojected to WGS84. Surface reflectance uses the
            scale and offset published in each item. Clouds, shadows and cirrus are masked with the L2A Scene Classification
            Layer. dNBR = NBR(pre) − NBR(post), with NBR = (B8A − B12)/(B8A + B12), classified with the Key &amp; Benson (2006) ranges.
            dNBR also responds to harvest, phenology, residual cloud and different illumination, and has not been field-validated here.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-[15px] font-medium text-text">Flood module and machine learning</h2>
          <p>
            The ML component is a per-pixel gradient-boosted classifier for open surface water in Sentinel-1 VV/VH backscatter. It
            uses 22 engineered features: multi-scale local means and standard deviations, a Lee speckle filter, and scene-relative
            statistics. It is trained on the Sen1Floods11 hand-labelled chips and evaluated with leave-one-event-out
            cross-validation, plus the Bolivia event held out entirely. Results, baselines, calibration and failure modes are on the{" "}
            <Link href="/model" className="text-accent underline">Model page</Link>. “Inferred flood” = predicted water minus JRC
            permanent water. It is an inference from one radar acquisition, not a pre/post change detection and not a verified
            flood map.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-[15px] font-medium text-text">Data sources &amp; attribution</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[12px]">
              <thead>
                <tr className="text-left text-faint">
                  <th className="py-1 pr-3 font-normal">Dataset</th>
                  <th className="pr-3 font-normal">Provider</th>
                  <th className="pr-3 font-normal">Used for</th>
                  <th className="pr-3 font-normal">Access</th>
                  <th className="font-normal">Licence</th>
                </tr>
              </thead>
              <tbody>
                {SOURCES.map((s) => (
                  <tr key={s.name} className="border-t border-line align-top">
                    <td className="py-2 pr-3 text-text">
                      <a href={s.href} target="_blank" rel="noopener noreferrer" className="hover:text-accent hover:underline">
                        {s.name}
                      </a>
                    </td>
                    <td className="pr-3">{s.provider}</td>
                    <td className="pr-3">{s.use}</td>
                    <td className="pr-3">{s.access}</td>
                    <td>{s.license}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[12px]">
            Contains modified Copernicus Sentinel data. We acknowledge the use of data and imagery from LANCE FIRMS operated by NASA&apos;s
            Earth Science Data and Information System (ESDIS). Full citations are in <span className="mono">docs/DATA_SOURCES.md</span>.
          </p>
        </section>
      </article>
    </div>
  );
}
