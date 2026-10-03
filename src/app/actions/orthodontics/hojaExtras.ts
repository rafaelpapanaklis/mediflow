"use server";
// Ortodoncia — lo nuevo de la hoja de control (ws1-t9, auditoría BEVADENT, M1-M4): lo que el cajón necesita al abrirse
// (qué partes tienen ya su SQL, los catálogos de la clínica, las ligas de esta hoja o las del control anterior, el
// arco inferior y las mecánicas del caso), el alta y el retiro de mecánicas auxiliares (desde la hoja y desde el
// caso) y el historial de ligas del caso.
//
// Mismos candados que la hoja: módulo activo, permiso clínico (ver = medicalRecord.view, cambiar = medicalRecord.edit),
// el caso de la clínica de la sesión y un paciente que la sesión puede ver. El `clinicId` nunca viene del cliente.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { idDeLaBase } from "@/lib/validation/id";
import { auditOrtho, getOrthoActionContext, loadPatientForOrtho } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";
import {
  crearMecanica,
  leerArcosInferiores,
  leerCatalogosDeHoja,
  leerLigasDeHojas,
  listarMecanicasDelCaso,
  partesDeHojaExtras,
  retirarMecanica,
  type PartesDeHojaExtras,
} from "@/lib/orthodontics/hoja-extras-db";
import type { CatalogosDeHoja } from "@/lib/orthodontics/hoja-catalogos";
import {
  historialDeLigas,
  validarAltaDeMecanica,
  type LigaDeHoja,
  type LigasDeUnControl,
  type MecanicaDelCaso,
} from "@/lib/orthodontics/hoja-extras";
import type { AuthContext } from "@/lib/auth-context";
import { puedeClinico } from "@/lib/auth/guardia-clinica";

async function cargarCaso(ctx: AuthContext, treatmentPlanId: string) {
  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, clinicId: true, patientId: true },
  });
  if (!plan) return fail("Caso no encontrado");
  const visible = await loadPatientForOrtho({ ctx, patientId: plan.patientId });
  if (isFailure(visible)) return visible;
  return ok(plan);
}

/** Una hoja de ESTE caso (o null si no se pidió ninguna). */
async function hojaDelCaso(planId: string, clinicId: string, cardId: string | null | undefined) {
  if (!cardId) return null;
  return prisma.orthoTreatmentCard.findFirst({
    where: { id: cardId, treatmentPlanId: planId, clinicId, deletedAt: null },
    select: { id: true, status: true, visitDate: true },
  });
}

export interface ExtrasDeHoja {
  partes: PartesDeHojaExtras;
  /** La sesión puede dar de alta o retirar mecánicas (medicalRecord.edit). */
  puedeEditar: boolean;
  catalogos: CatalogosDeHoja;
  /** Las ligas guardadas en ESTA hoja (null = hoja nueva o sin cardId). */
  ligasDeLaHoja: LigaDeHoja[] | null;
  /** Las de la última hoja FIRMADA del caso (que no sea esta): lo que hereda una hoja nueva. */
  ligasDelAnterior: LigaDeHoja[];
  /** El arco nuevo inferior guardado en ESTA hoja. */
  wireToLowerId: string | null;
  mecanicas: MecanicaDelCaso[];
}

const cargarSchema = z.object({ treatmentPlanId: idDeLaBase(), cardId: idDeLaBase().nullable().optional() });

