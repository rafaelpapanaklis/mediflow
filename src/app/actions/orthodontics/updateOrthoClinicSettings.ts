"use server";
// Orthodontics — Configuración del submenú (Ola 1, ws1-t3). Guarda doctor
// tratante por defecto, catálogo de tipos de cita (C7) y plantillas de
// mensaje. Zod valida forma; el permiso lo exige getOrthoConfigActionContext
// (settings.edit — es ajuste de la clínica, no dinero ni expediente).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getOrthoConfigActionContext, auditOrtho } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import {
  guardarOrthoClinicSettings,
  loadOrthoClinicSettings,
  type OrthoAppointmentTypeOption,
} from "@/lib/orthodontics/clinic-settings-db";
import { TIPO_CITA_CONTROL_ORTO } from "@/lib/orthodontics/agenda-constants";
import { normalizarOrthoBillingMode } from "@/lib/orthodontics/billing-mode";
import { fail, isFailure, ok, type ActionResult } from "./result";

const appointmentTypeSchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
});

const inputSchema = z.object({
  defaultTreatingDoctorId: z.string().nullable(),
  appointmentTypes: z.array(appointmentTypeSchema).min(1).max(20),
  messageTemplates: z.record(z.string().max(2000)),
  // Ola 2 (ws1-t1) — opcional a propósito: mientras la pantalla de
  // Configuración (ws1-t3) no mande este campo, se conserva el que ya
  // tenía guardado la clínica (no se resetea a PRECIO_TOTAL por omisión).
  billingMode: z.enum(["PRECIO_TOTAL", "PAGO_POR_CONTROL"]).optional(),
});

function esTablaAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

export async function updateOrthoClinicSettings(
  input: unknown,
): Promise<ActionResult<{ saved: true }>> {
  const auth = await getOrthoConfigActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");
  const data = parsed.data;

  // El doctor por defecto tiene que ser un DOCTOR real de ESTA clínica — el
  // clinicId nunca sale del cliente, sale de la sesión (ctx.clinicId).
  if (data.defaultTreatingDoctorId) {
    const doctor = await prisma.user.findFirst({
      where: { id: data.defaultTreatingDoctorId, clinicId: ctx.clinicId, role: "DOCTOR" },
      select: { id: true },
    });
    if (!doctor) return fail("El doctor tratante por defecto no pertenece a esta clínica");
  }

  const before = await loadOrthoClinicSettings(ctx.clinicId);

  // Reconstrucción explícita (en vez de pasar data.appointmentTypes tal
  // cual): zod infería aquí un tipo con id/label opcionales dentro de este
  // archivo — el .min(1) de cada campo no se reflejaba en el tipo de
  // salida en este punto de la cadena. Los valores ya están validados
  // arriba (safeParse); esto es solo para que el tipo de salida sea el que
  // pide guardarOrthoClinicSettings.
  const appointmentTypes: OrthoAppointmentTypeOption[] = data.appointmentTypes.map((t) => ({
    id: t.id,
    label: t.label,
  }));

  // El texto "Control de ortodoncia" es lo que la Agenda compara contra
  // Appointment.type (esCitaControlOrto, agenda-constants.ts) para resolver
  // la ranura de control, la hoja de control y las listas de Recepción. Si
  // la clínica edita el catálogo hasta perder esa entrada, esas piezas se
  // quedan sin forma de reconocer un control — se rechaza antes de guardar.
  if (!appointmentTypes.some((t) => t.label === TIPO_CITA_CONTROL_ORTO)) {
    return fail(
      `El catálogo tiene que conservar un tipo de cita con el texto exacto "${TIPO_CITA_CONTROL_ORTO}" — la Agenda lo usa para reconocer los controles.`,
    );
  }

  const billingMode = data.billingMode ? normalizarOrthoBillingMode(data.billingMode) : before.billingMode;

  try {
    await guardarOrthoClinicSettings({
      clinicId: ctx.clinicId,
      updatedBy: ctx.userId,
      defaultTreatingDoctorId: data.defaultTreatingDoctorId,
      appointmentTypes,
      messageTemplates: data.messageTemplates,
      billingMode,
    });
  } catch (e) {
    if (esTablaAusente(e)) {
      return fail(
        "Falta pegar sql/ortodoncia-configuracion.sql en Supabase antes de guardar la Configuración.",
      );
    }
    throw e;
  }

  // P4: bitácora de cambios — quién tocó el doctor por defecto, el catálogo
  // de tipos de cita o las plantillas.
  await auditOrtho({
    ctx,
    action: ORTHO_AUDIT_ACTIONS.CLINIC_SETTINGS_UPDATED,
    entityType: "OrthodonticsClinicSettings",
    entityId: ctx.clinicId,
    before: {
      defaultTreatingDoctorId: before.defaultTreatingDoctorId,
      appointmentTypes: before.appointmentTypes,
      messageTemplates: before.messageTemplates,
      billingMode: before.billingMode,
    },
    after: {
      defaultTreatingDoctorId: data.defaultTreatingDoctorId,
      appointmentTypes: data.appointmentTypes,
      messageTemplates: data.messageTemplates,
      billingMode,
    },
  });

  try {
    revalidatePath("/dashboard/orthodontics/configuracion");
  } catch (e) {
    console.error("[ortho] updateOrthoClinicSettings · revalidate:", e);
  }

  return ok({ saved: true });
}
