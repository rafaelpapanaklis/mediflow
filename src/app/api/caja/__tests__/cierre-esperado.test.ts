/**
 * Auditoría de uso C-06 (ws1-t5, 4-oct-2026): el cierre de caja no guarda un
 * faltante falso si alguien cobró mientras el diálogo estaba abierto.
 *
 * Run: npm run test:caja-cierre-esperado
 *
 * El caso de la auditoría: el diálogo enseñaba «Efectivo esperado $4,740»;
 * mientras se contaba, otra persona cobró $4,000 en efectivo; se confirmó con
 * $4,740 y el servidor guardó «Esperado $8,740 · Contado $4,740 · Diferencia
 * −$4,000». Con el código viejo esta prueba cierra la caja con −$4,000; ahora
 * el servidor contesta 409 con el esperado nuevo y la caja sigue abierta.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const apertura = new Date("2026-10-04T04:50:00.000Z");
const reg = { id: "reg1", clinicId: "c1", status: "OPEN", openedAt: apertura, openingBalance: 1_000, withdrawals: [], operator: null };
const db = {
  pagos: [] as any[],
  cierres: [] as any[],
};
const factura = { items: [], discount: 0, total: 10_000, taxRate: 0, taxIncluded: true, doctorId: null, patient: { firstName: "A", lastName: "B", visibleUserIds: [] }, appointment: null };
const prismaStub: any = {
  $queryRaw: async () => [],
  cashRegister: {
    findFirst: async () => (db.cierres.length ? null : reg),
    updateMany: async ({ data }: any) => { db.cierres.push(data); return { count: 1 }; },
  },
  payment: { findMany: async () => db.pagos.map((p) => ({ ...p, invoice: factura })) },
  invoice: { aggregate: async () => ({ _sum: { discount: 0 } }), findMany: async () => [] },
  clinic: { findUnique: async () => ({ cfdiTaxMode: "exempt" }) },
  user: { findMany: async () => [] },
};
const authCtx: any = { clinicId: "c1", userId: "u1", role: "SUPER_ADMIN", permissionsOverride: null, user: { cajaPinHash: "x" } };
(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
(mock as any).module("@/lib/auth-context", { namedExports: { getAuthContext: async () => authCtx } });
(mock as any).module("next/cache", { namedExports: { revalidatePath: () => {}, revalidateTag: () => {} } });
(mock as any).module("@/lib/audit", { namedExports: { logMutation: async () => {} } });
(mock as any).module("@/lib/caja-pin", { namedExports: { canUseCaja: () => true, verifyCajaPin: async () => true } });
(mock as any).module("@/lib/dinero/ajustes.server", { namedExports: { cobrosAsignados: async () => new Set<string>() } });

const req = (body: any): any => ({ json: async () => body, headers: new Headers(), url: "http://localhost/api/caja/close" });

test("C-06 · entró $4,000 en efectivo mientras se contaba: 409 con el esperado nuevo, la caja sigue abierta (antes: corte con −$4,000)", async () => {
  const { POST } = await import("@/app/api/caja/close/route");
  db.pagos = [
    { id: "p1", invoiceId: "f1", amount: 3_740, method: "cash", paidAt: new Date("2026-10-04T05:00:00.000Z") },
    // El cobro de las 11:28 p.m. que llegó con el diálogo abierto.
    { id: "p2", invoiceId: "f2", amount: 4_000, method: "cash", paidAt: new Date("2026-10-04T05:28:00.000Z") },
  ];
  db.cierres = [];
  const r = await POST(req({ countedClosingBalance: 4_740, pin: "123456", esperadoVisto: 4_740 }));
  const body = await r.json();
  assert.equal(r.status, 409);
  assert.equal(body.code, "CAJA_ESPERADO_CAMBIO");
  assert.equal(body.expectedCash, 8_740);
  assert.equal(body.diferencia, 4_000);
  assert.match(body.error, /Entraron \$4,000\.00 en efectivo/);
  assert.equal(db.cierres.length, 0, "no se cerró");
});

test("C-06 · con el esperado que se vio igual al del servidor, cierra como siempre", async () => {
  const { POST } = await import("@/app/api/caja/close/route");
  db.cierres = [];
  const r = await POST(req({ countedClosingBalance: 8_740, pin: "123456", esperadoVisto: 8_740 }));
  assert.equal(r.status, 200);
  assert.equal(db.cierres.length, 1);
  assert.equal(db.cierres[0].snapshotVariance, 0);
});

test("C-05 · el resumen del corte trae «Ingresos del turno» neto: cobrado − reembolsos", async () => {
  const { buildCloseSummary } = await import("@/lib/caja");
  // La foto de la auditoría: efectivo 4,840 · débito 1,800 · otros 4,500 · reembolsos 1,000.
  const s = buildCloseSummary({
    openedAt: apertura, closedAt: new Date(), openingBalance: 1_000, withdrawals: 0, counted: 0,
    derived: {
      cashIncome: 4_840, cardDebitIncome: 1_800, cardCreditIncome: 0, otherIncome: 6_300, totalIncome: 11_140,
      refunds: 1_000, cashRefunds: 1_000, discounts: 0, tax: 0, list: [],
    } as any,
  });
  assert.equal(s.totalIncome, 11_140);
  assert.equal(s.netIncome, 10_140, "antes la pantalla decía $11,140 debajo de «Reembolsos −$1,000»");
  assert.equal(s.otherIncome, 4_500, "las transferencias, que el diálogo de cierre no enseñaba");
});
