import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  ADMIN_COOKIE,
  adminCookieOptions,
  getAdminSessionResult,
  touchAdminSession,
} from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/**
 * Keep-alive de la sesión admin. Lo llama el panel cada pocos minutos
 * (src/app/admin/session-keepalive.tsx).
 *
 * Existe por una limitación concreta: la renovación deslizante vive en
 * getAdminSessionResult(), pero un layout de Server Component NO puede escribir
 * cookies — así que extender expiresAt en BD sin refrescar el maxAge de la
 * cookie dejaría al navegador tirándola antes de tiempo. Un route handler sí
 * puede, y éste es el más simple que funciona: extiende (si toca) y re-emite la
 * MISMA cookie con el maxAge alineado a la expiración vigente.
 *
 * POST (no GET) para heredar el CSRF origin-check del middleware.
 * Fail-closed como el resto de /api/admin/*: sin sesión válida, 401 y no se
 * toca la cookie (tampoco se borra: si fue un fallo de BD, la sesión sigue viva
 * y el siguiente intento la recupera).
 */
export async function POST() {
  const result = await getAdminSessionResult();
  if (result.state !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId, expiresAt: current } = result.ctx;

  // getAdminSessionResult() ya lanzó su touch en fire-and-forget; aquí se espera
  // el resultado porque el maxAge de la cookie depende de él. Si ambos escriben
  // ponen el MISMO valor, así que la carrera es inocua.
  let expiresAt = current;
  try {
    const extended = await touchAdminSession(sessionId, current);
    if (extended) expiresAt = extended;
  } catch {
    // La BD falló: no extendemos, pero igual refrescamos la cookie con lo que
    // le quede de vida a la sesión. Nunca cerrar sesión por esto.
  }

  const maxAgeMs = expiresAt.getTime() - Date.now();
  const res = NextResponse.json({ ok: true, expiresAt: expiresAt.toISOString() });

  const token = cookies().get(ADMIN_COOKIE)?.value;
  if (token && maxAgeMs > 0) {
    res.cookies.set(ADMIN_COOKIE, token, adminCookieOptions(maxAgeMs));
  }
  return res;
}
