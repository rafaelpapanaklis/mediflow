// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES · lectura de realty_calc_params.
//
// ESTE archivo es el ÚNICO que habla con la tabla. Todo lo demás del módulo
// de calculadoras es puro y recibe los parámetros ya resueltos, que es lo
// que permite que la misma aritmética corra en el navegador (recálculo en
// vivo mientras el usuario escribe) y en el servidor (la autoridad).
//
// La tabla NO tiene accountId: son parámetros de PLATAFORMA que comparten
// todas las cuentas. Por eso la caché es global y por eso su edición vive
// en /admin y no en el panel del cliente.
// ═══════════════════════════════════════════════════════════════════════
import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  type CreditoParams,
  type EscrituracionParams,
  type IsrParams,
  type ParamsResolved,
  type RawCalcParamRow,
  FEDERAL_STATE_CODE,
  resolveCreditoParams,
  resolveEscrituracionParams,
  resolveIsrParams,
  sanitizarMeta,
} from "./catalog";
import { buildSeed } from "./seed";

/**
 * Caché en memoria con TTL corto, igual que getRealtyPlan.
 *
 * Son 50 y pico de filas que cambian una vez al año: pegarle a Postgres en
 * cada tecleo del precalificador sería absurdo. 60 segundos es suficiente
 * para que un cambio hecho en /admin se vea casi de inmediato sin tener que
 * invalidar nada a mano.
 */
const TTL_MS = 60_000;
let cache: { rows: RawCalcParamRow[]; at: number } | null = null;

/** La llama el admin después de escribir, para no esperar el TTL. */
export function clearCalcParamCache(): void {
  cache = null;
}

function toRow(
  row: {
    kind: string;
    stateCode: string;
    year: number;
    value: Prisma.Decimal | number;
    meta: Prisma.JsonValue;
    effectiveFrom: Date;
  },
  /** false SOLO para el editor de /admin, que sí tiene que ver el meta entero. */
  sanear = true,
): RawCalcParamRow {
  // value es Decimal(14,6): un Decimal no sobrevive a la serialización RSC,
  // así que se aplana aquí y no en cada consumidor.
  const crudo =
    row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
      ? (row.meta as Record<string, unknown>)
      : null;
  const kind = row.kind as RawCalcParamRow["kind"];
  // 🔴 El meta se edita como JSON CRUDO en /admin y estas filas se sirven a
  // internet sin sesión, cacheadas media hora en el borde. Lo que sale lleva
  // lista blanca (sanitizarMeta): una nota interna pegada por error en ese
  // JSON no se publica sola.
  const meta = sanear ? sanitizarMeta(kind, crudo) : crudo;
  return {
    kind,
    stateCode: row.stateCode,
    year: row.year,
    value: Number(row.value),
    meta,
    effectiveFrom: row.effectiveFrom.toISOString(),
  };
}

/**
 * TODAS las filas, ya aplanadas. Es lo que se manda al navegador para que
 * recalcule en vivo: son parámetros públicos (tasas de impuestos), no hay
 * nada que ocultar y bajarlas una vez evita un fetch por tecleo.
 */
export async function getCalcParamRows(): Promise<RawCalcParamRow[]> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.rows;
  try {
    const rows = await prisma.realtyCalcParam.findMany({
      select: {
        kind: true,
        stateCode: true,
        year: true,
        value: true,
        meta: true,
        effectiveFrom: true,
      },
      orderBy: [{ kind: "asc" }, { stateCode: "asc" }, { effectiveFrom: "desc" }],
    });
    // Flecha explícita y NO `rows.map(toRow)`: map pasa el ÍNDICE como
    // segundo argumento, así que el `sanear` habría llegado como 0 en la
    // primera fila (falsy) y como número en las demás. La lista blanca del
    // meta se habría apagado justo en una fila y encendido en el resto.
    const mapped = rows.map((r) => toRow(r));
    cache = { rows: mapped, at: now };
    return mapped;
  } catch (e) {
    // Tabla sin migrar o base caída: la calculadora tiene que DEGRADAR, no
    // reventar. Sin filas, cada resolutor devuelve su lista de faltantes y
    // la pantalla explica qué hay que capturar.
    console.error("[realty-calc] no se pudieron leer los parámetros:", e);
    return [];
  }
}

/** Igual que el anterior pero con id, para la pantalla de administración. */
export async function getCalcParamRowsConId(): Promise<
  (RawCalcParamRow & { id: string; updatedAt: string })[]
> {
  try {
    const rows = await prisma.realtyCalcParam.findMany({
      // select explícito aunque hoy la tabla no tenga nada de ninguna cuenta:
      // enumerar es a prueba de futuro, y esto viaja al bundle del admin.
      select: {
        id: true,
        kind: true,
        stateCode: true,
        year: true,
        value: true,
        meta: true,
        effectiveFrom: true,
        updatedAt: true,
      },
      orderBy: [{ year: "desc" }, { kind: "asc" }, { stateCode: "asc" }],
    });
    // sanear=false: el editor necesita ver y devolver el meta ENTERO, o
    // guardar una fila le borraría las llaves que la lista blanca no conoce.
    return rows.map((r) => ({
      ...toRow(r, false),
      id: r.id,
      updatedAt: r.updatedAt.toISOString(),
    }));
  } catch (e) {
    console.error("[realty-calc] no se pudieron leer los parámetros (admin):", e);
    return [];
  }
}

