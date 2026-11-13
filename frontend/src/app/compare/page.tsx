import type { Metadata } from "next";
import { Suspense } from "react";
import CompareView from "@/components/compare/CompareView";
import { Spinner } from "@/components/ui";

export const metadata: Metadata = { title: "Imagery comparison" };

export default function ComparePage() {
  // useSearchParams() requires a Suspense boundary so the static shell can prerender.
  return (
    <Suspense fallback={<div className="p-6"><Spinner label="Loading comparison" /></div>}>
      <CompareView />
    </Suspense>
  );
}
