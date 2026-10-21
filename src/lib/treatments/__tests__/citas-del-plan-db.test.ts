/**
 * CITAS DEL PLAN EN LA BASE (ws1-t1 · fase 2 · P8) — `sql/plan-tratamiento-citas.sql` y
 * `citas-del-plan-db.ts`, EJECUTADOS contra un Postgres en memoria (PGlite).
 *
 * Run: PGLITE_DIR=<carpeta con node_modules/@electric-sql/pglite> npm run test:plan-citas
 *
 * El SQL entra dos veces seguidas en una transacción (como el SQL Editor) y, antes del de las filas,
 * no hace nada. Sin la columna, el código no la consulta (ni una vez). Con ella: cada clínica ve lo
 * suyo (una fila de otra clínica no llega ni se liga), una cita cancelada libera la fila, la
 * duración sale del tarifario de la MISMA clínica, y el cron amarra fila ↔ plan ↔ cita por clínica.
 * Sin PGlite la prueba se SALTA diciéndolo (no pasa en verde).
 */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Module from "node:module";
import { cargarPGlite, crearBase, sembrarPlan, pegar, type Base } from "./arnes-pg";

let PGlite: (new () => any) | null = null;
const consultas: string[] = [];
const prismaVivo: any = {};

const dobles: Record<string, unknown> = { "@/lib/prisma": { prisma: prismaVivo } };
const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  return req in dobles ? dobles[req] : cargaOriginal.call(this, req, ...r);
};

function usar(b: Base) {
  for (const k of Object.keys(prismaVivo)) delete prismaVivo[k];
  Object.assign(prismaVivo, b.prisma);
  const qr = b.prisma.$queryRaw;
  const er = b.prisma.$executeRaw;
  prismaVivo.$queryRaw = (s: TemplateStringsArray, ...v: unknown[]) => { consultas.push(s.join("?")); return qr(s, ...v); };
  prismaVivo.$executeRaw = (s: TemplateStringsArray, ...v: unknown[]) => { consultas.push(s.join("?")); return er(s, ...v); };
}

const mod = () => import("@/lib/treatments/citas-del-plan-db");
const filasDb = () => import("@/lib/treatments/items-db");
const SQL = "plan-tratamiento-citas.sql";
const HORA = 60 * 60 * 1000;

/** Las columnas de `appointments` y `procedure_catalog` que esto lee (el arnés trae solo id/clinicId). */
async function completarEsquema(db: any) {
  await db.exec(`
    CREATE TYPE "AppointmentStatus" AS ENUM ('PENDING','SCHEDULED','CONFIRMED','CHECKED_IN','IN_CHAIR','IN_PROGRESS','COMPLETED','CHECKED_OUT','CANCELLED','NO_SHOW');
    ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "patientId" text, ADD COLUMN "startsAt" timestamp(3), ADD COLUMN "endsAt" timestamp(3),
      ADD COLUMN "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED';
    ALTER TABLE "procedure_catalog" ADD COLUMN "duration" integer;
  `);
}

async function baseCompleta(opciones: { conSqlDeCitas?: boolean } = {}): Promise<Base> {
  const b = await crearBase(PGlite!);
  await completarEsquema(b.db);
  if (opciones.conSqlDeCitas !== false) {
    for (let i = 0; i < 2; i++) assert.equal(await pegar(b.db, SQL), null, `vuelta ${i + 1}`);
  }
  usar(b);
  return b;
}

async function fila(db: any, id: string, extra: { clinicId?: string; planId?: string; estado?: string; procedureId?: string | null; cantidad?: number; citaAgendadaId?: string | null } = {}) {
  await db.query(
    `INSERT INTO "treatment_plan_items" ("id","clinicId","planId","nombre","estado","procedureId","cantidad","citaAgendadaId","dientes")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'{16}')`,
    [id, extra.clinicId ?? "c1", extra.planId ?? "plan1", `Proc ${id}`, extra.estado ?? "pendiente", extra.procedureId ?? null, extra.cantidad ?? 1, extra.citaAgendadaId ?? null],
  );
}

