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
// Si la lista no se puede leer (la tabla existe pero la consulta falla), se usa
// la última conocida; sin ninguna, se FALLA CERRADO (`EstadoDesconocido`): el
// gate trata la sede como bloqueada antes que abrirla sin saber.
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import type { EstadoClave, Intento } from "./core";
import { VENTANA_FALLOS_MS, BLOQUEO_MS } from "./core";

const REPREGUNTAR_MS = 2 * 60_000;
export const VIDA_LISTA_MS = 10_000;

type Sonda = { existe: boolean; en: number };
type Lista = { mapa: Map<string, number>; en: number };
type Memoria = { sonda?: Sonda; lista?: Lista };
const CLAVE = Symbol.for("dalecontrol.sede-clave.estado");

function memoria(): Memoria {
  const g = globalThis as unknown as Record<symbol, Memoria | undefined>;
  if (!g[CLAVE]) g[CLAVE] = {};
  return g[CLAVE]!;
}

/** Solo para las pruebas: olvida la sonda y la lista. */
export function _olvidarEstado(): void {
  const m = memoria();
  delete m.sonda;
  delete m.lista;
}

/** Error que el gate lee como «no sé si tiene clave» → cerrado. */
export class EstadoDesconocido extends Error {
  constructor(causa?: unknown) {
    super("sede-clave: no se pudo leer el estado de las claves");
    this.name = "EstadoDesconocido";
    (this as { cause?: unknown }).cause = causa;
  }
}

/**
 * ¿Están las tablas? Una vez que existen se recuerda para siempre (no se
 * borran). Si no existen, se vuelve a preguntar a los 2 min o cuando se fuerza
 * (las rutas de la clave fuerzan, para que la función se encienda en cuanto se
 * pegue el SQL). Un error de la base al PREGUNTAR se lee como «no está» y no se
 * memoriza: es el patrón de la casa para «sin SQL todo sigue igual», y si la
 * base no responde la petición tampoco va a poder resolver la sesión.
 */
export async function tablaExiste(forzar = false): Promise<boolean> {
  const m = memoria();
  const s = m.sonda;
  if (s?.existe) return true;
  if (s && !forzar && Date.now() - s.en < REPREGUNTAR_MS) return false;
  try {
    const r = await prisma.$queryRaw<{ existe: boolean }[]>`
      SELECT (to_regclass('public.sede_claves') IS NOT NULL
          AND to_regclass('public.sede_clave_intentos') IS NOT NULL) AS existe`;
    const existe = r[0]?.existe === true;
    m.sonda = { existe, en: Date.now() };
    return existe;
  } catch (e) {
    console.warn("[sede-clave] no se pudo saber si existen las tablas:", e instanceof Error ? e.message : e);
    return false;
  }
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
 * Las sedes con clave activa → versión. En caché 10 s (ver cabecera). Lanza
 * `EstadoDesconocido` si no se puede leer y no hay ninguna lista anterior.
 * Con las tablas sin crear devuelve un mapa vacío sin consultar nada.
 */
export async function sedesConClaveActiva(): Promise<Map<string, number>> {
  if (!(await tablaExiste())) return new Map();
  const m = memoria();
  const ahora = Date.now();
  if (m.lista && ahora - m.lista.en < VIDA_LISTA_MS) return m.lista.mapa;
  try {
    const mapa = await leerLista();
    m.lista = { mapa, en: ahora };
    return mapa;
  } catch (e) {
    if (m.lista) return m.lista.mapa;
    throw new EstadoDesconocido(e);
  }
}

/** El estado de UNA sede según la lista en caché. */
export async function estadoDeClave(clinicId: string): Promise<EstadoClave> {
  if (!clinicId) throw new EstadoDesconocido("sin clinicId");
  const mapa = await sedesConClaveActiva();
  const v = mapa.get(clinicId);
  return v === undefined ? { activa: false, version: 0 } : { activa: true, version: v };
}

/** Tras escribir: la siguiente lectura de esta instancia va a la base. */
export function invalidarLista(): void {
  delete memoria().lista;
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

/** Los intentos recientes de esta persona en esta sede y versión (lo que cabe en una ventana + un bloqueo). */
export async function leerIntentos(clinicId: string, supabaseId: string, version: number, ahora: Date = new Date()): Promise<Intento[]> {
  if (!clinicId || !supabaseId) throw new Error("sede-clave: faltan clinicId o supabaseId");
  const desde = new Date(ahora.getTime() - VENTANA_FALLOS_MS - BLOQUEO_MS - 60_000);
  const filas = await prisma.$queryRaw<{ ok: boolean; createdAt: Date }[]>`
    SELECT "ok", "createdAt" FROM "sede_clave_intentos"
     WHERE "clinicId" = ${clinicId} AND "supabaseId" = ${supabaseId} AND "version" = ${version}
       AND "createdAt" >= ${desde}
     ORDER BY "createdAt" ASC
     LIMIT 200`;
  return filas.map((f) => ({ ok: !!f.ok, en: new Date(f.createdAt).getTime() }));
}

export async function registrarIntento(clinicId: string, supabaseId: string, version: number, ok: boolean): Promise<void> {
  if (!clinicId || !supabaseId) throw new Error("sede-clave: faltan clinicId o supabaseId");
  await prisma.$executeRaw`
    INSERT INTO "sede_clave_intentos" ("id", "clinicId", "supabaseId", "version", "ok", "createdAt")
    VALUES (${randomUUID()}, ${clinicId}, ${supabaseId}, ${version}, ${ok}, NOW())`;
}
