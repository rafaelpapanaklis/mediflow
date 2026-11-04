// ws1-t4 · «Clave de la sede» — lo que vive en la base (sql/sede-clave.sql).
//
// SIN modelo de Prisma a propósito: el cliente de Prisma lo comparten otros
// worktrees y panel.108, así que las dos tablas se leen y escriben con
// $queryRaw/$executeRaw, y mientras Rafael no pegue el SQL la función está
// APAGADA: `tablaExiste()` pregunta con to_regclass (nunca falla), la
// respuesta se recuerda en globalThis (sobrevive a las recargas de next dev) y
// no se consulta ninguna tabla que no exista.
//
// ── LA CACHÉ DE 10 s ───────────────────────────────────────────────────
// El gate corre en CADA petición del panel. Para no pagar un viaje a la base
// en cada una, la lista de sedes con clave (una tabla diminuta) se lee entera
// y se guarda 10 s por instancia. Lo que cuesta, igual que la sesión en caché
// que Rafael aceptó en ws1-t1 (src/lib/auth/sesion-en-cache.ts): en OTRA
// instancia, activar, cambiar o desactivar la clave tarda como mucho 10 s en
// aplicarse. En la instancia que atendió el cambio es inmediato (se invalida).
// Las rutas de la clave (activar, cambiar, desbloquear, restablecer) leen
// SIEMPRE fresco.
//
// ── CUANDO LA BASE FALLA (v2, revisión de t8: A1, M1, M2, M4) ───────────
// · Una sola lectura de la lista en curso por instancia (promesa compartida) y
//   con tope de tiempo: al caducar la caché, diez peticiones a la vez esperan
//   la MISMA consulta (M2).
// · Si la lista no se puede leer, se usa la última conocida solo si tiene
//   menos de 5 min (M1). Pasado eso, o sin ninguna, se lee la fila de ESA sede
//   por su llave primaria (A1). Solo si eso también falla se responde «no se
//   pudo comprobar» (`EstadoDesconocido`), y el gate lo dice así: nunca como
//   «Esta sede tiene clave». Una sede sin clave nunca se cierra porque falle la
//   lectura de otras sedes.
// · Un fallo de `to_regclass` se recuerda unos segundos (M4): con la base mal,
//   no se le añade una consulta extra a cada petición.
// · v3 (m2): lo mismo con el fallo de la lista y con la fila de cada sede: una
//   sola consulta de fila en vuelo por sede y su resultado recordado 5 s.
// · v3 (m1): `invalidarLista()` sube una generación; una lectura que estaba en
//   vuelo cuando se escribió una clave no se guarda como lista fresca.
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import type { EstadoClave, Intento } from "./core";
import { VENTANA_FALLOS_MS, BLOQUEO_MS } from "./core";

const REPREGUNTAR_MS = 2 * 60_000;
export const VIDA_LISTA_MS = 10_000;
/** M1: la lista vieja solo sirve de respaldo durante este tiempo. */
export const EDAD_MAX_LISTA_VIEJA_MS = 5 * 60_000;
/** M2: tope de una lectura de la lista o de una fila (después cuenta como fallo). */
export const TOPE_LECTURA_MS = 3_000;
/** M4: cuánto se recuerda que `to_regclass` falló. */
export const RECORDAR_FALLO_SONDA_MS = 5_000;
/**
 * v3 (m2): con la base caída, cuánto se recuerda que la lista falló y el
 * resultado (o el fallo) de la fila de cada sede. Así cada petición no deja su
 * propia consulta colgando en el pooler: una por sede cada 5 s como mucho.
 */
export const RECORDAR_FALLO_BASE_MS = 5_000;
/** Tope de sedes recordadas (las del dueño activo; se vacía si crece). */
const MAX_FILAS_RECORDADAS = 500;

