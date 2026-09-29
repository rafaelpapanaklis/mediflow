import { prisma } from "@/lib/prisma";
import { registrarMovimientoDelPaciente } from "@/lib/movimientos-paciente/registrar";
import { cargarNombreDeTecnica, guardarNombreDeTecnicaDelCaso } from "./tecnicas-de-la-clinica-db";
import { nombreDeTecnica } from "./tecnicas-de-la-clinica";
import { cargarPlanDetalle } from "./plan-detalle-db";
import { aplicarPlanDetalle, type ResultadoDeAplicar } from "./plan-detalle-guardar";
import { validarPersonasDelCaso } from "./validar-personas-del-caso-db";
import { planDetalleVacio, validarPlanDetalle, type PlanDetalle } from "./plan-detalle";

// Ortodoncia — el PLAN DE TRATAMIENTO COMPLETO como un objeto, para leerlo y para guardarlo (ws1-t12).
//
// Es el enganche que ws1-t8 usa para las REEVALUACIONES (versiones fechadas e inmutables de diagnóstico + plan): la
// reevaluación abre la MISMA ventana del caso de dos pasos (`DrawerNewCase`, `modo="editar"`) PRECARGADA con este
// objeto —`vistaDeUnPlanCompleto` lo convierte a lo que la ventana pide— y, al confirmar, `guardarPlanCompleto` lo
// guarda. Quien versiona (t8) puede tomar la foto con `leerPlanCompleto` ANTES de guardar y archivarla como versión
// inmutable; esto no archiva nada por su cuenta.
//
// Lo que entra: técnica (tipo base y nombre propio), duración, objetivos, retención, doctor, responsable del pago,
// IPR, extracciones indicadas y el plan completo (`PlanDetalle`). Lo que NO entra, a propósito: el costo y la factura
// (siguen las reglas de «editar factura con pagos», `cambiarCostoDelCaso`), el estado del caso y la fecha de
// colocación (`updateTreatmentPlan`). `clinicId` y `userId` SIEMPRE los pone quien llama desde la sesión.

export interface PlanCompleto {
  treatmentPlanId: string;
  patientId: string;
  /** Tipo base (enum `OrthoTechnique`). */
  tecnica: string;
  /** Nombre propio guardado en el caso (null = el de su tipo base). */
  tecnicaNombrePropio: string | null;
  duracionMeses: number;
  objetivos: string;
  /** "" = sin definir. */
  retencion: string;
  doctorId: string | null;
  responsableId: string | null;
  iprRequerido: boolean;
  extraccionesIndicadas: number[];
  /** El plan completo, con `alineadoresTotales` ya fusionado con el seguimiento de alineadores. */
  detalle: PlanDetalle;
}

/** El plan completo de UN caso. `null` = el caso no existe en esta clínica. Tolera columnas que falten. */
export async function leerPlanCompleto(clinicId: string, treatmentPlanId: string): Promise<PlanCompleto | null> {
  // `clinicId: undefined` en Prisma NO filtra: sin clínica no se consulta nada.
  if (!clinicId || !treatmentPlanId) return null;
  let fila: {
    patientId: string;
    technique: string;
    estimatedDurationMonths: number;
    treatmentObjectives: string;
    retentionPlanText: string;
    iprRequired: boolean;
    extractionsTeethFdi: number[];
    treatingDoctorId?: string | null;
    responsibleGuardianId?: string | null;
  } | null;
  const donde = { id: treatmentPlanId, clinicId, deletedAt: null };
  const base = { patientId: true, technique: true, estimatedDurationMonths: true, treatmentObjectives: true, retentionPlanText: true, iprRequired: true, extractionsTeethFdi: true } as const;
  try {
    fila = await prisma.orthodonticTreatmentPlan.findFirst({ where: donde, select: { ...base, treatingDoctorId: true, responsibleGuardianId: true } });
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code !== "P2021" && code !== "P2022") throw e;
    fila = await prisma.orthodonticTreatmentPlan.findFirst({ where: donde, select: base });
  }
  if (!fila) return null;
  const [detalle, nombre] = await Promise.all([cargarPlanDetalle(clinicId, treatmentPlanId), cargarNombreDeTecnica(clinicId, treatmentPlanId)]);
  return {
    treatmentPlanId,
    patientId: fila.patientId,
    tecnica: String(fila.technique),
    tecnicaNombrePropio: nombre,
    duracionMeses: fila.estimatedDurationMonths,
    objetivos: String(fila.treatmentObjectives),
    retencion: fila.retentionPlanText ?? "",
    doctorId: fila.treatingDoctorId ?? null,
    responsableId: fila.responsibleGuardianId ?? null,
    iprRequerido: Boolean(fila.iprRequired),
    extraccionesIndicadas: [...(fila.extractionsTeethFdi ?? [])],
    detalle: detalle ?? planDetalleVacio(),
  };
}

export type ResultadoDeGuardarPlanCompleto = ResultadoDeAplicar;

/** Lo que se guarda: el mismo objeto que devuelve `leerPlanCompleto`, con lo que se quiere cambiar. */
export type PlanCompletoAGuardar = Omit<PlanCompleto, "detalle"> & { detalle: unknown };

/**
 * Guarda el plan completo de un caso. El plan se valida en el servidor (`validarPlanDetalle`); el doctor y el
 * responsable tienen que ser de esta clínica (y el responsable, de este paciente). Las columnas de siempre se
 * actualizan y el plan completo se guarda con sus derivados (TADs, anclaje general, prescripción, alineadores) en su
 * propia transacción. Nunca escribe sin `clinicId`. Devuelve el motivo si no se pudo.
 */
