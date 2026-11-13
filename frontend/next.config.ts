import type { NextConfig } from "next";

// The browser always calls same-origin /api/*; Next proxies it to FastAPI.
// This avoids CORS in development and keeps the backend URL server-side.
const backend = process.env.TERRAWATCH_API_URL ?? "http://127.0.0.1:8000";

// Pages may not be framed, except by origins listed in TW_FRAME_ANCESTORS (read at build time), e.g. the
// Hugging Face Space page that embeds the app in an iframe.
const frameAncestors = process.env.TW_FRAME_ANCESTORS?.trim();
const frameHeader = frameAncestors
  ? { key: "Content-Security-Policy", value: `frame-ancestors 'self' ${frameAncestors}` }
  : { key: "X-Frame-Options", value: "DENY" };

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  devIndicators: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          frameHeader,
        ],
      },
    ];
  },
};

export default nextConfig;