export async function cargarExtrasDeHoja(input: unknown): Promise<ActionResult<ExtrasDeHoja>> {
  const auth = await getOrthoActionContext({ write: false });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;
  const parsed = cargarSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const caso = await cargarCaso(ctx, parsed.data.treatmentPlanId);
  if (isFailure(caso)) return caso;
  const plan = caso.data;

  const partes = await partesDeHojaExtras();
  const [hoja, catalogos, anterior] = await Promise.all([
    hojaDelCaso(plan.id, ctx.clinicId, parsed.data.cardId),
    leerCatalogosDeHoja(ctx.clinicId),
    partes.ligas
      ? prisma.orthoTreatmentCard.findFirst({
          where: {
            treatmentPlanId: plan.id,
            clinicId: ctx.clinicId,
            deletedAt: null,
            status: "SIGNED",
            ...(parsed.data.cardId ? { id: { not: parsed.data.cardId } } : {}),
          },
          orderBy: [{ visitDate: "desc" }, { cardNumber: "desc" }],
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);
  if (parsed.data.cardId && !hoja) return fail("Hoja de control no encontrada");

  const idsDeLigas = [hoja?.id, anterior?.id].filter((x): x is string => Boolean(x));
  const [ligas, inferiores, mecanicas] = await Promise.all([
    leerLigasDeHojas(ctx.clinicId, idsDeLigas),
    hoja ? leerArcosInferiores(ctx.clinicId, [hoja.id]) : Promise.resolve(new Map<string, string>()),
    listarMecanicasDelCaso(ctx.clinicId, plan.id),
  ]);

  return ok({
    partes,
    puedeEditar: puedeClinico(ctx, "editar"),
    catalogos: catalogos.catalogos,
    ligasDeLaHoja: hoja && partes.ligas ? (ligas.get(hoja.id) ?? []) : null,
    ligasDelAnterior: anterior ? (ligas.get(anterior.id) ?? []) : [],
    wireToLowerId: hoja ? (inferiores.get(hoja.id) ?? null) : null,
    mecanicas,
  });
}

const altaSchema = z.object({
  treatmentPlanId: idDeLaBase(),
  /** La hoja desde la que se da de alta (si ya está guardada). */
  cardId: idDeLaBase().nullable().optional(),
  tipo: z.string().min(1).max(80),
  arcada: z.enum(["SUPERIOR", "INFERIOR", "AMBAS"]).nullable().optional(),
  ubicacion: z.string().max(200).nullable().optional(),
  nota: z.string().max(2000).nullable().optional(),
  colocadaEl: z.string().max(40).nullable().optional(),
});

export async function agregarMecanicaAction(input: unknown): Promise<ActionResult<{ mecanica: MecanicaDelCaso }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;
  const parsed = altaSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");
  const caso = await cargarCaso(ctx, parsed.data.treatmentPlanId);
  if (isFailure(caso)) return caso;
  const plan = caso.data;
  if (!(await partesDeHojaExtras()).mecanicas) {
    return fail("Las mecánicas auxiliares aún no están disponibles: falta aplicar sql/ws1-t9-hoja-ligas-mecanicas-catalogos.sql.");
  }
  const hoja = await hojaDelCaso(plan.id, ctx.clinicId, parsed.data.cardId);
  if (parsed.data.cardId && !hoja) return fail("Hoja de control no encontrada");

  const v = validarAltaDeMecanica(parsed.data, new Date());
  if (!v.ok) return fail(v.error);
  try {
    const mecanica = await crearMecanica({ clinicId: ctx.clinicId, patientId: plan.patientId, planId: plan.id, userId: ctx.userId, cardId: hoja?.id ?? null, alta: v.alta });
    if (!mecanica) return fail("No se pudo registrar la mecánica.");
    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.AUX_DEVICE_ADDED,
      entityType: "OrthoAuxDevice",
      entityId: mecanica.id,
      patientId: plan.patientId,
      after: { tipo: mecanica.tipo, arcada: mecanica.arcada, ubicacion: mecanica.ubicacion, colocadaEl: mecanica.colocadaEl, cardId: hoja?.id ?? null },
    });
    revalidatePath(`/dashboard/patients/${plan.patientId}`);
    return ok({ mecanica });
  } catch (e) {
    console.error("[ortho] agregarMecanicaAction:", e);
    return fail("No se pudo registrar la mecánica.");
  }
}

const retiroSchema = z.object({
  treatmentPlanId: idDeLaBase(),
  id: z.string().uuid(),
  cardId: idDeLaBase().nullable().optional(),
  fecha: z.string().max(40).nullable().optional(),
});

