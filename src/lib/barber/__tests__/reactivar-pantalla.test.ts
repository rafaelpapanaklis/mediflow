// La pantalla de Suscripción de una barbería SUSPENDIDA (decisión #10): dice
// por qué está cerrada, ofrece pagar SU plan y deja los menores deshabilitados.
//   npx tsx --test src/lib/barber/__tests__/reactivar-pantalla.test.ts
// Render estático (react-dom/server) con useRouter simulado; sin base.
import "@/components/admin/portada/__tests__/_react-global";
import Module from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// useRouter de Next sin app router montado: un doble que no hace nada.
const M = Module as unknown as { _load: (r: string, p: unknown, m: boolean) => unknown };
const original = M._load;
M._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "next/navigation") return { useRouter: () => ({ replace() {}, refresh() {}, push() {} }) };
  return original.call(this, request, parent, isMain);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { BillingScreen } = require("@/components/barber/billing/billing-screen") as typeof import("@/components/barber/billing/billing-screen");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getBarberDict } = require("@/i18n/dictionaries/barber") as typeof import("@/i18n/dictionaries/barber");

const plan = (id: "BASICO" | "AVANZADO" | "PROFESIONAL", name: string, cents: number) => ({
  id,
  name,
  priceMonthlyCents: cents,
  priceYearlyCents: null,
  firstMonthCents: null,
  maxBarbers: 5,
  maxBranches: 1,
  messageQuota: 100,
  features: [],
  isActive: true,
});
const PLANES = [plan("BASICO", "Básico", 19900), plan("AVANZADO", "Avanzado", 32900), plan("PROFESIONAL", "Profesional", 74900)];

function pinta(locale: "es" | "en", reactivacion: any, status = "canceled") {
  return renderToStaticMarkup(
    createElement(BillingScreen, {
      locale,
      dict: getBarberDict(locale),
      canManage: true,
      plans: PLANES,
      gate: {
        planId: "AVANZADO",
        planName: "Avanzado",
        subscriptionStatus: status,
        subscriptionActive: false,
        limits: { barbers: { max: 5, used: 1, overLimit: false }, branches: { max: 1, used: 1, overLimit: false } },
      },
      summary: { configured: true, stripeError: null, subscription: null, invoices: [], failedAttempts: [] },
      checkout: { result: null, sessionId: null },
      support: { path: "/barber/soporte", whatsappUrl: "https://wa.me/0", whatsappNumber: "+52 000" },
      reactivacion,
    } as any),
  );
}

/** [nombre del plan, ¿botón deshabilitado?] en el orden de las tarjetas. */
function tarjetas(html: string): Array<[string, boolean]> {
  return [...html.matchAll(/dcbb-plan__name">([^<]+)<[\s\S]*?<button([^>]*)>/g)].map((m) => [m[1], /disabled/.test(m[2])]);
}

const SUSPENDIDA = { planId: "AVANZADO", planName: "Avanzado", paidThroughDay: "2026-12-14" };

test("suspendida: aviso con la fecha y el plan, botón para pagar SU plan y Básico deshabilitado", () => {
  const html = pinta("es", SUSPENDIDA);
  assert.match(html, /Tu barbería está suspendida/);
  assert.match(html, /Tu periodo pagado terminó el 14 de diciembre de 2026/);
  assert.match(html, /paga tu plan Avanzado o uno mayor/);
  assert.match(html, /Pagar mi plan Avanzado/);
  assert.deepEqual(tarjetas(html), [
    ["Básico", true],
    ["Avanzado", false],
    ["Profesional", false],
  ]);
  assert.match(html, /Para reactivar tu barbería elige Avanzado o uno mayor\./);
  // Reemplaza al aviso genérico de «cancelada».
  assert.doesNotMatch(html, /Tu suscripción está cancelada/);
});

test("en inglés también", () => {
  const html = pinta("en", SUSPENDIDA);
  assert.match(html, /Your barbershop is suspended/);
  assert.match(html, /Pay for my Avanzado plan/);
  assert.match(html, /To reactivate your barbershop, choose Avanzado or a higher plan\./);
});

test("sin fecha registrada: el aviso no inventa una", () => {
  const html = pinta("es", { ...SUSPENDIDA, paidThroughDay: null });
  assert.match(html, /Tu periodo pagado terminó\. Para volver a abrirla paga tu plan Avanzado/);
});

test("sin reactivación pendiente (alta nueva o al corriente) la pantalla queda como hoy", () => {
  const html = pinta("es", null);
  assert.doesNotMatch(html, /suspendida/);
  assert.deepEqual(
    tarjetas(html).map(([, off]) => off),
    [false, false, false],
  );
  assert.match(html, /Tu suscripción está cancelada/);
});
