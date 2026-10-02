/**
 * «Ver como clínica» — registro y comprobación de la sesión de suplantación
 * (auditoría 30-sep-2026, M5). La regla está en ./suplantacion-core.
 *
 * Tabla `admin_impersonation_sessions` (sql/ws1-t4-suplantacion-admin.sql), por
 * SQL crudo y FUERA de schema.prisma a propósito: así nada del resto del panel
 * depende de ella. Mientras Rafael no pegue el SQL:
 *   · leer = «no hay suplantaciones» (nada pudo crearse sin la tabla);
 *   · «Ver como clínica» contesta 503 con el nombre del SQL y NO abre sesión
 *     (no se vuelve al magic link de 30 días sin registro).
 */
import { clienteAdminSupabase } from "./supabase-admin";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  estadoDe,
  sessionIdDelToken,
  type EstadoSuplantacion,
  type FilaSuplantacion,
} from "./suplantacion-core";

const CACHE_MS = 30 * 1000;
/** Cada cuánto se vuelve a preguntar si ya se pegó el SQL (la pregunta no puede fallar). */
const REVISAR_TABLAS_MS = 10 * 60 * 1000;

const cache = new Map<string, { fila: FilaSuplantacion | null; hasta: number }>();
const revocadas = new Set<string>();

/**
 * ¿Existen las dos tablas? Se pregunta con to_regclass, que devuelve NULL en vez
 * de fallar: mientras el SQL no esté pegado, la base NO recibe ninguna consulta
 * que acabe en error (antes, cada lectura daba un 42P01 en los logs de Postgres).
 * La respuesta vive en globalThis para que `next dev`, que recarga módulos cada
 * poco, no vuelva a preguntar en cada recarga.
 */
type EstadoTablas = { hay: boolean; revisadoEn: number; enCurso: Promise<boolean> | null };
const CLAVE_TABLAS = Symbol.for("dalecontrol.suplantacion.tablas");
function estadoTablas(): EstadoTablas {
  const g = globalThis as Record<symbol, EstadoTablas | undefined>;
  return (g[CLAVE_TABLAS] ??= { hay: false, revisadoEn: 0, enCurso: null });
}

async function hayTablas(ahora: number = Date.now()): Promise<boolean> {
  const e = estadoTablas();
  if (e.hay) return true; // una vez creadas no desaparecen
  if (e.revisadoEn && ahora - e.revisadoEn < REVISAR_TABLAS_MS) return false;
  if (e.enCurso) return e.enCurso;
  e.enCurso = (async () => {
    try {
      const filas = await prisma.$queryRaw<{ ok: boolean }[]>`
        SELECT (to_regclass('public.admin_impersonation_sessions') IS NOT NULL
            AND to_regclass('public.admin_impersonation_actions') IS NOT NULL) AS "ok"
      `;
      e.hay = filas[0]?.ok === true;
    } catch (err) {
      console.warn("[suplantacion] no se pudo revisar si existen las tablas:", err instanceof Error ? err.message : err);
      e.hay = false;
    } finally {
      e.revisadoEn = Date.now();
      e.enCurso = null;
    }
    return e.hay;
  })();
  return e.enCurso;
}

/** ¿El error es «la tabla no existe» (falta el SQL)? */
export function esTablaAusente(e: unknown): boolean {
  const err = e as { code?: string; message?: string; meta?: { code?: string; message?: string } } | null;
  const codigo = String(err?.meta?.code ?? err?.code ?? "");
  const texto = `${err?.message ?? ""} ${err?.meta?.message ?? ""}`;
  return codigo === "42P01" || codigo === "P2021" ||
    (/admin_impersonation_(sessions|actions)/.test(texto) && /does not exist|no existe/i.test(texto));
}

/** Solo para pruebas. */
export function _reiniciarCacheSuplantacion() {
  cache.clear();
  revocadas.clear();
  const e = estadoTablas();
  e.hay = false; e.revisadoEn = 0; e.enCurso = null;
}

/** ¿Están las dos tablas? (antes de abrir una sesión: sin registro no se entra). */
export async function tablaDeSuplantacionLista(): Promise<boolean> {
  // Quien la llama es «Ver como clínica»: ahí sí se pregunta de nuevo al momento
  // (Rafael acaba de pegar el SQL y lo prueba), sin esperar los 10 min.
  const e = estadoTablas();
  if (!e.hay) e.revisadoEn = 0;
  return hayTablas();
}

