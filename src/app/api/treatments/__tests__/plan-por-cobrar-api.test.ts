/**
 * «POR COBRAR» = LO HECHO DEL PLAN (decisión de Rafael, 26-oct-2026), con los HANDLERS REALES contra un
 * Postgres en memoria (PGlite) con `sql/plan-tratamiento-filas.sql` pegado dos veces:
 *
 *  · plan aceptado → su nota NO sale en «Por cobrar» de Caja/Finanzas: sale en «Por hacer»;
 *  · lo hecho menos lo pagado sí, y vence a los 30 días de hecho;
 *  · nada impide cobrar: abonar más de lo hecho (adelanto → saldo a favor dentro del plan) y un cargo
 *    fuera del plan cuentan como siempre;
 *  · «Cerrar plan»: la nota se queda en lo hecho, lo pagado de más pasa a saldo a favor (crédito con su
 *    origen), las filas por hacer se cancelan (nada se borra), el plan pasa a Abandonado. Con motivo,
 *    permisos, la otra clínica y la nota timbrada.
 *
 * Run: PGLITE_DIR=<carpeta con node_modules/@electric-sql/pglite> npm run test:plan-por-cobrar
 *
 * Los dobles van por `Module._load`. ⛔ Nunca toca una base de verdad. Sin PGlite se SALTA diciéndolo.
 */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { NextRequest, NextResponse } from "next/server";
import { cargarPGlite, crearBase, type Base } from "@/lib/treatments/__tests__/arnes-pg";

let PGlite: (new () => any) | null = null;
let base: Base;
const prismaVivo: any = {};
const ctx: Record<string, any> = {};
const bitacora: any[] = [];
const mutaciones: any[] = [];

const dobles: Record<string, unknown> = {
  "server-only": {},
  "@/lib/prisma": { prisma: prismaVivo },
  "@/lib/auth-context": { getAuthContext: async () => ({ ...ctx }) },
  "@/lib/audit": { logAudit: async (a: unknown) => { bitacora.push(a); }, logMutation: async (m: unknown) => { mutaciones.push(m); }, extractAuditMeta: () => ({}) },
  "@/lib/patient-visibility": {
    assertPatientVisible: async () => null,
    relatedPatientVisibilityAnd: () => [],
    canSeePatient: () => true,
  },
  "@/lib/cache/revalidate": { revalidateAfter: () => undefined, revalidatePatientProfile: () => undefined },
  "next/cache": { revalidatePath: () => undefined, revalidateTag: () => undefined },
  // La nota nace sin anticipo (no hay saldo a favor previo en estas pruebas).
  "@/lib/patient-credit-aplicar": {
    aplicarSaldoAFavor: async () => ({ aplicado: 0, restanteAFavor: 0, factura: null, motivo: null }),
    anticipoDeLaFactura: async () => ({ aplicacionId: null, neto: 0, aplicaciones: [] }),
    partesDeDevolucion: (_a: unknown, monto: number) => (monto > 0 ? [{ id: null, monto }] : []),
  },
  "@/lib/quotes/ortodoncia.server": { casosDesdePresupuestos: async () => new Map() },
};
const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  return req in dobles ? dobles[req] : cargaOriginal.call(this, req, ...r);
};

const DDL_DINERO = `
  CREATE TABLE "payments" ("id" text PRIMARY KEY, "invoiceId" text NOT NULL, "amount" float8 NOT NULL, "method" text NOT NULL,
    "refundMethod" text, "reference" text, "notes" text, "paidAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE "patient_credits" ("id" text PRIMARY KEY, "clinicId" text NOT NULL, "patientId" text NOT NULL, "amount" float8 NOT NULL,
    "description" text, "source" text NOT NULL DEFAULT 'migrated', "creditDate" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "invoiceId" text, "paymentId" text UNIQUE, "reversesId" text UNIQUE,
    "createdById" text);
`;

async function usar() {
  base = await crearBase(PGlite!);
  await base.db.exec(DDL_DINERO);
  for (const k of Object.keys(prismaVivo)) delete prismaVivo[k];
  Object.assign(prismaVivo, base.prisma);
  (await import("@/lib/treatments/items-db"))._olvidarSondas();
  (await import("@/lib/quotes/aceptacion-db"))._olvidarTablas();
  (await import("@/lib/invoices/condiciones-pago-db"))._olvidarTabla();
  await base.db.query(`INSERT INTO "procedure_catalog" VALUES ('proc-r','c1','Resina',1250.5,true), ('proc-l','c1','Limpieza',800,true)`);
  bitacora.length = 0;
  mutaciones.length = 0;
}

