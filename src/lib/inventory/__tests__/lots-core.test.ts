// WS1-T5 — lotes y FEFO: las reglas puras, sin base ni fecha del sistema.
// Correr: npm run test:inventario-lotes

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  diasParaCaducar,
  estadoDeCaducidad,
  isExpired,
  isExpiringSoon,
  planFefoConsumption,
  reconciliationDelta,
  round3,
  type LotForFefo,
} from "../lots-core";

const d = (s: string) => new Date(s);

describe("FEFO: primero el que caduca antes", () => {
  const lots: LotForFefo[] = [
    { id: "sin-lote", expiresAt: null,            remaining: 50 },
    { id: "b",        expiresAt: d("2026-12-01"), remaining: 10 },
    { id: "a",        expiresAt: d("2026-10-01"), remaining: 10 },
  ];

  it("consume primero el de fecha más próxima, no el sin-lote", () => {
    const plan = planFefoConsumption(lots, 15);
    assert.equal(plan.ok, true);
    if (plan.ok) {
      assert.deepEqual(plan.allocations, [
        { lotId: "a", qty: 10 },
        { lotId: "b", qty: 5 },
      ]);
    }
  });

  it("el lote sin caducidad se consume AL FINAL, solo si hace falta", () => {
    const plan = planFefoConsumption(lots, 25);
    assert.equal(plan.ok, true);
    if (plan.ok) {
      assert.deepEqual(plan.allocations, [
        { lotId: "a", qty: 10 },
        { lotId: "b", qty: 10 },
        { lotId: "sin-lote", qty: 5 },
      ]);
    }
  });

  it("lote elegido a mano se consume primero, el resto sigue FEFO", () => {
    const plan = planFefoConsumption(lots, 15, "sin-lote");
    assert.equal(plan.ok, true);
    if (plan.ok) {
      assert.deepEqual(plan.allocations, [
        { lotId: "sin-lote", qty: 15 },
      ]);
    }
  });

  it("stock insuficiente: no reparte nada y dice cuánto hay de verdad", () => {
    const plan = planFefoConsumption(lots, 1000);
    assert.equal(plan.ok, false);
    if (!plan.ok) assert.equal(plan.available, 70);
  });

  it("pedir 0 o negativo no reparte nada (nunca sube stock)", () => {
    const plan = planFefoConsumption(lots, 0);
    assert.equal(plan.ok, true);
    if (plan.ok) assert.deepEqual(plan.allocations, []);
    const neg = planFefoConsumption(lots, -5);
    assert.equal(neg.ok, true);
    if (neg.ok) assert.deepEqual(neg.allocations, []);
  });

  it("nunca toca un lote ya en 0 o negativo", () => {
    const conVacio: LotForFefo[] = [
      { id: "vacio", expiresAt: d("2026-01-01"), remaining: 0 },
      { id: "c",     expiresAt: d("2026-02-01"), remaining: 5 },
    ];
    const plan = planFefoConsumption(conVacio, 5);
    assert.equal(plan.ok, true);
    if (plan.ok) assert.deepEqual(plan.allocations, [{ lotId: "c", qty: 5 }]);
  });

  it("decimales (ml/mg) sin arrastrar ruido de punto flotante", () => {
    const ml: LotForFefo[] = [{ id: "x", expiresAt: null, remaining: 12.5 }];
    const plan = planFefoConsumption(ml, 0.1 + 0.2); // 0.30000000000000004 en JS puro
    assert.equal(plan.ok, true);
    if (plan.ok) assert.equal(plan.allocations[0].qty, 0.3);
  });
});

describe("reconciliación: el lote sin-lote absorbe el drift", () => {
  it("si el agregado subió fuera de lotes (ajuste manual, compra de t4), falta cubrir la diferencia", () => {
    assert.equal(reconciliationDelta(120, 100), 20);
  });
  it("si cuadra, no hay nada que ajustar", () => {
    assert.equal(reconciliationDelta(100, 100), 0);
  });
  it("si el agregado bajó fuera de lotes, la diferencia es negativa (se recorta)", () => {
    assert.equal(reconciliationDelta(80, 100), -20);
  });
});

