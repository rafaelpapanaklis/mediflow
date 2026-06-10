import type { Metadata } from "next";
import { SoporteClient } from "./soporte-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Soporte Técnico — DaleControl" };

export default function SoportePage() {
  return <SoporteClient />;
}
