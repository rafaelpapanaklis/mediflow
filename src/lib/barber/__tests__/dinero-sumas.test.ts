/**
 * Sumas de dinero SIN punto flotante — el arreglo de totalServicePrice() y
 * el helper que ahora usan todas las sumas de precios del vertical
 * (src/lib/barber/money.ts).
 *
 *   npx tsx --test src/lib/barber/__tests__/dinero-sumas.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sumMoney, sumMoneyBy, toCents } from "../money";
import { totalServicePrice } from "../agenda";

/** Suma exacta de referencia: enteros de centavos, sin pasar por float. */
function referencia(precios: number[]): number {
  let cents = 0;
  for (const p of precios) cents += Math.round(p * 100);
  return cents / 100;
}

test("tres servicios con precios incómodos suman exacto (el bug original)", () => {
  // Estas ternas dan 6.970000000000001 y 163.97000000000003 con `+`.
  for (const [precios, esperado] of [
    [[1.99, 1.99, 2.99], 6.97],
    [[1.99, 32.99, 128.99], 163.97],
    [[179.99, 180, 180], 539.99],
    [[149.99, 199.99, 189.99], 539.97],
  ] as Array<[number[], number]>) {
    assert.equal(sumMoney(precios), esperado);
    assert.equal(String(sumMoney(precios)), String(esperado), "lo que se pinta es el número limpio");
    assert.equal(
      totalServicePrice(precios.map((price, i) => ({ id: String(i), durationMin: 30, price }))),
      esperado,
    );
  }
  // Prueba de que el motor sí se equivoca con `+` (si esto deja de fallar,
  // cambió el motor, no el problema).
  assert.notEqual(1.99 + 1.99 + 2.99, 6.97);
});

test("miles de combinaciones al azar: siempre igual a la suma en centavos", () => {
  let semilla = 20260825;
  const azar = () => {
    semilla = (semilla * 1664525 + 1013904223) % 4294967296;
    return semilla / 4294967296;
  };
  for (let caso = 0; caso < 5000; caso++) {
    const n = 1 + Math.floor(azar() * 6);
    const precios: number[] = [];
    for (let i = 0; i < n; i++) precios.push(Math.round(azar() * 99999) / 100);
    const esperado = referencia(precios);
    const suma = sumMoney(precios);
    assert.equal(suma, esperado, `precios ${precios.join(" + ")}`);
    assert.equal(sumMoneyBy(precios.map((price) => ({ price })), (s) => s.price), esperado);
  }
});

test("acepta lo que llega de Prisma y del navegador: number, string y Decimal", () => {
  const decimalFalso = { toString: () => "179.99" }; // como Prisma.Decimal
  assert.equal(toCents(179.99), 17999);
  assert.equal(toCents("179.99"), 17999);
  assert.equal(toCents(decimalFalso), 17999);
  assert.equal(sumMoney([179.99, "180.00", { toString: () => "180" }]), 539.99);
});

test("basura suma cero, igual que el `Number(x) || 0` que sustituye", () => {
  assert.equal(sumMoney([]), 0);
  assert.equal(sumMoney([null, undefined, NaN, "abc", Infinity]), 0);
  assert.equal(sumMoney([10, null, NaN, 5.5]), 15.5);
  assert.equal(totalServicePrice([]), 0);
  assert.equal(totalServicePrice([{ id: "a", durationMin: 30, price: Number.NaN }]), 0);
});

test("los negativos (líneas de crédito de membresía) restan exacto", () => {
  assert.equal(sumMoney([350, -0.01, -349.99]), 0);
  assert.equal(sumMoney([10.1, -10.1]), 0);
});
