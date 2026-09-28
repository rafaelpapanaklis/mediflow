// ═══════════════════════════════════════════════════════════════════════════
// CFDI por PAGO de una factura a plazos (ws1-t1, sep-2026) — SQL CRUDO a
// propósito, NUNCA declarado en prisma/schema.prisma: `cfdiRecord` se lee sin
// `select` explícito en api/cfdi/route.ts (GET) y api/cfdi/[cfdiId]/pdf|xml —
// declarar `paymentId` ahí y correr `prisma generate` antes de que Rafael
// pegue sql/cfdi-pagos-a-plazos.sql tumbaría esas rutas con P2022. Mismo
// patrón que `orthodontic_treatment_plans.billingMode`
// (lib/orthodontics/billing-mode-db.ts): sonda de columna + SQL crudo.
//
// El candado contra el doble timbrado de UN pago es el mismo truco que ya usa
// `cfdiClaimFor`/`isCfdiClaim` (lib/invoices/cfdi-vigente.ts) para la factura
// completa, pero expresado como un INSERT en vez de un UPDATE: se aparta la
// fila ANTES de llamar a Facturapi con `status='apartado'` y `uuid`/
// `facturapiId` = un texto "reservando:…" único; el índice único parcial
// `cfdi_records_paymentId_key` (WHERE "paymentId" IS NOT NULL) hace que el
// INSERT … ON CONFLICT DO NOTHING de dos pestañas a la vez solo cuele UNA.
// Si Facturapi contesta que NO timbró, la fila se borra (se puede reintentar).
// Si no se sabe si timbró (corte de red, timeout — mismo criterio que
// `pudoHaberTimbrado`), la fila 'apartado' SE QUEDA: bloquea reintentos hasta
// que alguien mire el panel de Facturapi, igual que el apartado de la factura
// completa.
// ═══════════════════════════════════════════════════════════════════════════

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

const CLAIM_PREFIX = "reservando:";

export function claimDePago(paymentId: string): string {
  return `${CLAIM_PREFIX}${paymentId}:${crypto.randomUUID()}`;
}

export function esClaimDePago(uuid: string | null | undefined): boolean {
  return typeof uuid === "string" && uuid.startsWith(CLAIM_PREFIX);
}

/** Caché de «¿existe la columna?»: una pregunta por minuto, no una por pago. */
let columna: { existe: boolean; at: number } | null = null;
const TTL_MS = 60_000;

