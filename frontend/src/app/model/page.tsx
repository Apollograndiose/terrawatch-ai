import type { Metadata } from "next";
import ModelView from "@/components/model/ModelView";

export const metadata: Metadata = { title: "Model card" };

export default function ModelPage() {
  return <ModelView />;
}
