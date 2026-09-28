import "server-only";
// Ortodoncia — cargador de las fotos de seguimiento que el paciente mandó y
// nadie ha revisado (ws1-t5, ronda 6, hallazgo 96). Lo usan Alertas del
// módulo y la campana del panel.
//
// `clinicId` y quien mira SIEMPRE salen de la sesión. Respeta la visibilidad
// por paciente: un doctor no ve el aviso de un paciente que no puede ver.
//
// NUNCA lanza: si la tabla de sql/ortodoncia-alineadores.sql aún no existe
// (P2021/P2022) o la base falla, no hay avisos y la pantalla sigue.

import { prisma } from "@/lib/prisma";
import { relatedPatientVisibilityAnd, type VisibilityViewer } from "@/lib/patient-visibility";
import type { FotoPendiente } from "./fotos-paciente";

/** Tope de filas: un caso con cientos de fotos sin revisar no debe pesar en cada sondeo de la campana. */
const MAX_FOTOS = 300;

export async function cargarFotosPorRevisar(clinicId: string, viewer: VisibilityViewer): Promise<FotoPendiente[]> {
  if (!clinicId) return [];
  try {
    const filas = await prisma.orthodonticMonitoringPhoto.findMany({
      where: {
        clinicId,
        reviewStatus: "PENDING",
        patient: { deletedAt: null },
        treatmentPlan: { deletedAt: null },
        AND: relatedPatientVisibilityAnd(viewer),
      },
      select: {
        id: true,
        treatmentPlanId: true,
        patientId: true,
        angle: true,
        patientNote: true,
        submittedAt: true,
        patient: { select: { firstName: true, lastName: true } },
      },
      orderBy: { submittedAt: "desc" },
      take: MAX_FOTOS,
    });
    return filas.map((f) => ({
      id: f.id,
      treatmentPlanId: f.treatmentPlanId,
      patientId: f.patientId,
      patientName: `${f.patient.firstName} ${f.patient.lastName}`.trim(),
      angle: f.angle,
      patientNote: f.patientNote,
      submittedAt: f.submittedAt,
    }));
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code !== "P2021" && code !== "P2022") {
      console.error("[ortodoncia/fotos-paciente] no se pudieron cargar las fotos por revisar:", e);
    }
    return [];
  }
}
