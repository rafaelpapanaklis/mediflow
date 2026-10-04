"use server";
// Ortodoncia — «Registrar colocación» / «Colocar aparatos hoy» (ws1-t8, auditoría de BEVADENT: F12 y mejora 5).
//
// Dos acciones para el cajón de la colocación (fila «Por colocar» de Casos y cabecera del caso):
//  · `datosParaColocar`: lo que el cajón propone (hoy en la zona de la clínica, la técnica del caso, los controles
//    previstos: los del plan o la propuesta con su duración y la frecuencia de control de la clínica).
//  · `registrarColocacion`: guarda la fecha (y `startDate` si no tenía), pasa el caso de «Por colocar» a «En curso»
//    con sus efectos de siempre (fase en curso), cambia la técnica si se eligió otra (con el precio por control de la
//    nueva, como «Datos del caso») y guarda los controles previstos por la vía de «Editar plan». Devuelve el
//    calendario propuesto: NO agenda nada solo (el primer control se agenda con la «Nueva cita» de siempre).
//
// Reglas de la casa: `clinicId` y usuario SIEMPRE de la sesión; `medicalRecord.edit` + módulo + acceso a Ortodoncia
// (`getOrthoActionContext`); paciente visible (`loadPatientForOrtho`); solo un caso «Por colocar» (la escritura lleva
// `status: "PLANNED"` en el where: dos clics a la vez no la registran dos veces). Bitácora: `auditOrtho` con el estado
// y la fecha, la misma fila que deja «Datos del caso» al poner la fecha.

import { revalidatePath } from "next/cache";
import type { OrthoTechnique } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hoyEnZona } from "@/lib/fechas/hoy-en-zona";
import { aplicarEfectosDeEstado } from "@/lib/orthodontics/efectos-estado-caso";
import { cargarNombreDeTecnica, guardarNombreDeTecnicaDelCaso, leerTecnicasDeLaClinica } from "@/lib/orthodontics/tecnicas-de-la-clinica-db";
import { ID_TECNICA_ACTUAL, nombreDeTecnica, nombrePropioAGuardar, tecnicasActivas } from "@/lib/orthodontics/tecnicas-de-la-clinica";
import { fijarPrecioControlSegunTecnica } from "@/lib/orthodontics/precio-control-del-caso-db";
import { cambioLaTecnica } from "@/lib/orthodontics/precio-control-del-caso";
import { cargarPlanDetalle, columnaDePlanDetalleExiste, leerOpcionesDelPlan } from "@/lib/orthodontics/plan-detalle-db";
import { aplicarPlanDetalle } from "@/lib/orthodontics/plan-detalle-guardar";
import { controlesSugeridos, datoDelPlanSinCapturar, planDetalleVacio } from "@/lib/orthodontics/plan-detalle";
import {
  calendarioDeControles,
  diasCerradosDelHorario,
  instanteDeColocacion,
  motivoParaNoColocar,
  motivoSinConsentimiento,
  validarColocacion,
  type CalendarioPropuesto,
} from "@/lib/orthodontics/colocacion";
import { consentimientoDeOrtodonciaFirmado } from "@/lib/orthodontics/consentimiento-firmado-db";
import type { CasoGuardado } from "@/lib/orthodontics/redesign/caso-guardado";
import { auditOrtho, getOrthoActionContext, loadPatientForOrtho } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

const ZONA_POR_OMISION = "America/Mexico_City";

async function zonaDeLaClinica(clinicId: string): Promise<string> {
  const c = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { timezone: true } });
  return c?.timezone || ZONA_POR_OMISION;
}

/** C-69: los días que la clínica no abre (su horario); sin horario o si falla la lectura, solo el domingo. */
async function diasCerradosDeLaClinica(clinicId: string): Promise<number[]> {
  try {
    const filas = await prisma.clinicSchedule.findMany({ where: { clinicId }, select: { dayOfWeek: true, enabled: true } });
    return diasCerradosDelHorario(filas);
  } catch {
    return [0];
  }
}

export interface DatosParaColocar {
  /** "YYYY-MM-DD" de hoy en la zona de la clínica: la fecha que se propone. */
  hoy: string;
  patientName: string;
  /** El caso sigue «Por colocar» (si no, el cajón lo dice y no deja guardar). */
  porColocar: boolean;
  motivo: string | null;
  tecnica: { base: string; label: string | null; nombre: string };
  /** Los controles previstos del plan, o null. */
  controlesPrevistos: number | null;
  /** La propuesta con la duración del caso (si es un dato real) y la frecuencia de la clínica. */
  controlesPropuestos: number | null;
  frecuenciaDias: number;
  /** Doctor tratante, para que «Agendar el primer control» nazca con él. */
  treatingDoctorId: string | null;
  /** Existe la columna del plan: sin ella los controles previstos no se guardan. */
  planGuardable: boolean;
  /** C-62: sin el consentimiento de ortodoncia firmado (o sin poder comprobarlo) no se deja registrar; el motivo. */
  sinConsentimiento: string | null;
  /** C-69: días de la semana en que la clínica no abre (el calendario propuesto los salta). */
  diasCerrados: number[];
}

