import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { hasEduPermission } from "@/lib/edu/permissions";
import { updateEduRecord } from "@/lib/edu/expediente";

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
