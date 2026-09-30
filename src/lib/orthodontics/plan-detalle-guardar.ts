import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canSeePatient } from "@/lib/patient-visibility";
import { registrarMovimientoDelPaciente } from "@/lib/movimientos-paciente/registrar";
import { actualizarPlanDetalle, cargarPlanDetalle, leerOpcionesDelPlan } from "./plan-detalle-db";
import {
  anclajeGeneralDerivado,
  cambiosDelPlan,
  esFdiValido,
  ordenarFdi,
  prescripcionDerivada,
  tadsRequeridos,
  textoDeMovimientoDelPlan,
  validarContraOpciones,
  validarContraTecnica,
  validarPlanDetalle,
  type CambiosDelPlan,
  type PlanDetalle,
} from "./plan-detalle";

// Ortodoncia — guardar el «Plan de tratamiento» completo de un caso (ws1-t12). Lo usan la acción de «Editar
// plan» y el alta del caso; el permiso, el paciente y las listas de la clínica ya los comprobó quien llama.
// `clinicId` y `userId` SIEMPRE de la sesión.
//
// Un solo dato en un solo sitio:
//  · ALINEADORES TOTALES: si el caso ya tiene seguimiento de alineadores, manda
//    `orthodontic_aligners.totalTrays` (aquí se actualiza) y en el plan queda null; si no lo tiene, va en el plan.
//  · EXTRACCIONES INDICADAS, TADs y ANCLAJE GENERAL siguen en sus columnas de siempre: se derivan al guardar
//    (`extractionsTeethFdi`, `tadsRequired`, `anchorageType`) para no romper ninguna lectura existente.
//
// Todo va en UNA transacción (candado de fila sobre el plan): o se guarda todo o nada.

export interface AplicarPlanArgs {
  ctx: { clinicId: string; userId: string };
  treatmentPlanId: string;
  patientId: string;
  /** Ya validado con `validarPlanDetalle`. */
  plan: PlanDetalle;
  /** Las indicadas; undefined = no tocarlas. */
  extraccionesIndicadas?: number[];
  /** Duración estimada en meses; undefined = no tocarla. */
  duracionMeses?: number;
  /** El plan se completa al abrir el caso (la frase de Movimientos cambia). */
  creado?: boolean;
  /**
   * Algo más que tiene que quedar o deshacerse JUNTO con el plan (p. ej. el diagnóstico, en el «Guardar» único de la
   * ventana del caso): corre dentro de la misma transacción; si lanza, no se guarda nada.
   */
  enLaTransaccion?: (tx: Prisma.TransactionClient) => Promise<void>;
}

export type ResultadoDeAplicar =
  | { ok: true; cambios: CambiosDelPlan }
  | { ok: false; error: string };

export const MENSAJE_SIN_SQL = "Falta pegar sql/ortodoncia-plan-de-tratamiento.sql: el plan de tratamiento no se guardó.";

function esRelacionAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

