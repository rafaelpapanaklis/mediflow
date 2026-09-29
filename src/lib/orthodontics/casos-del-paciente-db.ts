// Ortodoncia — los casos vivos de un paciente, para «Casos de este paciente»
// en la pestaña Ortodoncia de la ficha (ws1-t8). El I/O de `casos-del-paciente.ts`.
//
// `clinicId` de la sesión, nunca del cliente: sin él no se consulta nada
// (`undefined` en Prisma no filtra). Si la lectura falla, la ficha sale sin el
// selector: el caso que se ve es el de siempre.

import { prisma } from "@/lib/prisma";
import { nombreDeTecnica } from "./tecnicas-de-la-clinica";
import { cargarNombresDeTecnica } from "./tecnicas-de-la-clinica-db";
import { ETIQUETA_TECNICA } from "./pacientes-modulo";
import type { CasoDelPaciente } from "./casos-del-paciente";

export async function cargarCasosDelPaciente(clinicId: string, patientId: string): Promise<CasoDelPaciente[]> {
  if (!clinicId || !patientId) return [];
  try {
    const planes = await prisma.orthodonticTreatmentPlan.findMany({
      where: { clinicId, patientId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, installedAt: true, createdAt: true, technique: true },
      take: 20,
    });
    if (planes.length < 2) {
      // Con un solo caso no hay nada que elegir; el llamador no enseña el selector.
      return planes.map((p) => ({
        id: p.id,
        status: p.status,
        installedAt: p.installedAt ? p.installedAt.toISOString() : null,
        createdAt: p.createdAt.toISOString(),
        tecnica: ETIQUETA_TECNICA[p.technique] ?? p.technique,
      }));
    }
    const nombres = await cargarNombresDeTecnica(clinicId, planes.map((p) => p.id));
    return planes.map((p) => ({
      id: p.id,
      status: p.status,
      installedAt: p.installedAt ? p.installedAt.toISOString() : null,
      createdAt: p.createdAt.toISOString(),
      tecnica: nombreDeTecnica(p.technique, nombres.get(p.id) ?? null, ETIQUETA_TECNICA[p.technique] ?? p.technique),
    }));
  } catch (e) {
    console.warn("[ortodoncia:casos] no se pudieron leer los casos del paciente:", e);
    return [];
  }
}