type Sonda = { existe: boolean; en: number; fallo?: boolean };
type Lista = { mapa: Map<string, number>; en: number };
type FilaRecordada = { p: Promise<FilaClave | null>; hasta: number | null };
type Memoria = {
  sonda?: Sonda;
  lista?: Lista;
  enCurso?: Promise<Map<string, number>> | null;
  /** v3 (m1): sube con cada invalidación; una lectura empezada antes no escribe. */
  generacion?: number;
  /** v3 (m2): cuándo falló por última vez la lista. */
  falloListaEn?: number;
  /** v3 (m2): la fila de cada sede leída como respaldo, deduplicada y recordada. */
  filas?: Map<string, FilaRecordada>;
};
const CLAVE = Symbol.for("dalecontrol.sede-clave.estado");

function memoria(): Memoria {
  const g = globalThis as unknown as Record<symbol, Memoria | undefined>;
  if (!g[CLAVE]) g[CLAVE] = {};
  return g[CLAVE]!;
}

/** Solo para las pruebas: olvida la sonda, la lista y la lectura en curso. */
export function _olvidarEstado(): void {
  const m = memoria();
  delete m.sonda;
  delete m.lista;
  delete m.enCurso;
  delete m.generacion;
  delete m.falloListaEn;
  delete m.filas;
}

/** Error que el gate lee como «no se pudo comprobar» → cerrado, con ese mensaje. */
export class EstadoDesconocido extends Error {
  constructor(causa?: unknown) {
    super("sede-clave: no se pudo leer el estado de las claves");
    this.name = "EstadoDesconocido";
    (this as { cause?: unknown }).cause = causa;
  }
}

/** La promesa, o un error si tarda más de `ms`. No cancela la consulta: solo deja de esperarla. */
function conTope<T>(p: Promise<T>, ms: number = TOPE_LECTURA_MS): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<never>((_, rechazar) => {
    t = setTimeout(() => rechazar(new Error(`sede-clave: la base tardó más de ${ms} ms`)), ms);
  });
  return Promise.race([p, tope]).finally(() => { if (t) clearTimeout(t); });
}

/**
 * Lo que contestó la sonda: "si" / "no" = la base respondió; "desconocido" = la
 * pregunta falló o tardó más del tope (auditoría «cloudflare» nº14). Antes los
 * dos últimos eran el mismo `false`, y un fallo de la sonda dejaba entrar a una
 * sede CON clave como si la función estuviera apagada.
 */
export type SondaDeTablas = "si" | "no" | "desconocido";

/**
 * ¿Están las tablas? Una vez que existen se recuerda para siempre (no se
 * borran). Si no existen, se vuelve a preguntar a los 2 min o cuando se fuerza
 * (las rutas de la clave fuerzan, para que la función se encienda en cuanto se
 * pegue el SQL). Un error de la base al PREGUNTAR es "desconocido" y se
 * recuerda 5 s (M4); las puertas no abren a ciegas: miran la fila de cada sede
 * (`estadoDeClave`) y solo la que tampoco se lea queda «sin comprobar».
 * `desbloquear` sí responde 503 mientras tanto.
 */
export async function sondaDeTablas(forzar = false): Promise<SondaDeTablas> {
  const m = memoria();
  const s = m.sonda;
  if (s?.existe) return "si";
  const ahora = Date.now();
  if (s?.fallo && ahora - s.en < RECORDAR_FALLO_SONDA_MS) return "desconocido";
  if (s && !s.fallo && !forzar && ahora - s.en < REPREGUNTAR_MS) return "no";
  try {
    const r = await conTope(prisma.$queryRaw<{ existe: boolean }[]>`
      SELECT (to_regclass('public.sede_claves') IS NOT NULL
          AND to_regclass('public.sede_clave_intentos') IS NOT NULL) AS existe`);
    const existe = r[0]?.existe === true;
    m.sonda = { existe, en: Date.now() };
    return existe ? "si" : "no";
  } catch (e) {
    m.sonda = { existe: false, en: Date.now(), fallo: true };
    console.warn("[sede-clave] no se pudo saber si existen las tablas:", e instanceof Error ? e.message : e);
    return "desconocido";
  }
}

/**
 * true solo si la base dijo que las tablas están. Para lo que ENSEÑA la función
 * (tarjeta de Configuración, permisos, rutas de gestión): ahí un «no sé» se lee
 * como apagada y no abre nada. Las PUERTAS usan `sondaDeTablas`.
 */