const pedir = (url: string, body?: unknown, method = "POST") =>
  new NextRequest(`http://x${url}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const leer = async (r: Response) => ({ status: r.status, body: await r.json() });
const notas = async (planId: string) => (await base.db.query(`SELECT * FROM "invoices" WHERE "treatmentPlanId" = $1 ORDER BY "createdAt"`, [planId])).rows;
const filas = async (planId: string) => (await base.db.query(`SELECT * FROM "treatment_plan_items" WHERE "planId" = $1 ORDER BY "orden"`, [planId])).rows;

// Resina $1,250.50 + Limpieza $800 = $2,050.50
const ITEMS = [
  { nombre: "Resina", procedureId: "proc-r", dientes: "16", caras: "MO", precio: "1250.50", fase: "restauradora", motivo: "Caries" },
  { nombre: "Limpieza", procedureId: "proc-l", precio: 800, fase: "higienica" },
];

before(async () => {
  PGlite = await cargarPGlite();
});

beforeEach(() => {
  Object.assign(ctx, { clinicId: "c1", userId: "doc-c1", role: "ADMIN", isDoctor: false, permissionsOverride: null });
});

const salta = (t: { skip: (m: string) => void }) => {
  if (!PGlite) {
    t.skip("PGlite no está: pasa PGLITE_DIR=<carpeta con node_modules/@electric-sql/pglite>");
    return true;
  }
  return false;
};

async function planAceptado(): Promise<{ planId: string; notaId: string }> {
  const { POST } = await import("@/app/api/treatments/route");
  const r = await leer(await POST(pedir("/api/treatments", { patientId: "pac-c1", name: "Plan Ana", description: "▸ texto", items: ITEMS })));
  assert.equal(r.status, 201);
  const planId = r.body.id as string;
  const { POST: ACEPTAR } = await import("@/app/api/treatments/[id]/nota-de-cobro/route");
  const a = await leer(await ACEPTAR(pedir(`/api/treatments/${planId}/nota-de-cobro`), params(planId)));
  assert.equal(a.status, 201);
  return { planId, notaId: a.body.nota.id };
}

/** Marca hecha la fila de ese nombre, hace `dias` días. */
async function hecho(planId: string, nombre: string, dias: number) {
  const en = new Date(Date.now() - dias * 86_400_000);
  await base.db.query(`UPDATE "treatment_plan_items" SET "estado" = 'hecho', "hechoEn" = $3 WHERE "planId" = $1 AND "nombre" = $2`, [planId, nombre, en]);
}

/** Un abono como lo deja «Registrar pago»: el Payment y la factura al día. */
async function pagar(notaId: string, monto: number, id = `pago-${Math.random()}`) {
  await base.db.query(`INSERT INTO "payments" ("id", "invoiceId", "amount", "method", "paidAt") VALUES ($1, $2, $3, 'cash', $4)`, [id, notaId, monto, new Date()]);
  await base.db.query(
    `UPDATE "invoices" SET "paid" = "paid" + $2, "balance" = GREATEST(0, "total" - ("paid" + $2)),
       "status" = CASE WHEN "total" - ("paid" + $2) <= 0 THEN 'PAID'::"InvoiceStatus" ELSE 'PARTIAL'::"InvoiceStatus" END WHERE "id" = $1`,
    [notaId, monto],
  );
  return id;
}

/** `computeReceivables` contra la base en memoria (las facturas por cobrar, en una tanda). */
async function saldos(clinicId = "c1") {
  const { computeReceivables } = await import("@/lib/caja");
  const db = {
    invoice: {
      findMany: async (a: any = {}) =>
        a?.select?.payments
          // Los cobros de las facturas a plazos (A9: el calendario de una nota financiada).
          ? Promise.all((a.where?.id?.in ?? []).map(async (id: string) => ({
              id,
              payments: (await base.db.query(`SELECT "amount", "method" FROM "payments" WHERE "invoiceId" = $1`, [id])).rows,
            })))
          : (await base.db.query(
              `SELECT "id", "balance", "dueDate", "total", "createdAt" FROM "invoices"
                WHERE "clinicId" = $1 AND "status"::text NOT IN ('DRAFT', 'CANCELLED') AND "balance" > 0 ORDER BY "id"`,
              [clinicId],
            )).rows,
      aggregate: async () => ({ _sum: {} }),
    },
    clinic: { findUnique: async () => ({ timezone: "America/Mexico_City" }) },
    $queryRaw: prismaVivo.$queryRaw,
  };
  return computeReceivables(clinicId, new Date(), db as any, async () => new Map());
}

async function cuenta(planId: string) {
  const { GET } = await import("@/app/api/treatments/cuentas/route");
  const r = await leer(await GET(pedir(`/api/treatments/cuentas?patientId=pac-c1`, undefined, "GET")));
  assert.equal(r.status, 200);
  return r.body.planes.find((p: any) => p.planId === planId);
}

async function cerrar(planId: string, motivo: unknown = "El paciente ya no continuará", extra: Record<string, unknown> = {}) {
  const { POST } = await import("@/app/api/treatments/[id]/cerrar/route");
  return leer(await POST(pedir(`/api/treatments/${planId}/cerrar`, { motivo, ...extra }), params(planId)));
}

// ── «Por cobrar» = lo hecho ─────────────────────────────────────────────────

test("plan aceptado y sin hacer: Caja/Finanzas no lo cuentan como «Por cobrar»; la ficha dice Debe $0 y Por hacer $2,050.50", async (t) => {
  if (salta(t)) return;
  await usar();
  const { planId, notaId } = await planAceptado();
  const s = await saldos();
  assert.equal(s.porCobrar, 0);
  assert.equal(s.vencido, 0);
  assert.equal(s.porHacer, 2050.5);
  assert.deepEqual(s.porHacerPorFactura, { [notaId]: 2050.5 });
  const c = await cuenta(planId);
  assert.equal(c.aceptado, 2050.5);
  assert.equal(c.hecho, 0);
  assert.equal(c.pagado, 0);
  assert.equal(c.debe, 0);
  assert.equal(c.porHacer, 2050.5);
  assert.equal(c.saldo, 2050.5, "lo que se puede abonar no cambia: se puede pagar por adelantado");
  // La otra clínica no ve nada de esto.
  assert.equal((await saldos("c2")).porCobrar, 0);
});

test("hecha la resina hace 40 días y abonados $500: «Por cobrar» $750.50, todo vencido; la limpieza sigue por hacer", async (t) => {
  if (salta(t)) return;
  await usar();
  const { planId, notaId } = await planAceptado();
  await hecho(planId, "Resina", 40);
  await pagar(notaId, 500);
  const s = await saldos();
  assert.equal(s.porCobrar, 750.5);
  assert.equal(s.vencido, 750.5);
  assert.equal(s.porHacer, 800);
  const c = await cuenta(planId);
  assert.equal(c.hecho, 1250.5);
  assert.equal(c.pagado, 500);
  assert.equal(c.debe, 750.5);
  assert.equal(c.vencido, 750.5);
  assert.equal(c.porHacer, 800);
});

test("nada impide cobrar: un abono mayor a lo hecho es un adelanto (saldo a favor del plan) y un cargo fuera del plan se cuenta como siempre", async (t) => {
  if (salta(t)) return;
  await usar();
  const { planId, notaId } = await planAceptado();
  await hecho(planId, "Resina", 2);
  // «Cobrar hoy» deja abonar hasta el saldo de la nota (lo aceptado), no solo lo hecho.
  const { abonoAlPlan } = await import("@/lib/invoices/cobrar-hoy");
  const [n] = await notas(planId);
  const vista = abonoAlPlan([{ invoiceId: n.id, invoiceNumber: n.invoiceNumber, status: n.status, total: n.total, paid: n.paid, createdAt: n.createdAt }], "2000");
  assert.equal(vista.falta, null, "abonar $2,000 con $1,250.50 hecho está permitido");
  assert.equal(vista.abonado, 2000);
  await pagar(notaId, 2000);
  const c = await cuenta(planId);
  assert.equal(c.debe, 0);
  assert.equal(c.saldoAFavor, 749.5);
  assert.equal(c.porHacer, 800);
  // Un cargo extra fuera del plan (nota nueva de siempre): entero en «Por cobrar».
  await base.db.query(
    `INSERT INTO "invoices" ("id", "clinicId", "patientId", "invoiceNumber", "items", "subtotal", "total", "balance", "status")
     VALUES ('extra', 'c1', 'pac-c1', 'F-EXTRA', '[{"name":"Blanqueamiento","quantity":1,"unitPrice":3000}]', 3000, 3000, 3000, 'PENDING')`,
  );
  const s = await saldos();
  assert.equal(s.porCobrar, 3000, "el plan no debe nada; el blanqueamiento sí");
  assert.equal(s.porHacer, 50.5, "de la nota: saldo $50.50, todo de lo que falta hacer");
  // Y «Cobrar hoy» sigue ofreciendo la nota nueva para lo de fuera del plan.
  const { modoInicialCobroHoy } = await import("@/lib/treatments/sin-doble-cobro");
  assert.equal(modoInicialCobroHoy([c]).modo, "abono", "el plan aún tiene saldo por abonar (adelanto de la limpieza)");
});

// ── Cerrar plan ────────────────────────────────────────────────────────────

test("cerrar plan con adelanto: la nota se queda en lo hecho, lo de más queda como saldo a favor con su origen, las filas por hacer se cancelan", async (t) => {
  if (salta(t)) return;
  await usar();
  const { planId, notaId } = await planAceptado();
  await hecho(planId, "Resina", 5);
  const pago = await pagar(notaId, 2000, "pago-2000");

  const r = await cerrar(planId);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.saldoAFavor, 749.5);
  assert.equal(r.body.filasCanceladas, 1);

  const [n] = await notas(planId);
  assert.deepEqual(n.items.map((it: any) => it.description), ["Resina (16)"]);
  assert.equal(n.total, 1250.5);
  assert.equal(n.paid, 1250.5);
  assert.equal(n.balance, 0);
  assert.equal(n.status, "PAID");
  const pagos = (await base.db.query(`SELECT * FROM "payments" WHERE "invoiceId" = $1 ORDER BY "paidAt"`, [notaId])).rows;
  const traspaso = pagos.find((p: any) => p.method === "refund");
  assert.equal(traspaso.amount, 749.5);
  assert.equal(traspaso.refundMethod, "saldo_a_favor", "no sale dinero de caja: es un traspaso");
  const creditos = (await base.db.query(`SELECT * FROM "patient_credits"`)).rows;
  assert.equal(creditos.length, 1);
  assert.equal(creditos[0].amount, 749.5);
  assert.equal(creditos[0].source, "excedente_de_cobro");
  assert.equal(creditos[0].paymentId, pago, "dice de qué cobro vino (su CFDI ya lo ampara)");
  assert.equal(creditos[0].clinicId, "c1");
  assert.equal(creditos[0].patientId, "pac-c1");

  const fs = await filas(planId);
  const limpieza = fs.find((f: any) => f.nombre === "Limpieza");
  assert.equal(limpieza.estado, "cancelado", "nada se borra: la fila queda cancelada");
  assert.equal(limpieza.invoiceId, null);
  assert.equal(limpieza.canceladoPor, "doc-c1");
  const resina = fs.find((f: any) => f.nombre === "Resina");
  assert.equal(resina.estado, "hecho");
  assert.equal(resina.invoiceLinea, 0);
  assert.equal(fs.length, 2, "ninguna fila borrada");

  const plan = (await base.db.query(`SELECT "status"::text AS "status" FROM "treatment_plans" WHERE "id" = $1`, [planId])).rows[0];
  assert.equal(plan.status, "ABANDONED");
  // Bitácora: la nota y el plan, con el motivo.
  assert.ok(bitacora.some((b) => b.entityType === "invoice" && b.entityId === notaId && /Limpieza/.test(b.texto) && /ya no continuará/.test(b.texto)));
  assert.ok(bitacora.some((b) => b.entityType === "treatment" && b.entityId === planId && b.changes.status.after === "ABANDONED"));

  // Ya cerrado: un segundo cierre no cambia nada (ni dinero, ni filas, ni bitácora) — revisión t5, A7.
  const filasDeBitacora = bitacora.length;
  const otra = await cerrar(planId);
  assert.equal(otra.status, 200);
  assert.equal(otra.body.estado, "ya_cerrado");
  assert.equal(otra.body.saldoAFavor, 0);
  assert.equal(otra.body.filasCanceladas, 0);
  assert.equal(bitacora.length, filasDeBitacora, "sin filas nuevas en Movimientos");
  assert.equal((await base.db.query(`SELECT * FROM "patient_credits"`)).rows.length, 1);

  // Caja: ya no queda nada de ese plan por cobrar ni por hacer.
  const s = await saldos();
  assert.equal(s.porCobrar, 0);
  assert.equal(s.porHacer, 0);
});

test("cerrar plan debiendo: la nota baja a lo hecho y sigue debiendo; nada a favor", async (t) => {
  if (salta(t)) return;
  await usar();
  const { planId, notaId } = await planAceptado();
  await hecho(planId, "Limpieza", 3);
  await pagar(notaId, 300);
  const r = await cerrar(planId);
  assert.equal(r.status, 200);
  assert.equal(r.body.saldoAFavor, 0);
  const [n] = await notas(planId);
  assert.equal(n.total, 800);
  assert.equal(n.balance, 500);
  assert.equal(n.status, "PARTIAL");
  assert.equal((await base.db.query(`SELECT * FROM "patient_credits"`)).rows.length, 0);
  assert.equal((await saldos()).porCobrar, 500);
});

test("cerrar plan sin nada hecho: la nota se cancela y todo lo pagado queda a favor", async (t) => {
  if (salta(t)) return;
  await usar();
  const { planId, notaId } = await planAceptado();
  await pagar(notaId, 1000);
  const r = await cerrar(planId);
  assert.equal(r.status, 200);
  assert.equal(r.body.saldoAFavor, 1000);
  const [n] = await notas(planId);
  assert.equal(n.status, "CANCELLED");
  assert.equal(n.paid, 0);
  assert.equal(n.items.length, 2, "sus conceptos se quedan como registro");
  assert.equal((await filas(planId)).filter((f: any) => f.estado === "cancelado").length, 2);
});

test("cerrar plan: motivo obligatorio, permisos, doctor ajeno, la otra clínica y la nota timbrada", async (t) => {
  if (salta(t)) return;
  await usar();
  const { planId, notaId } = await planAceptado();
  assert.equal((await cerrar(planId, "")).status, 400);
  assert.equal((await cerrar(planId, null)).status, 400);
  Object.assign(ctx, { role: "RECEPTIONIST", permissionsOverride: ["treatments.view", "treatments.edit", "billing.view"] });
  assert.equal((await cerrar(planId)).status, 403, "sin billing.edit no se cambia la nota");
  Object.assign(ctx, { role: "DOCTOR", userId: "otro-doc", isDoctor: true, permissionsOverride: null });
  const ajeno = await cerrar(planId);
  assert.ok(ajeno.status === 403, `el doctor de otro plan no lo cierra (${ajeno.status})`);
  Object.assign(ctx, { clinicId: "c2", userId: "doc-c2", role: "ADMIN", isDoctor: false });
  assert.equal((await cerrar(planId)).status, 404, "la otra clínica no lo encuentra");
  Object.assign(ctx, { clinicId: "c1", userId: "doc-c1" });
  await base.db.query(`UPDATE "invoices" SET "cfdiUuid" = 'UUID-1' WHERE "id" = $1`, [notaId]);
  const timbrada = await cerrar(planId);
  assert.equal(timbrada.status, 409);
  assert.equal(timbrada.body.code, "nota_timbrada");
  const plan = (await base.db.query(`SELECT "status"::text AS "status" FROM "treatment_plans" WHERE "id" = $1`, [planId])).rows[0];
  assert.equal(plan.status, "ACTIVE", "con la nota timbrada no se cierra nada");
  assert.equal((await filas(planId)).filter((f: any) => f.estado === "cancelado").length, 0);
});

test("lo que aún no se debe (v3: Pacientes, ficha, Reportes, Inbox, portal): de la nota del plan, lo por hacer; las demás facturas, enteras", async (t) => {
  if (salta(t)) return;
  await usar();
  const { planId, notaId } = await planAceptado();
  await hecho(planId, "Resina", 2);
  await pagar(notaId, 500);
  await base.db.query(
    `INSERT INTO "invoices" ("id", "clinicId", "patientId", "invoiceNumber", "items", "subtotal", "total", "balance", "status")
     VALUES ('extra', 'c1', 'pac-c1', 'F-EXTRA', '[]', 3000, 3000, 3000, 'PENDING')`,
  );
  const { loQueAunNoSeDebe, candidatasNoExigibles } = await import("@/lib/dinero/lo-que-se-debe.server");
  assert.deepEqual(await candidatasNoExigibles("c1"), [notaId], "solo la nota del plan es candidata");
  // v4 (t5, sospecha 3): con ids, solo esas (en el propio SQL), no las de toda la clínica.
  assert.deepEqual(await candidatasNoExigibles("c1", ["extra"]), []);
  assert.deepEqual(await candidatasNoExigibles("c1", [notaId, "extra"]), [notaId]);
  assert.deepEqual(await candidatasNoExigibles("c1", []), []);
  const r = await loQueAunNoSeDebe("c1", { ids: [notaId, "extra"], timezone: "America/Mexico_City" });
  assert.deepEqual(r.porFactura, { [notaId]: 800 }, "saldo del paciente que se debe = 1,550.50 − 800 + 3,000");
  assert.equal(r.porHacer, 800);
  assert.equal(r.porVencer, 0);
  // Con el tenant de otra clínica no encuentra la nota.
  assert.equal((await loQueAunNoSeDebe("c2", { ids: [notaId] })).total, 0);
  // Y la cuenta del plan dice lo mismo (debe 750.50 = 1,550.50 − 800).
  const c = await cuenta(planId);
  assert.equal(c.debe, 750.5);
});

test("v7/v8: «Estado de cuenta» de la ficha — debe lo de la Cuenta del plan; «además por hacer» = su «Por hacer», y de eso lo ya pagado (no es saldo a favor)", async (t) => {
  if (salta(t)) return;
  await usar();
  const { planId, notaId } = await planAceptado();
  const { GET } = await import("@/app/api/patients/[id]/lo-que-aun-no-se-debe/route");
  const ficha = async (clinicId = "c1") => {
    ctx.clinicId = clinicId;
    return leer(await GET(pedir("/api/patients/pac-c1/lo-que-aun-no-se-debe", undefined, "GET"), params("pac-c1")));
  };
  // Lo que pinta la ficha: la suma de saldos de sus notas menos lo que aún no se debe.
  const debe = async (body: { total: number }) => {
    const saldo = (await notas(planId)).reduce((s, n) => s + Number(n.balance), 0);
    return Math.max(0, Math.round((saldo - body.total) * 100) / 100);
  };
  // v8 (t5, V1): «Además, $X por hacer» = lo por hacer sin pagar + lo ya pagado de eso = el «Por hacer» de la cuenta.
  const porHacerCompleto = (body: { total: number; adelanto: number }) => Math.round((body.total + body.adelanto) * 100) / 100;

  // Plan aceptado, nada hecho: antes pintaba $2,050.50 en rojo.
  let r = await ficha();
  assert.equal(r.status, 200);
  assert.equal(await debe(r.body), 0);
  assert.equal(r.body.adelanto, 0);
  assert.equal(porHacerCompleto(r.body), (await cuenta(planId)).porHacer);

  // Hecha la limpieza ($800): debe $800, como la Cuenta del plan.
  await hecho(planId, "Limpieza", 1);
  r = await ficha();
  assert.equal(await debe(r.body), 800);
  assert.equal((await cuenta(planId)).debe, 800);
  assert.equal(porHacerCompleto(r.body), 1250.5);

  // Paga $1,000: debe $0; por hacer $1,250.50 (lo mismo que la cuenta), de los que $200 ya están pagados.
  await pagar(notaId, 1000);
  r = await ficha();
  assert.equal(await debe(r.body), 0);
  assert.equal(r.body.adelanto, 200);
  assert.equal(porHacerCompleto(r.body), 1250.5);
  assert.equal(porHacerCompleto(r.body), (await cuenta(planId)).porHacer);

  // Paga todo lo aceptado: la nota queda saldada y el adelanto se sigue viendo.
  await pagar(notaId, 1050.5);
  r = await ficha();
  assert.equal(r.body.total, 0);
  assert.equal(r.body.adelanto, 1250.5);
  assert.equal(porHacerCompleto(r.body), (await cuenta(planId)).porHacer);

  // Al cerrar el plan, lo de más pasa al libro de saldo a favor: aquí ya no se cuenta dos veces.
  ctx.clinicId = "c1";
  assert.equal((await cerrar(planId)).status, 200);
  r = await ficha();
  assert.equal(r.body.adelanto, 0);

  // La otra clínica no ve al paciente.
  assert.equal((await ficha("c2")).status, 404);
});

// ── A9 (27-oct): nota de plan con cuotas acordadas → manda la mensualidad acordada ───────────────────

/** Forma de pago «a plazos» en la nota, como la guarda el editor (`invoice_payment_terms`). */
async function conCuotas(notaId: string, args: { numPagos: number; primerPago: string }) {
  await base.db.exec(`
    CREATE TABLE IF NOT EXISTS "invoice_payment_terms" ("invoiceId" text PRIMARY KEY REFERENCES "invoices"("id"),
      "modo" text NOT NULL DEFAULT 'unico', "metodo" text, "enganche" numeric(10,2) NOT NULL DEFAULT 0,
      "numPagos" integer NOT NULL DEFAULT 0, "frecuencia" text NOT NULL DEFAULT 'MONTHLY', "primerPago" date,
      "difiereConSuBanco" boolean NOT NULL DEFAULT false);`);
  await base.db.query(
    `INSERT INTO "invoice_payment_terms" ("invoiceId", "modo", "enganche", "numPagos", "frecuencia", "primerPago") VALUES ($1, 'plazos', 0, $2, 'MONTHLY', $3)`,
    [notaId, args.numPagos, args.primerPago],
  );
  (await import("@/lib/invoices/condiciones-pago-db"))._olvidarTabla();
}

/** Lo que contesta el bot «¿cuánto debo?» (la misma lectura que el WhatsApp de cobranza), contra esta base. */
async function loQueDiceElBot(hoy: string) {
  const { resumenDeSaldoDePaciente } = await import("@/lib/whatsapp/cobranza/datos");
  const invoiceDePrueba = prismaVivo.invoice;
  const ortoDePrueba = prismaVivo.orthodonticTreatmentPlan;
  // El doble de la base no sabe filtrar por relación (`patient: { deletedAt: null }`): la misma consulta, a mano.
  prismaVivo.invoice = {
    ...invoiceDePrueba,
    findMany: async (a: any) => {
      const filas = (await base.db.query(
        `SELECT "id", "status"::text AS "status", "total", "patientId" FROM "invoices"
          WHERE "clinicId" = $1 AND "patientId" = $2 AND "status"::text IN ('PENDING', 'PARTIAL', 'OVERDUE') ORDER BY "createdAt"`,
        [a.where.clinicId, a.where.patientId],
      )).rows;
      return Promise.all(filas.map(async (f: any) => ({
        ...f,
        patient: { firstName: "Ana", lastName: "", phone: "5512345678", status: "ACTIVE", deletedAt: null },
        payments: (await base.db.query(`SELECT "amount", "method" FROM "payments" WHERE "invoiceId" = $1`, [f.id])).rows,
      })));
    },
  };
  prismaVivo.orthodonticTreatmentPlan = { findMany: async () => [] };
  try {
    return await resumenDeSaldoDePaciente("c1", "pac-c1", hoy);
  } finally {
    prismaVivo.invoice = invoiceDePrueba;
    prismaVivo.orthodonticTreatmentPlan = ortoDePrueba;
  }
}

test("A9: nota con cuotas acordadas — Caja, ficha, Cuenta del plan, bot y link de pago dicen la cuota vencida, no lo hecho", async (t) => {
  if (salta(t)) return;
  await usar();
  const { hoyEnZona } = await import("@/lib/fechas/hoy-en-zona");
  const { leerCondicionesDeFacturas } = await import("@/lib/invoices/condiciones-pago-db");
  const { montoSugeridoDeCobro } = await import("@/lib/invoices/plan-de-pagos");
  const { montoParaLink } = await import("@/lib/factura-mp/core");
  const { loQueAunNoSeDebe } = await import("@/lib/dinero/lo-que-se-debe.server");
  const { GET: FICHA } = await import("@/app/api/patients/[id]/lo-que-aun-no-se-debe/route");
  const ZONA = "America/Mexico_City";
  const hoy = hoyEnZona(new Date(), ZONA);
  // El doble de la base no trae los cobros de una factura (`payments`); el calendario los necesita.
  const invoiceDePrueba = prismaVivo.invoice;
  prismaVivo.invoice = {
    ...invoiceDePrueba,
    findMany: async (a: any = {}) => {
      const filas = await invoiceDePrueba.findMany(a);
      if (!a?.select?.payments) return filas;
      return Promise.all(filas.map(async (f: any) => ({
        ...f,
        payments: (await base.db.query(`SELECT "amount", "method" FROM "payments" WHERE "invoiceId" = $1`, [f.id])).rows,
      })));
    },
  };
  const { planId, notaId } = await planAceptado();
  // $2,050.50 en 3 mensualidades de $683.50; la primera hace 40 días: dos ya vencieron ($1,367), la tercera no.
  await conCuotas(notaId, { numPagos: 3, primerPago: hoyEnZona(new Date(Date.now() - 40 * 86_400_000), ZONA) });

  /** Las cifras de todas las pantallas y mensajes, para compararlas de una vez. */
  const todas = async () => {
    const s = await saldos();
    const c = await cuenta(planId);
    const r = await loQueAunNoSeDebe("c1", { ids: [notaId] });
    const ficha = await leer(await FICHA(pedir("/api/patients/pac-c1/lo-que-aun-no-se-debe", undefined, "GET"), params("pac-c1")));
    const [nota] = await notas(planId);
    const saldo = Number(nota.balance);
    const bot = await loQueDiceElBot(hoy);
    const cond = (await leerCondicionesDeFacturas(prismaVivo, { clinicId: "c1", invoiceIds: [notaId] })).porFactura.get(notaId);
    const link = montoParaLink({ sugerido: montoSugeridoDeCobro(cond, Number(nota.total), Number(nota.paid), hoy), saldo, noSeDebe: r.porFactura[notaId] ?? 0 });
    return {
      caja: s.porCobrar,
      cajaVencido: s.vencido,
      cuenta: c.debe,
      cuentaVencido: c.vencido,
      ficha: Math.round((saldo - ficha.body.total) * 100) / 100,
      portal: Math.round((saldo - (r.porFactura[notaId] ?? 0)) * 100) / 100,
      bot: bot?.vencido,
      link: "monto" in link ? link.monto : 0,
      porVencer: { caja: s.porVencerCuotas, ficha: r.porVencer },
      aCuotas: c.aCuotas,
    };
  };
  const misma = (x: Awaited<ReturnType<typeof todas>>, cifra: number, porVencer: number) => {
    assert.deepEqual(
      { caja: x.caja, cajaVencido: x.cajaVencido, cuenta: x.cuenta, cuentaVencido: x.cuentaVencido, ficha: x.ficha, portal: x.portal, bot: x.bot, link: x.link },
      { caja: cifra, cajaVencido: cifra, cuenta: cifra, cuentaVencido: cifra, ficha: cifra, portal: cifra, bot: cifra, link: cifra },
    );
    assert.deepEqual(x.porVencer, { caja: porVencer, ficha: porVencer });
    assert.equal(x.aCuotas, true);
  };

  // Nada hecho ni pagado: por lo hecho no debería nada; con cuotas acordadas debe las dos vencidas.
  misma(await todas(), 1367, 683.5);
  const c0 = await cuenta(planId);
  assert.equal(c0.hecho, 0);
  assert.equal(c0.porHacer, 2050.5, "lo por hacer sigue diciendo cómo va el tratamiento");

  // Hecha la resina y abonados $500: por lo hecho serían $750.50; manda la cuota: $1,367 − $500.
  await hecho(planId, "Resina", 2);
  await pagar(notaId, 500);
  misma(await todas(), 867, 683.5);

  // Al cerrar el plan la nota baja a lo hecho ($1,250.50) y las cuotas siguen: 416.84 + 416.83 vencidas − 500.
  assert.equal((await cerrar(planId)).status, 200);
  const x = await todas();
  assert.equal(x.caja, 333.67);
  assert.equal(x.cuenta, 333.67);
  assert.equal(x.bot, 333.67);
  assert.equal(x.ficha, 333.67);

  // La otra clínica no ve nada de esto.
  assert.equal((await saldos("c2")).porCobrar, 0);
  assert.equal((await loQueAunNoSeDebe("c2", { ids: [notaId] })).total, 0);
});

test("v12 · m1: «Además» de la ficha — con cuotas, solo lo que aún no vence y sin «ya pagados»; sin cuotas, el «Por hacer» de la tarjeta (v8)", async (t) => {
  if (salta(t)) return;
  await usar();
  const { hoyEnZona } = await import("@/lib/fechas/hoy-en-zona");
  const { GET: FICHA } = await import("@/app/api/patients/[id]/lo-que-aun-no-se-debe/route");
  const invoiceDePrueba = prismaVivo.invoice;
  prismaVivo.invoice = {
    ...invoiceDePrueba,
    findMany: async (a: any = {}) => {
      const filas = await invoiceDePrueba.findMany(a);
      if (!a?.select?.payments) return filas;
      return Promise.all(filas.map(async (f: any) => ({
        ...f,
        payments: (await base.db.query(`SELECT "amount", "method" FROM "payments" WHERE "invoiceId" = $1`, [f.id])).rows,
      })));
    },
  };
  // Plan A con 3 mensualidades (2 vencidas) y $500; plan B sin cuotas y $300. Nada hecho en ninguno.
  const A = await planAceptado();
  await conCuotas(A.notaId, { numPagos: 3, primerPago: hoyEnZona(new Date(Date.now() - 40 * 86_400_000), "America/Mexico_City") });
  await pagar(A.notaId, 500);
  const B = await planAceptado();
  await pagar(B.notaId, 300);
  const r = await leer(await FICHA(pedir("/api/patients/pac-c1/lo-que-aun-no-se-debe", undefined, "GET"), params("pac-c1")));
  assert.equal(r.status, 200);
  // Lo que pinta la ficha (patient-detail-client): «Además, $X por hacer…», «De lo por hacer, $Y ya pagados»
  // y «Además, $Z de cuotas que aún no vencen».
  const cuotas = Math.min(r.body.total, r.body.porVencerCuotas);
  const porHacerCompleto = Math.round((r.body.total - cuotas + r.body.adelanto) * 100) / 100;
  assert.equal(cuotas, 683.5, "plan A: $1,550.50 de saldo − $867 vencidos");
  assert.equal(r.body.adelanto, 300, "solo el plan sin cuotas: los $500 del plan A no son «ya pagados» de lo por hacer");
  // v15 (t5 de la v14, M1-b): los $500 del plan A van aparte, como la tarjeta («ya están pagados por adelantado sobre lo hecho»).
  assert.equal(r.body.adelantoCuotas, 500);
  assert.equal(r.body.adelantoCuotas, (await cuenta(A.planId)).saldoAFavor);
  assert.equal(porHacerCompleto, (await cuenta(B.planId)).porHacer, "sin cuotas, como v8: el «Por hacer» de su tarjeta");
  assert.equal(porHacerCompleto, 2050.5);
  // Y lo que se debe no cambia: plan A debe la cuota vencida, el B nada.
  const saldo = (await notas(A.planId)).concat(await notas(B.planId)).reduce((x, n) => x + Number(n.balance), 0);
  assert.equal(Math.round((saldo - r.body.total) * 100) / 100, 867);
});

test("A9: sin cuotas acordadas (un solo pago) sigue la regla de lo hecho", async (t) => {
  if (salta(t)) return;
  await usar();
  const { planId, notaId } = await planAceptado();
  await base.db.exec(`CREATE TABLE IF NOT EXISTS "invoice_payment_terms" ("invoiceId" text PRIMARY KEY, "modo" text NOT NULL DEFAULT 'unico',
    "metodo" text, "enganche" numeric(10,2) NOT NULL DEFAULT 0, "numPagos" integer NOT NULL DEFAULT 0, "frecuencia" text NOT NULL DEFAULT 'MONTHLY',
    "primerPago" date, "difiereConSuBanco" boolean NOT NULL DEFAULT false);`);
  await base.db.query(`INSERT INTO "invoice_payment_terms" ("invoiceId", "modo", "metodo") VALUES ($1, 'unico', 'cash')`, [notaId]);
  (await import("@/lib/invoices/condiciones-pago-db"))._olvidarTabla();
  await hecho(planId, "Resina", 2);
  await pagar(notaId, 500);
  const s = await saldos();
  assert.equal(s.porCobrar, 750.5);
  assert.equal(s.porVencerCuotas, 0);
  const c = await cuenta(planId);
  assert.equal(c.debe, 750.5);
  assert.equal(c.aCuotas, false);
});

// ── v11 (27-oct): «Hecho» desde la tarjeta del plan ───────────────────────────────────────────────

/** Lo que manda la tarjeta: el mismo PATCH que «Completar consulta». */
async function hechoDesdeLaTarjeta(planId: string, cuerpo: Record<string, unknown>) {
  // El tarifario de la base de prueba no trae `code` (el que dice qué pinta el procedimiento en el odontograma).
  await base.db.exec(`ALTER TABLE "procedure_catalog" ADD COLUMN IF NOT EXISTS "code" text`);
  const { PATCH } = await import("@/app/api/treatments/[id]/route");
  return leer(await PATCH(pedir(`/api/treatments/${planId}`, cuerpo, "PATCH"), params(planId)));
}
const filaDe = async (planId: string, nombre: string) => (await filas(planId)).find((f: any) => f.nombre === nombre);

test("v11: «Hecho» desde la tarjeta — Debe sube al momento, con bitácora; «Deshacer» la regresa y la deuda baja (ficha, Caja, portal igual)", async (t) => {
  if (salta(t)) return;
  await usar();
  const { loQueAunNoSeDebe } = await import("@/lib/dinero/lo-que-se-debe.server");
  const { planId, notaId } = await planAceptado();
  await pagar(notaId, 500);
  const resina = await filaDe(planId, "Resina");
  const todas = async () => {
    const r = await loQueAunNoSeDebe("c1", { ids: [notaId] });
    const [nota] = await notas(planId);
    return { cuenta: (await cuenta(planId)).debe, caja: (await saldos()).porCobrar, ficha: Math.round((Number(nota.balance) - r.total) * 100) / 100 };
  };
  assert.deepEqual(await todas(), { cuenta: 0, caja: 0, ficha: 0 }, "nada hecho: no debe nada (pagó $500 por adelantado)");

  const r = await hechoDesdeLaTarjeta(planId, { action: "marcar_hecho", itemIds: [resina.id] });
  assert.equal(r.status, 200);
  assert.equal(r.body.items.find((f: any) => f.id === resina.id).estado, "hecho");
  // Debe = lo hecho − lo pagado = 1,250.50 − 500, en todas partes.
  assert.deepEqual(await todas(), { cuenta: 750.5, caja: 750.5, ficha: 750.5 });
  const fila = await filaDe(planId, "Resina");
  assert.equal(fila.estado, "hecho");
  assert.equal(fila.hechoPor, "doc-c1", "quién");
  assert.ok(fila.hechoEn instanceof Date, "cuándo");
  assert.match(mutaciones.at(-1).texto, /Marcó como hecho en el plan «Plan Ana»: Resina 16 \(MO\)/);

  const d = await hechoDesdeLaTarjeta(planId, { action: "deshacer_hecho", itemId: resina.id });
  assert.equal(d.status, 200);
  assert.equal(d.body.estado, "pendiente");
  assert.deepEqual(await todas(), { cuenta: 0, caja: 0, ficha: 0 }, "deshecho: la deuda baja");
  assert.equal((await filaDe(planId, "Resina")).estado, "pendiente");
  assert.match(mutaciones.at(-1).texto, /Deshizo «hecho» en el plan «Plan Ana»: Resina 16 \(MO\)/);
});

test("v11: quién puede — treatments.edit (v17: también en el plan de otro doctor) y SUPER_ADMIN siempre; recepción sin el permiso no", async (t) => {
  if (salta(t)) return;
  await usar();
  const { planId } = await planAceptado();
  const resina = await filaDe(planId, "Resina");
  const marcar = () => hechoDesdeLaTarjeta(planId, { action: "marcar_hecho", itemIds: [resina.id] });
  const deshacer = () => hechoDesdeLaTarjeta(planId, { action: "deshacer_hecho", itemId: resina.id });

  // Recepción a la que la clínica le quitó «Crear y editar planes»: no.
  Object.assign(ctx, { userId: "rec-c1", role: "RECEPTIONIST", isDoctor: false, permissionsOverride: ["treatments.view", "billing.view"] });
  assert.equal((await marcar()).status, 403);
  assert.equal((await filaDe(planId, "Resina")).estado, "pendiente");

  // SUPER_ADMIN siempre, aunque su override no traiga el permiso.
  Object.assign(ctx, { userId: "sa-c1", role: "SUPER_ADMIN", isDoctor: false, permissionsOverride: ["treatments.view"] });
  assert.equal((await marcar()).status, 200);
  assert.equal((await deshacer()).status, 200);
  // …pero solo eso: editar el plan sigue pidiendo el permiso.
  assert.equal((await hechoDesdeLaTarjeta(planId, { status: "PAUSED" })).status, 403);

  // v17 (decisión 4 de Rafael): un doctor en el plan de OTRO doctor, sí (marcar y deshacer); editarlo, no.
  Object.assign(ctx, { userId: "otro-doc", role: "DOCTOR", isDoctor: true, permissionsOverride: null });
  assert.equal((await marcar()).status, 200);
  assert.equal((await deshacer()).status, 200);
  assert.equal((await hechoDesdeLaTarjeta(planId, { status: "PAUSED" })).status, 403);
  Object.assign(ctx, { userId: "doc-c1", role: "DOCTOR", isDoctor: true, permissionsOverride: null });
  assert.equal((await marcar()).status, 200);

  // La otra clínica no encuentra el plan.
  Object.assign(ctx, { clinicId: "c2", userId: "doc-c2", role: "ADMIN", isDoctor: false });
  assert.equal((await deshacer()).status, 404);
});

test("v13: lo que dice la tarjeta con las respuestas REALES de la ruta — 403 sin código y plan sin nota (n1, n2)", async (t) => {
  if (salta(t)) return;
  await usar();
  const { marcarHecho, deshacerHecho, errorDeHecho, ayudaHablaDeDebe } = await import("@/lib/treatments/marcar-hecho-cliente");
  const { getDict } = await import("@/i18n/dictionaries");
  const { makeT } = await import("@/i18n/t");
  const en = makeT(getDict("en"));
  const errEn = (getDict("en") as any).planTratamiento.hecho.error;
  // El fetch de la tarjeta, contestado por el PATCH real.
  const porLaRuta = (planId: string) => async (_url: string, init?: RequestInit) => {
    const { PATCH } = await import("@/app/api/treatments/[id]/route");
    await base.db.exec(`ALTER TABLE "procedure_catalog" ADD COLUMN IF NOT EXISTS "code" text`);
    return PATCH(pedir(`/api/treatments/${planId}`, JSON.parse(String(init?.body)), "PATCH"), params(planId));
  };

  // n1: plan creado y SIN aceptar → sus filas no tienen nota; la cuenta dice debe 0 sin cuotas, pero la
  // ayuda no promete «Debe» (y de verdad «Hecho» no lo mueve).
  const { POST } = await import("@/app/api/treatments/route");
  const sinAceptar = (await leer(await POST(pedir("/api/treatments", { patientId: "pac-c1", name: "Sin aceptar", description: "▸ texto", items: ITEMS })))).body.id as string;
  const filasSin = await filas(sinAceptar);
  assert.ok(filasSin.every((f: any) => f.invoiceId === null));
  const c = await cuenta(sinAceptar);
  assert.equal(c.aCuotas, false);
  assert.equal(ayudaHablaDeDebe(!c.aCuotas, filasSin), false);
  assert.equal((await marcarHecho(sinAceptar, [filasSin[0].id], null, porLaRuta(sinAceptar))).ok, true);
  assert.equal((await cuenta(sinAceptar)).debe, 0, "«Hecho» no crea cobros");
  // Aceptado: sí.
  const { planId } = await planAceptado();
  assert.equal(ayudaHablaDeDebe(!(await cuenta(planId)).aCuotas, await filas(planId)), true);

  // n2: recepción sin el permiso → la ruta contesta 403 SIN código; la tarjeta dice «permiso», no «couldn't be marked».
  const resina = (await filas(planId)).find((f: any) => f.nombre === "Resina");
  Object.assign(ctx, { userId: "rec-c1", role: "RECEPTIONIST", isDoctor: false, permissionsOverride: ["treatments.view"] });
  const m = await marcarHecho(planId, [resina.id], null, porLaRuta(planId));
  assert.deepEqual({ ok: m.ok, status: m.status, codigo: m.codigo }, { ok: false, status: 403, codigo: undefined });
  assert.equal(errorDeHecho(en, m, "marcar"), errEn.sin_permiso);
  const d = await deshacerHecho(planId, resina.id, porLaRuta(planId));
  assert.equal(d.status, 403);
  assert.equal(errorDeHecho(en, d, "deshacer"), errEn.sin_permiso);
  // Con código (deshacer algo que no está hecho → 409 no_esta_hecha), su texto.
  Object.assign(ctx, { userId: "doc-c1", role: "ADMIN", permissionsOverride: null });
  const d2 = await deshacerHecho(planId, resina.id, porLaRuta(planId));
  assert.equal(d2.codigo, "no_esta_hecha");
  assert.equal(errorDeHecho(en, d2, "deshacer"), errEn.no_esta_hecha);
});

test("v11: plan cerrado (Abandonado) — no se marca ni se deshace", async (t) => {
  if (salta(t)) return;
  await usar();
  const { planId } = await planAceptado();
  const resina = await filaDe(planId, "Resina");
  const limpieza = await filaDe(planId, "Limpieza");
  assert.equal((await hechoDesdeLaTarjeta(planId, { action: "marcar_hecho", itemIds: [resina.id] })).status, 200);
  const c = await cerrar(planId);
  assert.equal(c.status, 200);
  assert.equal(c.body.cuenta, undefined, "v15 (M3): sin conCuenta, la respuesta de siempre");
  const r = await hechoDesdeLaTarjeta(planId, { action: "deshacer_hecho", itemId: resina.id });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "plan_cerrado");
  assert.equal((await filaDe(planId, "Resina")).estado, "hecho");
  // Aunque lo pasen a Abandonado a mano (sin «Cerrar plan»), tampoco.
  await base.db.query(`UPDATE "treatment_plan_items" SET "estado" = 'pendiente', "canceladoEn" = NULL WHERE "id" = $1`, [limpieza.id]);
  const m = await hechoDesdeLaTarjeta(planId, { action: "marcar_hecho", itemIds: [limpieza.id] });
  assert.equal(m.status, 409);
  assert.equal(m.body.code, "plan_cerrado");
  assert.equal((await filaDe(planId, "Limpieza")).estado, "pendiente");
});

test("cerrar un plan TERMINADO: ya_cerrado, no lo pasa a Abandonado ni escribe nada (revisión t5, A7)", async (t) => {
  if (salta(t)) return;
  await usar();
  const { planId } = await planAceptado();
  await base.db.query(`UPDATE "treatment_plans" SET "status" = 'COMPLETED' WHERE "id" = $1`, [planId]);
  const antes = bitacora.length;
  const r = await cerrar(planId);
  assert.equal(r.status, 200);
  assert.equal(r.body.estado, "ya_cerrado");
  const plan = (await base.db.query(`SELECT "status"::text AS "status" FROM "treatment_plans" WHERE "id" = $1`, [planId])).rows[0];
  assert.equal(plan.status, "COMPLETED");
  assert.equal(bitacora.length, antes, "sin filas nuevas en Movimientos");
  assert.equal((await filas(planId)).filter((f: any) => f.estado === "cancelado").length, 0);
  const [n] = await notas(planId);
  assert.equal(n.total, 2050.5, "la nota no se tocó");
});

test("cerrar con una factura de antes del plan (presupuesto): la confirmación y la respuesta lo dicen; esa factura no se toca (revisión t5, A5)", async (t) => {
  if (salta(t)) return;
  await usar();
  const { POST } = await import("@/app/api/treatments/route");
  const creado = await leer(await POST(pedir("/api/treatments", { patientId: "pac-c1", name: "Plan viejo", description: "▸ texto", items: ITEMS })));
  const planId = creado.body.id as string;
  // La vía de antes: el presupuesto del plan cobró la limpieza con su propia factura.
  await base.db.query(
    `INSERT INTO "invoices" ("id", "clinicId", "patientId", "invoiceNumber", "items", "subtotal", "total", "balance", "status")
     VALUES ('vieja', 'c1', 'pac-c1', 'F-VIEJA', '[{"name":"Limpieza","quantity":1,"unitPrice":800}]', 800, 800, 800, 'PENDING')`,
  );
  await base.db.query(`INSERT INTO "quotes" ("id", "clinicId", "patientId", "folio", "title", "status", "invoiceId", "treatmentPlanId") VALUES ('q-viejo', 'c1', 'pac-c1', 'P-1', 'Plan viejo', 'ACCEPTED', 'vieja', $1)`, [planId]);
  await base.db.query(`UPDATE "treatment_plan_items" SET "invoiceId" = 'vieja' WHERE "planId" = $1 AND "nombre" = 'Limpieza'`, [planId]);
  const c = await cuenta(planId);
  assert.deepEqual(c.facturasDeAntes, ["F-VIEJA"], "la confirmación lo avisa antes de cerrar");
  const r = await cerrar(planId);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.sinAjustar, ["F-VIEJA"], "y la respuesta (el toast) lo dice");
  const vieja = (await base.db.query(`SELECT * FROM "invoices" WHERE "id" = 'vieja'`)).rows[0];
  assert.equal(vieja.balance, 800, "la factura de antes no se toca");
  const fs = await filas(planId);
  assert.equal(fs.find((f: any) => f.nombre === "Limpieza").estado, "pendiente", "su fila sigue ligada a esa factura");
  assert.equal(fs.find((f: any) => f.nombre === "Resina").estado, "cancelado");
  assert.ok(bitacora.some((b) => b.entityType === "treatment" && /F-VIEJA/.test(b.texto)));
});

// ── v14 (QA de Claude, 28-oct): la Cuenta del plan cambia con la RESPUESTA de la acción ─────────────

test("v14: «Hecho», «Deshacer» y «Cerrar plan» devuelven la cuenta del plan ya cambiada (la misma de /cuentas); sin ver dinero, no", async (t) => {
  if (salta(t)) return;
  await usar();
  const { marcarHecho, deshacerHecho, cuentaDeLaRespuesta } = await import("@/lib/treatments/marcar-hecho-cliente");
  const porLaRuta = (planId: string) => async (_url: string, init?: RequestInit) => {
    const { PATCH } = await import("@/app/api/treatments/[id]/route");
    await base.db.exec(`ALTER TABLE "procedure_catalog" ADD COLUMN IF NOT EXISTS "code" text`);
    return PATCH(pedir(`/api/treatments/${planId}`, JSON.parse(String(init?.body)), "PATCH"), params(planId));
  };
  const { planId, notaId } = await planAceptado();
  await pagar(notaId, 500);
  const resina = await filaDe(planId, "Resina");

  // «Hecho»: la respuesta ya trae Debe $750.50, igual que releer todas las cuentas.
  // v15 (t5, M3): «Hoy en el sillón» no la pide → no viaja (ni se paga). La tarjeta sí.
  const sinPedir = await marcarHecho(planId, [resina.id], null, porLaRuta(planId));
  assert.equal(sinPedir.ok, true);
  assert.equal(sinPedir.cuenta, undefined);
  await deshacerHecho(planId, resina.id, porLaRuta(planId));
  const m = await marcarHecho(planId, [resina.id], null, porLaRuta(planId), { conCuenta: true });
  assert.equal(m.ok, true);
  assert.equal(m.cuenta?.planId, planId);
  assert.equal(m.cuenta?.debe, 750.5);
  assert.deepEqual(m.cuenta, await cuenta(planId), "la misma cuenta que GET /api/treatments/cuentas");
  assert.equal(m.cuenta?.filas.find((f) => f.id === resina.id)?.estado, "hecho");

  // «Deshacer»: Debe vuelve a $0 en la misma respuesta.
  const d = await deshacerHecho(planId, resina.id, porLaRuta(planId), { conCuenta: true });
  assert.equal(d.ok, true);
  assert.equal(d.cuenta?.debe, 0);
  assert.deepEqual(d.cuenta, await cuenta(planId));

  // Quien marca pero no ve dinero: la acción va, la cuenta NO viaja en la respuesta.
  Object.assign(ctx, { userId: "rec-c1", role: "RECEPTIONIST", isDoctor: false, permissionsOverride: ["treatments.view", "treatments.edit"] });
  const sinDinero = await hechoDesdeLaTarjeta(planId, { action: "marcar_hecho", itemIds: [resina.id], conCuenta: true });
  assert.equal(sinDinero.status, 200);
  assert.equal(sinDinero.body.cuenta, undefined);
  assert.equal(cuentaDeLaRespuesta(sinDinero.body), undefined);

  // «Cerrar plan»: la cuenta ya cerrada (Abandonado, la nota baja a lo hecho) viene en la respuesta.
  Object.assign(ctx, { userId: "doc-c1", role: "ADMIN", isDoctor: false, permissionsOverride: null });
  const c = await cerrar(planId, undefined, { conCuenta: true });
  assert.equal(c.status, 200);
  const cerrada = cuentaDeLaRespuesta(c.body);
  assert.equal(cerrada?.estado, "ABANDONED");
  assert.equal(cerrada?.porHacer, 0);
  assert.deepEqual(cerrada, await cuenta(planId));
});

test("v15 · M1 (opción b): con cuotas, «Estado de cuenta» dice «Pagado por adelantado» con la cifra de la tarjeta, sin contarlo dos veces", async (t) => {
  if (salta(t)) return;
  await usar();
  const { hoyEnZona } = await import("@/lib/fechas/hoy-en-zona");
  const { GET: FICHA } = await import("@/app/api/patients/[id]/lo-que-aun-no-se-debe/route");
  const invoiceDePrueba = prismaVivo.invoice;
  prismaVivo.invoice = {
    ...invoiceDePrueba,
    findMany: async (a: any = {}) => {
      const filas = await invoiceDePrueba.findMany(a);
      if (!a?.select?.payments) return filas;
      return Promise.all(filas.map(async (f: any) => ({
        ...f,
        payments: (await base.db.query(`SELECT "amount", "method" FROM "payments" WHERE "invoiceId" = $1`, [f.id])).rows,
      })));
    },
  };
  // El caso de t5 («A 1500/nada»): $2,050.50 en 3 mensualidades (2 vencidas = $1,367), $1,500 pagados, nada hecho.
  const A = await planAceptado();
  await conCuotas(A.notaId, { numPagos: 3, primerPago: hoyEnZona(new Date(Date.now() - 40 * 86_400_000), "America/Mexico_City") });
  await pagar(A.notaId, 1500);
  const tarjeta = await cuenta(A.planId);
  assert.equal(tarjeta.aCuotas, true);
  assert.equal(tarjeta.debe, 0);
  assert.equal(tarjeta.saldoAFavor, 1500, "la tarjeta dice «Pagado por adelantado $1,500.00»");

  const r = await leer(await FICHA(pedir("/api/patients/pac-c1/lo-que-aun-no-se-debe", undefined, "GET"), params("pac-c1")));
  assert.equal(r.status, 200);
  // Lo que arma la ficha (patient-detail-client): igual que allí.
  const cuotas = Math.min(r.body.total, r.body.porVencerCuotas);
  const porHacerCompleto = Math.round((r.body.total - cuotas + r.body.adelanto) * 100) / 100;
  const pagadoPorAdelantado = Math.round((r.body.adelanto + r.body.adelantoCuotas) * 100) / 100;
  assert.equal(pagadoPorAdelantado, 1500, "«Pagado por adelantado: $1,500.00», la cifra de la tarjeta");
  assert.equal(cuotas, 550.5, "«Además, $550.50 de cuotas que aún no vencen»: lo que FALTA pagar");
  assert.equal(porHacerCompleto, 0, "el adelanto con cuotas NO entra en «Además, $X por hacer»");
  // Nada dos veces: pagado por adelantado + cuotas por vencer = el plan entero.
  assert.equal(Math.round((pagadoPorAdelantado + cuotas) * 100) / 100, 2050.5);
});

// Seguridad ola 2b (hermana del lead 5): un CFDI POR PAGO no llena `invoices.cfdiUuid`. Cerrar el plan
// devolvía al saldo a favor lo pagado de una nota con ese CFDI vigente ante el SAT; /cancel, /refund,
// anular anticipo y «a favor» ya lo bloqueaban con algunPagoTieneCfdiVigente.
test("🔴 cerrar plan con un CFDI POR PAGO vigente en la nota: 409 CFDI_POR_PAGO_VIGENTE y no se toca nada", async (t) => {
  if (salta(t)) return;
  await usar();
  const cfdiPago = await import("@/lib/invoices/cfdi-pago-db");
  try {
    const { planId, notaId } = await planAceptado();
    const pagoId = await pagar(notaId, 1000);
    await base.db.exec(`CREATE TABLE IF NOT EXISTS "cfdi_records" ("id" text PRIMARY KEY, "clinicId" text NOT NULL,
      "invoiceId" text, "paymentId" text, "status" text NOT NULL, "total" float8)`);
    await base.db.query(`INSERT INTO "cfdi_records" VALUES ('cf-1', 'c1', $1, $2, 'valid', 1000)`, [notaId, pagoId]);
    cfdiPago._olvidarColumnaCfdiPago();
    const r = await cerrar(planId);
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.code, "CFDI_POR_PAGO_VIGENTE");
    const [n] = await notas(planId);
    assert.notEqual(n.status, "CANCELLED");
    assert.equal(n.paid, 1000, "lo pagado sigue en la nota");
    const aFavor = (await base.db.query(`SELECT count(*)::int AS c FROM "patient_credits"`)).rows[0].c;
    assert.equal(aFavor, 0, "no nace saldo a favor");
    const plan = (await base.db.query(`SELECT "status"::text AS "status" FROM "treatment_plans" WHERE "id" = $1`, [planId])).rows[0];
    assert.equal(plan.status, "ACTIVE");
  } finally {
    // La sonda de la columna se queda en caché: que no contamine a otra prueba con una base sin la tabla.
    cfdiPago._olvidarColumnaCfdiPago();
  }
});

// Revisión t5 (m5): un CFDI por pago «apartado» (Facturapi lo está timbrando ahora mismo) también bloquea:
// si no, el plan se cerraba en esos segundos y luego el CFDI quedaba `valid` con el dinero ya en saldo a favor.
test("🔴 cerrar plan mientras se timbra un CFDI POR PAGO («apartado»): 409 y no se toca nada", async (t) => {
  if (salta(t)) return;
  await usar();
  const cfdiPago = await import("@/lib/invoices/cfdi-pago-db");
  try {
    const { planId, notaId } = await planAceptado();
    const pagoId = await pagar(notaId, 1000);
    await base.db.exec(`CREATE TABLE IF NOT EXISTS "cfdi_records" ("id" text PRIMARY KEY, "clinicId" text NOT NULL,
      "invoiceId" text, "paymentId" text, "status" text NOT NULL, "total" float8)`);
    await base.db.query(`INSERT INTO "cfdi_records" VALUES ('cf-ap', 'c1', $1, $2, 'apartado', 1000)`, [notaId, pagoId]);
    cfdiPago._olvidarColumnaCfdiPago();
    const r = await cerrar(planId);
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.code, "CFDI_POR_PAGO_VIGENTE");
    const [n] = await notas(planId);
    assert.equal(n.paid, 1000);
    assert.equal((await base.db.query(`SELECT count(*)::int AS c FROM "patient_credits"`)).rows[0].c, 0);
  } finally {
    cfdiPago._olvidarColumnaCfdiPago();
  }
});
