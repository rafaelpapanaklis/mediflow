/**
 * ¿Ya se pegó sql/salamanca-google.sql? (WS1-T9)
 *
 * Mientras no: NINGUNA consulta toca `google_agenda_imports` ni
 * `agenda_block_google`. Se mira que existan las dos tablas Y las columnas
 * que se añadieron después (`COLUMNAS_NUEVAS`): un SQL viejo aplicado a medias
 * dejaría las tablas sin ellas y cada sincronización fallaría sin aviso
 * (segunda vuelta t8, N-G7). Se pregunta con `to_regclass` (no falla ni deja
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

/** Las columnas que `sql/salamanca-google.sql` añade con ADD COLUMN IF NOT EXISTS. */
export const COLUMNAS_NUEVAS = [
  ["google_agenda_imports", "channelError"],
  ["google_agenda_imports", "channelErrorAt"],
  ["google_agenda_imports", "equipoFirma"],
  ["agenda_block_google", "alcance"],
  ["agenda_block_google", "salidaFirma"],
] as const;
const CLAVE = Symbol.for("dalecontrol.ws1-t9.tablas-google");

type Memoria = { existe: boolean; at: number } | undefined;
function leerMemoria(): Memoria {
  return (globalThis as unknown as Record<symbol, Memoria>)[CLAVE];
}
function fijarMemoria(m: Memoria): void {
  (globalThis as unknown as Record<symbol, Memoria>)[CLAVE] = m;
}

/**
 * UNA consulta: las dos tablas (con `to_regclass`, que no falla) y las
 * `COLUMNAS_NUEVAS` (en `information_schema`, que tampoco). Escrita a mano
 * (no se arma con la lista: una plantilla de Prisma pasaría los nombres como
 * parámetros); la prueba comprueba que coinciden.
 */
async function preguntar(db: DbSonda): Promise<boolean> {
  const filas = (await db.$queryRaw`
    SELECT (to_regclass('public.google_agenda_imports') IS NOT NULL
        AND to_regclass('public.agenda_block_google') IS NOT NULL
        AND (SELECT count(*) FROM information_schema.columns
              WHERE table_schema = 'public'
                AND ((table_name = 'google_agenda_imports' AND column_name IN ('channelError', 'channelErrorAt', 'equipoFirma'))
                  OR (table_name = 'agenda_block_google' AND column_name IN ('alcance', 'salidaFirma')))) = 5) AS existe`) as { existe: boolean }[];
  return Array.isArray(filas) && filas[0]?.existe === true;
}

/** Solo las dos tablas (sin las columnas nuevas). */
async function preguntarTablas(db: DbSonda): Promise<boolean> {
  const filas = (await db.$queryRaw`
    SELECT (to_regclass('public.google_agenda_imports') IS NOT NULL
        AND to_regclass('public.agenda_block_google') IS NOT NULL) AS existe`) as { existe: boolean }[];
  return Array.isArray(filas) && filas[0]?.existe === true;
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
    const existe = await preguntar(db);
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
  // Aquí bastan las TABLAS: con un vínculo legible, la cita sí vino de Google
  // aunque falte una columna nueva. Decir «no» por la columna haría que
  // cancelarla BORRARA el evento de la clínica. (No se guarda en la memoria:
  // ella responde a la pregunta completa.)
  return preguntarTablas(db);
}

/** Solo pruebas. */
export function _olvidarTablasGoogle(): void {
  fijarMemoria(undefined);
}
