/**
 * EQ-01 · El 2FA protege las RUTAS /api, no solo las pantallas.
 *
 * Run: npm run test:2fa-gate
 *
 * El fallo: el middleware devolvía next() para todo /api cuarenta líneas antes de
 * su rama de 2FA, y ni getAuthContext ni getCurrentUser leían df_2fa. Con la
 * contraseña robada, el ladrón se quedaba en el reto de pantalla pero desde la
 * consola hacía fetch('/api/patients') y se llevaba el expediente completo.
 *
 * Estos tests cubren las cuatro cosas que pueden salir mal, y las dos últimas son
 * tan importantes como las dos primeras:
 *   1. una ruta del grupo B sin 2FA queda BLOQUEADA,
 *   2. con la prueba de 2FA válida PASA,
 *   3. una ruta del grupo A pasa sin cookie (si no, se rompe el producto: nadie
 *      podría siquiera teclear su código),
 *   4. quien NO tiene 2FA configurado no se entera de que el gate existe — es el
 *      fallo que dejaría a la mayoría de los usuarios fuera de su propio panel.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isApiPathBlockedForMissingTwoFactor,
  isTwoFactorGateAllowlistedPath,
  needsTwoFactor,
  twoFactorPageGateDecision,
  TWO_FACTOR_REQUIRED_CODE,
} from "../two-factor-gate";
import { packTwoFactorToken, isTwoFactorTokenValidFor } from "../two-factor-core";
import { TWO_FA_OK_MAX_AGE_SECONDS } from "../two-factor-constants";

// ── 1 · Grupo B: tiene que exigir 2FA ────────────────────────────────

// Una por área de las que el reporte marca como grupo B, incluidas las que
// alguien podría dar por "de sistema" y colar en la allowlist por descuido.
const GRUPO_B = [
  "/api/patients",
  "/api/patients/abc123",
  "/api/patients/abc123/health-questionnaire",
  "/api/records",
  "/api/medical-records/xyz/diagnoses",
  "/api/prescriptions",
  "/api/clinical-notes",
  "/api/xrays",
  "/api/consent",
  "/api/consent/abc/pdf",
  "/api/agenda/range",
  "/api/appointments",
  "/api/invoices",
  "/api/caja/corte",
  "/api/cfdi",
  "/api/team",
  "/api/settings",
  "/api/whatsapp/send",
  "/api/inbox/threads",
  "/api/auditoria",
  "/api/dashboard/sidebar-counts",
  "/api/analytics/no-shows",
  "/api/billing/checkout",
  "/api/support/tickets",
  "/api/portal",
  "/api/signature/sign",
  "/api/tv-displays",
  "/api/teleconsulta/room",
];

for (const path of GRUPO_B) {
  test(`grupo B: ${path} exige 2FA`, () => {
    assert.equal(isApiPathBlockedForMissingTwoFactor(path), true);
    assert.equal(isTwoFactorGateAllowlistedPath(path), false);
  });
}

test("support y billing NO estan exentos, aunque el gate de PLAN si los exente", () => {
  // El motivo de exentarlos del plan era que una clinica suspendida pudiera pagar
  // y pedir ayuda; esas pantallas viven bajo /dashboard, que el layout ya cierra
  // ANTES del 2FA. Exentar su API daria acceso por fetch a datos cuya pantalla
  // esta cerrada.
  assert.equal(isApiPathBlockedForMissingTwoFactor("/api/support/tickets"), true);
  assert.equal(isApiPathBlockedForMissingTwoFactor("/api/billing/change-plan"), true);
});

// ── 2 · Grupo A: exenta obligatoria ──────────────────────────────────

// Las seis rutas que piden las pantallas /dashboard/2fa y /dashboard/2fa/setup.
// Si alguna quedara bloqueada, el usuario no podria pasar el reto: quedaria
// encerrado fuera de su propio panel sin salida.
const FLUJO_DEL_RETO = [
  "/api/auth/2fa/clinic-policy",
  "/api/auth/2fa/setup",
  "/api/auth/2fa/enable",
  "/api/auth/2fa/verify",
  "/api/auth/2fa/recovery-codes",
  "/api/auth/2fa/disable",
];

for (const path of FLUJO_DEL_RETO) {
  test(`grupo A: ${path} pasa sin 2FA (es el propio reto)`, () => {
    assert.equal(isApiPathBlockedForMissingTwoFactor(path), false);
  });
}

const GRUPO_A = [
  "/api/auth/logout",
  "/api/auth/change-password",
  "/api/auth/post-login",
  "/api/auth/callback",
  "/api/admin",
  "/api/admin/billing",
  "/api/admin/clinics/abc",
  "/api/switch-clinic",
];

for (const path of GRUPO_A) {
  test(`grupo A: ${path} pasa sin 2FA`, () => {
    assert.equal(isApiPathBlockedForMissingTwoFactor(path), false);
  });
}

test("la allowlist no se pasa de lista: solo tres bases", () => {
  // Candado contra el otro fallo: una allowlist que crece "por si acaso" hasta
  // dejar el agujero abierto. Si alguien añade una base, este test le obliga a
  // venir aqui y justificarla.
  const bases = ["/api/auth", "/api/admin", "/api/switch-clinic"];
  for (const b of bases) assert.equal(isTwoFactorGateAllowlistedPath(b), true);
  assert.equal(isTwoFactorGateAllowlistedPath("/api/authz"), false, "prefijo parcial no cuenta");
  assert.equal(isTwoFactorGateAllowlistedPath("/api/administracion"), false, "prefijo parcial no cuenta");
  assert.equal(isTwoFactorGateAllowlistedPath("/api/switch-clinic-x"), false);
});

test("fuera de /api el gate no opina (de las paginas se encarga el layout)", () => {
  assert.equal(isApiPathBlockedForMissingTwoFactor("/dashboard/patients"), false);
  assert.equal(isApiPathBlockedForMissingTwoFactor("/dashboard/2fa"), false);
  assert.equal(isApiPathBlockedForMissingTwoFactor(null), false);
  assert.equal(isApiPathBlockedForMissingTwoFactor(undefined), false);
  assert.equal(isApiPathBlockedForMissingTwoFactor(""), false);
});

test("el codigo del 403 es el que el cliente distingue de un 401", () => {
  assert.equal(TWO_FACTOR_REQUIRED_CODE, "two_factor_required");
});

// ── 3 · A quien aplica: la regla del layout, sin desviarse ───────────

test("quien NO tiene 2FA configurado no queda fuera de su panel", () => {
  // ESTE es el test que impide repetir el fallo que rompio el tab de
  // consentimientos: aplicar un gate nuevo a quien no lo tiene configurado.
  assert.equal(needsTwoFactor({ totpEnabled: false, require2fa: false }), false);
  assert.equal(needsTwoFactor({}), false);
  assert.equal(needsTwoFactor({ totpEnabled: null, require2fa: null }), false);
});

test("el usuario con 2FA enrolado si tiene que probarlo", () => {
  assert.equal(needsTwoFactor({ totpEnabled: true, require2fa: false }), true);
});

test("la clinica que EXIGE 2FA obliga tambien al que aun no enrolo", () => {
  assert.equal(needsTwoFactor({ totpEnabled: false, require2fa: true }), true);
});

// ── 4 · La prueba de 2FA: atada a persona Y clinica ──────────────────

const PERSONA_A = "11111111-1111-1111-1111-111111111111";
const PERSONA_B = "22222222-2222-2222-2222-222222222222";
const CLINICA_A = "clinica_aaa";
const CLINICA_B = "clinica_bbb";
const AHORA = 1_760_000_000_000;

test("con la prueba de 2FA valida, pasa", () => {
  const token = packTwoFactorToken(PERSONA_A, CLINICA_A, AHORA);
  assert.equal(isTwoFactorTokenValidFor(token, PERSONA_A, CLINICA_A, AHORA), true);
});

test("sin cookie, no pasa", () => {
  assert.equal(isTwoFactorTokenValidFor(undefined, PERSONA_A, CLINICA_A, AHORA), false);
  assert.equal(isTwoFactorTokenValidFor("", PERSONA_A, CLINICA_A, AHORA), false);
});

test("LA COOKIE DE OTRA PERSONA NO SIRVE", () => {
  const deB = packTwoFactorToken(PERSONA_B, CLINICA_A, AHORA);
  assert.equal(isTwoFactorTokenValidFor(deB, PERSONA_A, CLINICA_A, AHORA), false);
});

test("LA COOKIE DE OTRA CLINICA NO SIRVE (por eso cambiar de sede re-pide el codigo)", () => {
  const enB = packTwoFactorToken(PERSONA_A, CLINICA_B, AHORA);
  assert.equal(isTwoFactorTokenValidFor(enB, PERSONA_A, CLINICA_A, AHORA), false);
});

test("una cookie fabricada a mano no sirve: la firma no cuadra", () => {
  const falsa = `${PERSONA_A}.${CLINICA_A}.${AHORA}.0123456789abcdef0123456789abcdef`;
  assert.equal(isTwoFactorTokenValidFor(falsa, PERSONA_A, CLINICA_A, AHORA), false);
});

test("manosear el payload de una cookie legitima la invalida", () => {
  const token = packTwoFactorToken(PERSONA_A, CLINICA_A, AHORA);
  const manoseada = token.replace(CLINICA_A, CLINICA_B);
  assert.equal(isTwoFactorTokenValidFor(manoseada, PERSONA_A, CLINICA_B, AHORA), false);
});

test("caduca a las 12 h y no acepta emision futura", () => {
  const token = packTwoFactorToken(PERSONA_A, CLINICA_A, AHORA);
  const casi = AHORA + TWO_FA_OK_MAX_AGE_SECONDS * 1000 - 1;
  const justoPasado = AHORA + TWO_FA_OK_MAX_AGE_SECONDS * 1000 + 1;
  assert.equal(isTwoFactorTokenValidFor(token, PERSONA_A, CLINICA_A, casi), true);
  assert.equal(isTwoFactorTokenValidFor(token, PERSONA_A, CLINICA_A, justoPasado), false);
  // Reloj hacia atras / cookie del futuro.
  assert.equal(isTwoFactorTokenValidFor(token, PERSONA_A, CLINICA_A, AHORA - 1000), false);
});

// ── 5 · La decision completa, como la toma getAuthContext ────────────

/** Réplica del bloque de getAuthContext / enforceApiTwoFactorGate. */
function seBloquea(args: {
  pathname: string;
  totpEnabled: boolean;
  require2fa: boolean;
  cookie?: string;
  supabaseId?: string;
  clinicId?: string;
  nowMs?: number;
}): boolean {
  if (!needsTwoFactor({ totpEnabled: args.totpEnabled, require2fa: args.require2fa })) return false;
  if (!isApiPathBlockedForMissingTwoFactor(args.pathname)) return false;
  return !isTwoFactorTokenValidFor(
    args.cookie,
    args.supabaseId ?? PERSONA_A,
    args.clinicId ?? CLINICA_A,
    args.nowMs ?? AHORA,
  );
}

