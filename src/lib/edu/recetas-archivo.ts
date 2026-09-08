/**
 * DaleControl INSTITUCIONAL — ARCHIVAR UNA RECETA RECHAZADA (H-24).
 *
 * SERVIDOR: importa prisma. El predicado puro (`eduRecetaArchivable`) vive
 * en recetas-core.ts, al lado de sus hermanos.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 QUÉ CIERRA
 *
 * H-24 quedó a medias: mover de caso en BORRADOR y retirar lo propuesto se
 * arreglaron, pero **RECHAZADA seguía sin salida**
 * (`EDU_PRESCRIPTION_TRANSITIONS.RECHAZADA` era `[]`) y la receta se
 * quedaba en la lista de trabajo del alumno para siempre.
 *
 * 🔴 ARCHIVAR NO ES ANULAR, Y ESO ES TODA LA DECISIÓN.
 *
 * La casilla anterior se negó —con razón, y lo dejó por escrito— a abrir
 * RECHAZADA → ANULADA: una ANULADA **se imprime** (marcada, con su
 * motivo), así que darle ese camino a algo que nunca llevó la cédula de un
 * docente sacaría papel sin firma de la escuela. ARCHIVADA no la toca:
 * `eduRecetaPrintable("ARCHIVADA")` es `false`, y hay dos pruebas que lo
 * fijan.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL DOBLE CANDADO
 *   · PERMISO — `recetas.propose`. Ninguna key nueva: quien armó la
 *     propuesta es quien la guarda cuando el docente le dice que no. NO se
 *     pide `recetas.void`, que es de anular lo expedido y solo lleva
 *     DOCENTE y DIRECCION: obligar a un docente a archivar los rechazos de
 *     sus alumnos sería convertir un gesto de limpieza en un trámite.
 *   · ALCANCE — el CLÍNICO, por el paciente de la receta.
 *
 * 🔴 `updateMany` CON `status: "RECHAZADA"` EN EL `where` — el mismo
 * guardia que ya usan las otras tres escrituras de receta
 * (`eduRecetaWriteWhere`), y por lo mismo: si entre la lectura y la
 * escritura el docente cambió la receta, se contesta 409 en vez de
 * escribir encima.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import { eduCleanId, eduOptionalText } from "@/lib/edu/agenda-core";
import { getEduClinicalPatient } from "@/lib/edu/expediente";
import type { EduClinicaContext } from "@/lib/edu/visibility";
import { eduRecetaArchivable } from "@/lib/edu/recetas-core";
import { EDU_PRESCRIPTION_STATUS_LABELS, type EduPrescriptionStatus } from "@/lib/edu/types";
import { eduAudit, type EduAuditActor } from "@/lib/edu/auditoria";

export interface EduRecetaArchivoContext extends EduClinicaContext, EduAuditActor {}

/** Tope del motivo. El mismo `@db.VarChar(500)` de la columna. */
export const EDU_RECETA_ARCHIVO_REASON_MAX = 500;

/**
 * ARCHIVA una receta RECHAZADA.
 *
 * El motivo es OPCIONAL a propósito, y es la diferencia con la anulación:
 * el porqué del rechazo ya lo escribió el docente en su autorización y
 * está guardado. Lo que se escribe aquí es el porqué de GUARDARLA («ya se
 * le hizo otra», «el paciente no volvió»), y exigirlo produciría "asdf" —
 * el mismo argumento con el que la Ola B dejó fuera el `deleteReason` de
 * una nota en borrador.
 */
export async function archivarEduReceta(
  ctx: EduRecetaArchivoContext,
  prescriptionId: string,
  body: { reason?: unknown } = {},
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date(),
): Promise<{ id: string; status: EduPrescriptionStatus }> {
  const institutionId = ctx?.institutionId;
  if (!institutionId) throw new EduPadronError("Tu sesión no trae instituto. Vuelve a entrar.", 401);

  const id = eduCleanId(prescriptionId);
  if (!id) throw new EduPadronError("Falta la receta.", 400);

  const receta = await prisma.eduPrescription.findFirst({
    where: { id, institutionId },
    select: { id: true, patientId: true, status: true },
  });
  if (!receta) throw new EduPadronError("Esa receta no existe o no es de tu instituto.", 404);

  // El ALCANCE: la receta es del paciente, así que se comprueba el
  // paciente con el alcance CLÍNICO (recurso "cases"). Con el de
  // "patients", caja alcanzaría las recetas de toda la escuela.
  const paciente = await getEduClinicalPatient(ctx, receta.patientId, now);
  if (!paciente) throw new EduPadronError("Esa receta no existe o no es de tu instituto.", 404);

  const desde = receta.status as EduPrescriptionStatus;
  if (!eduRecetaArchivable(desde)) {
    throw new EduPadronError(
      `Solo se archiva una receta RECHAZADA, y ésta está ${EDU_PRESCRIPTION_STATUS_LABELS[desde].toLowerCase()}. ` +
        "Una expedida se ANULA con motivo; una propuesta se retira.",
      409,
    );
  }

  const reason = eduOptionalText(body?.reason, EDU_RECETA_ARCHIVO_REASON_MAX) ?? null;
  const archivedByName = `${ctx.user.firstName} ${ctx.user.lastName}`.trim().slice(0, 160) || "—";

  const res = await prisma.eduPrescription.updateMany({
    // El estado LEÍDO en el where. Ver el encabezado.
    where: { id: receta.id, institutionId, status: "RECHAZADA" },
    data: {
      status: "ARCHIVADA",
      archivedAt: now,
      archivedByUserId: ctx.eduUserId,
      archivedByName,
      archiveReason: reason,
    },
  });
  if (res.count === 0) {
    throw new EduPadronError(
      "Esa receta cambió de estado mientras la mirabas: no se archivó nada. Actualiza la pantalla.",
      409,
    );
  }

  await eduAudit(ctx, {
    action: "update",
    entity: "prescription",
    entityId: receta.id,
    patientId: receta.patientId,
    before: { status: "RECHAZADA" },
    after: { status: "ARCHIVADA", archiveReason: reason },
    ...meta,
  });

  return { id: receta.id, status: "ARCHIVADA" };
}
