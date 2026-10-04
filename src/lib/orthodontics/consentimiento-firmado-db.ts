// ¿El paciente tiene firmado (y sin revocar) el consentimiento de ortodoncia? (auditoría de uso, C-62)
//
// La MISMA consulta que el aviso «Falta el consentimiento…» del caso (`getCaseIntakeOptions`): carta de
// ortodoncia por clave o por título, firmada, sin revocar ni borrar. `null` si la consulta falla.

import { prisma } from "@/lib/prisma";
import { whereConsentimientoDeOrtodoncia } from "@/lib/consent/consentimiento-ortodoncia";

export async function consentimientoDeOrtodonciaFirmado(clinicId: string, patientId: string): Promise<boolean | null> {
  // `clinicId: undefined` en Prisma no filtra: sin clínica o paciente no se consulta.
  if (!clinicId || !patientId) return null;
  try {
    const c = await prisma.consentForm.findFirst({
      where: {
        clinicId,
        patientId,
        ...whereConsentimientoDeOrtodoncia(),
        signedAt: { not: null },
        revokedAt: null,
        deletedAt: null,
      },
      select: { id: true },
    });
    return Boolean(c);
  } catch (e) {
    console.error("[ortho] consentimientoDeOrtodonciaFirmado:", e);
    return null;
  }
}
