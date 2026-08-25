/**
 * DaleControl BARBER — "¿esto falló porque la base va ATRÁS del schema?"
 *
 * Varias tablas y columnas del vertical nacieron en sql/barber_*.sql antes
 * de entrar a prisma/schema.prisma. Ya están en el schema (y en la
 * migración 20260825120000_barber_deuda_tecnica_tablas_sql), pero la red
 * de seguridad se queda: si una base todavía no las tiene, la pantalla que
 * las usa cae a sus valores por defecto y lo avisa, en vez de tronar.
 *
 * Con SQL crudo el error era el de Postgres (42P01 relación inexistente,
 * 42703 columna inexistente, envueltos en P2010). Con el cliente Prisma es
 * P2021 (tabla) y P2022 (columna). Aquí se reconocen las CUATRO formas —
 * más el texto, por si la versión del cliente cambia dónde deja el código —
 * para que ningún módulo tenga que volver a adivinar.
 *
 * Client-safe (sin prisma, sin "server-only"): solo mira la forma del error.
 */

interface PrismaLikeError {
  code?: unknown;
  meta?: { code?: unknown } | null;
  message?: unknown;
}

function asPrismaLike(e: unknown): PrismaLikeError | null {
  return e && typeof e === "object" ? (e as PrismaLikeError) : null;
}

function nativeCode(e: PrismaLikeError): string {
  const meta = e.meta && typeof e.meta === "object" ? e.meta : null;
  return meta && meta.code !== undefined && meta.code !== null ? String(meta.code) : "";
}

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  const p = asPrismaLike(e);
  return p && typeof p.message === "string" ? p.message : "";
}

/** La TABLA no existe: P2021 del cliente, 42P01 en crudo, o el texto. */
export function isMissingTableError(e: unknown): boolean {
  const p = asPrismaLike(e);
  if (p) {
    if (p.code === "P2021") return true;
    if (nativeCode(p) === "42P01") return true;
  }
  return /42P01|relation "[^"]+" does not exist|does not exist in the current database|no existe la relaci/i.test(
    messageOf(e),
  );
}

/** La COLUMNA no existe: P2022 del cliente, 42703 en crudo, o el texto. */
export function isMissingColumnError(e: unknown): boolean {
  const p = asPrismaLike(e);
  if (p) {
    if (p.code === "P2022") return true;
    if (nativeCode(p) === "42703") return true;
  }
  return /42703|column "[^"]+" does not exist|column `[^`]+` does not exist|does not exist in the current database|no existe la columna/i.test(
    messageOf(e),
  );
}

/** Tabla o columna ausentes: la base va atrás del schema. */
export function isSchemaBehindError(e: unknown): boolean {
  return isMissingTableError(e) || isMissingColumnError(e);
}
