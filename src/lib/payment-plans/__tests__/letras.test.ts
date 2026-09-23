/**
 * Las letras de un PaymentPlan: centavos y bordes.
 *
 * Run: npm run test:payment-plans
 *
 * Lo que fija: la suma de las letras es EXACTAMENTE total − enganche (sin
 * tolerancia), ninguna letra es ≤ 0, «mensual» es el mismo día de cada mes, y lo
 * que no es un plan (enganche ≥ total, 0 letras, 2.5 letras, texto) se rechaza.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularLetras } from "@/lib/payment-plans/letras";

const HOY = "2026-09-23";
const centavos = (n: number) => Math.round(n * 100);
const suma = (xs: { amount: number }[]) => xs.reduce((s, x) => s + centavos(x.amount), 0);

function plan(body: Record<string, unknown>) {
  const r = calcularLetras(body, HOY);
  assert.equal(r.error, null, `no debió fallar: ${r.error}`);
  return r.plan!;
}

test("$1,000 en 3 letras: 333.34 + 333.33 + 333.33 — el centavo va en la PRIMERA", () => {
  const p = plan({ totalAmount: 1000, installments: 3 });
  assert.deepEqual(p.letras.map((l) => l.amount), [333.34, 333.33, 333.33]);
  assert.equal(suma(p.letras), 100000);
});

test("enganche + letras suman el total exacto (25,000 − 5,000 en 24)", () => {
  const p = plan({ totalAmount: 25000, downPayment: 5000, installments: 24 });
  assert.equal(p.letras.length, 24);
  assert.equal(suma(p.letras) + centavos(p.downPayment), centavos(25000));
  // 20,000 / 24 = 833.33… → 8 letras de 833.34 y 16 de 833.33.
  assert.equal(p.letras.filter((l) => l.amount === 833.34).length, 8);
  assert.equal(p.letras.filter((l) => l.amount === 833.33).length, 16);
});

test("barrido: la suma cuadra al centavo en TODOS los repartos (1..60 letras)", () => {
  const totales = [0.6, 1, 99.99, 1000.01, 2999.97, 30000, 45843.21, 123456.78, 99_999_999.99];
  for (const total of totales) {
    for (let n = 1; n <= 60; n++) {
      const r = calcularLetras({ totalAmount: total, downPayment: 0.5, installments: n }, HOY);
      if (centavos(total) - 50 < n) {
        assert.ok(r.error, `${total} en ${n}: no alcanza, debió rechazarse`);
        continue;
      }
      const p = r.plan!;
      assert.equal(suma(p.letras), centavos(total) - 50, `${total} en ${n} letras no suma`);
      assert.ok(p.letras.every((l) => l.amount > 0), `${total} en ${n}: letra ≤ 0`);
      const max = Math.max(...p.letras.map((l) => centavos(l.amount)));
      const min = Math.min(...p.letras.map((l) => centavos(l.amount)));
      assert.ok(max - min <= 1, `${total} en ${n}: letras disparejas por más de 1¢`);
    }
  }
});

test("el bug de antes: $1 en 60 letras ya no deja una letra negativa", () => {
  // La ruta vieja: base = round(1/60) = 0.02 → 59 × 0.02 = 1.18 → última = −0.18.
  const p = plan({ totalAmount: 1, installments: 60 });
  assert.ok(p.letras.every((l) => l.amount > 0));
  assert.equal(suma(p.letras), 100);
});

test("montos con ruido de float entran como centavos", () => {
  const p = plan({ totalAmount: 0.1 + 0.2, installments: 3 }); // 0.30000000000000004
  assert.equal(p.totalAmount, 0.3);
  assert.deepEqual(p.letras.map((l) => l.amount), [0.1, 0.1, 0.1]);
});

test("mensual = el MISMO día de cada mes, no +30 días", () => {
  const p = plan({ totalAmount: 1200, installments: 12, frequency: "MONTHLY", startDate: "2026-01-15" });
  assert.deepEqual(
    p.letras.map((l) => l.fecha),
    ["2026-02-15", "2026-03-15", "2026-04-15", "2026-05-15", "2026-06-15", "2026-07-15",
     "2026-08-15", "2026-09-15", "2026-10-15", "2026-11-15", "2026-12-15", "2027-01-15"],
  );
});

test("mensual desde el 31: último día del mes cuando el 31 no existe", () => {
  const p = plan({ totalAmount: 300, installments: 3, frequency: "MONTHLY", startDate: "2026-01-31" });
  assert.deepEqual(p.letras.map((l) => l.fecha), ["2026-02-28", "2026-03-31", "2026-04-30"]);
});

test("semanal y quincenal: 7 y 14 días exactos, cruzando de mes y de año", () => {
  const s = plan({ totalAmount: 300, installments: 3, frequency: "WEEKLY", startDate: "2026-12-24" });
  assert.deepEqual(s.letras.map((l) => l.fecha), ["2026-12-31", "2027-01-07", "2027-01-14"]);
  const q = plan({ totalAmount: 200, installments: 2, frequency: "BIWEEKLY", startDate: "2026-02-20" });
  assert.deepEqual(q.letras.map((l) => l.fecha), ["2026-03-06", "2026-03-20"]);
});

test("sin fecha de inicio, arranca HOY (el de la clínica); con ISO completo se queda con el día", () => {
  assert.equal(plan({ totalAmount: 100, installments: 1 }).letras[0].fecha, "2026-10-23");
  assert.equal(plan({ totalAmount: 100, installments: 1, startDate: "2026-05-10T18:00:00.000Z" }).startDate, "2026-05-10");
});

test("frecuencia desconocida cae a mensual (y 'toString' no se cuela como frecuencia)", () => {
  assert.equal(plan({ totalAmount: 100, installments: 1, frequency: "DAILY" }).frequency, "MONTHLY");
  assert.equal(plan({ totalAmount: 100, installments: 1, frequency: "toString" }).frequency, "MONTHLY");
});

test("lo que no es un plan se rechaza con un motivo", () => {
  const casos: [Record<string, unknown>, RegExp][] = [
    [{ totalAmount: 0, installments: 3 }, /total/],
    [{ totalAmount: -500, installments: 3 }, /total/],
    [{ totalAmount: 1e15, installments: 12 }, /máximo/],
    [{ totalAmount: Infinity, installments: 12 }, /total/],
    [{ totalAmount: "abc", installments: 3 }, /total/],
    [{ totalAmount: 1000, downPayment: 1000, installments: 3 }, /enganche/i],
    [{ totalAmount: 1000, downPayment: 1500, installments: 3 }, /enganche/i],
    [{ totalAmount: 1000, downPayment: -1, installments: 3 }, /enganche/i],
    [{ totalAmount: 1000, installments: 0 }, /letras/],
    [{ totalAmount: 1000, installments: 2.5 }, /letras/],
    [{ totalAmount: 1000, installments: 61 }, /letras/],
    [{ totalAmount: 0.03, installments: 6 }, /No alcanza/],
    [{ totalAmount: 1000, installments: 3, startDate: "2026-02-31" }, /Fecha/],
    [{ totalAmount: 1000, installments: 3, startDate: "mañana" }, /Fecha/],
  ];
  for (const [body, motivo] of casos) {
    const r = calcularLetras(body, HOY);
    assert.equal(r.plan, null, `debió rechazarse: ${JSON.stringify(body)}`);
    assert.match(r.error ?? "", motivo, JSON.stringify(body));
  }
});

test("cantidades que llegan como texto desde un formulario se aceptan si son números", () => {
  const p = plan({ totalAmount: "1500.50", downPayment: "500.50", installments: "4" });
  assert.equal(p.installments, 4);
  assert.deepEqual(p.letras.map((l) => l.amount), [250, 250, 250, 250]);
});
