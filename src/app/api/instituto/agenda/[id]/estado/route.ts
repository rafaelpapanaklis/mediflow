import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { hasEduPermission } from "@/lib/edu/permissions";
import { setEduAppointmentStatus } from "@/lib/edu/agenda";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/instituto/agenda/[id]/estado — llegó → se sentó → se le
 * trabaja → terminó.
 *
 * 🔴 POR QUÉ EXIGE "agenda.view" Y NO "agenda.manage". Registrar lo que
 * está pasando en el sillón no es administrar la agenda: es apuntar que el
 * paciente ya se sentó. Un ALUMNO solo trae agenda.view por defecto y sin
 * esta distinción no podría marcar NADA de su propio día — /mi-dia sería
 * una pantalla de solo lectura y la escuela seguiría midiendo tiempos en
 * papel.
 *
 * Lo que impide que mueva la cita de otro no es el permiso, es el ALCANCE:
 * `setEduAppointmentStatus` busca la fila con el `where` de visibilidad, y
 * una cita que no le toca se ve exactamente igual que una que no existe.
 *
 * Cancelar y dar por no presentado SÍ exigen "agenda.manage": son
 * decisiones administrativas (liberan el hueco y, en la Ola 5, tocan el
 * cobro). Por eso se le pasa `canManage` a la capa de datos en vez de
 * partir el endpoint en dos.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("agenda.view");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const canManage = hasEduPermission(
      { role: g.ctx.role, permissionsOverride: g.ctx.user.permissionsOverride },
      "agenda.manage",
    );
    const res = await setEduAppointmentStatus(g.ctx, params.id, body.status, { canManage });
    return NextResponse.json({ ok: true, id: res.id, status: res.status });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/agenda/[id]/estado");
  }
}
