/* ═══════════════════════════════════════════════════════════════════════
   «Conectar mi WhatsApp» — la lógica PURA del Embedded Signup de barber.

     npx tsx --test src/lib/barber/__tests__/wa-signup.test.ts

   15-nov-2026: Rafael terminó la ventana de Meta en producción y el panel
   dijo «Algo salió mal. Intenta de nuevo.». Tres fallos distintos caían en
   el mismo texto; ahora cada uno tiene el suyo, y si llega el código pero
   no el número, el servidor lo busca con el token.
   ═══════════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  barberSignupFailureText,
  barberSignupWarnLine,
  decideBarberSignupStep,
  pickBarberSignupNumber,
  readBarberSignupMessage,
  wabaIdsFromDebugToken,
  type BarberSignupSession,
} from "../wa-signup-core";

const CODE = "AQD-codigo-de-meta-123456";

// ── lo que avisa la ventana de Meta ─────────────────────────────────────

test("FINISH (coexistence y clásico, objeto o texto JSON) trae la cuenta y el número", () => {
  const a = readBarberSignupMessage({}, {
    type: "WA_EMBEDDED_SIGNUP",
    event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
    data: { waba_id: "111222333", phone_number_id: "444555666" },
  });
  assert.deepEqual(a, { lastEvent: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", wabaId: "111222333", phoneNumberId: "444555666" });
  const b = readBarberSignupMessage({}, JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { waba_id: "1", phone_number_id: "2" } }));
  assert.equal(b?.wabaId, "1");
  assert.equal(b?.phoneNumberId, "2");
});

test("CANCEL guarda el paso y ERROR el código (sin el mensaje); lo demás se ignora", () => {
  assert.deepEqual(
    readBarberSignupMessage({}, { type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", data: { current_step: "PHONE_NUMBER_SETUP" } }),
    { lastEvent: "CANCEL", cancelStep: "PHONE_NUMBER_SETUP" },
  );
  const err = readBarberSignupMessage({}, {
    type: "WA_EMBEDDED_SIGNUP", event: "ERROR", data: { error_code: 2593001, error_message: "algo con datos", session_id: "s" },
  });
  assert.deepEqual(err, { lastEvent: "ERROR", errorCode: "2593001" });
  assert.equal(readBarberSignupMessage({}, "no es json"), null);
  assert.equal(readBarberSignupMessage({}, { type: "OTRA_COSA", event: "FINISH" }), null);
  assert.equal(readBarberSignupMessage({}, null), null);
});

test("un FINISH sin número no borra lo que ya se sabía", () => {
  const prev: BarberSignupSession = { wabaId: "9", phoneNumberId: "8" };
  const r = readBarberSignupMessage(prev, { type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: {} });
  assert.equal(r?.wabaId, "9");
  assert.equal(r?.phoneNumberId, "8");
});

// ── qué se hace al volver de la ventana ─────────────────────────────────

test("(a) sin código: «cerraste la ventana» (o error de Meta si eso avisó)", () => {
  assert.deepEqual(decideBarberSignupStep(undefined, {}), { kind: "canceled", reason: "closed" });
  assert.deepEqual(decideBarberSignupStep(undefined, { lastEvent: "CANCEL" }), { kind: "canceled", reason: "closed" });
  assert.deepEqual(decideBarberSignupStep(null, { lastEvent: "ERROR" }), { kind: "canceled", reason: "metaError" });
  assert.deepEqual(barberSignupFailureText({ step: { kind: "canceled", reason: "closed" } }), { key: "canceled" });
  assert.deepEqual(barberSignupFailureText({ step: { kind: "canceled", reason: "metaError" } }), { key: "metaError" });
});

test("(b) código sin número: YA NO se rinde, se manda al servidor diciendo qué faltó", () => {
  assert.deepEqual(decideBarberSignupStep(CODE, {}), { kind: "send", missing: ["wabaId", "phoneNumberId"] });
  assert.deepEqual(decideBarberSignupStep(CODE, { wabaId: "1" }), { kind: "send", missing: ["phoneNumberId"] });
  assert.deepEqual(decideBarberSignupStep(CODE, { wabaId: "1", phoneNumberId: "2" }), { kind: "send", missing: [] });
});

test("el aviso de consola dice qué faltó y NUNCA lleva el código ni los ids", () => {
  const s: BarberSignupSession = { lastEvent: "CANCEL", cancelStep: "WABA_PHONE_SETUP", wabaId: "111222333" };
  const sinCodigo = barberSignupWarnLine(decideBarberSignupStep(undefined, s), s)!;
  assert.match(sinCodigo, /no llegó el código/);
  assert.match(sinCodigo, /CANCEL/);
  assert.match(sinCodigo, /WABA_PHONE_SETUP/);
  const parcial = barberSignupWarnLine(decideBarberSignupStep(CODE, s), s)!;
  assert.match(parcial, /faltó phoneNumberId/);
  for (const linea of [sinCodigo, parcial]) {
    assert.ok(!linea.includes(CODE), "sin el código");
    assert.ok(!linea.includes("111222333"), "sin ids");
  }
  // Todo bien: nada que avisar.
  const ok = { wabaId: "1", phoneNumberId: "2" };
  assert.equal(barberSignupWarnLine(decideBarberSignupStep(CODE, ok), ok), null);
});

test("(c) respuesta del servidor: su código manda; luego su texto; sin nada, «servidor»", () => {
  assert.deepEqual(barberSignupFailureText({ status: 409, body: { code: "NUMBER_NOT_FOUND", error: "x" } }), { key: "noNumber" });
  assert.deepEqual(barberSignupFailureText({ status: 409, body: { code: "NUMBER_AMBIGUOUS" } }), { key: "manyNumbers" });
  assert.deepEqual(
    barberSignupFailureText({ status: 409, body: { code: "PHONE_TAKEN", error: "Ese número ya está conectado…" } }),
    { message: "Ese número ya está conectado…" },
  );
  assert.deepEqual(barberSignupFailureText({ status: 500, body: null }), { key: "server" });
  assert.deepEqual(barberSignupFailureText({ status: 502, body: { error: "   " } }), { key: "server" });
  assert.deepEqual(barberSignupFailureText({ network: true }), { key: "network" });
});

test("los seis textos existen en es y en, y el de cancelar es el que pidió Rafael", () => {
  for (const l of ["es", "en"]) {
    const j = JSON.parse(readFileSync(`src/i18n/dictionaries/barber/whatsapp.${l}.json`, "utf8"));
    for (const k of ["canceled", "metaError", "noNumber", "manyNumbers", "server", "network"]) {
      assert.ok(typeof j.signup?.[k] === "string" && j.signup[k].length > 20, `${l}: signup.${k}`);
    }
  }
  const es = JSON.parse(readFileSync("src/i18n/dictionaries/barber/whatsapp.es.json", "utf8"));
  assert.equal(es.signup.canceled, "Cerraste la ventana de Meta antes de terminar: vuelve a intentarlo y termina con el botón azul.");
  assert.match(es.signup.noNumber, /^Meta no nos dijo qué número conectaste/);
  // El botón ya no usa el genérico «Algo salió mal».
  const boton = readFileSync("src/components/barber/whatsapp/embedded-signup-button.tsx", "utf8");
  assert.doesNotMatch(boton, /errors\.generic/);
});

// ── el servidor busca la cuenta y el número con el token ────────────────

test("las cuentas compartidas salen de debug_token (solo permisos de WhatsApp, sin repetir)", () => {
  const json = {
    data: {
      granular_scopes: [
        { scope: "business_management", target_ids: ["999999999"] },
        { scope: "whatsapp_business_management", target_ids: ["111222333", "777888999"] },
        { scope: "whatsapp_business_messaging", target_ids: ["111222333"] },
        { scope: "whatsapp_business_messaging", target_ids: ["no-numero", null] },
      ],
    },
  };
  assert.deepEqual(wabaIdsFromDebugToken(json), ["111222333", "777888999"]);
  assert.deepEqual(wabaIdsFromDebugToken(null), []);
  assert.deepEqual(wabaIdsFromDebugToken({ error: { message: "x" } }), []);
});

test("un solo número en lo que lista el token: se toma", () => {
  assert.deepEqual(
    pickBarberSignupNumber({ listings: [{ wabaId: "W1", phoneNumberIds: ["P1"] }, { wabaId: "W2", phoneNumberIds: [] }] }),
    { ok: true, wabaId: "W1", phoneNumberId: "P1", discovered: true },
  );
});

test("varios números y nada que los distinga: NO se adivina", () => {
  assert.deepEqual(
    pickBarberSignupNumber({ listings: [{ wabaId: "W1", phoneNumberIds: ["P1", "P2"] }] }),
    { ok: false, code: "NUMBER_AMBIGUOUS" },
  );
  assert.deepEqual(
    pickBarberSignupNumber({ listings: [{ wabaId: "W1", phoneNumberIds: ["P1"] }, { wabaId: "W2", phoneNumberIds: ["P2"] }] }),
    { ok: false, code: "NUMBER_AMBIGUOUS" },
  );
});

test("con la cuenta del navegador, se elige dentro de ESA cuenta", () => {
  const listings = [{ wabaId: "W1", phoneNumberIds: ["P1"] }, { wabaId: "W2", phoneNumberIds: ["P2"] }];
  assert.deepEqual(pickBarberSignupNumber({ clientWabaId: "W2", listings }), { ok: true, wabaId: "W2", phoneNumberId: "P2", discovered: true });
  assert.deepEqual(pickBarberSignupNumber({ clientWabaId: "W9", listings }), { ok: false, code: "NUMBER_NOT_FOUND" });
});

test("con el número del navegador, se busca su cuenta; si el token no lo lista, no se acepta", () => {
  const listings = [{ wabaId: "W1", phoneNumberIds: ["P1"] }, { wabaId: "W2", phoneNumberIds: ["P2", "P3"] }];
  assert.deepEqual(pickBarberSignupNumber({ clientPhoneNumberId: "P3", listings }), { ok: true, wabaId: "W2", phoneNumberId: "P3", discovered: true });
  // Un número ajeno (no lo lista el token de quien autorizó): fuera.
  assert.deepEqual(pickBarberSignupNumber({ clientPhoneNumberId: "AJENO", listings }), { ok: false, code: "NUMBER_NOT_FOUND" });
});

test("sin nada en la lista (Meta no contestó o la cuenta no tiene números)", () => {
  assert.deepEqual(pickBarberSignupNumber({ listings: [] }), { ok: false, code: "NUMBER_NOT_FOUND" });
});
