"use server";
// Orthodontics — action 2/15: updateDiagnosis. SPEC §5.
//
// ws1-t8: el guardado vive en lib/orthodontics/diagnostico-guardar.ts en tres tiempos (preparar → ejecutar →
// movimiento) para que la ventana del caso pueda guardar Diagnóstico y Plan juntos. Esta acción es el
// guardado del paso SOLO: los tres seguidos, sin transacción de nadie más.

import { revalidatePath } from "next/cache";
import {
  ejecutarGuardadoDelDiagnostico,
  movimientoDelGuardado,
  prepararGuardadoDelDiagnostico,
} from "@/lib/orthodontics/diagnostico-guardar";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function updateDiagnosis(
  input: unknown,
): Promise<ActionResult<{ id: string; altaCasoFieldsSaved: boolean; avisoDetalle: string | null }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const prep = await prepararGuardadoDelDiagnostico(ctx, input);
  if (prep.ok === false) return fail(prep.error);
  const p = prep.preparado;

  try {
    const r = await ejecutarGuardadoDelDiagnostico(p);

    // Movimientos del paciente: qué apartados cambiaron (nada cambió = sin fila).
    const mov = movimientoDelGuardado(p, r);
    if (mov) {
      await auditOrtho({
        ctx,
        action: ORTHO_AUDIT_ACTIONS.DIAGNOSIS_UPDATED,
        entityType: "OrthodonticDiagnosis",
        entityId: r.updated.id,
        patientId: p.patientId,
        before: mov.before,
        after: mov.after,
      });
    }

    revalidatePath(`/dashboard/patients/${r.updated.patientId}/orthodontics`);
    revalidatePath(`/dashboard/specialties/orthodontics/${r.updated.patientId}`);
    return ok({ id: r.updated.id, altaCasoFieldsSaved: r.altaCasoFieldsSaved, avisoDetalle: r.avisoDetalle });
  } catch (e) {
    console.error("[ortho] updateDiagnosis failed:", e);
    return fail("No se pudo actualizar el diagnóstico");
  }
}