test("el ladron con solo la contrasena NO lee el expediente por la API", () => {
  assert.equal(
    seBloquea({ pathname: "/api/patients", totpEnabled: true, require2fa: false }),
    true,
  );
});

test("...pero si puede teclear su codigo y cerrar sesion", () => {
  assert.equal(
    seBloquea({ pathname: "/api/auth/2fa/verify", totpEnabled: true, require2fa: false }),
    false,
  );
  assert.equal(
    seBloquea({ pathname: "/api/auth/logout", totpEnabled: true, require2fa: false }),
    false,
  );
});

test("la doctora que ya paso el reto trabaja normal", () => {
  assert.equal(
    seBloquea({
      pathname: "/api/patients",
      totpEnabled: true,
      require2fa: false,
      cookie: packTwoFactorToken(PERSONA_A, CLINICA_A, AHORA),
    }),
    false,
  );
});

test("la recepcionista sin 2FA sigue trabajando exactamente igual que ayer", () => {
  assert.equal(
    seBloquea({ pathname: "/api/patients", totpEnabled: false, require2fa: false }),
    false,
  );
});

test("con la cookie de otra clinica, el expediente sigue cerrado", () => {
  assert.equal(
    seBloquea({
      pathname: "/api/patients",
      totpEnabled: true,
      require2fa: false,
      cookie: packTwoFactorToken(PERSONA_A, CLINICA_B, AHORA),
    }),
    true,
  );
});

