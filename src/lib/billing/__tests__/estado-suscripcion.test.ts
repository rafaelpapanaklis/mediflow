/**
 * Estado de la suscripción con eventos de Stripe en cualquier orden (encargo 10, caso Salamanca).
 * Run: npx tsx --test src/lib/billing/__tests__/estado-suscripcion.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluarSaludClinica } from "@/lib/admin/salud-clinica";
import { estadoDeSuscripcionAEscribir } from "../estado-suscripcion";

type Clinica = { status: string | null; subscriptionId: string | null };
type Ev = { tipo: "sub"; id: string; status: string; vivo?: string } | { tipo: "checkout"; id: string } | { tipo: "factura" };

// Reproduce el webhook: cada evento aplica su regla sobre la clínica.
function aplicar(c: Clinica, ev: Ev): Clinica {
  if (ev.tipo === "checkout") return { status: "active", subscriptionId: ev.id };
  if (ev.tipo === "factura") return c.status === "incomplete" ? { ...c, status: "active" } : c;
  const nuevo = estadoDeSuscripcionAEscribir({ actual: c, evento: { id: ev.id, status: ev.status }, vivo: ev.vivo });
  return { status: nuevo ?? c.status, subscriptionId: ev.id };
}
const correr = (evs: Ev[]) => evs.reduce(aplicar, { status: null, subscriptionId: null } as Clinica).status;

const creado: Ev = { tipo: "sub", id: "sub_1", status: "incomplete" };
const actualizado: Ev = { tipo: "sub", id: "sub_1", status: "active" };
const checkout: Ev = { tipo: "checkout", id: "sub_1" };
const factura: Ev = { tipo: "factura" };

test("tarjeta mensual/anual, con o sin promo: en cualquier orden queda active", () => {
  const ordenes: Ev[][] = [
    [creado, checkout, actualizado],
    [checkout, creado, actualizado],
    [checkout, actualizado, creado], // el «created» viejo llega al final (caso Salamanca)
    [actualizado, creado, checkout],
    [creado, actualizado, checkout],
    [actualizado, checkout, creado],
    [creado, factura],
    [factura, creado, actualizado],
  ];
  for (const o of ordenes) assert.equal(correr(o), "active", JSON.stringify(o.map((e) => e.tipo === "sub" ? e.status : e.tipo)));
});

test("3D Secure: incomplete mientras no paga; al pagar pasa a active aunque el updated llegue antes que el created", () => {
  assert.equal(correr([creado]), "incomplete");
  assert.equal(correr([actualizado, creado]), "active");
});

test("el estado vivo de Stripe manda sobre un evento viejo, y un incomplete no baja a una clínica activa", () => {
  assert.equal(estadoDeSuscripcionAEscribir({ actual: { status: "incomplete", subscriptionId: "sub_1" }, evento: { id: "sub_1", status: "incomplete" }, vivo: "active" }), "active");
  assert.equal(estadoDeSuscripcionAEscribir({ actual: { status: "active", subscriptionId: "sub_1" }, evento: { id: "sub_1", status: "incomplete" } }), undefined);
  // una suscripción NUEVA e incompleta sí se escribe; lo demás (past_due, canceled) sigue igual que antes
  assert.equal(estadoDeSuscripcionAEscribir({ actual: { status: "active", subscriptionId: "sub_0" }, evento: { id: "sub_1", status: "incomplete" } }), "incomplete");
  assert.equal(estadoDeSuscripcionAEscribir({ actual: { status: "active", subscriptionId: "sub_1" }, evento: { id: "sub_1", status: "past_due" } }), "past_due");
});

test("el webhook usa la regla y activa con el primer pago de la suscripción", () => {
  const r = readFileSync(join(process.cwd(), "src/app/api/webhooks/stripe/route.ts"), "utf8");
  assert.match(r, /estadoDeSuscripcionAEscribir\(/);
  assert.match(r, /stripe\.subscriptions\.retrieve\(sub\.id\)/);
  assert.match(r, /subscriptionStatus: "incomplete" \}[\s\S]{0,80}subscriptionStatus: "active"/);
  assert.doesNotMatch(r, /stripeSubscriptionId: sub\.id,\s*subscriptionStatus:\s+sub\.status/, "ya no se escribe el estado del evento a ciegas");
});

test("/admin: Clínica anual pagada el 7-oct-2026 sale «Pagando», no «En trial»; con incomplete (el bug) salía trial", () => {
  const ahora = new Date("2026-10-07T18:00:00Z");
  const base = {
    id: "cmuybmq74006qe4s07bvkj27j", createdAt: new Date("2026-10-01T00:00:00Z"), plan: "CLINIC",
    trialEndsAt: new Date("2027-10-07T16:27:00Z"), nextBillingDate: new Date("2027-10-07T16:27:00Z"),
    pacientes: 0, citasPasadas: 0, citasVentana: 0, ultimaCitaAt: null, ultimoAccesoAt: null, pagosRegistrados: 1,
  } as any;
  assert.equal(evaluarSaludClinica({ ...base, subscriptionStatus: "incomplete" }, ahora).estadoOperativo, "trial-vigente");
  assert.equal(evaluarSaludClinica({ ...base, subscriptionStatus: correr([checkout, creado]) }, ahora).estadoOperativo, "pagando");
});
