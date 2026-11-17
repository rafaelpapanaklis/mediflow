// QA de cierre C (16-nov): con $500 en el cajón se podían «sacar» $1,000 sin
// ningún aviso y «Debe haber en caja» quedaba en −$500. La ventana ahora
// avisa cuánto se pasa; esta es la cuenta de ese aviso.
import test from "node:test";
import assert from "node:assert/strict";
import { overDrawerCents } from "../caja-movimientos-core";
import es from "../../../i18n/dictionaries/barber/caja.es.json";
import en from "../../../i18n/dictionaries/barber/caja.en.json";

test("sacar $1,000 con $500 en el cajón: se pasa $500", () => {
  assert.equal(overDrawerCents({ type: "WITHDRAWAL", method: "CASH", amountCents: 100_000, drawerCash: 500 }), 50_000);
});

test("sacar justo lo que hay, o menos, no avisa", () => {
  assert.equal(overDrawerCents({ type: "WITHDRAWAL", method: "CASH", amountCents: 50_000, drawerCash: 500 }), 0);
  assert.equal(overDrawerCents({ type: "WITHDRAWAL", method: "CASH", amountCents: 49_999, drawerCash: 500 }), 0);
});

test("un centavo de más ya avisa (sin errores de punto flotante)", () => {
  assert.equal(overDrawerCents({ type: "WITHDRAWAL", method: "CASH", amountCents: 77_451, drawerCash: 774.5 }), 1);
  assert.equal(overDrawerCents({ type: "EXPENSE", method: "CASH", amountCents: 31, drawerCash: 0.1 + 0.2 }), 1);
});

test("gasto y pago a barbero en efectivo también son salidas del cajón", () => {
  assert.equal(overDrawerCents({ type: "EXPENSE", method: "CASH", amountCents: 60_000, drawerCash: 500 }), 10_000);
  assert.equal(overDrawerCents({ type: "BARBER_PAYOUT", method: "CASH", amountCents: 60_000, drawerCash: 500 }), 10_000);
});

test("lo que no sale del cajón no avisa: tarjeta, transferencia, otro y meter efectivo", () => {
  for (const method of ["CARD", "TRANSFER", "OTHER"] as const) {
    assert.equal(overDrawerCents({ type: "EXPENSE", method, amountCents: 999_999, drawerCash: 0 }), 0);
    assert.equal(overDrawerCents({ type: "BARBER_PAYOUT", method, amountCents: 999_999, drawerCash: 0 }), 0);
  }
  assert.equal(overDrawerCents({ type: "DEPOSIT", method: "CASH", amountCents: 999_999, drawerCash: 0 }), 0);
});

test("sin caja abierta no hay cajón que comparar (gasto fuera de caja)", () => {
  assert.equal(overDrawerCents({ type: "EXPENSE", method: "CASH", amountCents: 10_000, drawerCash: null }), 0);
  assert.equal(overDrawerCents({ type: "EXPENSE", method: "CASH", amountCents: 10_000, drawerCash: undefined }), 0);
  assert.equal(overDrawerCents({ type: "EXPENSE", method: "CASH", amountCents: 10_000, drawerCash: Number.NaN }), 0);
});

test("cajón ya en negativo: se pasa por el monto más lo que ya falta", () => {
  assert.equal(overDrawerCents({ type: "WITHDRAWAL", method: "CASH", amountCents: 10_000, drawerCash: -50 }), 15_000);
});

test("el aviso existe en español y en inglés, con el cajón y el exceso", () => {
  for (const dict of [es, en]) {
    const txt = (dict as { mov: { overDrawer: string } }).mov.overDrawer;
    assert.ok(txt.includes("{drawer}") && txt.includes("{over}"), txt);
  }
});
