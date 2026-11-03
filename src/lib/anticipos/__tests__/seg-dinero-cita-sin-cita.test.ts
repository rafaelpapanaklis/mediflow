/**
 * Seguridad ola 2b · lead 3 — «a favor» de una factura SIN cita cancelada.
 *
 * POST /api/invoices/[id]/dinero-cita {decision:"a_favor"} pide solo
 * billing.charge (recepción por defecto) porque está pensado para el dinero de
 * una cita que se canceló (H15). El candado de la cita vivía dentro de
 * `if (inv.appointmentId)`: una factura suelta (sin cita) o cuya cita ya no
 * existe se saltaba la condición, y recepción podía cancelar una factura PAGADA
 * y convertir su dinero en saldo a favor — lo que /cancel y /refund reservan a
 * billing.refund.
 *
 * Arreglo: sin una cita cancelada viva, «a favor» exige billing.refund.
 *
 * Run: npm run test:seg-ola2b
 */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import { DobleBase } from "./doble-base";

const RAIZ = process.cwd();
const CLINICA = "c1";

let db: DobleBase;
const sesion: { ctx: Record<string, unknown> | null } = { ctx: null };

function prismaDeLaPrueba() {
  const c = db.cliente();
  c.$executeRaw = async () => 0;
  return c;
}
// El doble de prisma se resuelve en cada acceso: cada prueba arma su base.
const prismaProxy = new Proxy({}, { get: (_t, k) => (prismaDeLaPrueba() as any)[k] });

const dobles = new Map<string, unknown>([
  [path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prismaProxy }],
  [path.join(RAIZ, "src/lib/audit.ts"), { logAudit: async () => {}, logMutation: async () => {} }],
  [path.join(RAIZ, "src/lib/factura-mp/servicio.server.ts"), { cerrarLinksDeFactura: async () => 0 }],
  [path.join(RAIZ, "src/lib/anticipos/panel.server.ts"), { cerrarAnticiposDePanel: async () => 0 }],
  [path.join(RAIZ, "src/lib/auth-context.ts"), { getAuthContext: async () => sesion.ctx }],
  [path.join(RAIZ, "src/lib/rate-limit.ts"), { rateLimit: () => null }],
  [path.join(RAIZ, "src/lib/patient-visibility.ts"), { assertPatientVisible: async () => null }],
  [path.join(RAIZ, "src/lib/cache/revalidate.ts"), { revalidateAfter: () => {} }],
]);
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

let decidir: (args: any) => Promise<any>;
let POST: (req: any, props: any) => Promise<Response>;
let NextRequestCtor: any;

before(async () => {
  ({ NextRequest: NextRequestCtor } = await import("next/server"));
  ({ decidirDineroDeCitaCancelada: decidir } = await import("@/lib/anticipos/cita-cancelada.server"));
  ({ POST } = await import("@/app/api/invoices/[id]/dinero-cita/route"));
});

beforeEach(() => {
  db = new DobleBase();
  (db.tablas as any).user = [{ id: "u_rec", clinicId: CLINICA, firstName: "Rita", lastName: "Recepción", email: "r@x" }];
  sesion.ctx = null;
});

/** Factura PAGADA en efectivo: 1000 de 1000. */
function facturaPagada(over: Record<string, unknown> = {}) {
  db.tablas.invoice.push({
    id: "inv1", clinicId: CLINICA, patientId: "p1", invoiceNumber: "MF-1",
    status: "PAID", total: 1000, paid: 1000, balance: 0, notes: null, cfdiUuid: null, appointmentId: null,
    ...over,
  });
  db.tablas.payment.push({ id: "pay1", invoiceId: "inv1", amount: 1000, method: "cash", notes: null });
}
const inv = () => db.tablas.invoice.find((f) => f.id === "inv1")!;
const creditos = () => db.tablas.patientCredit.filter((c) => c.invoiceId === "inv1");

async function llamarRuta(role: string, decision = "a_favor") {
  sesion.ctx = { clinicId: CLINICA, userId: "u_rec", role, permissionsOverride: [] };
  const res = await POST(
    new NextRequestCtor("http://localhost/api/invoices/inv1/dinero-cita", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    }),
    { params: Promise.resolve({ id: "inv1" }) },
  );
  return { status: res.status, body: await res.json() };
}

test("🔴 recepción (billing.charge sin billing.refund) NO pasa a saldo a favor una factura pagada SIN cita", async () => {
  facturaPagada();
  const r = await llamarRuta("RECEPTIONIST");
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.match(r.body.error, /reembols/i);
  assert.equal(inv().status, "PAID", "la factura no se toca");
  assert.equal(inv().paid, 1000);
  assert.equal(creditos().length, 0, "no nace saldo a favor");
  assert.equal(db.tablas.payment.length, 1, "no se escribe el traspaso");
});

test("🔴 ni cuando la cita de la factura ya no existe (fila borrada)", async () => {
  facturaPagada({ appointmentId: "apt_borrada" });
  const r = await llamarRuta("RECEPTIONIST");
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(inv().status, "PAID");
  assert.equal(creditos().length, 0);
});

test("la cita SIGUE viva y no cancelada: se rechaza como siempre", async () => {
  db.tablas.appointment.push({ id: "apt1", clinicId: CLINICA, status: "SCHEDULED" });
  facturaPagada({ appointmentId: "apt1" });
  const r = await llamarRuta("ADMIN");
  assert.equal(r.status, 409);
  assert.match(r.body.error, /no está cancelada/);
  assert.equal(inv().status, "PAID");
});

test("control: recepción SÍ deja a favor el dinero de una cita CANCELADA (H15 intacto)", async () => {
  db.tablas.appointment.push({ id: "apt1", clinicId: CLINICA, status: "CANCELLED" });
  facturaPagada({ appointmentId: "apt1" });
  const r = await llamarRuta("RECEPTIONIST");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.aplicada, "a_favor");
  assert.equal(inv().status, "CANCELLED");
  assert.equal(inv().paid, 0);
  assert.equal(creditos().reduce((s, c) => s + c.amount, 0), 1000);
});

test("quien tiene billing.refund (ADMIN) sí puede dejar a favor una factura sin cita", async () => {
  facturaPagada();
  const r = await llamarRuta("ADMIN");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(inv().status, "CANCELLED");
  assert.equal(creditos().reduce((s, c) => s + c.amount, 0), 1000);
});

test("«reembolso» y «pendiente» solo marcan: recepción los sigue pudiendo usar sin cita", async () => {
  facturaPagada();
  const r = await llamarRuta("RECEPTIONIST", "reembolso");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(inv().status, "PAID", "marcar no mueve dinero");
  assert.match(inv().notes ?? "", /REEMBOLS/i);
});

test("el servicio, llamado sin el permiso explícito, también se niega (falla cerrado)", async () => {
  facturaPagada();
  const r = await decidir({ clinicId: CLINICA, invoiceId: "inv1", decision: "a_favor", userId: "u", quien: "x" });
  assert.equal(r.ok, false);
  assert.equal(inv().status, "PAID");
});
