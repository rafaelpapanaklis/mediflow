// A qué tratamiento YA IMPORTADO (de 06) pertenece una fila de 05 (citas) o de 04 (saldos): por «# Tratamiento».
// ws1-t10, 29-sep-2026. Contrato compartido con ws1-t8 y ws1-t12:
//   1) el tratamiento es un CASO DE ORTODONCIA si 'ortho_case' (import_external_ids) tiene ese «# Tratamiento» → plan;
//   2) si no, es un tratamiento NORMAL si un presupuesto ACCEPTED del mismo paciente lleva ese folio en sus notas
//      (marcador de tratamiento activo migrado, migrado.ts);
//   3) si no, no está entre los importados: la fila se queda suelta.
// Se lee en BLOQUE (una consulta por tabla, nunca una por fila) y SIEMPRE por clínica.

import { prisma } from "@/lib/prisma";
import { esNotaDeTratamientoActivo, folioDeNotaActiva } from "../migrado";
import { cargarCasosOrto, limpiarId } from "./control-ortodoncia";

export interface CasoOrtoImportado {
  tipo: "caso";
  ref: string;
  planId: string;
  patientId: string;
  /** Doctor tratante del caso (null = sin usuario: la cita sigue la regla de siempre). */
  doctorId: string | null;
}

export interface TratamientoImportado {
  tipo: "tratamiento";
  ref: string;
  quoteId: string;
  treatmentPlanId: string | null;
  patientId: string;
}

export type EnlaceImportado = CasoOrtoImportado | TratamientoImportado;

export interface Enlaces {
  /** «# Tratamiento» → caso de ortodoncia. */
  casos: Map<string, CasoOrtoImportado>;
  /** `${patientId}|${# Tratamiento}` → tratamiento normal. */
  tratamientos: Map<string, TratamientoImportado>;
  /** ¿Se pudo leer `import_external_ids`? (false = falta el SQL: los casos no se pueden reconocer) */
  externosDisponibles: boolean;
}

function relacionAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

export const enlacesVacios = (): Enlaces => ({ casos: new Map(), tratamientos: new Map(), externosDisponibles: true });

/** Los tratamientos importados que corresponden a estos pacientes (para reconocer las filas de 05 / 04 por su «# Tratamiento»). */
export async function cargarEnlaces(clinicId: string, originId: string, patientIds: string[]): Promise<Enlaces> {
  if (typeof clinicId !== "string" || !clinicId) throw new Error("cargarEnlaces: falta clinicId");
  const out = enlacesVacios();
  if (patientIds.length === 0) return out;
  const pacientes = new Set(patientIds);

  // 1) Casos de ortodoncia: ref → plan; el plan dice de qué paciente es y quién es su doctor.
  const externos = await cargarCasosOrto(clinicId, originId);
  out.externosDisponibles = externos.disponible;
  if (externos.mapa.size > 0) {
    const planIds = Array.from(new Set(externos.mapa.values()));
    try {
      const planes: Array<{ id: string; patientId: string; treatingDoctorId: string | null }> = [];
      for (let i = 0; i < planIds.length; i += 500) {
        planes.push(
          ...(await prisma.orthodonticTreatmentPlan.findMany({
            where: { clinicId, id: { in: planIds.slice(i, i + 500) }, deletedAt: null },
            select: { id: true, patientId: true, treatingDoctorId: true },
          })),
        );
      }
      const porId = new Map(planes.map((p) => [p.id, p]));
      for (const [ref, planId] of Array.from(externos.mapa.entries())) {
        const p = porId.get(planId);
        if (!p) continue; // (de cualquier paciente: `enlaceDe` avisa si la fila es de otro)
        out.casos.set(ref, { tipo: "caso", ref, planId, patientId: p.patientId, doctorId: p.treatingDoctorId ?? null });
      }
    } catch (e) {
      if (!relacionAusente(e)) throw e;
    }
  }

  // 2) Tratamientos normales: presupuestos ACCEPTED con el marcador de «tratamiento activo migrado».
  const ids = Array.from(pacientes);
  for (let i = 0; i < ids.length; i += 500) {
    const quotes = await prisma.quote.findMany({
      where: { clinicId, status: "ACCEPTED", patientId: { in: ids.slice(i, i + 500) } },
      select: { id: true, patientId: true, notes: true, treatmentPlanId: true },
    });
    for (const q of quotes) {
      if (!esNotaDeTratamientoActivo(q.notes)) continue;
      const folio = limpiarId(folioDeNotaActiva(q.notes));
      if (!folio) continue;
      out.tratamientos.set(`${q.patientId}|${folio}`, {
        tipo: "tratamiento",
        ref: folio,
        quoteId: q.id,
        treatmentPlanId: q.treatmentPlanId ?? null,
        patientId: q.patientId,
      });
    }
  }
  return out;
}

/**
 * El tratamiento importado de una fila, si lo hay. Un caso de ortodoncia solo cuenta si es del MISMO paciente que la fila:
 * un «# Tratamiento» que en el archivo apunta a otra persona no se liga (se dice en la vista previa).
 */
export function enlaceDe(
  enlaces: Enlaces,
  ref: unknown,
  patientId: string | undefined | null,
): { enlace: EnlaceImportado | null; deOtroPaciente?: boolean } {
  const r = limpiarId(ref);
  if (!r || !patientId) return { enlace: null };
  const caso = enlaces.casos.get(r);
  if (caso) return caso.patientId === patientId ? { enlace: caso } : { enlace: null, deOtroPaciente: true };
  const trat = enlaces.tratamientos.get(`${patientId}|${r}`);
  return { enlace: trat ?? null };
}
