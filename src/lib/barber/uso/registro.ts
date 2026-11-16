// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — USO DEL PANEL: escribir los eventos (servidor).
//
// La tabla "barber_usage_events" nace en sql/barber_usage_events.sql, que
// Rafael pega a mano. El cliente de Prisma NO la conoce (no se regenera):
// todo va en SQL crudo y todo DEGRADA. Sin la tabla, `usoListo()` = false,
// la ruta contesta { off: true } y el registrador del navegador se apaga.
//
// Aislamiento: la barbería y el usuario salen SIEMPRE de la sesión
// (getBarberContext), nunca del cuerpo del lote.
// ═══════════════════════════════════════════════════════════════════════
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { isSchemaBehindError } from "@/lib/barber/db-errors";
import { cuantosCaben, horaDelEvento, type UsoEventoValido } from "./uso-core";
import { etiquetaDelPanel } from "./etiquetas";

/** Lo mínimo que se pide de prisma o de un doble de pruebas. */
export type UsoDb = {
  $queryRaw: <T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => Prisma.PrismaPromise<T>;
  $executeRaw: (query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => Prisma.PrismaPromise<number>;
};

/**
 * Caché de «¿ya está la tabla?». El SÍ se queda (hasta que un error diga que
 * la quitaron). El NO se vuelve a mirar cada 5 min: si Rafael pega el SQL con
 * el panel prendido, el registro se enciende solo sin reiniciar.
 */
const REVISAR_NO_CADA_MS = 5 * 60 * 1000;
let listo: boolean | null = null;
let revisadoEn = 0;

export async function usoListo(db: UsoDb, ahora = Date.now()): Promise<boolean> {
  if (listo === true) return true;
  if (listo === false && ahora - revisadoEn < REVISAR_NO_CADA_MS) return false;
  try {
    const rows = await db.$queryRaw<Array<{ t: boolean }>>`
      SELECT (to_regclass('public.barber_usage_events') IS NOT NULL) AS "t"
    `;
    listo = rows[0]?.t === true;
  } catch {
    listo = false;
  }
  revisadoEn = ahora;
  return listo;
}

/** Solo para las pruebas. */
export function olvidarUsoListo(): void {
  listo = null;
  revisadoEn = 0;
}

/** ¿Este error es porque falta (o se quitó) la tabla? Si sí, olvida el «sí está». */
export function olvidarSiFaltaTabla(e: unknown): boolean {
  if (!isSchemaBehindError(e)) return false;
  const msg = e instanceof Error ? e.message : String((e as { message?: unknown } | null)?.message ?? "");
  if (!/barber_usage_events/.test(msg)) return false;
  listo = false;
  revisadoEn = Date.now();
  return true;
}

export interface FilaUso {
  id: string;
  barbershopId: string;
  userId: string;
  sessionId: string;
  type: string;
  screen: string;
  action: string | null;
  target: string | null;
  createdAt: Date;
}

/**
 * Del evento validado a la fila: la acción es la clave data-accion
 * («accion:cobrar») o el texto/plantilla DEL PANEL; un texto que no es del
 * panel se tira (puede ser el nombre de un cliente).
 */
export function aFila(
  e: UsoEventoValido,
  quien: { barbershopId: string; userId: string; sessionId: string },
  ahora: number,
  comparar: (s: string | null) => string | null = etiquetaDelPanel,
): FilaUso {
  let action: string | null = null;
  if (e.type === "CLICK") {
    if (e.accion) action = `accion:${e.accion}`;
    else action = comparar(e.etiqueta);
  }
  return {
    id: randomUUID(),
    barbershopId: quien.barbershopId,
    userId: quien.userId,
    sessionId: quien.sessionId,
    type: e.type,
    screen: e.screen,
    action: action ? action.slice(0, 80) : null,
    target: e.type === "CLICK" ? e.target : null,
    createdAt: horaDelEvento(e.at, ahora),
  };
}

export interface ResultadoRegistro {
  off?: true;
  guardados: number;
  recortados: number;
}

/**
 * Guarda el lote de UN usuario, con el TOPE por usuario y minuto (todas sus
 * pestañas cuentan juntas). Nunca lanza por la tabla: sin ella → off.
 */
export async function registrarLote(
  db: UsoDb,
  quien: { barbershopId: string; userId: string; sessionId: string },
  eventos: UsoEventoValido[],
  ahora = Date.now(),
): Promise<ResultadoRegistro> {
  if (!quien.barbershopId || !quien.userId) return { guardados: 0, recortados: eventos.length };
  if (!(await usoListo(db, ahora))) return { off: true, guardados: 0, recortados: 0 };
  if (eventos.length === 0) return { guardados: 0, recortados: 0 };

  try {
    const desde = new Date(ahora - 60_000);
    const rows = await db.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS "n" FROM "barber_usage_events"
      WHERE "userId" = ${quien.userId} AND "createdAt" >= ${desde}
    `;
    const caben = cuantosCaben(Number(rows[0]?.n ?? 0), eventos.length);
    if (caben === 0) return { guardados: 0, recortados: eventos.length };

    const filas = eventos.slice(0, caben).map((e) => aFila(e, quien, ahora));
    const valores = filas.map(
      (f) => Prisma.sql`(${f.id}, ${f.barbershopId}, ${f.userId}, ${f.sessionId}, ${f.type}, ${f.screen}, ${f.action}, ${f.target}, ${f.createdAt})`,
    );
    await db.$executeRaw`
      INSERT INTO "barber_usage_events"
        ("id", "barbershopId", "userId", "sessionId", "type", "screen", "action", "target", "createdAt")
      VALUES ${Prisma.join(valores)}
    `;
    return { guardados: filas.length, recortados: eventos.length - filas.length };
  } catch (e) {
    if (olvidarSiFaltaTabla(e)) return { off: true, guardados: 0, recortados: 0 };
    throw e;
  }
}
