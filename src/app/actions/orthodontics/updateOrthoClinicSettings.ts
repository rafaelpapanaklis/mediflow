"use server";
// Orthodontics — Configuración del submenú (Ola 1, ws1-t3). Guarda doctor
// tratante por defecto, catálogo de tipos de cita (C7) y plantillas de
// mensaje. Zod valida forma; el permiso lo exige getOrthoConfigActionContext
// (settings.edit — es ajuste de la clínica, no dinero ni expediente).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getOrthoConfigActionContext, auditOrtho } from "./_helpers";
import { esDoctorTratanteDeLaClinica } from "@/lib/orthodontics/doctores-tratantes-db";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import {
  guardarOrthoClinicSettings,
  loadOrthoClinicSettings,
  type OrthoAppointmentTypeOption,
} from "@/lib/orthodontics/clinic-settings-db";
import { motivoDeRechazo } from "@/lib/orthodontics/tipos-de-cita";
import { normalizarOrthoBillingMode } from "@/lib/orthodontics/billing-mode";
import { motivoDeRechazoDePlantillas, normalizarPlantillas } from "@/lib/orthodontics/plantillas-mensaje";
import { fail, isFailure, ok, type ActionResult } from "./result";

const appointmentTypeSchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
  // ws1-t1 ronda 2 — editable, opcional: sin valor cae al mejor esfuerzo
  // (whatsapp-bot-booking.ts). null explícito = "borrar el valor propio".
  durationMin: z.number().int().positive().max(600).nullable().optional(),
});

const inputSchema = z.object({
  defaultTreatingDoctorId: z.string().nullable(),
  appointmentTypes: z.array(appointmentTypeSchema).min(1).max(20),
  messageTemplates: z.record(z.string().max(2000)),
  // Ola 2 (ws1-t1) — opcional a propósito: mientras la pantalla de
  // Configuración (ws1-t3) no mande este campo, se conserva el que ya
  // tenía guardado la clínica (no se resetea a PRECIO_TOTAL por omisión).
  billingMode: z.enum(["PRECIO_TOTAL", "PAGO_POR_CONTROL"]).optional(),
  // ws1-t1 ronda 2 — mismo criterio opcional que billingMode: sin este
  // campo se conserva el valor que ya tenía la clínica.
  proximoControlBotEnabled: z.boolean().optional(),
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

  // El doctor por defecto tiene que ser alguien que ATIENDE en ESTA clínica —
  // el clinicId nunca sale del cliente, sale de la sesión (ctx.clinicId). La
  // regla es la misma de la lista que se ofrece (doctores-tratantes.ts): un
  // doctor, o el dueño/administrador que atiende.
  if (data.defaultTreatingDoctorId) {
    const valido = await esDoctorTratanteDeLaClinica(ctx.clinicId, data.defaultTreatingDoctorId);
    if (!valido) return fail("El doctor tratante por defecto ya no atiende en esta clínica. Elige otro de la lista.");
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
    durationMin: t.durationMin ?? null,
  }));

  // La fila fija se reconoce por su CLAVE ("control"), no por su texto
  // (ws1-t3, 28-sep-2026), y tiene que llevar el texto exacto que la Agenda
  // compara contra Appointment.type (esCitaControlOrto) para resolver la
  // ranura de control, la hoja de control y las listas de Recepción. Ninguna
  // otra fila puede llamarse igual. Es la MISMA regla que aplica la pantalla;
  // aquí se repite porque lo que llega del cliente no se da por bueno.
  const rechazo = motivoDeRechazo(appointmentTypes);
  if (rechazo) return fail(rechazo);

  // ws1-t5 (ronda 6): las plantillas ya se MANDAN (recordatorio de control y
  // aviso de mensualidad vencida), así que una variable mal escrita le
  // llegaría al paciente con todo y llaves. Se rechaza aquí, diciendo cuáles
  // sí existen; y se guardan solo las claves del módulo, sin las vacías.
  const rechazoPlantilla = motivoDeRechazoDePlantillas(data.messageTemplates);
  if (rechazoPlantilla) return fail(rechazoPlantilla);
  const messageTemplates = normalizarPlantillas(data.messageTemplates);

  const billingMode = data.billingMode ? normalizarOrthoBillingMode(data.billingMode) : before.billingMode;
  const proximoControlBotEnabled = data.proximoControlBotEnabled ?? before.proximoControlBotEnabled;

  try {
    await guardarOrthoClinicSettings({
      clinicId: ctx.clinicId,
      updatedBy: ctx.userId,
      defaultTreatingDoctorId: data.defaultTreatingDoctorId,
      appointmentTypes,
      messageTemplates,
      billingMode,
      proximoControlBotEnabled,
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
      proximoControlBotEnabled: before.proximoControlBotEnabled,
    },
    after: {
      defaultTreatingDoctorId: data.defaultTreatingDoctorId,
      appointmentTypes: data.appointmentTypes,
      messageTemplates,
      billingMode,
      proximoControlBotEnabled,
    },
  });

  try {
    revalidatePath("/dashboard/orthodontics/configuracion");
  } catch (e) {
    console.error("[ortho] updateOrthoClinicSettings · revalidate:", e);
  }

  return ok({ saved: true });
}
