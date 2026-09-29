import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * ¿El paciente tiene o tuvo algún caso de ortodoncia (plan o diagnóstico sin
 * borrar, en el estado que sea)? Solo se pregunta cuando la sede NO tiene el
 * módulo: decide si el expediente se sigue LEYENDO (ver `accesoDeOrtodonciaEnLaFicha`).
 * `clinicId` sale de la sesión, nunca del cliente; sin él no se consulta
 * (`clinicId: undefined` no filtra nada en Prisma). Tolerante a que las tablas
 * aún no existan (P2021/P2022): responde «no».
 */
export async function pacienteTuvoCasoDeOrtodoncia(clinicId: string, patientId: string): Promise<boolean> {
  if (!clinicId || !patientId) return false;
  const where = { clinicId, patientId, deletedAt: null } as const;
  try {
    const [plan, diagnostico] = await Promise.all([
      prisma.orthodonticTreatmentPlan.findFirst({ where, select: { id: true } }),
      prisma.orthodonticDiagnosis.findFirst({ where, select: { id: true } }),
    ]);
    if (plan !== null || diagnostico !== null) return true;
    // I5 (revisión final): un caso MIGRADO del sistema anterior también cuenta como «ha tenido un caso».
    try {
      const migrado = await prisma.migratedOrthoCase.findFirst({ where: { clinicId, patientId, status: { not: "DISCARDED" } }, select: { id: true } });
      return migrado !== null;
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      if (code === "P2021" || code === "P2022") return false;
      throw e;
    }
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "P2021" || code === "P2022") return false;
    throw e;
  }
}
