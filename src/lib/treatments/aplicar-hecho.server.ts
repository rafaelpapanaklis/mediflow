// «Hecho» → odontograma, con deshacer y bitácora (ws1-t5 · P7 de la fase 2; decisión 3 de Rafael:
// marcar «hecho» actualiza SOLO el odontograma — no crea cobros).
//
// `PATCH /api/treatments/[id]` con `{ action: "marcar_hecho", itemIds | itemId, citaId? }` pasa las
// filas del plan a «hecho» (quién, cuándo, cita) y escribe en el odontograma lo que dice
// `aplicarHecho` (resina sobre la caries, conducto, corona, implante, extracción → ausente).
// `{ action: "deshacer_hecho", itemId }` lo regresa: la fila a como estaba (pendiente o en curso) y
// el odontograma con `planearDeshacer`, que no pisa lo que se cambió después.
//
// Lo escrito se guarda en `treatment_plan_items."odontogramaHecho"` (sql/plan-hecho-odontograma.sql):
// es lo que hace exacto el deshacer y lo que `findPreviousSnapshot` (snapshot.ts) se salta para que
// «Tratamientos detectados» NUNCA vuelva a proponer cobrar lo que ya cobra la nota del plan. SIN esa
// columna, «hecho» marca la fila y NO toca el odontograma (sin dónde guardar el deshacer, no se
// escribe nada que no se pueda deshacer ni saltar al cobrar).
//
// Todo por `clinicId` de la sesión; el paciente sale del plan (que ya es de la clínica). SQL crudo,
// como items-db.ts, con el plan bloqueado (FOR UPDATE) mientras se escribe.

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logMutation } from "@/lib/audit";
import { getDict } from "@/i18n/dictionaries";
import { makeT } from "@/i18n/t";
import { revalidateAfter, revalidatePatientProfile } from "@/lib/cache/revalidate";
import { puedeEscribirOdontograma } from "@/lib/odontogram/api-auth";
import {
  aplicarHecho,
  planearDeshacer,
  type CaraBase,
  type ConflictoDeshacer,
  type EntradaConId,
  type EntradaOdontograma,
  type SinCambio,
} from "@/lib/odontogram/aplicar-hecho";
import { CONDITIONS } from "@/components/dashboard/odontogram-v2/data";
import { filaDto, type DbDeFilas, type EstadoDeFila, type FilaDelPlan } from "./items";
import { bloquearPlan, FilaError, repoFilas, tablaDeFilasExiste } from "./items-db";
import { columnaOdontogramaHechoExiste, leerRegistro, type RegistroHecho } from "./aplicar-hecho-db";
import { CODIGOS_DE_HECHO, ESTADOS_DE_PLAN_SIN_HECHO } from "./marcar-hecho-cliente";
import { limpiarMotivoSinCita } from "./cita-del-hecho";
import { citasConNota } from "./cita-del-hecho.server";

const NOTA = "__note__";
/** Tope de filas por clic (un plan real marca 1–6 a la vez). */
export const MAX_FILAS_POR_HECHO = 30;

// ── El odontograma, en SQL crudo y dentro de la transacción ────────────────────────────────────

interface EntradaSql { id: string; toothNumber: number; surface: string | null; conditionId: string; notes: string | null }

async function leerOdontograma(db: DbDeFilas, patientId: string): Promise<EntradaConId[]> {
  const filas = await db.$queryRaw<EntradaSql[]>`
    SELECT "id", "toothNumber", "surface", "conditionId", "notes" FROM "odontogram_entries"
     WHERE "patientId" = ${patientId} AND "conditionId" <> ${NOTA}`;
  return filas.map((f) => ({
    id: f.id,
    toothNumber: Number(f.toothNumber),
    surface: (f.surface ?? null) as CaraBase | null,
    conditionId: f.conditionId,
    notes: f.notes ?? null,
  }));
}

