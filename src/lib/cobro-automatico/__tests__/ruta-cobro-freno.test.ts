/**
 * F1 (cobro doble), el caso inverso, en la RUTA REAL del cobro manual:
 * `POST /api/invoices/[id]`. Si Mercado Pago ya cobró con tarjeta la mensualidad
 * de este ciclo, el cobro a mano responde 409 y NO toca la factura; con
 * `confirmarCobroAutomatico: true` (la casilla «Sí, es un adelanto») cobra.
 *
 * Se sustituyen (mock.module) Prisma, la sesión, la bitácora, la caché y el
 * servicio del cobro automático (aquí solo importa QUÉ le pregunta la ruta y qué
 * hace con la respuesta). Ni red ni base.
 *
 * Run: npm run test:cobro-automatico
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const db = { invoice: null as any, payments: [] as any[] };
const preguntas: Array<{ clinicId: string; invoiceId: string; monto: number; confirmado: boolean }> = [];
let bloquear = false;

const invoiceDelegate = {
  findFirst: async ({ where }: any = {}) => (where?.id === db.invoice.id && where?.clinicId === db.invoice.clinicId ? { ...db.invoice } : null),
  updateMany: async ({ data }: any) => {
    Object.assign(db.invoice, Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)));
    return { count: 1 };
  },
};
const paymentDelegate = {
  create: async ({ data }: any) => {
    const row = { id: `pay${db.payments.length + 1}`, ...data };
    db.payments.push(row);
    return row;
  },
};
const prismaStub: any = {
  $transaction: async (fn: any) => fn({ $queryRaw: async () => [], invoice: invoiceDelegate, payment: paymentDelegate }),
  $queryRaw: async () => [],
  invoice: invoiceDelegate,
  payment: paymentDelegate,
  cashRegister: { findFirst: async () => null },
};

(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
(mock as any).module("@/lib/auth-context", {
  namedExports: { getAuthContext: async () => ({ clinicId: "c1", userId: "u1", role: "ADMIN", permissionsOverride: null }) },
});
(mock as any).module("next/cache", { namedExports: { revalidatePath: () => {}, revalidateTag: () => {} } });
(mock as any).module("@/lib/audit", { namedExports: { logMutation: async () => {}, logAudit: async () => {} } });
(mock as any).module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => {} } });
(mock as any).module("@/lib/patient-visibility", { namedExports: { assertPatientVisible: async () => null, relatedPatientVisibilityAnd: () => [] } });
(mock as any).module("@/lib/factura-mp/servicio.server", { namedExports: { cerrarLinksDeFactura: async () => 0 } });
(mock as any).module("@/lib/anticipos/panel.server", { namedExports: { cerrarAnticiposDePanel: async () => 0 } });
(mock as any).module("@/lib/cobro-automatico/servicio.server", {
  namedExports: {
    CODIGO_YA_COBRADO: "COBRO_AUTOMATICO_YA_COBRADO",
    frenoCobroDoble: async (a: any) => {
      preguntas.push(a);
      return bloquear && !a.confirmado
        ? { bloquear: true, texto: "La mensualidad del 5 de octubre ya se cobró con tarjeta (Mercado Pago, $2,000.00) y el plan va al corriente." }
        : { bloquear: false, texto: null };
    },
  },
});

function req(body: any): any {
  return { json: async () => body, headers: new Headers(), url: "http://localhost/api/invoices/inv1" };
}
const P = { params: { id: "inv1" } };

beforeEach(() => {
  db.invoice = { id: "inv1", clinicId: "c1", patientId: "p1", invoiceNumber: "F-0101", status: "PARTIAL", total: 24000, paid: 2000, balance: 22000 };
  db.payments = [];
  preguntas.length = 0;
  bloquear = false;
});

test("MP ya cobró este ciclo: el cobro a mano de $2,000 responde 409 y la factura NO cambia", async () => {
  const { POST } = await import("@/app/api/invoices/[id]/route");
  bloquear = true;
  const res = await POST(req({ amount: 2000, method: "cash" }), P);
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.code, "COBRO_AUTOMATICO_YA_COBRADO");
  assert.match(body.error, /ya se cobró con tarjeta/);
  assert.equal(db.payments.length, 0);
  assert.equal(db.invoice.paid, 2000);
  assert.deepEqual(preguntas, [{ clinicId: "c1", invoiceId: "inv1", monto: 2000, confirmado: false }], "el clinicId sale de la sesión; el monto, redondeado");
});

test("con la casilla «Sí, es un adelanto» (confirmarCobroAutomatico) se cobra: $2,000 → paid $4,000", async () => {
  const { POST } = await import("@/app/api/invoices/[id]/route");
  bloquear = true;
  const res = await POST(req({ amount: 2000, method: "cash", confirmarCobroAutomatico: true }), P);
  assert.equal(res.status, 200);
  assert.equal(db.payments.length, 1);
  assert.equal(db.invoice.paid, 4000);
  assert.equal(preguntas[0].confirmado, true);
});

test("solo `true` confirma (un «sí» de texto no salta el freno) y sin cobro automático todo sigue igual", async () => {
  const { POST } = await import("@/app/api/invoices/[id]/route");
  bloquear = true;
  assert.equal((await POST(req({ amount: 2000, method: "cash", confirmarCobroAutomatico: "true" }), P)).status, 409);
  bloquear = false;
  assert.equal((await POST(req({ amount: 1500.004, method: "cash" }), P)).status, 200);
  assert.equal(db.invoice.paid, 3500);
});
