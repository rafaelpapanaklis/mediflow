// ═══════════════════════════════════════════════════════════════════════════
// Lectura y escritura de la aceptación por concepto y de los cargos de un
// presupuesto (ws1-t6). Tablas `quote_item_acceptance` y `quote_charges`
// (sql/presupuesto-aceptacion-parcial.sql), con SQL crudo y SIN tocar
// prisma/schema.prisma, por la misma razón que condiciones-pago-db.ts: sin el
// SQL aplicado no se cae nada.
//
// SIN LAS TABLAS LA FUNCIÓN ESTÁ APAGADA: `aceptacionEncendida` dice false, el
// panel no pinta casillas ni «Se cobrará hoy», y aceptar / facturar hacen lo de
// siempre. La pregunta es `to_regclass` (no falla nunca) y la respuesta se
// recuerda en `globalThis`: dev.108 recarga módulos cada pocos segundos y una
// variable de módulo se perdería, lanzando una consulta por petición contra la
// base real (ver la nota de tablas-nuevas-sin-sql). Un «no está» se vuelve a
// preguntar a los 10 min; un «sí está» no se vuelve a preguntar.
//
// Aislamiento: las dos tablas llevan `clinicId` y TODA lectura filtra por el de
// la sesión; los cargos además cruzan con `invoices` de la misma clínica.
// ═══════════════════════════════════════════════════════════════════════════

import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CargoVivo, RenglonAceptado, ViaAceptacion } from "./aceptacion";

type Db = Prisma.TransactionClient | typeof prisma;

const LLAVE = Symbol.for("dalecontrol.quotes.aceptacion-parcial.tablas");
const REPREGUNTAR_MS = 10 * 60_000;

interface Sonda { existe: boolean; at: number }
function memoria(): { v: Sonda | null } {
  const g = globalThis as unknown as Record<symbol, { v: Sonda | null } | undefined>;
  if (!g[LLAVE]) g[LLAVE] = { v: null };
  return g[LLAVE]!;
}

/** Solo para las pruebas. */
export function _olvidarTablas(): void {
  memoria().v = null;
}

/**
 * ¿Están las dos tablas? true / false / null = no se pudo preguntar (un
 * timeout del pooler). `null` no se recuerda: quien llama lo trata como
 * apagado para esta petición y la siguiente vuelve a preguntar.
 */
export async function aceptacionEncendida(db: Db = prisma): Promise<boolean> {
  const m = memoria();
  const ahora = Date.now();
  if (m.v && (m.v.existe || ahora - m.v.at < REPREGUNTAR_MS)) return m.v.existe;
  try {
    const filas = await db.$queryRaw<{ existe: boolean }[]>`
      SELECT (to_regclass('public.quote_item_acceptance') IS NOT NULL
          AND to_regclass('public.quote_charges') IS NOT NULL) AS existe`;
    m.v = { existe: filas[0]?.existe === true, at: ahora };
    return m.v.existe;
  } catch (e) {
    console.warn("[presupuesto:aceptacion] no se pudo comprobar las tablas:", e);
    return false;
  }
}

/* ── Aceptación ───────────────────────────────────────────────────────── */

export interface AceptacionGuardada {
  renglones: RenglonAceptado[];
  via: ViaAceptacion;
  fecha: string | null;
}

interface FilaAceptacion {
  quoteId: string;
  quoteItemId: string;
  aceptado: boolean;
  nombre: string;
  toothFdi: string | null;
  cantidad: number;
  precio: unknown;
  descuento: unknown;
  importe: unknown;
  descuentoGlobal: unknown;
  via: string;
  createdAt: Date | null;
  sortOrder: number | null;
}

const n = (x: unknown) => {
  const v = Number(x);
  return isFinite(v) ? v : 0;
};

/**
 * Aceptación guardada de varios presupuestos, en UNA consulta. Ausente en el
 * mapa = no hay renglones (aceptado antes de esta función, o aún no aceptado).
 * Si la base falla devuelve un mapa vacío con `fallo: true`.
 */
export async function leerAceptaciones(
  db: Db,
  clinicId: string,
  quoteIds: string[],
): Promise<{ porQuote: Map<string, AceptacionGuardada>; fallo: boolean }> {
  const porQuote = new Map<string, AceptacionGuardada>();
  const ids = Array.from(new Set(quoteIds.filter(Boolean)));
  if (!clinicId || ids.length === 0) return { porQuote, fallo: false };
  if (!(await aceptacionEncendida(db))) return { porQuote, fallo: false };
  try {
    const filas = await db.$queryRaw<FilaAceptacion[]>`
      SELECT a."quoteId", a."quoteItemId", a."aceptado", a."nombre", a."toothFdi",
             a."cantidad", a."precio", a."descuento", a."importe", a."descuentoGlobal",
             a."via", a."createdAt", qi."sortOrder"
        FROM "quote_item_acceptance" a
        LEFT JOIN "quote_items" qi ON qi."id" = a."quoteItemId"
       WHERE a."clinicId" = ${clinicId}
         AND a."quoteId" IN (${Prisma.join(ids)})
       ORDER BY a."quoteId", qi."sortOrder" NULLS LAST, a."quoteItemId"`;
    for (const f of filas) {
      let g = porQuote.get(f.quoteId);
      if (!g) {
        g = {
          renglones: [],
          via: f.via === "liga" ? "liga" : "panel",
          fecha: f.createdAt instanceof Date ? f.createdAt.toISOString() : null,
        };
        porQuote.set(f.quoteId, g);
      }
      g.renglones.push({
        quoteItemId: f.quoteItemId,
        aceptado: f.aceptado === true,
        nombre: f.nombre,
        toothFdi: f.toothFdi ?? null,
        cantidad: Math.max(1, Math.floor(n(f.cantidad)) || 1),
        precio: n(f.precio),
        descuento: n(f.descuento),
        importe: n(f.importe),
        descuentoGlobal: n(f.descuentoGlobal),
      });
    }
    return { porQuote, fallo: false };
  } catch (e) {
    console.warn("[presupuesto:aceptacion] no se pudo leer:", e);
    return { porQuote: new Map(), fallo: true };
  }
}

