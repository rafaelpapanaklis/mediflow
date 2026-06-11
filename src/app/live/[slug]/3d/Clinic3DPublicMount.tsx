"use client";

// Wrapper client del visor 3D en MODO PÚBLICO (/live/[slug]/3d). Igual que
// src/app/dashboard/clinic-layout/3d/Clinic3DMount.tsx (carga el bundle de
// three SOLO en el cliente, ssr:false, en su propio chunk) pero pasa la opción
// `publicMode`: el visor pollea /api/live/[slug] (datos ya enmascarados),
// SIN multijugador y SIN interacción con datos (cero expedientes / agendar).

import dynamic from "next/dynamic";
import type { LayoutElement, LayoutMetadata } from "@/components/clinic-3d/world-types";

const Clinic3DClient = dynamic(
  () => import("@/components/clinic-3d/Clinic3DClient").then((m) => m.Clinic3DClient),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#0b0d11] text-white/70">
        <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        <span className="ml-3 text-sm">Cargando el recorrido 3D…</span>
      </div>
    ),
  },
);

export interface Clinic3DPublicMountProps {
  clinic: { id: string; name: string; category: string };
  initialElements: LayoutElement[];
  initialMetadata: LayoutMetadata | null;
  initialChairs: { id: string; name: string; color: string | null }[];
  slug: string;
}

export function Clinic3DPublicMount({ slug, ...rest }: Clinic3DPublicMountProps) {
  return <Clinic3DClient {...rest} publicMode={{ slug }} />;
}
