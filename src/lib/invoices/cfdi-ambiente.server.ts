// Ambiente de los CFDI en la base (ws1-t4, vuelta 2: F-14). Ver cfdi-ambiente.ts.
//
// Sin sql/ws1-t4-cfdi-ambiente.sql pegado, la columna no existe: no se escribe
// nada y todo CFDI cuenta como vigente (lo de siempre). Ninguna función lanza:
// esto acompaña al timbrado y a los bloqueos, nunca los tumba.

import type { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isFacturapiLive } from "@/lib/facturapi-env";
import { isCfdiClaim, cfdiVigenteResponse, type CfdiBlockedAction } from "./cfdi-vigente";
import { cfdiBloqueaEnLive, normalizarAmbiente, type AmbienteCfdi } from "./cfdi-ambiente";

type Db = Prisma.TransactionClient | typeof prisma;

export const SQL_AMBIENTE = "sql/ws1-t4-cfdi-ambiente.sql";

const CLAVE = Symbol.for("dalecontrol.cfdi-ambiente.columna");
const TTL_AUSENTE_MS = 10 * 60_000;

function cache(): { v: { hay: boolean; at: number } | null } {
  const g = globalThis as any;
  if (!g[CLAVE]) g[CLAVE] = { v: null };
  return g[CLAVE];
}

/** Solo para pruebas. */
export function _olvidarColumnaAmbiente(): void {
  cache().v = null;
}

/** ¿Existe `cfdi_records.environment`? Se recuerda; si falta, se vuelve a mirar cada 10 min. */
export async function columnaAmbiente(db: Db = prisma): Promise<boolean> {
  const c = cache();
  const t = Date.now();
  if (c.v && (c.v.hay || t - c.v.at < TTL_AUSENTE_MS)) return c.v.hay;
  try {
    const filas = await db.$queryRaw<{ n: number }[]>`
      SELECT 1 AS n FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'cfdi_records' AND column_name = 'environment'`;
    c.v = { hay: filas.length > 0, at: t };
  } catch (e) {
    console.warn("[cfdi:ambiente] no se pudo leer la columna environment:", e);
    c.v = { hay: false, at: t };
  }
  return c.v.hay;
}

/** Deja escrito en qué ambiente se timbró un CFDI. Nunca lanza. */
export async function marcarAmbiente(db: Db, args: { clinicId: string; uuid: string; ambiente: AmbienteCfdi }): Promise<void> {
  try {
    if (!args.clinicId || !args.uuid || !(await columnaAmbiente(db))) return;
    await db.$executeRaw`
      UPDATE "cfdi_records" SET "environment" = ${args.ambiente}
       WHERE "clinicId" = ${args.clinicId} AND "uuid" = ${args.uuid}`;
  } catch (e) {
    console.warn("[cfdi:ambiente] no se pudo marcar el ambiente:", { uuid: args.uuid, e });
  }
}

/**
 * Un CFDI de PRUEBAS que se reemplazó por uno real en Live: deja de estar
 * «valid» (queda «prueba») para que nada lo tome por el CFDI de la factura.
 * Solo toca filas marcadas «test». Nunca lanza.
 */
export async function retirarCfdiDePrueba(db: Db, args: { clinicId: string; uuid: string }): Promise<void> {
  try {
    if (!args.clinicId || !args.uuid || !(await columnaAmbiente(db))) return;
    await db.$executeRaw`
      UPDATE "cfdi_records" SET "status" = 'prueba'
       WHERE "clinicId" = ${args.clinicId} AND "uuid" = ${args.uuid} AND "environment" = 'test' AND "status" = 'valid'`;
  } catch (e) {
    console.warn("[cfdi:ambiente] no se pudo retirar el CFDI de prueba:", { uuid: args.uuid, e });
  }
}

/** El ambiente guardado de un CFDI (null = no se sabe). Nunca lanza. */
export async function ambienteDeCfdi(db: Db, args: { clinicId: string; uuid: string | null | undefined }): Promise<AmbienteCfdi | null> {
  try {
    if (!args.clinicId || !args.uuid || isCfdiClaim(args.uuid) || !(await columnaAmbiente(db))) return null;
    const filas = await db.$queryRaw<{ environment: string | null }[]>`
      SELECT "environment" FROM "cfdi_records"
       WHERE "clinicId" = ${args.clinicId} AND "uuid" = ${args.uuid} LIMIT 1`;
    return normalizarAmbiente(filas[0]?.environment);
  } catch (e) {
    console.warn("[cfdi:ambiente] no se pudo leer el ambiente:", { uuid: args.uuid, e });
    return null;
  }
}

/**
 * La misma guarda que `denyIfCfdiVigente`, sabiendo el ambiente: en Live, un
 * CFDI de PRUEBAS ya no bloquea la factura (F-14). Un apartado en curso sigue
 * bloqueando siempre en Live.
 */
export async function denyIfCfdiVigenteEnAmbiente(
  db: Db,
  args: { clinicId: string; cfdiUuid: string | null | undefined; accion: CfdiBlockedAction },
): Promise<NextResponse | null> {
  const live = isFacturapiLive();
  if (!args.cfdiUuid || !live) return null;
  if (isCfdiClaim(args.cfdiUuid)) return cfdiVigenteResponse(args.cfdiUuid, args.accion);
  const ambiente = await ambienteDeCfdi(db, { clinicId: args.clinicId, uuid: args.cfdiUuid });
  return cfdiBloqueaEnLive({ live, ambiente }) ? cfdiVigenteResponse(args.cfdiUuid, args.accion) : null;
}
