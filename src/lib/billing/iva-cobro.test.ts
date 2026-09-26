/**
 * IVA 16 % DE LOS PAGOS NUEVOS — el helper puro (ws1-t3, ajuste 1).
 *
 * Run: npm run test:iva-cobro
 *
 * Qué IVA lleva una sesión nueva de cobro por plan según los envs, y que sin
 * ninguno NO se cobra sin IVA en silencio. El comportamiento de la ruta de
 * checkout y la garantía de que las suscripciones existentes no se tocan están
 * en src/app/api/billing/__tests__/checkout-iva.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CODIGO_IVA_NO_CONFIGURADO,
  desgloseConIva,
  esIdDeTasa,
  ivaParaCobro,
} from "./iva-cobro";

const TASA = "txr_1Pabcdefghijklmn";

test("con la tasa manual: `tax_rates` en la línea del plan y nada de Stripe Tax", () => {
  const r = ivaParaCobro({ STRIPE_IVA_TAX_RATE_ID: TASA });
  assert.deepEqual(r, { ok: true, modo: "tasa", sesion: {}, linea: { tax_rates: [TASA] } });
});

test("el id se recorta y solo vale con forma de tasa de Stripe (txr_…)", () => {
  assert.equal(ivaParaCobro({ STRIPE_IVA_TAX_RATE_ID: `  ${TASA}\n` }).ok, true);
  for (const mal of ["", " ", "price_1Pabcdefghijk", "txr_", "txr_corto", "TXR_1Pabcdefghijklmn", "txr_1P abcdefghij"]) {
    assert.equal(esIdDeTasa(mal), false, mal);
    const r = ivaParaCobro({ STRIPE_IVA_TAX_RATE_ID: mal });
    assert.equal(r.ok, false, mal);
  }
});

test("sin tasa ni Stripe Tax NO se cobra: error claro y código estable (el checkout responde 503)", () => {
  const r = ivaParaCobro({});
  assert.equal(r.ok, false);
  if (r.ok === false) {
    assert.equal(r.codigo, CODIGO_IVA_NO_CONFIGURADO);
    assert.match(r.error, /no está disponible por ahora/);
    assert.match(r.error, /SPEI/, "y le dice a la clínica que SPEI sí funciona");
  }
  assert.equal(ivaParaCobro({ STRIPE_AUTOMATIC_TAX: "false" }).ok, false);
});

test("si algún día STRIPE_AUTOMATIC_TAX=true: Stripe Tax y NUNCA la tasa manual a la vez", () => {
  const r = ivaParaCobro({ STRIPE_AUTOMATIC_TAX: "true", STRIPE_IVA_TAX_RATE_ID: TASA });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.modo, "automatico");
    assert.deepEqual(r.linea, {}, "sin tax_rates: el IVA se sumaría doble");
    assert.equal(r.sesion.automatic_tax?.enabled, true);
    assert.equal(r.sesion.customer_update?.address, "auto", "Stripe Tax necesita la dirección");
  }
  // Sin tasa configurada, con Stripe Tax también cobra.
  assert.equal(ivaParaCobro({ STRIPE_AUTOMATIC_TAX: "true" }).ok, true);
});

test("desglose: total = subtotal + IVA, en enteros, para los planes de hoy y las promos", () => {
  const casos: Array<[number, number, number]> = [
    [41900, 6704, 48604], [68900, 11024, 79924], [171900, 27504, 199404],
    [326400, 52224, 378624], [537600, 86016, 623616], [1340400, 214464, 1554864],
    // promo del primer mes con tarjeta ($19 / $29 / $39 + IVA)
    [1900, 304, 2204], [2900, 464, 3364], [3900, 624, 4524],
  ];
  for (const [sub, iva, total] of casos) {
    assert.deepEqual(desgloseConIva(sub), { subtotalCents: sub, ivaCents: iva, totalCents: total }, String(sub));
  }
});

/* ── Ajuste 1b: «clínica ya registrada» (renueva a mano sin IVA) ─────────────── */
import {
  IVA_FECHA_CORTE,
  ivaAplica,
  ivaParaPagoDeClinica,
  planConPagoManualSinIva,
  desgloseSinIva,
} from "./iva-cobro";

