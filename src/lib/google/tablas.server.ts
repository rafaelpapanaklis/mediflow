/**
 * ¿Ya se pegó sql/salamanca-google.sql? (WS1-T9)
 *
 * Mientras no: NINGUNA consulta toca `google_agenda_imports` ni
 * `agenda_block_google`. Se pregunta con `to_regclass` (no falla ni deja
 * errores en el log de Postgres de producción, que es lo que pasaba al atrapar
 * el 42P01 en cada petición) y la respuesta vive 10 min en `globalThis`, que
 * sobrevive a las recargas de `next dev`. Mismo patrón que
 * src/lib/dinero/ajustes.server.ts.
 *
 * Sin `server-only` a propósito: las pruebas lo importan con un doble de base.
 */

export interface DbSonda {
  $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

const DIEZ_MIN = 10 * 60 * 1000;
const CLAVE = Symbol.for("dalecontrol.ws1-t9.tablas-google");

type Memoria = { existe: boolean; at: number } | undefined;
function leerMemoria(): Memoria {
  return (globalThis as unknown as Record<symbol, Memoria>)[CLAVE];
}
function fijarMemoria(m: Memoria): void {
  (globalThis as unknown as Record<symbol, Memoria>)[CLAVE] = m;
}

async function baseReal(): Promise<DbSonda> {
  return (await import("@/lib/prisma")).prisma as unknown as DbSonda;
}

/**
 * ¿Existen las dos tablas? `forzar` vuelve a preguntar (lo usan las acciones
 * que alguien pide a mano, para no esperar 10 min tras pegar el SQL).
 */
export async function tablasGoogleListas(opts: { db?: DbSonda; forzar?: boolean } = {}): Promise<boolean> {
  const m = leerMemoria();
  if (!opts.forzar && m && Date.now() - m.at < DIEZ_MIN) return m.existe;
  try {
    const db = opts.db ?? (await baseReal());
    const filas = (await db.$queryRaw`
      SELECT (to_regclass('public.google_agenda_imports') IS NOT NULL
          AND to_regclass('public.agenda_block_google') IS NOT NULL) AS existe`) as { existe: boolean }[];
    const existe = Array.isArray(filas) && filas[0]?.existe === true;
    fijarMemoria({ existe, at: Date.now() });
    return existe;
  } catch {
    return m?.existe ?? false;
  }
}

/**
 * Igual, pero sin la caché de «no» y SIN tragarse un fallo: lanza si la base
 * no contesta. Para lo que no puede equivocarse a ciegas (la salida a Google
 * de una cita que vino de un evento: equivocarse BORRA el evento de la
 * clínica y avisa a sus invitados). Revisión t8.
 */
export async function tablasGoogleListasOLanzar(opts: { db?: DbSonda } = {}): Promise<boolean> {
  const m = leerMemoria();
  if (m?.existe && Date.now() - m.at < DIEZ_MIN) return true;
  const db = opts.db ?? (await baseReal());
  const filas = (await db.$queryRaw`
    SELECT (to_regclass('public.google_agenda_imports') IS NOT NULL
        AND to_regclass('public.agenda_block_google') IS NOT NULL) AS existe`) as { existe: boolean }[];
  const existe = Array.isArray(filas) && filas[0]?.existe === true;
  fijarMemoria({ existe, at: Date.now() });
  return existe;
}

/** Solo pruebas. */
export function _olvidarTablasGoogle(): void {
  fijarMemoria(undefined);
}
