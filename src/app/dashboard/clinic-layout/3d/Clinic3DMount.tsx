"use client";

// Wrapper client que carga el visor 3D SOLO en el cliente (ssr:false). Así el
// bundle de three vive en su propio chunk y no engorda ninguna otra página.
// Mismo patrón que src/components/patient-3d/Models3DTab.tsx.

import dynamic from "next/dynamic";
import type { LayoutElement, LayoutMetadata } from "@/components/clinic-3d/world-types";
import { Cargando3D } from "@/components/dashboard/bloques-rediseno/salidas";

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

// Hallazgo 21 (ws1-t5): el MISMO visor (mismo chunk), pero mientras baja se
// pinta la espera en el idioma nuevo. Solo se monta con `rediseno`; el
// recorrido 3D que carga es idéntico en los dos caminos.
const Clinic3DClientVestido = dynamic(
  () => import("@/components/clinic-3d/Clinic3DClient").then((m) => m.Clinic3DClient),
  {
    ssr: false,
    loading: () => <Cargando3D texto="Cargando tu clínica en 3D…" />,
  },
);

export interface Clinic3DMountProps {
  clinic: { id: string; name: string; category: string };
  initialElements: LayoutElement[];
  initialMetadata: LayoutMetadata | null;
  initialChairs: { id: string; name: string; color: string | null }[];
  /**
   * ¿La clínica ve el rediseño? Lo decide `page.tsx` con el interruptor
   * `menu-dos-niveles`. Solo cambia lo que se ve MIENTRAS baja el visor; el
   * visor mismo no recibe la bandera. Sin la prop, o en false, todo es como
   * siempre.
   */
  rediseno?: boolean;
}

export function Clinic3DMount({ rediseno = false, ...props }: Clinic3DMountProps) {
  return rediseno ? <Clinic3DClientVestido {...props} /> : <Clinic3DClient {...props} />;
}