export async function retirarMecanicaAction(input: unknown): Promise<ActionResult<{ mecanica: MecanicaDelCaso }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;
  const parsed = retiroSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const caso = await cargarCaso(ctx, parsed.data.treatmentPlanId);
  if (isFailure(caso)) return caso;
  const plan = caso.data;
  if (!(await partesDeHojaExtras()).mecanicas) return fail("Las mecánicas auxiliares aún no están disponibles.");
  const hoja = await hojaDelCaso(plan.id, ctx.clinicId, parsed.data.cardId);
  if (parsed.data.cardId && !hoja) return fail("Hoja de control no encontrada");
  const ahora = new Date();
  const fecha = parsed.data.fecha ? new Date(parsed.data.fecha) : ahora;
  if (Number.isNaN(fecha.getTime()) || fecha.getTime() > ahora.getTime() + 36 * 3600 * 1000) return fail("Fecha de retiro no válida.");
  try {
    const mecanica = await retirarMecanica({ clinicId: ctx.clinicId, planId: plan.id, id: parsed.data.id, userId: ctx.userId, cardId: hoja?.id ?? null, fecha });
    if (!mecanica) return fail("Esa mecánica ya estaba retirada o no es de este caso.");
    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.AUX_DEVICE_REMOVED,
      entityType: "OrthoAuxDevice",
      entityId: mecanica.id,
      patientId: plan.patientId,
      before: { retiradaEl: null },
      after: { retiradaEl: mecanica.retiradaEl, tipo: mecanica.tipo, cardId: hoja?.id ?? null },
    });
    revalidatePath(`/dashboard/patients/${plan.patientId}`);
    return ok({ mecanica });
  } catch (e) {
    console.error("[ortho] retirarMecanicaAction:", e);
    return fail("No se pudo retirar la mecánica.");
  }
}

const historialSchema = z.object({ treatmentPlanId: idDeLaBase() });

/** Las ligas de cada control del caso (borradores incluidos), del más reciente al más viejo. */
export async function historialDeLigasAction(input: unknown): Promise<ActionResult<{ disponible: boolean; controles: LigasDeUnControl[] }>> {
  const auth = await getOrthoActionContext({ write: false });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;
  const parsed = historialSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const caso = await cargarCaso(ctx, parsed.data.treatmentPlanId);
  if (isFailure(caso)) return caso;
  if (!(await partesDeHojaExtras()).ligas) return ok({ disponible: false, controles: [] });
  const hojas = await prisma.orthoTreatmentCard.findMany({
    where: { treatmentPlanId: caso.data.id, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, cardNumber: true, visitDate: true, status: true },
    orderBy: { visitDate: "desc" },
    take: 200,
  });
  const ligas = await leerLigasDeHojas(ctx.clinicId, hojas.map((h) => h.id));
  return ok({
    disponible: true,
    controles: historialDeLigas(
      hojas.map((h) => ({ cardId: h.id, cardNumber: h.cardNumber, visitDate: h.visitDate.toISOString(), firmada: h.status === "SIGNED", ligas: ligas.get(h.id) ?? [] })),
    ),
  });
}

/** Las mecánicas del caso, para la ficha. */
export async function mecanicasDelCasoAction(input: unknown): Promise<ActionResult<{ disponible: boolean; puedeEditar: boolean; mecanicas: MecanicaDelCaso[]; catalogo: string[] }>> {
  const auth = await getOrthoActionContext({ write: false });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;
  const parsed = historialSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const caso = await cargarCaso(ctx, parsed.data.treatmentPlanId);
  if (isFailure(caso)) return caso;
  const partes = await partesDeHojaExtras();
  if (!partes.mecanicas) return ok({ disponible: false, puedeEditar: false, mecanicas: [], catalogo: [] });
  const [mecanicas, catalogos] = await Promise.all([listarMecanicasDelCaso(ctx.clinicId, caso.data.id), leerCatalogosDeHoja(ctx.clinicId)]);
  return ok({ disponible: true, puedeEditar: puedeClinico(ctx, "editar"), mecanicas, catalogo: catalogos.catalogos.mecanicas.filter((m) => m.activa).map((m) => m.nombre) });
}
