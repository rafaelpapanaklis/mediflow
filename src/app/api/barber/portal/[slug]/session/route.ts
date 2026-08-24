import { NextRequest, NextResponse } from "next/server";
import {
  BARBER_PORTAL_COOKIE,
  portalCookieOptions,
} from "@/lib/barber/client-portal";

/**
 * DELETE /api/barber/portal/[slug]/session — cerrar sesión del portal.
 *
 * La sesión vive SOLO en la cookie firmada, así que salir es borrarla. No se lee
 * nada de la base: cerrar sesión tiene que funcionar aunque la barbería ya no
 * exista o la base esté caída.
 */

export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(BARBER_PORTAL_COOKIE, "", portalCookieOptions(new Date(0)));
  return res;
}
