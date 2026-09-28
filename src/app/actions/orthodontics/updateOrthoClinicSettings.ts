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
  DEFAULT_ORTHO_APPOINTMENT_TYPES,
} from "@/lib/orthodontics/clinic-settings-db";
import { fail, isFailure, ok, type ActionResult } from "./result";

const appointmentTypeSchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
});

const inputSchema = z.object({
  defaultTreatingDoctorId: z.string().nullable(),
  appointmentTypes: z.array(appointmentTypeSchema).min(1).max(20),
  messageTemplates: z.record(z.string().max(2000)),
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

  try {
    await guardarOrthoClinicSettings({
      clinicId: ctx.clinicId,
      updatedBy: ctx.userId,
      defaultTreatingDoctorId: data.defaultTreatingDoctorId,
      appointmentTypes: data.appointmentTypes,
      messageTemplates: data.messageTemplates,
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
    },
    after: {
      defaultTreatingDoctorId: data.defaultTreatingDoctorId,
      appointmentTypes: data.appointmentTypes,
      messageTemplates: data.messageTemplates,
    },
  });

  try {
    revalidatePath("/dashboard/orthodontics/configuracion");
  } catch (e) {
    console.error("[ortho] updateOrthoClinicSettings · revalidate:", e);
  }

  return ok({ saved: true });
}

export { DEFAULT_ORTHO_APPOINTMENT_TYPES };
