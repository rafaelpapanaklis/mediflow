/**
 * PLAN DE TRATAMIENTO NUEVO — LA BASE (ws1-t12: P2, P4 y P6), los HANDLERS REALES contra un Postgres
 * en memoria (PGlite) con `sql/plan-tratamiento-filas.sql` pegado dos veces.
 *
 * Run: PGLITE_DIR=<carpeta con node_modules/@electric-sql/pglite> npm run test:plan-v2
 *
 *  P2 · POST/PATCH /api/treatments con `items`; GET los devuelve; sin SQL, todo como hoy.
 *  P4 · «Guardar y presentar»: el presupuesto sale de las filas y se presenta (liga de firma) sin
 *       editor; «Crear plan» desde un presupuesto aceptado crea filas.
 *  P6 · Nota de cobro del plan: nace al aceptar, una línea por fila; nunca dos notas por fila (doble
 *       clic y dos a la vez); crece con el plan; adicional si ya se pagó; la cuenta del plan.
 *
 * Los dobles van por `Module._load` (prisma de PGlite, sesión, auditoría, visibilidad, caché, saldo a
 * favor y el módulo de ortodoncia). ⛔ Nunca toca una base de verdad. Sin PGlite se SALTA diciéndolo.
 */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { NextRequest, NextResponse } from "next/server";
import { cargarPGlite, crearBase, sembrarPlan, type Base } from "@/lib/treatments/__tests__/arnes-pg";

let PGlite: (new () => any) | null = null;
let base: Base;
const prismaVivo: any = {};
const ctx: Record<string, any> = {};
const auditoria: any[] = [];
const saldoAplicado: Array<{ invoiceId: string; origen: string }> = [];
const ocultos = new Set<string>();
let saldoAFavor = 0;

const dobles: Record<string, unknown> = {
  "server-only": {},
  "@/lib/prisma": { prisma: prismaVivo },
  "@/lib/auth-context": { getAuthContext: async () => ({ ...ctx }) },
  "@/lib/audit": {
    logAudit: async (a: any) => { auditoria.push({ tipo: "audit", ...a }); },
    logMutation: async (a: any) => { auditoria.push({ tipo: "mutation", ...a, req: undefined }); },
    extractAuditMeta: () => ({}),
  },
  "@/lib/patient-visibility": {
    assertPatientVisible: async (id: string) => (ocultos.has(id) ? NextResponse.json({ error: "patient_not_found" }, { status: 404 }) : null),
    relatedPatientVisibilityAnd: () => [],
  },
  "@/lib/cache/revalidate": { revalidateAfter: () => undefined },
  "@/lib/patient-credit-aplicar": {
    aplicarSaldoAFavor: async (a: any) => {
      saldoAplicado.push({ invoiceId: a.invoiceId, origen: a.origen });
      return { aplicado: saldoAFavor, restanteAFavor: 0, factura: null, motivo: null };
    },
  },
  "@/lib/quotes/ortodoncia.server": { casosDesdePresupuestos: async () => new Map() },
};
const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  return req in dobles ? dobles[req] : cargaOriginal.call(this, req, ...r);
};

async function usar(opciones: { conSqlDelPlan?: boolean; conAceptacion?: boolean } = {}) {
  base = await crearBase(PGlite!, opciones);
  for (const k of Object.keys(prismaVivo)) delete prismaVivo[k];
  Object.assign(prismaVivo, base.prisma);
  (await import("@/lib/treatments/items-db"))._olvidarSondas();
  (await import("@/lib/quotes/aceptacion-db"))._olvidarTablas();
  await base.db.query(`INSERT INTO "procedure_catalog" VALUES ('proc-r','c1','Resina',1250.5,true), ('proc-l','c1','Limpieza',800,true), ('proc-ajeno','c2','Ajeno',1,true)`);
}

