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

  if (pathname.startsWith("/dashboard")) {
    return await updateSession(request);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/api/admin/:path*"],
};
