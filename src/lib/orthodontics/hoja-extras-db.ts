// ═══════════════════════════════════════════════════════════════════════════
// Ortodoncia — lo nuevo de la hoja de control en la base (ws1-t9, auditoría BEVADENT, M1-M4).
//
// Todo por SQL crudo y SIN tocar prisma/schema.prisma (mismo motivo que tecnicas-de-la-clinica-db.ts): con una
// columna declarada de más, cualquier `findMany` de OrthoTreatmentCard tiraría P2022 en una base sin el SQL.
// sql/ws1-t9-hoja-ligas-mecanicas-catalogos.sql agrega:
//   - ortho_treatment_cards."wireToLowerId"     → M1, el arco nuevo inferior cuando es otro que el superior;
//   - ortho_card_ligatures                       → M2, las ligas de cada hoja;
//   - ortho_aux_devices                          → M3, las mecánicas auxiliares del caso;
//   - orthodontics_clinic_settings."hojaCatalogos" → M4, los catálogos de la clínica.
//
// SIN EL SQL CADA PARTE ESTÁ APAGADA: la hoja sale como antes (un selector «Nuevo», sin «Ligas» ni «Mecánicas»),
// Configuración avisa y no guarda. La pregunta es `to_regclass` / information_schema (no fallan nunca) y la respuesta
// se recuerda en `globalThis` (dev.108 recarga módulos cada pocos segundos: una variable de módulo se perdería y cada
// petición volvería a consultar una tabla que no existe en la base real). Un «no está» se re-pregunta a los 10 min.
//
// Aislamiento: toda lectura y escritura filtra por el `clinicId` de la sesión; quien llama ya validó el caso/hoja.
// ═══════════════════════════════════════════════════════════════════════════

import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizarCatalogos, catalogosEditados, type CatalogosDeHoja } from "./hoja-catalogos";
import {
  esArcada,
  mecanicasDelModeloViejo,
  normalizarLigas,
  ordenarMecanicas,
  type AltaDeMecanica,
  type LigaDeHoja,
  type MecanicaDelCaso,
} from "./hoja-extras";
import { DISTALIZER_LABELS, EXPANDER_LABELS } from "@/components/specialties/orthodontics/redesign/types";

type Db = Prisma.TransactionClient | typeof prisma;

export interface PartesDeHojaExtras {
  /** M1: columna `wireToLowerId`. */
  arcoInferior: boolean;
  /** M2: tabla `ortho_card_ligatures`. */
  ligas: boolean;
  /** M3: tabla `ortho_aux_devices`. */
  mecanicas: boolean;
  /** M4: columna `hojaCatalogos`. */
  catalogos: boolean;
}

const APAGADO: PartesDeHojaExtras = { arcoInferior: false, ligas: false, mecanicas: false, catalogos: false };
const LLAVE = Symbol.for("dalecontrol.orto.hoja-extras.partes");
const REPREGUNTAR_MS = 10 * 60_000;

interface Sonda { v: PartesDeHojaExtras; at: number }
function memoria(): { s: Sonda | null } {
  const g = globalThis as unknown as Record<symbol, { s: Sonda | null } | undefined>;
  if (!g[LLAVE]) g[LLAVE] = { s: null };
  return g[LLAVE]!;
}

/** Solo para las pruebas. */
export function _olvidarPartesDeHoja(): void {
  memoria().s = null;
}

const todas = (p: PartesDeHojaExtras) => p.arcoInferior && p.ligas && p.mecanicas && p.catalogos;

