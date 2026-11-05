/**
 * `sql/cita-sin-doctor.sql` en un Postgres EN MEMORIA (PGlite) con el DDL REAL
 * de `appointments` (ws1-t11 · fase 2 · P1). ⛔ Nunca toca una base de verdad.
 *
 * Run: PGLITE_DIR=<carpeta con node_modules/@electric-sql/pglite> npm run test:cita-sin-doctor
 * Sin PGLITE_DIR las pruebas se SALTAN diciéndolo.
 *
 * El DDL de la tabla es el que da `prisma migrate diff --from-empty` sobre el
 * esquema de la base (doctorId NOT NULL); la constraint de no-solape, la de
 * sillón y el trigger del apartado se leen TAL CUAL de sus archivos del repo
 * (la migración de la fase 4 y sql/anticipo-whatsapp.sql). El SQL nuevo se
 * pega como lo pega Rafael: el archivo entero, DOS veces.
 *
 * Fija:
 *  · antes del SQL, una cita sin doctor no entra (23502): el SQL es lo que la permite;
 *  · después, dos «Sin doctor» a la misma hora entran; en el MISMO sillón, no (23P01);
 *  · el no-solape del doctor sigue igual; asignarle a una «Sin doctor» un doctor
 *    ocupado a esa hora lo para la constraint (las rutas lo convierten en 409);
 *  · el trigger del apartado vencido libera por sillón también a las «Sin doctor».
 */