export async function tablaExiste(forzar = false): Promise<boolean> {
  return (await sondaDeTablas(forzar)) === "si";
}

async function leerLista(): Promise<Map<string, number>> {
  const filas = await prisma.$queryRaw<{ clinicId: string; version: number }[]>`
    SELECT "clinicId", "version" FROM "sede_claves" WHERE "claveHash" IS NOT NULL`;
  const mapa = new Map<string, number>();
  for (const f of filas) {
    if (f && typeof f.clinicId === "string" && f.clinicId) mapa.set(f.clinicId, Number(f.version));
  }
  return mapa;
}

/**
 * Las sedes con clave activa → versión. En caché 10 s (ver cabecera), con UNA
 * lectura en curso por instancia. Si no se puede leer: la última lista si tiene
 * menos de 5 min; si no, lanza `EstadoDesconocido` (y quien la llamó cae a la
 * fila de cada sede). Con las tablas sin crear devuelve un mapa vacío sin
 * consultar nada.
 */
export async function sedesConClaveActiva(): Promise<Map<string, number>> {
  const sonda = await sondaDeTablas();
  if (sonda === "no") return new Map();
  // nº14: sin saber si hay tablas no se dice «ninguna sede tiene clave»: quien llama cae a la fila de cada sede.
  if (sonda === "desconocido") throw new EstadoDesconocido("no se pudo saber si existen las tablas");
  const m = memoria();
  if (m.lista && Date.now() - m.lista.en < VIDA_LISTA_MS) return m.lista.mapa;
  // v3 (m2): la lista acaba de fallar → no se relanza en cada petición.
  if (!m.enCurso && m.falloListaEn !== undefined && Date.now() - m.falloListaEn < RECORDAR_FALLO_BASE_MS) {
    if (m.lista && Date.now() - m.lista.en < EDAD_MAX_LISTA_VIEJA_MS) return m.lista.mapa;
    throw new EstadoDesconocido("la lista falló hace un momento");
  }
  if (!m.enCurso) {
    // v3 (m1): si mientras tanto alguien invalida (escribió una clave en esta
    // instancia), lo que trae esta lectura ya es viejo: se devuelve a quien la
    // esperaba, pero NO se guarda como lista fresca.
    const generacion = m.generacion ?? 0;
    const lectura = conTope(leerLista()).then(
      (mapa) => {
        if ((m.generacion ?? 0) === generacion) {
          m.lista = { mapa, en: Date.now() };
          delete m.falloListaEn;
        }
        return mapa;
      },
      (e) => {
        m.falloListaEn = Date.now();
        throw e;
      },
    );
    m.enCurso = lectura;
    lectura.then(
      () => { if (m.enCurso === lectura) m.enCurso = null; },
      () => { if (m.enCurso === lectura) m.enCurso = null; },
    );
  }
  const enVuelo = m.enCurso!;
  try {
    return await enVuelo;
  } catch (e) {
    if (m.lista && Date.now() - m.lista.en < EDAD_MAX_LISTA_VIEJA_MS) return m.lista.mapa;
    throw new EstadoDesconocido(e);
  }
}

/**
 * v3 (m2): la fila de UNA sede como respaldo cuando la lista no se lee: una
 * sola consulta en vuelo por sede y su resultado (o su fallo) recordado 5 s.
 * `conTope` deja de esperar a los 3 s pero no puede cancelar la consulta; lo
 * que evita que se acumulen es que no se lance otra mientras tanto.
 */
function filaDeRespaldo(clinicId: string): Promise<FilaClave | null> {
  const m = memoria();
  if (!m.filas) m.filas = new Map();
  const ahora = Date.now();
  const r = m.filas.get(clinicId);
  if (r && (r.hasta === null || ahora < r.hasta)) return r.p;
  if (m.filas.size >= MAX_FILAS_RECORDADAS) m.filas.clear();
  const generacion = m.generacion ?? 0;
  const p = conTope(leerFilaClave(clinicId));
  const recordada: FilaRecordada = { p, hasta: null };
  m.filas.set(clinicId, recordada);
  const vence = () => {
    if ((m.generacion ?? 0) !== generacion) {
      if (m.filas?.get(clinicId) === recordada) m.filas.delete(clinicId);
      return;
    }
    recordada.hasta = Date.now() + RECORDAR_FALLO_BASE_MS;
  };
  p.then(vence, vence);
  return p;
}

