// Ortodoncia — Ola 0 (ws1-t1): el resumen de cobranza del caso, envolviendo
// estadoDelPlan. Si alguien rompe el envoltorio (zona horaria, saldo a favor,
// clasificación pagadas/vencidas/próximas), estas pruebas tienen que fallar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cobranzaDelCaso, cobranzaPorControles, combinarCobranzas, cobranzaDelCasoUnificada, type CargoDeControl } from "../cobranza-caso";
import { condicionesPorDefecto, type CondicionesPago } from "@/lib/quotes/condiciones-pago";

const plazos = (p: Partial<CondicionesPago>): CondicionesPago => ({
  ...condicionesPorDefecto(),
  modo: "plazos",
  numPagos: 3,
  primerPago: "2026-01-03",
  ...p,
});

test("sin factura abierta (condiciones null): todo en cero, nada se rompe", () => {
  const r = cobranzaDelCaso({
    condiciones: null,
    totalFactura: 0,
    cobros: [],
    saldoAFavorPrevio: 0,
    ahora: new Date("2026-03-01T12:00:00Z"),
    zonaHoraria: "America/Mexico_City",
  });
  assert.equal(r.cuotaDeHoy, null);
  assert.deepEqual(r.pagadas, []);
  assert.deepEqual(r.vencidas, []);
  assert.deepEqual(r.proximas, []);
  assert.equal(r.saldoTotal, 0);
  assert.equal(r.saldoAFavor, 0);
  assert.equal(r.proximoVencimiento, null);
});

test("clasifica pagadas, vencidas y próximas; cuotaDeHoy es la más vieja que debe algo", () => {
  // 3 cuotas de $2,000: 2026-01-03, 2026-02-03, 2026-03-03. Se paga la primera.
  const r = cobranzaDelCaso({
    condiciones: plazos({}),
    totalFactura: 6000,
    cobros: [{ amount: 2000, method: "cash" }],
    saldoAFavorPrevio: 0,
    // "Hoy" es 10 de febrero en la zona de la clínica: la de febrero ya
    // venció, la de marzo todavía no.
    ahora: new Date("2026-02-10T12:00:00Z"),
    zonaHoraria: "America/Mexico_City",
  });
  assert.equal(r.pagadas.length, 1);
  assert.equal(r.pagadas[0].numero, 1);
  assert.equal(r.vencidas.length, 1);
  assert.equal(r.vencidas[0].numero, 2);
  assert.equal(r.proximas.length, 1);
  assert.equal(r.proximas[0].numero, 3);
  assert.equal(r.cuotaDeHoy?.numero, 2);
  assert.equal(r.saldoTotal, 4000);
  assert.equal(r.proximoVencimiento, "2026-03-03");
});

test("saldoAFavor suma el previo (otras facturas) más el excedente de ESTE plan", () => {
  const r = cobranzaDelCaso({
    condiciones: plazos({ numPagos: 1 }),
    totalFactura: 2000,
    // Se cobra de más: $500 de excedente sobre este plan.
    cobros: [{ amount: 2500, method: "cash" }],
    saldoAFavorPrevio: 1000,
    ahora: new Date("2026-01-01T12:00:00Z"),
    zonaHoraria: "America/Mexico_City",
  });
  assert.equal(r.saldoAFavor, 1500);
  assert.equal(r.saldoTotal, 0);
  assert.equal(r.cuotaDeHoy, null);
});

test("un reembolso (method: refund) hace retroceder el plan, no solo el saldo", () => {
  const cobros = [
    { amount: 6000, method: "cash" },
    { amount: 2000, method: "refund" },
  ];
  const r = cobranzaDelCaso({
    condiciones: plazos({}),
    totalFactura: 6000,
    cobros,
    saldoAFavorPrevio: 0,
    ahora: new Date("2026-01-01T12:00:00Z"),
    zonaHoraria: "America/Mexico_City",
  });
  assert.equal(r.pagadas.length, 2);
  assert.equal(r.saldoTotal, 2000);
});

