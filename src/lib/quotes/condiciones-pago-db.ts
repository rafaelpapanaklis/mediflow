// ═══════════════════════════════════════════════════════════════════════════
// Lectura y escritura de las condiciones de pago de un presupuesto.
//
// Tabla: `quote_payment_terms` (sql/presupuesto-condiciones-pago.sql), una fila
// por presupuesto. Se accede con SQL crudo y NO se toca `prisma/schema.prisma`,
// por dos razones que se sostienen solas:
//
//  1. SIN EL SQL NO SE CAE NADA. Antes de leer o escribir se pregunta si la
//     tabla existe (`to_regclass`, que no lanza). Mientras Rafael no aplique el
//     archivo, todo devuelve `null`, el presupuesto se guarda igual que hoy y
//     Presupuestos se ve exactamente como siempre. Si en cambio esto viviera
//     como columnas del modelo `Quote`, cada `findMany` de presupuestos pediría
//     columnas inexistentes y la pantalla entera daría 500 hasta que el SQL se
//     aplicara: el deploy y el SQL tendrían que ir clavados en el mismo minuto.
//
//  2. `prisma/schema.prisma` es el archivo con más tráfico del repo y ahora
//     mismo hay una integración de seis ramas en vuelo. Un modelo nuevo ahí es
//     un conflicto asegurado para quien integra, a cambio de nada: esta tabla
//     no tiene relaciones que Prisma necesite resolver.
//
// El fallo NUNCA sube: si la consulta revienta se anota en el log y se sigue.
// Las condiciones de pago son un añadido comercial del presupuesto — que se
// pierda una nota de «6 mensualidades» no puede tumbar el alta del presupuesto
// ni la factura que cuelga de él.
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
} from "./condiciones-pago";

type Db = Prisma.TransactionClient | typeof prisma;

/** Caché de «¿existe la tabla?»: una pregunta por minuto, no una por presupuesto. */
let tabla: { existe: boolean; at: number } | null = null;
const TTL_MS = 60_000;

/**
 * ¿Existe la tabla? `true` / `false` / **`null` = no se pudo averiguar**.
 *
 * Los tres estados importan y el tercero es el que cuesta caro si se colapsa
 * con el segundo. Un fallo de la sonda (un timeout del pooler bajo carga, que
 * es justo lo que la regla de la casa advierte) NO es «la tabla no está»: si se
 * cacheara como tal, durante el minuto siguiente TODOS los presupuestos que se
 * guardaran con un plan a plazos lo perderían en silencio, y al expirar la
 * caché reaparecerían las condiciones viejas. Por eso un fallo devuelve `null`,
 * no se cachea, y quien llama intenta la consulta de verdad: si la tabla
 * tampoco está, su propio `try/catch` lo recoge.
 *
 * Un `false` (la sonda respondió «no está») sí se cachea: es el estado normal
 * mientras Rafael no aplique el SQL, y evita una consulta por presupuesto. Un
 * `true` se cachea para siempre: una tabla no desaparece.
 */
async function tablaExiste(db: Db): Promise<boolean | null> {
  const t = Date.now();
  if (tabla && (tabla.existe || t - tabla.at < TTL_MS)) return tabla.existe;
  try {
    const filas = await db.$queryRaw<{ existe: boolean }[]>`
      SELECT to_regclass('public.quote_payment_terms') IS NOT NULL AS existe`;
    tabla = { existe: filas[0]?.existe === true, at: t };
    return tabla.existe;
  } catch (e) {
    console.warn("[presupuesto:condiciones] no se pudo comprobar la tabla:", e);
    return null;
  }
}

/** La sonda dijo que NO está (no «no se pudo preguntar»): no hay nada que hacer. */
async function seguroQueNoEsta(db: Db): Promise<boolean> {
  return (await tablaExiste(db)) === false;
}

/** Solo para las pruebas: olvida lo que se sabía de la tabla. */
export function _olvidarTabla(): void {
  tabla = null;
}