/** ¿Qué partes ya tienen su SQL? Nunca lanza: si no se puede preguntar, todo apagado (sin recordarlo). */
export async function partesDeHojaExtras(db: Db = prisma): Promise<PartesDeHojaExtras> {
  const m = memoria();
  const ahora = Date.now();
  if (m.s && (todas(m.s.v) || ahora - m.s.at < REPREGUNTAR_MS)) return m.s.v;
  try {
    const filas = await db.$queryRaw<Array<{ ligas: boolean; mecanicas: boolean; arcoInferior: boolean; catalogos: boolean }>>`
      SELECT to_regclass('public.ortho_card_ligatures') IS NOT NULL AS "ligas",
             to_regclass('public.ortho_aux_devices') IS NOT NULL AS "mecanicas",
             EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = 'ortho_treatment_cards' AND column_name = 'wireToLowerId') AS "arcoInferior",
             EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = 'orthodontics_clinic_settings' AND column_name = 'hojaCatalogos') AS "catalogos"`;
    const f = filas[0];
    const v: PartesDeHojaExtras = f
      ? { arcoInferior: f.arcoInferior === true, ligas: f.ligas === true, mecanicas: f.mecanicas === true, catalogos: f.catalogos === true }
      : APAGADO;
    m.s = { v, at: ahora };
    return v;
  } catch (e) {
    console.warn("[ortodoncia:hoja-extras] no se pudo comprobar el SQL de ws1-t9:", e);
    return APAGADO;
  }
}

// ─── M4 · catálogos ──────────────────────────────────────────────────────

export interface CatalogosDeLaClinica {
  catalogos: CatalogosDeHoja;
  /** false = falta pegar el SQL: se ven los de fábrica y no se puede guardar. */
  columna: boolean;
  /** false = la clínica aún no los editó (usa los de fábrica). */
  editados: boolean;
}

export async function leerCatalogosDeHoja(clinicId: string, db: Db = prisma): Promise<CatalogosDeLaClinica> {
  const fabrica = { catalogos: normalizarCatalogos(null), columna: false, editados: false };
  if (!clinicId) return fabrica;
  const partes = await partesDeHojaExtras(db);
  if (!partes.catalogos) return fabrica;
  try {
    const filas = await db.$queryRaw<Array<{ hojaCatalogos: unknown }>>`
      SELECT "hojaCatalogos" FROM "orthodontics_clinic_settings" WHERE "clinicId" = ${clinicId}`;
    const crudo = filas[0]?.hojaCatalogos ?? null;
    return { catalogos: normalizarCatalogos(crudo), columna: true, editados: catalogosEditados(crudo) };
  } catch (e) {
    console.warn("[ortodoncia:hoja-extras] no se pudieron leer los catálogos:", e);
    return { ...fabrica, columna: true };
  }
}

export async function guardarCatalogosDeHoja(
  clinicId: string,
  userId: string,
  catalogos: CatalogosDeHoja,
): Promise<{ ok: true; catalogos: CatalogosDeHoja; motivo?: undefined } | { ok: false; motivo: "sin-columna" | "sin-clinica" | "error"; catalogos?: undefined }> {
  if (!clinicId) return { ok: false, motivo: "sin-clinica" };
  if (!(await partesDeHojaExtras()).catalogos) return { ok: false, motivo: "sin-columna" };
  const limpio = normalizarCatalogos(catalogos);
  try {
    // La fila puede no existir aún (clínica que nunca guardó su Configuración).
    await prisma.orthodonticsClinicSettings.upsert({
      where: { clinicId },
      create: { clinicId, updatedBy: userId },
      update: { updatedBy: userId },
    });
    const json = JSON.stringify(limpio);
    await prisma.$executeRaw`
      UPDATE "orthodontics_clinic_settings" SET "hojaCatalogos" = ${json}::jsonb, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "clinicId" = ${clinicId}`;
    return { ok: true, catalogos: limpio };
  } catch (e) {
    console.warn("[ortodoncia:hoja-extras] no se pudieron guardar los catálogos:", e);
    return { ok: false, motivo: "error" };
  }
}

// ─── M1 · arco nuevo inferior ────────────────────────────────────────────