export async function registrarSuplantacion(d: {
  adminUserId: string;
  adminEmail: string;
  clinicId: string;
  targetUserId: string;
  targetSupabaseId: string;
  supabaseSessionId: string;
  nota: string;
  ip: string | null;
  userAgent: string | null;
  expiresAt: Date;
}): Promise<string> {
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "admin_impersonation_sessions"
      ("id", "adminUserId", "adminEmail", "clinicId", "targetUserId", "targetSupabaseId",
       "supabaseSessionId", "nota", "ip", "userAgent", "expiresAt")
    VALUES
      (${id}, ${d.adminUserId}, ${d.adminEmail}, ${d.clinicId}, ${d.targetUserId}, ${d.targetSupabaseId},
       ${d.supabaseSessionId}, ${d.nota}, ${d.ip}, ${d.userAgent}, ${d.expiresAt})
  `;
  cache.delete(d.supabaseSessionId);
  return id;
}

async function buscarPorSesion(sessionId: string): Promise<FilaSuplantacion | null> {
  const ahora = Date.now();
  if (!(await hayTablas(ahora))) return null; // sin SQL no pudo crearse ninguna suplantación
  const enCache = cache.get(sessionId);
  if (enCache && enCache.hasta > ahora) return enCache.fila;
  try {
    const filas = await prisma.$queryRaw<FilaSuplantacion[]>`
      SELECT "id", "adminUserId", "adminEmail", "clinicId", "targetUserId", "expiresAt", "endedAt"
      FROM "admin_impersonation_sessions"
      WHERE "supabaseSessionId" = ${sessionId}
      LIMIT 1
    `;
    const fila = filas[0] ?? null;
    cache.set(sessionId, { fila, hasta: ahora + CACHE_MS });
    return fila;
  } catch (e) {
    if (esTablaAusente(e)) {
      estadoTablas().hay = false; // alguien borró la tabla: se vuelve a revisar más tarde
      estadoTablas().revisadoEn = ahora;
      return null;
    }
    throw e;
  }
}

/** Revoca en Supabase la sesión vencida (una vez por proceso) y la marca cerrada. */
async function cerrarVencida(sessionId: string, accessToken: string, fila: FilaSuplantacion): Promise<void> {
  if (revocadas.has(sessionId)) return;
  revocadas.add(sessionId);
  try {
    if (!fila.endedAt) {
      await prisma.$executeRaw`
        UPDATE "admin_impersonation_sessions"
        SET "endedAt" = now(), "endedReason" = 'vencida'
        WHERE "id" = ${fila.id} AND "endedAt" IS NULL
      `;
    }
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && key) {
      await clienteAdminSupabase(key).auth.admin.signOut(accessToken, "local");
    }
  } catch (e) {
    // La regla ya corta por la tabla en cada petición; revocar es limpieza.
    console.warn("[suplantacion] no se pudo cerrar en Supabase:", e instanceof Error ? e.message : e);
  }
}

/**
 * Cierra a mano una suplantación («Salir y volver a /admin», o una entrada nueva
 * desde el mismo navegador). La sesión de Supabase la cierra quien llama, con
 * scope "local". Nunca lanza.
 */
export async function cerrarSuplantacion(id: string, motivo: "salida" | "reemplazada"): Promise<void> {
  try {
    await prisma.$executeRaw`
      UPDATE "admin_impersonation_sessions"
      SET "endedAt" = now(), "endedReason" = ${motivo}
      WHERE "id" = ${id} AND "endedAt" IS NULL
    `;
    cache.clear();
  } catch (e) {
    console.warn("[suplantacion] no se pudo marcar cerrada:", e instanceof Error ? e.message : e);
  }
}

type ClienteConSesion = {
  auth: { getSession(): Promise<{ data: { session: { access_token?: string } | null } }> };
};

/**
 * Estado de suplantación de la sesión de ESTA petición. Llamar DESPUÉS de
 * `auth.getUser()` (que valida el token). Nunca lanza: ante un error de base
 * contesta «normal» y deja traza — la sesión ya se validó con Supabase, y
 * cortar a todo el panel por un fallo de esta lectura sería peor.
 */
export async function estadoSuplantacionDe(supabase: ClienteConSesion): Promise<EstadoSuplantacion> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? null;
    const sessionId = sessionIdDelToken(token);
    if (!sessionId || !token) return { tipo: "normal" };
    const estado = estadoDe(await buscarPorSesion(sessionId));
    if (estado.tipo === "terminada") void cerrarVencida(sessionId, token, estado.fila);
    return estado;
  } catch (e) {
    console.error("[suplantacion] lectura falló:", e instanceof Error ? e.message : e);
    return { tipo: "normal" };
  }
}

// ─────────────── Desvío de la bitácora (decisión A de Rafael, 1-oct) ───────────────
//
// Lo que hace el admin de plataforma con «Ver como clínica» NO va a ninguna
// bitácora de la clínica (audit_logs → Movimientos, actividad, historial) ni se
// atribuye a nadie de la clínica, tampoco al dueño. Va SOLO a la bitácora de
// admin de plataforma: `admin_impersonation_actions` (mismo SQL que la sesión),
// con admin, clínica, acción, registro, momento y la sesión (que lleva la nota).
// Si esa fila no se puede escribir, queda el evento ADMIN_AUDIT en los logs del
// servidor — y la de la clínica tampoco se escribe.

/** La suplantación ACTIVA de esta petición, o null (fuera de una petición, sin sesión, sesión normal). */
export async function suplantacionDeEstaPeticion(): Promise<FilaSuplantacion | null> {
  try {
    // Import diferido: este módulo lo carga la bitácora, que también corre en
    // crons y pruebas sin Next ni variables de Supabase.
    const { createClient } = await import("@/lib/supabase/server");
    const estado = await estadoSuplantacionDe(createClient());
    return estado.tipo === "activa" ? estado.fila : null;
  } catch {
    return null; // fuera de una petición (cookies() lanza) = no hay suplantación
  }
}

export interface AccionDeSuplantacion {
  clinicId: string;
  entityType: string;
  entityId: string;
  action: string;
  changes: unknown;
  patientId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Escribe la acción en la bitácora de admin de plataforma. Nunca lanza. */
export async function anotarAccionDeSuplantacion(s: FilaSuplantacion, a: AccionDeSuplantacion): Promise<void> {
  const evento = {
    tag: "ADMIN_AUDIT",
    type: "admin.ver_como_clinica.accion",
    at: new Date().toISOString(),
    impersonationId: s.id,
    adminId: s.adminUserId,
    adminEmail: s.adminEmail,
    clinicId: a.clinicId,
    entity: a.entityType,
    entityId: a.entityId,
    action: a.action,
    patientId: a.patientId ?? null,
  };
  try {
    // Sin tablas no puede haber suplantación activa; si aun así llega aquí, solo el log.
    if (!(await hayTablas())) throw new Error("tablas de suplantación sin crear");
    const cambios = a.changes === undefined || a.changes === null ? null : JSON.stringify(a.changes);
    await prisma.$executeRaw`
      INSERT INTO "admin_impersonation_actions"
        ("id", "impersonationId", "adminUserId", "adminEmail", "clinicId", "entityType", "entityId",
         "action", "changes", "patientId", "ipAddress", "userAgent")
      VALUES
        (${randomUUID()}, ${s.id}, ${s.adminUserId}, ${s.adminEmail}, ${a.clinicId}, ${a.entityType}, ${a.entityId},
         ${a.action}, ${cambios}::jsonb, ${a.patientId ?? null}, ${a.ipAddress ?? null}, ${a.userAgent ?? null})
    `;
    console.log(JSON.stringify(evento));
  } catch (e) {
    console.error(JSON.stringify({ ...evento, error: "no se pudo escribir admin_impersonation_actions", detalle: e instanceof Error ? e.message : String(e) }));
  }
}

/**
 * Punto común: si esta petición es «Ver como clínica», la fila de bitácora del
 * personal se desvía a la de admin y devuelve true (quien llama NO escribe en
 * audit_logs). Las filas de actores externos (paciente, reserva web, bot) y las
 * que ya son de admin desde /admin (actorType "admin") siguen su camino.
 */
export async function desviarSiSuplantacion(fila: {
  clinicId: string;
  userId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  changes: unknown;
  patientId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  actorType?: string | null;
}): Promise<boolean> {
  if (!fila.userId) return false;
  if (fila.actorType && fila.actorType !== "staff") return false;
  const s = await suplantacionDeEstaPeticion();
  if (!s) return false;
  await anotarAccionDeSuplantacion(s, fila);
  return true;
}
