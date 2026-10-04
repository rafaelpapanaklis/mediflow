/**
 * ANULAR una factura con deuda pide lo mismo que cancelarla (ws1-t2, auditoría
 * de dinero F6): «un doctor o la recepción pueden ANULAR una factura con deuda
 * sin tener el permiso de cancelar». DELETE /api/invoices/[id] marcaba como
 * CANCELLED una factura emitida sin pagos pidiendo solo billing.edit, que el
 * doctor y la recepción tienen de fábrica; una deuda de $5,000 desaparecía de
 * «Por cobrar».
 *
 * Run: npm run test:anular-factura
 *
 * Ruta REAL con Prisma, sesión, bitácora y caché sustituidos. Con el código
 * viejo, la primera prueba da 200 y la factura queda CANCELLED.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const db = { invoice: null as any, borrada: false };
const bitacora: any[] = [];
let rol = "DOCTOR";

const invoiceDelegate = {
  findFirst: async ({ where }: any = {}) =>
    !db.borrada && where?.id === db.invoice.id && where?.clinicId === db.invoice.clinicId ? { ...db.invoice } : null,
  updateMany: async ({ where, data }: any) => {
    if (where.id !== db.invoice.id || where.clinicId !== db.invoice.clinicId) return { count: 0 };
    Object.assign(db.invoice, data);
    return { count: 1 };
  },
  deleteMany: async ({ where }: any) => {
    if (where.id !== db.invoice.id || where.status !== db.invoice.status) return { count: 0 };
    db.borrada = true;
    return { count: 1 };
  },
};
const prismaStub: any = { invoice: invoiceDelegate, $queryRaw: async () => [], $transaction: async (fn: any) => fn(prismaStub) };

(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
(mock as any).module("@/lib/auth-context", {
  namedExports: { getAuthContext: async () => ({ clinicId: "c1", userId: "u1", role: rol, permissionsOverride: null }) },
});
(mock as any).module("next/cache", { namedExports: { revalidatePath: () => {}, revalidateTag: () => {} } });
(mock as any).module("@/lib/audit", { namedExports: { logMutation: async (o: any) => { bitacora.push(o); }, logAudit: async () => {} } });
(mock as any).module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => {} } });
(mock as any).module("@/lib/patient-visibility", { namedExports: { assertPatientVisible: async () => null, relatedPatientVisibilityAnd: () => [] } });
(mock as any).module("@/lib/factura-mp/servicio.server", { namedExports: { cerrarLinksDeFactura: async () => 0 } });
(mock as any).module("@/lib/anticipos/panel.server", { namedExports: { cerrarAnticiposDePanel: async () => 0 } });
(mock as any).module("@/lib/cobro-automatico/servicio.server", {
  namedExports: { CODIGO_YA_COBRADO: "X", frenoCobroDoble: async () => ({ bloquear: false, texto: null }) },
});

const req: any = { json: async () => ({}), headers: new Headers(), url: "http://localhost/api/invoices/inv1" };
const P = { params: { id: "inv1" } };

beforeEach(() => {
  db.invoice = { id: "inv1", clinicId: "c1", patientId: "p1", invoiceNumber: "F-0500", status: "PENDING", total: 5_000, paid: 0, balance: 5_000, cfdiUuid: null };
  db.borrada = false;
  bitacora.length = 0;
  rol = "DOCTOR";
});

test("un DOCTOR no anula una factura PENDIENTE de $5,000: 403 y la deuda sigue", async () => {
  const { DELETE } = await import("@/app/api/invoices/[id]/route");
  const res = await DELETE(req, P);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).permiso, "billing.refund");
  assert.equal(db.invoice.status, "PENDING");
  assert.equal(db.invoice.balance, 5_000);
  assert.equal(bitacora.length, 0);
});

test("la RECEPCIÓN tampoco (billing.edit de fábrica, sin billing.refund)", async () => {
  rol = "RECEPTIONIST";
  const { DELETE } = await import("@/app/api/invoices/[id]/route");
  assert.equal((await DELETE(req, P)).status, 403);
  assert.equal(db.invoice.status, "PENDING");
});

test("quien tiene billing.refund (dueño/administrador) la anula, y la bitácora guarda el saldo que dejó de cobrarse", async () => {
  rol = "ADMIN";
  const { DELETE } = await import("@/app/api/invoices/[id]/route");
  const res = await DELETE(req, P);
  assert.equal(res.status, 200);
  assert.equal(db.invoice.status, "CANCELLED");
  assert.equal(bitacora.length, 1);
  assert.deepEqual(bitacora[0].before, { status: "PENDING", invoiceNumber: "F-0500", total: 5_000, balance: 5_000 });
  assert.match(bitacora[0].texto, /Anuló la factura F-0500 \(dejó de cobrarse un saldo de \$5,000\.00\)/);
});

test("un BORRADOR lo sigue borrando quien tiene billing.edit (el doctor)", async () => {
  db.invoice.status = "DRAFT";
  const { DELETE } = await import("@/app/api/invoices/[id]/route");
  const res = await DELETE(req, P);
  assert.equal(res.status, 200);
  assert.equal(db.borrada, true);
});

test("permisoParaAnular: borrador → billing.edit; cualquier factura emitida → billing.refund", async () => {
  const { permisoParaAnular } = await import("@/lib/invoices/anular-factura");
  assert.equal(permisoParaAnular("DRAFT"), "billing.edit");
  for (const s of ["PENDING", "PARTIAL", "OVERDUE", "PAID", "CANCELLED", null]) assert.equal(permisoParaAnular(s as any), "billing.refund", String(s));
});