process.env.TZ = "UTC";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const RAIZ = resolve(__dirname, "../../../..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

/** El `CREATE TABLE "appointments"` de `prisma migrate diff --from-empty` sobre el esquema de la base (c16847f9d). */
const TABLA_APPOINTMENTS = `
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(6) NOT NULL,
    "endsAt" TIMESTAMPTZ(6) NOT NULL,
    "resourceId" TEXT,
    "source" "AppointmentSource" NOT NULL DEFAULT 'STAFF',
    "requiresValidation" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" VARCHAR(500),
    "overriddenBy" TEXT,
    "overriddenAt" TIMESTAMPTZ(6),
    "checkedInAt" TIMESTAMPTZ(6),
    "startedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "room" TEXT,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "reminderSent" BOOLEAN NOT NULL DEFAULT false,
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "googleCalendarEventId" TEXT,
    "price" DOUBLE PRECISION,
    "stripePaymentIntentId" TEXT,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "mode" "AppointmentMode" NOT NULL DEFAULT 'IN_PERSON',
    "teleRoomId" TEXT,
    "teleRoomUrl" TEXT,
    "teleDoctorToken" TEXT,
    "telePatientToken" TEXT,
    "teleRecordingUrl" TEXT,
    "paymentStatus" TEXT,
    "paymentAmount" DOUBLE PRECISION,
    "stripePaymentId" TEXT,
    "stripeSessionId" TEXT,
    "confirmToken" TEXT,
    "holdExpiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
`;

const BASE = `
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TYPE "AppointmentMode" AS ENUM ('IN_PERSON', 'TELECONSULTATION');
CREATE TYPE "AppointmentStatus" AS ENUM ('PENDING', 'SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'IN_CHAIR', 'IN_PROGRESS', 'COMPLETED', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW');
CREATE TYPE "AppointmentSource" AS ENUM ('STAFF', 'PATIENT_PORTAL', 'WEBSITE', 'WHATSAPP');
CREATE TABLE "clinics" ("id" TEXT PRIMARY KEY);
CREATE TABLE "patients" ("id" TEXT PRIMARY KEY);
CREATE TABLE "users" ("id" TEXT PRIMARY KEY);
CREATE TABLE "Resource" ("id" TEXT PRIMARY KEY);
${TABLA_APPOINTMENTS}
`;

/** La constraint de no-solape (doctor y sillón) y la de duración, tal cual de la migración de la fase 4. */
function constraintsDeLaFase4(): string {
  const m = leer("prisma/migrations/20260424120000_fase_4_agenda/migration.sql");
  const desde = m.indexOf('ALTER TABLE "appointments"\n  ADD CONSTRAINT appt_positive_duration');
  const hasta = m.indexOf("COMMENT ON CONSTRAINT appt_doctor_no_overlap");
  assert.ok(desde > 0 && hasta > desde, "no encontré las constraints en la migración");
  const trozo = m.slice(desde, hasta);
  assert.match(trozo, /appt_doctor_no_overlap[\s\S]*"doctorId" WITH =/);
  assert.match(trozo, /appt_resource_no_overlap/);
  return trozo;
}

/** El trigger del apartado vencido, tal cual de sql/anticipo-whatsapp.sql. */
function triggerDelApartado(): string {
  const s = leer("sql/anticipo-whatsapp.sql");
  const desde = s.indexOf('CREATE OR REPLACE FUNCTION "appt_liberar_apartado_vencido"');
  const crea = s.indexOf('CREATE TRIGGER "appt_liberar_apartado_vencido"', desde);
  const hasta = s.indexOf("$anticipo$;", crea) + "$anticipo$;".length;
  assert.ok(desde > 0 && crea > desde && hasta > crea, "no encontré el trigger");
  return s.slice(desde, hasta);
}

async function abrir(): Promise<any | null> {
  const dir = process.env.PGLITE_DIR;
  const base = dir ? join(dir, "node_modules/@electric-sql/pglite/dist") : null;
  if (!base || !existsSync(join(base, "index.js"))) return null;
  const { PGlite } = await import(pathToFileURL(join(base, "index.js")).href);
  const { btree_gist } = await import(pathToFileURL(join(base, "contrib/btree_gist.js")).href);
  const db = new PGlite({ extensions: { btree_gist } });
  await db.exec(BASE);
  await db.exec(constraintsDeLaFase4());
  await db.exec(triggerDelApartado());
  await db.exec(`INSERT INTO "clinics" VALUES ('c1'); INSERT INTO "patients" VALUES ('p1'), ('p2'), ('p3');
                 INSERT INTO "users" VALUES ('clx9doc0a000108l4aaaa0001'), ('seed-doctor-2');
                 INSERT INTO "Resource" VALUES ('res_sillon_1'), ('res_sillon_2');`);
  return db;
}
const SIN_PGLITE = "sin PGLITE_DIR (carpeta con node_modules/@electric-sql/pglite): prueba saltada";

const DRA = "clx9doc0a000108l4aaaa0001";
let n = 0;
async function cita(db: any, c: { doctorId: string | null; resourceId?: string | null; desde: string; hasta: string; patientId?: string; status?: string; holdExpiresAt?: string | null }) {
  n++;
  const id = `cmh0sd${String(n).padStart(6, "0")}`;
  await db.query(
    `INSERT INTO "appointments" ("id","clinicId","patientId","doctorId","type","startsAt","endsAt","resourceId","status","holdExpiresAt","updatedAt")
     VALUES ($1,'c1',$2,$3,'Limpieza',$4,$5,$6,$7::"AppointmentStatus",$8, now())`,
    [id, c.patientId ?? "p1", c.doctorId, c.desde, c.hasta, c.resourceId ?? null, c.status ?? "SCHEDULED", c.holdExpiresAt ?? null],
  );
  return id;
}
async function codigoDe(p: Promise<unknown>): Promise<string | null> {
  try { await p; return null; } catch (e: any) { return e?.code ?? String(e?.message ?? e); }
}
const H10 = "2026-11-10T16:00:00Z";
const H1030 = "2026-11-10T16:30:00Z";

test("el DDL de la prueba tiene TODAS las columnas escalares de `model Appointment`", () => {
  const modelo = leer("prisma/schema.prisma").match(/^model Appointment \{([\s\S]*?)^\}/m)![1];
  const escalares = [...modelo.matchAll(/^\s+(\w+)\s+(String|DateTime|Boolean|Float|Int|AppointmentStatus|AppointmentSource|AppointmentMode)\??\b/gm)].map((m) => m[1]);
  assert.ok(escalares.length > 30);
  for (const c of escalares) assert.match(TABLA_APPOINTMENTS, new RegExp(`"${c}" `), `falta "${c}"`);
});

test("antes del SQL una cita sin doctor no entra (23502); el SQL ×2 la permite y la columna queda nullable", async (t) => {
  const db = await abrir();
  if (!db) return t.skip(SIN_PGLITE);
  assert.equal(await codigoDe(cita(db, { doctorId: null, desde: H10, hasta: H1030 })), "23502");
  const sql = leer("sql/cita-sin-doctor.sql");
  for (let vez = 1; vez <= 2; vez++) {
    const r = await db.exec(sql);
    const ultima = r[r.length - 1];
    assert.equal(ultima.rows[0].is_nullable, "YES", `vez ${vez}`);
  }
  assert.equal(await codigoDe(cita(db, { doctorId: null, desde: H10, hasta: H1030 })), null);
  // La FK, la constraint del doctor y la del sillón siguen ahí (el SQL no las toca).
  const r = await db.query(`SELECT conname FROM pg_constraint WHERE conrelid = '"appointments"'::regclass ORDER BY conname`);
  const nombres = r.rows.map((x: any) => x.conname);
  for (const c of ["appointments_doctorId_fkey", "appt_doctor_no_overlap", "appt_resource_no_overlap", "appt_positive_duration"]) {
    assert.ok(nombres.includes(c), `falta ${c}`);
  }
  const trg = await db.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'appt_liberar_apartado_vencido'`);
  assert.equal(trg.rows[0].n, 1);
});

test("con el SQL: «Sin doctor» no choca con «Sin doctor» ni con un doctor; el sillón y el doctor siguen protegidos", async (t) => {
  const db = await abrir();
  if (!db) return t.skip(SIN_PGLITE);
  await db.exec(leer("sql/cita-sin-doctor.sql"));
  // Varias «Sin doctor» a la misma hora, sin sillón: entran (Salamanca agenda así).
  assert.equal(await codigoDe(cita(db, { doctorId: null, desde: H10, hasta: H1030 })), null);
  assert.equal(await codigoDe(cita(db, { doctorId: null, desde: H10, hasta: H1030, patientId: "p2" })), null);
  // Una con doctor a la misma hora, también.
  assert.equal(await codigoDe(cita(db, { doctorId: DRA, desde: H10, hasta: H1030, patientId: "p3" })), null);
  // Otra del MISMO doctor: la constraint de siempre.
  assert.equal(await codigoDe(cita(db, { doctorId: DRA, desde: H10, hasta: H1030 })), "23P01");
  // «Sin doctor» en un sillón ocupado: choca por el sillón.
  await cita(db, { doctorId: null, resourceId: "res_sillon_1", desde: H10, hasta: H1030 });
  assert.equal(await codigoDe(cita(db, { doctorId: null, resourceId: "res_sillon_1", desde: H10, hasta: H1030, patientId: "p2" })), "23P01");
  assert.equal(await codigoDe(cita(db, { doctorId: null, resourceId: "res_sillon_2", desde: H10, hasta: H1030, patientId: "p2" })), null);
});

test("con el SQL: asignarle a una «Sin doctor» un doctor ocupado a esa hora lo para la constraint (23P01)", async (t) => {
  const db = await abrir();
  if (!db) return t.skip(SIN_PGLITE);
  await db.exec(leer("sql/cita-sin-doctor.sql"));
  await cita(db, { doctorId: DRA, desde: H10, hasta: H1030 });
  const sin = await cita(db, { doctorId: null, desde: H10, hasta: H1030, patientId: "p2" });
  assert.equal(await codigoDe(db.query(`UPDATE "appointments" SET "doctorId" = $1 WHERE "id" = $2`, [DRA, sin])), "23P01");
  assert.equal(await codigoDe(db.query(`UPDATE "appointments" SET "doctorId" = 'seed-doctor-2' WHERE "id" = $1`, [sin])), null);
  // Y volver a «Sin doctor».
  assert.equal(await codigoDe(db.query(`UPDATE "appointments" SET "doctorId" = NULL WHERE "id" = $1`, [sin])), null);
});

test("con el SQL: el trigger del apartado vencido libera por sillón también a una «Sin doctor»", async (t) => {
  const db = await abrir();
  if (!db) return t.skip(SIN_PGLITE);
  await db.exec(leer("sql/cita-sin-doctor.sql"));
  const apartada = await cita(db, { doctorId: null, resourceId: "res_sillon_1", desde: H10, hasta: H1030, holdExpiresAt: "2026-01-01T00:00:00Z" });
  assert.equal(await codigoDe(cita(db, { doctorId: null, resourceId: "res_sillon_1", desde: H10, hasta: H1030, patientId: "p2" })), null);
  const r = await db.query(`SELECT "status"::text AS s FROM "appointments" WHERE "id" = $1`, [apartada]);
  assert.equal(r.rows[0].s, "CANCELLED");
});
