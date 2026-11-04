// Estado del portal que la FICHA del paciente le enseña a la clínica.
//
// Seguridad (auditoría «cloudflare», nº8, revisión t12 M2): la cuenta del portal
// es GLOBAL (un email = una cuenta para todas las clínicas). «Invitar al portal»
// ya no liga el expediente a una cuenta que estaba activa (lo liga el propio
// paciente al iniciar sesión), así que la ficha no puede decir «sin cuenta»
// después de invitar: con una cuenta nueva diría «invitada» y con una activa
// «sin cuenta», y esa diferencia volvería a contarle a la clínica que ese email
// es paciente en otro lado. Una invitación enviada desde ESTA clínica a ESTE
// expediente (queda en su bitácora) cuenta como «invitada» hasta que haya enlace.
import { prisma } from "@/lib/prisma";

export type EstadoPortalEnFicha = "none" | "invited" | "active";

/** El estado a partir del enlace (si lo hay) y de si esta clínica ya invitó. */
export function estadoPortalEnFicha(
  cuentaLigada: { passwordHash: string | null } | null,
  invitadoDesdeEstaClinica: boolean,
): EstadoPortalEnFicha {
  if (cuentaLigada) return cuentaLigada.passwordHash === null ? "invited" : "active";
  return invitadoDesdeEstaClinica ? "invited" : "none";
}

/**
 * ¿Esta clínica ya invitó al portal a este paciente? Lo dice la bitácora que
 * escribe POST /api/patients/[id]/portal-invite (`changes.portalInvite`).
 * Solo lectura, con su clínica y su paciente. Nunca lanza: sin bitácora la
 * ficha degrada a «sin cuenta».
 */
export async function invitadoAlPortalDesdeEstaClinica(clinicId: string, patientId: string): Promise<boolean> {
  if (!clinicId || !patientId) return false;
  try {
    const filas = await prisma.$queryRaw<Array<{ uno: number }>>`
      SELECT 1 AS uno
        FROM "audit_logs"
       WHERE "clinicId" = ${clinicId}
         AND "entityType" = 'patient'
         AND "entityId" = ${patientId}
         AND "changes" -> 'portalInvite' IS NOT NULL
       LIMIT 1
    `;
    return filas.length > 0;
  } catch (err) {
    console.error("[patient-portal/estado-en-ficha] no se pudo leer la bitácora:", err);
    return false;
  }
}
