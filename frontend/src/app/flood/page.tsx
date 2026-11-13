import type { Metadata } from "next";
import FloodView from "@/components/flood/FloodView";

export const metadata: Metadata = { title: "Flood (SAR)" };

export default function FloodPage() {
  return <FloodView />;
}