/** El arco nuevo inferior de cada hoja (solo las que lo tienen). Sin la columna: mapa vacío. */
export async function leerArcosInferiores(clinicId: string, cardIds: string[], db: Db = prisma): Promise<Map<string, string>> {
  const salida = new Map<string, string>();
  const ids = [...new Set(cardIds.filter(Boolean))];
  if (!clinicId || ids.length === 0) return salida;
  if (!(await partesDeHojaExtras(db)).arcoInferior) return salida;
  try {
    const filas = await db.$queryRaw<Array<{ id: string; wireToLowerId: string | null }>>`
      SELECT "id", "wireToLowerId" FROM "ortho_treatment_cards"
       WHERE "clinicId" = ${clinicId} AND "id" IN (${Prisma.join(ids)}) AND "wireToLowerId" IS NOT NULL`;
    for (const f of filas) if (f.wireToLowerId) salida.set(f.id, f.wireToLowerId);
  } catch (e) {
    console.warn("[ortodoncia:hoja-extras] no se pudieron leer los arcos inferiores:", e);
  }
  return salida;
}

/**
 * Escribe el arco nuevo inferior de una hoja. El arco tiene que ser de ESE caso y esa clínica (si no, se guarda null).
 * Devuelve false sin la columna o si falla.
 */
export async function escribirArcoInferior(args: { clinicId: string; planId: string; cardId: string; wireToLowerId: string | null }): Promise<boolean> {
  if (!(await partesDeHojaExtras()).arcoInferior) return false;
  try {
    let id = args.wireToLowerId;
    if (id) {
      const paso = await prisma.orthoWireStep.findFirst({ where: { id, treatmentPlanId: args.planId, clinicId: args.clinicId }, select: { id: true } });
      if (!paso) id = null;
    }
    await prisma.$executeRaw`
      UPDATE "ortho_treatment_cards" SET "wireToLowerId" = ${id}
       WHERE "id" = ${args.cardId} AND "clinicId" = ${args.clinicId} AND "treatmentPlanId" = ${args.planId}`;
    return true;
  } catch (e) {
    console.warn("[ortodoncia:hoja-extras] no se pudo guardar el arco inferior:", e);
    return false;
  }
}

// ─── M2 · ligas ──────────────────────────────────────────────────────────

interface FilaLiga { cardId: string; tipo: string; color: string | null; arcada: string; cambiadasHoy: boolean }

/** Las ligas de varias hojas, en UNA consulta. Sin la tabla: mapa vacío. */
export async function leerLigasDeHojas(clinicId: string, cardIds: string[], db: Db = prisma): Promise<Map<string, LigaDeHoja[]>> {
  const salida = new Map<string, LigaDeHoja[]>();
  const ids = [...new Set(cardIds.filter(Boolean))];
  if (!clinicId || ids.length === 0) return salida;
  if (!(await partesDeHojaExtras(db)).ligas) return salida;
  try {
    const filas = await db.$queryRaw<FilaLiga[]>`
      SELECT "cardId", "tipo", "color", "arcada", "cambiadasHoy" FROM "ortho_card_ligatures"
       WHERE "clinicId" = ${clinicId} AND "cardId" IN (${Prisma.join(ids)})
       ORDER BY "cardId", "orden"`;
    for (const f of filas) {
      const lista = salida.get(f.cardId) ?? [];
      lista.push({ tipo: f.tipo, color: f.color, arcada: esArcada(f.arcada) ? f.arcada : "AMBAS", cambiadasHoy: f.cambiadasHoy === true });
      salida.set(f.cardId, lista);
    }
  } catch (e) {
    console.warn("[ortodoncia:hoja-extras] no se pudieron leer las ligas:", e);
  }
  return salida;
}

