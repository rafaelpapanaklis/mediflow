"use server";
// Ortodoncia — «Eliminar caso (abierto por error)» (ws1-t8).
//
// Solo un caso que NO tiene nada: ni hojas de control, ni pagos, ni fotos, ni
// análisis, ni alineadores, ni citas atendidas (NOM-004). Las facturas del caso
// SIN pagos se cancelan junto con él, con el motivo. Es borrado LÓGICO
// (`deletedAt` del plan y de su diagnóstico): nada se pierde de la base.
//
// Aquí solo va lo del servidor: la sesión, la visibilidad del paciente y los
// avisos. Lo que decide y escribe vive en `eliminar-caso-core.ts` (con pruebas).
// `clinicId` y `userId` salen de la sesión; del cliente solo llegan el id del
// caso y el motivo.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/auth/permissions";
import { registrarMovimientoDelPaciente } from "@/lib/movimientos-paciente/registrar";
import { existeColumnaDeFacturasDelCaso } from "@/lib/orthodontics/cobro/extras-db";
import { eliminarCasoEnBase, type DbEliminar } from "@/lib/orthodontics/eliminar-caso-core";
import { cerrarLinksDeFactura } from "@/lib/factura-mp/servicio.server";
import { cerrarAnticiposDePanel } from "@/lib/anticipos/panel.server";
import { getOrthoActionContext, loadPatientForOrtho } from "../_helpers";
import { fail, isFailure, ok, type ActionResult } from "../result";

export async function eliminarCaso(input: unknown): Promise<ActionResult<{ facturasCanceladas: number }>> {
  const auth = await getOrthoActionContext({ write: true });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const crudo = (input && typeof input === "object" ? input : {}) as { treatmentPlanId?: unknown; motivo?: unknown };
  const treatmentPlanId = typeof crudo.treatmentPlanId === "string" ? crudo.treatmentPlanId : "";

  const res = await eliminarCasoEnBase({
    db: prisma as unknown as DbEliminar,
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    treatmentPlanId,
    motivo: crudo.motivo,
    puedeCancelarFacturas: hasPermission(
      { role: ctx.role as never, permissionsOverride: ctx.permissionsOverride },
      "billing.refund",
    ),
    columnaDeFacturas: await existeColumnaDeFacturasDelCaso(),
    // Un paciente restringido no existe para quien no puede verlo.
    puedeVerPaciente: async (patientId) => !isFailure(await loadPatientForOrtho({ ctx, patientId })),
    registrar: (m) =>
      registrarMovimientoDelPaciente({
        clinicId: ctx.clinicId,
        userId: ctx.userId,
        ...m,
      }),
    alCancelarFactura: async (invoiceId) => {
      await cerrarLinksDeFactura({ clinicId: ctx.clinicId, invoiceId });
      await cerrarAnticiposDePanel({ clinicId: ctx.clinicId, invoiceId });
    },
  });
  if ("error" in res) return fail(res.error);

  revalidatePath("/dashboard/orthodontics", "layout");
  revalidatePath(`/dashboard/patients/${res.patientId}`);
  return ok({ facturasCanceladas: res.facturasCanceladas });
}
