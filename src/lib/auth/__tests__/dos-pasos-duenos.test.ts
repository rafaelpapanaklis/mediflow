/**
 * ws1-t8 · M2 — 2FA obligatorio para los DUEÑOS (rol SUPER_ADMIN de clínica),
 * con periodo de gracia y sin callejones sin salida.
 *
 * Run: npm run test:2fa-duenos
 *
 * Lo que se fija, por los dos lados (a quién corta y, sobre todo, a quién no):
 *   · sin la fecha de inicio en el entorno, la obligación está APAGADA;
 *   · durante la gracia el dueño ve un aviso que NO bloquea;
 *   · con la gracia vencida, el dueño sin 2FA va al enrolamiento ("setup"),
 *     que es una pantalla que sí puede usar — nunca a un muro;
 *   · los demás roles siguen como hoy;
 *   · «Ver como clínica» desde /admin no queda atrapado en nada de esto;
 *   · la simulación por cookie solo existe fuera de producción y solo endurece.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bloqueaDosPasos,
  decisionDosPasos,
  estadoDuenoDosPasos,
  leerPoliticaDosPasosDuenos,
  twoFactorPageGateDecision,
  DIAS_GRACIA_DUENOS_POR_DEFECTO,
  type PoliticaDosPasosDuenos,
} from "../two-factor-gate";
import { packTwoFactorToken, isTwoFactorTokenValidFor, verComoSecret } from "../two-factor-core";

const DIA = 24 * 60 * 60 * 1000;
const INICIO = Date.parse("2026-10-05T00:00:00-06:00");
const POLITICA: PoliticaDosPasosDuenos = { inicioMs: INICIO, diasGracia: 7 };
const APAGADA: PoliticaDosPasosDuenos = { inicioMs: null, diasGracia: 7 };

// ── Política desde el entorno ────────────────────────────────────────

test("sin DOS_PASOS_DUENOS_DESDE la obligacion esta apagada (nadie queda fuera por un despliegue a medias)", () => {
  assert.equal(leerPoliticaDosPasosDuenos({}).inicioMs, null);
  assert.equal(leerPoliticaDosPasosDuenos({ DOS_PASOS_DUENOS_DESDE: "" }).inicioMs, null);
  assert.equal(leerPoliticaDosPasosDuenos({ DOS_PASOS_DUENOS_DESDE: "pronto" }).inicioMs, null, "fecha ilegible = apagada");
});

test("la fecha AAAA-MM-DD es medianoche de Ciudad de Mexico y la gracia es 7 dias por defecto", () => {
  const p = leerPoliticaDosPasosDuenos({ DOS_PASOS_DUENOS_DESDE: "2026-10-05" });
  assert.equal(p.inicioMs, INICIO);
  assert.equal(p.diasGracia, DIAS_GRACIA_DUENOS_POR_DEFECTO);
  assert.equal(DIAS_GRACIA_DUENOS_POR_DEFECTO, 7);
  assert.equal(leerPoliticaDosPasosDuenos({ DOS_PASOS_DUENOS_DESDE: "2026-10-05", DOS_PASOS_DUENOS_GRACIA_DIAS: "14" }).diasGracia, 14);
  assert.equal(leerPoliticaDosPasosDuenos({ DOS_PASOS_DUENOS_DESDE: "2026-10-05", DOS_PASOS_DUENOS_GRACIA_DIAS: "x" }).diasGracia, 7);
  assert.equal(leerPoliticaDosPasosDuenos({ DOS_PASOS_DUENOS_DESDE: "2026-10-05", DOS_PASOS_DUENOS_GRACIA_DIAS: "-3" }).diasGracia, 7);
});

// ── Estado del dueño ─────────────────────────────────────────────────

test("dueño sin 2FA: gracia desde el inicio hasta el dia 7, vencida a partir de ahi", () => {
  const e1 = estadoDuenoDosPasos({ role: "SUPER_ADMIN", totpEnabled: false, politica: POLITICA, ahoraMs: INICIO + 1000 });
  assert.equal(e1.estado, "gracia");
  assert.equal(e1.estado === "gracia" && e1.diasRestantes, 7);

  const e6 = estadoDuenoDosPasos({ role: "SUPER_ADMIN", totpEnabled: false, politica: POLITICA, ahoraMs: INICIO + 6.5 * DIA });
  assert.equal(e6.estado === "gracia" && e6.diasRestantes, 1);

  const e7 = estadoDuenoDosPasos({ role: "SUPER_ADMIN", totpEnabled: false, politica: POLITICA, ahoraMs: INICIO + 7 * DIA });
  assert.equal(e7.estado, "vencida");
});

test("antes de la fecha de inicio tambien es gracia: el aviso sale desde el despliegue", () => {
  const e = estadoDuenoDosPasos({ role: "SUPER_ADMIN", totpEnabled: false, politica: POLITICA, ahoraMs: INICIO - 2 * DIA });
  assert.equal(e.estado, "gracia");
});

test("el dueño que YA tiene 2FA no tiene nada pendiente", () => {
  const e = estadoDuenoDosPasos({ role: "SUPER_ADMIN", totpEnabled: true, politica: POLITICA, ahoraMs: INICIO + 30 * DIA });
  assert.equal(e.estado, "no-aplica");
});

test("los demas roles siguen como hoy: opcional", () => {
  for (const role of ["ADMIN", "DOCTOR", "RECEPTIONIST", "READONLY", null, undefined]) {
    const e = estadoDuenoDosPasos({ role, totpEnabled: false, politica: POLITICA, ahoraMs: INICIO + 30 * DIA });
    assert.equal(e.estado, "no-aplica", `rol ${role}`);
  }
});

test("con la obligacion apagada el dueño no se entera", () => {
  const e = estadoDuenoDosPasos({ role: "SUPER_ADMIN", totpEnabled: false, politica: APAGADA, ahoraMs: INICIO + 30 * DIA });
  assert.equal(e.estado, "no-aplica");
});

test("la simulacion (solo fuera de produccion) trata la sesion como dueño sin 2FA: endurece, nunca afloja", () => {
  const ahora = INICIO;
  assert.equal(estadoDuenoDosPasos({ role: "SUPER_ADMIN", totpEnabled: false, politica: APAGADA, ahoraMs: ahora, simulacion: "vencida" }).estado, "vencida");
  assert.equal(estadoDuenoDosPasos({ role: "SUPER_ADMIN", totpEnabled: false, politica: APAGADA, ahoraMs: ahora, simulacion: "gracia" }).estado, "gracia");
  // Para probar en dev.108 con un usuario de la clínica de prueba que no es dueño.
  assert.equal(estadoDuenoDosPasos({ role: "DOCTOR", totpEnabled: false, politica: APAGADA, ahoraMs: ahora, simulacion: "vencida" }).estado, "vencida");
  // Quien ya tiene 2FA cumple: la simulación no le inventa un enrolamiento.
  assert.equal(estadoDuenoDosPasos({ role: "SUPER_ADMIN", totpEnabled: true, politica: APAGADA, ahoraMs: ahora, simulacion: "vencida" }).estado, "no-aplica");
  // Y no afloja: con la gracia real vencida, simular «gracia» no la reabre.
  assert.equal(estadoDuenoDosPasos({ role: "SUPER_ADMIN", totpEnabled: false, politica: POLITICA, ahoraMs: INICIO + 30 * DIA, simulacion: "gracia" }).estado, "vencida");
});

test("en produccion la cookie de simulacion no se lee nunca", async () => {
  const { leerSimulacionDosPasos } = await import("../two-factor-cookie");
  assert.equal(leerSimulacionDosPasos("production"), null);
});

// ── La decisión ──────────────────────────────────────────────────────

const gracia = estadoDuenoDosPasos({ role: "SUPER_ADMIN", totpEnabled: false, politica: POLITICA, ahoraMs: INICIO });
const vencida = estadoDuenoDosPasos({ role: "SUPER_ADMIN", totpEnabled: false, politica: POLITICA, ahoraMs: INICIO + 8 * DIA });

test("dueño en gracia: aviso, que NO bloquea ni el panel ni la API", () => {
  const d = decisionDosPasos({ totpEnabled: false, require2fa: false, hasValidCookie: false, dueno: gracia });
  assert.equal(d, "aviso");
  assert.equal(bloqueaDosPasos(d), false);
  // Las páginas sueltas (teleconsulta) no pintan avisos: para ellas es null.
  assert.equal(twoFactorPageGateDecision({ hasValidCookie: false, dueno: gracia }), null);
});

test("dueño con la gracia vencida: enrolamiento obligatorio (bloquea, pero con salida)", () => {
  const d = decisionDosPasos({ totpEnabled: false, require2fa: false, hasValidCookie: false, dueno: vencida });
  assert.equal(d, "setup");
  assert.equal(bloqueaDosPasos(d), true);
});

test("dueño que ya enrolo: el reto de siempre, y con la prueba pasa", () => {
  assert.equal(decisionDosPasos({ totpEnabled: true, hasValidCookie: false, dueno: { estado: "no-aplica" } }), "challenge");
  assert.equal(decisionDosPasos({ totpEnabled: true, hasValidCookie: true, dueno: { estado: "no-aplica" } }), null);
});

test("require2fa de la clinica sigue mandando sobre la gracia del dueño", () => {
  assert.equal(decisionDosPasos({ totpEnabled: false, require2fa: true, hasValidCookie: false, dueno: gracia }), "setup");
});

test("«Ver como clinica» desde /admin pasa siempre: ni reto, ni enrolamiento, ni aviso", () => {
  for (const input of [
    { totpEnabled: true, hasValidCookie: false },
    { totpEnabled: false, require2fa: true, hasValidCookie: false },
    { totpEnabled: false, hasValidCookie: false, dueno: vencida },
    { totpEnabled: false, hasValidCookie: false, dueno: gracia },
  ]) {
    assert.equal(decisionDosPasos({ ...input, verComoAdmin: true }), null, JSON.stringify(input));
  }
});

test("la prueba de «Ver como clinica» y la de 2FA superado no se sustituyen entre si", () => {
  const sb = "11111111-2222-3333-4444-555555555555";
  const cli = "clinica_qa_prueba";
  const now = Date.now();
  const verComo = packTwoFactorToken(sb, cli, now, verComoSecret());
  const dosPasos = packTwoFactorToken(sb, cli, now);
  assert.equal(isTwoFactorTokenValidFor(verComo, sb, cli, now, 3600, verComoSecret()), true);
  assert.equal(isTwoFactorTokenValidFor(verComo, sb, cli, now), false, "la de admin no vale como 2FA superado");
  assert.equal(isTwoFactorTokenValidFor(dosPasos, sb, cli, now, 3600, verComoSecret()), false, "un 2FA superado no vale como admin");
  assert.equal(isTwoFactorTokenValidFor(verComo, sb, "otra_clinica", now, 3600, verComoSecret()), false, "atada a la clinica");
});

test("sin politica ni 2FA ni require2fa, la decision es null: la recepcionista de hoy no nota nada", () => {
  assert.equal(decisionDosPasos({ totpEnabled: false, require2fa: false, hasValidCookie: false }), null);
});