interface Fila {
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

/** Lo leído, y si la lectura FALLÓ (que no es lo mismo que «no hay nada»). */
export interface ResultadoLeer {
  condiciones: CondicionesPago | null;
  /**
   * `true` si la base no contestó. Distinto de `condiciones: null`, que quiere
   * decir «este presupuesto no tiene formas de pago».
   *
   * La diferencia no es cosmética: el editor arranca su estado con lo que
   * venga de aquí y al guardar manda ese estado de vuelta. Si un timeout del
   * pooler se leyera como «no tiene plan», abrir el presupuesto y corregirle
   * una coma BORRARÍA las 12 mensualidades que el paciente ya firmó. Con el
   * tercer estado, el editor sabe que no sabe y no toca las condiciones.
   */
  fallo: boolean;
}

/**
 * Las condiciones de UN presupuesto. `condiciones: null` = el presupuesto no
 * tiene, o el SQL todavía no está aplicado: los dos se pintan igual, sin
 * sección de formas de pago. `fallo: true` = la base no contestó.
 */
export async function leerCondiciones(
  db: Db,
  quoteId: string,
): Promise<ResultadoLeer> {
  const nada: ResultadoLeer = { condiciones: null, fallo: false };
  if (!quoteId) return nada;
  if (await seguroQueNoEsta(db)) return nada;
  try {
    const filas = await db.$queryRaw<Fila[]>`
      SELECT "modo", "metodo", "enganche", "numPagos", "frecuencia",
             "primerPago", "difiereConSuBanco"
        FROM "quote_payment_terms"
       WHERE "quoteId" = ${quoteId}
       LIMIT 1`;
    return { condiciones: filas[0] ? deFila(filas[0]) : null, fallo: false };
  } catch (e) {
    console.warn("[presupuesto:condiciones] no se pudieron leer:", e);
    return { condiciones: null, fallo: true };
  }
}

/**
 * Las condiciones de VARIOS presupuestos, en UNA consulta. La lista de
 * presupuestos de un paciente puede traer decenas: una consulta por cada una
 * satura el pooler (la regla de la casa: menos de 7 por `Promise.all`).
 */
export async function leerCondicionesDeVarios(
  db: Db,
  quoteIds: string[],
): Promise<{ porQuote: Map<string, CondicionesPago>; fallo: boolean }> {
  const salida = new Map<string, CondicionesPago>();
  const ids = Array.from(new Set((quoteIds ?? []).filter((x) => typeof x === "string" && x)));
  if (ids.length === 0) return { porQuote: salida, fallo: false };
  if (await seguroQueNoEsta(db)) return { porQuote: salida, fallo: false };
  try {
    const filas = await db.$queryRaw<(Fila & { quoteId: string })[]>`
      SELECT "quoteId", "modo", "metodo", "enganche", "numPagos", "frecuencia",
             "primerPago", "difiereConSuBanco"
        FROM "quote_payment_terms"
       WHERE "quoteId" IN (${Prisma.join(ids)})`;
    filas.forEach((f) => salida.set(f.quoteId, deFila(f)));
  } catch (e) {
    console.warn("[presupuesto:condiciones] no se pudieron leer en lote:", e);
    return { porQuote: salida, fallo: true };
  }
  return { porQuote: salida, fallo: false };
}

/** Qué pasó al intentar guardar. */
export interface ResultadoGuardar {
  /** Lo que quedó en la base. `null` = no hay condiciones para este presupuesto. */
  condiciones: CondicionesPago | null;
  /**
   * `true` si había algo que escribir y NO se pudo (la base falló). La tabla
   * ausente NO es un fallo: es el estado normal mientras el SQL no se aplique.
   * La ruta lo devuelve al cliente para que el editor lo diga en vez de cerrar
   * como si el plan de pagos se hubiera guardado.
   */
  fallo: boolean;
}

/**
 * Guarda (o reemplaza) las condiciones de un presupuesto. Unas condiciones que
 * no dicen nada BORRAN la fila en vez de dejar una vacía: así «quitar las
 * formas de pago» es una operación de verdad y el PDF no imprime una sección
 * hueca.
 *
 * Devuelve lo que quedó guardado, para que la respuesta de la API sea el estado
 * real de la base y no el eco de lo que mandó el cliente.
 *
 * ⚠️ El caller pasa `clinicId` y esta función comprueba que el presupuesto sea
 * de esa clínica ANTES de escribir: la tabla no tiene `clinicId` propio (cuelga
 * de `quotes` con ON DELETE CASCADE), así que el aislamiento por inquilino se
 * hace aquí, contra `quotes`, y nunca contra un id que venga del cliente.
 */
export async function guardarCondiciones(
  db: Db,
  args: { quoteId: string; clinicId: string; condiciones: CondicionesPago | null },
): Promise<ResultadoGuardar> {
  const { quoteId, clinicId, condiciones } = args;
  const nada: ResultadoGuardar = { condiciones: null, fallo: false };
  if (!quoteId || !clinicId) return nada;
  // Sin tabla no hay nada que guardar y tampoco es un fallo: es el estado
  // normal hasta que Rafael aplique el SQL.
  if (await seguroQueNoEsta(db)) return nada;

  try {
    // Aislamiento de inquilino: el presupuesto tiene que ser de ESTA clínica.
    // `clinicId` sale siempre de la sesión (getAuthContext), nunca del cuerpo.
    const duenio = await db.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "quotes" WHERE "id" = ${quoteId} AND "clinicId" = ${clinicId} LIMIT 1`;
    if (duenio.length === 0) return nada;

    if (!hayCondiciones(condiciones)) {
      await db.$executeRaw`DELETE FROM "quote_payment_terms" WHERE "quoteId" = ${quoteId}`;
      return nada;
    }

    const c = condiciones as CondicionesPago;
    await db.$executeRaw`
      INSERT INTO "quote_payment_terms"
        ("quoteId", "modo", "metodo", "enganche", "numPagos", "frecuencia",
         "primerPago", "difiereConSuBanco", "updatedAt")
      VALUES
        (${quoteId}, ${c.modo}, ${c.metodo}, ${c.enganche}::numeric, ${c.numPagos},
         ${c.frecuencia}, ${c.primerPago}::date, ${c.difiereConSuBanco},
         CURRENT_TIMESTAMP)
      ON CONFLICT ("quoteId") DO UPDATE SET
        "modo" = EXCLUDED."modo",
        "metodo" = EXCLUDED."metodo",
        "enganche" = EXCLUDED."enganche",
        "numPagos" = EXCLUDED."numPagos",
        "frecuencia" = EXCLUDED."frecuencia",
        "primerPago" = EXCLUDED."primerPago",
        "difiereConSuBanco" = EXCLUDED."difiereConSuBanco",
        "updatedAt" = CURRENT_TIMESTAMP`;
    return { condiciones: c, fallo: false };
  } catch (e) {
    console.warn("[presupuesto:condiciones] no se pudieron guardar:", e);
    // Aquí SÍ es un fallo: había un plan de pagos que escribir y no se escribió.
    // Se avisa en vez de devolver un `null` que el editor leería como «este
    // presupuesto no tiene formas de pago».
    return { condiciones: null, fallo: hayCondiciones(condiciones) };
  }
}

/**
 * Copia las condiciones de un presupuesto a otro. La usa «Duplicar»: si el
 * original se negoció a 6 mensualidades, la copia nace con las mismas.
 */
export async function copiarCondiciones(
  db: Db,
  args: { origenId: string; destinoId: string; clinicId: string },
): Promise<CondicionesPago | null> {
  // El ORIGEN también se comprueba contra la clínica de la sesión. Hoy el único
  // caller ya lo hizo, pero `leerCondiciones` no aísla por inquilino (no puede:
  // la tabla no tiene `clinicId`) y esta firma invita a pasarle un id que venga
  // del cuerpo de la petición. Se defiende aquí, no en el caller.
  if (!args.origenId || !args.clinicId) return null;
  if (await seguroQueNoEsta(db)) return null;
  try {
    const propio = await db.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "quotes"
       WHERE "id" = ${args.origenId} AND "clinicId" = ${args.clinicId} LIMIT 1`;
    if (propio.length === 0) return null;
  } catch (e) {
    console.warn("[presupuesto:condiciones] no se pudo comprobar el origen:", e);
    return null;
  }

  const { condiciones: origen } = await leerCondiciones(db, args.origenId);
  if (!origen) return null;
  return (await guardarCondiciones(db, {
    quoteId: args.destinoId,
    clinicId: args.clinicId,
    condiciones: origen,
  })).condiciones;
}