export async function aplicarPlanDetalle(args: AplicarPlanArgs): Promise<ResultadoDeAplicar> {
  const { ctx, treatmentPlanId, patientId, plan } = args;
  // `clinicId: undefined` en Prisma NO filtra: sin clínica no se consulta ni se escribe nada.
  if (!ctx.clinicId || !ctx.userId || !treatmentPlanId || !patientId) return { ok: false, error: "Sesión sin clínica" };

  const antesCols = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: treatmentPlanId, clinicId: ctx.clinicId, patientId, deletedAt: null },
    select: {
      estimatedDurationMonths: true, extractionsTeethFdi: true, extractionsRequired: true, tadsRequired: true, anchorageType: true,
      technique: true, prescriptionSlot: true, bondingType: true,
    },
  });
  if (!antesCols) return { ok: false, error: "Plan no encontrado" };

  // La aparatología tiene que cuadrar con la técnica del caso (alineadores solo con alineadores o mixta…).
  const incompatible = validarContraTecnica(plan, antesCols.technique);
  if (incompatible) return { ok: false, error: incompatible };

  // Los TAD que el caso ya tiene registrados: junto con «Aditamentos» deciden `tadsRequired`.
  const tadsRegistrados = await prisma.orthoTAD.count({ where: { treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null } }).catch(() => 0);

  // El seguimiento de alineadores del caso, si existe (la tabla puede faltar en esta base).
  let aligner: { id: string; totalTrays: number; currentTray: number } | null = null;
  try {
    aligner = await prisma.orthodonticAligner.findFirst({
      where: { treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
      select: { id: true, totalTrays: true, currentTray: true },
    });
  } catch (e) {
    if (!esRelacionAusente(e)) throw e;
  }
  if (aligner) {
    if (plan.alineadoresTotales === null) {
      return { ok: false, error: "Este caso ya tiene seguimiento de alineadores: el total de alineadores no se puede dejar vacío (es el mismo dato)." };
    }
    if (plan.alineadoresTotales < aligner.currentTray) {
      return { ok: false, error: `El paciente va en el alineador ${aligner.currentTray}: el total no puede ser menor.` };
    }
  }

  const anclajeNuevo = anclajeGeneralDerivado(plan.anclajeSuperior, plan.anclajeInferior);
  const indicadas = args.extraccionesIndicadas ? ordenarFdi(args.extraccionesIndicadas) : undefined;

  const r = await actualizarPlanDetalle(
    ctx.clinicId,
    treatmentPlanId,
    // Con seguimiento, el total vive allá: aquí no se duplica.
    () => ({ ...plan, alineadoresTotales: aligner ? null : plan.alineadoresTotales }),
    async (tx) => {
      if (aligner && plan.alineadoresTotales !== null && plan.alineadoresTotales !== aligner.totalTrays) {
        await tx.orthodonticAligner.updateMany({
          where: { id: aligner.id, clinicId: ctx.clinicId },
          data: { totalTrays: plan.alineadoresTotales },
        });
      }
      const datos: Record<string, unknown> = {};
      if (indicadas) {
        datos.extractionsTeethFdi = indicadas;
        datos.extractionsRequired = indicadas.length > 0;
      }
      if (args.duracionMeses !== undefined && args.duracionMeses !== antesCols.estimatedDurationMonths) datos.estimatedDurationMonths = args.duracionMeses;
      // «Requiere TADs» NO es una casilla aparte: sale de Aditamentos (microtornillos / miniplacas) y de los TAD registrados.
      const pideTads = tadsRequeridos(plan.aditamentos, tadsRegistrados);
      if (pideTads !== antesCols.tadsRequired) datos.tadsRequired = pideTads;
      if (anclajeNuevo && anclajeNuevo !== antesCols.anchorageType) datos.anchorageType = anclajeNuevo;
      // La prescripción y el cementado generales salen de tubos, bandas y cementación (si se pueden deducir).
      const pres = prescripcionDerivada(plan);
      if (pres.prescriptionSlot && pres.prescriptionSlot !== antesCols.prescriptionSlot) datos.prescriptionSlot = pres.prescriptionSlot;
      if (pres.bondingType && pres.bondingType !== antesCols.bondingType) datos.bondingType = pres.bondingType;
      if (Object.keys(datos).length > 0) {
        await tx.orthodonticTreatmentPlan.updateMany({ where: { id: treatmentPlanId, clinicId: ctx.clinicId }, data: datos });
      }
      if (args.enLaTransaccion) await args.enLaTransaccion(tx);
    },
  );
  if (r.ok === false) {
    if (r.motivo === "sin-columna") return { ok: false, error: MENSAJE_SIN_SQL };
    if (r.motivo === "sin-caso") return { ok: false, error: "Plan no encontrado" };
    if (r.motivo === "invalido") return { ok: false, error: r.mensaje };
    return { ok: false, error: "No se pudo guardar el plan de tratamiento" };
  }

  const antesFusionado: PlanDetalle = { ...r.antes, alineadoresTotales: aligner ? aligner.totalTrays : r.antes.alineadoresTotales };
  const despuesFusionado: PlanDetalle = { ...r.despues, alineadoresTotales: aligner ? plan.alineadoresTotales : r.despues.alineadoresTotales };
  const cambios = cambiosDelPlan(
    { detalle: antesFusionado, duracionMeses: antesCols.estimatedDurationMonths, extraccionesIndicadas: antesCols.extractionsTeethFdi },
    {
      detalle: despuesFusionado,
      duracionMeses: args.duracionMeses ?? antesCols.estimatedDurationMonths,
      extraccionesIndicadas: indicadas ?? antesCols.extractionsTeethFdi,
    },
  );

  // Movimientos del paciente: qué secciones cambiaron, sin datos clínicos en la frase.
  if (cambios.campos.length > 0) {
    await registrarMovimientoDelPaciente({
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      patientId,
      entityType: "orthodontic-plan",
      entityId: treatmentPlanId,
      action: "update",
      texto: textoDeMovimientoDelPlan(cambios.secciones, args.creado === true),
      campos: cambios.campos,
      cambios: cambios.cambios,
    });
  }
  return { ok: true, cambios };
}

export interface PlanPreparado {
  caso: { id: string; patientId: string; diagnosisId: string };
  plan: PlanDetalle;
  extraccionesIndicadas: number[] | undefined;
  duracionMeses: number | undefined;
}

/**
 * Valida TODO lo del «Editar plan» SIN escribir: la forma y los rangos del plan, las piezas FDI, la duración, que el
 * caso sea de esta clínica y su paciente visible para quien guarda, y que lo que se AGREGA siga ofreciéndose (lo que
 * el caso ya tenía se conserva). La usan `guardarPlanDeTratamiento` y el «Guardar» único de diagnóstico + plan.
 */
