import { NextResponse } from "next/server";
import { REALTY_PORTAL_COOKIE, portalCookieOptions } from "@/lib/realty/portal-auth";

/**
 * DELETE /api/realty/portal/auth/session — cerrar sesión del portal.
 *
 * La sesión vive SOLO en la cookie firmada, así que salir es borrarla. No
 * se consulta la base: cerrar sesión tiene que funcionar aunque la
 * inmobiliaria ya no exista o Postgres esté caído.
 *
 * Sin comprobación de origen a propósito: un CSRF que solo consigue
 * CERRARLE la sesión a alguien no le roba nada, y exigirla aquí haría que
 * el botón de salir fallara justo en los navegadores que no mandan
 * Referer — dejando a la persona "adentro", que es el peor resultado.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  // Mismas opciones (path, sameSite) para que el navegador reconozca la
  // cookie que hay que pisar.
  res.cookies.set(REALTY_PORTAL_COOKIE, "", portalCookieOptions(new Date(0)));
  return res;
}