async function cita(db: any, id: string, extra: { clinicId?: string; status?: string; inicio?: Date; fin?: Date } = {}) {
  const inicio = extra.inicio ?? new Date(Date.now() + 24 * HORA);
  const fin = extra.fin ?? new Date(inicio.getTime() + HORA);
  await db.query(
    `INSERT INTO "appointments" ("id","clinicId","patientId","startsAt","endsAt","status") VALUES ($1,$2,$3,$4,$5,$6::"AppointmentStatus")`,
    [id, extra.clinicId ?? "c1", `pac-${extra.clinicId ?? "c1"}`, inicio.toISOString(), fin.toISOString(), extra.status ?? "SCHEDULED"],
  );
}

before(async () => {
  PGlite = await cargarPGlite();
});

beforeEach(async () => {
  consultas.length = 0;
  (await mod())._olvidarSondaDeCitas();
  (await filasDb())._olvidarSondas();
});

const salta = (t: { skip: (m: string) => void }) => {
  if (!PGlite) {
    t.skip("PGlite no está: pasa PGLITE_DIR=<carpeta con node_modules/@electric-sql/pglite>");
    return true;
  }
  return false;
};

test("el SQL entra dos veces, crea las 3 columnas y la llave a appointments una sola vez", async (t) => {
  if (salta(t)) return;
  const b = await baseCompleta();
  const cols = await b.db.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'treatment_plan_items' AND column_name IN ('citaAgendadaId','agendadaEn','agendadaPor') ORDER BY column_name`,
  );
  assert.deepEqual(cols.rows.map((r: any) => `${r.column_name}:${r.data_type}`), [
    "agendadaEn:timestamp without time zone",
    "agendadaPor:text",
    "citaAgendadaId:text",
  ]);
  const fks = await b.db.query(
    `SELECT count(*)::int AS n FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage u ON u.constraint_name = tc.constraint_name
      WHERE tc.table_name = 'treatment_plan_items' AND tc.constraint_type = 'FOREIGN KEY' AND u.table_name = 'appointments'`,
  );
  // citaId (la de «hecho», del SQL de las filas) + citaAgendadaId: dos, aunque se pegó dos veces.
  assert.equal(fks.rows[0].n, 2);
  // Borrar la cita deja la liga en NULL (la fila no se pierde).
  await sembrarPlan(b.db);
  await cita(b.db, "a1");
  await fila(b.db, "f1", { citaAgendadaId: "a1" });
  await b.db.query(`DELETE FROM "appointments" WHERE "id" = 'a1'`);
  const r = await b.db.query(`SELECT "citaAgendadaId" FROM "treatment_plan_items" WHERE "id" = 'f1'`);
  assert.equal(r.rows[0].citaAgendadaId, null);
});

test("pegado ANTES del SQL de las filas no hace nada ni falla (y luego entra bien)", async (t) => {
  if (salta(t)) return;
  const b = await crearBase(PGlite!, { conSqlDelPlan: false });
  await completarEsquema(b.db);
  assert.equal(await pegar(b.db, SQL), null);
  const existe = await b.db.query(`SELECT to_regclass('public.treatment_plan_items') IS NOT NULL AS e`);
  assert.equal(existe.rows[0].e, false);
  assert.equal(await pegar(b.db, "plan-tratamiento-filas.sql"), null);
  assert.equal(await pegar(b.db, SQL), null);
  const n = await b.db.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'treatment_plan_items' AND column_name = 'citaAgendadaId'`);
  assert.equal(n.rows[0].n, 1);
});