export async function datosParaColocar(input: unknown): Promise<ActionResult<DatosParaColocar>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;
  // `clinicId: undefined` en Prisma NO filtra: sin clínica no se consulta nada.
  if (!ctx.clinicId) return fail("No autenticado");
  const planId = (input as { treatmentPlanId?: unknown } | null)?.treatmentPlanId;
  if (typeof planId !== "string" || !planId) return fail("Caso no encontrado");

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: planId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, patientId: true, status: true, technique: true, estimatedDurationMonths: true },
  });
  if (!plan) return fail("Caso no encontrado");
  const paciente = await loadPatientForOrtho({ ctx, patientId: plan.patientId });
  if (isFailure(paciente)) return paciente;

  const zona = await zonaDeLaClinica(ctx.clinicId);
  const [label, opciones, planGuardable, firmado, diasCerrados] = await Promise.all([
    cargarNombreDeTecnica(ctx.clinicId, plan.id),
    leerOpcionesDelPlan(ctx.clinicId),
    columnaDePlanDetalleExiste(),
    consentimientoDeOrtodonciaFirmado(ctx.clinicId, plan.patientId),
    diasCerradosDeLaClinica(ctx.clinicId),
  ]);
  const detalle = planGuardable ? await cargarPlanDetalle(ctx.clinicId, plan.id) : null;
  let doctor: string | null = null;
  try {
    const d = await prisma.orthodonticTreatmentPlan.findFirst({ where: { id: plan.id, clinicId: ctx.clinicId }, select: { treatingDoctorId: true } });
    doctor = d?.treatingDoctorId ?? null;
  } catch {
    doctor = null; // sin sql/ortodoncia-nucleo.sql: sin doctor tratante
  }
  const duracionReal = datoDelPlanSinCapturar(detalle, "duracion") ? null : plan.estimatedDurationMonths;
  const motivo = motivoParaNoColocar(String(plan.status));
  return ok({
    hoy: hoyEnZona(new Date(), zona),
    patientName: `${paciente.data.firstName} ${paciente.data.lastName}`.trim(),
    porColocar: motivo === null,
    motivo,
    tecnica: { base: String(plan.technique), label, nombre: nombreDeTecnica(String(plan.technique), label) },
    controlesPrevistos: detalle?.controlesPrevistos ?? null,
    controlesPropuestos: duracionReal ? controlesSugeridos(duracionReal, opciones.frecuenciaControlDias) : null,
    frecuenciaDias: opciones.frecuenciaControlDias,
    treatingDoctorId: doctor,
    planGuardable,
    sinConsentimiento: motivoSinConsentimiento(firmado),
    diasCerrados,
  });
}

export interface ColocacionRegistrada {
  casoGuardado: CasoGuardado;
  calendario: CalendarioPropuesto;
  /** Aviso que no impidió registrar la colocación (p. ej. los controles previstos no se guardaron). */
  aviso?: string;
}

