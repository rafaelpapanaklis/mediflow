// Ortodoncia — Ola 0 (ws1-t1): el resumen de cobranza del caso, envolviendo
// estadoDelPlan. Si alguien rompe el envoltorio (zona horaria, saldo a favor,
// clasificación pagadas/vencidas/próximas), estas pruebas tienen que fallar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cobranzaDelCaso } from "../cobranza-caso";
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
