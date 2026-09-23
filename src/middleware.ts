import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
// Edge-safe: solo una constante string, sin node:crypto/otplib/prisma.
import { TWO_FA_PENDING_COOKIE } from "@/lib/auth/two-factor-constants";
// Edge-safe: allowlist de strings y funciones puras, sin prisma/node:crypto.
import {
  isTwoFactorGateAllowlistedPath,
  TWO_FACTOR_REQUIRED_CODE,
  TWO_FACTOR_REQUIRED_MESSAGE,
} from "@/lib/auth/two-factor-gate";

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

/**
 * La URL pública de esta petición, para construir un `Location` de redirect.
 *
 * `request.nextUrl` trae el origen INTERNO con el que arrancó el servidor. En
 * Vercel da igual —la plataforma resuelve el host— pero AUTOALOJADO DETRÁS DE
 * UN PROXY no: el panel de QA corre `next start -H 127.0.0.1 -p 3300`, así que
 * un `nextUrl.clone()` salía con `location: http://localhost:3300/...` y el
 * navegador de Rafael se iba a su propia máquina. Caddy solo repite lo que le
 * damos.
 *
 * Así que el host sale de `x-forwarded-host` (lo que el proxy dice que pidió el
 * navegador) y, si no está, de `host`. Si no hay ninguna de las dos, se queda
 * como estaba.
 *
 * ⚠️ `x-forwarded-host` y `x-forwarded-proto` se las puede inventar quien llame
 * directo al puerto, así que esto vale SOLO para decidir a dónde mandar un
 * redirect de login —nunca para autorizar, validar origen ni firmar nada— y por
 * eso no se usa en ningún otro sitio. El CSRF de arriba sigue comparando contra
 * `host`, que es el que pone el proxy.
 */
function urlPublica(request: NextRequest) {
  const url = request.nextUrl.clone();
  // Una cadena de proxies deja "a.example, b.interno": manda el primero, que es
  // el que vio el navegador.
  const reenviado = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "")
    .split(",")[0]
    .trim();
  if (!reenviado) return url;

  url.host = reenviado;
  // El setter de `host` SOLO toca el puerto si el valor lo trae. Sin esto,
  // `panel.108-181-149-131.sslip.io` + el 3300 interno = `panel.108-…:3300`.
  if (!reenviado.includes(":")) url.port = "";

  const proto = (request.headers.get("x-forwarded-proto") ?? "").split(",")[0].trim();
  if (proto) url.protocol = `${proto}:`;

  return url;
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

  // x-pathname para TODA ruta /api: getAuthContext / getCurrentUser (runtime
  // Node) lo leen con headers() para aplicar el gate de plan vencido por-ruta
  // (allowlist de pago/auth en @/lib/plan-status). Se RE-ESCRIBE siempre con el
  // pathname real, así un cliente no puede spoofear el header. NO corremos
  // updateSession aquí: las rutas /api hacen su propia auth (leen cookies
  // directo) y los webhooks/crons no deben pagar el refresh de sesión Supabase.
  // /api/live ya salió arriba (público, sin gate).
  if (pathname.startsWith("/api")) {
    // Fast-path 2FA para /api (EQ-01). Edge, sin BD ni crypto: si el cierre de
    // login marcó df_2fa_pending (o sea, esta persona SÍ necesita 2FA) y la ruta
    // no está exenta, cortamos con 403 y un código propio.
    //
    // POR QUÉ AQUÍ Y NO SOLO EN getAuthContext: el gate autoritativo corta
    // devolviendo null, y eso hace que la ruta responda su 401 de siempre — que
    // el cliente no puede distinguir de "se te caducó la sesión", así que
    // mandaría al usuario al login en vez de al reto. Este 403 es el que el panel
    // sabe leer.
    //
    // POR QUÉ ESTO NO ES EL GATE DE VERDAD: la cookie es borrable por el cliente.
    // Quien la borre se salta ESTE corte, pero cae en el de
    // getAuthContext/getCurrentUser, que consulta totpEnabled/require2fa en BD.
    // Misma división de trabajo que ya existe para /dashboard (fast-path aquí,
    // gate autoritativo en el layout).
    if (
      request.cookies.get(TWO_FA_PENDING_COOKIE)?.value &&
      !isTwoFactorGateAllowlistedPath(pathname)
    ) {
      return NextResponse.json(
        { error: TWO_FACTOR_REQUIRED_MESSAGE, code: TWO_FACTOR_REQUIRED_CODE },
        { status: 403 },
      );
    }

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-pathname", pathname);
    // x-method: la caché de 10 s de la sesión resuelta solo sirve LECTURAS
    // (@/lib/auth/sesion-en-cache); una escritura resuelve fresco. Se
    // re-escribe siempre, igual que x-pathname.
    requestHeaders.set("x-method", request.method);
    return NextResponse.next({ request: { headers: requestHeaders } });
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
      const url = urlPublica(request);
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

  // Panel del instituto (DaleControl Institucional). El login del vertical es
  // público; el resto refresca la cookie de Supabase. La verificación de auth
  // la hace src/app/instituto/(panel)/layout.tsx vía getEduContext (mismo
  // patrón que /proveedores con getSupplierContext: el Edge no puede consultar
  // Prisma, así que aquí no se decide quién entra).
  if (pathname.startsWith("/instituto")) {
    if (pathname === "/instituto/login") {
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
      const url = urlPublica(request);
      url.pathname = "/dashboard/2fa";
      url.search = `?next=${encodeURIComponent(pathname)}`;
      return NextResponse.redirect(url);
    }
    return await updateSession(request);
  }

  return NextResponse.next();
}

export const config = {
  // /api/:path* (superset de /api/admin) para inyectar x-pathname en toda ruta
  // /api y habilitar el gate de plan vencido en getAuthContext/getCurrentUser.
  matcher: ["/dashboard/:path*", "/admin/:path*", "/api/:path*", "/proveedores/:path*", "/instituto/:path*"],
};
