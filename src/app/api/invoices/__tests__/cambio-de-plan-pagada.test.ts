/**
 * ws1-t11 (fallo 4 de la revisión final de ortodoncia) — «Cambiar plan de pago»
 * ya no reescribe lo cobrado.
 *
 * Run: npm run test:cambio-de-plan-pagada
 *   (--experimental-test-module-mocks: se ejecuta el PUT /api/invoices/[id]/
 *   condiciones DE VERDAD; se sustituyen Prisma, la sesión, la visibilidad del
 *   paciente, la auditoría y la capa de `invoice_payment_terms`.)
 *
 * El bug (REPORTE-ws1-t9.md, menor 4): en Ana Ortega, MF-1074 («Plan saldado ·
 * Pagado completo») aceptó «A plazos · 6 pagos» y su calendario pasó a Mes 1…6.
 * Con el código viejo la ruta guardaba sin mirar `paid` ni `status`: las pruebas
 * de la ruta de abajo fallan (200 en vez de 409, y la fila se escribe).
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { revisarCambioDePlan } from "@/lib/invoices/cambio-de-plan";
import { calendarioDeCuotas, estadoDelPlan } from "@/lib/invoices/plan-de-pagos";
import { condicionesPorDefecto, type CondicionesPago } from "@/lib/quotes/condiciones-pago";

const CLINICA = "cli_1";

const plazos = (over: Partial<CondicionesPago> = {}): CondicionesPago => ({
  ...condicionesPorDefecto(),
  modo: "plazos",
  metodo: "cash",
  enganche: 0,
  numPagos: 4,
  frecuencia: "MONTHLY",
  primerPago: "2026-07-01",
  ...over,
});
const unico = (over: Partial<CondicionesPago> = {}): CondicionesPago => ({ ...condicionesPorDefecto(), ...over });

let FACTURA: any;
let GUARDADAS: CondicionesPago | null;
let escrituras: any[];
let auditorias: any[];

beforeEach(() => {
  FACTURA = { id: "inv_1", clinicId: CLINICA, patientId: "p1", total: 8000, paid: 0, status: "PENDING" };
  GUARDADAS = null;
  escrituras = [];
  auditorias = [];
});

(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      invoice: {
        findFirst: async ({ where }: any) => (where.id === FACTURA.id && where.clinicId === CLINICA ? { ...FACTURA } : null),
      },
    },
  },
});
(mock as any).module("@/lib/auth-context", {
  namedExports: { getAuthContext: async () => ({ clinicId: CLINICA, userId: "u1", role: "ADMIN", permissionsOverride: null }) },
});
(mock as any).module("@/lib/patient-visibility", { namedExports: { assertPatientVisible: async () => null } });
(mock as any).module("@/lib/audit", { namedExports: { logMutation: async (a: any) => { auditorias.push(a); } } });
(mock as any).module("@/lib/invoices/condiciones-pago-db", {
  namedExports: {
    leerCondicionesDeFacturas: async (_db: any, args: any) => {
      assert.equal(args.clinicId, CLINICA, "la lectura va acotada a la clínica de la sesión");
      const porFactura = new Map();
      if (GUARDADAS && args.invoiceIds.includes(FACTURA.id)) porFactura.set(FACTURA.id, GUARDADAS);
      return { porFactura, fallo: false, sinTabla: false };
    },
    guardarCondicionesDeFactura: async (_db: any, args: any) => {
      escrituras.push(args);
      GUARDADAS = args.condiciones;
      return { condiciones: args.condiciones, fallo: false, sinTabla: false, ajena: false };
    },
  },
});

async function put(condiciones: CondicionesPago) {
  const { PUT } = await import("@/app/api/invoices/[id]/condiciones/route");
  const req: any = { json: async () => ({ condiciones }), headers: new Headers(), url: "http://localhost/api/invoices/inv_1/condiciones" };
  const res = await PUT(req, { params: { id: FACTURA.id } });
  return { status: res.status, body: await res.json() };
}

/* ── La ruta ─────────────────────────────────────────────────────────── */

test("factura PAGADA con plan (el caso MF-1074): pasarla a 6 pagos → 409 claro y no se escribe nada", async () => {
  FACTURA = { ...FACTURA, paid: 8000, status: "PAID" };
  GUARDADAS = plazos({ enganche: 2000, numPagos: 3 });
  const r = await put(plazos({ enganche: 0, numPagos: 6, primerPago: "2026-10-02" }));
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.code, "FACTURA_PAGADA");
  assert.match(r.body.error, /ya está pagada completa/);
  assert.equal(escrituras.length, 0);
});

