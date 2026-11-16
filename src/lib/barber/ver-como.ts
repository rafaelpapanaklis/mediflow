/**
 * «Ver como barbería» (ws6-t1, 16-nov-2026) — registro, comprobación y salida
 * de la sesión. La regla está en ./ver-como-core.
 *
 * Tabla `barber_admin_impersonation_sessions` (sql/barber_admin_ver_como.sql),
 * por SQL crudo y fuera de schema.prisma, igual que la del dental. Mientras
 * Rafael no pegue el SQL:
 *   · leer = «no hay ninguna» (nada pudo crearse sin la tabla), y la base no
 *     recibe ninguna consulta que falle: se pregunta con to_regclass;
 *   · «Ver como barbería» contesta 503 con el nombre del SQL y NO abre sesión.
 *
 * No toca NADA del dental: ni su tabla, ni sus cookies (df_sesion_previa,
 * df_ver_como, df_2fa_admin), ni la cookie de la clínica activa. Solo reutiliza
 * sus funciones puras y la revocación de Supabase con scope "local".
 */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clienteAdminSupabase } from "@/lib/admin/supabase-admin";
import { revocarDespues, revocarEnSupabase } from "@/lib/admin/suplantacion";
import { BARBER_BRANCH_COOKIE } from "@/lib/barber/branch-cookie";
import {
  COOKIE_VER_COMO_PREVIA,
  RUTA_COOKIE_VER_COMO_PREVIA,
  VER_COMO_BLOQUEADO_CODE,
  desempacarPreviaBarber,
  estadoVerComo,
  revocarVerComoYa,
  sessionIdDelToken,
  textoBloqueo,
  type EstadoVerComo,
  type FilaVerComo,
} from "./ver-como-core";

const CACHE_MS = 30 * 1000;
/** Cada cuánto se vuelve a preguntar si ya se pegó el SQL. */
const REVISAR_TABLA_MS = 10 * 60 * 1000;

const cache = new Map<string, { fila: FilaVerComo | null; hasta: number }>();
const revocadas = new Set<string>();

type EstadoTabla = { hay: boolean; revisadoEn: number; enCurso: Promise<boolean> | null };
const CLAVE_TABLA = Symbol.for("dalecontrol.barber.ver-como.tabla");
function estadoTabla(): EstadoTabla {
  const g = globalThis as Record<symbol, EstadoTabla | undefined>;
  return (g[CLAVE_TABLA] ??= { hay: false, revisadoEn: 0, enCurso: null });
}

