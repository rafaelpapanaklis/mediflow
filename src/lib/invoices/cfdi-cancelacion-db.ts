// ═══════════════════════════════════════════════════════════════════════════
// Cancelación y nota de crédito — acceso a `cfdi_records` (ws1-t3).
//
// SQL CRUDO a propósito, NUNCA declarado en prisma/schema.prisma: el modelo
// CfdiRecord se lee sin `select` en api/cfdi (GET) y en api/cfdi/[cfdiId]/pdf|xml;
// declarar las columnas nuevas y correr `prisma generate` antes de que Rafael
// pegue sql/ws1-t3-cfdi-cancelacion.sql tumbaría esas rutas con P2022. Mismo
// patrón que `paymentId` (cfdi-pago-db.ts).
//
// Sin el SQL:
//   · pedir una cancelación o una nota de crédito contesta 503 con el nombre
//     del archivo (no hay dónde guardar el candado ni el motivo);
//   · «Consultar estado en el SAT», el webhook y el cron SÍ funcionan: solo
//     escriben `status` y `cancelledAt`, que ya existen.
//
// La pregunta «¿existen las columnas?» se hace con information_schema (nunca
// falla), SOLO en el esquema actual — la base real tiene otra copia de
// cfdi_records en otro esquema (sonda del 3-oct-2026) —, y se recuerda en globalThis — sobrevive a las recargas de `next dev` —
// para no llenar los logs de Postgres de errores de columna inexistente.
// ═══════════════════════════════════════════════════════════════════════════

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { EstadoCancelacion, EfectoEstado } from "./cfdi-cancelacion";
import { RESERVA_CANCELACION_MIN } from "./cfdi-cancelacion";

type Db = Prisma.TransactionClient | typeof prisma;

export const SQL_CANCELACION = "sql/ws1-t3-cfdi-cancelacion.sql";

// ── Sonda de columnas ────────────────────────────────────────────────────────

interface Columnas { cancelacion: boolean; pago: boolean; at: number }
const CLAVE = Symbol.for("dalecontrol.cfdi-cancelacion.columnas");
const TTL_AUSENTE_MS = 10 * 60_000;

function cache(): { v: Columnas | null } {
  const g = globalThis as any;
  if (!g[CLAVE]) g[CLAVE] = { v: null };
  return g[CLAVE];
}

/** Solo para pruebas. */
export function _olvidarColumnasCancelacion(): void {
  cache().v = null;
}

