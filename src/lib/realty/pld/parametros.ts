// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES · PLD — lectura y siembra de los parámetros.
//
// 🔴 POR QUÉ ESTE MÓDULO LEE LA TABLA POR SU CUENTA Y NO USA
//    getCalcParamRows() DE LAS CALCULADORAS
//
// `getCalcParamRows()` pasa cada fila por `sanitizarMeta`, una LISTA BLANCA
// que solo deja salir las llaves que las calculadoras leen. Es una defensa
// correcta y deliberada: esas filas se sirven a internet SIN SESIÓN por
// /api/realty/calc/params, cacheadas media hora en el borde.
//
// El bloque `pld` NO está en esa lista blanca, y no se va a agregar. Los
// umbrales de la LFPIORPI son públicos, pero no hay ninguna razón para
// publicarlos en un endpoint anónimo, y dejarlos fuera de la lista blanca
// es la garantía MECÁNICA de que no se filtran ni por accidente.
//
// La consecuencia es que este módulo necesita su propio lector: el mismo
// `findMany`, sin sanear. Hay precedente exacto en el vertical —
// `getInpcPct` de src/lib/realty/leases.ts también lee `realty_calc_params`
// directo por la misma clase de motivo.
//
// La tabla NO tiene accountId: son parámetros de PLATAFORMA. Por eso la
// caché es global y la edición vive en /admin, no en el panel del cliente.
// ═══════════════════════════════════════════════════════════════════════
import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ParamsResolved, RawCalcParamRow } from "@/lib/realty/calc/catalog";
import { PLD_STATE_CODE, resolvePldParams, type PldParams } from "./umbrales";
import {
  PLD_BLOQUE_SEMILLA,
  PLD_SEED_EFFECTIVE_FROM,
  PLD_SEED_UMA_DIARIA,
  PLD_SEED_YEAR,
  metaUmaSemilla,
} from "./seed";

/**
 * Caché en memoria con TTL corto, igual que getCalcParamRows y getRealtyPlan.
 * Son un puñado de filas que cambian una vez al año; pegarle a Postgres en
 * cada pintada del tablero sería absurdo.
 */
const TTL_MS = 60_000;
let cache: { rows: RawCalcParamRow[]; at: number } | null = null;

/** La llama el sembrador después de escribir, para no esperar el TTL. */
export function clearPldParamCache(): void {
  cache = null;
}

function toRow(row: {
  kind: string;
  stateCode: string;
  year: number;
  value: Prisma.Decimal | number;
  meta: Prisma.JsonValue;
  effectiveFrom: Date;
}): RawCalcParamRow {
  return {
    kind: row.kind as RawCalcParamRow["kind"],
    stateCode: row.stateCode,
    year: row.year,
    // Decimal(14,6) no sobrevive a la serialización RSC: se aplana aquí.
    value: Number(row.value),
    // SIN sanitizarMeta — ver la cabecera. Estas filas no salen a internet.
    meta:
      row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
        ? (row.meta as Record<string, unknown>)
        : null,
    effectiveFrom: row.effectiveFrom.toISOString(),
  };
}

/**
 * Las filas UMA federales, de la más reciente a la más vieja.
 *
 * Solo UMA/MX: el módulo no necesita el ISAI ni el INPC, y traer 52 filas
 * para leer una sería trabajo de más en cada request del tablero.
 */
export async function getPldParamRows(): Promise<RawCalcParamRow[]> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.rows;
  try {
    const rows = await prisma.realtyCalcParam.findMany({
      where: { kind: "UMA", stateCode: PLD_STATE_CODE },
      select: {
        kind: true,
        stateCode: true,
        year: true,
        value: true,
        meta: true,
        effectiveFrom: true,
      },
      orderBy: { effectiveFrom: "desc" },
    });
    // Flecha explícita y no `rows.map(toRow)`: map pasa el índice como
    // segundo argumento y aquí eso todavía no muerde, pero la firma de toRow
    // puede crecer. Misma disciplina que en calc/params.ts, donde sí mordió.
    const mapped = rows.map((r) => toRow(r));
    cache = { rows: mapped, at: now };
    return mapped;
  } catch (e) {
    // Tabla sin migrar o base caída: el módulo DEGRADA, no revienta. Sin
    // filas, resolvePldParams devuelve la lista de faltantes y la pantalla
    // explica qué capturar.
    console.error("[realty-pld] no se pudieron leer los parámetros:", e);
    return [];
  }
}

