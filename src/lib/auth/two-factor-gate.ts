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
// ── ws1-t8 · M1: YA NO SOLO /api ──────────────────────────────────────
// Lo de arriba describe EQ-01, que cerró /api. Las server actions (POST a
// /dashboard/...) y las páginas seguían abiertas porque el gate se decidía por
// el x-pathname. Desde ws1-t8 getAuthContext y getCurrentUser cortan SIEMPRE
// que la decisión (decisionDosPasos, abajo) bloquee, sin mirar la ruta; la
// allowlist de abajo queda solo para el fast-path del middleware.
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
//                   middleware la alcanzaría. Se exenta porque es una SALIDA:
//                   bloquearla dejaría al dueño con varias sedes sin poder
//                   moverse entre ellas, y no concede nada — solo alterna entre
//                   clínicas donde la sesión YA es miembro.
//
//                   ⚠ EQ-02 — el argumento original era otro y NO era cierto:
//                   "la clínica de destino vuelve a pedir su propio reto". La
//                   cookie df_2fa sí está atada al par persona+clínica
//                   (isTwoFactorTokenValidFor lo comprueba), pero eso solo
//                   importa si el destino pide algo, y el 2FA vivía por FILA de
//                   User: la sede a la que se llegaba podía tener
//                   totpEnabled=false y no pedía NADA. Ahora el 2FA se resuelve
//                   por persona (two-factor-identity-core.ts) y switch-clinic
//                   re-siembra las cookies del reto para la sede de destino, así
//                   que la exención vuelve a ser solo lo que dice ser.
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
 * True si el pathname es una ruta /api NO exenta del FAST-PATH del middleware.
 *
 * ⚠ ws1-t8 · M1: el gate AUTORITATIVO ya no usa esto. Antes getAuthContext y
 * getCurrentUser solo exigían el 2FA cuando esta función decía que sí, y para
 * una server action (POST a /dashboard/...) o una página decía que no: ese era
 * el hueco. Ahora el gate corta en toda sesión (ver two-factor-decision) y las
 * salidas del propio flujo van por código. Esto queda como descripción del
 * corte barato del middleware, que sí se limita a /api.
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

/**
 * La decisión del gate de 2FA para una PÁGINA server con sesión de equipo. Es
 * la regla del layout de /dashboard, expresada como función pura para que la
 * pueda aplicar —y fijar con tests— cualquier página que viva FUERA de
 * /dashboard y por tanto no herede ese layout. Hoy: /teleconsulta/[id], que
 * entrega el token de dueño de la sala de Daily con solo la sesión, sin pasar
 * por el layout (no está bajo /dashboard) ni por el gate de /api (no lleva
 * x-pathname: el middleware no cubre esa ruta).
 *
 *   • enroló 2FA y no trae la prueba (df_2fa) de ESTA persona+clínica → "challenge"
 *   • la clínica exige 2FA y todavía no enroló                          → "setup"
 *   • ninguna de las dos                                                → null
 *
 * El orden importa y es el del layout: quien ya enroló va al reto aunque la
 * clínica además exija 2FA; el enrolamiento forzado es solo para quien no lo
 * tiene. Y —lo mismo que needsTwoFactor— quien no tiene 2FA en una clínica que
 * no lo exige recibe null y no se entera de que el gate existe.
 */
export type TwoFactorPageGateDecision = "challenge" | "setup" | null;

export function twoFactorPageGateDecision(input: {
  totpEnabled?: boolean | null;
  require2fa?: boolean | null;
  hasValidCookie: boolean;
  /** ws1-t8 · M2: estado del dueño frente a la obligación. Sin él, "no-aplica". */
  dueno?: EstadoDuenoDosPasos;
  /** ws1-t8: «Ver como clínica» desde /admin (cookie df_2fa_admin válida). */
  verComoAdmin?: boolean;
}): TwoFactorPageGateDecision {
  const d = decisionDosPasos(input);
  return d === "aviso" ? null : d;
}

// ══════════════════════════════════════════════════════════════════════
// ws1-t8 · M2 — 2FA OBLIGATORIO PARA LOS DUEÑOS (rol SUPER_ADMIN de clínica)
// ══════════════════════════════════════════════════════════════════════
//
// El 30-sep-2026 ninguno de los 61 usuarios de clínica tenía 2FA. Exigirlo de
// golpe dejaría a los dueños fuera de su panel el día del despliegue, así que
// va en dos tiempos, contados desde una FECHA DE INICIO que se pone por env
// (DOS_PASOS_DUENOS_DESDE, la del despliegue):
//
//   • GRACIA (por defecto 7 días): al entrar, el dueño sin 2FA ve «Activa la
//     verificación en dos pasos» y puede posponerlo. No bloquea nada.
//   • VENCIDA: el dueño sin 2FA NO entra al panel ni a la API hasta
//     configurarlo — pero la pantalla de configuración y sus /api/auth/2fa/*
//     siguen abiertas, así que nunca es un callejón sin salida.
//
// Sin la env (o con una fecha ilegible) la obligación está APAGADA: nadie
// queda fuera por un despliegue a medias. Los demás roles siguen como hoy
// (opcional, salvo que la clínica active require2fa).

export const DIAS_GRACIA_DUENOS_POR_DEFECTO = 7;
const DIA_MS = 24 * 60 * 60 * 1000;

export interface PoliticaDosPasosDuenos {
  /** Instante (ms) en que empieza la gracia; null = obligación apagada. */
  inicioMs: number | null;
  diasGracia: number;
}

/**
 * Lee la política del entorno. Acepta `AAAA-MM-DD` (medianoche en Ciudad de
 * México, UTC-6 sin horario de verano desde 2022) o un ISO completo.
 * Edge-safe: solo strings.
 */