async function columnaExiste(db: Db): Promise<boolean> {
  const t = Date.now();
  if (columna && (columna.existe || t - columna.at < TTL_MS)) return columna.existe;
  try {
    const filas = await db.$queryRaw<{ existe: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'cfdi_records' AND column_name = 'paymentId'
      ) AS existe`;
    columna = { existe: filas[0]?.existe === true, at: t };
    return columna.existe;
  } catch (e) {
    console.warn("[cfdi:pago] no se pudo comprobar la columna paymentId:", e);
    return false;
  }
}

/** Solo para pruebas: olvida lo que se sabía de la columna. */
export function _olvidarColumnaCfdiPago(): void {
  columna = null;
}

export interface CfdiDePagoFila {
  id: string;
  uuid: string;
  status: string;
  total: number;
  xmlUrl: string | null;
  pdfUrl: string | null;
  createdAt: Date;
}

interface FilaCruda {
  id: string;
  uuid: string;
  status: string;
  total: unknown;
  xmlUrl: string | null;
  pdfUrl: string | null;
  createdAt: Date;
}

function deFila(f: FilaCruda): CfdiDePagoFila {
  return { id: f.id, uuid: f.uuid, status: f.status, total: Number(f.total), xmlUrl: f.xmlUrl, pdfUrl: f.pdfUrl, createdAt: f.createdAt };
}

/** ¿La columna existe? Expuesto para que la ruta pueda contestar 503 claro (SQL pendiente) en vez de un 500 críptico. */
export async function columnaPagoListaParaCfdi(db: Db = prisma): Promise<boolean> {
  return columnaExiste(db);
}

/**
 * El CFDI (vigente o apartado) de UN pago, si lo hay. `null` sin columna o sin fila.
 */
export async function buscarCfdiDePago(db: Db, args: { clinicId: string; paymentId: string }): Promise<CfdiDePagoFila | null> {
  if (!(await columnaExiste(db))) return null;
  try {
    const filas = await db.$queryRaw<FilaCruda[]>`
      SELECT "id", "uuid", "status", "total", "xmlUrl", "pdfUrl", "createdAt"
        FROM "cfdi_records"
       WHERE "clinicId" = ${args.clinicId} AND "paymentId" = ${args.paymentId}
       LIMIT 1`;
    return filas[0] ? deFila(filas[0]) : null;
  } catch (e) {
    console.warn("[cfdi:pago] no se pudo leer el CFDI del pago:", e);
    return null;
  }
}

/** El CFDI (vigente o apartado) de VARIOS pagos de una factura, para la insignia de cada fila. */
export async function listarCfdiDePagos(db: Db, args: { clinicId: string; invoiceId: string }): Promise<Map<string, CfdiDePagoFila>> {
  const salida = new Map<string, CfdiDePagoFila>();
  if (!(await columnaExiste(db))) return salida;
  try {
    const filas = await db.$queryRaw<(FilaCruda & { paymentId: string })[]>`
      SELECT "id", "paymentId", "uuid", "status", "total", "xmlUrl", "pdfUrl", "createdAt"
        FROM "cfdi_records"
       WHERE "clinicId" = ${args.clinicId} AND "invoiceId" = ${args.invoiceId} AND "paymentId" IS NOT NULL`;
    for (const f of filas) salida.set(f.paymentId, deFila(f));
    return salida;
  } catch (e) {
    console.warn("[cfdi:pago] no se pudieron leer en lote:", e);
    return salida;
  }
}

/**
 * Suma de lo YA timbrado válido de una factura — de su CFDI completo (si lo
 * tuviera, `paymentId` NULL) más todos sus CFDI por pago. Sirve para el
 * candado «la suma de los CFDI nunca pasa del total del caso».
 */
export async function sumaCfdiValidaDeFactura(db: Db, args: { clinicId: string; invoiceId: string }): Promise<number> {
  if (!(await columnaExiste(db))) {
    // Sin la columna, un CFDI de factura completa sigue siendo el único que
    // puede existir — se cuenta igual, vía Prisma normal.
    const agg = await (db as typeof prisma).cfdiRecord.aggregate({
      where: { clinicId: args.clinicId, invoiceId: args.invoiceId, status: "valid" },
      _sum: { total: true },
    });
    return agg._sum.total ?? 0;
  }
  try {
    const filas = await db.$queryRaw<{ suma: unknown }[]>`
      SELECT COALESCE(SUM("total"), 0) AS suma
        FROM "cfdi_records"
       WHERE "clinicId" = ${args.clinicId} AND "invoiceId" = ${args.invoiceId} AND "status" = 'valid'`;
    return Number(filas[0]?.suma ?? 0);
  } catch (e) {
    console.warn("[cfdi:pago] no se pudo sumar lo timbrado:", e);
    // Lado seguro: si no se puede saber cuánto hay timbrado, se asume "todo"
    // para que el candado de arriba BLOQUEE en vez de dejar pasar un timbrado
    // que sí podría rebasar el total.
    return Infinity;
  }
}

/** ¿Esta factura ya tiene AL MENOS un pago con CFDI vigente? Bloquea timbrar/cancelar/reembolsar la factura completa. */
export async function algunPagoTieneCfdiVigente(db: Db, args: { clinicId: string; invoiceId: string }): Promise<boolean> {
  if (!(await columnaExiste(db))) return false;
  try {
    const filas = await db.$queryRaw<{ existe: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM "cfdi_records"
         WHERE "clinicId" = ${args.clinicId} AND "invoiceId" = ${args.invoiceId}
           AND "paymentId" IS NOT NULL AND "status" = 'valid'
      ) AS existe`;
    return filas[0]?.existe === true;
  } catch (e) {
    console.warn("[cfdi:pago] no se pudo comprobar CFDI por pago:", e);
    // Lado seguro: no se sabe → se asume que sí hay, para no dejar
    // cancelar/reembolsar/timbrar la factura completa por encima de un CFDI
    // por pago que sí existe y esta consulta no pudo ver.
    return true;
  }
}

