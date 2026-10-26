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

const dobles: Record<string, unknown> = {
  "server-only": {},
  "@/lib/prisma": { prisma: prismaVivo },
  "@/lib/auth-context": { getAuthContext: async () => ({ ...ctx }) },
  "@/lib/audit": { logAudit: async (a: unknown) => { bitacora.push(a); }, logMutation: async () => {}, extractAuditMeta: () => ({}) },
  "@/lib/patient-visibility": {
    assertPatientVisible: async () => null,
    relatedPatientVisibilityAnd: () => [],
    canSeePatient: () => true,
  },
  "@/lib/cache/revalidate": { revalidateAfter: () => undefined },
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
  await base.db.query(`INSERT INTO "procedure_catalog" VALUES ('proc-r','c1','Resina',1250.5,true), ('proc-l','c1','Limpieza',800,true)`);
  bitacora.length = 0;
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
      findMany: async () =>
        (await base.db.query(
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

async function cerrar(planId: string, motivo: unknown = "El paciente ya no continuará") {
  const { POST } = await import("@/app/api/treatments/[id]/cerrar/route");
  return leer(await POST(pedir(`/api/treatments/${planId}/cerrar`, { motivo }), params(planId)));
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

  // Ya cerrado: un segundo cierre no cambia nada (ni dinero ni filas).
  const otra = await cerrar(planId);
  assert.equal(otra.status, 200);
  assert.equal(otra.body.saldoAFavor, 0);
  assert.equal(otra.body.filasCanceladas, 0);
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