const pedir = (url: string, body?: unknown, method = "POST") =>
  new NextRequest(`http://x${url}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const leer = async (r: Response) => ({ status: r.status, body: await r.json() });
const filas = async (planId = "plan1") => (await base.db.query(`SELECT * FROM "treatment_plan_items" WHERE "planId" = $1 ORDER BY "orden"`, [planId])).rows;
const notas = async (planId = "plan1") => (await base.db.query(`SELECT * FROM "invoices" WHERE "treatmentPlanId" = $1 ORDER BY "createdAt", "invoiceNumber"`, [planId])).rows;

const ITEMS = [
  { nombre: "Resina", procedureId: "proc-r", dientes: "16", caras: "MO", precio: "1250.50", fase: "restauradora", motivo: "Caries" },
  { nombre: "Limpieza", procedureId: "proc-l", precio: 800, fase: "higienica" },
  { nombre: "Endodoncia", procedureId: "proc-ajeno", dientes: [36], precio: 3500.25, fase: "correctiva" },
];

before(async () => {
  PGlite = await cargarPGlite();
});

beforeEach(() => {
  Object.assign(ctx, { clinicId: "c1", userId: "doc-c1", role: "ADMIN", isDoctor: false, permissionsOverride: null });
  auditoria.length = 0;
  saldoAplicado.length = 0;
  ocultos.clear();
  saldoAFavor = 0;
});

const salta = (t: { skip: (m: string) => void }) => {
  if (!PGlite) {
    t.skip("PGlite no está: pasa PGLITE_DIR=<carpeta con node_modules/@electric-sql/pglite>");
    return true;
  }
  return false;
};

async function crearPlan(body: Record<string, unknown> = {}) {
  const { POST } = await import("@/app/api/treatments/route");
  return leer(await POST(pedir("/api/treatments", { patientId: "pac-c1", name: "Plan Ana", description: "▸ texto viejo", items: ITEMS, ...body })));
}

// ── P2 ──────────────────────────────────────────────────────────────────────

test("P2 · POST con items: plan y filas juntos, centavos exactos, costo = suma, procedimiento ajeno anulado", async (t) => {
  if (salta(t)) return;
  await usar();
  const r = await crearPlan();
  assert.equal(r.status, 201);
  assert.equal(r.body.filasGuardadas, true);
  assert.equal(r.body.items.length, 3);
  assert.equal(r.body.items[0].precioCentavos, 125050);
  assert.equal(r.body.items[0].precio, 1250.5);
  assert.deepEqual(r.body.items[0].caras, ["M", "O"]);
  assert.equal(r.body.items[2].procedureId, null, "el procedimiento de otra clínica no se guarda");
  assert.equal(r.body.totalCost, 5550.75);
  const enBase = await filas(r.body.id);
  assert.equal(enBase.length, 3);
  assert.equal(enBase[0].clinicId, "c1");
  const mut = auditoria.find((a) => a.tipo === "mutation" && a.action === "create");
  assert.deepEqual(mut.after.procedimientos, ["Resina", "Limpieza", "Endodoncia"]);
});

test("P2 · POST con una fila mala: 400 con código e índice, y no se crea NADA", async (t) => {
  if (salta(t)) return;
  await usar();
  const r = await crearPlan({ items: [ITEMS[0], { nombre: "X", dientes: "99" }] });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "diente_invalido");
  assert.equal(r.body.indice, 1);
  assert.match(r.body.error, /FDI/);
  assert.equal((await base.db.query(`SELECT count(*)::int AS n FROM "treatment_plans"`)).rows[0].n, 0);
});

test("P2 · POST con filas todas en $0 sin confirmar: 409 PLAN_SIN_COSTO (la regla de siempre)", async (t) => {
  if (salta(t)) return;
  await usar();
  const r = await crearPlan({ items: [{ nombre: "Revisión" }] });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "PLAN_SIN_COSTO");
  const ok = await crearPlan({ items: [{ nombre: "Revisión" }], confirmarSinCosto: true });
  assert.equal(ok.status, 201);
});

test("P2 · sin el SQL: los items se ignoran y el plan se guarda como hoy (texto)", async (t) => {
  if (salta(t)) return;
  await usar({ conSqlDelPlan: false });
  const r = await crearPlan({ totalCost: 999 });
  assert.equal(r.status, 201);
  assert.equal(r.body.filasGuardadas, false);
  assert.deepEqual(r.body.items, []);
  assert.equal(r.body.description, "▸ texto viejo");
  assert.equal(r.body.totalCost, 999);
  const { GET } = await import("@/app/api/treatments/route");
  const lista = await leer(await GET(pedir("/api/treatments?patientId=pac-c1", undefined, "GET")));
  assert.deepEqual(lista.body[0].items, []);
});

test("P2 · GET devuelve las filas de cada plan; otra clínica no ve ni el plan ni sus filas", async (t) => {
  if (salta(t)) return;
  await usar();
  await crearPlan();
  const { GET } = await import("@/app/api/treatments/route");
  const lista = await leer(await GET(pedir("/api/treatments", undefined, "GET")));
  assert.equal(lista.body.length, 1);
  assert.deepEqual(lista.body[0].items.map((f: any) => f.nombre), ["Resina", "Limpieza", "Endodoncia"]);
  Object.assign(ctx, { clinicId: "c2", userId: "doc-c2" });
  assert.deepEqual((await leer(await GET(pedir("/api/treatments", undefined, "GET")))).body, []);
});

test("P2 · PATCH con items: alta, cambio, cancelación (sin borrar) y el costo sigue a las filas", async (t) => {
  if (salta(t)) return;
  await usar();
  const creado = await crearPlan();
  const [r, l] = creado.body.items;
  const { PATCH } = await import("@/app/api/treatments/[id]/route");
  const res = await leer(await PATCH(pedir(`/api/treatments/${creado.body.id}`, {
    items: [{ ...l, precio: 900 }, { nombre: "Corona", precio: 5000, fase: "restauradora" }, { ...r }],
  }, "PATCH"), params(creado.body.id)));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items.map((f: any) => `${f.nombre}:${f.precio}`), ["Limpieza:900", "Corona:5000", "Resina:1250.5"]);
  const todas = await filas(creado.body.id);
  assert.equal(todas.length, 4, "nada se borró");
  assert.equal(todas.find((f: any) => f.nombre === "Endodoncia").estado, "cancelado");
  const plan = (await base.db.query(`SELECT "totalCost" FROM "treatment_plans" WHERE "id" = $1`, [creado.body.id])).rows[0];
  assert.equal(plan.totalCost, 7150.5);
  const mut = auditoria.find((a) => a.tipo === "mutation" && a.action === "update");
  assert.ok(mut.after.procedimientos.some((x: string) => x.startsWith("Corona")));
});

test("P2 · PATCH: una fila mala es 400; callar una hecha es 409; un plan de otra clínica es 404", async (t) => {
  if (salta(t)) return;
  await usar();
  const creado = await crearPlan();
  const id = creado.body.id;
  const { PATCH } = await import("@/app/api/treatments/[id]/route");
  const mala = await leer(await PATCH(pedir(`/api/treatments/${id}`, { items: [{ nombre: "" }] }, "PATCH"), params(id)));
  assert.equal(mala.status, 400);
  assert.equal(mala.body.code, "sin_nombre");
  await base.db.query(`UPDATE "treatment_plan_items" SET "estado" = 'hecho' WHERE "nombre" = 'Resina'`);
  const callar = await leer(await PATCH(pedir(`/api/treatments/${id}`, { items: creado.body.items.slice(1) }, "PATCH"), params(id)));
  assert.equal(callar.status, 409);
  assert.equal(callar.body.code, "fila_hecha");
  assert.equal((await filas(id)).filter((f: any) => f.estado === "cancelado").length, 0, "la transacción se deshizo entera");
  Object.assign(ctx, { clinicId: "c2", userId: "doc-c2" });
  const ajeno = await PATCH(pedir(`/api/treatments/${id}`, { items: [] }, "PATCH"), params(id));
  assert.equal(ajeno.status, 404);
});

test("P2 · Convertir (vista previa) lee las filas con su precio exacto", async (t) => {
  if (salta(t)) return;
  await usar();
  const creado = await crearPlan();
  const { GET } = await import("@/app/api/treatments/[id]/presupuesto/route");
  const v = await leer(await GET(pedir(`/api/treatments/${creado.body.id}/presupuesto`, undefined, "GET"), params(creado.body.id)));
  assert.equal(v.status, 200);
  assert.equal(v.body.deFilas, true);
  assert.deepEqual(v.body.conceptos.map((c: any) => [c.name, c.unitPrice]), [["Limpieza", 800], ["Endodoncia", 3500.25], ["Resina", 1250.5]]);
  assert.equal(v.body.total, 5550.75);
});

// ── P4 ──────────────────────────────────────────────────────────────────────

test("P4 · Guardar y presentar: presupuesto de las filas, PRESENTADO con su liga; segundo clic no duplica", async (t) => {
  if (salta(t)) return;
  await usar();
  const creado = await crearPlan({ presentar: true });
  assert.equal(creado.status, 201);
  assert.equal(creado.body.presupuestoError, null);
  const q = creado.body.presupuesto;
  assert.equal(q.status, "PRESENTED");
  assert.match(q.liga, /^\/presupuesto\/[0-9a-f]{40}$/);
  assert.equal(q.total, 5550.75);
  const items = (await base.db.query(`SELECT * FROM "quote_items" WHERE "quoteId" = $1 ORDER BY "sortOrder"`, [q.id])).rows;
  assert.deepEqual(items.map((i: any) => [i.name, i.unitPrice, i.toothFdi]), [["Limpieza", "800.00", null], ["Endodoncia", "3500.25", "36"], ["Resina", "1250.50", "16"]]);
  const ligadas = await filas(creado.body.id);
  assert.ok(ligadas.every((f: any) => items.some((i: any) => i.id === f.quoteItemId)), "cada fila sabe su concepto");
  const { POST } = await import("@/app/api/treatments/[id]/presupuesto/route");
  const otra = await leer(await POST(pedir(`/api/treatments/${creado.body.id}/presupuesto`, { presentar: true }), params(creado.body.id)));
  assert.equal(otra.status, 200);
  assert.equal(otra.body.already, true);
  assert.equal(otra.body.quote.id, q.id);
  assert.equal(otra.body.regenerado, false);
  assert.equal((await base.db.query(`SELECT count(*)::int AS n FROM "quotes"`)).rows[0].n, 1);
});

test("P4 · el plan cambió antes de firmarse: presentar otra vez reescribe el MISMO presupuesto (misma liga)", async (t) => {
  if (salta(t)) return;
  await usar();
  const creado = await crearPlan({ presentar: true });
  const q = creado.body.presupuesto;
  const { PATCH } = await import("@/app/api/treatments/[id]/route");
  await PATCH(pedir(`/api/treatments/${creado.body.id}`, { items: [creado.body.items[0]] }, "PATCH"), params(creado.body.id));
  const { POST } = await import("@/app/api/treatments/[id]/presupuesto/route");
  const otra = await leer(await POST(pedir(`/api/treatments/${creado.body.id}/presupuesto`, { presentar: true }), params(creado.body.id)));
  assert.equal(otra.body.regenerado, true);
  assert.equal(otra.body.quote.id, q.id);
  assert.equal(otra.body.quote.liga, q.liga);
  assert.equal(otra.body.quote.total, 1250.5);
  const items = (await base.db.query(`SELECT "id" FROM "quote_items" WHERE "quoteId" = $1`, [q.id])).rows;
  const viva = (await filas(creado.body.id)).find((f: any) => f.estado !== "cancelado");
  assert.equal(viva.quoteItemId, items[0].id, "la fila se religa al concepto nuevo");
});

test("P4 · presentar pide billing.edit: sin él, 403 (y en el alta, el plan se guarda igual)", async (t) => {
  if (salta(t)) return;
  await usar();
  ctx.permissionsOverride = ["treatments.view", "treatments.edit", "billing.create"];
  const creado = await crearPlan({ presentar: true });
  assert.equal(creado.status, 201);
  assert.equal(creado.body.presupuestoError, "sin_permiso");
  assert.equal((await base.db.query(`SELECT count(*)::int AS n FROM "quotes"`)).rows[0].n, 0);
  const { POST } = await import("@/app/api/treatments/[id]/presupuesto/route");
  const r = await POST(pedir(`/api/treatments/${creado.body.id}/presupuesto`, { presentar: true }), params(creado.body.id));
  assert.equal(r.status, 403);
});

// ── P6 ──────────────────────────────────────────────────────────────────────

async function aceptar(quoteId: string, itemIds?: string[]) {
  const { POST } = await import("@/app/api/quotes/[id]/status/route");
  return leer(await POST(pedir(`/api/quotes/${quoteId}/status`, { action: "accept", ...(itemIds ? { itemIds } : {}) }), params(quoteId)));
}

test("P6 · aceptar el presupuesto del plan crea UNA nota PENDIENTE ligada, una línea por fila", async (t) => {
  if (salta(t)) return;
  await usar();
  saldoAFavor = 0;
  const creado = await crearPlan({ presentar: true });
  const r = await aceptar(creado.body.presupuesto.id);
  assert.equal(r.status, 200);
  const [n, ...otras] = await notas(creado.body.id);
  assert.equal(otras.length, 0);
  assert.equal(n.status, "PENDING");
  assert.equal(n.total, 5550.75);
  assert.equal(n.balance, 5550.75);
  assert.equal(n.doctorId, "doc-c1");
  assert.deepEqual(n.items.map((i: any) => [i.description, i.unitPrice, i.total]), [["Limpieza", 800, 800], ["Endodoncia (36)", 3500.25, 3500.25], ["Resina (16)", 1250.5, 1250.5]]);
  const fs = await filas(creado.body.id);
  for (const f of fs) {
    assert.equal(f.invoiceId, n.id);
    assert.equal(n.items[f.invoiceLinea].planItemId, f.id, "cada línea dice su fila");
  }
  const q = (await base.db.query(`SELECT "invoiceId", "status" FROM "quotes" WHERE "id" = $1`, [creado.body.presupuesto.id])).rows[0];
  assert.equal(q.status, "ACCEPTED");
  assert.equal(q.invoiceId, n.id, "el presupuesto ve su factura: «Generar factura» no carga otra vez");
  assert.deepEqual(saldoAplicado, [{ invoiceId: n.id, origen: "creada" }], "el anticipo se aplica como hoy, al nacer");
  assert.ok(auditoria.some((a) => a.tipo === "audit" && /Creó la nota de cobro/.test(a.texto) && a.patientId === "pac-c1"));
});

test("P6 · aceptado por la liga pública (sin usuario): nace la nota y NO se intenta una fila de bitácora sin usuario", async (t) => {
  if (salta(t)) return;
  await usar();
  const creado = await crearPlan({ presentar: true });
  auditoria.length = 0;
  const { aceptarPresupuesto } = await import("@/lib/quotes/cargos.server");
  const r = await aceptarPresupuesto({ quoteId: creado.body.presupuesto.id, clinicId: "c1", userId: null, via: "liga", itemIds: undefined, desde: ["PRESENTED"] });
  assert.equal((r.notaDelPlan as any).estado, "creada");
  assert.equal((await notas(creado.body.id)).length, 1);
  assert.equal(auditoria.length, 0, "AuditLog exige usuario: sin él no se escribe (como la ruta pública)");
});

test("P6 · nunca dos notas por la misma fila: doble clic y dos a la vez", async (t) => {
  if (salta(t)) return;
  await usar();
  await crearPlan();
  const plan = (await base.db.query(`SELECT "id" FROM "treatment_plans"`)).rows[0].id;
  const { POST } = await import("@/app/api/treatments/[id]/nota-de-cobro/route");
  const [a, b] = await Promise.all([
    leer(await POST(pedir(`/api/treatments/${plan}/nota-de-cobro`), params(plan))),
    leer(await POST(pedir(`/api/treatments/${plan}/nota-de-cobro`), params(plan))),
  ]);
  assert.deepEqual([a.body.estado, b.body.estado].sort(), ["creada", "nada"]);
  const c = await leer(await POST(pedir(`/api/treatments/${plan}/nota-de-cobro`), params(plan)));
  assert.equal(c.body.estado, "nada");
  assert.equal((await notas(plan)).length, 1);
  assert.equal((await base.db.query(`SELECT count(*)::int AS n FROM "invoices"`)).rows[0].n, 1);
});

test("P6 · el plan crece: la nota PENDIENTE recibe la línea; ya pagada, nace una nota adicional del plan", async (t) => {
  if (salta(t)) return;
  await usar();
  const creado = await crearPlan({ items: [ITEMS[1]] });
  const id = creado.body.id;
  const { POST } = await import("@/app/api/treatments/[id]/nota-de-cobro/route");
  await POST(pedir(`/api/treatments/${id}/nota-de-cobro`), params(id));
  const { PATCH } = await import("@/app/api/treatments/[id]/route");
  const actuales = async () => (await leer(await (await import("@/app/api/treatments/route")).GET(pedir("/api/treatments", undefined, "GET")))).body[0].items;
  const crece = await leer(await PATCH(pedir(`/api/treatments/${id}`, { items: [...(await actuales()), { nombre: "Resina", precio: 1250.5 }] }, "PATCH"), params(id)));
  assert.equal(crece.body.notaDelPlan.estado, "agregada");
  let [n1] = await notas(id);
  assert.equal(n1.total, 2050.5);
  assert.equal(n1.items.length, 2);
  assert.equal((await notas(id)).length, 1);
  // Se paga y vuelve a crecer: nota adicional, ligada al mismo plan; el anticipo solo a la nueva.
  await base.db.query(`UPDATE "invoices" SET "status" = 'PAID', "paid" = "total", "balance" = 0 WHERE "id" = $1`, [n1.id]);
  saldoAplicado.length = 0;
  const otra = await leer(await PATCH(pedir(`/api/treatments/${id}`, { items: [...(await actuales()), { nombre: "Corona", precio: 5000 }] }, "PATCH"), params(id)));
  assert.equal(otra.body.notaDelPlan.estado, "creada");
  const todas = await notas(id);
  assert.equal(todas.length, 2);
  [n1] = todas;
  assert.equal(n1.total, 2050.5, "la pagada no se tocó");
  assert.equal(todas[1].total, 5000);
  assert.deepEqual(saldoAplicado.map((s) => s.invoiceId), [todas[1].id]);
  // Una fila cobrada no cambia de precio desde el plan.
  const cobrada = (await actuales()).find((f: any) => f.nombre === "Corona");
  const no = await leer(await PATCH(pedir(`/api/treatments/${id}`, { items: (await actuales()).map((f: any) => (f.id === cobrada.id ? { ...f, precio: 1 } : f)) }, "PATCH"), params(id)));
  assert.equal(no.status, 409);
  assert.equal(no.body.code, "fila_cobrada");
});

test("P6 · un plan SIN aceptar que crece no genera nota", async (t) => {
  if (salta(t)) return;
  await usar();
  const creado = await crearPlan({ items: [ITEMS[1]] });
  const { PATCH } = await import("@/app/api/treatments/[id]/route");
  const r = await leer(await PATCH(pedir(`/api/treatments/${creado.body.id}`, { items: [...creado.body.items, { nombre: "Resina", precio: 10 }] }, "PATCH"), params(creado.body.id)));
  assert.equal(r.body.notaDelPlan.estado, "nada");
  assert.equal((await base.db.query(`SELECT count(*)::int AS n FROM "invoices"`)).rows[0].n, 0);
});

test("P6 · aceptación en parte (con quote_charges): solo lo aceptado; los cargos quedan anotados", async (t) => {
  if (salta(t)) return;
  await usar({ conAceptacion: true });
  const creado = await crearPlan({ presentar: true });
  const qid = creado.body.presupuesto.id;
  const items = (await base.db.query(`SELECT "id", "name" FROM "quote_items" WHERE "quoteId" = $1 ORDER BY "sortOrder"`, [qid])).rows;
  const sinEndo = items.filter((i: any) => i.name !== "Endodoncia").map((i: any) => i.id);
  const r = await aceptar(qid, sinEndo);
  assert.equal(r.status, 200);
  const [n] = await notas(creado.body.id);
  assert.equal(n.total, 2050.5);
  assert.deepEqual(n.items.map((i: any) => i.description), ["Limpieza", "Resina (16)"]);
  const endo = (await filas(creado.body.id)).find((f: any) => f.nombre === "Endodoncia");
  assert.equal(endo.invoiceId, null, "lo no aceptado no se cobra");
  const cargos = (await base.db.query(`SELECT "quoteItemId", "invoiceId", "monto"::text AS m FROM "quote_charges" ORDER BY "monto"`)).rows;
  assert.deepEqual(cargos.map((c: any) => [c.invoiceId, c.m]), [[n.id, "800.00"], [n.id, "1250.50"]]);
  // Volver a pedir la nota: nada nuevo (la endodoncia sigue sin aceptar).
  const { POST } = await import("@/app/api/treatments/[id]/nota-de-cobro/route");
  const otra = await leer(await POST(pedir(`/api/treatments/${creado.body.id}/nota-de-cobro`), params(creado.body.id)));
  assert.equal(otra.body.estado, "nada");
  assert.deepEqual(otra.body.omitidas.map((o: any) => o.motivo), ["no_aceptada"]);
});

test("P4+P6 · «Crear plan» desde un presupuesto aceptado: filas (no texto) y su nota", async (t) => {
  if (salta(t)) return;
  await usar();
  await base.db.query(`INSERT INTO "quotes" ("id","clinicId","patientId","createdById","folio","title","status","total","acceptedAt") VALUES ('q9','c1','pac-c1','doc-c1','P-0009','Rehabilitación','ACCEPTED',2050.5, now())`);
  await base.db.query(`INSERT INTO "quote_items" ("id","quoteId","procedureId","name","toothFdi","quantity","unitPrice","lineTotal","phase","sortOrder") VALUES
    ('qi1','q9','proc-r','Resina','16',1,1250.5,1250.5,1,0), ('qi2','q9',NULL,'Limpieza',NULL,1,800,800,2,1)`);
  const { POST } = await import("@/app/api/quotes/[id]/treatment-plan/route");
  const r = await leer(await POST(pedir(`/api/quotes/q9/treatment-plan`), params("q9")));
  assert.equal(r.status, 201);
  assert.equal(r.body.filas, 2);
  const fs = await filas(r.body.treatmentPlanId);
  assert.deepEqual(fs.map((f: any) => [f.nombre, f.precio, f.quoteItemId, f.faseNumero]), [["Resina", "1250.50", "qi1", 1], ["Limpieza", "800.00", "qi2", 2]]);
  assert.equal(r.body.notaDelPlan.estado, "creada");
  const [n] = await notas(r.body.treatmentPlanId);
  assert.equal(n.total, 2050.5);
  // Repetir es idempotente: el mismo plan, ninguna nota más.
  const otra = await leer(await POST(pedir(`/api/quotes/q9/treatment-plan`), params("q9")));
  assert.equal(otra.body.already, true);
  assert.equal((await base.db.query(`SELECT count(*)::int AS n FROM "invoices"`)).rows[0].n, 1);
});

test("P6 · «Crear plan» de un presupuesto ya facturado por «Generar factura»: las filas se ligan, sin nota nueva", async (t) => {
  if (salta(t)) return;
  await usar();
  await base.db.query(`INSERT INTO "invoices" ("id","clinicId","patientId","invoiceNumber","items","subtotal","total","balance","status") VALUES ('vieja','c1','pac-c1','F-0001','[]',800,800,800,'PENDING')`);
  await base.db.query(`INSERT INTO "quotes" ("id","clinicId","patientId","folio","title","status","total","acceptedAt","invoiceId") VALUES ('q8','c1','pac-c1','P-0008','Limpieza','ACCEPTED',800, now(), 'vieja')`);
  await base.db.query(`INSERT INTO "quote_items" ("id","quoteId","name","quantity","unitPrice","lineTotal","sortOrder") VALUES ('qi8','q8','Limpieza',1,800,800,0)`);
  ctx.userId = "doc-c1";
  const { POST } = await import("@/app/api/quotes/[id]/treatment-plan/route");
  const r = await leer(await POST(pedir(`/api/quotes/q8/treatment-plan`, { doctorId: "doc-c1" }), params("q8")));
  assert.equal(r.status, 201);
  assert.equal(r.body.notaDelPlan.estado, "nada");
  assert.equal(r.body.notaDelPlan.ligadas, 1);
  const [f] = await filas(r.body.treatmentPlanId);
  assert.equal(f.invoiceId, "vieja");
  assert.equal((await base.db.query(`SELECT count(*)::int AS n FROM "invoices"`)).rows[0].n, 1);
});

test("P6 · la cuenta del plan: total, pagado, saldo; pide billing.view; otra clínica no la ve", async (t) => {
  if (salta(t)) return;
  await usar();
  const creado = await crearPlan();
  const id = creado.body.id;
  await (await import("@/app/api/treatments/[id]/nota-de-cobro/route")).POST(pedir(`/api/treatments/${id}/nota-de-cobro`), params(id));
  await base.db.query(`UPDATE "invoices" SET "paid" = 1000, "status" = 'PARTIAL' WHERE "treatmentPlanId" = $1`, [id]);
  const { GET } = await import("@/app/api/treatments/[id]/cuenta/route");
  const c = await leer(await GET(pedir(`/api/treatments/${id}/cuenta`, undefined, "GET"), params(id)));
  assert.equal(c.status, 200);
  assert.deepEqual([c.body.total, c.body.facturado, c.body.pagado, c.body.saldo, c.body.porFacturar], [5550.75, 5550.75, 1000, 4550.75, 0]);
  assert.equal(c.body.notas.length, 1);
  assert.equal(c.body.soloDelPlan, true);
  ctx.permissionsOverride = ["treatments.view"];
  assert.equal((await GET(pedir(`/api/treatments/${id}/cuenta`, undefined, "GET"), params(id))).status, 403);
  Object.assign(ctx, { clinicId: "c2", userId: "doc-c2", permissionsOverride: null });
  assert.equal((await GET(pedir(`/api/treatments/${id}/cuenta`, undefined, "GET"), params(id))).status, 404);
});

test("P6 · nota-de-cobro: permisos, doctor ajeno, paciente oculto y sin SQL", async (t) => {
  if (salta(t)) return;
  await usar();
  const creado = await crearPlan();
  const id = creado.body.id;
  const { POST } = await import("@/app/api/treatments/[id]/nota-de-cobro/route");
  ctx.permissionsOverride = ["treatments.view", "treatments.edit"];
  assert.equal((await POST(pedir(`/api/treatments/${id}/nota-de-cobro`), params(id))).status, 403, "sin billing.create");
  Object.assign(ctx, { permissionsOverride: null, role: "DOCTOR", isDoctor: true, userId: "otro-doctor" });
  assert.equal((await POST(pedir(`/api/treatments/${id}/nota-de-cobro`), params(id))).status, 403, "plan de otro doctor");
  Object.assign(ctx, { role: "ADMIN", isDoctor: false, userId: "doc-c1" });
  ocultos.add("pac-c1");
  assert.equal((await POST(pedir(`/api/treatments/${id}/nota-de-cobro`), params(id))).status, 404);
  ocultos.clear();
  assert.equal((await base.db.query(`SELECT count(*)::int AS n FROM "invoices"`)).rows[0].n, 0);

  await usar({ conSqlDelPlan: false });
  await sembrarPlan(base.db);
  const sin = await leer(await POST(pedir(`/api/treatments/plan1/nota-de-cobro`), params("plan1")));
  assert.equal(sin.body.estado, "sin_sql");
  assert.equal((await base.db.query(`SELECT count(*)::int AS n FROM "invoices"`)).rows[0].n, 0);
});

test("sin el SQL, aceptar el presupuesto de un plan de antes funciona como hoy (sin nota)", async (t) => {
  if (salta(t)) return;
  await usar({ conSqlDelPlan: false });
  await sembrarPlan(base.db, { totalCost: 800 });
  await base.db.query(`INSERT INTO "quotes" ("id","clinicId","patientId","folio","title","status","total","treatmentPlanId") VALUES ('q7','c1','pac-c1','P-0007','Limpieza','PRESENTED',800,'plan1')`);
  await base.db.query(`INSERT INTO "quote_items" ("id","quoteId","name","quantity","unitPrice","lineTotal","sortOrder") VALUES ('qi7','q7','Limpieza',1,800,800,0)`);
  const r = await aceptar("q7");
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "ACCEPTED");
  assert.equal((await base.db.query(`SELECT count(*)::int AS n FROM "invoices"`)).rows[0].n, 0);
});

// ── Revisión (revisor ws1-t12, 20-oct) ──────────────────────────────────────

test("A1 · plan aceptado a mano, luego presentado y firmado: «Generar factura» NO cobra otra vez", async (t) => {
  if (salta(t)) return;
  await usar();
  const creado = await crearPlan();
  const id = creado.body.id;
  await (await import("@/app/api/treatments/[id]/nota-de-cobro/route")).POST(pedir(`/api/treatments/${id}/nota-de-cobro`), params(id));
  const [n] = await notas(id);
  const { POST } = await import("@/app/api/treatments/[id]/presupuesto/route");
  const q = (await leer(await POST(pedir(`/api/treatments/${id}/presupuesto`, { presentar: true }), params(id)))).body.quote;
  await aceptar(q.id);
  const fila = (await base.db.query(`SELECT "invoiceId" FROM "quotes" WHERE "id" = $1`, [q.id])).rows[0];
  assert.equal(fila.invoiceId, n.id, "el presupuesto sabe que ya lo cobra la nota del plan");
  const { POST: generar } = await import("@/app/api/quotes/[id]/invoice/route");
  const g = await leer(await generar(pedir(`/api/quotes/${q.id}/invoice`, {}), params(q.id)));
  assert.ok(g.status < 300, JSON.stringify(g.body));
  assert.equal((await base.db.query(`SELECT count(*)::int AS n FROM "invoices"`)).rows[0].n, 1, "una sola factura");
});

test("A1 · lo mismo con quote_charges encendida: los conceptos quedan anotados a la nota y no hay nada por cargar", async (t) => {
  if (salta(t)) return;
  await usar({ conAceptacion: true });
  const creado = await crearPlan();
  const id = creado.body.id;
  await (await import("@/app/api/treatments/[id]/nota-de-cobro/route")).POST(pedir(`/api/treatments/${id}/nota-de-cobro`), params(id));
  const [n] = await notas(id);
  const { POST } = await import("@/app/api/treatments/[id]/presupuesto/route");
  const q = (await leer(await POST(pedir(`/api/treatments/${id}/presupuesto`, { presentar: true }), params(id)))).body.quote;
  await aceptar(q.id);
  const cargos = (await base.db.query(`SELECT "invoiceId" FROM "quote_charges" WHERE "quoteId" = $1`, [q.id])).rows;
  assert.equal(cargos.length, 3);
  assert.ok(cargos.every((c: any) => c.invoiceId === n.id));
  const { POST: generar } = await import("@/app/api/quotes/[id]/invoice/route");
  await generar(pedir(`/api/quotes/${q.id}/invoice`, {}), params(q.id));
  assert.equal((await base.db.query(`SELECT count(*)::int AS n FROM "invoices"`)).rows[0].n, 1, "una sola factura");
});

test("A3 · doble clic en «Crear plan» desde un presupuesto: un plan y una nota", async (t) => {
  if (salta(t)) return;
  await usar();
  await base.db.query(`INSERT INTO "quotes" ("id","clinicId","patientId","createdById","folio","title","status","total","acceptedAt") VALUES ('q9','c1','pac-c1','doc-c1','P-0009','Rehabilitación','ACCEPTED',800, now())`);
  await base.db.query(`INSERT INTO "quote_items" ("id","quoteId","name","quantity","unitPrice","lineTotal","sortOrder") VALUES ('qi1','q9','Limpieza',1,800,800,0)`);
  const { POST } = await import("@/app/api/quotes/[id]/treatment-plan/route");
  const [a, b] = await Promise.all([leer(await POST(pedir(`/api/quotes/q9/treatment-plan`), params("q9"))), leer(await POST(pedir(`/api/quotes/q9/treatment-plan`), params("q9")))]);
  assert.equal(a.body.treatmentPlanId, b.body.treatmentPlanId);
  assert.equal((await base.db.query(`SELECT count(*)::int AS n FROM "treatment_plans"`)).rows[0].n, 1);
  assert.equal((await base.db.query(`SELECT count(*)::int AS n FROM "invoices"`)).rows[0].n, 1);
});

test("M1 · nota cancelada: reordenar el plan no cobra nada; una fila nueva se cobra sola", async (t) => {
  if (salta(t)) return;
  await usar();
  const creado = await crearPlan({ items: [ITEMS[0], ITEMS[1]] });
  const id = creado.body.id;
  await (await import("@/app/api/treatments/[id]/nota-de-cobro/route")).POST(pedir(`/api/treatments/${id}/nota-de-cobro`), params(id));
  await base.db.query(`UPDATE "invoices" SET "status" = 'CANCELLED' WHERE "treatmentPlanId" = $1`, [id]);
  const { PATCH } = await import("@/app/api/treatments/[id]/route");
  const reorden = await leer(await PATCH(pedir(`/api/treatments/${id}`, { items: [creado.body.items[1], creado.body.items[0]] }, "PATCH"), params(id)));
  assert.equal(reorden.status, 200);
  assert.equal(reorden.body.notaDelPlan, null, "reordenar no toca la nota");
  assert.equal((await notas(id)).length, 1);
  // Sin presupuesto aceptado y con su única nota cancelada, el plan ya no cuenta como aceptado.
  const crece = await leer(await PATCH(pedir(`/api/treatments/${id}`, { items: [...reorden.body.items, { nombre: "Corona", precio: 5000 }] }, "PATCH"), params(id)));
  assert.equal(crece.body.notaDelPlan.estado, "nada");
  assert.equal((await base.db.query(`SELECT count(*)::int AS n FROM "invoices"`)).rows[0].n, 1);
});

test("M1 · con presupuesto aceptado y su nota cancelada: una fila nueva se cobra sola, lo cancelado no se reabre", async (t) => {
  if (salta(t)) return;
  await usar();
  const creado = await crearPlan({ items: [ITEMS[1]], presentar: true });
  const id = creado.body.id;
  await aceptar(creado.body.presupuesto.id);
  await base.db.query(`UPDATE "invoices" SET "status" = 'CANCELLED' WHERE "treatmentPlanId" = $1`, [id]);
  const { PATCH } = await import("@/app/api/treatments/[id]/route");
  const crece = await leer(await PATCH(pedir(`/api/treatments/${id}`, { items: [...creado.body.items, { nombre: "Corona", precio: 5000 }] }, "PATCH"), params(id)));
  assert.equal(crece.body.notaDelPlan.estado, "creada");
  assert.deepEqual(crece.body.notaDelPlan.omitidas.map((o: any) => o.motivo), ["nota_cancelada"]);
  const nueva = (await notas(id)).find((x: any) => x.status === "PENDING");
  assert.equal(nueva.total, 5000, "solo la fila nueva");
});

test("M2 · sin billing.create, una fila nueva en un plan aceptado no crea factura (queda por facturar)", async (t) => {
  if (salta(t)) return;
  await usar();
  const creado = await crearPlan({ items: [ITEMS[1]] });
  const id = creado.body.id;
  await (await import("@/app/api/treatments/[id]/nota-de-cobro/route")).POST(pedir(`/api/treatments/${id}/nota-de-cobro`), params(id));
  ctx.permissionsOverride = ["treatments.view", "treatments.edit"];
  const { PATCH } = await import("@/app/api/treatments/[id]/route");
  const r = await leer(await PATCH(pedir(`/api/treatments/${id}`, { items: [...creado.body.items, { nombre: "Corona", precio: 5000 }] }, "PATCH"), params(id)));
  assert.equal(r.status, 200);
  assert.equal(r.body.notaDelPlan.estado, "sin_permiso");
  const [n] = await notas(id);
  assert.equal(n.total, 800);
  ctx.permissionsOverride = null;
  const c = await leer(await (await import("@/app/api/treatments/[id]/cuenta/route")).GET(pedir(`/api/treatments/${id}/cuenta`, undefined, "GET"), params(id)));
  assert.equal(c.body.porFacturar, 5000);
});

test("M3 · presupuesto con un abono viejo sin aplicar: la nota no se arma sola (lo lleva el presupuesto)", async (t) => {
  if (salta(t)) return;
  await usar({ conAceptacion: true });
  await base.db.query(`INSERT INTO "invoices" ("id","clinicId","patientId","invoiceNumber","items","subtotal","total","paid","balance","status") VALUES ('ab','c1','pac-c1','F-0001','[]',2000,2000,2000,0,'PAID')`);
  await base.db.query(`INSERT INTO "quotes" ("id","clinicId","patientId","createdById","folio","title","status","total","acceptedAt") VALUES ('q5','c1','pac-c1','doc-c1','P-0005','Rehabilitación','ACCEPTED',8000, now())`);
  await base.db.query(`INSERT INTO "quote_items" ("id","quoteId","name","quantity","unitPrice","lineTotal","sortOrder") VALUES ('qi5','q5','Corona',1,8000,8000,0)`);
  await base.db.query(`INSERT INTO "quote_charges" ("id","clinicId","quoteId","quoteItemId","invoiceId","tipo","monto") VALUES ('c1','c1','q5',NULL,'ab','abono',2000)`);
  const { POST } = await import("@/app/api/quotes/[id]/treatment-plan/route");
  const r = await leer(await POST(pedir(`/api/quotes/q5/treatment-plan`), params("q5")));
  assert.equal(r.status, 201);
  assert.equal(r.body.notaDelPlan.estado, "abono_viejo");
  assert.equal((await base.db.query(`SELECT count(*)::int AS n FROM "invoices"`)).rows[0].n, 1, "solo la del abono");
});

test("B4 · la cuenta de un plan con descuento firmado no enseña el descuento como «por facturar»", async (t) => {
  if (salta(t)) return;
  await usar();
  await base.db.query(`INSERT INTO "quotes" ("id","clinicId","patientId","createdById","folio","title","status","total","discountAmount","acceptedAt") VALUES ('q4','c1','pac-c1','doc-c1','P-0004','Plan','ACCEPTED',9000,1000, now())`);
  await base.db.query(`INSERT INTO "quote_items" ("id","quoteId","name","quantity","unitPrice","lineTotal","sortOrder") VALUES ('qi4','q4','Corona',1,10000,10000,0)`);
  const { POST } = await import("@/app/api/quotes/[id]/treatment-plan/route");
  const r = await leer(await POST(pedir(`/api/quotes/q4/treatment-plan`), params("q4")));
  const [n] = await notas(r.body.treatmentPlanId);
  assert.equal(n.total, 9000, "lo firmado, con su descuento");
  const c = await leer(await (await import("@/app/api/treatments/[id]/cuenta/route")).GET(pedir(`/api/treatments/x/cuenta`, undefined, "GET"), params(r.body.treatmentPlanId)));
  assert.deepEqual([c.body.total, c.body.facturado, c.body.porFacturar], [9000, 9000, 0]);
});
