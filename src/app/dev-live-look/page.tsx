/**
 * BANCO DE PRUEBAS DEL TELEVISOR — solo en desarrollo.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * Monta el `LivePublicClient` REAL con el plano de demostración y citas de
 * mentira, para poder VER /live/[slug] sin base de datos, sin clínica y
 * sin sesión. Es la única forma de mirar el televisor mientras se retoca
 * su aspecto: el de verdad necesita una clínica con su plano guardado.
 *
 * 🔴 NO SE PUBLICA. Vive bajo `src/app/`, así que Next lo convertiría en
 * la ruta /dev-live-look de PRODUCCIÓN — una pantalla con datos de mentira
 * y el nombre de una clínica inventada, servida a cualquiera que teclee la
 * URL. El `notFound()` de abajo la apaga fuera de desarrollo: en el
 * despliegue devuelve el 404 de siempre y el arnés ni siquiera se monta,
 * así que el `window.fetch` que sustituye tampoco llega a tocarse.
 *
 * Se conserva en el repo a propósito: borrarlo obligaría a reescribirlo la
 * próxima vez que alguien toque el aspecto del piso.
 *
 * Uso: `npm run dev` y abrir /dev-live-look (o /dev-live-look?dark=1).
 */
export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { DEMO_ELEMENTS } from "@/lib/floor-plan/demo-layout";
import { DevLiveHarness } from "./harness";

export default function DevLiveLookPage({
  searchParams,
}: {
  searchParams: { dark?: string };
}) {
  // La guardia va lo PRIMERO: en producción no se llega a construir ni un
  // dato de mentira.
  if (process.env.NODE_ENV === "production") notFound();

  const chairIds = ["chair-1", "chair-2", "chair-3"];
  let chairSeen = 0;
  const elements = DEMO_ELEMENTS.map((e, i) => ({
    id: i + 1,
    type: e.type,
    col: e.col,
    row: e.row,
    rotation: e.rotation,
    resourceId: e.chairLabel ? chairIds[chairSeen++] ?? null : null,
    name: e.chairLabel ?? null,
  }));

  const now = new Date();
  const at = (h: number, m: number) => {
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };
  const rel = (mins: number) => new Date(now.getTime() + mins * 60_000).toISOString();

  const payload = {
    clinic: {
      id: "c1",
      name: "Clínica Dental Papanaklis",
      logoUrl: null,
      city: "Monterrey",
      showPatientNames: false,
    },
    layout: { elements, metadata: {} },
    chairs: [
      { id: "chair-1", name: "Consultorio 1", color: null },
      { id: "chair-2", name: "Consultorio 2", color: null },
      { id: "chair-3", name: "Consultorio 3", color: null },
    ],
    appointments: [
      {
        id: "a1",
        resourceId: "chair-1",
        patient: "J.P.",
        treatment: "Endodoncia",
        doctor: "Dra. Ruiz",
        start: rel(-25),
        end: rel(35),
        status: "IN_PROGRESS",
      },
      {
        id: "a2",
        resourceId: "chair-2",
        patient: "M.G.",
        treatment: "Limpieza",
        doctor: "Dr. Lara",
        start: rel(12),
        end: rel(52),
        status: "CONFIRMED",
      },
      {
        id: "a3",
        resourceId: "chair-3",
        patient: "A.S.",
        treatment: "Ortodoncia",
        doctor: "Dra. Ruiz",
        start: at(17, 0),
        end: at(18, 0),
        status: "SCHEDULED",
      },
      {
        id: "a4",
        resourceId: "chair-1",
        patient: "R.T.",
        treatment: "Corona",
        doctor: "Dr. Lara",
        start: at(16, 0),
        end: at(17, 0),
        status: "SCHEDULED",
      },
    ],
    waitingRoom: [
      {
        id: "a2",
        patient: "M.G.",
        treatment: "Limpieza",
        doctor: "Dr. Lara",
        checkedInAt: rel(-8),
        scheduledAt: rel(12),
      },
    ],
  };

  return <DevLiveHarness payload={payload} dark={searchParams.dark === "1"} />;
}
