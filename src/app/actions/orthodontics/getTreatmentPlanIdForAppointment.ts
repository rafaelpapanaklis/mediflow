"use server";
// Orthodontics — Control y agenda (ws1-t4, Ola 1, sep-2026).
//
// Resuelve el `treatmentPlanId` de un paciente para que `RanuraCita`
// (agenda/RanuraCita.tsx) sepa si la cita de HOY corresponde a un caso de
// ortodoncia abierto — el hueco que dejó Ola 0 (ver «MAPA DE PARTES»,
// REPORTE-ws1-t1.md, punto 6): `AgendaAppointmentDTO` no trae
// `treatmentPlanId`, así que esta parte decidió resolverlo con un lookup
// propio por `patientId` en vez de tocar el DTO general de Agenda
// (compartido con TODOS los verticales dentales).
//
// Es un self-fetch desde un componente cliente ("use server" se puede
// invocar directo sin pasar por una API route) — mismo espíritu que
// AvisoAnticiposPorRevisar: se calla si no hay nada.
//
// Arreglo de la revisión cruzada (REPORTE-ws1-t1.md, sección «Revisión
// cruzada»), dos hallazgos:
//   1) Este lookup exigía `medicalRecord.view` (vía `getOrthoActionContext`)
//      — recepción no lo tiene por default, así que la ranura ENTERA
//      (ResumenCobranza + BotonHojaControl) desaparecía justo para el rol
//      que necesita cobrar en la visita (R1). Ahora acepta
//      `medicalRecord.view` O `billing.view`: cualquiera de los dos basta
//      para saber que el caso existe. La parte clínica (BotonHojaControl)
//      sigue exigiendo `medicalRecord.*` — ver `canOpenClinicalCard` abajo
//      y el filtro en `RanuraCita.tsx`.
//   2) No comprobaba visibilidad de paciente (`canSeePatient`): cualquier
//      usuario autenticado de la clínica que adivinara un `patientId` de un
//      paciente restringido podía leer si tiene caso de ortodoncia. Ahora
//      reusa `loadPatientForOrtho` (mismo chequeo que el resto del módulo).

import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { hasPermission } from "@/lib/auth/permissions";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { MENSAJE_SIN_ACCESO_ORTODONCIA, tieneAccesoOrtodoncia } from "@/lib/orthodontics/acceso-doctor";
import { loadPatientForOrtho } from "./_helpers";
import { cargarModoDeCobro } from "@/lib/orthodontics/billing-mode-db";
import { normalizarOrthoBillingMode } from "@/lib/orthodontics/billing-mode";
import { resolveTreatmentPlanAccess } from "./_control-agenda-predicates";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function getTreatmentPlanIdForAppointment(
  patientId: string,
): Promise<ActionResult<{ treatmentPlanId: string | null; canOpenClinicalCard: boolean; billingMode: "PRECIO_TOTAL" | "PAGO_POR_CONTROL" | null }>> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");
  if (ctx.clinicCategory !== "DENTAL") {
    return fail("La clínica no soporta el módulo de Ortodoncia");
  }
  if (!(await hasActiveOrthodonticsModule(ctx.clinicId))) {
    return fail("Módulo Ortodoncia no activo para esta clínica");
  }
  if (!tieneAccesoOrtodoncia({ role: ctx.role, permissionsOverride: ctx.permissionsOverride })) return fail(MENSAJE_SIN_ACCESO_ORTODONCIA);

  const perms = { role: ctx.role as any, permissionsOverride: ctx.permissionsOverride };
  const access = resolveTreatmentPlanAccess({
    canClinical: hasPermission(perms, "medicalRecord.view"),
    canClinicalEdit: hasPermission(perms, "medicalRecord.edit"),
    canBilling: hasPermission(perms, "billing.view"),
  });
  if (!access.allowed) {
    return fail("Sin permisos: medicalRecord.view o billing.view");
  }

  if (!patientId) return fail("patientId requerido");

  // Visibilidad por paciente: sin este chequeo, cualquier usuario de la
  // clínica con uno de los dos permisos podría leer si un paciente
  // restringido tiene caso de ortodoncia con solo adivinar su id.
  const patient = await loadPatientForOrtho({ ctx, patientId });
  if (isFailure(patient)) return patient;

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { patientId, clinicId: ctx.clinicId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  // ws1-t10 (decisión 5): el panel de la cita necesita saber si el caso cobra «a plazos» o
  // «por control» para decidir si ofrece «Pedir anticipo». Sin caso, null.
  const billingMode = plan ? normalizarOrthoBillingMode(await cargarModoDeCobro(ctx.clinicId, plan.id).catch(() => null)) : null;

  return ok({ treatmentPlanId: plan?.id ?? null, canOpenClinicalCard: access.canOpenClinicalCard, billingMode });
}
