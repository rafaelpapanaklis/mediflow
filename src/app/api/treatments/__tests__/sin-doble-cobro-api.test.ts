/**
 * PLAN DE TRATAMIENTO · FASE 2 (A) — «un mismo procedimiento NUNCA en dos facturas», por TODOS los
 * caminos, con los HANDLERS REALES contra un Postgres en memoria (PGlite) con
 * `sql/plan-tratamiento-filas.sql` pegado dos veces:
 *
 *  · presupuesto aceptado / «Aceptar el plan» → UNA nota del plan (y presentar en un clic);
 *  · la consulta (borrador automático de «Procedimientos realizados») → sin lo del plan;
 *  · «Tratamientos detectados» → «Crear factura» no cobra lo del plan (409 en el servidor);
 *  · «hecho» → lo recién hecho sigue siendo del plan (no se vuelve a cobrar aparte);
 *  · «Cobrar hoy» → abono a la nota del plan, no una factura nueva;
 *  · borrar un plan con nota → no (409, se ofrece cancelarlo).
 * Y la otra clínica no ve ni cuenta nada de esto.
 *
 * Run: PGLITE_DIR=<carpeta con node_modules/@electric-sql/pglite> npm run test:plan-sin-doble-cobro
 *
 * Los dobles van por `Module._load`. ⛔ Nunca toca una base de verdad. Sin PGlite se SALTA diciéndolo.
 */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { cargarPGlite, crearBase, type Base } from "@/lib/treatments/__tests__/arnes-pg";

let PGlite: (new () => any) | null = null;
let base: Base;
const prismaVivo: any = {};
const ctx: Record<string, any> = {};
const ocultos = new Set<string>();
const facturasDeCita: any[] = [];

const dobles: Record<string, unknown> = {
  "server-only": {},
  "@/lib/prisma": { prisma: prismaVivo },
  "@/lib/auth-context": { getAuthContext: async () => ({ ...ctx }) },
  "@/lib/audit": { logAudit: async () => {}, logMutation: async () => {}, extractAuditMeta: () => ({}) },
  "@/lib/patient-visibility": {
    assertPatientVisible: async (id: string) => (ocultos.has(id) ? NextResponse.json({ error: "patient_not_found" }, { status: 404 }) : null),
    relatedPatientVisibilityAnd: () => [],
  },
  "@/lib/cache/revalidate": { revalidateAfter: () => undefined },
  "next/cache": { revalidatePath: () => undefined, revalidateTag: () => undefined },
  "@/lib/patient-credit-aplicar": { aplicarSaldoAFavor: async () => ({ aplicado: 0, restanteAFavor: 0, factura: null, motivo: null }) },
  "@/lib/quotes/ortodoncia.server": { casosDesdePresupuestos: async () => new Map() },
  // «Crear factura» de Tratamientos detectados: la sesión de la agenda y quien crea la factura.
  "@/lib/agenda/api-helpers": {
    loadClinicSession: async () => ({ user: { id: ctx.userId, role: ctx.role, clinicId: ctx.clinicId, permissionsOverride: null }, clinic: { id: ctx.clinicId } }),
  },
  "@/lib/invoices/crear-desde-cita.server": {
    crearFacturaDesdeCita: async (a: any) => {
      facturasDeCita.push(a);
      return { ok: true, invoice: { id: `inv-cita-${facturasDeCita.length}`, invoiceNumber: `F-C${facturasDeCita.length}`, total: 1, balance: 1 }, anticipoAplicado: 0 };
    },
  },
};
const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  return req in dobles ? dobles[req] : cargaOriginal.call(this, req, ...r);
};

const AHORA = () => new Date();

async function usar(opciones: { conSqlDelPlan?: boolean } = {}) {
  base = await crearBase(PGlite!, opciones);
  for (const k of Object.keys(prismaVivo)) delete prismaVivo[k];
  Object.assign(prismaVivo, base.prisma);
  (await import("@/lib/treatments/items-db"))._olvidarSondas();
  (await import("@/lib/quotes/aceptacion-db"))._olvidarTablas();
  await base.db.query(`INSERT INTO "procedure_catalog" VALUES ('proc-r','c1','Resina',1250.5,true), ('proc-l','c1','Limpieza',800,true), ('proc-b','c1','Blanqueamiento',3000,true)`);
  await base.db.query(`INSERT INTO "appointments" VALUES ('cita1','c1','pac-c1'), ('cita2','c2','pac-c2')`);
}