async function hayTabla(ahora: number = Date.now()): Promise<boolean> {
  const e = estadoTabla();
  if (e.hay) return true; // una vez creada no desaparece
  if (e.revisadoEn && ahora - e.revisadoEn < REVISAR_TABLA_MS) return false;
  if (e.enCurso) return e.enCurso;
  e.enCurso = (async () => {
    try {
      const filas = await prisma.$queryRaw<{ ok: boolean }[]>`
        SELECT (to_regclass('public.barber_admin_impersonation_sessions') IS NOT NULL) AS "ok"
      `;
      e.hay = filas[0]?.ok === true;
    } catch (err) {
      console.warn("[barber-ver-como] no se pudo revisar si existe la tabla:", err instanceof Error ? err.message : err);
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
function esTablaAusente(e: unknown): boolean {
  const err = e as { code?: string; message?: string; meta?: { code?: string; message?: string } } | null;
  const codigo = String(err?.meta?.code ?? err?.code ?? "");
  const texto = `${err?.message ?? ""} ${err?.meta?.message ?? ""}`;
  return codigo === "42P01" || codigo === "P2021" ||
    (/barber_admin_impersonation_sessions/.test(texto) && /does not exist|no existe/i.test(texto));
}

/** Solo para pruebas. */
export function _reiniciarCacheVerComo() {
  cache.clear();
  revocadas.clear();
  const e = estadoTabla();
  e.hay = false; e.revisadoEn = 0; e.enCurso = null;
}

/** ¿Está la tabla? Antes de abrir una sesión se pregunta al momento (Rafael acaba de pegar el SQL). */
export async function tablaVerComoLista(): Promise<boolean> {
  const e = estadoTabla();
  if (!e.hay) e.revisadoEn = 0;
  return hayTabla();
}

export async function registrarVerComo(d: {
  adminUserId: string;
  adminEmail: string;
  barbershopId: string;
  targetBarberUserId: string;
  targetSupabaseId: string;
  supabaseSessionId: string;
  nota: string;
  ip: string | null;
  userAgent: string | null;
  expiresAt: Date;
}): Promise<string> {
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "barber_admin_impersonation_sessions"
      ("id", "adminUserId", "adminEmail", "barbershopId", "targetBarberUserId", "targetSupabaseId",
       "supabaseSessionId", "nota", "ip", "userAgent", "expiresAt")
    VALUES
      (${id}, ${d.adminUserId}, ${d.adminEmail}, ${d.barbershopId}, ${d.targetBarberUserId}, ${d.targetSupabaseId},
       ${d.supabaseSessionId}, ${d.nota}, ${d.ip}, ${d.userAgent}, ${d.expiresAt})
  `;
  cache.delete(d.supabaseSessionId);
  return id;
}

async function buscarPorSesion(sessionId: string): Promise<FilaVerComo | null> {
  const ahora = Date.now();
  if (!(await hayTabla(ahora))) return null; // sin SQL no pudo abrirse ninguna
  const enCache = cache.get(sessionId);
  if (enCache && enCache.hasta > ahora) return enCache.fila;
  try {
    const filas = await prisma.$queryRaw<FilaVerComo[]>`
      SELECT "id", "adminUserId", "adminEmail", "barbershopId", "targetBarberUserId", "expiresAt", "endedAt"
      FROM "barber_admin_impersonation_sessions"
      WHERE "supabaseSessionId" = ${sessionId}
      LIMIT 1
    `;
    const fila = filas[0] ?? null;
    cache.set(sessionId, { fila, hasta: ahora + CACHE_MS });
    return fila;
  } catch (e) {
    if (esTablaAusente(e)) {
      estadoTabla().hay = false;
      estadoTabla().revisadoEn = ahora;
      return null;
    }
    throw e;
  }
}

/** Marca cerrada la vencida y la revoca en Supabase (una vez por proceso). Nunca lanza. */
async function cerrarVencida(sessionId: string, accessToken: string, fila: FilaVerComo): Promise<void> {
  if (revocadas.has(sessionId)) return;
  revocadas.add(sessionId);
  try {
    if (!fila.endedAt) {
      await prisma.$executeRaw`
        UPDATE "barber_admin_impersonation_sessions"
        SET "endedAt" = now(), "endedReason" = 'vencida'
        WHERE "id" = ${fila.id} AND "endedAt" IS NULL
      `;
    }
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && key) {
      await clienteAdminSupabase(key).auth.admin.signOut(accessToken, "local");
    }
  } catch (e) {
    console.warn("[barber-ver-como] no se pudo cerrar en Supabase:", e instanceof Error ? e.message : e);
  }
}

/** Cierra a mano («Salir», «Cerrar sesión» o una entrada nueva). Nunca lanza. */
export async function cerrarVerComo(id: string, motivo: "salida" | "reemplazada"): Promise<void> {
  try {
    await prisma.$executeRaw`
      UPDATE "barber_admin_impersonation_sessions"
      SET "endedAt" = now(), "endedReason" = ${motivo}
      WHERE "id" = ${id} AND "endedAt" IS NULL
    `;
    cache.clear();
  } catch (e) {
    console.warn("[barber-ver-como] no se pudo marcar cerrada:", e instanceof Error ? e.message : e);
  }
}

type ClienteConSesion = {
  auth: { getSession(): Promise<{ data: { session: { access_token?: string } | null } }> };
};

/**
 * ¿La sesión de ESTA petición es un «Ver como barbería»? Llamar DESPUÉS de
 * `auth.getUser()` (que valida el token). Nunca lanza: ante un error contesta
 * «normal» y deja traza (cortar todo el panel por esta lectura sería peor).
 */
export async function estadoVerComoDe(supabase: ClienteConSesion): Promise<EstadoVerComo> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? null;
    const sessionId = sessionIdDelToken(token);
    if (!sessionId || !token) return { tipo: "normal" };
    const estado = estadoVerComo(await buscarPorSesion(sessionId));
    if (estado.tipo === "terminada" && revocarVerComoYa(estado.fila)) void cerrarVencida(sessionId, token, estado.fila);
    return estado;
  } catch (e) {
    console.error("[barber-ver-como] lectura falló:", e instanceof Error ? e.message : e);
    return { tipo: "normal" };
  }
}

// ─────────────── Salir ───────────────

type ClienteDeSalida = ClienteConSesion & {
  auth: {
    signOut(o: { scope: "local" }): Promise<unknown>;
    refreshSession(s: { refresh_token: string }): Promise<{
      data: { user: { id: string } | null; session: unknown };
      error: unknown;
    }>;
  };
};

export interface SalidaVerComo {
  /** ¿El navegador volvió a la sesión que tenía antes de entrar? */
  restaurada: boolean;
  /** La sede que esa sesión tenía elegida en /barber, para volver a escribirla. */
  sedePrevia: string | null;
}

/**
 * Cierra el «Ver como barbería» de este navegador y, si hay copia de la sesión
 * previa, la canjea. La de inspección se revoca SOLO a ella (scope "local"): el
 * "global" echaría al dueño real de todos sus dispositivos. Si se volvió a la
 * previa, la revocación se aplaza (peticiones en vuelo de otras pestañas, ver
 * GRACIA_REVOCACION_MS del dental). Nunca lanza.
 */
export async function salirDeVerComo(
  supabase: ClienteDeSalida,
  estado: Exclude<EstadoVerComo, { tipo: "normal" }>,
  cookiePrevia: string | null | undefined,
): Promise<SalidaVerComo> {
  if (estado.tipo === "activa") await cerrarVerComo(estado.fila.id, "salida");
  const previa = desempacarPreviaBarber(cookiePrevia);
  if (previa) {
    const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
    const tokenInspeccion = data.session?.access_token ?? null;
    try {
      const r = await supabase.auth.refreshSession({ refresh_token: previa.rt });
      if (!r.error && r.data.user?.id === previa.sub) {
        if (tokenInspeccion) revocarDespues(tokenInspeccion);
        return { restaurada: true, sedePrevia: previa.sede };
      }
      console.warn("[barber-ver-como] no se volvió a la sesión previa:", r.error ? "canje rechazado" : "es de otra persona; no se usa");
    } catch (e) {
      console.warn("[barber-ver-como] no se pudo volver a la sesión previa:", e instanceof Error ? e.message : e);
    }
    if (tokenInspeccion) await revocarEnSupabase(tokenInspeccion);
  }
  try { await supabase.auth.signOut({ scope: "local" }); } catch { /* ya cerrada */ }
  return { restaurada: false, sedePrevia: null };
}

/** Las cookies de la respuesta de salida: sin la copia previa y con la sede de antes. */
export function cookiesDeSalidaVerComo(res: NextResponse, s: SalidaVerComo): void {
  res.cookies.set(COOKIE_VER_COMO_PREVIA, "", { path: RUTA_COOKIE_VER_COMO_PREVIA, maxAge: 0 });
  if (s.restaurada && s.sedePrevia) {
    res.cookies.set(BARBER_BRANCH_COOKIE, s.sedePrevia, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 180,
    });
  } else {
    res.cookies.set(BARBER_BRANCH_COOKIE, "", { path: "/", maxAge: 0 });
  }
}

/** Ficha de /admin a la que se vuelve al salir. */
export function fichaDeAdmin(barbershopId: string): string {
  return `/admin/barberias/${encodeURIComponent(barbershopId)}`;
}

// ─────────────── Bloqueos mientras se inspecciona ───────────────

/**
 * Las rutas de BLOQUEOS_VER_COMO (ver-como-core) llaman a esto justo después
 * de resolver el contexto: con «Ver como barbería» activo responde 403
 * VER_COMO_BLOQUEADO; si no, null y la ruta sigue como siempre.
 */
export function respuestaSiVerComo(
  ctx: { verComo?: { id: string } | null; barbershop?: { locale?: string | null } } | null | undefined,
): NextResponse | null {
  if (!ctx?.verComo) return null;
  return NextResponse.json(
    { error: textoBloqueo(ctx.barbershop?.locale ?? null), code: VER_COMO_BLOQUEADO_CODE },
    { status: 403 },
  );
}
