import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { hasEduPermission } from "@/lib/edu/permissions";
import { updateEduRecord, withdrawEduRecord } from "@/lib/edu/expediente";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/instituto/expediente/[id] — edita una nota o la mueve de
 * estado (entregar, firmar, devolver a borrador).
 *
 * 🔴 UNA NOTA FIRMADA REBOTA TODO: texto, diagnóstico, cita y estado —
 * aunque quien lo intente sea la dirección del instituto. No es un permiso
 * que falte: es la NOM-004. Un expediente que se puede reescribir deja de
 * ser el registro de lo que pasó y pasa a ser el registro de lo que alguien
 * quiere que parezca que pasó. Para corregir se escribe una nota NUEVA con
 * `correctsId` apuntando a la firmada, y quedan las dos.
 *
 * Cuelga de /expediente/[id] y no de /pacientes/[id]/expediente/[notaId]
 * porque la nota ya sabe de qué paciente es: repetirlo en la URL solo daría
 * dos fuentes para el mismo dato, y una de las dos acabaría sin
 * comprobarse. La nota se busca DENTRO del alcance, así que una que no le
 * toca a quien pregunta contesta 404, igual que una que no existe.
 *
 * El caso y el paciente de una nota NO se cambian nunca: una nota escrita
 * en el caso equivocado se anula con una corrección, igual que en papel.
 *
 * 🔴 CIERRE (P2-13) · FIRMAR exige ADEMÁS "expediente.sign". El guard de
 * arriba abre la puerta de ESCRIBIR (editar, entregar, devolver); pasar una
 * nota a FIRMADA lo decide `canSign`, que se resuelve aquí y se comprueba
 * dentro de updateEduRecord — el mismo reparto que la agenda hace con
 * `canManage`. El ALUMNO (write sin sign) entrega; firma quien responde.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("expediente.write");
  if ("response" in g) return g.response;

  try {
    const canSign = hasEduPermission(
      { role: g.ctx.role, permissionsOverride: g.ctx.user.permissionsOverride },
      "expediente.sign",
    );
    const updated = await updateEduRecord(g.ctx, params.id, await eduReadJson(request), {
      canSign,
    });
    return NextResponse.json({ ok: true, id: updated.id, status: updated.status });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/expediente/[id]");
  }
}

/**
 * DELETE /api/instituto/expediente/[id] — RETIRA un BORRADOR (H-23).
 *
 * 🔴 NO BORRA NADA. Es una baja lógica: la fila se queda con `deletedAt` y
 * `deletedById`, y lo que cambia es que todas las lecturas del expediente
 * la dejan de traer. El verbo es DELETE porque para quien lo usa eso es lo
 * que hace —la nota sale del expediente—, y el cuerpo va vacío: el id de la
 * URL es todo lo que hace falta.
 *
 * 🔴 Y CIERRA SUS AUTORIZACIONES PENDIENTES (N-1). Retirar dejaba viva la
 * petición de firma de esa nota: el docente la firmaba con su cédula y la
 * puerta del caso avanzaba sobre una página que ya no está en el
 * expediente. Las dos escrituras van juntas dentro de `withdrawEduRecord`
 * —una transacción— porque el estado intermedio es exactamente el agujero.
 *
 * 🔴 SOLO UN BORRADOR, y el candado vive en `withdrawEduRecord`, no aquí.
 * Es el mismo reparto que el resto del módulo: una ENVIADA está en la
 * bandeja de un docente (se devuelve primero) y una FIRMADA no se retira
 * nunca — es la NOM-004. Un segundo endpoint que retirara notas nacería con
 * el candado puesto por ir a la misma función.
 *
 * Mismo permiso que editar (`expediente.write`) y no uno nuevo: retirar el
 * borrador que acabas de abrir por error es parte de escribir, no un acto
 * administrativo aparte. La PERTENENCIA la comprueba la función dentro, con
 * el alcance clínico: una nota que no te toca contesta 404, igual que una
 * que no existe.
 */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("expediente.write");
  if ("response" in g) return g.response;

  try {
    const retirada = await withdrawEduRecord(g.ctx, params.id);
    return NextResponse.json({ ok: true, id: retirada.id });
  } catch (err) {
    return eduApiError(err, "DELETE /api/instituto/expediente/[id]");
  }
}