const DE_ANTES = { createdAt: new Date("2025-11-03T12:00:00Z"), plan: "PRO", nextBillingDate: new Date("2026-09-30"), stripeSubscriptionId: null, subscriptionId: null };

test("el corte es el 26-sep-2026 00:00 de México (06:00 UTC): una constante del código, sin SQL", () => {
  assert.equal(IVA_FECHA_CORTE.toISOString(), "2026-09-26T06:00:00.000Z");
});

test("«ya registrada» = creada ANTES del corte Y ya había pagado; devuelve su plan", () => {
  assert.equal(planConPagoManualSinIva(DE_ANTES), "PRO");
  // ya pagó por cualquiera de las tres señales (mismas que «no es primera contratación»)
  assert.equal(planConPagoManualSinIva({ ...DE_ANTES, nextBillingDate: null, stripeSubscriptionId: "sub_x" }), "PRO");
  assert.equal(planConPagoManualSinIva({ ...DE_ANTES, nextBillingDate: null, subscriptionId: "legacy_1" }), "PRO");
  // registrada antes pero NUNCA pagó → compra nueva → con IVA
  assert.equal(planConPagoManualSinIva({ ...DE_ANTES, nextBillingDate: null }), null);
  // registrada en/después del corte → nueva, aunque ya haya pagado
  assert.equal(planConPagoManualSinIva({ ...DE_ANTES, createdAt: IVA_FECHA_CORTE }), null);
  assert.equal(planConPagoManualSinIva({ ...DE_ANTES, createdAt: "2026-10-01T00:00:00Z" }), null);
  assert.equal(planConPagoManualSinIva({ ...DE_ANTES, createdAt: new Date(IVA_FECHA_CORTE.getTime() - 1000) }), "PRO");
  // datos que faltan → se trata como nueva (con IVA): nunca se regala el IVA por un dato ausente
  for (const mala of [null, undefined, {}, { ...DE_ANTES, createdAt: null }, { ...DE_ANTES, createdAt: "no-es-fecha" }, { ...DE_ANTES, plan: null }]) {
    assert.equal(planConPagoManualSinIva(mala as any), null);
  }
});

test("la excepción es solo OXXO/SPEI del MISMO plan; tarjeta y otro plan llevan IVA", () => {
  const a = (metodo: "card" | "spei" | "oxxo", plan: string, planExento: string | null) => ivaAplica({ metodo, plan, planExento });
  assert.equal(a("oxxo", "PRO", "PRO"), false);
  assert.equal(a("spei", "PRO", "PRO"), false);
  assert.equal(a("card", "PRO", "PRO"), true, "tarjeta = suscripción nueva");
  assert.equal(a("oxxo", "CLINIC", "PRO"), true, "otro plan = condición nueva");
  assert.equal(a("spei", "BASIC", "PRO"), true);
  assert.equal(a("oxxo", "PRO", null), true, "clínica nueva: todo con IVA");
});

test("ivaParaPagoDeClinica: exento no exige el env; el resto sí", () => {
  const sinEnv = {};
  const exento = ivaParaPagoDeClinica(sinEnv, { metodo: "oxxo", plan: "PRO", clinica: DE_ANTES });
  assert.deepEqual(exento, { ok: true, modo: "exento", sesion: {}, linea: {} });
  assert.equal(ivaParaPagoDeClinica(sinEnv, { metodo: "card", plan: "PRO", clinica: DE_ANTES }).ok, false);
  assert.equal(ivaParaPagoDeClinica(sinEnv, { metodo: "oxxo", plan: "PRO", clinica: { ...DE_ANTES, createdAt: "2026-10-01" } }).ok, false);
  const conEnv = { STRIPE_IVA_TAX_RATE_ID: TASA };
  const r = ivaParaPagoDeClinica(conEnv, { metodo: "oxxo", plan: "CLINIC", clinica: DE_ANTES });
  assert.deepEqual(r.ok && r.linea, { tax_rates: [TASA] });
});

test("desgloseSinIva: total = subtotal", () => {
  assert.deepEqual(desgloseSinIva(68900), { subtotalCents: 68900, ivaCents: 0, totalCents: 68900 });
});
