import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// These paths should NOT be treated as clinic slugs
const RESERVED_PATHS = new Set([
  "admin","api","dashboard","auth","login","register",
  "pricing","features","contact","consentimiento","portal",
  "favicon.ico","_next","fonts","images",
  // Specialty pages
  "dental","medicina-general","nutricion","psicologia",
  "dermatologia","fisioterapia","podologia",
  "medicina-estetica","clinicas-capilares",
  "centros-estetica","cejas-pestanas","masajes",
  "depilacion-laser","peluquerias","medicina-alternativa",
  "unas","spas",
  "teleconsulta","pago",
]);

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function csrfOriginMismatch(request: NextRequest): boolean {
  if (!UNSAFE_METHODS.has(request.method)) return false;
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const host = request.headers.get("host");
  if (!host) return true;
  const sourceHost = (() => {
    try { return origin ? new URL(origin).host : referer ? new URL(referer).host : null; }
    catch { return null; }
  })();
  if (!sourceHost) return true;
  return sourceHost !== host;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Vista pública /live/<slug> y su endpoint /api/live/* viven fuera de
  // toda lógica de auth. El acceso se controla por:
  //   1. Clinic.liveModeEnabled (false → 404 desde la propia ruta).
  //   2. Clinic.liveModePassword (cookie unlock httpOnly por clínica).
  // El matcher de abajo ya excluye estos paths, pero dejamos un guard
  // explícito para documentar la intención y prevenir regresiones.
  if (pathname.startsWith("/live/") || pathname.startsWith("/api/live/")) {
    return NextResponse.next();
  }

  // CSRF check para mutaciones en /api/admin/* (session-cookie auth)
  if (pathname.startsWith("/api/admin") && UNSAFE_METHODS.has(request.method)) {
    if (csrfOriginMismatch(request)) {
      return NextResponse.json({ error: "CSRF: origin mismatch" }, { status: 403 });
    }
  }

  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    // Edge runtime: NO puede consultar Prisma. Aquí sólo se valida PRESENCIA de
    // la cookie (gate barato anti-flash). La validación REAL de la sesión —viva,
    // no revocada, no expirada, AdminUser activo— corre en runtime Node: el
    // layout server de /admin (src/app/admin/layout.tsx) y cada ruta
    // /api/admin/* vía isAdminAuthed()/getAdminSession(). Una cookie presente
    // pero inválida/revocada pasa este gate pero el layout/ruta la rechaza
    // (fail-closed), así que la revocación es efectiva donde importa.
    const token = request.cookies.get("admin_token")?.value;
    if (!token) {
      const url = request.nextUrl.clone();
      url.pathname = "/admin/login";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // Panel de proveedores (marketplace B2B). login/registro/pendiente son
  // públicas. El resto refresca la cookie de Supabase; la verificación de
  // auth + aprobación la hace src/app/proveedores/(panel)/layout.tsx vía
  // getSupplierContext (mismo patrón que /dashboard con getCurrentUser).
  if (pathname.startsWith("/proveedores")) {
    if (
      pathname === "/proveedores/login" ||
      pathname === "/proveedores/registro" ||
      pathname === "/proveedores/pendiente"
    ) {
      return NextResponse.next();
    }
    return await updateSession(request);
  }

  if (pathname.startsWith("/dashboard")) {
    return await updateSession(request);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/api/admin/:path*", "/proveedores/:path*"],
};
