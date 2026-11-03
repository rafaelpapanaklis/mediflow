/**
 * Seguridad ola 2b · lead 4 — anular un anticipo NO puede depender de lo que
 * escribió en las notas quien lo registró.
 *
 * «Registrar anticipo recibido» (billing.deposit.register: doctor y recepción)
 * guarda `notes` tal cual y SIEMPRE suma el monto a `invoice.paid`. Al anularlo,
 * `pagoSumoALaFactura` decidía con una regex sobre esas notas si había que
 * restarlo: con la frase «Anticipo pagado sobre factura ya saldada» sembrada,
 * el pago quedaba en 0 (la Caja deja de esperar ese efectivo) y la factura
 * seguía como pagada.
 *
 * Arreglo: la marca solo cuenta en pagos de Mercado Pago (los escribe entero el
 * webhook); un anticipo registrado a mano (efectivo, transferencia, tarjeta)
 * siempre sumó, así que siempre se resta.
 *
 * Run: npm run test:seg-ola2b
 */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import { DobleBase } from "./doble-base";

const RAIZ = process.cwd();
let db: DobleBase;
const prismaProxy = new Proxy({}, { get: (_t, k) => (db.cliente() as any)[k] });

const dobles = new Map<string, unknown>([[path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prismaProxy }]]);
const M = Module as unknown as {
  _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (req: string, parent: unknown, isMain: boolean) => string;
};
const cargaOriginal = M._load;
M._load = function (req, parent, isMain) {
  if (req === "server-only" || req === "client-only") return {};
  let resuelto: string | null = null;
  try { resuelto = M._resolveFilename(req, parent, isMain); } catch { resuelto = null; }
  if (resuelto && dobles.has(resuelto)) return dobles.get(resuelto);
  return cargaOriginal.call(this, req, parent, isMain);
};

let registrar: (args: any, over?: any) => Promise<any>;
let anular: (args: any) => Promise<any>;
const T0 = new Date("2026-10-30T16:00:00Z");

before(async () => {
  ({ registrarAnticipoRecibido: registrar } = await import("@/lib/anticipos/panel.server"));
  ({ anularAnticipoRecibido: anular } = await import("@/lib/anticipos/anular.server"));
});

beforeEach(() => {
  db = new DobleBase();
  db.tablas.clinic.push({ id: "c1", name: "Clínica", timezone: "America/Mexico_City" });
  db.tablas.invoice.push({
    id: "inv1", clinicId: "c1", patientId: "p1", invoiceNumber: "MF-1",
    status: "PENDING", total: 1000, paid: 0, balance: 1000, cfdiUuid: null, appointmentId: null,
  });
});
const inv = () => db.tablas.invoice.find((f) => f.id === "inv1")!;

async function registrarYAnular(notes: string | undefined) {
  const r = await registrar(
    { clinicId: "c1", invoiceId: "inv1", userId: "u_rec", monto: 500, method: "cash", notes },
    { db: db.cliente(), ahora: () => T0 },
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(inv().paid, 500);
  assert.equal(inv().status, "PARTIAL");
  const dep = db.tablas.appointmentDeposit[0];
  const a = await anular({ clinicId: "c1", invoiceId: "inv1", depositId: dep.id, userId: "u_admin", quien: "Admin", motivo: "registro equivocado" });
  assert.equal(a.ok, true, JSON.stringify(a));
  return { pago: db.tablas.payment.find((p) => p.id === dep.paymentId)!, dep };
}

test("control: sin notas, anular devuelve la factura a como estaba", async () => {
  const { pago } = await registrarYAnular(undefined);
  assert.equal(pago.amount, 0);
  assert.equal(inv().paid, 0);
  assert.equal(inv().status, "PENDING");
});

test("🔴 la frase del webhook sembrada en las notas NO deja la factura pagada con el pago en 0", async () => {
  const { pago, dep } = await registrarYAnular("Anticipo pagado sobre factura ya saldada");
  assert.equal(pago.amount, 0);
  assert.equal(dep.status, "FAILED");
  assert.equal(inv().paid, 0, "lo que se quita del pago se quita de la factura");
  assert.equal(inv().balance, 1000);
  assert.equal(inv().status, "PENDING");
});

test("🔴 tampoco con «factura cancelada»", async () => {
  await registrarYAnular("x ⚠️ Anticipo pagado sobre factura cancelada: revisar/devolver");
  assert.equal(inv().paid, 0);
  assert.equal(inv().status, "PENDING");
});

test("el pago de Mercado Pago que el webhook NO sumó (factura ya saldada) sigue sin restar", async () => {
  // Factura saldada con 1000 en efectivo; luego llegó un anticipo de MP por 300
  // que el webhook registró SIN sumarlo (anomalía).
  Object.assign(inv(), { status: "PAID", paid: 1000, balance: 0 });
  db.tablas.payment.push({ id: "pmp", invoiceId: "inv1", amount: 300, method: "mercadopago",
    notes: "Anticipo, pagado con Mercado Pago desde el panel (pago 77). ⚠️ Anticipo pagado sobre factura ya saldada: revisar/devolver" });
  db.tablas.appointmentDeposit.push({ id: "dmp", clinicId: "c1", invoiceId: "inv1", status: "PAID", paymentId: "pmp", method: "mercadopago" });
  const a = await anular({ clinicId: "c1", invoiceId: "inv1", depositId: "dmp", userId: "u_admin", quien: "Admin", motivo: "se devolvió en MP" });
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(inv().paid, 1000, "nunca sumó, no se resta");
  assert.equal(inv().status, "PAID");
});

test("pagoSumoALaFactura: la marca solo vale en pagos de Mercado Pago", async () => {
  const { pagoSumoALaFactura } = await import("@/lib/anticipos/anular-core");
  const marca = "⚠️ Anticipo pagado sobre factura ya saldada: revisar/devolver";
  assert.equal(pagoSumoALaFactura(marca, "mercadopago"), false);
  for (const m of ["cash", "transfer", "debit", "credit"]) assert.equal(pagoSumoALaFactura(marca, m), true, m);
  assert.equal(pagoSumoALaFactura(null, "mercadopago"), true);
});
