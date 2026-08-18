// EQ-01 · Gate de 2FA a nivel /api, por ruta.
//
// EDGE-SAFE A PROPÓSITO: solo strings y funciones puras. Sin prisma, sin
// node:crypto, sin otplib. El middleware (Edge runtime) importa de aquí igual
// que importa two-factor-constants; si alguien mete una dependencia de Node en
// este archivo, el middleware deja de compilar.
//
// ── EL AGUJERO QUE CIERRA ─────────────────────────────────────────────
// El 2FA de este producto protegía las PANTALLAS, no los datos. El único gate
// autoritativo vivía en el layout de /dashboard (hasValidTwoFactorCookie), y el
// middleware devuelve next() para TODO /api unas cuarenta líneas antes de llegar
// a la rama de 2FA. Ni getAuthContext() ni getCurrentUser() leían la cookie
// df_2fa. Con la contraseña robada, el ladrón se quedaba plantado en el reto de
// pantalla pero desde la consola del navegador hacía fetch('/api/patients') y se
// llevaba —y escribía— el expediente completo de la clínica.
//
// ── POR QUÉ ESTE DISEÑO Y NO OTRO ─────────────────────────────────────
// Se copia el patrón que ya usa el gate de plan vencido (@/lib/plan-status):
// una allowlist por prefijo + el `x-pathname` que el middleware RE-ESCRIBE en
// toda ruta /api (por eso no se puede falsear desde el cliente). El gate va
// dentro de getAuthContext y getCurrentUser, que es donde ya está la BD en mano
// —hacen falta `user.totpEnabled` y `clinic.require2fa`— y donde pasan las 225
// rutas /api que autentican con sesión de clínica.
//
// El middleware NO puede ser autoritativo: corre en Edge, no puede consultar
// Prisma y por tanto no distingue "este usuario tiene 2FA y no lo ha pasado" de
// "este usuario no usa 2FA". Lo que sí puede es leer la cookie df_2fa_pending
// que el cierre de login siembra SOLO para quien necesita 2FA, y con eso
// responder un 403 limpio con código. Exactamente la misma división de trabajo
// que ya existe para /dashboard: fast-path barato en el middleware, gate
// autoritativo con BD detrás.
//
// ── QUÉ QUEDA FUERA, Y POR QUÉ NO HACE FALTA UNA LISTA LARGA ──────────
// El gate solo puede afectar a una ruta si esa ruta llama a getAuthContext() o
// getCurrentUser(). Se revisaron las 509 rutas bajo src/app/api: 225 los llaman.
// Todo lo que el producto necesita que funcione SIN 2FA no los llama, así que
// queda exento por construcción, no por allowlist:
//
//   • /api/webhooks/* y /api/stripe/webhook — firma de Stripe/Meta.
//   • /api/cron/*                          — Bearer CRON_SECRET.
//   • /api/paciente/* (33 rutas)           — sesión del portal del paciente.
//                                            El paciente NO tiene 2FA de clínica.
//   • /api/public/*, /api/directory/*, /api/track, /api/resena, /api/blog,
//     /api/check-slug, /api/consent/public/[token], /api/tv/[slug]/*
//                                          — públicas, el token o el slug ES la
//                                            credencial.
//   • /api/proveedores/*, /api/laboratorios/*, /api/afiliados/*
//                                          — sesiones de vendedor/afiliado
//                                            (getSupplierContext,
//                                            getDentalLabContext, etc.).
//   • /api/switch-clinic, /api/my-clinics  — usan getSession, no getAuthContext.
//
// El chat B2B (/api/lab-chat, /api/supplier-chat) sí llega a getAuthContext, pero
// a través de resolveChatCaller, que prueba PRIMERO la sesión de vendedor: el
// lado vendedor sigue funcionando y el lado clínica pasa a exigir 2FA, que es lo
// correcto.

/** Código en el cuerpo del 403. El cliente lo distingue de un 401 de sesión
 *  caducada para mandar al usuario al reto en vez de tirarlo al login. */
export const TWO_FACTOR_REQUIRED_CODE = "two_factor_required";

/** Mensaje del 403. Único para que middleware y cliente no se desincronicen. */
export const TWO_FACTOR_REQUIRED_MESSAGE =
  "Verificación en dos pasos pendiente";

