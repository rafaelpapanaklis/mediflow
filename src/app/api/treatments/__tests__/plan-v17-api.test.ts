/**
 * v17 — las 4 decisiones de Rafael del 28-oct-2026, con los HANDLERS REALES contra un Postgres en memoria
 * (PGlite) con `sql/plan-tratamiento-filas.sql`, `sql/plan-hecho-odontograma.sql` y
 * `sql/plan-tratamiento-citas.sql` pegados dos veces (una transacción cada vez, como el SQL Editor):
 *
 *  1. «Hecho» pregunta en qué cita se hizo: las citas recientes (la de hoy primero) con su nota; «Se hizo
 *     sin cita» con motivo obligatorio (fila sin cita, registro y Movimientos); cita sin nota → aviso, sin
 *     bloquear nada.
 *  2. El detalle de la cita: lo del plan agendado/hecho en esa cita, con precio y estado, y «Debe hoy» =
 *     la cifra de Pacientes, de la ficha y de la cuenta del plan. Lo ve quien ve la cita (doctor incluido).
 *  4. Otro doctor (con `treatments.edit`) marca y deshace «Hecho» en el plan ajeno; editar y cerrar, no.
 *     La ficha le trae los procedimientos de ese plan (`todosLosDoctores=1`).
 *
 * Run: PGLITE_DIR=<carpeta con node_modules/@electric-sql/pglite> npm run test:plan-por-cobrar
 *
 * Los dobles van por `Module._load`. ⛔ Nunca toca una base de verdad. Sin PGlite se SALTA diciéndolo.
 */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { NextRequest } from "next/server";
import { cargarPGlite, crearBase, pegar, type Base } from "@/lib/treatments/__tests__/arnes-pg";

let PGlite: (new () => any) | null = null;
let base: Base;
const prismaVivo: any = {};
const ctx: Record<string, any> = {};
const mutaciones: any[] = [];

