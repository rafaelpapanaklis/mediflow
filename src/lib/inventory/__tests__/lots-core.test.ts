// WS1-T5 — lotes y FEFO: las reglas puras, sin base ni fecha del sistema.
// Correr: npm run test:inventario-lotes

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
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

describe("caducidad: expirado vs. por caducar", () => {
  const now = d("2026-09-27T12:00:00Z");

  it("sin fecha de caducidad, nunca está expirado ni por caducar", () => {
    assert.equal(isExpired(null, now), false);
    assert.equal(isExpiringSoon(null, now, 30), false);
  });

  it("fecha pasada = expirado, no 'por caducar'", () => {
    const past = d("2026-09-01T00:00:00Z");
    assert.equal(isExpired(past, now), true);
    assert.equal(isExpiringSoon(past, now, 30), false);
  });

  it("dentro de la ventana configurada = por caducar", () => {
    const in10days = d("2026-10-07T00:00:00Z");
    assert.equal(isExpired(in10days, now), false);
    assert.equal(isExpiringSoon(in10days, now, 30), true);
    assert.equal(isExpiringSoon(in10days, now, 5), false);
  });

  it("justo en el borde de la ventana cuenta como 'por caducar'", () => {
    const exactly30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    assert.equal(isExpiringSoon(exactly30, now, 30), true);
  });

  it("muy lejos, no cuenta", () => {
    const farAway = d("2027-06-01T00:00:00Z");
    assert.equal(isExpiringSoon(farAway, now, 30), false);
  });
});

describe("round3", () => {
  it("evita el ruido de punto flotante típico de JS", () => {
    assert.equal(round3(0.1 + 0.2), 0.3);
    assert.equal(round3(1.0005), 1.001);
    assert.equal(round3(-0.0004), 0);
  });
});
