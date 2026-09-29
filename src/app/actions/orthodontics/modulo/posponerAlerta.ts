"use server";
// Ortodoncia — «Posponer 7 días» de una alerta (fila 22 de la revisión de
// uso, ws1-t4 ronda 6). Del cliente solo llegan el paciente y el tipo de
// alerta; `clinicId` y el usuario salen de la sesión, y el paciente se
// comprueba contra la clínica y su visibilidad antes de escribir.
//
// Si la tabla de `sql/ortodoncia-alertas-pospuestas.sql` aún no existe, no se
// cae: responde que todavía no está disponible.

import { revalidatePath } from "next/cache";
import { hastaDePosposicion, esTipoPosponible } from "@/lib/orthodontics/alertas-pospuestas";
import { faltaLaTabla, guardarPosposicion } from "@/lib/orthodontics/alertas-pospuestas-db";
import { registrarMovimientoDelPaciente } from "@/lib/movimientos-paciente/registrar";
import { getOrthoActionContext, loadPatientForOrtho } from "../_helpers";
import { fail, isFailure, ok, type ActionResult } from "../result";

export async function posponerAlerta(input: {
  patientId: string;
  tipo: string;
}): Promise<ActionResult<{ hasta: string }>> {
  // Posponer no toca el expediente: basta con poder verlo.
  const auth = await getOrthoActionContext({ write: false });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  if (!ctx.clinicId) return fail("No autenticado");
  if (typeof input?.patientId !== "string" || !input.patientId) return fail("Falta el paciente");
  if (!esTipoPosponible(input.tipo)) return fail("Esta alerta no se puede posponer");

  const paciente = await loadPatientForOrtho({ ctx, patientId: input.patientId });
  if (isFailure(paciente)) return paciente;

  const hasta = hastaDePosposicion(new Date());
  try {
    await guardarPosposicion({
      clinicId: ctx.clinicId,
      patientId: paciente.data.id,
      tipo: input.tipo,
      hasta,
      userId: ctx.userId,
    });
  } catch (e) {
    if (faltaLaTabla(e)) return fail("Posponer alertas todavía no está disponible en esta clínica.");
    // ws1-t12: el tipo «reevaluacion-radiografica» necesita que la restricción de la tabla lo acepte
    // (sql/ortodoncia-plan-de-tratamiento.sql, bloque 3). Postgres 23514 = «check_violation».
    if (esViolacionDeCheck(e)) return fail("Posponer esta alerta todavía no está disponible: falta pegar sql/ortodoncia-plan-de-tratamiento.sql.");
    console.error("[ortodoncia] posponerAlerta:", e);
    return fail("No se pudo posponer la alerta. Inténtalo de nuevo.");
  }

  await registrarMovimientoDelPaciente({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    patientId: paciente.data.id,
    entityType: "orthodontic-case",
    entityId: paciente.data.id,
    action: "update",
    texto: "Pospuso 7 días una alerta de ortodoncia",
  });
  revalidatePath("/dashboard/orthodontics/alertas");
  return ok({ hasta: hasta.toISOString() });
}

/** Postgres 23514 (check_violation), o Prisma envolviéndolo. */
function esViolacionDeCheck(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const err = e as { code?: string; meta?: { code?: string }; message?: string };
  if (err.code === "23514" || err.meta?.code === "23514") return true;
  return typeof err.message === "string" && /ortho_alert_snoozes_tipo_check|23514/.test(err.message);
}
