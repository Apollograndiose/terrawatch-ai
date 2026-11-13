// Copies MapLibre's self-contained module worker into /public so the bundler never has to
// resolve `new Worker(new URL(...))` (Turbopack serves that chunk with the wrong MIME type).
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const dist = dirname(require.resolve("maplibre-gl/dist/maplibre-gl.mjs"));
mkdirSync("public/maplibre", { recursive: true });
copyFileSync(join(dist, "maplibre-gl-worker.mjs"), "public/maplibre/maplibre-gl-worker.mjs");
console.log("copied maplibre-gl-worker.mjs -> public/maplibre/");