export async function registrarColocacion(input: unknown): Promise<ActionResult<ColocacionRegistrada>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;
  if (!ctx.clinicId || !ctx.userId) return fail("No autenticado");

  const zona = await zonaDeLaClinica(ctx.clinicId);
  const v = validarColocacion(input, hoyEnZona(new Date(), zona));
  if (!v.ok) return fail(v.error);
  const d = v.datos;

  const antes = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: d.treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, patientId: true, status: true, technique: true, startDate: true, installedAt: true },
  });
  if (!antes) return fail("Caso no encontrado");
  const paciente = await loadPatientForOrtho({ ctx, patientId: antes.patientId });
  if (isFailure(paciente)) return paciente;
  const motivo = motivoParaNoColocar(String(antes.status));
  if (motivo) return fail(motivo);
  // C-62 (decisión 5): sin consentimiento de ortodoncia firmado no se coloca — el servidor lo exige aunque el
  // cajón ya lo diga (otra pestaña, una revocación a medio camino, un cliente viejo).
  const sinConsentimiento = motivoSinConsentimiento(await consentimientoDeOrtodonciaFirmado(ctx.clinicId, antes.patientId));
  if (sinConsentimiento) return fail(sinConsentimiento);

  // La técnica elegida: solo una ACTIVA de la lista de la clínica (o la que el caso ya tiene).
  const labelAntes = await cargarNombreDeTecnica(ctx.clinicId, antes.id);
  let tecnica: { base: string; label: string | null } | null = null;
  if (d.tecnicaId && d.tecnicaId !== ID_TECNICA_ACTUAL) {
    const activas = tecnicasActivas((await leerTecnicasDeLaClinica(ctx.clinicId)).tecnicas);
    const t = activas.find((x) => x.id === d.tecnicaId);
    if (!t) return fail("Esa técnica ya no se ofrece en tu clínica. Elige otra.");
    const nueva = { base: t.base, label: nombrePropioAGuardar(t) };
    if (cambioLaTecnica({ base: String(antes.technique), label: labelAntes }, nueva)) tecnica = nueva;
  }

  const instante = instanteDeColocacion(d.fecha);
  const ahora = new Date();
  try {
    const r = await prisma.$transaction(async (tx) => {
      const hecho = await tx.orthodonticTreatmentPlan.updateMany({
        // `status: "PLANNED"` en el where: si otra pestaña ya la registró, aquí no se pisa.
        where: { id: antes.id, clinicId: ctx.clinicId, deletedAt: null, status: "PLANNED" },
        data: {
          installedAt: instante,
          ...(antes.startDate ? {} : { startDate: instante }),
          status: "IN_PROGRESS",
          statusUpdatedAt: ahora,
          ...(tecnica ? { technique: tecnica.base as OrthoTechnique } : {}),
        },
      });
      if (hecho.count === 0) return false;
      // H46: el estado arrastra a la fase (la primera pasa a «en curso»), en la MISMA transacción.
      await aplicarEfectosDeEstado(tx, { id: antes.id, clinicId: ctx.clinicId }, "IN_PROGRESS", ahora);
      return true;
    });
    if (!r) return fail("Este caso ya tiene la colocación registrada. La fecha se corrige desde «Datos del caso».");
  } catch (e) {
    console.error("[ortho] registrarColocacion:", e);
    return fail("No se pudo registrar la colocación. No se cambió nada.");
  }

  // La técnica nueva: su nombre propio y el precio por control de los próximos controles («Pago por control»), igual
  // que «Datos del caso». Sin lanzar: la colocación ya quedó.
  let precioControl: { antes: number | null; despues: number | null } | null = null;
  if (tecnica) {
    await guardarNombreDeTecnicaDelCaso(ctx.clinicId, antes.id, tecnica.label);
    try {
      const p = await fijarPrecioControlSegunTecnica({ clinicId: ctx.clinicId, planId: antes.id, base: tecnica.base, label: tecnica.label });
      if (p.cambio) precioControl = { antes: p.antes, despues: p.despues };
    } catch (e) {
      console.warn("[ortho] registrarColocacion: no se pudo fijar el precio por control:", e);
    }
  }

  // Controles previstos: por la vía de «Editar plan» (su bitácora y sus reglas).
  let aviso: string | undefined;
  let previstos: number | null = null;
  if (d.controlesPrevistos !== undefined) {
    const actual = (await cargarPlanDetalle(ctx.clinicId, antes.id)) ?? planDetalleVacio();
    if (actual.controlesPrevistos === d.controlesPrevistos) previstos = d.controlesPrevistos;
    else {
      const g = await aplicarPlanDetalle({
        ctx: { clinicId: ctx.clinicId, userId: ctx.userId },
        treatmentPlanId: antes.id,
        patientId: antes.patientId,
        plan: { ...actual, controlesPrevistos: d.controlesPrevistos },
      });
      if (g.ok) previstos = d.controlesPrevistos;
      else aviso = `La colocación quedó registrada, pero los controles previstos no se guardaron: ${"error" in g ? g.error : "error al guardar"}`;
    }
  } else {
    previstos = (await cargarPlanDetalle(ctx.clinicId, antes.id))?.controlesPrevistos ?? null;
  }

  await auditOrtho({
    ctx,
    action: ORTHO_AUDIT_ACTIONS.TREATMENT_PLAN_STATUS_CHANGED,
    entityType: "OrthodonticTreatmentPlan",
    entityId: antes.id,
    patientId: antes.patientId,
    before: {
      status: String(antes.status),
      installedAt: antes.installedAt ? antes.installedAt.toISOString() : null,
      ...(tecnica ? { technique: String(antes.technique), techniqueLabel: labelAntes } : {}),
      ...(precioControl ? { precioPorControl: precioControl.antes } : {}),
    },
    after: {
      status: "IN_PROGRESS",
      installedAt: instante.toISOString(),
      ...(tecnica ? { technique: tecnica.base, techniqueLabel: tecnica.label } : {}),
      ...(precioControl ? { precioPorControl: precioControl.despues } : {}),
    },
    meta: { via: "registrar-colocacion" },
  });

  revalidatePath(`/dashboard/patients/${antes.patientId}`);
  revalidatePath("/dashboard/orthodontics/pacientes");
  revalidatePath("/dashboard/orthodontics/tablero");
  revalidatePath("/dashboard/orthodontics/alertas");

  const [{ frecuenciaControlDias }, diasCerrados] = await Promise.all([leerOpcionesDelPlan(ctx.clinicId), diasCerradosDeLaClinica(ctx.clinicId)]);
  return ok({
    casoGuardado: { status: "IN_PROGRESS", installedAt: instante.toISOString() },
    calendario: calendarioDeControles(d.fecha, frecuenciaControlDias, previstos, diasCerrados),
    ...(aviso ? { aviso } : {}),
  });
}