function deLaFila(f: FilaClave | null): EstadoClave {
  return f && f.claveHash ? { activa: true, version: f.version } : { activa: false, version: f?.version ?? 0 };
}

/**
 * El estado de UNA sede: de la lista en caché; si la lista no se puede leer, de
 * su fila por la llave primaria (A1). Lanza `EstadoDesconocido` solo si las dos
 * fallan.
 */
export async function estadoDeClave(clinicId: string): Promise<EstadoClave> {
  if (!clinicId) throw new EstadoDesconocido("sin clinicId");
  try {
    const mapa = await sedesConClaveActiva();
    const v = mapa.get(clinicId);
    return v === undefined ? { activa: false, version: 0 } : { activa: true, version: v };
  } catch {
    try {
      return deLaFila(await filaDeRespaldo(clinicId));
    } catch (e) {
      throw new EstadoDesconocido(e);
    }
  }
}

/**
 * El estado de varias sedes a la vez (vistas de varias sedes). Con la lista,
 * sin consultas extra; sin ella, una fila por sede (son pocas: las del dueño).
 * `null` = esa sede no se pudo comprobar.
 */
export async function estadosDeClaves(clinicIds: readonly string[]): Promise<Map<string, EstadoClave | null>> {
  const out = new Map<string, EstadoClave | null>();
  const ids = Array.from(new Set(clinicIds.filter((x) => typeof x === "string" && x)));
  if (ids.length === 0) return out;
  try {
    const mapa = await sedesConClaveActiva();
    for (const id of ids) {
      const v = mapa.get(id);
      out.set(id, v === undefined ? { activa: false, version: 0 } : { activa: true, version: v });
    }
    return out;
  } catch {
    // En serie: son las sedes de una persona y la base ya va mal.
    for (const id of ids) {
      try {
        out.set(id, deLaFila(await filaDeRespaldo(id)));
      } catch {
        out.set(id, null);
      }
    }
    return out;
  }
}

/**
 * Tras escribir: la siguiente lectura de esta instancia va a la base. v3 (m1):
 * sube la generación, así una lectura que ya estaba en vuelo no vuelve a
 * guardar como fresca la lista de antes del cambio; y olvida las filas
 * recordadas y la lectura en curso.
 */
export function invalidarLista(): void {
  const m = memoria();
  m.generacion = (m.generacion ?? 0) + 1;
  delete m.lista;
  m.enCurso = null;
  delete m.falloListaEn;
  m.filas?.clear();
}

// ── Lecturas frescas (rutas de la clave) ───────────────────────────────

export interface FilaClave {
  claveHash: string | null;
  version: number;
}

/** La fila de la sede, fresca. `null` si nunca se activó. Nunca sale de aquí hacia el cliente. */
export async function leerFilaClave(clinicId: string): Promise<FilaClave | null> {
  if (!clinicId) throw new Error("sede-clave: falta clinicId — se corta antes de consultar");
  const filas = await prisma.$queryRaw<{ claveHash: string | null; version: number }[]>`
    SELECT "claveHash", "version" FROM "sede_claves" WHERE "clinicId" = ${clinicId} LIMIT 1`;
  const f = filas[0];
  return f ? { claveHash: f.claveHash ?? null, version: Number(f.version) } : null;
}

/** Estado fresco (sin caché) de una sede. */
export async function estadoFresco(clinicId: string): Promise<EstadoClave> {
  const f = await leerFilaClave(clinicId);
  return f && f.claveHash ? { activa: true, version: f.version } : { activa: false, version: f?.version ?? 0 };
}

// ── Escrituras (cada una sube la versión) ──────────────────────────────