test("la fecha de 'hoy' se lee en la zona de la clínica, no en la del servidor", () => {
  // 23:30 UTC del 2 de marzo ya es 3 de marzo en Ciudad de México (UTC-6) recién
  // pasada la medianoche del día en que vence la primera cuota: NO cuenta como
  // vencida (vence hoy, todavía no vencida) según hoyEnZona.
  const ahora = new Date("2026-01-03T04:00:00Z"); // 2026-01-02 22:00 CDMX
  const r = cobranzaDelCaso({
    condiciones: plazos({}),
    totalFactura: 6000,
    cobros: [],
    saldoAFavorPrevio: 0,
    ahora,
    zonaHoraria: "America/Mexico_City",
  });
  assert.equal(r.vencidas.length, 0, "la cuota del 3 de enero no vence hasta que pase ese día en CDMX");
  assert.equal(r.proximas.length, 3);
});

// ═══════════════════════════════════════════════════════════════════════════
// Ola 2 (ws1-t1) — modo PAGO_POR_CONTROL: cargos independientes (controles +
// colocación/enganche), sin cascada entre facturas.
// ═══════════════════════════════════════════════════════════════════════════

const cargo = (p: Partial<CargoDeControl>): CargoDeControl => ({
  invoiceId: "inv-x",
  invoiceNumber: "F-0001",
  total: 500,
  pagado: 0,
  status: "PENDING",
  vencimiento: "2026-02-01",
  ...p,
});

test("cobranzaPorControles: sin cargos, todo en cero", () => {
  const r = cobranzaPorControles([], new Date("2026-02-10T12:00:00Z"), "America/Mexico_City");
  assert.equal(r.cuotaDeHoy, null);
  assert.equal(r.saldoTotal, 0);
  assert.equal(r.saldoAFavor, 0);
});

test("cobranzaPorControles: cada factura es independiente, SIN cascada (a diferencia de un plan a plazos)", () => {
  // Control de enero: pagado de más ($800 sobre $500). Control de febrero: sin pagar.
  // El excedente de enero NO abona el de febrero: cada factura es su propio cobro.
  const cargos = [
    cargo({ invoiceId: "ene", total: 500, pagado: 800, vencimiento: "2026-01-15" }),
    cargo({ invoiceId: "feb", total: 500, pagado: 0, vencimiento: "2026-02-15" }),
  ];
  const r = cobranzaPorControles(cargos, new Date("2026-02-20T12:00:00Z"), "America/Mexico_City");
  assert.equal(r.pagadas.length, 1);
  assert.equal(r.vencidas.length, 1, "el de febrero venció y sigue debiendo TODO su importe, el excedente de enero no lo tocó");
  assert.equal(r.vencidas[0].falta, 500);
  assert.equal(r.saldoTotal, 500);
  assert.equal(r.saldoAFavor, 300, "el excedente de enero ($300) sale como saldo a favor, no como abono a febrero");
});

test("cobranzaPorControles: clasifica vencida/próxima igual que el plan a plazos, y ordena cronológicamente", () => {
  const cargos = [
    cargo({ invoiceId: "b", total: 500, vencimiento: "2026-03-01" }),
    cargo({ invoiceId: "a", total: 500, vencimiento: "2026-01-01" }),
  ];
  const r = cobranzaPorControles(cargos, new Date("2026-02-01T12:00:00Z"), "America/Mexico_City");
  assert.equal(r.vencidas.length, 1);
  assert.equal(r.vencidas[0].vencimiento, "2026-01-01");
  assert.equal(r.proximas.length, 1);
  assert.equal(r.proximas[0].vencimiento, "2026-03-01");
  assert.equal(r.cuotaDeHoy?.vencimiento, "2026-01-01", "la vencida manda sobre la próxima");
  assert.equal(r.proximoVencimiento, "2026-03-01");
});

test("combinarCobranzas: une colocación + controles sin duplicar nada", () => {
  const colocacion = cobranzaDelCaso({
    condiciones: plazos({ numPagos: 1, enganche: 0 }),
    totalFactura: 8000,
    cobros: [],
    saldoAFavorPrevio: 0,
    ahora: new Date("2026-02-10T12:00:00Z"),
    zonaHoraria: "America/Mexico_City",
  });
  const controles = cobranzaPorControles(
    [cargo({ invoiceId: "c1", total: 500, vencimiento: "2026-01-10" })],
    new Date("2026-02-10T12:00:00Z"),
    "America/Mexico_City",
  );
  const r = combinarCobranzas(colocacion, controles);
  assert.ok(r);
  assert.equal(r!.vencidas.length, colocacion.vencidas.length + controles.vencidas.length);
  assert.equal(r!.saldoTotal, colocacion.saldoTotal + controles.saldoTotal);
});

