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
