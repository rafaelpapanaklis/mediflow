"use client";

// Wrapper client que carga el visor 3D SOLO en el cliente (ssr:false). Así el
// bundle de three vive en su propio chunk y no engorda ninguna otra página.
// Mismo patrón que src/components/patient-3d/Models3DTab.tsx.

import dynamic from "next/dynamic";
import type { LayoutElement, LayoutMetadata } from "@/components/clinic-3d/world-types";

const Clinic3DClient = dynamic(
  () => import("@/components/clinic-3d/Clinic3DClient").then((m) => m.Clinic3DClient),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[70vh] items-center justify-center bg-[#0b0d11] text-white/70">
        <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        <span className="ml-3 text-sm">Cargando tu clínica en 3D…</span>
      </div>
    ),
  },
);

export interface Clinic3DMountProps {
  clinic: { id: string; name: string; category: string };
  initialElements: LayoutElement[];
  initialMetadata: LayoutMetadata | null;
  initialChairs: { id: string; name: string; color: string | null }[];
}

export function Clinic3DMount(props: Clinic3DMountProps) {
  return <Clinic3DClient {...props} />;
}
