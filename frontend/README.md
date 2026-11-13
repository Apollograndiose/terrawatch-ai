# TerraWatch AI — frontend

Next.js 16 (App Router) + React 19 + TypeScript + Tailwind 4 + MapLibre GL 6 + Recharts 3.
See the [repository README](../README.md) for setup. Key scripts:

```bash
npm run dev         # http://localhost:3000 (expects the API on :8000, override with TERRAWATCH_API_URL)
npm run lint && npm run typecheck && npm test
npx playwright test # end-to-end (starts both servers if not running)
```

`scripts/copy-maplibre-worker.mjs` copies MapLibre's module worker to `public/maplibre/` on install/dev/build because
Turbopack does not serve `new Worker(new URL(...))` chunks with a JavaScript MIME type.
