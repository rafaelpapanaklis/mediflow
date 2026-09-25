/**
 * Conversión «Pago completado» de Google Ads (WS1-T3).
 *
 * Run: npx tsx --test src/app/dashboard/suspended/success/__tests__/conversion-pago.test.ts
 * (sin script en package.json: añadirlo queda fuera del alcance de la tarea).
 *
 * Fija tres cosas sin Stripe ni navegador:
 *   1. El núcleo de decisión (conversion-pago.ts): solo dispara con la clínica
 *      activada, la sesión pagada, de la clínica de la SESIÓN del usuario y
 *      marcada como primera contratación; con el importe real en pesos.
 *   2. gtag.ts: sin etiqueta no sale nada (ni un send_to a medias); sin gtag
 *      cargado tampoco; con las dos, UN evento con value, currency y
 *      transaction_id. La conversión de registro queda como estaba.
 *   3. Cableado: el checkout estampa firstContract, la página monta el
 *      componente en las dos caras y el componente cliente respeta la marca.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  centavosAPesos,
  claveMarcaLocal,
  decidirConversionPago,
  esSessionIdValido,
  type SesionCheckoutMinima,
} from "../conversion-pago";
import {
  GADS_PAGO_COMPLETADO_LABEL,
  paymentCompletedSendTo,
  sendPaymentCompletedConversion,
} from "@/lib/gtag";

const CLINICA = "clinic_abc";
const SESSION_ID = "cs_test_a1B2c3D4e5F6g7H8i9J0";

const sesion = (over: Partial<SesionCheckoutMinima> = {}, meta: Record<string, string> = {}): SesionCheckoutMinima => ({
  id: SESSION_ID,
  payment_status: "paid",
  amount_total: 41900,
  currency: "mxn",
  metadata: { clinicId: CLINICA, kind: "platform-subscription", firstContract: "1", ...meta },
  ...over,
});

const base = { clinicId: CLINICA, sessionId: SESSION_ID, activada: true };

// ── Núcleo de decisión ───────────────────────────────────────────────────────

test("primer pago confirmado: conversión con el importe real en pesos y el id de la sesión", () => {
  const c = decidirConversionPago({ ...base, sesion: sesion() });
  assert.deepEqual(c, { transactionId: SESSION_ID, valueMxn: 419, currency: "MXN" });
});

test("el importe es lo cobrado (amount_total, con cupón y IVA), no el precio de lista", () => {
  // Promo 1er mes: $19 + IVA = 2204 centavos.
  const c = decidirConversionPago({ ...base, sesion: sesion({ amount_total: 2204 }) });
  assert.equal(c?.valueMxn, 22.04);
  assert.equal(centavosAPesos(41900), 419);
  assert.equal(centavosAPesos(null), 0);
  assert.equal(centavosAPesos(-5), 0);
});

test("sin activación en la BD no hay conversión aunque Stripe diga pagada", () => {
  assert.equal(decidirConversionPago({ ...base, activada: false, sesion: sesion() }), null);
});

test("un session_id ajeno (otra clínica) no dispara: el clinicId sale de la sesión del usuario", () => {
  assert.equal(decidirConversionPago({ ...base, sesion: sesion({}, { clinicId: "clinic_otra" }) }), null);
});

test("una sesión sin pagar (SPEI/OXXO recién creado) no dispara", () => {
  assert.equal(decidirConversionPago({ ...base, sesion: sesion({ payment_status: "unpaid" }) }), null);
  assert.equal(decidirConversionPago({ ...base, sesion: sesion({ payment_status: "no_payment_required" }) }), null);
});

test("renovación, reactivación o cambio de plan (firstContract ≠ 1) no dispara", () => {
  assert.equal(decidirConversionPago({ ...base, sesion: sesion({}, { firstContract: "0" }) }), null);
  const sinMarca = sesion();
  delete sinMarca.metadata!.firstContract;
  assert.equal(decidirConversionPago({ ...base, sesion: sinMarca }), null);
});

test("otros checkouts del mismo webhook (recarga IA, factura de paciente, upgrade) no disparan", () => {
  for (const kind of ["ai-topup", "patient-invoice", "plan-upgrade-diff", ""]) {
    assert.equal(decidirConversionPago({ ...base, sesion: sesion({}, { kind }) }), null, kind);
  }
});

test("session_id inventado, vacío o que no coincide con la sesión traída: nada", () => {
  assert.equal(decidirConversionPago({ ...base, sessionId: null, sesion: sesion() }), null);
  assert.equal(decidirConversionPago({ ...base, sessionId: "cs_test_", sesion: sesion() }), null);
  assert.equal(decidirConversionPago({ ...base, sessionId: "hola", sesion: sesion() }), null);
  assert.equal(decidirConversionPago({ ...base, sessionId: "cs_test_otraSesion123456", sesion: sesion() }), null);
  assert.equal(decidirConversionPago({ ...base, sesion: null }), null);
  assert.equal(esSessionIdValido("cs_live_Abc123def456"), true);
  assert.equal(esSessionIdValido("cs_test_Abc123def456"), true);
  assert.equal(esSessionIdValido("pi_123456789012"), false);
  assert.equal(esSessionIdValido(undefined), false);
});

test("la marca local va por transaction_id", () => {
  assert.equal(claveMarcaLocal(SESSION_ID), `dc.gads.pago-completado.${SESSION_ID}`);
});

// ── gtag.ts ──────────────────────────────────────────────────────────────────

type Llamada = unknown[];
function conVentana(gtag: ((...a: unknown[]) => void) | undefined, fn: () => void) {
  const g = globalThis as unknown as { window?: unknown };
  const antes = g.window;
  g.window = gtag ? { gtag } : {};
  const info = console.info;
  console.info = () => {};
  try { fn(); } finally { g.window = antes; console.info = info; }
}

test("sin etiqueta: no sale nada a Google, ni un send_to a medias", () => {
  assert.equal(paymentCompletedSendTo(""), null);
  assert.equal(paymentCompletedSendTo("   "), null);
  const llamadas: Llamada[] = [];
  conVentana((...a) => llamadas.push(a), () => {
    const enviada = sendPaymentCompletedConversion("", { transactionId: SESSION_ID, valueMxn: 419 });
    assert.equal(enviada, false);
  });
  assert.equal(llamadas.length, 0);
});

test("con etiqueta pero sin gtag (bloqueador): false y sin error", () => {
  conVentana(undefined, () => {
    assert.equal(sendPaymentCompletedConversion("AbCdEf", { transactionId: SESSION_ID, valueMxn: 419 }), false);
  });
});

test("con etiqueta y gtag: UN evento conversion con send_to, value, currency y transaction_id", () => {
  const llamadas: Llamada[] = [];
  conVentana((...a) => llamadas.push(a), () => {
    const enviada = sendPaymentCompletedConversion("AbCdEf", { transactionId: SESSION_ID, valueMxn: 419, currency: "MXN" });
    assert.equal(enviada, true);
  });
  assert.equal(llamadas.length, 1);
  assert.deepEqual(llamadas[0], [
    "event",
    "conversion",
    { send_to: "AW-18276007996/AbCdEf", value: 419, currency: "MXN", transaction_id: SESSION_ID },
  ]);
});

test("fuera del navegador (SSR) no hace nada", () => {
  assert.equal(sendPaymentCompletedConversion("AbCdEf", { transactionId: SESSION_ID, valueMxn: 419 }), false);
});

// ── Cableado (se lee el código, como cuenta-rediseno.test.ts) ───────────────

const SRC = join(__dirname, "..", "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("la etiqueta vive en UNA constante de gtag.ts y la conversión de registro no cambió", () => {
  const gtag = leer("lib/gtag.ts");
  assert.match(gtag, /export const GADS_PAGO_COMPLETADO_LABEL = "[^"]*";/);
  assert.equal(typeof GADS_PAGO_COMPLETADO_LABEL, "string");
  // Registro completado: mismo destino, mismo value, misma función.
  assert.ok(gtag.includes('const GADS_SIGNUP_SEND_TO = "AW-18276007996/YXdlCM-xtMccELyA14pE";'));
  assert.ok(gtag.includes("export function trackSignupConversionAndRedirect(redirectUrl: string): void {"));
  assert.ok(gtag.includes("send_to: GADS_SIGNUP_SEND_TO,\n    value: 1.0,\n    currency: \"MXN\","));
});

test("el checkout estampa firstContract en la metadata compartida de la sesión", () => {
  const checkout = leer("app/api/billing/checkout/route.ts");
  assert.match(checkout, /const firstContract = isFirstContract\(clinic\);/);
  assert.match(checkout, /firstContract: firstContract \? "1" : "0",/);
  // Y solo metadata: el precio, el modo y las URLs de vuelta siguen igual.
  assert.ok(checkout.includes("const unitAmount = (billing === \"annual\" ? plan.priceMxnAnnual : plan.priceMxn) * 100;"));
  assert.ok(checkout.includes("success_url: `${baseUrl}/dashboard/suspended/success?session_id={CHECKOUT_SESSION_ID}`,"));
});

test("la página monta la conversión en las dos caras, con el clinicId de la sesión y solo si está activada", () => {
  const page = leer("app/dashboard/suspended/success/page.tsx");
  assert.match(page, /clinicId: user\.clinicId,\s*sessionId,\s*activada: isActivated,/);
  assert.equal((page.match(/\{conversionGads\}/g) ?? []).length, 2, "en la cara vieja y en la del rediseño");
  assert.ok(!page.includes("searchParams?.clinicId"), "el clinicId nunca sale de la URL");
});

test("el componente cliente no reenvía si hay marca local y solo marca cuando el ping salió", () => {
  const cliente = leer("app/dashboard/suspended/success/conversion-pago-cliente.tsx");
  assert.ok(cliente.startsWith('"use client";'));
  assert.match(cliente, /if \(window\.localStorage\.getItem\(clave\)\) return;/);
  assert.match(cliente, /const enviada = trackPaymentCompletedConversion\(/);
  assert.match(cliente, /if \(!enviada\) return;/);
  assert.match(cliente, /window\.localStorage\.setItem\(clave,/);
  assert.equal(cliente.indexOf("getItem"), Math.min(cliente.indexOf("getItem"), cliente.indexOf("setItem")), "primero se lee la marca");
});

test("el lado servidor nunca lanza: Stripe opcional y try/catch alrededor del retrieve", () => {
  const server = leer("app/dashboard/suspended/success/conversion-pago.server.ts");
  assert.match(server, /getStripeSafe\(\)/);
  assert.match(server, /if \(!stripe\) return null;/);
  assert.match(server, /try \{\s*const sesion = await stripe\.checkout\.sessions\.retrieve\(sessionId\);/);
  assert.match(server, /catch \(err\) \{[\s\S]*return null;/);
  assert.ok(!/^import "server-only"/m.test(server), "sin server-only: rompe las suites de tsx");
});