export function leerPoliticaDosPasosDuenos(
  env: Record<string, string | undefined> = process.env,
): PoliticaDosPasosDuenos {
  const diasRaw = Number(env.DOS_PASOS_DUENOS_GRACIA_DIAS);
  const diasGracia =
    Number.isFinite(diasRaw) && diasRaw >= 0 && diasRaw <= 365
      ? Math.floor(diasRaw)
      : DIAS_GRACIA_DUENOS_POR_DEFECTO;
  const desde = (env.DOS_PASOS_DUENOS_DESDE ?? "").trim();
  if (!desde) return { inicioMs: null, diasGracia };
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(desde) ? `${desde}T00:00:00-06:00` : desde;
  const ms = Date.parse(iso);
  return { inicioMs: Number.isFinite(ms) ? ms : null, diasGracia };
}

export type EstadoDuenoDosPasos =
  | { estado: "no-aplica" }
  | { estado: "gracia"; venceMs: number; diasRestantes: number }
  | { estado: "vencida"; venceMs: number };

/** Simulación de la obligación en un navegador, SOLO fuera de producción. */
export type SimulacionDosPasosDuenos = "gracia" | "vencida" | null;

/**
 * ¿En qué punto está ESTE usuario frente a la obligación de los dueños?
 *
 * Solo aplica al rol SUPER_ADMIN de la clínica activa y solo mientras no tenga
 * el segundo factor (a nivel persona: quien lo tiene ya cumple).
 *
 * La simulación —una cookie que solo se lee fuera de producción, ver
 * two-factor-cookie— trata ESTA sesión como la de un dueño sin 2FA en gracia o
 * con la gracia vencida, sea cual sea su rol: así se prueba en dev.108 con un
 * usuario de la clínica de prueba, sin tocar la env, ni roles, ni datos de
 * nadie. Solo puede ENDURECER, nunca aflojar; la regla del rol la fijan los
 * tests.
 */
export function estadoDuenoDosPasos(input: {
  role?: string | null;
  totpEnabled?: boolean | null;
  politica: PoliticaDosPasosDuenos;
  ahoraMs: number;
  simulacion?: SimulacionDosPasosDuenos;
}): EstadoDuenoDosPasos {
  if (input.totpEnabled) return { estado: "no-aplica" };
  const real = estadoRealDueno(input.role, input.politica, input.ahoraMs);
  if (input.simulacion === "vencida") return { estado: "vencida", venceMs: input.ahoraMs };
  if (input.simulacion === "gracia" && real.estado !== "vencida") {
    const venceMs = input.ahoraMs + input.politica.diasGracia * DIA_MS;
    return { estado: "gracia", venceMs, diasRestantes: Math.max(1, input.politica.diasGracia) };
  }
  return real;
}

function estadoRealDueno(
  role: string | null | undefined,
  politica: PoliticaDosPasosDuenos,
  ahoraMs: number,
): EstadoDuenoDosPasos {
  if (role !== "SUPER_ADMIN") return { estado: "no-aplica" };
  const { inicioMs, diasGracia } = politica;
  if (inicioMs === null) return { estado: "no-aplica" };
  const venceMs = inicioMs + diasGracia * DIA_MS;
  if (ahoraMs >= venceMs) return { estado: "vencida", venceMs };
  // Antes del inicio también es gracia: el aviso sale desde el despliegue.
  const diasRestantes = Math.max(1, Math.ceil((venceMs - ahoraMs) / DIA_MS));
  return { estado: "gracia", venceMs, diasRestantes };
}

/**
 * LA decisión del 2FA para una sesión de clínica. Una sola regla para el
 * layout, las páginas sueltas (teleconsulta), getAuthContext y getCurrentUser:
 *
 *   • «Ver como clínica» desde /admin                       → null (pasa)
 *   • enroló 2FA y trae la prueba (df_2fa) de esta sede     → null
 *   • enroló 2FA y no la trae                               → "challenge"
 *   • la clínica exige 2FA (require2fa) y no enroló         → "setup"
 *   • es dueño, no enroló y la gracia venció                → "setup"
 *   • es dueño, no enroló y sigue en gracia                 → "aviso" (no bloquea)
 *   • nada de lo anterior                                   → null
 *
 * "challenge" y "setup" BLOQUEAN (ver bloqueaDosPasos); "aviso" solo lo pinta
 * el layout como pantalla que se puede posponer.
 */
export type DecisionDosPasos = "challenge" | "setup" | "aviso" | null;

export function decisionDosPasos(input: {
  totpEnabled?: boolean | null;
  require2fa?: boolean | null;
  hasValidCookie: boolean;
  dueno?: EstadoDuenoDosPasos;
  verComoAdmin?: boolean;
}): DecisionDosPasos {
  // El admin de plataforma ya pasó SU propio TOTP para abrir /admin, y desde
  // ahí «Ver como clínica» entra con un enlace mágico del dueño. Pedirle el
  // código del celular del dueño (o mandarlo a enrolarse por él) lo dejaría
  // fuera; la cookie que lo prueba solo la emite /api/admin/impersonate.
  if (input.verComoAdmin) return null;
  if (input.totpEnabled) return input.hasValidCookie ? null : "challenge";
  // Una cookie df_2fa no puede existir sin enrolar; si apareciera, tampoco
  // sustituye al enrolamiento que se exige.
  if (input.require2fa) return "setup";
  const dueno = input.dueno?.estado ?? "no-aplica";
  if (dueno === "vencida") return "setup";
  if (dueno === "gracia") return "aviso";
  return null;
}

/** ¿La decisión impide usar el panel y la API? */
export function bloqueaDosPasos(d: DecisionDosPasos): d is "challenge" | "setup" {
  return d === "challenge" || d === "setup";
}