export async function getEscrituracionParams(
  stateCode: string,
  at: Date = new Date(),
): Promise<ParamsResolved<EscrituracionParams>> {
  return resolveEscrituracionParams(await getCalcParamRows(), stateCode, at);
}

export async function getIsrParams(
  stateCode: string,
  at: Date = new Date(),
): Promise<ParamsResolved<IsrParams>> {
  return resolveIsrParams(await getCalcParamRows(), stateCode, at);
}

export async function getCreditoParams(
  at: Date = new Date(),
): Promise<ParamsResolved<CreditoParams>> {
  return resolveCreditoParams(await getCalcParamRows(), at);
}

// ── Escritura (solo la usa /admin/inmobiliarias/parametros) ────────────

export interface SembrarResultado {
  creadas: number;
  omitidas: number;
  error?: string;
}

/**
 * Escribe la semilla. Es IDEMPOTENTE: cada fila lleva el único
 * (kind, stateCode, year, effectiveFrom), así que volver a sembrar no pisa
 * nada de lo que alguien ya corrigió a mano — las que ya existen se cuentan
 * como omitidas y se dejan intactas.
 *
 * Esa es la diferencia importante con un upsert: si el administrador ajustó
 * el ISAI de Jalisco contra la ley estatal, sembrar otra vez NO puede
 * devolverle el número de fábrica.
 */
export async function sembrarParametros(): Promise<SembrarResultado> {
  const rows = buildSeed();
  let creadas = 0;
  let omitidas = 0;
  try {
    for (const row of rows) {
      const effectiveFrom = new Date(`${row.effectiveFrom}T00:00:00.000Z`);
      const existe = await prisma.realtyCalcParam.findFirst({
        where: {
          kind: row.kind,
          stateCode: row.stateCode,
          year: row.year,
          effectiveFrom,
        },
        select: { id: true },
      });
      if (existe) {
        omitidas += 1;
        continue;
      }
      await prisma.realtyCalcParam.create({
        data: {
          kind: row.kind,
          stateCode: row.stateCode,
          year: row.year,
          value: new Prisma.Decimal(String(row.value)),
          meta: row.meta as Prisma.InputJsonValue,
          effectiveFrom,
        },
      });
      creadas += 1;
    }
    clearCalcParamCache();
    return { creadas, omitidas };
  } catch (e) {
    console.error("[realty-calc] sembrado falló:", e);
    return { creadas, omitidas, error: "No se pudo sembrar el catálogo. Revisa los registros." };
  }
}

export interface GuardarParametroInput {
  id?: string | null;
  kind: string;
  stateCode: string;
  year: number;
  value: number;
  effectiveFrom: string;
  meta: Record<string, unknown>;
}

export interface GuardarResultado {
  ok: boolean;
  error?: string;
  id?: string;
}

/** Alta o edición de una fila desde el panel de administración. */
export async function guardarParametro(input: GuardarParametroInput): Promise<GuardarResultado> {
  const effectiveFrom = new Date(
    input.effectiveFrom.length === 10
      ? `${input.effectiveFrom}T00:00:00.000Z`
      : input.effectiveFrom,
  );
  if (Number.isNaN(effectiveFrom.getTime())) {
    return { ok: false, error: "La fecha de vigencia no es válida." };
  }
  if (!Number.isFinite(input.value)) {
    return { ok: false, error: "El valor no es un número." };
  }
  if (!Number.isInteger(input.year) || input.year < 1990 || input.year > 2100) {
    return { ok: false, error: "El año no es válido." };
  }
  try {
    const data = {
      kind: input.kind as Prisma.RealtyCalcParamCreateInput["kind"],
      stateCode: input.stateCode,
      year: input.year,
      value: new Prisma.Decimal(String(input.value)),
      meta: input.meta as Prisma.InputJsonValue,
      effectiveFrom,
    };
    const saved = input.id
      ? await prisma.realtyCalcParam.update({ where: { id: input.id }, data })
      : await prisma.realtyCalcParam.create({ data });
    clearCalcParamCache();
    return { ok: true, id: saved.id };
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "P2002") {
      return {
        ok: false,
        error:
          "Ya existe una fila con ese tipo, estado, año y fecha de vigencia. Cambia la fecha de vigencia o edita la que ya está.",
      };
    }
    if (code === "P2025") {
      return { ok: false, error: "Esa fila ya no existe; recarga la pantalla." };
    }
    console.error("[realty-calc] guardar parámetro falló:", e);
    return { ok: false, error: "No se pudo guardar el parámetro." };
  }
}

export async function borrarParametro(id: string): Promise<GuardarResultado> {
  try {
    await prisma.realtyCalcParam.delete({ where: { id } });
    clearCalcParamCache();
    return { ok: true };
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "P2025") return { ok: false, error: "Esa fila ya no existe; recarga la pantalla." };
    console.error("[realty-calc] borrar parámetro falló:", e);
    return { ok: false, error: "No se pudo borrar el parámetro." };
  }
}

export { FEDERAL_STATE_CODE };