/**
 * Activa la clave si la sede NO tiene una. Devuelve la versión nueva, o null si
 * ya había clave (otra persona la activó a la vez: se gana una sola).
 */
export async function activarClave(clinicId: string, claveHash: string, por: string): Promise<number | null> {
  if (!clinicId) throw new Error("sede-clave: falta clinicId");
  const filas = await prisma.$queryRaw<{ version: number }[]>`
    INSERT INTO "sede_claves" ("clinicId", "claveHash", "version", "actualizadaPor", "createdAt", "updatedAt")
    VALUES (${clinicId}, ${claveHash}, 1, ${por}, NOW(), NOW())
    ON CONFLICT ("clinicId") DO UPDATE
       SET "claveHash" = EXCLUDED."claveHash",
           "version" = "sede_claves"."version" + 1,
           "actualizadaPor" = EXCLUDED."actualizadaPor",
           "updatedAt" = NOW()
     WHERE "sede_claves"."claveHash" IS NULL
    RETURNING "version"`;
  invalidarLista();
  return filas[0] ? Number(filas[0].version) : null;
}

/** Cambia la clave si sigue en la versión que se comprobó. null = alguien la cambió antes. */
export async function cambiarClave(clinicId: string, claveHash: string, versionLeida: number, por: string): Promise<number | null> {
  if (!clinicId) throw new Error("sede-clave: falta clinicId");
  const filas = await prisma.$queryRaw<{ version: number }[]>`
    UPDATE "sede_claves"
       SET "claveHash" = ${claveHash}, "version" = "version" + 1, "actualizadaPor" = ${por}, "updatedAt" = NOW()
     WHERE "clinicId" = ${clinicId} AND "version" = ${versionLeida} AND "claveHash" IS NOT NULL
    RETURNING "version"`;
  invalidarLista();
  return filas[0] ? Number(filas[0].version) : null;
}

/**
 * Deja la sede SIN clave (desactivar desde la clínica con la clave actual, o
 * restablecer desde /admin). Con `versionLeida` solo si nadie la cambió antes;
 * sin ella (restablecer), sobre lo que haya. null = no había clave.
 */
export async function quitarClave(clinicId: string, por: string, versionLeida?: number): Promise<number | null> {
  if (!clinicId) throw new Error("sede-clave: falta clinicId");
  const filas = versionLeida === undefined
    ? await prisma.$queryRaw<{ version: number }[]>`
        UPDATE "sede_claves"
           SET "claveHash" = NULL, "version" = "version" + 1, "actualizadaPor" = ${por}, "updatedAt" = NOW()
         WHERE "clinicId" = ${clinicId} AND "claveHash" IS NOT NULL
        RETURNING "version"`
    : await prisma.$queryRaw<{ version: number }[]>`
        UPDATE "sede_claves"
           SET "claveHash" = NULL, "version" = "version" + 1, "actualizadaPor" = ${por}, "updatedAt" = NOW()
         WHERE "clinicId" = ${clinicId} AND "version" = ${versionLeida} AND "claveHash" IS NOT NULL
        RETURNING "version"`;
  invalidarLista();
  return filas[0] ? Number(filas[0].version) : null;
}

// ── Intentos ───────────────────────────────────────────────────────────

/** Lo mínimo de un cliente de Prisma para leer y escribir intentos (el global o el de una transacción). */
type DbIntentos = Pick<typeof prisma, "$queryRaw" | "$executeRaw">;

/** Más filas de las que caben en una ventana + un bloqueo sin que el propio bloqueo las corte. */
const FILAS_DE_INTENTOS = 50;

/**
 * Los intentos recientes de esta persona en esta sede y versión, desde el
 * ÚLTIMO acierto (A3): los más NUEVOS primero en SQL (`DESC LIMIT`), y aquí se
 * devuelven de más viejo a más nuevo para `estadoDeIntentos`. Con `ASC LIMIT`
 * una ráfaga vieja de cientos de filas escondía los fallos nuevos.
 */
