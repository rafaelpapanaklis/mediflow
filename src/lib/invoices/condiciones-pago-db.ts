// ═══════════════════════════════════════════════════════════════════════════
// Lectura y escritura de las condiciones de pago de una FACTURA (ws1-t1).
//
// Es el primer paso de «Facturación se queda con lo bueno de Presupuestos»: la
// factura aprende a decir «un pago» o «enganche y N mensualidades», igual que el
// presupuesto. La ARITMÉTICA y las PALABRAS no se copian: son las de
// `lib/quotes/condiciones-pago.ts` (centavos enteros, `frasePlan`), para que el
// trato se lea igual en un presupuesto que en la factura que sale de él.
//
// Tabla: `invoice_payment_terms` (sql/factura-condiciones-pago.sql), una fila
// por factura. Mismo patrón que `lib/quotes/condiciones-pago-db.ts`, por las
// mismas dos razones: SQL crudo + sonda `to_regclass` para que SIN EL SQL NO SE
// CAIGA NADA, y no tocar `prisma/schema.prisma`.
//
// ⚠️ Esto NO cobra, NO mueve `paid`/`balance`, NO toca `Invoice.paymentMethod`
// (que alimenta la forma de pago del timbrado) y NO crea un `PaymentPlan`. Es
// una ANOTACIÓN del trato: lo que se acordó con el paciente. El dinero lo siguen
// moviendo Registrar pago y Caja, sin enterarse de esta tabla.
//
// Una diferencia con Presupuestos, a propósito: aquí quien llama SÍ se entera
// de que la tabla no está (`sinTabla`). En un presupuesto, perder la nota de
// «6 mensualidades» mientras no se aplica el SQL era tolerable; en el popup de
// Nueva factura la recepcionista acaba de escribir un enganche y tiene que
// saber que no se guardó. Nunca falla en silencio.
// ═══════════════════════════════════════════════════════════════════════════

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  aFechaSolo,
  condicionesPorDefecto,
  esMetodoPago,
  FRECUENCIAS_PAGO,
  hayCondiciones,
  type CondicionesPago,
  type FrecuenciaPago,
} from "@/lib/quotes/condiciones-pago";

type Db = Prisma.TransactionClient | typeof prisma;

/** Caché de «¿existe la tabla?»: una pregunta por minuto, no una por factura. */
let tabla: { existe: boolean; at: number } | null = null;
const TTL_MS = 60_000;

/**
 * ¿Existe la tabla? `true` / `false` / **`null` = no se pudo averiguar**. Los
 * tres estados importan (ver el mismo comentario en la versión de Presupuestos):
 * un fallo de la sonda no se cachea como «no está».
 */
async function tablaExiste(db: Db): Promise<boolean | null> {
  const t = Date.now();
  if (tabla && (tabla.existe || t - tabla.at < TTL_MS)) return tabla.existe;
  try {
    const filas = await db.$queryRaw<{ existe: boolean }[]>`
      SELECT to_regclass('public.invoice_payment_terms') IS NOT NULL AS existe`;
    tabla = { existe: filas[0]?.existe === true, at: t };
    return tabla.existe;
  } catch (e) {
    console.warn("[factura:condiciones] no se pudo comprobar la tabla:", e);
    return null;
  }
}

/** Solo para las pruebas: olvida lo que se sabía de la tabla. */
export function _olvidarTabla(): void {
  tabla = null;
}

interface Fila {
  invoiceId: string;
  modo: string;
  metodo: string | null;
  enganche: unknown;
  numPagos: number;
  frecuencia: string;
  primerPago: Date | string | null;
  difiereConSuBanco: boolean;
}

