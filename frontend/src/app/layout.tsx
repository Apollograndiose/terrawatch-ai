import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { AppNav } from "@/components/AppNav";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-plex-sans",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: { default: "TerraWatch AI — Satellite Disaster Intelligence", template: "%s · TerraWatch AI" },
  description:
    "Explore NASA FIRMS wildfire observations, Sentinel-2 before/after imagery and an experimental Sentinel-1 SAR flood-mapping model. Research and education only.",
};

export const viewport: Viewport = {
  themeColor: "#070b14",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body className="flex h-dvh flex-col overflow-hidden">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-surface-2 focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <AppNav />
        <main id="main" className="relative min-h-0 flex-1">
          {children}
        </main>
      </body>
    </html>
  );
}