// ── 6 · Páginas FUERA de /dashboard: /teleconsulta/[id] con sesión ────
//
// La sala de teleconsulta entrega el token de DUEÑO con solo la sesión. No
// hereda el layout de /dashboard ni lleva x-pathname (el middleware no cubre
// /teleconsulta), así que ninguno de los dos gates la alcanzaba. La página
// aplica twoFactorPageGateDecision, que tiene que ser la regla del layout
// letra por letra: estos tests la fijan por los DOS lados —a quién corta y,
// sobre todo, a quién NO.

test("teleconsulta: el doctor con 2FA enrolado y sin la prueba va al reto", () => {
  assert.equal(
    twoFactorPageGateDecision({ totpEnabled: true, require2fa: false, hasValidCookie: false }),
    "challenge",
  );
  // ...aunque la clínica además lo exija: el que ya enroló nunca va a "setup".
  assert.equal(
    twoFactorPageGateDecision({ totpEnabled: true, require2fa: true, hasValidCookie: false }),
    "challenge",
  );
});

test("teleconsulta: con la prueba de 2FA en mano entra a la sala", () => {
  assert.equal(
    twoFactorPageGateDecision({ totpEnabled: true, require2fa: false, hasValidCookie: true }),
    null,
  );
  assert.equal(
    twoFactorPageGateDecision({ totpEnabled: true, require2fa: true, hasValidCookie: true }),
    null,
  );
});

