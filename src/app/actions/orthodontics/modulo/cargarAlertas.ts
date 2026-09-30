"use server";
// Ortodoncia — Alertas: leer las alertas de nuevo SIN recargar la página (ws1-t12, revisión final, punto 10).
//
// «Deshacer» una alerta pospuesta quitaba la fila de «pospuestas» al instante, pero el caso no volvía a su sección
// («Sin próximo control»…) hasta recargar: la pantalla dependía de que `router.refresh()` trajera la página de
// nuevo. Ahora, tras posponer o deshacer, la vista pide los datos por aquí y se repinta con ellos.
//
// Mismos datos y mismo filtro que la página (`loadOrthoAlerts`); `clinicId` y el usuario SIEMPRE de la sesión.

import { prisma } from "@/lib/prisma";
import { loadOrthoAlerts, type OrthoAlertsData } from "@/lib/orthodontics/alerts-data";
import { getOrthoActionContext } from "../_helpers";
import { fail, isFailure, ok, type ActionResult } from "../result";

export async function cargarAlertasDeOrtodoncia(): Promise<ActionResult<OrthoAlertsData>> {
  const auth = await getOrthoActionContext({ write: false });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;
  // `clinicId: undefined` en Prisma NO filtra: sin clínica no se consulta nada.
  if (!ctx.clinicId || !ctx.userId) return fail("No autenticado");
  const clinica = await prisma.clinic.findUnique({ where: { id: ctx.clinicId }, select: { timezone: true } });
  try {
    return ok(
      await loadOrthoAlerts(ctx.clinicId, clinica?.timezone ?? "America/Mexico_City", {
        userId: ctx.userId,
        role: ctx.role,
        clinicId: ctx.clinicId,
      }),
    );
  } catch (e) {
    console.error("[ortodoncia] cargarAlertasDeOrtodoncia:", e);
    return fail("No se pudieron cargar las alertas.");
  }
}