test("combinarCobranzas: null + null = null", () => {
  assert.equal(combinarCobranzas(null, null), null);
});

test("cobranzaDelCasoUnificada: modo PRECIO_TOTAL se comporta EXACTAMENTE como cobranzaDelCaso (sin tocar el motor viejo)", () => {
  const facturaPrincipal = { condiciones: plazos({}), totalFactura: 6000, cobros: [{ amount: 2000, method: "cash" }] };
  const directo = cobranzaDelCaso({ ...facturaPrincipal, saldoAFavorPrevio: 100, ahora: new Date("2026-02-10T12:00:00Z"), zonaHoraria: "America/Mexico_City" });
  const unificado = cobranzaDelCasoUnificada({
    modo: "PRECIO_TOTAL",
    facturaPrincipal,
    cargosControl: [cargo({})], // debe IGNORARSE en este modo
    saldoAFavorPrevio: 100,
    ahora: new Date("2026-02-10T12:00:00Z"),
    zonaHoraria: "America/Mexico_City",
  });
  assert.deepEqual(unificado, directo);
});

test("cobranzaDelCasoUnificada: modo PAGO_POR_CONTROL sin colocación todavía, solo controles", () => {
  const r = cobranzaDelCasoUnificada({
    modo: "PAGO_POR_CONTROL",
    facturaPrincipal: null,
    cargosControl: [cargo({ invoiceId: "c1", total: 500, vencimiento: "2026-01-01" })],
    saldoAFavorPrevio: 50,
    ahora: new Date("2026-02-10T12:00:00Z"),
    zonaHoraria: "America/Mexico_City",
  });
  assert.ok(r);
  assert.equal(r!.vencidas.length, 1);
  assert.equal(r!.saldoTotal, 500);
  assert.equal(r!.saldoAFavor, 50, "saldoAFavorPrevio se ve aunque no haya factura de colocación");
});

test("cobranzaDelCasoUnificada: sin colocación y sin controles, pero con saldo a favor previo — no da null", () => {
  const r = cobranzaDelCasoUnificada({
    modo: "PAGO_POR_CONTROL",
    facturaPrincipal: null,
    cargosControl: [],
    saldoAFavorPrevio: 200,
    ahora: new Date("2026-02-10T12:00:00Z"),
    zonaHoraria: "America/Mexico_City",
  });
  assert.ok(r);
  assert.equal(r!.saldoAFavor, 200);
  assert.equal(r!.saldoTotal, 0);
});

test("cobranzaDelCasoUnificada: sin nada de nada da null (nada que pintar)", () => {
  const r = cobranzaDelCasoUnificada({
    modo: "PAGO_POR_CONTROL",
    facturaPrincipal: null,
    cargosControl: [],
    saldoAFavorPrevio: 0,
    ahora: new Date("2026-02-10T12:00:00Z"),
    zonaHoraria: "America/Mexico_City",
  });
  assert.equal(r, null);
});

test("cobranzaDelCasoUnificada: modo ausente/desconocido cae a PRECIO_TOTAL (caso viejo, previo a Ola 2)", () => {
  const facturaPrincipal = { condiciones: plazos({}), totalFactura: 6000, cobros: [] };
  const r = cobranzaDelCasoUnificada({
    modo: undefined,
    facturaPrincipal,
    cargosControl: [cargo({})], // ignorado: modo undefined = PRECIO_TOTAL
    saldoAFavorPrevio: 0,
    ahora: new Date("2026-02-10T12:00:00Z"),
    zonaHoraria: "America/Mexico_City",
  });
  const directo = cobranzaDelCaso({ ...facturaPrincipal, saldoAFavorPrevio: 0, ahora: new Date("2026-02-10T12:00:00Z"), zonaHoraria: "America/Mexico_City" });
  assert.deepEqual(r, directo);
});
