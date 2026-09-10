import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { hasEduPermission } from "@/lib/edu/permissions";
import { getEduAppointment, setEduAppointmentStatus } from "@/lib/edu/agenda";
import { eduReminderCancelLabel } from "@/lib/edu/recordatorios";
import { EduPadronError } from "@/lib/edu/padron";

export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * PATCH /api/instituto/pacientes/[id]/agenda/[citaId] — mover el estado de
 * UNA cita DE ESTE PACIENTE, desde su ficha.
 *
 * 🔴 QUÉ ARREGLA (fila 24 del comparativo con el dental). La pestaña Agenda
 * de la ficha enseñaba las citas y no dejaba hacer nada con ellas: para
 * cancelar la del jueves había que salir a la agenda general, encontrar el
 * día, encontrar el hueco y volver. Agendar sí se podía desde la ficha
 * desde la Ola 12; cancelar, no.
 *
 * 🔴 LA REGLA DE ESTADO NO SE DUPLICA: llama a `setEduAppointmentStatus`
 * (src/lib/edu/agenda.ts), exactamente la misma función que usa la agenda
 * general. Las transiciones válidas, la ventana de las 24 h que impide dar
 * por ocurrido el futuro y la cancelación del recordatorio siguen viviendo
 * en un solo sitio. Si esta ruta reimplementara algo de eso, en dos meses
 * la ficha y la agenda no cancelarían igual.
 *
 * 🔴 POR QUÉ UNA RUTA PROPIA Y NO LA GENERAL (`/api/instituto/agenda/[id]/
 * estado`). Dos razones, y la segunda es la buena:
 *   1. el MOTIVO. La ficha lo exige y la ruta general no lo manda; añadirlo
 *      allí es tocar un archivo que pertenece a otra casilla de esta misma
 *      ola, y dos ramas escribiendo el mismo archivo es un conflicto que no
 *      compra nada.
 *   2. y el CANDADO DE MÁS: aquí se comprueba que la cita sea DE ESTE
 *      PACIENTE. La ruta general no puede (no sabe de qué ficha vienes), y
 *      sin eso el id del paciente de la URL sería decorativo — se podría
 *      cancelar la cita de otro paciente desde la ficha de éste, dentro del
 *      alcance y sin que nada fallara.
 *
 * 🔴 PERMISOS: `agenda.view` para entrar (registrar lo que pasa en el
 * sillón no es administrar la agenda) y `agenda.manage` para cancelar o dar
 * por no presentado — la MISMA distinción que la ruta general, resuelta con
 * la misma llamada. Se le pasa `canManage` a la capa de datos en vez de
 * partir el endpoint en dos.
 *
 * ⚠️ El MOTIVO se guarda marcado al final de las notas de la cita:
 * `EduAppointment` no tiene columna de motivo y esta ola no crea ninguna.
 * Está razonado en `setEduAppointmentStatus`.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string; citaId: string } },
) {
  const g = await eduApiGuard("agenda.view");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);

    // 🔴 LA CITA TIENE QUE SER DE ESTE PACIENTE. `getEduAppointment` la
    // busca ya con el `where` del alcance, así que una que no le toca a
    // quien pregunta se ve igual que una que no existe; lo que se añade
    // aquí es que además sea del paciente cuya ficha está abierta. Los dos
    // fallos contestan 404 y con el mismo texto: distinguirlos confirmaría
    // qué citas existen.
    const cita = await getEduAppointment(g.ctx, params.citaId, g.ctx.institution.timezone);
    if (!cita || cita.patientId !== params.id) {
      throw new EduPadronError("Esa cita no es de este paciente.", 404);
    }

    const canManage = hasEduPermission(
      { role: g.ctx.role, permissionsOverride: g.ctx.user.permissionsOverride },
      "agenda.manage",
    );
    const res = await setEduAppointmentStatus(g.ctx, params.citaId, body.status, {
      canManage,
      reason: body.reason,
    });
    // 🔴 N-15 · EL AVISO DEL RECORDATORIO VIAJA CON LA RESPUESTA. El modal
    // afirmaba, sin condición, que «el recordatorio automático no sale», y
    // lo que se cancela es solo lo que sigue en cola: con un recordatorio a
    // 24 h y una cancelación la tarde anterior, el aviso salió hace horas.
    // La frase la arma `eduReminderCancelLabel` (recordatorios.ts, pura y
    // probada) para que todas las pantallas que cancelen digan lo mismo.
    return NextResponse.json({
      ok: true,
      id: res.id,
      status: res.status,
      recordatorio: res.recordatorio,
      recordatorioAviso: eduReminderCancelLabel(res.recordatorio),
    });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/pacientes/[id]/agenda/[citaId]");
  }
}
