import "server-only";
// Portal del paciente — conexión a la base de `decidirOrtodonciaEnPortal`
// (ws1-t11). La llama el layout de /paciente/(panel), una vez por carga.
//
// Costo: una consulta por índice (`orthodontic_treatment_plans.patientId`) que
// trae como mucho una fila por clínica; y, solo si hay caso abierto, la misma
// consulta de módulo que ya usa el panel. Un paciente sin ortodoncia paga UNA
// consulta ligera.
//
// NUNCA lanza: si la base falla, el menú sale sin «Ortodoncia» y el portal
// sigue funcionando.

import { prisma } from "@/lib/prisma";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import {
  decidirOrtodonciaEnPortal,
  ESTADOS_CASO_ABIERTO,
  type VinculoPortal,
} from "./ortodoncia-menu";

export async function tieneOrtodonciaEnPortal(vinculos: VinculoPortal[]): Promise<boolean> {
  try {
    return await decidirOrtodonciaEnPortal(vinculos, {
      clinicasConCasoAbierto: async (validos) => {
        const planes = await prisma.orthodonticTreatmentPlan.findMany({
          where: {
            deletedAt: null,
            status: { in: ESTADOS_CASO_ABIERTO },
            OR: validos.map((v) => ({ patientId: v.patientId, clinicId: v.clinicId })),
          },
          select: { clinicId: true },
          distinct: ["clinicId"],
        });
        return planes.map((p) => p.clinicId);
      },
      moduloActivo: (clinicId) => hasActiveOrthodonticsModule(clinicId),
    });
  } catch (err) {
    console.error("[paciente/ortodoncia-menu] no se pudo decidir el enlace:", err);
    return false;
  }
}