// Rutas /api EXENTAS del gate de 2FA. Cada entrada, con su motivo:
//
//   • /api/auth   → EL FLUJO DEL PROPIO 2FA. Sin esto el usuario no puede pasar
//                   el reto y se queda fuera de su panel: las pantallas
//                   /dashboard/2fa y /dashboard/2fa/setup piden exactamente
//                   /api/auth/2fa/{clinic-policy,setup,enable,verify,
//                   recovery-codes,disable} — se comprobó abriendo
//                   two-factor-challenge.tsx y two-factor-setup.tsx. Incluye
//                   también logout y change-password: cerrar sesión y cambiar la
//                   contraseña son las dos salidas de emergencia.
//                   NO abre nada: /api/auth/2fa/disable exige un TOTP o un código
//                   de recuperación válido, así que quien solo tiene la contraseña
//                   no puede apagarse el 2FA a sí mismo.
//
//   • /api/admin  → sesión de PLATAFORMA, no de clínica (cookie admin_token +
//                   getAdminSession, con su propio CSRF origin-check en el
//                   middleware). Ninguna de sus 82 rutas llama a getAuthContext,
//                   así que el gate autoritativo no las toca; la entrada existe
//                   por el FAST-PATH del middleware, que sí las alcanzaría: un
//                   admin de plataforma que además sea usuario de una clínica con
//                   2FA pendiente se quedaría sin poder usar /admin, y ese es un
//                   caso real (el dueño del producto tiene las dos cuentas).
//
//   • /api/switch-clinic → cambiar de clínica activa. Hoy usa getSession y no
//                   pasa por el gate autoritativo, pero el fast-path del
//                   middleware la alcanzaría. Se exenta por el mismo motivo que
//                   en el gate de plan: es una salida, y no concede nada — solo
//                   alterna entre clínicas donde la sesión YA es miembro, y la
//                   clínica de destino vuelve a pedir su propio reto (la cookie
//                   df_2fa está atada al par persona+clínica).
//
// Todo lo demás bajo /api queda sujeto al gate. En particular NO se exenta
// /api/support ni /api/billing, aunque el gate de PLAN sí los exente: allí el
// motivo era que una clínica suspendida pudiera pagar y pedir ayuda, y esas
// pantallas viven bajo /dashboard, que el layout ya bloquea ANTES del 2FA.
// Exentar su API daría acceso por fetch a datos cuya pantalla está cerrada.
const TWO_FA_GATE_ALLOWLIST_BASES = [
  "/api/auth",
  "/api/admin",
  "/api/switch-clinic",
];

export function isTwoFactorGateAllowlistedPath(pathname: string): boolean {
  return TWO_FA_GATE_ALLOWLIST_BASES.some(
    (base) => pathname === base || pathname.startsWith(base + "/"),
  );
}

/**
 * True si el pathname es una ruta /api NO exenta y por tanto debe exigir 2FA.
 * Sólo aplica a /api: para páginas server (pathname /dashboard/*) o para callers
 * sin x-pathname devuelve false — esas navegaciones ya las corta el layout de
 * /dashboard. Mismo criterio, línea por línea, que
 * isApiPathBlockedForExpiredPlan.
 */
export function isApiPathBlockedForMissingTwoFactor(
  pathname: string | null | undefined,
): boolean {
  if (!pathname || !pathname.startsWith("/api")) return false;
  return !isTwoFactorGateAllowlistedPath(pathname);
}

/**
 * ¿Esta membresía (fila de users) tiene que satisfacer el 2FA antes de usar el
 * panel? Es la MISMA regla del layout de /dashboard, y tiene que seguir siéndolo:
 *
 *   • totpEnabled            → el usuario enroló 2FA; necesita df_2fa válida.
 *   • require2fa sin enrolar → la clínica lo exige y aún no enroló; el layout lo
 *                              manda a /dashboard/2fa/setup. No puede tener una
 *                              cookie válida todavía, así que queda con acceso
 *                              solo a /api/auth hasta que enrole — y al enrolar,
 *                              /api/auth/2fa/enable le siembra la cookie, así que
 *                              no hay callejón sin salida.
 *
 * Y lo que NO hace, que es lo importante: quien no tiene totpEnabled y cuya
 * clínica no exige 2FA devuelve false y NO se entera de que este gate existe.
 * Aplicarle el gate a quien no tiene 2FA configurado sería dejar a la mayoría de
 * los usuarios fuera de su propio panel.
 */
export function needsTwoFactor(input: {
  totpEnabled?: boolean | null;
  require2fa?: boolean | null;
}): boolean {
  return !!input.totpEnabled || !!input.require2fa;
}
