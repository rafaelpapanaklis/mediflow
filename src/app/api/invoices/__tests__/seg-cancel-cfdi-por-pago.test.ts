/**
 * Seguridad ola 2b · lead 5 — cancelar una factura pagada con saldo a favor
 * NO puede ignorar un CFDI por pago vigente.
 *
 * POST /api/invoices/[id]/cancel tiene una rama para la factura cuyo dinero es
 * todo saldo a favor aplicado (Payment «anticipo»). Ese pago puede tener su
 * propio CFDI (POST /api/payments/[id]/cfdi), que vive en cfdi_records con
 * paymentId y NUNCA llena invoices.cfdiUuid. La rama solo miraba cfdiUuid:
 * devolvía el dinero al saldo a favor y cancelaba la factura con el CFDI del
 * pago vigente ante el SAT. Sus hermanas (reembolso, anular anticipo, «a favor»,
 * «ya lo devolví») ya lo bloqueaban con algunPagoTieneCfdiVigente.
 *
 * Run: npm run test:seg-ola2b
 */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";

const RAIZ = process.cwd();
const CLINICA = "c1";
let FACTURA: Record<string, any>;
let cfdiPorPagoVigente = true;
let devoluciones = 0;

const sqlDe = (q: any) => (Array.isArray(q) ? q.join("?") : String(q));
const prismaFalso: any = {
  invoice: {
    findFirst: async ({ where }: any) => (where.id === FACTURA.id && where.clinicId === CLINICA ? { ...FACTURA } : null),
    updateMany: async ({ where, data }: any) => {
      if (where.id !== FACTURA.id || where.clinicId !== CLINICA) return { count: 0 };
      Object.assign(FACTURA, data);
      return { count: 1 };
    },
  },
  payment: { count: async ({ where }: any) => (where.method === "anticipo" ? 1 : 0) },
  $queryRaw: async (q: any) => {
    const sql = sqlDe(q);
    if (sql.includes("information_schema.columns")) return [{ existe: true }];
    if (sql.includes('"paymentId" IS NOT NULL')) return [{ existe: cfdiPorPagoVigente }];
    return [];
  },
  $executeRaw: async () => 0,
  $transaction: async (fn: any) => fn(prismaFalso),
};

const dobles = new Map<string, unknown>([
  [path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prismaFalso }],
  [path.join(RAIZ, "src/lib/auth-context.ts"), {
    getAuthContext: async () => ({ clinicId: CLINICA, userId: "u_admin", role: "ADMIN", permissionsOverride: [] }),
  }],
  [path.join(RAIZ, "src/lib/patient-visibility.ts"), { assertPatientVisible: async () => null }],
  [path.join(RAIZ, "src/lib/audit.ts"), { logMutation: async () => {} }],
  [path.join(RAIZ, "src/lib/cache/revalidate.ts"), { revalidateAfter: () => {} }],
  [path.join(RAIZ, "src/lib/factura-mp/servicio.server.ts"), { cerrarLinksDeFactura: async () => 0 }],
  [path.join(RAIZ, "src/lib/anticipos/panel.server.ts"), { cerrarAnticiposDePanel: async () => 0 }],
]);
const M = Module as unknown as {
  _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (req: string, parent: unknown, isMain: boolean) => string;
};
const cargaOriginal = M._load;
M._load = function (req, parent, isMain) {
  if (req === "server-only" || req === "client-only") return {};
  if (req === "next/cache") return { revalidatePath: () => {}, revalidateTag: () => {} };
  let resuelto: string | null = null;
  try { resuelto = M._resolveFilename(req, parent, isMain); } catch { resuelto = null; }
  if (resuelto && dobles.has(resuelto)) return dobles.get(resuelto);
  if (resuelto === path.join(RAIZ, "src/lib/patient-credit-aplicar.ts")) {
    const real = cargaOriginal.call(this, req, parent, isMain) as Record<string, unknown>;
    return {
      ...real,
      devolverAnticipoAlCancelar: async (_tx: unknown, a: any) => { devoluciones++; return { devuelto: a.invoice.paid, error: null }; },
    };
  }
  return cargaOriginal.call(this, req, parent, isMain);
};

let POST: (req: any, props: any) => Promise<Response>;
let NextRequestCtor: any;
before(async () => {
  ({ NextRequest: NextRequestCtor } = await import("next/server"));
  ({ POST } = await import("@/app/api/invoices/[id]/cancel/route"));
});
beforeEach(() => {
  devoluciones = 0;
  // Pagada entera con saldo a favor aplicado; sin CFDI de la factura completa.
  FACTURA = { id: "inv1", clinicId: CLINICA, patientId: null, invoiceNumber: "MF-1", status: "PAID", total: 800, paid: 800, balance: 0, cfdiUuid: null, notes: null };
});

async function cancelar() {
  const res = await POST(
    new NextRequestCtor("http://localhost/api/invoices/inv1/cancel", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    }),
    { params: Promise.resolve({ id: "inv1" }) },
  );
  return { status: res.status, body: await res.json() };
}

test("🔴 con un CFDI por pago vigente: 409 CFDI_POR_PAGO_VIGENTE, la factura sigue viva y el saldo no vuelve", async () => {
  cfdiPorPagoVigente = true;
  const r = await cancelar();
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.code, "CFDI_POR_PAGO_VIGENTE");
  assert.equal(FACTURA.status, "PAID");
  assert.equal(FACTURA.paid, 800);
  assert.equal(devoluciones, 0, "no se devuelve nada al saldo a favor");
});

test("control: sin CFDI por pago, se cancela y el saldo vuelve como siempre", async () => {
  cfdiPorPagoVigente = false;
  const r = await cancelar();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(FACTURA.status, "CANCELLED");
  assert.equal(devoluciones, 1);
});