// Forma plana (no unión discriminada) a propósito: más simple de consumir
// desde la ruta sin depender del estrechamiento de tipos por control de flujo.
export interface ApartarResultado {
  ok: boolean;
  id: string | null;
  motivo: "sinColumna" | "yaTieneCfdi" | null;
}

/**
 * Reserva la fila ANTES de llamarle a Facturapi. Atómico: el índice único
 * parcial sobre "paymentId" hace que dos peticiones a la vez para el MISMO
 * pago solo dejen pasar una (la otra recibe 0 filas de `RETURNING`).
 */
export async function apartarCfdiDePago(db: Db, args: {
  clinicId: string; invoiceId: string; paymentId: string; claim: string; monto: number;
}): Promise<ApartarResultado> {
  if (!(await columnaExiste(db))) return { ok: false, id: null, motivo: "sinColumna" };
  const id = crypto.randomUUID();
  try {
    const filas = await db.$queryRaw<{ id: string }[]>`
      INSERT INTO "cfdi_records"
        ("id", "clinicId", "invoiceId", "paymentId", "facturapiId", "uuid",
         "tipoComprobante", "receptor", "conceptos", "total", "status", "createdAt")
      VALUES
        (${id}, ${args.clinicId}, ${args.invoiceId}, ${args.paymentId}, ${args.claim}, ${args.claim},
         'I', '{}'::jsonb, '[]'::jsonb, ${args.monto}, 'apartado', CURRENT_TIMESTAMP)
      ON CONFLICT ("paymentId") WHERE "paymentId" IS NOT NULL DO NOTHING
      RETURNING "id"`;
    if (filas.length === 0) return { ok: false, id: null, motivo: "yaTieneCfdi" };
    return { ok: true, id, motivo: null };
  } catch (e) {
    console.warn("[cfdi:pago] no se pudo apartar:", e);
    return { ok: false, id: null, motivo: "yaTieneCfdi" };
  }
}

/** El timbrado SÍ salió: la fila apartada pasa a 'valid' con los datos reales. */
export async function confirmarCfdiDePago(db: Db, args: {
  id: string; claim: string; uuid: string; facturapiId: string;
  receptor: unknown; conceptos: unknown; total: number; xmlUrl: string | null; pdfUrl: string | null;
}): Promise<CfdiDePagoFila | null> {
  try {
    const filas = await db.$queryRaw<FilaCruda[]>`
      UPDATE "cfdi_records"
         SET "uuid" = ${args.uuid}, "facturapiId" = ${args.facturapiId},
             "receptor" = ${JSON.stringify(args.receptor)}::jsonb,
             "conceptos" = ${JSON.stringify(args.conceptos)}::jsonb,
             "total" = ${args.total}, "status" = 'valid',
             "xmlUrl" = ${args.xmlUrl}, "pdfUrl" = ${args.pdfUrl}
       WHERE "id" = ${args.id} AND "status" = 'apartado' AND "uuid" = ${args.claim}
       RETURNING "id", "uuid", "status", "total", "xmlUrl", "pdfUrl", "createdAt"`;
    return filas[0] ? deFila(filas[0]) : null;
  } catch (e) {
    console.error("[cfdi:pago] CFDI timbrado pero no se pudo confirmar la fila:", { id: args.id, uuid: args.uuid, e });
    return null;
  }
}

/**
 * Facturapi contestó que NO timbró (rechazo claro, no incierto): se borra el
 * apartado para poder corregir y reintentar. Nunca se llama si el timbre pudo
 * haber salido (`pudoHaberTimbrado`) — ese caso deja la fila tal cual, a
 * propósito, igual que el apartado de la factura completa.
 */
export async function soltarCfdiDePago(db: Db, args: { id: string; claim: string }): Promise<void> {
  try {
    await db.$executeRaw`
      DELETE FROM "cfdi_records" WHERE "id" = ${args.id} AND "status" = 'apartado' AND "uuid" = ${args.claim}`;
  } catch (e) {
    console.error("[cfdi:pago] no se pudo soltar el apartado:", { id: args.id, e });
  }
}
