// La tarjeta «Ingreso mensual por línea» de la portada de /admin: Dental,
// Barberías y Total, cada línea con sus cifras. Con los números de
// producción del 15-nov-2026 (dental $6,532 planes + $129 módulos; barber 1
// Profesional por Stripe + 3 cortesías + 1 sin pagar).
//   npx tsx --test src/lib/barber/__tests__/tarjeta-ingresos-lineas.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import "@/components/admin/portada/__tests__/_react-global";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Prisma } from "@prisma/client";
import { TarjetaIngresosPorLinea } from "@/components/admin/barberias/tarjeta-ingresos-lineas";
import { resumirIngresosBarber } from "@/lib/barber/admin-ingresos";

const TABLA = {
  BASICO: new Prisma.Decimal("199.00"),
  AVANZADO: new Prisma.Decimal("329.00"),
  PROFESIONAL: new Prisma.Decimal("749.00"),
};
const BARBER = resumirIngresosBarber(
  [
    { plan: "PROFESIONAL", subscriptionStatus: "active", stripeSubscriptionId: "sub_paga" },
    { plan: "PROFESIONAL", subscriptionStatus: "active", stripeSubscriptionId: null },
    { plan: "PROFESIONAL", subscriptionStatus: "active", stripeSubscriptionId: null },
    { plan: "PROFESIONAL", subscriptionStatus: "active", stripeSubscriptionId: null },
    { plan: "BASICO", subscriptionStatus: "pending_payment", stripeSubscriptionId: null },
  ],
  TABLA,
);

const pinta = (barberias: typeof BARBER | null, cobrado: number | null = 499) =>
  renderToStaticMarkup(
    createElement(TarjetaIngresosPorLinea, { dentalMrr: 6532 + 129, dentalCobradoMes: cobrado, barberias }),
  );

/** [label, número] de cada cifra, en orden. */
const cifras = (html: string) =>
  [...html.matchAll(/dcp-cifra__label">([^<]*)<\/div><div class="dcp-cifra__n[^"]*">([^<]*)</g)].map((m) => [m[1], m[2]]);

test("Dental, Barberías y Total por separado: $6,661 + $749 = $7,410", () => {
  const c = cifras(pinta(BARBER));
  assert.equal(c.length, 3);
  assert.equal(c[0][0], "Dental");
  assert.match(c[0][1], /6,661/);
  assert.equal(c[1][0], "Barberías");
  assert.match(c[1][1], /749/);
  assert.ok(!/2,996/.test(c[1][1]), "las 3 cortesías no pueden sumar");
  assert.equal(c[2][0], "Total");
  assert.match(c[2][1], /7,410/);
});

test("el pie de Barberías dice quién paga y que las cortesías no suman", () => {
  const html = pinta(BARBER);
  assert.match(html, /1 paga por Stripe/);
  assert.match(html, /3 cortesías y 1 sin pagar no suman/);
  assert.match(html, /cobrado este mes: sin registro/);
});

test("si barber no se pudo medir: «—», nunca $0, y el dental sigue igual", () => {
  const c = cifras(pinta(null));
  assert.match(c[0][1], /6,661/);
  assert.equal(c[1][1], "—");
  assert.equal(c[2][1], "—");
});