/** Sustituye las ligas de una hoja por las de la pantalla. Devuelve false sin la tabla o si falla. */
export async function escribirLigasDeHoja(args: {
  clinicId: string;
  patientId: string;
  planId: string;
  cardId: string;
  ligas: unknown;
}): Promise<boolean> {
  if (!(await partesDeHojaExtras()).ligas) return false;
  const ligas = normalizarLigas(args.ligas);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`DELETE FROM "ortho_card_ligatures" WHERE "cardId" = ${args.cardId} AND "clinicId" = ${args.clinicId}`;
      let orden = 0;
      for (const l of ligas) {
        await tx.$executeRaw`
          INSERT INTO "ortho_card_ligatures" ("id", "cardId", "clinicId", "patientId", "treatmentPlanId", "orden", "tipo", "color", "arcada", "cambiadasHoy")
          VALUES (${randomUUID()}, ${args.cardId}, ${args.clinicId}, ${args.patientId}, ${args.planId}, ${orden++}, ${l.tipo}, ${l.color}, ${l.arcada}, ${l.cambiadasHoy})`;
      }
    });
    return true;
  } catch (e) {
    console.warn("[ortodoncia:hoja-extras] no se pudieron guardar las ligas:", e);
    return false;
  }
}

// ─── M3 · mecánicas auxiliares ───────────────────────────────────────────

interface FilaMecanica {
  id: string;
  tipo: string;
  arcada: string | null;
  ubicacion: string | null;
  nota: string | null;
  colocadaEl: Date;
  retiradaEl: Date | null;
  cardIdAlta: string | null;
  cardIdRetiro: string | null;
}

function aMecanica(f: FilaMecanica): MecanicaDelCaso {
  return {
    id: f.id,
    tipo: f.tipo,
    arcada: esArcada(f.arcada) ? f.arcada : null,
    ubicacion: f.ubicacion,
    nota: f.nota,
    colocadaEl: new Date(f.colocadaEl).toISOString(),
    retiradaEl: f.retiradaEl ? new Date(f.retiradaEl).toISOString() : null,
    cardIdAlta: f.cardIdAlta,
    cardIdRetiro: f.cardIdRetiro,
  };
}

/** Las mecánicas del caso (activas y retiradas). Sin la tabla: lista vacía. */
export async function listarMecanicasDelCaso(clinicId: string, planId: string, db: Db = prisma): Promise<MecanicaDelCaso[]> {
  if (!clinicId || !planId) return [];
  if (!(await partesDeHojaExtras(db)).mecanicas) return [];
  try {
    const filas = await db.$queryRaw<FilaMecanica[]>`
      SELECT "id", "tipo", "arcada", "ubicacion", "nota", "colocadaEl", "retiradaEl", "cardIdAlta", "cardIdRetiro"
        FROM "ortho_aux_devices"
       WHERE "clinicId" = ${clinicId} AND "treatmentPlanId" = ${planId}
       ORDER BY "colocadaEl" DESC, "createdAt" DESC
       LIMIT 200`;
    return filas.map(aMecanica);
  } catch (e) {
    console.warn("[ortodoncia:hoja-extras] no se pudieron leer las mecánicas:", e);
    return [];
  }
}

/**
 * ws1-t9 (vuelta 2): las mecánicas del caso de las DOS fuentes — la tabla nueva (si ya está su SQL) y el expansor /
 * distalizador del modelo viejo (`OrthoAuxMechanics`, siempre existe) — sin migrar nada. Las del modelo viejo salen con
 * `legado: true` (solo lectura). Nunca lanza.
 */
export async function listarMecanicasConLegado(clinicId: string, planId: string, db: Db = prisma): Promise<MecanicaDelCaso[]> {
  if (!clinicId || !planId) return [];
  const [nuevas, viejo] = await Promise.all([
    listarMecanicasDelCaso(clinicId, planId, db),
    (async () => {
      try {
        return await db.orthoAuxMechanics.findFirst({
          where: { treatmentPlanId: planId, clinicId },
          select: {
            expanderType: true,
            expanderActivations: true,
            expanderInstalledAt: true,
            expanderRemovedAt: true,
            distalizerType: true,
            distalizerInstalledAt: true,
            distalizerRemovedAt: true,
            notes: true,
            createdAt: true,
          },
        });
      } catch (e) {
        console.warn("[ortodoncia:hoja-extras] no se pudo leer el expansor/distalizador del caso:", e);
        return null;
      }
    })(),
  ]);
  return ordenarMecanicas([...nuevas, ...mecanicasDelModeloViejo(viejo, { expansor: EXPANDER_LABELS, distalizador: DISTALIZER_LABELS })]);
}