export async function columnasCfdi(db: Db = prisma, opts?: { refrescar?: boolean }): Promise<Columnas> {
  const c = cache();
  const t = Date.now();
  if (!opts?.refrescar && c.v && ((c.v.cancelacion && c.v.pago) || t - c.v.at < TTL_AUSENTE_MS)) return c.v;
  try {
    const filas = await db.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'cfdi_records'
         AND column_name IN ('cancellationStatus', 'relatedUuid', 'satCheckedAt', 'paymentId')`;
    const n = new Set(filas.map((f) => f.column_name));
    c.v = {
      cancelacion: n.has("cancellationStatus") && n.has("relatedUuid") && n.has("satCheckedAt"),
      pago: n.has("paymentId"),
      at: t,
    };
  } catch (e) {
    console.warn("[cfdi:cancelacion] no se pudieron leer las columnas de cfdi_records:", e);
    c.v = { cancelacion: false, pago: false, at: t };
  }
  return c.v;
}

// ── Lectura ──────────────────────────────────────────────────────────────────

export interface CfdiFila {
  id: string;
  clinicId: string;
  invoiceId: string | null;
  paymentId: string | null;
  facturapiId: string;
  uuid: string;
  tipoComprobante: string;
  receptor: any;
  conceptos: any;
  total: number;
  status: string;
  cancelledAt: Date | null;
  createdAt: Date;
  cancellationStatus: EstadoCancelacion | null;
  cancelMotive: string | null;
  cancelReason: string | null;
  cancelRequestedAt: Date | null;
  cancelRequestedBy: string | null;
  substitutedByUuid: string | null;
  relatedUuid: string | null;
  relationType: string | null;
  refundPaymentId: string | null;
  satCheckedAt: Date | null;
}

const NULOS = {
  cancellationStatus: null, cancelMotive: null, cancelReason: null, cancelRequestedAt: null,
  cancelRequestedBy: null, substitutedByUuid: null, relatedUuid: null, relationType: null,
  refundPaymentId: null, satCheckedAt: null,
} as const;

function deFila(f: any, col: Columnas): CfdiFila {
  return {
    id: f.id, clinicId: f.clinicId, invoiceId: f.invoiceId ?? null,
    paymentId: col.pago ? (f.paymentId ?? null) : null,
    facturapiId: f.facturapiId, uuid: f.uuid, tipoComprobante: f.tipoComprobante,
    receptor: f.receptor, conceptos: f.conceptos, total: Number(f.total), status: f.status,
    cancelledAt: f.cancelledAt ?? null, createdAt: f.createdAt,
    ...(col.cancelacion
      ? {
          cancellationStatus: f.cancellationStatus ?? null,
          cancelMotive: f.cancelMotive ?? null,
          cancelReason: f.cancelReason ?? null,
          cancelRequestedAt: f.cancelRequestedAt ?? null,
          cancelRequestedBy: f.cancelRequestedBy ?? null,
          substitutedByUuid: f.substitutedByUuid ?? null,
          relatedUuid: f.relatedUuid ?? null,
          relationType: f.relationType ?? null,
          refundPaymentId: f.refundPaymentId ?? null,
          satCheckedAt: f.satCheckedAt ?? null,
        }
      : NULOS),
  };
}

/** `SELECT *` + filtros: con o sin las columnas nuevas, la consulta es válida. */
async function leer(db: Db, where: Prisma.Sql, limite = 200): Promise<CfdiFila[]> {
  const col = await columnasCfdi(db);
  const filas = await db.$queryRaw<any[]>`SELECT * FROM "cfdi_records" WHERE ${where} ORDER BY "createdAt" ASC LIMIT ${limite}`;
  return filas.map((f) => deFila(f, col));
}

/** Un CFDI de la clínica, por su id. 🔴 Siempre con `clinicId` (regla c). */
export async function leerCfdi(db: Db, args: { clinicId: string; cfdiId: string }): Promise<CfdiFila | null> {
  if (!args.clinicId || !args.cfdiId) return null;
  const filas = await leer(db, Prisma.sql`"clinicId" = ${args.clinicId} AND "id" = ${args.cfdiId}`, 1);
  return filas[0] ?? null;
}

/** Por id de Facturapi (webhook). Puede tocar varias clínicas solo si se repite el id, cosa que no pasa. */
export async function leerCfdiPorFacturapiId(db: Db, facturapiId: string): Promise<CfdiFila | null> {
  if (!facturapiId) return null;
  const filas = await leer(db, Prisma.sql`"facturapiId" = ${facturapiId}`, 1);
  return filas[0] ?? null;
}

/** Todos los CFDI de una factura (ingreso, por pago y egresos), del más viejo al más nuevo. */
export async function cfdisDeFactura(db: Db, args: { clinicId: string; invoiceId: string }): Promise<CfdiFila[]> {
  if (!args.clinicId || !args.invoiceId) return [];
  return leer(db, Prisma.sql`"clinicId" = ${args.clinicId} AND "invoiceId" = ${args.invoiceId}`, 100);
}

/** Notas de crédito (egresos) VIGENTES que relacionan a `uuid`. Sin las columnas: ninguna puede existir. */
export async function egresosVigentesDe(db: Db, args: { clinicId: string; uuid: string }): Promise<CfdiFila[]> {
  const col = await columnasCfdi(db);
  if (!col.cancelacion) return [];
  return leer(db, Prisma.sql`"clinicId" = ${args.clinicId} AND "tipoComprobante" = 'E'
    AND "status" = 'valid' AND "relatedUuid" = ${args.uuid}`, 100);
}

/**
 * Para el cron: cancelaciones en curso (pendientes de aceptación, verificando o
 * inciertas) y, después, los CFDI vigentes que hace más tiempo no se revisan
 * (para enterarse de lo que se cancela desde el dashboard de Facturapi).
 * Solo los últimos `dias` días; nada de toda la historia.
 */
export async function cfdisPorRevisar(db: Db, args: { limite: number; dias: number }): Promise<CfdiFila[]> {
  const col = await columnasCfdi(db);
  const desde = new Date(Date.now() - args.dias * 86_400_000);
  if (!col.cancelacion) {
    // Sin columnas no hay ni «en curso» ni «revisado en»: solo un barrido corto
    // de lo vigente más reciente.
    const fs = await db.$queryRaw<any[]>`
      SELECT * FROM "cfdi_records"
       WHERE "status" IN ('valid', 'sustituido') AND "createdAt" >= ${desde} AND "uuid" NOT LIKE 'reservando:%'
       ORDER BY "createdAt" DESC LIMIT ${args.limite}`;
    return fs.map((f) => deFila(f, col));
  }
  const filas = await db.$queryRaw<any[]>`
    SELECT * FROM "cfdi_records"
     WHERE "status" IN ('valid', 'sustituido') AND "uuid" NOT LIKE 'reservando:%'
       AND ("cancellationStatus" IN ('pending', 'verifying', 'incierto', 'enviando')
            OR "createdAt" >= ${desde})
     ORDER BY CASE WHEN "cancellationStatus" IN ('pending', 'verifying', 'incierto', 'enviando') THEN 0 ELSE 1 END,
              "satCheckedAt" ASC NULLS FIRST, "createdAt" DESC
     LIMIT ${args.limite}`;
  return filas.map((f) => deFila(f, col));
}

// ── Escritura ────────────────────────────────────────────────────────────────

/**
 * 🔴 EL CANDADO contra la doble cancelación (la misma lección que H-66 del
 * instituto). Un UPDATE … WHERE condicionado es atómico en Postgres: de dos
 * peticiones a la vez solo una se lleva la fila. Una reserva «enviando» de más
 * de RESERVA_CANCELACION_MIN minutos (proceso muerto a media llamada) se puede
 * volver a tomar; «incierto», «pending» y «verifying» NO.
 */
export async function reservarCancelacion(db: Db, args: {
  clinicId: string; cfdiId: string; motive: string; reason: string; userId: string; sustitutoUuid: string | null;
}): Promise<boolean> {
  const caduca = new Date(Date.now() - RESERVA_CANCELACION_MIN * 60_000);
  const n = await db.$executeRaw`
    UPDATE "cfdi_records"
       SET "cancellationStatus" = 'enviando', "cancelMotive" = ${args.motive}, "cancelReason" = ${args.reason},
           "cancelRequestedAt" = CURRENT_TIMESTAMP, "cancelRequestedBy" = ${args.userId},
           "substitutedByUuid" = ${args.sustitutoUuid}
     WHERE "id" = ${args.cfdiId} AND "clinicId" = ${args.clinicId} AND "status" IN ('valid', 'sustituido')
       AND ("cancellationStatus" IS NULL OR "cancellationStatus" IN ('none', 'rejected', 'expired')
            OR ("cancellationStatus" = 'enviando' AND "cancelRequestedAt" < ${caduca}))`;
  return n === 1;
}

/** Facturapi rechazó la petición (4xx): se suelta la reserva para poder corregir y reintentar. */
export async function soltarReserva(db: Db, args: { clinicId: string; cfdiId: string }): Promise<void> {
  await db.$executeRaw`
    UPDATE "cfdi_records" SET "cancellationStatus" = 'none'
     WHERE "id" = ${args.cfdiId} AND "clinicId" = ${args.clinicId} AND "cancellationStatus" = 'enviando'`;
}

/** Se mandó y no se sabe si llegó: queda «incierto» hasta que alguien consulte el estado. */
export async function marcarIncierta(db: Db, args: { clinicId: string; cfdiId: string }): Promise<void> {
  await db.$executeRaw`
    UPDATE "cfdi_records" SET "cancellationStatus" = 'incierto'
     WHERE "id" = ${args.cfdiId} AND "clinicId" = ${args.clinicId} AND "cancellationStatus" = 'enviando'`;
}

export interface ResultadoAplicar {
  /** El CFDI pasó de vigente a cancelado en ESTA escritura (para la bitácora: una vez). */
  recienCancelado: boolean;
  /** La factura interna quedó libre para volver a timbrarse. */
  facturaLiberada: boolean;
}

/**
 * Escribe lo que dijo Facturapi. Si quedó cancelado, en la MISMA transacción
 * suelta la factura (`invoices.cfdiUuid` → NULL) cuando corresponde — ver
 * `soltarFacturaAlCancelar`. Idempotente: aplicar dos veces el mismo estado no
 * cambia nada la segunda.
 *
 * Un `none` que llega mientras nosotros teníamos «enviando» reciente NO borra
 * la reserva (la respuesta del DELETE puede ir por delante); sí aclara un
 * «incierto»: Facturapi dice que no hay cancelación, así que no llegó.
 */
export async function aplicarEstado(args: {
  cfdi: CfdiFila;
  efecto: EfectoEstado;
  soltarFactura: boolean;
}): Promise<ResultadoAplicar> {
  const { cfdi, efecto } = args;
  const col = await columnasCfdi(prisma);
  return prisma.$transaction(async (tx) => {
    let recienCancelado = false;
    if (efecto.status === "cancelled") {
      const n = col.cancelacion
        ? await tx.$executeRaw`
            UPDATE "cfdi_records"
               SET "status" = 'cancelled', "cancelledAt" = COALESCE("cancelledAt", CURRENT_TIMESTAMP),
                   "cancellationStatus" = 'accepted', "satCheckedAt" = CURRENT_TIMESTAMP
             WHERE "id" = ${cfdi.id} AND "clinicId" = ${cfdi.clinicId} AND "status" IN ('valid', 'sustituido')`
        : await tx.$executeRaw`
            UPDATE "cfdi_records"
               SET "status" = 'cancelled', "cancelledAt" = COALESCE("cancelledAt", CURRENT_TIMESTAMP)
             WHERE "id" = ${cfdi.id} AND "clinicId" = ${cfdi.clinicId} AND "status" IN ('valid', 'sustituido')`;
      recienCancelado = n === 1;
    } else if (col.cancelacion) {
      const cs = efecto.cancellationStatus;
      if (cs === "none") {
        await tx.$executeRaw`
          UPDATE "cfdi_records"
             SET "cancellationStatus" = CASE
                   WHEN "cancellationStatus" = 'enviando' AND "cancelRequestedAt" > CURRENT_TIMESTAMP - INTERVAL '10 minutes'
                     THEN "cancellationStatus"
                   WHEN "cancellationStatus" IS NULL THEN NULL
                   ELSE 'none' END,
                 "satCheckedAt" = CURRENT_TIMESTAMP
           WHERE "id" = ${cfdi.id} AND "clinicId" = ${cfdi.clinicId} AND "status" IN ('valid', 'sustituido')`;
      } else {
        await tx.$executeRaw`
          UPDATE "cfdi_records" SET "cancellationStatus" = ${cs}, "satCheckedAt" = CURRENT_TIMESTAMP
           WHERE "id" = ${cfdi.id} AND "clinicId" = ${cfdi.clinicId} AND "status" IN ('valid', 'sustituido')`;
      }
    }

    let facturaLiberada = false;
    if (efecto.status === "cancelled" && args.soltarFactura && cfdi.invoiceId) {
      const r = await tx.invoice.updateMany({
        where: { id: cfdi.invoiceId, clinicId: cfdi.clinicId, cfdiUuid: cfdi.uuid },
        data: { cfdiUuid: null },
      });
      facturaLiberada = r.count === 1;
    }
    return { recienCancelado, facturaLiberada };
  });
}

/** Marca de «revisado en el SAT» para el barrido del cron (sin columnas: nada). */
export async function marcarRevisado(db: Db, args: { clinicId: string; cfdiId: string }): Promise<void> {
  const col = await columnasCfdi(db);
  if (!col.cancelacion) return;
  await db.$executeRaw`
    UPDATE "cfdi_records" SET "satCheckedAt" = CURRENT_TIMESTAMP
     WHERE "id" = ${args.cfdiId} AND "clinicId" = ${args.clinicId}`;
}

/**
 * Sustitución (motivo 01): el CFDI viejo pasa de 'valid' a 'sustituido' JUSTO
 * antes de guardar el nuevo (ver STATUS_SUSTITUIDO). Nunca lanza: lo llama
 * POST /api/cfdi con el sustituto YA timbrado.
 */
export async function marcarSustituido(db: Db, args: { clinicId: string; cfdiId: string; nuevoUuid: string }): Promise<boolean> {
  try {
    const col = await columnasCfdi(db);
    const n = col.cancelacion
      ? await db.$executeRaw`
          UPDATE "cfdi_records" SET "status" = 'sustituido', "substitutedByUuid" = ${args.nuevoUuid}
           WHERE "id" = ${args.cfdiId} AND "clinicId" = ${args.clinicId} AND "status" = 'valid'`
      : await db.$executeRaw`
          UPDATE "cfdi_records" SET "status" = 'sustituido'
           WHERE "id" = ${args.cfdiId} AND "clinicId" = ${args.clinicId} AND "status" = 'valid'`;
    return n === 1;
  } catch (e) {
    console.error("[cfdi:sustitucion] no se pudo marcar el CFDI viejo como sustituido:", { ...args, e });
    return false;
  }
}

/**
 * Registra la relación de un CFDI recién timbrado: 04 (sustituye a…) o 01 (nota
 * de crédito de…), y el reembolso interno al que va ligado el egreso.
 */
export async function registrarRelacion(db: Db, args: {
  clinicId: string; cfdiId: string; relatedUuid: string; relationType: "01" | "04"; refundPaymentId?: string | null;
}): Promise<boolean> {
  const col = await columnasCfdi(db);
  if (!col.cancelacion) return false;
  const n = await db.$executeRaw`
    UPDATE "cfdi_records"
       SET "relatedUuid" = ${args.relatedUuid}, "relationType" = ${args.relationType},
           "refundPaymentId" = ${args.refundPaymentId ?? null}
     WHERE "id" = ${args.cfdiId} AND "clinicId" = ${args.clinicId}`;
  return n === 1;
}