function aFecha(x: Date | string | null): string | null {
  if (!x) return null;
  if (x instanceof Date) {
    if (isNaN(x.getTime())) return null;
    // La columna es `date`: el driver la entrega a medianoche UTC. Se lee en
    // UTC para que el 1 de octubre no se vuelva el 30 de septiembre en México.
    return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}-${String(x.getUTCDate()).padStart(2, "0")}`;
  }
  return aFechaSolo(x);
}

function deFila(f: Fila): CondicionesPago {
  const base = condicionesPorDefecto();
  const n = Number(f.enganche);
  return {
    modo: f.modo === "plazos" ? "plazos" : "unico",
    metodo: esMetodoPago(f.metodo) ? f.metodo : null,
    enganche: isFinite(n) ? Math.round(n * 100) / 100 : 0,
    numPagos: Number.isInteger(f.numPagos) ? f.numPagos : base.numPagos,
    frecuencia: (FRECUENCIAS_PAGO as string[]).indexOf(f.frecuencia) !== -1
      ? (f.frecuencia as FrecuenciaPago)
      : "MONTHLY",
    primerPago: aFecha(f.primerPago),
    difiereConSuBanco: f.difiereConSuBanco === true,
  };
}

/**
 * Las condiciones de VARIAS facturas, en UNA consulta (la lista de Facturación
 * trae hasta 100: una consulta por cada una saturaría el pooler).
 *
 * ⚠️ `invoiceIds` tiene que venir YA acotado por clínica y por visibilidad de
 * paciente: la tabla no tiene `clinicId` propio. Aun así la consulta vuelve a
 * cruzar contra `invoices."clinicId"`, para que un id ajeno que se cuele no
 * devuelva nada.
 */
export async function leerCondicionesDeFacturas(
  db: Db,
  args: { clinicId: string; invoiceIds: string[] },
): Promise<{ porFactura: Map<string, CondicionesPago>; fallo: boolean; sinTabla: boolean }> {
  const salida = new Map<string, CondicionesPago>();
  const ids = Array.from(new Set((args.invoiceIds ?? []).filter((x) => typeof x === "string" && x)));
  if (!args.clinicId || ids.length === 0) return { porFactura: salida, fallo: false, sinTabla: false };
  if ((await tablaExiste(db)) === false) return { porFactura: salida, fallo: false, sinTabla: true };
  try {
    const filas = await db.$queryRaw<Fila[]>`
      SELECT t."invoiceId", t."modo", t."metodo", t."enganche", t."numPagos",
             t."frecuencia", t."primerPago", t."difiereConSuBanco"
        FROM "invoice_payment_terms" t
        JOIN "invoices" i ON i."id" = t."invoiceId"
       WHERE i."clinicId" = ${args.clinicId}
         AND t."invoiceId" IN (${Prisma.join(ids)})`;
    filas.forEach((f) => salida.set(f.invoiceId, deFila(f)));
  } catch (e) {
    console.warn("[factura:condiciones] no se pudieron leer en lote:", e);
    return { porFactura: salida, fallo: true, sinTabla: false };
  }
  return { porFactura: salida, fallo: false, sinTabla: false };
}

/** Qué pasó al intentar guardar. */
export interface ResultadoGuardarFactura {
  /** Lo que quedó en la base. `null` = la factura no tiene condiciones. */
  condiciones: CondicionesPago | null;
  /** Había algo que escribir y la base falló. */
  fallo: boolean;
  /** Había algo que escribir y la tabla no existe: falta aplicar el SQL. */
  sinTabla: boolean;
  /** La factura no es de esta clínica (o no existe). */
  ajena: boolean;
}

/**
 * Guarda (o reemplaza) las condiciones de una factura. Unas condiciones que no
 * dicen nada BORRAN la fila en vez de dejar una vacía.
 *
 * `clinicId` sale SIEMPRE de la sesión; aquí se comprueba que la factura sea de
 * esa clínica antes de escribir.
 */
export async function guardarCondicionesDeFactura(
  db: Db,
  args: { invoiceId: string; clinicId: string; condiciones: CondicionesPago | null },
): Promise<ResultadoGuardarFactura> {
  const { invoiceId, clinicId, condiciones } = args;
  const hay = hayCondiciones(condiciones);
  const nada: ResultadoGuardarFactura = { condiciones: null, fallo: false, sinTabla: false, ajena: false };
  if (!invoiceId || !clinicId) return { ...nada, ajena: true };
  if ((await tablaExiste(db)) === false) return { ...nada, sinTabla: hay };

  try {
    const duenia = await db.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "invoices" WHERE "id" = ${invoiceId} AND "clinicId" = ${clinicId} LIMIT 1`;
    if (duenia.length === 0) return { ...nada, ajena: true };

    if (!hay) {
      await db.$executeRaw`DELETE FROM "invoice_payment_terms" WHERE "invoiceId" = ${invoiceId}`;
      return nada;
    }

    const c = condiciones as CondicionesPago;
    await db.$executeRaw`
      INSERT INTO "invoice_payment_terms"
        ("invoiceId", "modo", "metodo", "enganche", "numPagos", "frecuencia",
         "primerPago", "difiereConSuBanco", "updatedAt")
      VALUES
        (${invoiceId}, ${c.modo}, ${c.metodo}, ${c.enganche}::numeric, ${c.numPagos},
         ${c.frecuencia}, ${c.primerPago}::date, ${c.difiereConSuBanco},
         CURRENT_TIMESTAMP)
      ON CONFLICT ("invoiceId") DO UPDATE SET
        "modo" = EXCLUDED."modo",
        "metodo" = EXCLUDED."metodo",
        "enganche" = EXCLUDED."enganche",
        "numPagos" = EXCLUDED."numPagos",
        "frecuencia" = EXCLUDED."frecuencia",
        "primerPago" = EXCLUDED."primerPago",
        "difiereConSuBanco" = EXCLUDED."difiereConSuBanco",
        "updatedAt" = CURRENT_TIMESTAMP`;
    return { ...nada, condiciones: c };
  } catch (e) {
    console.warn("[factura:condiciones] no se pudieron guardar:", e);
    return { ...nada, fallo: hay };
  }
}