export async function prepararGuardadoDelPlan(
  ctx: { clinicId: string; userId: string; role: string },
  input: unknown,
): Promise<{ ok: true; preparado: PlanPreparado } | { ok: false; error: string }> {
  if (!ctx.clinicId) return { ok: false, error: "No se pudo identificar tu clínica" };
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const treatmentPlanId = typeof o.treatmentPlanId === "string" ? o.treatmentPlanId : "";
  if (!treatmentPlanId) return { ok: false, error: "Falta el caso" };

  const validado = validarPlanDetalle(o.plan);
  if (validado.ok === false) return { ok: false, error: validado.error };

  let indicadas: number[] | undefined;
  if (o.extraccionesIndicadas !== undefined && o.extraccionesIndicadas !== null) {
    if (!Array.isArray(o.extraccionesIndicadas) || o.extraccionesIndicadas.some((x) => !esFdiValido(x))) {
      return { ok: false, error: "Extracciones indicadas: usa piezas válidas en notación FDI (por ejemplo 14, 24)." };
    }
    indicadas = o.extraccionesIndicadas as number[];
  }
  let duracionMeses: number | undefined;
  if (o.duracionMeses !== undefined && o.duracionMeses !== null && o.duracionMeses !== "") {
    const n = Number(o.duracionMeses);
    if (!Number.isInteger(n) || n < 3 || n > 60) return { ok: false, error: "Tiempo de tratamiento: de 3 a 60 meses." };
    duracionMeses = n;
  }

  // El caso es de ESTA clínica y el paciente lo puede ver quien pregunta (mismo criterio que Cobro).
  const caso = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, patientId: true, diagnosisId: true, patient: { select: { visibleUserIds: true } } },
  });
  if (!caso) return { ok: false, error: "Caso no encontrado" };
  if (!canSeePatient({ userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId }, caso.patient?.visibleUserIds)) {
    return { ok: false, error: "Caso no encontrado" };
  }

  // Lo que se AGREGA tiene que seguir ofreciéndose; lo que el caso ya tenía se conserva.
  const [anterior, opciones] = await Promise.all([cargarPlanDetalle(ctx.clinicId, caso.id), leerOpcionesDelPlan(ctx.clinicId)]);
  const fuera = validarContraOpciones(validado.plan, anterior, opciones.opciones);
  if (fuera) return { ok: false, error: fuera };

  return {
    ok: true,
    preparado: {
      caso: { id: caso.id, patientId: caso.patientId, diagnosisId: caso.diagnosisId },
      plan: validado.plan,
      extraccionesIndicadas: indicadas,
      duracionMeses,
    },
  };
}

/**
 * Marca extracciones como realizadas desde OTRO lugar (la hoja de control): une las piezas a las que el plan
 * ya tenía. Solo piezas que el plan tiene como indicadas o que ya estaban marcadas; sin la columna del plan
 * (SQL sin pegar) no hace nada y lo dice. Registra su movimiento.
 */
export async function marcarExtraccionesDesdeLaHoja(args: {
  ctx: { clinicId: string; userId: string };
  treatmentPlanId: string;
  patientId: string;
  piezas: number[];
}): Promise<{ ok: true; marcadas: number[] } | { ok: false; error: string }> {
  const { ctx, treatmentPlanId, patientId } = args;
  if (!ctx.clinicId || !ctx.userId || !treatmentPlanId || !patientId) return { ok: false, error: "Sesión sin clínica" };
  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: treatmentPlanId, clinicId: ctx.clinicId, patientId, deletedAt: null },
    select: { extractionsTeethFdi: true },
  });
  if (!plan) return { ok: false, error: "Plan no encontrado" };
  const validas = ordenarFdi(args.piezas).filter((p) => plan.extractionsTeethFdi.includes(p));
  if (validas.length === 0) return { ok: true, marcadas: [] };

  let nuevas: number[] = [];
  const r = await actualizarPlanDetalle(ctx.clinicId, treatmentPlanId, (actual) => {
    const ya = new Set(actual.extraccionesRealizadas);
    nuevas = validas.filter((p) => !ya.has(p));
    return { ...actual, extraccionesRealizadas: ordenarFdi([...actual.extraccionesRealizadas, ...validas]) };
  });
  if (r.ok === false) {
    if (r.motivo === "sin-columna") return { ok: false, error: MENSAJE_SIN_SQL };
    if (r.motivo === "invalido") return { ok: false, error: r.mensaje };
    return { ok: false, error: "No se pudieron marcar las extracciones" };
  }
  if (nuevas.length > 0) {
    await registrarMovimientoDelPaciente({
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      patientId,
      entityType: "orthodontic-plan",
      entityId: treatmentPlanId,
      action: "update",
      texto: "Marcó extracciones como realizadas en el plan de tratamiento de ortodoncia",
      campos: ["extraccionesRealizadas"],
      cambios: { extraccionesRealizadas: { before: r.antes.extraccionesRealizadas, after: r.despues.extraccionesRealizadas } },
    });
  }
  return { ok: true, marcadas: nuevas };
}