export async function crearMecanica(args: {
  clinicId: string;
  patientId: string;
  planId: string;
  userId: string;
  cardId: string | null;
  alta: AltaDeMecanica;
}): Promise<MecanicaDelCaso | null> {
  if (!(await partesDeHojaExtras()).mecanicas) return null;
  const id = randomUUID();
  const a = args.alta;
  const filas = await prisma.$queryRaw<FilaMecanica[]>`
    INSERT INTO "ortho_aux_devices"
      ("id", "clinicId", "patientId", "treatmentPlanId", "tipo", "arcada", "ubicacion", "nota", "colocadaEl", "cardIdAlta", "createdById")
    VALUES (${id}, ${args.clinicId}, ${args.patientId}, ${args.planId}, ${a.tipo}, ${a.arcada}, ${a.ubicacion}, ${a.nota}, ${a.colocadaEl}, ${args.cardId}, ${args.userId})
    RETURNING "id", "tipo", "arcada", "ubicacion", "nota", "colocadaEl", "retiradaEl", "cardIdAlta", "cardIdRetiro"`;
  return filas[0] ? aMecanica(filas[0]) : null;
}

/**
 * Marca una mecánica como retirada. Solo una activa de ESTE caso y clínica (un segundo «Retirar» no la vuelve a
 * fechar): devuelve la fila retirada o null si no había nada que retirar.
 */
export async function retirarMecanica(args: {
  clinicId: string;
  planId: string;
  id: string;
  userId: string;
  cardId: string | null;
  fecha: Date;
}): Promise<MecanicaDelCaso | null> {
  if (!(await partesDeHojaExtras()).mecanicas) return null;
  const filas = await prisma.$queryRaw<FilaMecanica[]>`
    UPDATE "ortho_aux_devices"
       SET "retiradaEl" = ${args.fecha}, "cardIdRetiro" = ${args.cardId}, "retiradaPorId" = ${args.userId}, "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = ${args.id} AND "clinicId" = ${args.clinicId} AND "treatmentPlanId" = ${args.planId} AND "retiradaEl" IS NULL
    RETURNING "id", "tipo", "arcada", "ubicacion", "nota", "colocadaEl", "retiradaEl", "cardIdAlta", "cardIdRetiro"`;
  return filas[0] ? aMecanica(filas[0]) : null;
}

/**
 * Liga a una hoja las mecánicas que se colocaron o retiraron desde ella antes de que la hoja tuviera id. Solo las de
 * ESTE caso y clínica que aún no tenían hoja (nunca reasigna una ya ligada a otra).
 */
export async function ligarMecanicasALaHoja(args: { clinicId: string; planId: string; cardId: string; altas: string[]; retiros: string[] }): Promise<void> {
  if (!(await partesDeHojaExtras()).mecanicas) return;
  if (args.altas.length > 0) {
    await prisma.$executeRaw`
      UPDATE "ortho_aux_devices" SET "cardIdAlta" = ${args.cardId}, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "clinicId" = ${args.clinicId} AND "treatmentPlanId" = ${args.planId} AND "cardIdAlta" IS NULL AND "id" IN (${Prisma.join(args.altas)})`;
  }
  if (args.retiros.length > 0) {
    await prisma.$executeRaw`
      UPDATE "ortho_aux_devices" SET "cardIdRetiro" = ${args.cardId}, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "clinicId" = ${args.clinicId} AND "treatmentPlanId" = ${args.planId} AND "cardIdRetiro" IS NULL
         AND "retiradaEl" IS NOT NULL AND "id" IN (${Prisma.join(args.retiros)})`;
  }
}
