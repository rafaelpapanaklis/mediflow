// Portal del paciente — ¿se enseña «Ortodoncia» en el menú? (ws1-t11, sep-2026)
//
// La página /paciente/ortodoncia existía pero no tenía enlace: el paciente solo
// llegaba si le pasaban la dirección. El enlace sale SOLO si el paciente tiene
// un caso de ortodoncia ABIERTO en una clínica con el módulo ACTIVO.
//
// Este archivo es la decisión, PURA (sin Prisma, sin "server-only"), para que
// el test corra sin base. Quien la conecta a la base es
// `ortodoncia-menu.server.ts`, y quien la llama es el layout del portal: una
// vez por carga del portal, no una vez por página.
//
// Multi-tenant: los `patientId`/`clinicId` salen SIEMPRE de los vínculos de la
// sesión (`ctx.links`), nunca del cliente. El caso tiene que ser del MISMO par
// paciente+clínica del vínculo.

import { ACTIVE_PLAN_STATUSES } from "@/lib/orthodontics/specialty-kpis";

/** Un caso «abierto» es el mismo que cuenta el Tablero como activo. */
export const ESTADOS_CASO_ABIERTO = ACTIVE_PLAN_STATUSES;

export interface VinculoPortal {
  patientId: string;
  clinicId: string;
}

export interface DepsOrtodonciaEnPortal {
  /** Clínicas donde alguno de esos vínculos tiene un caso abierto. Una sola consulta. */
  clinicasConCasoAbierto: (vinculos: VinculoPortal[]) => Promise<string[]>;
  /** Misma regla que el panel: `hasActiveOrthodonticsModule`. */
  moduloActivo: (clinicId: string) => Promise<boolean>;
}

/**
 * true = hay que enseñar «Ortodoncia» en el menú del portal.
 * Sin vínculos no consulta nada. Sin caso abierto no pregunta por el módulo.
 */
export async function decidirOrtodonciaEnPortal(
  vinculos: VinculoPortal[],
  deps: DepsOrtodonciaEnPortal,
): Promise<boolean> {
  const validos = vinculos.filter((v) => v.patientId && v.clinicId);
  if (validos.length === 0) return false;

  const clinicas = Array.from(new Set(await deps.clinicasConCasoAbierto(validos)));
  // Solo cuentan clínicas que de verdad están entre los vínculos de la sesión.
  const propias = clinicas.filter((c) => validos.some((v) => v.clinicId === c));

  for (const clinicId of propias) {
    if (await deps.moduloActivo(clinicId)) return true;
  }
  return false;
}