test("el SQL no tiene DROP, DELETE ni UPDATE de datos, y usa delimitador con nombre", () => {
  const sql = readFileSync(join(process.cwd(), "sql", SQL), "utf8").replace(/--[^\n]*/g, "");
  assert.doesNotMatch(sql, /\bDROP\b/i);
  // «ON DELETE SET NULL» / «ON UPDATE CASCADE» de la llave sí; borrar o reescribir datos, no.
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(sql, /\bUPDATE\s+"/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
  assert.doesNotMatch(sql, /\$\$/);
  assert.match(sql, /\$tpc\$/);
});

test("sin la columna: disponible=false y nunca se consulta la tabla ni la columna", async (t) => {
  if (salta(t)) return;
  await baseCompleta({ conSqlDeCitas: false });
  const m = await mod();
  for (let i = 0; i < 5; i++) assert.equal(await m.citasDelPlanDisponible(), false);
  assert.ok(consultas.every((c) => !/FROM "treatment_plan_items"/.test(c)), "no se lee la tabla");
  // Una sola pregunta por la columna (y una por la tabla): la respuesta se recuerda.
  assert.equal(consultas.filter((c) => c.includes("citaAgendadaId")).length, 1);
});

test("leerFilasParaLigar: la fila de OTRA clínica no llega; la cita cancelada viene con su estado", async (t) => {
  if (salta(t)) return;
  const b = await baseCompleta();
  await sembrarPlan(b.db);
  await sembrarPlan(b.db, { id: "plan2", clinicId: "c2" });
  await cita(b.db, "a1", { status: "CANCELLED" });
  await fila(b.db, "f1", { citaAgendadaId: "a1" });
  await fila(b.db, "f2");
  await fila(b.db, "ajena", { clinicId: "c2", planId: "plan2" });
  const m = await mod();
  assert.equal(await m.citasDelPlanDisponible(), true);
  const filas = await b.prisma.$transaction((tx: any) => m.leerFilasParaLigar(tx, "c1", ["f1", "f2", "ajena"]));
  assert.deepEqual(filas.map((f: any) => f.id).sort(), ["f1", "f2"]);
  const f1 = filas.find((f: any) => f.id === "f1");
  assert.equal(f1.cita.status, "CANCELLED");
  assert.equal(f1.planPatientId, "pac-c1");
  assert.equal(f1.planDoctorId, "doc-c1");
  assert.equal(f1.planStatus, "ACTIVE", "el estado del plan llega como texto (el servidor no agenda de un plan pausado)");
  // Y desde la clínica ajena, las de c1 no llegan.
  const desdeC2 = await b.prisma.$transaction((tx: any) => m.leerFilasParaLigar(tx, "c2", ["f1", "f2", "ajena"]));
  assert.deepEqual(desdeC2.map((f: any) => f.id), ["ajena"]);
});

test("una cita de OTRA clínica ligada a la fila no cuenta (el JOIN exige la misma clínica)", async (t) => {
  if (salta(t)) return;
  const b = await baseCompleta();
  await sembrarPlan(b.db);
  await cita(b.db, "a-ajena", { clinicId: "c2" });
  await fila(b.db, "f1", { citaAgendadaId: "a-ajena" });
  const m = await mod();
  const [f] = await b.prisma.$transaction((tx: any) => m.leerFilasParaLigar(tx, "c1", ["f1"]));
  assert.equal(f.cita, null);
});

test("ligarFilasACita: solo pendientes o en curso de ESTA clínica; deja quién y cuándo", async (t) => {
  if (salta(t)) return;
  const b = await baseCompleta();
  await sembrarPlan(b.db);
  await sembrarPlan(b.db, { id: "plan2", clinicId: "c2" });
  await cita(b.db, "nueva");
  await fila(b.db, "f1");
  await fila(b.db, "f2", { estado: "en_curso" });
  await fila(b.db, "hecha", { estado: "hecho" });
  await fila(b.db, "ajena", { clinicId: "c2", planId: "plan2" });
  const m = await mod();
  const n = await b.prisma.$transaction((tx: any) =>
    m.ligarFilasACita(tx, { clinicId: "c1", appointmentId: "nueva", ids: ["f1", "f2", "hecha", "ajena"], userId: "u1" }),
  );
  assert.equal(n, 2);
  const r = await b.db.query(`SELECT "id", "citaAgendadaId", "agendadaPor", "agendadaEn" IS NOT NULL AS cuando FROM "treatment_plan_items" ORDER BY "id"`);
  const porId = Object.fromEntries(r.rows.map((x: any) => [x.id, x]));
  assert.equal(porId.f1.citaAgendadaId, "nueva");
  assert.equal(porId.f1.agendadaPor, "u1");
  assert.equal(porId.f1.cuando, true);
  assert.equal(porId.f2.citaAgendadaId, "nueva");
  assert.equal(porId.hecha.citaAgendadaId, null);
  assert.equal(porId.ajena.citaAgendadaId, null, "la de otra clínica no se toca");
});

test("filasDelPlanParaAgendar: duración del tarifario de la MISMA clínica, sin canceladas, en orden", async (t) => {
  if (salta(t)) return;
  const b = await baseCompleta();
  await sembrarPlan(b.db);
  await b.db.query(`INSERT INTO "procedure_catalog" ("id","clinicId","name","duration") VALUES ('p1','c1','Resina',45), ('p-ajeno','c2','Resina',99)`);
  await fila(b.db, "f1", { procedureId: "p1", cantidad: 2 });
  await fila(b.db, "f2", { procedureId: "p-ajeno" });
  await fila(b.db, "f3", { estado: "cancelado" });
  await b.db.query(`UPDATE "treatment_plan_items" SET "orden" = CASE "id" WHEN 'f1' THEN 2 WHEN 'f2' THEN 1 ELSE 0 END`);
  const m = await mod();
  const filas = await m.filasDelPlanParaAgendar("c1", "plan1");
  assert.deepEqual(filas.map((f) => f.id), ["f2", "f1"]);
  assert.equal(filas.find((f) => f.id === "f1")!.minutos, 45);
  assert.equal(filas.find((f) => f.id === "f1")!.cantidad, 2);
  assert.equal(filas.find((f) => f.id === "f2")!.minutos, null, "el tarifario de otra clínica no presta su duración");
  assert.deepEqual(await m.filasDelPlanParaAgendar("c2", "plan1"), [], "otra clínica no ve el plan");
  await assert.rejects(m.filasDelPlanParaAgendar("", "plan1"), /clinicId ausente/);
});

test("filasAgendadasEnCita: las de ESA cita y ESA clínica, sin canceladas; sin el SQL, [] sin consultar", async (t) => {
  if (salta(t)) return;
  const b = await baseCompleta();
  await sembrarPlan(b.db);
  await sembrarPlan(b.db, { id: "plan2", clinicId: "c2" });
  await cita(b.db, "a1");
  await fila(b.db, "f1", { citaAgendadaId: "a1" });
  await fila(b.db, "f2", { citaAgendadaId: "a1", estado: "cancelado" });
  await fila(b.db, "f3");
  const m = await mod();
  assert.deepEqual((await m.filasAgendadasEnCita("c1", "a1")).map((f) => f.id), ["f1"]);
  assert.deepEqual(await m.filasAgendadasEnCita("c2", "a1"), [], "otra clínica no ve las filas de c1");
  assert.deepEqual(await m.filasAgendadasEnCita("c1", ""), []);

  await baseCompleta({ conSqlDeCitas: false });
  m._olvidarSondaDeCitas();
  (await filasDb())._olvidarSondas();
  consultas.length = 0;
  assert.deepEqual(await m.filasAgendadasEnCita("c1", "a1"), []);
  assert.ok(consultas.every((c) => !/FROM "treatment_plan_items"/.test(c)));
});

test("filasParaSeguimiento (cron): canceladas incluidas y la cita solo si es de la misma clínica", async (t) => {
  if (salta(t)) return;
  const b = await baseCompleta();
  await sembrarPlan(b.db);
  await cita(b.db, "a1");
  await cita(b.db, "a-ajena", { clinicId: "c2" });
  await fila(b.db, "f1", { citaAgendadaId: "a1" });
  await fila(b.db, "f2", { citaAgendadaId: "a-ajena" });
  await fila(b.db, "f3", { estado: "cancelado" });
  const m = await mod();
  const mapa = await m.filasParaSeguimiento(["plan1", "plan-que-no-existe"]);
  const filas = mapa.get("plan1")!;
  assert.equal(filas.length, 3);
  assert.equal(filas.filter((f) => f.cita?.id === "a1").length, 1);
  assert.equal(filas.filter((f) => f.cita?.id === "a-ajena").length, 0);
  assert.equal(mapa.has("plan-que-no-existe"), false);
});