const dobles: Record<string, unknown> = {
  "server-only": {},
  "@/lib/prisma": { prisma: prismaVivo },
  "@/lib/auth-context": { getAuthContext: async () => ({ ...ctx }) },
  "@/lib/audit": { logAudit: async () => undefined, logMutation: async (m: any) => { mutaciones.push({ ...m, req: undefined }); }, extractAuditMeta: () => ({}) },
  "@/lib/patient-visibility": {
    assertPatientVisible: async () => null,
    relatedPatientVisibilityAnd: () => [],
    canSeePatient: () => true,
  },
  "@/lib/cache/revalidate": { revalidateAfter: () => undefined, revalidatePatientProfile: () => undefined },
  "next/cache": { revalidatePath: () => undefined, revalidateTag: () => undefined },
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

const DDL = `
  CREATE TABLE "payments" ("id" text PRIMARY KEY, "invoiceId" text NOT NULL, "amount" float8 NOT NULL, "method" text NOT NULL,
    "refundMethod" text, "reference" text, "notes" text, "paidAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE "patient_credits" ("id" text PRIMARY KEY, "clinicId" text NOT NULL, "patientId" text NOT NULL, "amount" float8 NOT NULL,
    "description" text, "source" text NOT NULL DEFAULT 'migrated', "creditDate" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "invoiceId" text, "paymentId" text UNIQUE, "reversesId" text UNIQUE,
    "createdById" text);
  CREATE TABLE "odontogram_entries" (
    "id" text PRIMARY KEY, "patientId" text NOT NULL, "toothNumber" integer NOT NULL, "surface" text,
    "conditionId" text NOT NULL, "notes" text,
    "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL);
  CREATE UNIQUE INDEX "odontogram_entries_k" ON "odontogram_entries" ("patientId", "toothNumber", "surface", "conditionId");
  ALTER TABLE "procedure_catalog" ADD COLUMN "code" text;
  ALTER TABLE "appointments" ADD COLUMN "doctorId" text, ADD COLUMN "type" text, ADD COLUMN "startsAt" timestamptz,
    ADD COLUMN "status" text NOT NULL DEFAULT 'SCHEDULED';
  ALTER TABLE "medical_records" ADD COLUMN "subjective" text, ADD COLUMN "objective" text, ADD COLUMN "assessment" text, ADD COLUMN "plan" text;
`;

async function usar() {
  base = await crearBase(PGlite!);
  await base.db.exec(DDL);
  for (const archivo of ["plan-hecho-odontograma.sql", "plan-tratamiento-citas.sql"]) {
    for (let i = 0; i < 2; i++) {
      const e = await pegar(base.db, archivo);
      if (e) throw new Error(`no entró ${archivo} (vuelta ${i + 1}): ${e}`);
    }
  }
  for (const k of Object.keys(prismaVivo)) delete prismaVivo[k];
  Object.assign(prismaVivo, base.prisma);
  // Sin casos de ortodoncia en estas pruebas (la tabla no está en el arnés).
  prismaVivo.orthodonticTreatmentPlan = { findMany: async () => [] };
  (await import("@/lib/treatments/items-db"))._olvidarSondas();
  (await import("@/lib/treatments/aplicar-hecho-db"))._olvidarSondaHecho();
  (await import("@/lib/treatments/citas-del-plan-db"))._olvidarSondaDeCitas();
  (await import("@/lib/quotes/aceptacion-db"))._olvidarTablas();
  (await import("@/lib/invoices/condiciones-pago-db"))._olvidarTabla();
  await base.db.query(`INSERT INTO "procedure_catalog" ("id","clinicId","name","basePrice","isActive") VALUES ('proc-r','c1','Resina',1250.5,true), ('proc-l','c1','Limpieza',800,true)`);
  // La doctora Ana (la del plan) y el doctor Luis (otro doctor de la misma clínica).
  await base.db.query(`UPDATE "users" SET "firstName" = 'Ana', "lastName" = 'Ruiz' WHERE "id" = 'doc-c1'`);
  await base.db.query(`INSERT INTO "users" ("id","clinicId","role","firstName","lastName") VALUES ('doc-luis','c1','DOCTOR','Luis','Mora')`);
  mutaciones.length = 0;
}

const DIA = 86_400_000;
async function cita(id: string, startsAt: Date, opciones: { status?: string; patientId?: string; clinicId?: string; tipo?: string } = {}) {
  await base.db.query(
    `INSERT INTO "appointments" ("id","clinicId","patientId","doctorId","type","startsAt","status") VALUES ($1,$2,$3,'doc-c1',$4,$5,$6)`,
    [id, opciones.clinicId ?? "c1", opciones.patientId ?? "pac-c1", opciones.tipo ?? "Resina", startsAt, opciones.status ?? "COMPLETED"],
  );
}
async function notaClinica(citaId: string, texto: string | null) {
  await base.db.query(
    `INSERT INTO "medical_records" ("id","clinicId","patientId","specialtyData","subjective") VALUES ($1,'c1','pac-c1',$2,$3)`,
    [`nota-${citaId}`, JSON.stringify({ appointmentId: citaId, status: "DRAFT" }), texto],
  );
}

const pedir = (url: string, body?: unknown, method = "POST") =>
  new NextRequest(`http://x${url}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const leer = async (r: Response) => ({ status: r.status, body: await r.json() });
const filaDe = async (planId: string, nombre: string) =>
  (await base.db.query(`SELECT * FROM "treatment_plan_items" WHERE "planId" = $1 AND "nombre" = $2`, [planId, nombre])).rows[0];

const ITEMS = [
  { nombre: "Resina", procedureId: "proc-r", dientes: "16", caras: "MO", precio: "1250.50", fase: "restauradora", motivo: "Caries" },
  { nombre: "Limpieza", procedureId: "proc-l", precio: 800, fase: "higienica" },
];

before(async () => {
  PGlite = await cargarPGlite();
});

beforeEach(() => {
  for (const k of Object.keys(ctx)) delete ctx[k];
  Object.assign(ctx, { clinicId: "c1", userId: "doc-c1", role: "ADMIN", isDoctor: false, permissionsOverride: null });
});

const salta = (t: { skip: (m: string) => void }) => {
  if (!PGlite) {
    t.skip("PGlite no está: pasa PGLITE_DIR=<carpeta con node_modules/@electric-sql/pglite>");
    return true;
  }
  return false;
};

/** El plan de la doctora Ana (doc-c1), aceptado (nota de cobro de $2,050.50). */
async function planAceptado(): Promise<{ planId: string; notaId: string }> {
  const { POST } = await import("@/app/api/treatments/route");
  const r = await leer(await POST(pedir("/api/treatments", { patientId: "pac-c1", doctorId: "doc-c1", name: "Plan Ana", description: "▸ texto", items: ITEMS })));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const planId = r.body.id as string;
  const { POST: ACEPTAR } = await import("@/app/api/treatments/[id]/nota-de-cobro/route");
  const a = await leer(await ACEPTAR(pedir(`/api/treatments/${planId}/nota-de-cobro`), params(planId)));
  assert.equal(a.status, 201);
  return { planId, notaId: a.body.nota.id };
}

async function pagar(notaId: string, monto: number) {
  await base.db.query(`INSERT INTO "payments" ("id", "invoiceId", "amount", "method", "paidAt") VALUES ($1, $2, $3, 'cash', $4)`, [`pago-${Math.random()}`, notaId, monto, new Date()]);
  await base.db.query(
    `UPDATE "invoices" SET "paid" = "paid" + $2, "balance" = GREATEST(0, "total" - ("paid" + $2)),
       "status" = CASE WHEN "total" - ("paid" + $2) <= 0 THEN 'PAID'::"InvoiceStatus" ELSE 'PARTIAL'::"InvoiceStatus" END WHERE "id" = $1`,
    [notaId, monto],
  );
}

async function hecho(planId: string, cuerpo: Record<string, unknown>) {
  const { PATCH } = await import("@/app/api/treatments/[id]/route");
  return leer(await PATCH(pedir(`/api/treatments/${planId}`, cuerpo, "PATCH"), params(planId)));
}
async function citasParaHecho(planId: string) {
  const { GET } = await import("@/app/api/treatments/[id]/citas-para-hecho/route");
  return leer(await GET(pedir(`/api/treatments/${planId}/citas-para-hecho`, undefined, "GET"), params(planId)));
}
async function planDeLaCita(citaId: string) {
  const { GET } = await import("@/app/api/appointments/[id]/plan-de-la-cita/route");
  return leer(await GET(pedir(`/api/appointments/${citaId}/plan-de-la-cita`, undefined, "GET"), params(citaId)));
}

// ── 1. «Hecho» pregunta en qué cita se hizo ──────────────────────────────────────────────────────

test("v17 · 1: las citas para elegir — la de hoy primero, luego las recientes; sin canceladas, ni de mañana, ni de otro paciente o clínica; con su nota", async (t) => {
  if (salta(t)) return;
  await usar();
  const { planId } = await planAceptado();
  const ahora = Date.now();
  await cita("c-ayer", new Date(ahora - DIA));
  await cita("c-hace10", new Date(ahora - 10 * DIA));
  await cita("c-hoy", new Date(ahora - 60_000), { status: "IN_PROGRESS" });
  await cita("c-cancelada", new Date(ahora - 2 * DIA), { status: "CANCELLED" });
  await cita("c-novino", new Date(ahora - 3 * DIA), { status: "NO_SHOW" });
  await cita("c-manana", new Date(ahora + 2 * DIA), { status: "SCHEDULED" });
  await cita("c-hace90", new Date(ahora - 90 * DIA));
  await cita("c-otro-pac", new Date(ahora - DIA), { patientId: "pac-otro" });
  await cita("c-otra-clinica", new Date(ahora - DIA), { clinicId: "c2", patientId: "pac-c2" });
  await notaClinica("c-ayer", "Resina 16 MO sin complicaciones");
  await notaClinica("c-hace10", null); // borrador vacío: no cuenta como nota

  const r = await citasParaHecho(planId);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.citas.map((c: any) => c.id), ["c-hoy", "c-ayer", "c-hace10"]);
  assert.equal(r.body.citas[0].esHoy, true);
  assert.deepEqual(r.body.citas.map((c: any) => c.tieneNota), [false, true, false]);
  assert.equal(r.body.citas[0].doctor, "Ana Ruiz");
  assert.equal(r.body.citas[0].motivo, "Resina");

  // Quién: el de «Hecho». Recepción sin `treatments.edit`, no; la otra clínica no encuentra el plan.
  Object.assign(ctx, { userId: "rec-c1", role: "RECEPTIONIST", permissionsOverride: ["treatments.view"] });
  assert.equal((await citasParaHecho(planId)).status, 403);
  Object.assign(ctx, { clinicId: "c2", userId: "doc-c2", role: "ADMIN", permissionsOverride: null });
  assert.equal((await citasParaHecho(planId)).status, 404);
  // Otro doctor de la clínica (decisión 4): sí.
  Object.assign(ctx, { clinicId: "c1", userId: "doc-luis", role: "DOCTOR", isDoctor: true });
  assert.equal((await citasParaHecho(planId)).status, 200);
});

test("v17 · 1: con la cita elegida la fila queda en ESA cita; si no tiene nota clínica, la respuesta avisa (y nada se bloquea)", async (t) => {
  if (salta(t)) return;
  await usar();
  const { planId } = await planAceptado();
  await cita("c-hoy", new Date(Date.now() - 60_000), { status: "IN_PROGRESS" });
  const resina = await filaDe(planId, "Resina");

  // Sin pedirlo («Hoy en el sillón»), no se mira la nota (una consulta menos por plan).
  const sinPedir = await hecho(planId, { action: "marcar_hecho", itemIds: [resina.id], citaId: "c-hoy" });
  assert.equal(sinPedir.status, 200);
  assert.equal(sinPedir.body.citaSinNota, undefined);
  await hecho(planId, { action: "deshacer_hecho", itemId: resina.id });

  const m = await hecho(planId, { action: "marcar_hecho", itemIds: [resina.id], citaId: "c-hoy", conCuenta: true, avisarSinNota: true });
  assert.equal(m.status, 200, "una cita sin nota NO impide marcar");
  assert.equal(m.body.citaSinNota, true, "aviso: «Esta cita no tiene nota clínica»");
  assert.equal((await filaDe(planId, "Resina")).citaId, "c-hoy");
  assert.equal((await filaDe(planId, "Resina")).estado, "hecho");
  assert.ok(m.body.cuenta, "y la cuenta viaja igual (el cobro no se bloquea)");
  assert.equal(mutaciones.at(-1).after.citaId, "c-hoy");

  // Con nota escrita, no hay aviso.
  await notaClinica("c-hoy", "Limpieza y resina");
  const limpieza = await filaDe(planId, "Limpieza");
  const m2 = await hecho(planId, { action: "marcar_hecho", itemIds: [limpieza.id], citaId: "c-hoy", avisarSinNota: true });
  assert.equal(m2.status, 200);
  assert.equal(m2.body.citaSinNota, undefined);

  // Una cita de otro paciente no vale (como siempre).
  await hecho(planId, { action: "deshacer_hecho", itemId: limpieza.id });
  await cita("c-otro-pac", new Date(), { patientId: "pac-otro" });
  const otra = await hecho(planId, { action: "marcar_hecho", itemIds: [limpieza.id], citaId: "c-otro-pac" });
  assert.equal(otra.status, 400);
  assert.equal(otra.body.code, "cita_invalida");
});

test("v17 · 1: «Se hizo sin cita» pide motivo; queda en la fila (sin cita), en su registro y en Movimientos; «Deshacer» sigue igual", async (t) => {
  if (salta(t)) return;
  await usar();
  const { planId } = await planAceptado();
  const resina = await filaDe(planId, "Resina");

  for (const motivo of [undefined, "", "  ", "ok"]) {
    const r = await hecho(planId, { action: "marcar_hecho", itemIds: [resina.id], sinCita: true, motivoSinCita: motivo });
    assert.equal(r.status, 400, `motivo ${JSON.stringify(motivo)}`);
    assert.equal(r.body.code, "motivo_sin_cita");
  }
  assert.equal((await filaDe(planId, "Resina")).estado, "pendiente", "sin motivo no se marcó nada");
  // Cita Y «sin cita» a la vez: no.
  await cita("c-hoy", new Date());
  assert.equal((await hecho(planId, { action: "marcar_hecho", itemIds: [resina.id], citaId: "c-hoy", sinCita: true, motivoSinCita: "urgencia" })).body.code, "cita_invalida");

  // La fila traía una cita de antes: «sin cita» la deja sin cita, y «Deshacer» se la devuelve.
  await base.db.query(`UPDATE "treatment_plan_items" SET "citaId" = 'c-hoy' WHERE "id" = $1`, [resina.id]);
  const r = await hecho(planId, { action: "marcar_hecho", itemIds: [resina.id], sinCita: true, motivoSinCita: "  urgencia   en recepción " });
  assert.equal(r.status, 200);
  assert.equal(r.body.sinCita, true);
  assert.equal(r.body.citaSinNota, undefined);
  const f = await filaDe(planId, "Resina");
  assert.equal(f.estado, "hecho");
  assert.equal(f.citaId, null);
  assert.deepEqual(f.odontogramaHecho.sinCita, { motivo: "urgencia en recepción" }, "queda en la fila hecha");
  const mov = mutaciones.at(-1);
  assert.equal(mov.userId, "doc-c1");
  assert.equal(mov.patientId, "pac-c1");
  assert.equal(mov.texto, "Marcó Resina 16 (MO) como hecho sin cita: urgencia en recepción (plan «Plan Ana»)");
  assert.equal(mov.after.motivoSinCita, "urgencia en recepción");

  const d = await hecho(planId, { action: "deshacer_hecho", itemId: resina.id });
  assert.equal(d.status, 200);
  const g = await filaDe(planId, "Resina");
  assert.equal(g.estado, "pendiente");
  assert.equal(g.citaId, "c-hoy", "la cita de antes vuelve");
  assert.match(mutaciones.at(-1).texto, /^Deshizo «hecho» en el plan «Plan Ana»: Resina 16 \(MO\)$/);
});

test("v17 · 1: lo que manda la tarjeta (cliente real contra la ruta real): cita, «sin cita» con motivo y el aviso de nota", async (t) => {
  if (salta(t)) return;
  await usar();
  const { marcarHecho, cuerpoMarcarHecho, errorDeHecho } = await import("@/lib/treatments/marcar-hecho-cliente");
  const { planId } = await planAceptado();
  await cita("c-hoy", new Date());
  const porLaRuta = async (_url: string, init?: RequestInit) => {
    const { PATCH } = await import("@/app/api/treatments/[id]/route");
    return PATCH(new NextRequest(`http://x/api/treatments/${planId}`, { method: "PATCH", body: init?.body as string, headers: { "content-type": "application/json" } }), params(planId));
  };
  assert.deepEqual(cuerpoMarcarHecho(["f"], null, { sinCita: "urgencia" }), { action: "marcar_hecho", itemIds: ["f"], sinCita: true, motivoSinCita: "urgencia" });
  assert.deepEqual(cuerpoMarcarHecho(["f"], "c1", { sinCita: "urgencia" }), { action: "marcar_hecho", itemIds: ["f"], citaId: "c1" }, "con cita, la cita manda");
  assert.deepEqual(cuerpoMarcarHecho(["f"], null, { sinCita: "urgencia", avisarSinNota: true }), { action: "marcar_hecho", itemIds: ["f"], sinCita: true, motivoSinCita: "urgencia" }, "sin cita no hay nota que mirar");

  const resina = await filaDe(planId, "Resina");
  const m = await marcarHecho(planId, [resina.id], "c-hoy", porLaRuta, { conCuenta: true, avisarSinNota: true });
  assert.equal(m.ok, true);
  assert.equal(m.citaSinNota, true);

  const limpieza = await filaDe(planId, "Limpieza");
  const sinMotivo = await marcarHecho(planId, [limpieza.id], null, porLaRuta, { sinCita: "x" });
  assert.equal(sinMotivo.ok, false);
  const { getDict } = await import("@/i18n/dictionaries");
  const { makeT } = await import("@/i18n/t");
  assert.equal(errorDeHecho(makeT(getDict("es")), sinMotivo), "Escribe por qué se hizo sin cita (al menos 3 letras).");
  assert.equal(errorDeHecho(makeT(getDict("en")), sinMotivo), "Write why it was done without an appointment (at least 3 characters).");
  const conMotivo = await marcarHecho(planId, [limpieza.id], null, porLaRuta, { sinCita: "se hizo en la urgencia" });
  assert.equal(conMotivo.ok, true);
  assert.equal(conMotivo.citaSinNota, undefined);
});

