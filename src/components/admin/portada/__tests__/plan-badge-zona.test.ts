/**
 * La insignia de estado de plan es un client component que se pinta dos veces:
 * en el servidor (SSR) y en el navegador (hidratación). Si el texto depende de la
 * zona horaria del runtime, el servidor (UTC en Vercel) y el navegador de México
 * dicen fechas distintas («renueva 24 oct» / «renueva 23 oct»), React lanza
 * hydration error #418/#423 y descarta el HTML del servidor.
 *
 * Aquí se pinta la misma insignia bajo varias zonas de runtime, con periodos que
 * cruzan medianoche en unas y no en otras, y se exige EL MISMO texto en todas.
 *
 * Run: node --import tsx --test src/components/admin/portada/__tests__/plan-badge-zona.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import "./_react-global";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanStatusBadge } from "@/components/admin/plan-status-badge";
import { getPlanStatus } from "@/lib/plan-status";
import { planStatusLabel } from "@/lib/plan-status-label";

const ZONAS = ["UTC", "America/Mexico_City", "America/Merida", "America/New_York", "Asia/Tokyo", "Pacific/Auckland"];
const AHORA = new Date("2026-09-29T23:43:00.000Z");

// Instantes que en UTC y en México caen en días distintos (00:00–05:59 UTC).
const CLINICAS = {
  activa: { subscriptionStatus: "active", trialEndsAt: "2026-10-24T01:30:00.000Z", nextBillingDate: "2026-10-24T01:30:00.000Z" },
  activaTarde: { subscriptionStatus: "active", trialEndsAt: "2026-11-19T22:00:00.000Z", nextBillingDate: "2026-11-19T22:00:00.000Z" },
  cobroFallido: { subscriptionStatus: "past_due", trialEndsAt: "2026-10-02T03:10:00.000Z", nextBillingDate: null },
  trial: { subscriptionStatus: "trialing", trialEndsAt: "2026-10-05T04:59:00.000Z", nextBillingDate: null },
  vencida: { subscriptionStatus: "canceled", trialEndsAt: "2026-09-10T02:00:00.000Z", nextBillingDate: null },
} as const;

function bajoZona<T>(zona: string, fn: () => T): T {
  const antes = process.env.TZ;
  process.env.TZ = zona;
  try {
    return fn();
  } finally {
    if (antes === undefined) delete process.env.TZ;
    else process.env.TZ = antes;
  }
}

test("el runtime cambia de zona de verdad (si no, el test no prueba nada)", () => {
  const d = new Date("2026-10-24T01:30:00.000Z");
  const dias = new Set(ZONAS.map((z) => bajoZona(z, () => d.toLocaleDateString("es-MX", { day: "numeric" }))));
  assert.ok(dias.size > 1, `todas las zonas dieron el mismo día: ${[...dias]}`);
});

for (const [nombre, clinica] of Object.entries(CLINICAS)) {
  test(`insignia «${nombre}»: mismo HTML en cualquier zona del runtime`, () => {
    const html = ZONAS.map((z) => bajoZona(z, () => renderToStaticMarkup(createElement(PlanStatusBadge, { clinic: clinica, now: AHORA }))));
    assert.deepEqual([...new Set(html)], [html[0]], `el HTML cambia según la zona:\n${ZONAS.map((z, i) => `${z}: ${html[i]}`).join("\n")}`);
  });

  test(`etiqueta «${nombre}»: label y detail iguales en cualquier zona`, () => {
    const l = ZONAS.map((z) => bajoZona(z, () => planStatusLabel(getPlanStatus(clinica, AHORA), AHORA)));
    assert.deepEqual([...new Set(l.map((x) => JSON.stringify(x)))].length, 1, JSON.stringify(ZONAS.map((z, i) => [z, l[i]])));
  });
}

test("las fechas salen en la zona del panel (Mérida), no en UTC", () => {
  // 01:30 UTC del 24 oct = 19:30 del 23 oct en Mérida.
  const l = planStatusLabel(getPlanStatus(CLINICAS.activa, AHORA), AHORA);
  assert.match(l.label, /renueva 23 oct$/);
  assert.match(l.detail, /23 de octubre de 2026/);
});
