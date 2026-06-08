import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export function adminMiddleware(request: NextRequest) {
  const token = request.cookies.get("admin_token")?.value;
  const validToken = process.env.ADMIN_SECRET_TOKEN;

  if (!token || token !== validToken) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

/**
 * Helper compartido de auth admin para route handlers (/api/admin, App Router,
 * Next 14). Replica el check inline (cookie admin_token === ADMIN_SECRET_TOKEN)
 * hoy duplicado en ~34 rutas; T6 (tesorería de IA) lo reutiliza en vez de
 * volver a escribirlo. Síncrono: en Next 14 cookies() no se await-ea. Devuelve
 * boolean; el caller responde el 401.
 */
export function isAdminAuthed(): boolean {
  const token = cookies().get("admin_token")?.value;
  const secret = process.env.ADMIN_SECRET_TOKEN;
  return !!token && !!secret && token === secret;
}