// ── 2. El detalle de la cita: lo de esa cita y «Debe hoy» ─────────────────────────────────────────

test("v17 · 2: «En esta cita: Resina $1,250.50 (hecho) · Debe hoy» — agendado y/o hecho en la cita, y Debe hoy = Pacientes = ficha = cuenta del plan", async (t) => {
  if (salta(t)) return;
  await usar();
  const { planId, notaId } = await planAceptado();
  await pagar(notaId, 500);
  await cita("c-hoy", new Date());
  await cita("c-sin-plan", new Date(Date.now() - DIA));
  const resina = await filaDe(planId, "Resina");
  const limpieza = await filaDe(planId, "Limpieza");
  // La limpieza se agendó para esta cita («Agendar lo pendiente»); la resina se hizo en ella.
  await base.db.query(`UPDATE "treatment_plan_items" SET "citaAgendadaId" = 'c-hoy' WHERE "id" = $1`, [limpieza.id]);
  assert.equal((await hecho(planId, { action: "marcar_hecho", itemIds: [resina.id], citaId: "c-hoy" })).status, 200);

  const r = await planDeLaCita("c-hoy");
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.body.filas.map((f: any) => [f.nombre, f.importe, f.estado, f.agendada, f.hechaAqui]),
    [["Resina 16 (MO)", 1250.5, "hecho", false, true], ["Limpieza", 800, "pendiente", true, false]],
  );
  // Debe = lo hecho − lo pagado = 1,250.50 − 500.
  assert.equal(r.body.debeHoy, 750.5);

  // La MISMA cifra que la cuenta del plan, la ficha (saldo − lo que aún no se debe) y Pacientes.
  const { GET: CUENTAS } = await import("@/app/api/treatments/cuentas/route");
  const cuentas = await leer(await CUENTAS(pedir(`/api/treatments/cuentas?patientId=pac-c1`, undefined, "GET")));
  assert.equal(cuentas.body.planes[0].debe, 750.5);
  const { GET: AUN } = await import("@/app/api/patients/[id]/lo-que-aun-no-se-debe/route");
  const aun = await leer(await AUN(pedir(`/api/patients/pac-c1/lo-que-aun-no-se-debe`, undefined, "GET"), params("pac-c1")));
  const saldo = (await base.db.query(`SELECT SUM("balance") AS s FROM "invoices" WHERE "patientId" = 'pac-c1' AND "status"::text NOT IN ('DRAFT','CANCELLED')`)).rows[0].s;
  assert.equal(Math.round((Number(saldo) - aun.body.total) * 100) / 100, 750.5, "ficha: «Debe»");
  const { debeDelPaciente } = await import("@/lib/dinero/lo-que-se-debe.server");
  assert.equal(await debeDelPaciente("c1", "pac-c1"), 750.5, "Pacientes");

  // Deshecha la resina, en la cita queda solo lo agendado y la deuda baja (pagó de más: Debe $0).
  await hecho(planId, { action: "deshacer_hecho", itemId: resina.id });
  const d = await planDeLaCita("c-hoy");
  assert.deepEqual(d.body.filas.map((f: any) => f.nombre), ["Limpieza"]);
  assert.equal(d.body.debeHoy, 0);

  // Una cita sin nada del plan: no sale el bloque (y no se lee el dinero).
  assert.deepEqual((await planDeLaCita("c-sin-plan")).body, { filas: [], debeHoy: null });
});

