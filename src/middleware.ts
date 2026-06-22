import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
// Edge-safe: solo una constante string, sin node:crypto/otplib/prisma.
import { TWO_FA_PENDING_COOKIE } from "@/lib/auth/two-factor-constants";

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
    try {
      const token = request.cookies.get("admin_token")?.value;
      const secret = process.env.ADMIN_SECRET_TOKEN;
      const ok = !!token && !!secret && token.length === secret.length &&
        // timing-safe via simple XOR loop (middleware Edge runtime sin crypto.timingSafeEqual garantizado)
        (() => {
          let diff = 0;
          for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ secret.charCodeAt(i);
          return diff === 0;
        })();
      if (!ok) {
        const url = request.nextUrl.clone();
        url.pathname = "/admin/login";
        return NextResponse.redirect(url);
      }
    } catch {
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
    // Fast-path 2FA (Edge, sin crypto): si el cierre de login marcó
    // df_2fa_pending (usuario debe pasar 2FA) y aún no lo superó, lo mandamos
    // al reto antes de tocar el layout. Las propias rutas /dashboard/2fa*
    // quedan exentas (si no, loop). Es solo UX/defensa: el gate AUTORITATIVO
    // (firma df_2fa + BD) vive en el layout, así que aunque esta cookie falte
    // o se borre, el layout bloquea igual.
    if (
      !pathname.startsWith("/dashboard/2fa") &&
      request.cookies.get(TWO_FA_PENDING_COOKIE)?.value
    ) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard/2fa";
      url.search = `?next=${encodeURIComponent(pathname)}`;
      return NextResponse.redirect(url);
    }
    return await updateSession(request);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/api/admin/:path*", "/proveedores/:path*"],
};