test("teleconsulta: la clinica que EXIGE 2FA manda a enrolar a quien no lo tiene", () => {
  assert.equal(
    twoFactorPageGateDecision({ totpEnabled: false, require2fa: true, hasValidCookie: false }),
    "setup",
  );
  // Una cookie df_2fa no puede existir sin enrolar; si apareciera, tampoco
  // sustituye al enrolamiento que la clínica exige.
  assert.equal(
    twoFactorPageGateDecision({ totpEnabled: false, require2fa: true, hasValidCookie: true }),
    "setup",
  );
});

test("teleconsulta: quien NO tiene 2FA en una clinica que no lo exige entra igual que ayer", () => {
  // El camino inverso, que es el que deja a la gente fuera de su trabajo si
  // se equivoca: la doctora sin 2FA sigue uniéndose a su teleconsulta.
  assert.equal(
    twoFactorPageGateDecision({ totpEnabled: false, require2fa: false, hasValidCookie: false }),
    null,
  );
  assert.equal(
    twoFactorPageGateDecision({ totpEnabled: null, require2fa: null, hasValidCookie: false }),
    null,
  );
  assert.equal(
    twoFactorPageGateDecision({ hasValidCookie: false }),
    null,
  );
});

test("teleconsulta: la decision coincide con needsTwoFactor (misma regla que el layout)", () => {
  // Si needsTwoFactor dice que no hay 2FA que exigir, la página no puede
  // cortar; y si dice que sí, sin la prueba SIEMPRE corta (reto o enrolamiento).
  for (const totpEnabled of [true, false]) {
    for (const require2fa of [true, false]) {
      const decision = twoFactorPageGateDecision({ totpEnabled, require2fa, hasValidCookie: false });
      assert.equal(
        decision !== null,
        needsTwoFactor({ totpEnabled, require2fa }),
        `totpEnabled=${totpEnabled} require2fa=${require2fa}: la página y needsTwoFactor no coinciden`,
      );
    }
  }
});