test("v17 · 2: lo ve todo el que ve la cita (el doctor también); sin `agenda.view`, no; la otra clínica no la encuentra", async (t) => {
  if (salta(t)) return;
  await usar();
  const { planId } = await planAceptado();
  await cita("c-hoy", new Date());
  const resina = await filaDe(planId, "Resina");
  await hecho(planId, { action: "marcar_hecho", itemIds: [resina.id], citaId: "c-hoy" });

  // Un doctor (sus permisos de siempre) — aunque no sea el del plan.
  Object.assign(ctx, { userId: "doc-luis", role: "DOCTOR", isDoctor: true, permissionsOverride: null });
  const r = await planDeLaCita("c-hoy");
  assert.equal(r.status, 200);
  assert.equal(r.body.filas[0].importe, 1250.5);
  assert.equal(r.body.debeHoy, 1250.5);
  // Recepción sin `billing.view` pero con la agenda: también (decisión de Rafael).
  Object.assign(ctx, { userId: "rec-c1", role: "RECEPTIONIST", isDoctor: false, permissionsOverride: ["agenda.view"] });
  assert.equal((await planDeLaCita("c-hoy")).status, 200);
  // Sin ver la agenda: no.
  Object.assign(ctx, { permissionsOverride: ["treatments.view"] });
  assert.equal((await planDeLaCita("c-hoy")).status, 403);
  // La otra clínica.
  Object.assign(ctx, { clinicId: "c2", userId: "doc-c2", role: "ADMIN", permissionsOverride: null });
  assert.equal((await planDeLaCita("c-hoy")).status, 404);
});