/** Los parámetros PLD vigentes a una fecha, ya resueltos y validados. */
export async function getPldParams(
  at: Date = new Date(),
): Promise<ParamsResolved<PldParams>> {
  return resolvePldParams(await getPldParamRows(), at);
}

// ── Siembra ────────────────────────────────────────────────────────────

export interface SembrarPldResultado {
  /** Filas UMA creadas desde cero. */
  creadas: number;
  /** Filas UMA que ya existían y a las que se les AGREGÓ el bloque `pld`. */
  completadas: number;
  /** Filas que ya traían el bloque: intactas. */
  omitidas: number;
  error?: string;
}

/**
 * Escribe el bloque `pld` en las filas UMA. IDEMPOTENTE y ADITIVO:
 *
 *   · Fila UMA con bloque `pld` → se deja INTACTA (omitida).
 *   · Fila UMA sin bloque       → se le agrega `pld` y NADA más: su `value`,
 *                                 su `mensual`, su `nota` y su `porVerificar`
 *                                 se conservan tal cual estaban.
 *   · Sin ninguna fila del año  → se crea la del año de la semilla completa.
 *
 * Nunca sobrescribe un umbral corregido a mano. Es la misma promesa que
 * hace `sembrarParametros` de las calculadoras, y por el mismo motivo.
 */
export async function sembrarParametrosPld(): Promise<SembrarPldResultado> {
  let creadas = 0;
  let completadas = 0;
  let omitidas = 0;

  try {
    const filas = await prisma.realtyCalcParam.findMany({
      where: { kind: "UMA", stateCode: PLD_STATE_CODE },
      select: { id: true, year: true, meta: true },
    });

    for (const fila of filas) {
      const meta =
        fila.meta && typeof fila.meta === "object" && !Array.isArray(fila.meta)
          ? ({ ...(fila.meta as Record<string, unknown>) } as Record<string, unknown>)
          : ({} as Record<string, unknown>);
      const yaTiene =
        meta.pld && typeof meta.pld === "object" && !Array.isArray(meta.pld);
      if (yaTiene) {
        omitidas += 1;
        continue;
      }
      meta.pld = { ...PLD_BLOQUE_SEMILLA };
      await prisma.realtyCalcParam.update({
        where: { id: fila.id },
        data: { meta: meta as Prisma.InputJsonValue },
      });
      completadas += 1;
    }

    // Si no hay fila del año de la semilla, se crea completa. `findFirst`
    // por el único (kind, stateCode, year, effectiveFrom) y no un upsert:
    // el upsert pisaría un valor que alguien hubiera corregido.
    const effectiveFrom = new Date(`${PLD_SEED_EFFECTIVE_FROM}T00:00:00.000Z`);
    const existe = await prisma.realtyCalcParam.findFirst({
      where: {
        kind: "UMA",
        stateCode: PLD_STATE_CODE,
        year: PLD_SEED_YEAR,
        effectiveFrom,
      },
      select: { id: true },
    });
    if (!existe) {
      await prisma.realtyCalcParam.create({
        data: {
          kind: "UMA",
          stateCode: PLD_STATE_CODE,
          year: PLD_SEED_YEAR,
          value: new Prisma.Decimal(String(PLD_SEED_UMA_DIARIA)),
          meta: metaUmaSemilla() as Prisma.InputJsonValue,
          effectiveFrom,
        },
      });
      creadas += 1;
    }

    clearPldParamCache();
    return { creadas, completadas, omitidas };
  } catch (e) {
    console.error("[realty-pld] sembrado falló:", e);
    return {
      creadas,
      completadas,
      omitidas,
      error: "No se pudo sembrar el bloque antilavado. Revisa los registros.",
    };
  }
}
