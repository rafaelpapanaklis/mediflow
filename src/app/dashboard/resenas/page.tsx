import type { Metadata } from "next";
import { ResenasClient } from "./ResenasClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reseñas — DaleControl" };

export default function ResenasPage() {
  return <ResenasClient />;
}