/** Quita esas entradas (por id y del paciente) y devuelve los ids que de verdad quitó. */
async function quitarEntradas(db: DbDeFilas, patientId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const r = await db.$queryRaw<{ id: string }[]>`
    DELETE FROM "odontogram_entries" WHERE "patientId" = ${patientId} AND "id" IN (${Prisma.join(ids)})
    RETURNING "id"`;
  return new Set(r.map((x) => x.id));
}

/**
 * Un «hecho» o un «deshacer» a la vez por paciente (dos planes del mismo paciente, dos pestañas): así
 * nadie lee el odontograma mientras otro lo está cambiando desde el plan.
 */
async function candadoDelPaciente(db: DbDeFilas, patientId: string): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`odontogram-hecho:${patientId}`}))`;
}

/**
 * Pone una entrada si no está. Devuelve su id solo si la creó ESTA llamada (lo que ya estaba —o lo
 * que otra pestaña puso en ese instante— no es de «hecho» y su deshacer no lo quita).
 * Diente completo (surface NULL): la unique no lo cubre → mismo candado que /api/odontogram/sync.
 */
async function ponerEntrada(db: DbDeFilas, patientId: string, e: EntradaOdontograma): Promise<string | null> {
  const id = randomUUID();
  if (e.surface === null) {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`odontogram:${patientId}:${e.toothNumber}:${e.conditionId}`}))`;
    const ya = await db.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "odontogram_entries"
       WHERE "patientId" = ${patientId} AND "toothNumber" = ${e.toothNumber}::int AND "surface" IS NULL AND "conditionId" = ${e.conditionId}`;
    if (ya.length > 0) return null;
  }
  const r = await db.$queryRaw<{ id: string }[]>`
    INSERT INTO "odontogram_entries" ("id", "patientId", "toothNumber", "surface", "conditionId", "notes", "createdAt", "updatedAt")
    VALUES (${id}, ${patientId}, ${e.toothNumber}::int, ${e.surface}, ${e.conditionId}, ${e.notes ?? null}, now(), now())
    ON CONFLICT DO NOTHING
    RETURNING "id"`;
  return r[0]?.id ?? null;
}

const claveDe = (e: { toothNumber: number; surface: string | null; conditionId: string }) =>
  `${e.toothNumber}:${e.surface ?? "_"}:${e.conditionId}`;

async function guardarRegistro(db: DbDeFilas, clinicId: string, planId: string, filaId: string, r: RegistroHecho): Promise<void> {
  await db.$executeRaw`
    UPDATE "treatment_plan_items" SET "odontogramaHecho" = ${JSON.stringify(r)}::jsonb, "updatedAt" = now()
     WHERE "id" = ${filaId} AND "clinicId" = ${clinicId} AND "planId" = ${planId}`;
}

async function leerRegistroDeFila(db: DbDeFilas, clinicId: string, planId: string, filaId: string): Promise<RegistroHecho | null> {
  const r = await db.$queryRaw<{ odontogramaHecho: unknown }[]>`
    SELECT "odontogramaHecho" FROM "treatment_plan_items"
     WHERE "id" = ${filaId} AND "clinicId" = ${clinicId} AND "planId" = ${planId}`;
  return leerRegistro(r[0]?.odontogramaHecho ?? null);
}

/** Las llaves ODO_* de los procedimientos del tarifario de ESTA clínica. */
async function codigosDelTarifario(db: DbDeFilas, clinicId: string, ids: string[]): Promise<Map<string, string>> {
  const unicos = Array.from(new Set(ids.filter(Boolean)));
  if (unicos.length === 0) return new Map();
  const r = await db.$queryRaw<{ id: string; code: string | null }[]>`
    SELECT "id", "code" FROM "procedure_catalog" WHERE "clinicId" = ${clinicId} AND "id" IN (${Prisma.join(unicos)})`;
  return new Map(r.filter((x) => x.code).map((x) => [x.id, x.code as string]));
}

// ── Marcar hecho ────────────────────────────────────────────────────────────────────────────────

export type EstadoOdontograma =
  | "aplicado"           // se escribió en el odontograma
  | "sin_cambio"         // se sabe qué es y no deja marca, o ya estaba (ver `sinCambio`)
  | "sin_permiso"        // quien marca no puede escribir el odontograma (medicalRecord.edit)
  | "sin_paciente"       // plan sin paciente
  | "pendiente_de_base"  // falta sql/plan-hecho-odontograma.sql: la fila sí, el odontograma no
  | "ya_estaba_hecho";   // la fila ya estaba hecha: no se vuelve a escribir nada

export interface ResultadoDeFila {
  itemId: string;
  estado: EstadoOdontograma;
  sinCambio: SinCambio | null;
  altas: EntradaOdontograma[];
  bajas: EntradaOdontograma[];
}

export interface PlanParaHecho { id: string; clinicId: string; patientId: string | null; name: string }

/**
 * v11 (decisión de Rafael, 27-oct): en un plan CERRADO («Cerrar plan» lo deja Abandonado) no se marca ni
 * se deshace «hecho»: su nota ya quedó en lo hecho y sus filas por hacer se cancelaron. Se lee con el
 * plan ya bloqueado (FOR UPDATE), así que no se cruza con un «Cerrar plan» a la vez.
 */
async function exigirPlanAbierto(tx: DbDeFilas, clinicId: string, planId: string): Promise<void> {
  const r = await tx.$queryRaw<{ status: string }[]>`
    SELECT "status"::text AS "status" FROM "treatment_plans" WHERE "id" = ${planId} AND "clinicId" = ${clinicId}`;
  if (r.length === 1 && ESTADOS_DE_PLAN_SIN_HECHO.includes(String(r[0].status))) throw new FilaError("plan_cerrado");
}

export async function marcarHecho(args: {
  clinicId: string;
  plan: PlanParaHecho;
  userId: string;
  itemIds: string[];
  citaId: string | null;
  /** v17 (decisión 1 de Rafael): «Se hizo sin cita», con su motivo. Queda en el registro de la fila. */
  sinCita?: { motivo: string } | null;
  puedeOdontograma: boolean;
}): Promise<{ filas: FilaDelPlan[]; resultados: ResultadoDeFila[] }> {
  const { clinicId, plan, userId } = args;
  if (!clinicId) throw new Error("plan:hecho: clinicId ausente — se corta antes de consultar");
  const conColumna = await columnaOdontogramaHechoExiste();
  const en = new Date();
  const resultados: ResultadoDeFila[] = [];
  let filas: FilaDelPlan[] = [];

  await prisma.$transaction(async (tx: DbDeFilas) => {
    if (!(await bloquearPlan(tx, clinicId, plan.id))) throw new FilaError("fila_desconocida");
    await exigirPlanAbierto(tx, clinicId, plan.id);
    const todas = await repoFilas.leer(clinicId, plan.id, { conCanceladas: true, db: tx });
    const porId = new Map(todas.map((f) => [f.id, f]));
    for (const id of args.itemIds) {
      const f = porId.get(id);
      if (!f) throw new FilaError("fila_desconocida");
      if (f.estado === "cancelado") throw new FilaError("fila_cancelada");
    }
    const codigos = await codigosDelTarifario(tx, clinicId, args.itemIds.map((id) => porId.get(id)!.procedureId ?? ""));
    // Se lee aunque quien marca no pueda escribirlo: hace falta saber qué CUBRE el procedimiento.
    const leeOdontograma = conColumna && !!plan.patientId;
    if (leeOdontograma) await candadoDelPaciente(tx, plan.patientId!);
    let entradas: EntradaConId[] = leeOdontograma ? await leerOdontograma(tx, plan.patientId!) : [];

    for (const id of args.itemIds) {
      const f = porId.get(id)!;
      if (f.estado === "hecho") {
        resultados.push({ itemId: id, estado: "ya_estaba_hecho", sinCambio: null, altas: [], bajas: [] });
        continue;
      }
      const estadoAntes: RegistroHecho["estadoAntes"] = f.estado === "en_curso" ? "en_curso" : "pendiente";
      await repoFilas.cambiarEstado(tx, { clinicId, planId: plan.id, filaId: id, a: "hecho", userId, citaId: args.citaId, en });
      // «Se hizo sin cita»: la fila no se queda con una cita de antes («Deshacer» la devuelve con `citaAntes`).
      if (args.sinCita && f.citaId) {
        await tx.$executeRaw`
          UPDATE "treatment_plan_items" SET "citaId" = NULL, "updatedAt" = now()
           WHERE "id" = ${id} AND "clinicId" = ${clinicId} AND "planId" = ${plan.id}`;
      }

      const registro: RegistroHecho = {
        v: 1, estadoAntes, citaAntes: f.citaId, en: en.toISOString(), por: userId, patientId: plan.patientId,
        omitido: null, sinCambio: null, altas: [], bajas: [], cubre: [],
        ...(args.sinCita ? { sinCita: args.sinCita } : {}),
      };
      if (!conColumna) {
        resultados.push({ itemId: id, estado: "pendiente_de_base", sinCambio: null, altas: [], bajas: [] });
        continue;
      }
      if (!plan.patientId) {
        registro.omitido = "sin_paciente";
        await guardarRegistro(tx, clinicId, plan.id, id, registro);
        resultados.push({ itemId: id, estado: "sin_paciente", sinCambio: null, altas: [], bajas: [] });
        continue;
      }

      const cambio = aplicarHecho(
        { codigo: f.procedureId ? codigos.get(f.procedureId) ?? null : null, nombre: f.nombre, dientes: f.dientes, caras: f.caras },
        entradas,
      );
      registro.sinCambio = cambio.sinCambio;
      registro.cubre = cambio.objetivo.map((e) => ({ ...e, notes: null }));
      if (!args.puedeOdontograma) {
        // No escribe; lo que el procedimiento cubre queda dicho (si el doctor lo pinta después, no se cobra aparte).
        registro.omitido = "sin_permiso";
        await guardarRegistro(tx, clinicId, plan.id, id, registro);
        resultados.push({ itemId: id, estado: "sin_permiso", sinCambio: null, altas: [], bajas: [] });
        continue;
      }
      if (!cambio.sinCambio) {
        const porClave = new Map(entradas.map((e) => [claveDe(e), e]));
        const quitar = cambio.bajas.map((b) => porClave.get(claveDe(b))).filter((e): e is EntradaConId => !!e);
        const quitadas = await quitarEntradas(tx, plan.patientId, quitar.map((e) => e.id));
        const puestas: EntradaConId[] = [];
        for (const a of cambio.altas) {
          const nuevo = await ponerEntrada(tx, plan.patientId, a);
          if (nuevo) puestas.push({ ...a, notes: null, id: nuevo });
        }
        registro.altas = puestas;
        // Solo lo que de verdad se quitó: así un deshacer no resucita lo que otro ya había quitado.
        registro.bajas = quitar.filter((e) => quitadas.has(e.id)).map(({ id: _id, ...e }) => ({ ...e, notes: e.notes ?? null }));
        entradas = [...entradas.filter((e) => !quitadas.has(e.id)), ...puestas];
      }
      await guardarRegistro(tx, clinicId, plan.id, id, registro);
      resultados.push({
        itemId: id,
        estado: cambio.sinCambio ? "sin_cambio" : "aplicado",
        sinCambio: cambio.sinCambio,
        altas: registro.altas.map(({ id: _id, ...e }) => e),
        bajas: registro.bajas,
      });
    }
    filas = await repoFilas.leer(clinicId, plan.id, { db: tx });
  }, { maxWait: 10_000, timeout: 20_000 });

  return { filas, resultados };
}

// ── Deshacer ────────────────────────────────────────────────────────────────────────────────────

export interface ResultadoDeshacer {
  fila: FilaDelPlan;
  estado: EstadoDeFila;
  quitadas: EntradaOdontograma[];
  devueltas: EntradaOdontograma[];
  conflictos: ConflictoDeshacer[];
}

/**
 * Regresa una fila hecha a como estaba y deshace lo que escribió en el odontograma. Si escribió algo
 * y quien deshace no puede escribir el odontograma, NO se deshace nada (`sin_permiso_odontograma`):
 * una fila pendiente con su resina dibujada se volvería a proponer como «Tratamiento detectado».
 */
export async function deshacerHecho(args: {
  clinicId: string;
  plan: PlanParaHecho;
  userId: string;
  itemId: string;
  puedeOdontograma: boolean;
}): Promise<ResultadoDeshacer> {
  const { clinicId, plan, userId, itemId } = args;
  if (!clinicId) throw new Error("plan:hecho: clinicId ausente — se corta antes de consultar");
  const conColumna = await columnaOdontogramaHechoExiste();
  let out: ResultadoDeshacer | null = null;

  await prisma.$transaction(async (tx: DbDeFilas) => {
    if (!(await bloquearPlan(tx, clinicId, plan.id))) throw new FilaError("fila_desconocida");
    await exigirPlanAbierto(tx, clinicId, plan.id);
    const todas = await repoFilas.leer(clinicId, plan.id, { conCanceladas: true, db: tx });
    const f = todas.find((x) => x.id === itemId);
    if (!f) throw new FilaError("fila_desconocida");
    if (f.estado !== "hecho") throw new FilaError("no_esta_hecha");

    const registro = conColumna ? await leerRegistroDeFila(tx, clinicId, plan.id, itemId) : null;
    const vigente = registro && !registro.deshecho ? registro : null;
    const escribio = !!vigente && (vigente.altas.length > 0 || vigente.bajas.length > 0);
    if (escribio && !args.puedeOdontograma) throw new FilaError("sin_permiso_odontograma");

    let quitadas: EntradaOdontograma[] = [];
    const devueltas: EntradaOdontograma[] = [];
    let conflictos: ConflictoDeshacer[] = [];
    const patientId = vigente?.patientId ?? plan.patientId;
    if (escribio && patientId) {
      await candadoDelPaciente(tx, patientId);
      const plan2 = planearDeshacer(vigente!, await leerOdontograma(tx, patientId));
      const ids = await quitarEntradas(tx, patientId, plan2.borrar.map((e) => e.id));
      for (const e of plan2.crear) {
        // La nota del hallazgo devuelto vuelve con él.
        if (await ponerEntrada(tx, patientId, e)) devueltas.push(e);
      }
      quitadas = plan2.borrar.filter((e) => ids.has(e.id)).map(({ id: _id, ...e }) => e);
      conflictos = plan2.conflictos;
    }
    const estado: EstadoDeFila = vigente?.estadoAntes ?? "pendiente";
    let fila = await repoFilas.cambiarEstado(tx, { clinicId, planId: plan.id, filaId: itemId, a: estado, userId });
    if (vigente) {
      // La fila vuelve con la cita que tenía antes de «hecho» (la que agendó el plan, o ninguna).
      if (fila.citaId !== vigente.citaAntes) {
        await tx.$executeRaw`
          UPDATE "treatment_plan_items" SET "citaId" = ${vigente.citaAntes}, "updatedAt" = now()
           WHERE "id" = ${itemId} AND "clinicId" = ${clinicId} AND "planId" = ${plan.id}`;
        fila = { ...fila, citaId: vigente.citaAntes };
      }
      // Lo devuelto queda dicho: si ya pasó una consulta, no se propone cobrar como trabajo nuevo.
      await guardarRegistro(tx, clinicId, plan.id, itemId, {
        ...vigente,
        deshecho: { en: new Date().toISOString(), por: userId, devueltas, conflictos },
      });
    }
    out = { fila, estado, quitadas, devueltas, conflictos };
  }, { maxWait: 10_000, timeout: 20_000 });

  return out!;
}

// ── La acción HTTP (la llama PATCH /api/treatments/[id]) ───────────────────────────────────────

const CODIGOS_HECHO = CODIGOS_DE_HECHO;
export type CodigoDeHecho = (typeof CODIGOS_HECHO)[number];

export function mensajeDeHecho(codigo: string, locale: "es" | "en" = "es"): string {
  const t = makeT(getDict(locale));
  return (CODIGOS_HECHO as readonly string[]).includes(codigo)
    ? t(`planTratamiento.hecho.error.${codigo}`)
    : t("planTratamiento.hecho.error.generico");
}

const error = (codigo: string, status: number) => NextResponse.json({ error: mensajeDeHecho(codigo), code: codigo }, { status });

/** «Resina 16 (MO)» — la frase de Movimientos, sin datos clínicos de más. */
const nombreDeFila = (f: Pick<FilaDelPlan, "nombre" | "dientes" | "caras">) =>
  `${f.nombre}${f.dientes.length ? ` ${f.dientes.join(",")}` : ""}${f.caras.length ? ` (${f.caras.join("")})` : ""}`;
/** «Caries», «Restauración»… (el nombre del catálogo del odontograma). */
const nombreDeHallazgo = (id: string) => CONDITIONS.find((c) => c.id === id)?.es ?? id;
const marca = (e: EntradaOdontograma) => `${e.toothNumber}${e.surface ?? ""}:${e.conditionId}`;

export async function accionHecho(
  req: NextRequest,
  ctx: { clinicId: string; userId: string; role: string; permissionsOverride?: string[] | null },
  plan: PlanParaHecho,
  body: Record<string, unknown>,
): Promise<NextResponse> {
  if (!(await tablaDeFilasExiste())) return error("sin_filas_en_plan", 409);
  const puedeOdontograma = puedeEscribirOdontograma({ role: ctx.role, permissionsOverride: ctx.permissionsOverride ?? null });

  if (body.action === "deshacer_hecho") {
    const itemId = typeof body.itemId === "string" ? body.itemId : "";
    if (!itemId) return error("sin_filas", 400);
    let r: ResultadoDeshacer;
    try {
      r = await deshacerHecho({ clinicId: ctx.clinicId, plan, userId: ctx.userId, itemId, puedeOdontograma });
    } catch (e) {
      if (e instanceof FilaError) return error(e.codigo, e.codigo === "sin_permiso_odontograma" ? 403 : 409);
      throw e;
    }
    await logMutation({
      req, clinicId: ctx.clinicId, userId: ctx.userId, entityType: "treatment", entityId: plan.id, action: "update",
      patientId: plan.patientId,
      texto: `Deshizo «hecho» en el plan «${plan.name}»: ${nombreDeFila(r.fila)}`,
      before: { procedimiento: nombreDeFila(r.fila), estado: "hecho" },
      after: {
        procedimiento: nombreDeFila(r.fila), estado: r.estado,
        odontograma: {
          quitadas: r.quitadas.map(marca),
          devueltas: r.devueltas.map(marca),
          avisos: r.conflictos.map((c) => `${marca(c)} (${c.motivo}${c.nota ? `: «${c.nota}»` : ""})`),
        },
      },
    });
    revalidateAfter("treatments");
    revalidatePatientProfile(plan.patientId);
    const t = makeT(getDict("es"));
    return NextResponse.json({
      success: true,
      item: filaDto(r.fila),
      estado: r.estado,
      mensaje: t(`planTratamiento.hecho.deshecho.${r.estado === "en_curso" ? "en_curso" : "pendiente"}`),
      odontograma: {
        quitadas: r.quitadas,
        devueltas: r.devueltas,
        conflictos: r.conflictos.map((c) => ({
          ...c,
          mensaje: t(`planTratamiento.hecho.conflicto.${c.motivo}`, { diente: String(c.toothNumber), hallazgo: nombreDeHallazgo(c.conditionId), nota: c.nota ?? "" }),
        })),
      },
    });
  }

  // marcar_hecho
  const crudos = Array.isArray(body.itemIds) ? body.itemIds : typeof body.itemId === "string" ? [body.itemId] : [];
  const itemIds = Array.from(new Set(crudos.filter((x): x is string => typeof x === "string" && !!x)));
  if (itemIds.length === 0) return error("sin_filas", 400);
  if (itemIds.length > MAX_FILAS_POR_HECHO) return error("demasiadas_filas", 400);

  // v17 (decisión 1 de Rafael, 28-oct): la tarjeta pregunta en qué cita se hizo. «Se hizo sin cita» pide un
  // motivo corto (obligatorio); queda en la fila hecha y en Movimientos. Sin ninguna de las dos (una pantalla
  // de antes), todo como hoy: nunca se bloquea el «Hecho».
  let sinCita: { motivo: string } | null = null;
  if (body.sinCita === true) {
    if (body.citaId != null && body.citaId !== "") return error("cita_invalida", 400);
    const motivo = limpiarMotivoSinCita(body.motivoSinCita);
    if (!motivo) return error("motivo_sin_cita", 400);
    sinCita = { motivo };
  }

  let citaId: string | null = null;
  if (body.citaId != null && body.citaId !== "") {
    if (typeof body.citaId !== "string" || !plan.patientId) return error("cita_invalida", 400);
    const cita = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "appointments" WHERE "id" = ${body.citaId} AND "clinicId" = ${ctx.clinicId} AND "patientId" = ${plan.patientId}`;
    if (cita.length !== 1) return error("cita_invalida", 400);
    citaId = body.citaId;
  }

  let r: Awaited<ReturnType<typeof marcarHecho>>;
  try {
    r = await marcarHecho({ clinicId: ctx.clinicId, plan, userId: ctx.userId, itemIds, citaId, sinCita, puedeOdontograma });
  } catch (e) {
    if (e instanceof FilaError) return error(e.codigo, 409);
    throw e;
  }

  const nuevos = r.resultados.filter((x) => x.estado !== "ya_estaba_hecho");
  if (nuevos.length > 0) {
    const porId = new Map(r.filas.map((f) => [f.id, f]));
    const nombres = nuevos.map((x) => (porId.get(x.itemId) ? nombreDeFila(porId.get(x.itemId)!) : x.itemId));
    await logMutation({
      req, clinicId: ctx.clinicId, userId: ctx.userId, entityType: "treatment", entityId: plan.id, action: "update",
      patientId: plan.patientId,
      // Quién lo marcó va en la línea de cada movimiento («Dra. Ana · 28 oct»), también en el plan de otro doctor.
      texto: sinCita
        ? `Marcó ${nombres.join(", ")} como hecho sin cita: ${sinCita.motivo} (plan «${plan.name}»)`
        : `Marcó como hecho en el plan «${plan.name}»: ${nombres.join(", ")}`,
      before: { hechos: [] as string[] },
      after: {
        hechos: nombres,
        ...(citaId ? { citaId } : {}),
        ...(sinCita ? { sinCita: true, motivoSinCita: sinCita.motivo } : {}),
        odontograma: nuevos.map((x) => ({ estado: x.estado, puso: x.altas.map(marca), quito: x.bajas.map(marca) })),
      },
    });
  }
  revalidateAfter("treatments");
  revalidatePatientProfile(plan.patientId);
  // v17: la cita elegida sin nota clínica → la tarjeta avisa y ofrece escribirla (no bloquea nada). Solo si
  // se pide (`avisarSinNota`, la tarjeta): «Hoy en el sillón» no lo usa (la nota se firma al completar).
  let citaSinNota = false;
  if (citaId && plan.patientId && body.avisarSinNota === true) {
    try {
      citaSinNota = !(await citasConNota(ctx.clinicId, plan.patientId, [citaId])).has(citaId);
    } catch (e) {
      console.warn("[plan:hecho] no se pudo mirar la nota de la cita:", (e as Error)?.message);
    }
  }
  const t = makeT(getDict("es"));
  return NextResponse.json({
    success: true,
    ...(citaSinNota ? { citaSinNota: true } : {}),
    ...(sinCita ? { sinCita: true } : {}),
    items: r.filas.map(filaDto),
    odontograma: r.resultados.map((x) => ({ ...x, mensaje: t(`planTratamiento.hecho.resultado.${x.estado}`) })),
  });
}