// ── 4. «Hecho» en el plan de otro doctor ─────────────────────────────────────────────────────────

test("v17 · 4: otro doctor con `treatments.edit` marca y deshace «Hecho» en el plan ajeno — 200 y Movimientos con su nombre; editar y cerrar siguen siendo solo del suyo", async (t) => {
  if (salta(t)) return;
  await usar();
  const { planId } = await planAceptado();
  await cita("c-hoy", new Date());
  const resina = await filaDe(planId, "Resina");

  Object.assign(ctx, { userId: "doc-luis", role: "DOCTOR", isDoctor: true, permissionsOverride: null });
  const m = await hecho(planId, { action: "marcar_hecho", itemIds: [resina.id], citaId: "c-hoy", conCuenta: true });
  assert.equal(m.status, 200, JSON.stringify(m.body));
  const f = await filaDe(planId, "Resina");
  assert.equal(f.estado, "hecho");
  assert.equal(f.hechoPor, "doc-luis", "quién lo marcó");
  // Movimientos: el autor de la línea es quien la escribió (el nombre sale de `users`, como en consultar.ts).
  const mov = mutaciones.at(-1);
  assert.equal(mov.userId, "doc-luis");
  const autor = (await base.db.query(`SELECT "firstName" || ' ' || "lastName" AS n FROM "users" WHERE "id" = $1`, [mov.userId])).rows[0].n;
  assert.equal(autor, "Luis Mora");
  assert.match(mov.texto, /Marcó como hecho en el plan «Plan Ana»: Resina 16 \(MO\)/);
  assert.ok(m.body.cuenta, "con la cuenta del plan (el doctor ve dinero)");

  const d = await hecho(planId, { action: "deshacer_hecho", itemId: resina.id });
  assert.equal(d.status, 200);
  assert.equal(mutaciones.at(-1).userId, "doc-luis");

  // «Sin cita» también.
  const s = await hecho(planId, { action: "marcar_hecho", itemIds: [resina.id], sinCita: true, motivoSinCita: "urgencia" });
  assert.equal(s.status, 200);
  assert.equal(mutaciones.at(-1).texto, "Marcó Resina 16 (MO) como hecho sin cita: urgencia (plan «Plan Ana»)");

  // Lo demás del plan ajeno, no: editar, cambiar estado, borrar, cerrar.
  assert.equal((await hecho(planId, { status: "PAUSED" })).status, 403);
  assert.equal((await hecho(planId, { name: "Otro nombre" })).status, 403);
  const { DELETE } = await import("@/app/api/treatments/[id]/route");
  assert.equal((await DELETE(pedir(`/api/treatments/${planId}`, undefined, "DELETE"), params(planId))).status, 403);
  const { POST: CERRAR } = await import("@/app/api/treatments/[id]/cerrar/route");
  assert.equal((await CERRAR(pedir(`/api/treatments/${planId}/cerrar`, { motivo: "ya no viene" }), params(planId))).status, 403);

  // Sin `treatments.edit` (la clínica se lo quitó): ni en el ajeno.
  Object.assign(ctx, { permissionsOverride: ["treatments.view", "billing.view"] });
  const limpieza = await filaDe(planId, "Limpieza");
  assert.equal((await hecho(planId, { action: "marcar_hecho", itemIds: [limpieza.id], citaId: "c-hoy" })).status, 403);
});

test("v17 · 4: la ficha le trae al doctor los procedimientos del plan ajeno (`todosLosDoctores=1`, solo con paciente); sin el parámetro, solo los suyos", async (t) => {
  if (salta(t)) return;
  await usar();
  const { planId } = await planAceptado();
  const { GET } = await import("@/app/api/treatments/route");
  Object.assign(ctx, { userId: "doc-luis", role: "DOCTOR", isDoctor: true, permissionsOverride: null });
  const ids = async (url: string) => (await leer(await GET(pedir(url, undefined, "GET")))).body.map((p: any) => p.id);
  assert.deepEqual(await ids("/api/treatments?patientId=pac-c1"), [], "como hoy");
  const todos = await leer(await GET(pedir("/api/treatments?patientId=pac-c1&todosLosDoctores=1", undefined, "GET")));
  assert.deepEqual(todos.body.map((p: any) => p.id), [planId]);
  assert.deepEqual(todos.body[0].items.map((f: any) => f.nombre), ["Resina", "Limpieza"]);
  assert.deepEqual(await ids("/api/treatments?todosLosDoctores=1"), [], "sin paciente no abre la clínica entera");
});