test("factura PAGADA de un pago, sin plan: tampoco se le pone un plan a plazos", async () => {
  FACTURA = { ...FACTURA, paid: 8000, status: "PAID" };
  const r = await put(plazos({ numPagos: 6 }));
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "FACTURA_PAGADA");
  assert.equal(escrituras.length, 0);
});

test("factura saldada por importe aunque el estado no diga PAID (pago de más): 409", async () => {
  FACTURA = { ...FACTURA, paid: 8500, status: "PARTIAL" };
  GUARDADAS = plazos();
  const r = await put(unico({ metodo: "cash" }));
  assert.equal(r.status, 409);
  assert.equal(escrituras.length, 0);
});

test("factura PAGADA de un pago: anotar el método sigue pudiendo (nace saldada con el anticipo en Nueva factura)", async () => {
  FACTURA = { ...FACTURA, paid: 8000, status: "PAID" };
  const r = await put(unico({ metodo: "transfer" }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(escrituras.length, 1);
});

test("factura PAGADA: mandar el mismo plan que ya tiene no es un cambio", async () => {
  FACTURA = { ...FACTURA, paid: 8000, status: "PAID" };
  GUARDADAS = plazos({ enganche: 2000 });
  const r = await put(plazos({ enganche: 2000 }));
  assert.equal(r.status, 200);
});

test("pago PARCIAL sobre un plan a plazos: un plan que reparte de nuevo lo cobrado → 409 con lo pendiente", async () => {
  FACTURA = { ...FACTURA, paid: 3000, status: "PARTIAL" };
  GUARDADAS = plazos({ enganche: 2000, numPagos: 3 });
  const r = await put(plazos({ enganche: 0, numPagos: 6 }));
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "COBRADO_NO_SE_TOCA");
  assert.match(r.body.error, /\$3,000\.00 cobrados/);
  assert.match(r.body.error, /pendiente \(\$5,000\.00\)/);
  assert.equal(escrituras.length, 0);
});

test("pago PARCIAL: con lo cobrado como enganche, el plan nuevo solo reparte lo pendiente y se guarda", async () => {
  FACTURA = { ...FACTURA, paid: 3000, status: "PARTIAL" };
  GUARDADAS = plazos({ enganche: 2000, numPagos: 3 });
  const nuevas = plazos({ enganche: 3000, numPagos: 5, primerPago: "2026-10-02" });
  const r = await put(nuevas);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(escrituras.length, 1);
  assert.equal(auditorias[0].before.condicionesPago.enganche, 2000, "la bitácora guarda el plan de antes, no null");

  // Y el calendario resultante: lo cobrado pagado, las 5 cuotas = lo pendiente.
  const est = estadoDelPlan(calendarioDeCuotas(nuevas, 8000), [{ importe: 3000 }], "2026-10-02");
  assert.equal(est.cuotas[0].esEnganche, true);
  assert.equal(est.cuotas[0].estado, "pagada");
  assert.ok(est.cuotas.slice(1).every((q) => q.abonado === 0), "ninguna cuota nueva se come lo ya cobrado");
  assert.equal(est.pendiente, 5000);
});

test("pago PARCIAL: pasar el resto a un solo pago se puede", async () => {
  FACTURA = { ...FACTURA, paid: 3000, status: "PARTIAL" };
  GUARDADAS = plazos();
  const r = await put(unico({ metodo: "cash" }));
  assert.equal(r.status, 200);
});

test("sin nada cobrado el cambio de plan sigue libre (y no se lee el plan anterior)", async () => {
  GUARDADAS = plazos({ enganche: 2000 });
  const r = await put(plazos({ enganche: 0, numPagos: 12 }));
  assert.equal(r.status, 200);
  assert.equal(escrituras.length, 1);
});

/* ── La regla pura ───────────────────────────────────────────────────── */

test("regla: un parcial sin plan a plazos previo no fija enganche (Nueva factura con anticipo parcial)", () => {
  const v = revisarCambioDePlan({
    factura: { total: 8000, pagado: 500, status: "PARTIAL" },
    antes: null,
    despues: plazos({ enganche: 2000 }),
  });
  assert.deepEqual(v, { ok: true });
});

test("regla: el enganche se compara al centavo", () => {
  const factura = { total: 1000, pagado: 333.33, status: "PARTIAL" };
  assert.equal(revisarCambioDePlan({ factura, antes: plazos(), despues: plazos({ enganche: 333.33 }) }).ok, true);
  assert.equal(revisarCambioDePlan({ factura, antes: plazos(), despues: plazos({ enganche: 333.34 }) }).ok, false);
});