/**
 * Guarda (reemplaza) los renglones de aceptación. Va DENTRO de la transacción
 * que pasa el presupuesto a ACEPTADO: o quedan los dos o ninguno. Lanza si la
 * base falla (la transacción se revierte y el presupuesto no queda aceptado
 * a medias).
 */
export async function guardarAceptacion(
  tx: Prisma.TransactionClient,
  args: {
    quoteId: string;
    clinicId: string;
    renglones: RenglonAceptado[];
    via: ViaAceptacion;
    userId: string | null;
  },
): Promise<void> {
  const { quoteId, clinicId, renglones, via, userId } = args;
  await tx.$executeRaw`
    DELETE FROM "quote_item_acceptance" WHERE "quoteId" = ${quoteId} AND "clinicId" = ${clinicId}`;
  for (const r of renglones) {
    await tx.$executeRaw`
      INSERT INTO "quote_item_acceptance"
        ("quoteItemId", "quoteId", "clinicId", "aceptado", "nombre", "toothFdi",
         "cantidad", "precio", "descuento", "importe", "descuentoGlobal", "via", "aceptadoPorId")
      VALUES
        (${r.quoteItemId}, ${quoteId}, ${clinicId}, ${r.aceptado}, ${r.nombre}, ${r.toothFdi},
         ${r.cantidad}, ${r.precio}::numeric, ${r.descuento}::numeric, ${r.importe}::numeric,
         ${r.descuentoGlobal}::numeric, ${via}, ${userId})`;
  }
}

/* ── Cargos ───────────────────────────────────────────────────────────── */

export interface CargoConFactura extends CargoVivo {
  tipo: "concepto" | "abono";
  invoiceNumber: string;
  status: string;
  createdAt: string | null;
}

interface FilaCargo {
  quoteId: string;
  quoteItemId: string | null;
  invoiceId: string;
  tipo: string;
  monto: unknown;
  invoiceNumber: string;
  status: string;
  createdAt: Date | null;
}

/**
 * Cargos VIVOS (factura no cancelada, de la misma clínica) de varios
 * presupuestos, en UNA consulta. `fallo: true` si la base no contestó: quien
 * cobra NO debe seguir (no sabría qué ya se cargó).
 */
export async function leerCargos(
  db: Db,
  clinicId: string,
  quoteIds: string[],
): Promise<{ porQuote: Map<string, CargoConFactura[]>; fallo: boolean }> {
  const porQuote = new Map<string, CargoConFactura[]>();
  const ids = Array.from(new Set(quoteIds.filter(Boolean)));
  if (!clinicId || ids.length === 0) return { porQuote, fallo: false };
  if (!(await aceptacionEncendida(db))) return { porQuote, fallo: false };
  try {
    const filas = await db.$queryRaw<FilaCargo[]>`
      SELECT c."quoteId", c."quoteItemId", c."invoiceId", c."tipo", c."monto",
             i."invoiceNumber", i."status", c."createdAt"
        FROM "quote_charges" c
        JOIN "invoices" i ON i."id" = c."invoiceId" AND i."clinicId" = ${clinicId}
       WHERE c."clinicId" = ${clinicId}
         AND c."quoteId" IN (${Prisma.join(ids)})
         AND i."status" <> 'CANCELLED'
       ORDER BY c."createdAt", c."id"`;
    for (const f of filas) {
      const lista = porQuote.get(f.quoteId) ?? [];
      lista.push({
        quoteItemId: f.quoteItemId ?? null,
        invoiceId: f.invoiceId,
        monto: n(f.monto),
        tipo: f.tipo === "abono" ? "abono" : "concepto",
        invoiceNumber: f.invoiceNumber,
        status: f.status,
        createdAt: f.createdAt instanceof Date ? f.createdAt.toISOString() : null,
      });
      porQuote.set(f.quoteId, lista);
    }
    return { porQuote, fallo: false };
  } catch (e) {
    console.warn("[presupuesto:cargos] no se pudo leer:", e);
    return { porQuote: new Map(), fallo: true };
  }
}

/** Anota los renglones del cargo recién facturado. Dentro de la tx de la factura. */
export async function insertarCargos(
  tx: Prisma.TransactionClient,
  args: {
    clinicId: string;
    quoteId: string;
    invoiceId: string;
    userId: string | null;
    lineas: Array<{ tipo: "concepto" | "abono"; quoteItemId: string | null; monto: number }>;
  },
): Promise<void> {
  for (const l of args.lineas) {
    await tx.$executeRaw`
      INSERT INTO "quote_charges"
        ("id", "clinicId", "quoteId", "quoteItemId", "invoiceId", "tipo", "monto", "createdById")
      VALUES
        (${randomUUID()}, ${args.clinicId}, ${args.quoteId}, ${l.quoteItemId}, ${args.invoiceId},
         ${l.tipo}, ${l.monto}::numeric, ${args.userId})`;
  }
}