// ws1-t5 (28-sep-2026) — la caducidad va por DÍA DE CALENDARIO en la zona de
// la clínica. Antes estos tests comparaban instantes (`expiresAt < now`); la
// regla cambió por decisión de Rafael y los tests con ella: un lote que
// caduca el día 1 se puede usar TODO ese día y caduca a partir del día 2.
describe("caducidad por día de calendario: expirado vs. por caducar", () => {
  const hoy = "2026-09-27";

  it("sin fecha de caducidad, nunca está expirado ni por caducar", () => {
    assert.equal(isExpired(null, hoy), false);
    assert.equal(isExpiringSoon(null, hoy, 30), false);
    assert.equal(diasParaCaducar(null, hoy), null);
    assert.equal(estadoDeCaducidad(null, hoy, 30), "ok");
  });

  it("fecha pasada = expirado, no 'por caducar'", () => {
    const past = d("2026-09-01T00:00:00Z");
    assert.equal(isExpired(past, hoy), true);
    assert.equal(isExpiringSoon(past, hoy, 30), false);
    assert.equal(estadoDeCaducidad(past, hoy, 30), "caducado");
  });

  it("el día que caduca se puede usar TODO el día: aún no está caducado", () => {
    const caducaHoy = d("2026-09-27T00:00:00Z");
    assert.equal(diasParaCaducar(caducaHoy, hoy), 0);
    assert.equal(isExpired(caducaHoy, hoy), false);
    assert.equal(estadoDeCaducidad(caducaHoy, hoy, 30), "por_caducar");
  });

  it("caduca a partir del día siguiente", () => {
    const caducoAyer = d("2026-09-26T00:00:00Z");
    assert.equal(diasParaCaducar(caducoAyer, hoy), -1);
    assert.equal(isExpired(caducoAyer, hoy), true);
    assert.equal(estadoDeCaducidad(caducoAyer, hoy, 30), "caducado");
  });

  it("las dos formas ya guardadas del mismo día dan el mismo estado", () => {
    // 00:00Z (alta de lote) y 06:00Z (compra, con la hora de México fija).
    for (const forma of ["2026-09-27T00:00:00.000Z", "2026-09-27T06:00:00.000Z"]) {
      assert.equal(estadoDeCaducidad(d(forma), "2026-09-27", 30), "por_caducar", forma);
      assert.equal(estadoDeCaducidad(d(forma), "2026-09-28", 30), "caducado", forma);
    }
  });

  it("el bug que había: el 31-ago por la tarde el lote del 1-sep ya salía caducado", () => {
    const lote = d("2026-09-01T00:00:00Z");
    // A las 18:30 de México del 31 de agosto ya era 1-sep 00:30 UTC, y
    // `expiresAt < now` daba verdadero. Por día de calendario, no.
    assert.equal(lote.getTime() < d("2026-09-01T00:30:00Z").getTime(), true);
    assert.equal(estadoDeCaducidad(lote, "2026-08-31", 30), "por_caducar");
    assert.equal(estadoDeCaducidad(lote, "2026-09-01", 30), "por_caducar");
    assert.equal(estadoDeCaducidad(lote, "2026-09-02", 30), "caducado");
  });

  it("dentro de la ventana configurada = por caducar", () => {
    const in10days = d("2026-10-07T00:00:00Z");
    assert.equal(diasParaCaducar(in10days, hoy), 10);
    assert.equal(isExpired(in10days, hoy), false);
    assert.equal(isExpiringSoon(in10days, hoy, 30), true);
    assert.equal(isExpiringSoon(in10days, hoy, 5), false);
  });

  it("justo en el borde de la ventana cuenta como 'por caducar'; un día más, no", () => {
    assert.equal(isExpiringSoon(d("2026-10-27T00:00:00Z"), hoy, 30), true);
    assert.equal(isExpiringSoon(d("2026-10-28T00:00:00Z"), hoy, 30), false);
  });

  it("muy lejos, no cuenta", () => {
    const farAway = d("2027-06-01T00:00:00Z");
    assert.equal(isExpiringSoon(farAway, hoy, 30), false);
    assert.equal(estadoDeCaducidad(farAway, hoy, 30), "ok");
  });

  it("cruza meses y años contando días de calendario", () => {
    assert.equal(diasParaCaducar(d("2027-01-01T00:00:00Z"), "2026-12-31"), 1);
    assert.equal(diasParaCaducar(d("2028-03-01T00:00:00Z"), "2028-02-28"), 2); // bisiesto
  });

  it("un «hoy» ilegible no marca nada como caducado", () => {
    assert.equal(diasParaCaducar(d("2020-01-01T00:00:00Z"), "no es fecha"), null);
    assert.equal(estadoDeCaducidad(d("2020-01-01T00:00:00Z"), "", 30), "ok");
  });
});

describe("round3", () => {
  it("evita el ruido de punto flotante típico de JS", () => {
    assert.equal(round3(0.1 + 0.2), 0.3);
    assert.equal(round3(1.0005), 1.001);
    assert.equal(round3(-0.0004), 0);
  });
});