const pedir = (url: string, body?: unknown, method = "POST") =>
  new NextRequest(`http://x${url}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const leer = async (r: Response) => ({ status: r.status, body: await r.json() });
const notas = async (planId: string) => (await base.db.query(`SELECT * FROM "invoices" WHERE "treatmentPlanId" = $1 ORDER BY "createdAt"`, [planId])).rows;
const todasLasFacturas = async () => (await base.db.query(`SELECT * FROM "invoices" ORDER BY "createdAt"`)).rows;
const filas = async (planId: string) => (await base.db.query(`SELECT * FROM "treatment_plan_items" WHERE "planId" = $1 ORDER BY "orden"`, [planId])).rows;

const ITEMS = [
  { nombre: "Resina", procedureId: "proc-r", dientes: "16", caras: "MO", precio: "1250.50", fase: "restauradora", motivo: "Caries" },
  { nombre: "Limpieza", procedureId: "proc-l", precio: 800, fase: "higienica" },
];

before(async () => {
  PGlite = await cargarPGlite();
});

beforeEach(() => {
  Object.assign(ctx, { clinicId: "c1", userId: "doc-c1", role: "ADMIN", isDoctor: false, permissionsOverride: null });
  ocultos.clear();
  facturasDeCita.length = 0;
});

const salta = (t: { skip: (m: string) => void }) => {
  if (!PGlite) {
    t.skip("PGlite no está: pasa PGLITE_DIR=<carpeta con node_modules/@electric-sql/pglite>");
    return true;
  }
  return false;
};

async function crearPlan() {
  const { POST } = await import("@/app/api/treatments/route");
  const r = await leer(await POST(pedir("/api/treatments", { patientId: "pac-c1", name: "Plan Ana", description: "▸ texto", items: ITEMS })));
  assert.equal(r.status, 201);
  return r.body.id as string;
}

async function aceptarPlan(planId: string) {
  const { POST } = await import("@/app/api/treatments/[id]/nota-de-cobro/route");
  return leer(await POST(pedir(`/api/treatments/${planId}/nota-de-cobro`), params(planId)));
}

async function detectados(lineItems: unknown[]) {
  const { POST } = await import("@/app/api/invoices/from-appointment/route");
  return leer(await POST(pedir("/api/invoices/from-appointment", { appointmentId: "cita1", lineItems })));
}

// ── Presentar y aceptar ─────────────────────────────────────────────────────

test("presentar en un clic (la ruta de la ventana): presupuesto PRESENTADO con su liga; otra vez = el mismo; el doctor ajeno no", async (t) => {
  if (salta(t)) return;
  await usar();
  const plan = await crearPlan();
  const { POST } = await import("@/app/api/treatments/[id]/presentar/route");
  const r = await leer(await POST(pedir(`/api/treatments/${plan}/presentar`), params(plan)));
  assert.equal(r.status, 201);
  assert.ok(r.body.quoteId && r.body.folio);
  assert.match(r.body.enlaceFirma, /^\/presupuesto\//);
  assert.equal(r.body.presentado, true);
  const q = (await base.db.query(`SELECT "status", "treatmentPlanId" FROM "quotes" WHERE "id" = $1`, [r.body.quoteId])).rows[0];
  assert.deepEqual([q.status, q.treatmentPlanId], ["PRESENTED", plan]);
  const otra = await leer(await POST(pedir(`/api/treatments/${plan}/presentar`), params(plan)));
  assert.deepEqual([otra.status, otra.body.quoteId], [200, r.body.quoteId], "no nace otro presupuesto");
  Object.assign(ctx, { userId: "otro-doc", role: "DOCTOR", isDoctor: true });
  assert.equal((await POST(pedir(`/api/treatments/${plan}/presentar`), params(plan))).status, 404);
  Object.assign(ctx, { clinicId: "c2", userId: "doc-c2", role: "ADMIN", isDoctor: false });
  assert.equal((await POST(pedir(`/api/treatments/${plan}/presentar`), params(plan))).status, 404, "otra clínica");
});

test("aceptar el plan: UNA nota; aceptarlo otra vez no crea otra", async (t) => {
  if (salta(t)) return;
  await usar();
  const plan = await crearPlan();
  const a = await aceptarPlan(plan);
  assert.equal(a.body.estado, "creada");
  const b = await aceptarPlan(plan);
  assert.equal(b.body.estado, "nada");
  assert.equal((await notas(plan)).length, 1);
  assert.equal((await todasLasFacturas()).length, 1);
});

// ── La consulta ─────────────────────────────────────────────────────────────

test("consulta: el borrador automático se queda SOLO con lo que no es del plan (con nota o sin ella)", async (t) => {
  if (salta(t)) return;
  await usar();
  const plan = await crearPlan();
  const { procedimientosParaElBorrador } = await import("@/lib/treatments/sin-doble-cobro.server");
  const hoy = [
    { id: "proc-r", name: "Resina", price: 1250.5, quantity: 1 },
    { id: "proc-b", name: "Blanqueamiento", price: 3000, quantity: 1 },
  ];
  // Plan sin aceptar: la resina ya es del plan (se cobrará en su nota), el blanqueamiento no.
  const sinNota = await procedimientosParaElBorrador("c1", "pac-c1", hoy);
  assert.deepEqual(sinNota.procedures.map((p) => [p.name, p.quantity, p.price]), [["Blanqueamiento", 1, 3000]]);
  assert.deepEqual(sinNota.delPlan, ["Resina"]);
  // Plan aceptado: igual (la resina está en la nota).
  await aceptarPlan(plan);
  const conNota = await procedimientosParaElBorrador("c1", "pac-c1", hoy);
  assert.deepEqual(conNota.procedures.map((p) => p.name), ["Blanqueamiento"]);
  // Dos resinas hoy y una en el plan: una va al borrador.
  const dos = await procedimientosParaElBorrador("c1", "pac-c1", [{ id: "proc-r", name: "Resina", price: 1250.5, quantity: 2 }]);
  assert.deepEqual(dos.procedures.map((p) => [p.name, p.quantity]), [["Resina", 1]]);
  // Otra clínica (aunque llegara el mismo id de paciente): ni una fila → todo como hoy.
  const ajena = await procedimientosParaElBorrador("c2", "pac-c1", hoy);
  assert.deepEqual(ajena.procedures.map((p) => p.name), ["Resina", "Blanqueamiento"]);
  // Sin el SQL del plan: todo como hoy.
  await usar({ conSqlDelPlan: false });
  const sinSql = await procedimientosParaElBorrador("c1", "pac-c1", hoy);
  assert.equal(sinSql.procedures.length, 2);
});

test("consulta: POST /api/clinical aparta lo del plan ANTES de crear el borrador y lo dice en la respuesta", () => {
  const src = readFileSync(join(process.cwd(), "src/app/api/clinical/route.ts"), "utf8");
  const fin = src.slice(src.indexOf("async function finishCreate"));
  const aparta = fin.indexOf("procedimientosParaElBorrador(dbUser.clinicId, data.patientId");
  const crea = fin.indexOf("prisma.invoice.create");
  assert.ok(aparta > 0 && crea > aparta, "se aparta lo del plan antes de crear la factura borrador");
  assert.match(fin, /const items = procedures\s*\n?\s*\.map/, "el borrador se arma con lo que quedó, no con todo");
  assert.match(fin, /procedimientosDelPlan \}, \{ status: 201 \}/);
});

// ── Tratamientos detectados y «hecho» ───────────────────────────────────────

test("Tratamientos detectados: «Crear factura» no cobra lo del plan (409); lo de fuera, como siempre", async (t) => {
  if (salta(t)) return;
  await usar();
  const plan = await crearPlan();
  await aceptarPlan(plan);
  const r = await detectados([{ name: "Resina", toothNumber: 16, unitPrice: 1250.5, quantity: 1, procedureCatalogId: "proc-r" }]);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "en_el_plan");
  assert.deepEqual(r.body.conceptos, ["Resina"]);
  assert.equal(facturasDeCita.length, 0, "no se creó la factura de la cita");
  // Otro diente: no es la fila del plan.
  const otro = await detectados([{ name: "Resina", toothNumber: 26, unitPrice: 1250.5, quantity: 1, procedureCatalogId: "proc-r" }]);
  assert.equal(otro.status, 201);
  assert.equal(facturasDeCita.length, 1);
  // Sin procedureCatalogId (cliente de antes): por nombre y diente.
  const porNombre = await detectados([{ name: "resina", toothNumber: 16, unitPrice: 1, quantity: 1 }]);
  assert.equal(porNombre.status, 409);
});

test("«hecho» → odontograma → detectado: lo recién hecho sigue siendo del plan (no se cobra aparte); en la consulta tampoco", async (t) => {
  if (salta(t)) return;
  await usar();
  const plan = await crearPlan();
  await aceptarPlan(plan);
  const [resina] = (await filas(plan)).filter((f: any) => f.nombre === "Resina");
  const { repoFilas } = await import("@/lib/treatments/items-db");
  await repoFilas.cambiarEstado(prismaVivo, { clinicId: "c1", planId: plan, filaId: resina.id, a: "hecho", userId: "doc-c1", citaId: "cita1" });
  const r = await detectados([{ name: "Resina", toothNumber: 16, unitPrice: 1250.5, quantity: 1, procedureCatalogId: "proc-r" }]);
  assert.equal(r.status, 409);
  assert.equal(facturasDeCita.length, 0);
  const { procedimientosParaElBorrador } = await import("@/lib/treatments/sin-doble-cobro.server");
  const c = await procedimientosParaElBorrador("c1", "pac-c1", [{ id: "proc-r", name: "Resina", price: 1250.5, quantity: 1 }]);
  assert.deepEqual(c.procedures, []);
  // Hecha hace dos días: lo de hoy es trabajo nuevo y se cobra como siempre.
  const dosDias = new Date(AHORA().getTime() + 2 * 24 * 3600 * 1000);
  const despues = await procedimientosParaElBorrador("c1", "pac-c1", [{ id: "proc-r", name: "Resina", price: 1250.5, quantity: 1 }], dosDias);
  assert.equal(despues.procedures.length, 1);
});

test("un plan cancelado SIN nota ya no aparta nada; CON nota viva, lo que su nota cobra sigue sin cobrarse aparte", async (t) => {
  if (salta(t)) return;
  await usar();
  const plan = await crearPlan();
  await base.db.query(`UPDATE "treatment_plans" SET "status" = 'ABANDONED' WHERE "id" = $1`, [plan]);
  const r = await detectados([{ name: "Resina", toothNumber: 16, unitPrice: 1250.5, quantity: 1, procedureCatalogId: "proc-r" }]);
  assert.equal(r.status, 201);
  // Revisión, hallazgo 3: cancelado tras tener nota (lo que ofrece el 409 de borrar) — la nota sigue viva.
  await usar();
  const conNota = await crearPlan();
  await aceptarPlan(conNota);
  await base.db.query(`UPDATE "treatment_plans" SET "status" = 'ABANDONED' WHERE "id" = $1`, [conNota]);
  const r2 = await detectados([{ name: "Resina", toothNumber: 16, unitPrice: 1250.5, quantity: 1, procedureCatalogId: "proc-r" }]);
  assert.equal(r2.status, 409);
  const { GET } = await import("@/app/api/treatments/cuentas/route");
  const c = await leer(await GET(pedir(`/api/treatments/cuentas?patientId=pac-c1`, undefined, "GET")));
  const { modoInicialCobroHoy } = await import("@/lib/treatments/sin-doble-cobro");
  assert.deepEqual(modoInicialCobroHoy(c.body.planes), { modo: "abono", planId: conNota }, "su nota se sigue abonando");
  // Con la nota cancelada en Facturación, ya nada lo cobra: se cobra como siempre.
  await base.db.query(`UPDATE "invoices" SET "status" = 'CANCELLED' WHERE "treatmentPlanId" = $1`, [conNota]);
  const r3 = await detectados([{ name: "Resina", toothNumber: 16, unitPrice: 1250.5, quantity: 1, procedureCatalogId: "proc-r" }]);
  assert.equal(r3.status, 201);
});

test("revisión, hallazgo 1: «Restauración con resina» del odontograma (otro procedimiento) = la «Resina» del plan; una resina por cara no son dos", async (t) => {
  if (salta(t)) return;
  await usar();
  await base.db.query(`INSERT INTO "procedure_catalog" VALUES ('proc-odo','c1','Restauración con resina',1500,true)`);
  const plan = await crearPlan();
  await aceptarPlan(plan);
  const caras = [
    { code: "ODO_RESINA", name: "Restauración con resina", toothNumber: 16, surface: "M", unitPrice: 1500, quantity: 1, procedureCatalogId: "proc-odo" },
    { code: "ODO_RESINA", name: "Restauración con resina", toothNumber: 16, surface: "O", unitPrice: 1500, quantity: 1, procedureCatalogId: "proc-odo" },
  ];
  const r = await detectados(caras);
  assert.equal(r.status, 409);
  assert.equal(facturasDeCita.length, 0);
});

test("revisión, hallazgo 6: lo que «Tratamientos detectados» ya apartó no se vuelve a contar contra lo de fuera", async (t) => {
  if (salta(t)) return;
  await usar();
  const { POST } = await import("@/app/api/treatments/route");
  const sinDiente = await leer(await POST(pedir("/api/treatments", { patientId: "pac-c1", name: "Plan", items: [{ nombre: "Resina", procedureId: "proc-r", precio: 1000 }] })));
  const [fila] = await filas(sinDiente.body.id);
  const fuera = [{ name: "Resina", toothNumber: 26, unitPrice: 1250.5, quantity: 1, procedureCatalogId: "proc-r" }];
  const { POST: crear } = await import("@/app/api/invoices/from-appointment/route");
  // El cliente apartó la del 16 con la fila (sin diente): la del 26 es de fuera.
  const r = await leer(await crear(pedir("/api/invoices/from-appointment", { appointmentId: "cita1", lineItems: fuera, filasApartadas: [fila.id] })));
  assert.equal(r.status, 201);
  // Sin decirlo, el servidor la toma por la del plan (no cobra dos veces).
  assert.equal((await detectados(fuera)).status, 409);
  // Y una fila CON diente no se descuenta si viene algo de ese diente.
  await usar();
  const p2 = await crearPlan();
  const filaResina = (await filas(p2)).find((f: any) => f.nombre === "Resina");
  const mismo = await leer(await crear(pedir("/api/invoices/from-appointment", {
    appointmentId: "cita1", filasApartadas: [filaResina.id],
    lineItems: [{ name: "Resina", toothNumber: 16, unitPrice: 1250.5, quantity: 1, procedureCatalogId: "proc-r" }],
  })));
  assert.equal(mismo.status, 409);
});

test("revisión, hallazgo 4: una fila que otra consulta ya apartó no se traga la consulta siguiente", async (t) => {
  if (salta(t)) return;
  await usar();
  const plan = await crearPlan();
  const limpieza = (await filas(plan)).find((f: any) => f.nombre === "Limpieza");
  const { procedimientosParaElBorrador } = await import("@/lib/treatments/sin-doble-cobro.server");
  const hoy = [{ id: "proc-l", name: "Limpieza", price: 800, quantity: 1 }];
  const primera = await procedimientosParaElBorrador("c1", "pac-c1", hoy);
  assert.deepEqual([primera.procedures.length, primera.filaIds], [0, [limpieza.id]]);
  // La consulta de octubre la anotó (lo hace POST /api/clinical); la de abril ya la cobra.
  await base.db.query(`INSERT INTO "medical_records" VALUES ('mr-oct','c1','pac-c1',$1)`, [JSON.stringify({ planItemsApartados: [limpieza.id] })]);
  const abril = await procedimientosParaElBorrador("c1", "pac-c1", hoy);
  assert.deepEqual(abril.procedures.map((p) => p.name), ["Limpieza"]);
  // Lo apartado por consultas de OTRA clínica no cuenta.
  await usar();
  const p2 = await crearPlan();
  const l2 = (await filas(p2)).find((f: any) => f.nombre === "Limpieza");
  await base.db.query(`INSERT INTO "medical_records" VALUES ('mr-ajena','c2','pac-c1',$1)`, [JSON.stringify({ planItemsApartados: [l2.id] })]);
  assert.equal((await procedimientosParaElBorrador("c1", "pac-c1", hoy)).procedures.length, 0);
});

test("revisión, hallazgo 8: dos «Presentar» a la vez dejan UN presupuesto del plan", async (t) => {
  if (salta(t)) return;
  await usar();
  const plan = await crearPlan();
  const { POST } = await import("@/app/api/treatments/[id]/presentar/route");
  const [a, b] = await Promise.all([
    leer(await POST(pedir(`/api/treatments/${plan}/presentar`), params(plan))),
    leer(await POST(pedir(`/api/treatments/${plan}/presentar`), params(plan))),
  ]);
  assert.equal(a.body.quoteId, b.body.quoteId);
  assert.equal((await base.db.query(`SELECT count(*)::int AS n FROM "quotes" WHERE "treatmentPlanId" = $1`, [plan])).rows[0].n, 1);
});

// ── «Cobrar hoy» ────────────────────────────────────────────────────────────

test("Cobrar hoy: con la nota del plan, el cobro es ABONO a esa nota (ninguna factura nueva); sin nota, se ofrece crearla", async (t) => {
  if (salta(t)) return;
  await usar();
  const plan = await crearPlan();
  const { GET } = await import("@/app/api/treatments/cuentas/route");
  const { modoInicialCobroHoy, conceptosQueYaSonDelPlan } = await import("@/lib/treatments/sin-doble-cobro");
  const { abonoAlPlan } = await import("@/lib/invoices/cobrar-hoy");

  const antes = await leer(await GET(pedir(`/api/treatments/cuentas?patientId=pac-c1`, undefined, "GET")));
  assert.equal(antes.status, 200);
  assert.deepEqual(modoInicialCobroHoy(antes.body.planes), { modo: "nota_del_plan", planId: plan });
  assert.equal(antes.body.planes[0].porFacturar, 2050.5);

  await aceptarPlan(plan);
  const r = await leer(await GET(pedir(`/api/treatments/cuentas?patientId=pac-c1`, undefined, "GET")));
  const [p] = r.body.planes;
  assert.deepEqual([p.planId, p.conFilas, p.total, p.saldo, p.pagado, p.porFacturar], [plan, true, 2050.5, 2050.5, 0, 0]);
  assert.deepEqual(modoInicialCobroHoy(r.body.planes), { modo: "abono", planId: plan });
  const abono = abonoAlPlan(p.notas, 500);
  const [nota] = await notas(plan);
  assert.deepEqual(abono.reparto, [{ invoiceId: nota.id, invoiceNumber: nota.invoiceNumber, monto: 500 }], "el pago va a la nota del plan");
  assert.equal(abono.saldoQueda, 1550.5);
  // El motivo de la cita («Resina») en una nota nueva se señala: ya es del plan.
  assert.deepEqual(conceptosQueYaSonDelPlan([{ nombre: "Resina", procedureId: "proc-r" }], r.body.planes), [{ indice: 0, plan: "Plan Ana" }]);
  assert.equal((await todasLasFacturas()).length, 1, "una sola factura en todo el camino");
});

test("Cobrar hoy: la otra clínica, un paciente oculto o sin billing.view no ven cuentas", async (t) => {
  if (salta(t)) return;
  await usar();
  await crearPlan();
  const { GET } = await import("@/app/api/treatments/cuentas/route");
  Object.assign(ctx, { clinicId: "c2", userId: "doc-c2" });
  assert.equal((await GET(pedir(`/api/treatments/cuentas?patientId=pac-c1`, undefined, "GET"))).status, 404);
  const propia = await leer(await GET(pedir(`/api/treatments/cuentas?patientId=pac-c2`, undefined, "GET")));
  assert.deepEqual(propia.body.planes, [], "c2 no tiene planes: no ve los de c1");
  Object.assign(ctx, { clinicId: "c1", userId: "doc-c1" });
  ocultos.add("pac-c1");
  assert.equal((await GET(pedir(`/api/treatments/cuentas?patientId=pac-c1`, undefined, "GET"))).status, 404);
  ocultos.clear();
  ctx.permissionsOverride = ["treatments.view", "treatments.edit"];
  assert.equal((await GET(pedir(`/api/treatments/cuentas?patientId=pac-c1`, undefined, "GET"))).status, 403);
  ctx.permissionsOverride = null;
  assert.equal((await GET(pedir(`/api/treatments/cuentas?patientId=`, undefined, "GET"))).status, 400);
});

// ── Borrar un plan con nota ─────────────────────────────────────────────────

test("borrar un plan con nota: 409 (se ofrece cancelarlo) y el plan sigue; sin nota se borra como siempre", async (t) => {
  if (salta(t)) return;
  await usar();
  const conNota = await crearPlan();
  await aceptarPlan(conNota);
  const { DELETE, PATCH } = await import("@/app/api/treatments/[id]/route");
  const r = await leer(await DELETE(pedir(`/api/treatments/${conNota}`, undefined, "DELETE"), params(conNota)));
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "plan_con_nota");
  assert.equal(r.body.notas.length, 1);
  assert.equal((await base.db.query(`SELECT 1 FROM "treatment_plans" WHERE "id" = $1`, [conNota])).rows.length, 1, "el plan sigue");
  // La salida: cancelarlo (estado de siempre).
  const c = await PATCH(pedir(`/api/treatments/${conNota}`, { status: "ABANDONED" }, "PATCH"), params(conNota));
  assert.equal(c.status, 200);
  assert.equal((await base.db.query(`SELECT "status" FROM "treatment_plans" WHERE "id" = $1`, [conNota])).rows[0].status, "ABANDONED");
  assert.equal((await notas(conNota))[0].status, "PENDING", "la nota no cambia");
  // Con la nota CANCELADA en Facturación, ya no bloquea.
  await base.db.query(`UPDATE "invoices" SET "status" = 'CANCELLED' WHERE "treatmentPlanId" = $1`, [conNota]);
  assert.equal((await DELETE(pedir(`/api/treatments/${conNota}`, undefined, "DELETE"), params(conNota))).status, 200);
  // Sin nota: se borra.
  const sinNota = await crearPlan();
  assert.equal((await DELETE(pedir(`/api/treatments/${sinNota}`, undefined, "DELETE"), params(sinNota))).status, 200);
  // Revisión, hallazgo 7: la factura de su presupuesto (la vía de antes) también bloquea.
  const conPresupuesto = await crearPlan();
  await base.db.query(`INSERT INTO "invoices" ("id","clinicId","patientId","invoiceNumber","items","subtotal","total","balance") VALUES ('inv-q','c1','pac-c1','F-Q','[]',1,1,1)`);
  await base.db.query(`INSERT INTO "quotes" ("id","clinicId","patientId","folio","title","status","invoiceId","treatmentPlanId") VALUES ('q-viejo','c1','pac-c1','P-1','x','ACCEPTED','inv-q',$1)`, [conPresupuesto]);
  const r2 = await leer(await DELETE(pedir(`/api/treatments/${conPresupuesto}`, undefined, "DELETE"), params(conPresupuesto)));
  assert.deepEqual([r2.status, r2.body.notas], [409, ["F-Q"]]);
  // Otra clínica: 404 antes de mirar nada.
  Object.assign(ctx, { clinicId: "c2", userId: "doc-c2" });
  assert.equal((await DELETE(pedir(`/api/treatments/${conPresupuesto}`, undefined, "DELETE"), params(conPresupuesto))).status, 404);
});
