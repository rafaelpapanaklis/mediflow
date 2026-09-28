// Presupuestos de ortodoncia → caso de ortodoncia: la lectura (ws1-t5). Las
// reglas, puras y con tests, en `./ortodoncia.ts`.
//
// Dos consultas como mucho, las dos acotadas a la clínica que se le pasa (la
// de la sesión): módulo activo y casos de los pacientes. Si la sede no tiene el módulo NO se consulta nada
// más; si la persona no tiene su permiso, no se lee nada del caso. Si algo
// falla, los presupuestos salen como siempre, con su botón de siempre.

import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/auth/permissions";
import {
  conceptosGenerales,
  casoDesdePresupuesto,
  esPresupuestoDeOrtodoncia,
  type CasoDesdePresupuesto,
} from "./ortodoncia";

interface Quien {
  clinicId: string;
  clinicCategory: string;
  role: string;
  permissionsOverride: string[];
  isPlanExpired?: boolean;
}

interface PresupuestoLeido {
  id: string;
  patientId: string;
  title: string;
  status: string;
  treatmentPlanId: string | null;
  items: ReadonlyArray<{ name: string }>;
}

/** ¿La sede de esta persona (dental, con el plan al día) tiene el módulo contratado de verdad? */
async function sedeConModulo(quien: Quien): Promise<boolean> {
  if (!quien.clinicId) return false;
  if (quien.clinicCategory !== "DENTAL" || quien.isPlanExpired) return false;
  // Importado aquí y no arriba: `access.ts` es `server-only`, y las rutas de
  // presupuestos se ejecutan de verdad en sus tests (node, sin Next). Solo se
  // carga cuando hay un presupuesto aceptado que mirar.
  const { hasActiveOrthodonticsModule } = await import("@/lib/orthodontics/access");
  return hasActiveOrthodonticsModule(quien.clinicId).catch(() => false);
}

function tienePermisoDelModulo(quien: Quien): boolean {
  return hasPermission(
    { role: quien.role as any, permissionsOverride: quien.permissionsOverride },
    "specialties.orthodontics",
  );
}

/** Para cada presupuesto, lo que ofrece en vez de «Crear plan» (o nada). */
export async function casosDesdePresupuestos(
  quien: Quien,
  presupuestos: readonly PresupuestoLeido[],
): Promise<Map<string, CasoDesdePresupuesto>> {
  const salida = new Map<string, CasoDesdePresupuesto>();
  // Solo interesan los aceptados que aún no generaron plan: si no hay ninguno,
  // ni siquiera se pregunta por el módulo.
  // Excepción: un presupuesto MIXTO que ya generó su plan general (con el
  // resto) sigue ofreciendo el caso de ortodoncia, que ese plan no cubre.
  const candidatos = presupuestos.filter(
    (q) => q.status === "ACCEPTED" && (!q.treatmentPlanId || conceptosGenerales(q.items).length > 0),
  );
  if (candidatos.length === 0) return salida;

  try {
    if (!(await sedeConModulo(quien))) return salida;
    const tienePermiso = tienePermisoDelModulo(quien);

    const deOrtodoncia = candidatos.filter((q) =>
      esPresupuestoDeOrtodoncia({ title: q.title, items: q.items.map((i) => ({ name: i.name })) }),
    );
    if (deOrtodoncia.length === 0) return salida;

    // Sin el permiso del módulo no se lee nada del caso: solo se avisa.
    const pacientes = Array.from(new Set(deOrtodoncia.map((q) => q.patientId).filter(Boolean)));
    const casos = tienePermiso && pacientes.length > 0
      ? await prisma.orthodonticTreatmentPlan.findMany({
          where: { clinicId: quien.clinicId, patientId: { in: pacientes }, deletedAt: null },
          select: { patientId: true, status: true },
        })
      : [];

    for (const q of deOrtodoncia) {
      const caso = casoDesdePresupuesto({
        quoteId: q.id,
        patientId: q.patientId,
        status: q.status,
        // El plan general de un mixto es el del resto: no tapa el caso.
        treatmentPlanId: conceptosGenerales(q.items).length > 0 ? null : q.treatmentPlanId,
        esDeOrtodoncia: true,
        moduloActivo: true,
        tienePermiso,
        casosDelPaciente: casos.filter((c) => c.patientId === q.patientId).map((c) => c.status),
      });
      if (caso) {
        if (conceptosGenerales(q.items).length > 0) caso.conPlanGeneral = true;
        salida.set(q.id, caso);
      }
    }
  } catch (e) {
    console.warn("[presupuestos:ortodoncia] no se pudo resolver el caso:", e);
    return new Map();
  }
  return salida;
}
