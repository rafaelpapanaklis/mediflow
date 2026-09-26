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

/* ── Ajuste 1c: la regla final de «clínica ya creada» ────────────────────────── */
import {
  IVA_FECHA_CORTE,
  ivaAplica,
  ivaParaPagoDeClinica,
  exencionDeIva,
  senalDeTarjetaEnLaFila,
  desgloseSinIva,
} from "./iva-cobro";

const DE_ANTES = { createdAt: new Date("2025-11-03T12:00:00Z"), plan: "PRO", stripeSubscriptionId: null, subscriptionId: null };
const NUEVA = { ...DE_ANTES, createdAt: new Date("2026-10-05T12:00:00Z") };

test("el corte es el 26-sep-2026 00:00 de México (06:00 UTC): una constante del código, sin SQL", () => {
  assert.equal(IVA_FECHA_CORTE.toISOString(), "2026-09-26T06:00:00.000Z");
});

test("(a) creada en/después del corte → NUNCA exenta; (b) antes → exenta de SU plan, haya pagado o no", () => {
  assert.deepEqual(exencionDeIva(DE_ANTES), { plan: "PRO", tarjeta: true }, "aunque nunca haya pagado");
  assert.deepEqual(exencionDeIva({ ...DE_ANTES, nextBillingDate: new Date() } as any), { plan: "PRO", tarjeta: true });
  assert.equal(exencionDeIva(NUEVA), null);
  assert.equal(exencionDeIva({ ...DE_ANTES, createdAt: IVA_FECHA_CORTE }), null, "justo en el corte = nueva");
  assert.deepEqual(exencionDeIva({ ...DE_ANTES, createdAt: new Date(IVA_FECHA_CORTE.getTime() - 1000) }), { plan: "PRO", tarjeta: true });
  // datos que faltan → con IVA: nunca se regala por un dato ausente
  for (const mala of [null, undefined, {}, { ...DE_ANTES, createdAt: null }, { ...DE_ANTES, createdAt: "no-es-fecha" }, { ...DE_ANTES, plan: null }]) {
    assert.equal(exencionDeIva(mala as any), null);
  }
});

test("tuvo tarjeta y la canceló → la exención NO cubre la tarjeta (reactivar = con IVA); OXXO/SPEI siguen exentos", () => {
  const e = exencionDeIva({ ...DE_ANTES, tuvoTarjeta: true });
  assert.deepEqual(e, { plan: "PRO", tarjeta: false });
  assert.equal(ivaAplica({ metodo: "card", plan: "PRO", exencion: e }), true);
  assert.equal(ivaAplica({ metodo: "oxxo", plan: "PRO", exencion: e }), false);
  assert.equal(ivaAplica({ metodo: "spei", plan: "PRO", exencion: e }), false);
});

test("señales de tarjeta en la fila: stripeSubscriptionId o subscriptionId; `subscriptionStatus` NO cuenta", () => {
  assert.equal(senalDeTarjetaEnLaFila({ stripeSubscriptionId: "sub_x" }), true);
  assert.equal(senalDeTarjetaEnLaFila({ subscriptionId: "legacy_1" }), true);
  assert.equal(senalDeTarjetaEnLaFila({}), false);
  assert.equal(senalDeTarjetaEnLaFila({ stripeSubscriptionId: null, subscriptionId: null, subscriptionStatus: "cancelled" } as any), false);
});

test("tabla de decisión: método × plan × exención", () => {
  const a = (metodo: "card" | "spei" | "oxxo", plan: string, e: any) => ivaAplica({ metodo, plan, exencion: e });
  const sinTarjetaPrevia = { plan: "PRO", tarjeta: true };
  const conTarjetaPrevia = { plan: "PRO", tarjeta: false };
  // clínica de antes, mismo plan
  assert.equal(a("oxxo", "PRO", sinTarjetaPrevia), false);
  assert.equal(a("spei", "PRO", sinTarjetaPrevia), false);
  assert.equal(a("card", "PRO", sinTarjetaPrevia), false, "su contratación con tarjeta, aunque nunca haya pagado");
  assert.equal(a("card", "PRO", conTarjetaPrevia), true, "reactivar tarjeta tras cancelar");
  // clínica de antes, OTRO plan = cambio de plan
  for (const m of ["card", "oxxo", "spei"] as const) {
    assert.equal(a(m, "CLINIC", sinTarjetaPrevia), true, m);
    assert.equal(a(m, "BASIC", conTarjetaPrevia), true, m);
  }
  // clínica nueva: todo con IVA
  for (const m of ["card", "oxxo", "spei"] as const) assert.equal(a(m, "PRO", null), true, m);
});

test("ivaParaPagoDeClinica: exento no exige el env; con IVA sí", () => {
  const sinEnv = {};
  const ex = { plan: "PRO", tarjeta: true };
  assert.deepEqual(ivaParaPagoDeClinica(sinEnv, { metodo: "oxxo", plan: "PRO", exencion: ex }), { ok: true, modo: "exento", sesion: {}, linea: {} });
  assert.deepEqual(ivaParaPagoDeClinica(sinEnv, { metodo: "card", plan: "PRO", exencion: ex }), { ok: true, modo: "exento", sesion: {}, linea: {} });
  assert.equal(ivaParaPagoDeClinica(sinEnv, { metodo: "card", plan: "PRO", exencion: { plan: "PRO", tarjeta: false } }).ok, false);
  assert.equal(ivaParaPagoDeClinica(sinEnv, { metodo: "oxxo", plan: "PRO", exencion: null }).ok, false);
  const r = ivaParaPagoDeClinica({ STRIPE_IVA_TAX_RATE_ID: TASA }, { metodo: "oxxo", plan: "CLINIC", exencion: ex });
  assert.deepEqual(r.ok && r.linea, { tax_rates: [TASA] });
});

test("desgloseSinIva: total = subtotal", () => {
  assert.deepEqual(desgloseSinIva(68900), { subtotalCents: 68900, ivaCents: 0, totalCents: 68900 });
});