export async function leerIntentos(
  clinicId: string,
  supabaseId: string,
  version: number,
  ahora: Date = new Date(),
  db: DbIntentos = prisma,
): Promise<Intento[]> {
  if (!clinicId || !supabaseId) throw new Error("sede-clave: faltan clinicId o supabaseId");
  const desde = new Date(ahora.getTime() - VENTANA_FALLOS_MS - BLOQUEO_MS - 60_000);
  const filas = await db.$queryRaw<{ ok: boolean; createdAt: Date }[]>`
    SELECT "ok", "createdAt" FROM "sede_clave_intentos"
     WHERE "clinicId" = ${clinicId} AND "supabaseId" = ${supabaseId} AND "version" = ${version}
       AND "createdAt" >= ${desde}
       AND "createdAt" >= COALESCE((
             SELECT MAX("createdAt") FROM "sede_clave_intentos"
              WHERE "clinicId" = ${clinicId} AND "supabaseId" = ${supabaseId} AND "version" = ${version} AND "ok" = true
           ), ${desde})
     ORDER BY "createdAt" DESC
     LIMIT ${FILAS_DE_INTENTOS}`;
  return filas.map((f) => ({ ok: !!f.ok, en: new Date(f.createdAt).getTime() })).reverse();
}

export async function registrarIntento(
  clinicId: string,
  supabaseId: string,
  version: number,
  ok: boolean,
  db: DbIntentos = prisma,
): Promise<void> {
  if (!clinicId || !supabaseId) throw new Error("sede-clave: faltan clinicId o supabaseId");
  await db.$executeRaw`
    INSERT INTO "sede_clave_intentos" ("id", "clinicId", "supabaseId", "version", "ok", "createdAt")
    VALUES (${randomUUID()}, ${clinicId}, ${supabaseId}, ${version}, ${ok}, NOW())`;
}

/**
 * A2 — todo lo de UN intento (leer, comparar, registrar) bajo un candado por
 * persona + sede: `pg_try_advisory_xact_lock` dentro de una transacción. Si otro
 * intento de la misma persona en la misma sede está en curso, NO se espera
 * (no se retiene una conexión del pooler por cada petición de una ráfaga): se
 * devuelve `null` y la ruta contesta «espera un momento», sin comparar ni
 * registrar nada. Así el tope de 5 fallos se cumple también en ráfaga.
 */
export async function conCandadoDeIntentos<T>(
  clinicId: string,
  supabaseId: string,
  fn: (db: DbIntentos) => Promise<T>,
): Promise<T | null> {
  if (!clinicId || !supabaseId) throw new Error("sede-clave: faltan clinicId o supabaseId");
  return prisma.$transaction(
    async (tx) => {
      const r = await tx.$queryRaw<{ ok: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtext(${clinicId} || '|' || ${supabaseId})) AS ok`;
      if (r[0]?.ok !== true) return null;
      return fn(tx as unknown as DbIntentos);
    },
    { maxWait: 3_000, timeout: 10_000 },
  );
}

const PURGAR_CADA_MS = 60 * 60_000;
const CLAVE_PURGA = Symbol.for("dalecontrol.sede-clave.purga");

/**
 * M5 — borra las filas de INTENTOS de más de 1 día (solo de esta tabla: nada de
 * datos de clínicas). Sin cron: la llama la ruta al registrar un intento, como
 * mucho una vez por hora por instancia. Nunca lanza.
 */
export async function purgarIntentosViejos(): Promise<void> {
  const g = globalThis as unknown as Record<symbol, number | undefined>;
  const ahora = Date.now();
  if ((g[CLAVE_PURGA] ?? 0) > ahora - PURGAR_CADA_MS) return;
  g[CLAVE_PURGA] = ahora;
  try {
    await prisma.$executeRaw`
      DELETE FROM "sede_clave_intentos" WHERE "createdAt" < NOW() - INTERVAL '1 day'`;
  } catch (e) {
    console.warn("[sede-clave] no se pudieron purgar los intentos viejos:", e instanceof Error ? e.message : e);
  }
}

/** Solo para las pruebas: que la próxima purga corra. */
export function _olvidarPurga(): void {
  delete (globalThis as unknown as Record<symbol, number | undefined>)[CLAVE_PURGA];
}