export async function guardarPlanCompleto(args: {
  ctx: { clinicId: string; userId: string };
  plan: PlanCompletoAGuardar;
  /** Para la frase de Movimientos: «Completó» (el plan nace) o «Actualizó». */
  creado?: boolean;
}): Promise<ResultadoDeGuardarPlanCompleto> {
  const { ctx, plan } = args;
  if (!ctx.clinicId || !ctx.userId || !plan.treatmentPlanId || !plan.patientId) return { ok: false, error: "Sesión sin clínica" };

  const validado = validarPlanDetalle(plan.detalle);
  if (validado.ok === false) return { ok: false, error: validado.error };
  if (!Number.isInteger(plan.duracionMeses) || plan.duracionMeses < 3 || plan.duracionMeses > 60) return { ok: false, error: "Tiempo de tratamiento: de 3 a 60 meses." };

  const antes = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: plan.treatmentPlanId, clinicId: ctx.clinicId, patientId: plan.patientId, deletedAt: null },
    select: { technique: true, treatingDoctorId: true, responsibleGuardianId: true },
  });
  if (!antes) return { ok: false, error: "Plan no encontrado" };

  const ajena = await validarPersonasDelCaso({
    clinicId: ctx.clinicId,
    patientId: plan.patientId,
    pedidas: { treatingDoctorId: plan.doctorId ?? undefined, responsibleGuardianId: plan.responsableId ?? undefined },
    actuales: { treatingDoctorId: antes.treatingDoctorId, responsibleGuardianId: antes.responsibleGuardianId },
  });
  if (ajena) return { ok: false, error: ajena };

  // La técnica primero: la aparatología del plan se valida contra ELLA.
  await prisma.orthodonticTreatmentPlan.updateMany({
    where: { id: plan.treatmentPlanId, clinicId: ctx.clinicId },
    data: {
      technique: plan.tecnica as never,
      treatmentObjectives: plan.objetivos as never,
      retentionPlanText: plan.retencion,
      iprRequired: plan.iprRequerido,
      treatingDoctorId: plan.doctorId,
      responsibleGuardianId: plan.responsableId,
    },
  });
  await guardarNombreDeTecnicaDelCaso(ctx.clinicId, plan.treatmentPlanId, plan.tecnicaNombrePropio);

  const r = await aplicarPlanDetalle({
    ctx,
    treatmentPlanId: plan.treatmentPlanId,
    patientId: plan.patientId,
    plan: validado.plan,
    extraccionesIndicadas: plan.extraccionesIndicadas,
    duracionMeses: plan.duracionMeses,
    creado: args.creado,
  });
  if (r.ok === false) return r;

  if (antes.technique !== plan.tecnica || antes.treatingDoctorId !== plan.doctorId) {
    await registrarMovimientoDelPaciente({
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      patientId: plan.patientId,
      entityType: "orthodontic-plan",
      entityId: plan.treatmentPlanId,
      action: "update",
      texto: "Actualizó la técnica o el doctor del caso de ortodoncia",
      campos: [...(antes.technique !== plan.tecnica ? ["technique"] : []), ...(antes.treatingDoctorId !== plan.doctorId ? ["treatingDoctorId"] : [])],
    });
  }
  return r;
}

/**
 * Lo que la ventana del caso (`DrawerNewCase`, `modo="editar"`) pide como `vista`, armado a partir de un plan
 * completo (el actual o una versión archivada). Con ella la ventana sale PRECARGADA; lo demás (TADs registrados,
 * factura, controles hechos) es del caso vivo y lo pone quien abre la ventana.
 */
export function vistaDeUnPlanCompleto(
  p: PlanCompleto,
  extra: {
    columna?: boolean;
    anchorageType?: string | null;
    tads?: number;
    controlesHechos?: number;
    conSeguimientoDeAlineadores?: boolean;
    billingMode?: "PRECIO_TOTAL" | "PAGO_POR_CONTROL";
    factura?: { id: string; total: number; pagado: number } | null;
    colocadoEl?: string | null;
    costoReferencia?: number;
  } = {},
): import("./plan-detalle").PlanDeTratamientoVista {
  return {
    treatmentPlanId: p.treatmentPlanId,
    detalle: p.detalle,
    columna: extra.columna ?? true,
    duracionMeses: p.duracionMeses,
    anchorageType: extra.anchorageType ?? null,
    extraccionesRequired: p.extraccionesIndicadas.length > 0,
    extraccionesIndicadas: p.extraccionesIndicadas,
    tads: extra.tads ?? 0,
    controlesHechos: extra.controlesHechos ?? 0,
    conSeguimientoDeAlineadores: extra.conSeguimientoDeAlineadores ?? false,
    reevaluaciones: [],
    caso: {
      tecnica: p.tecnica,
      tecnicaNombrePropio: p.tecnicaNombrePropio,
      tecnicaVisible: nombreDeTecnica(p.tecnica, p.tecnicaNombrePropio),
      objetivos: p.objetivos,
      retencion: p.retencion,
      doctorId: p.doctorId,
      responsableId: p.responsableId,
      colocadoEl: extra.colocadoEl ?? null,
      costoReferencia: extra.costoReferencia ?? 0,
      iprRequerido: p.iprRequerido,
      billingMode: extra.billingMode ?? "PRECIO_TOTAL",
      factura: extra.factura ?? null,
    },
  };
}
