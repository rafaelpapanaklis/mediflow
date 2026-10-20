/**
 * EL FRENO DE `sql/salamanca-encender-agenda.sql` — WS1-T5 (revisión t8, A10
 * y N-A4), EJECUTADO.
 *
 * Run: PGLITE_DIR=<carpeta con node_modules/@electric-sql/pglite> npm run test:salamanca-agenda
 *
 * Pega el SQL entero en un Postgres en memoria (PGlite), dentro de una
 * transacción como el SQL Editor de Supabase y DOS veces seguidas, sobre unas
 * tablas mínimas con las 6 clínicas de Salamanca y una ajena. ⛔ Nunca toca
 * una base de verdad.
 *
 * PGlite NO es dependencia del repo (aquí no se instala nada): si no se
 * encuentra, la prueba se SALTA diciéndolo, no pasa en verde.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SEIS = [
  "centro-dental",
  "centro-dental-san-felipe",
  "centro-dental-guanajuato",
  "centro-dental-villagran",
  "dental-bas",
  "clan-dental",
];

const sql = (archivo: string) => readFileSync(join(process.cwd(), "sql", archivo), "utf8");

async function cargarPGlite(): Promise<null | (new () => any)> {
  const dir = process.env.PGLITE_DIR;
  const ruta = dir ? join(dir, "node_modules/@electric-sql/pglite/dist/index.js") : null;
  try {
    const mod = ruta && existsSync(ruta) ? await import(pathToFileURL(ruta).href) : await import("@electric-sql/pglite" as string);
    return mod.PGlite;
  } catch {
    return null;
  }
}

type Clinica = { slug: string; duenos: (string | null)[] };

async function base(PGlite: new () => any, clinicas: Clinica[]) {
  const db = new PGlite();
  await db.exec(`
    CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN','ADMIN','DOCTOR','RECEPTIONIST');
    CREATE TABLE "clinics" ("id" text PRIMARY KEY, "slug" text UNIQUE, "name" text);
    CREATE TABLE "users" ("id" text PRIMARY KEY, "supabaseId" text, "clinicId" text, "role" "Role");
    CREATE TABLE "doctor_schedules" ("id" text PRIMARY KEY, "clinicId" text, "doctorId" text, "dayOfWeek" int);
    CREATE TABLE "procedure_catalog" ("id" text PRIMARY KEY, "clinicId" text);
  `);
  let n = 0;
  for (const c of [...clinicas, { slug: "otra-clinica", duenos: ["dueno-ajeno"] }]) {
    n++;
    await db.query(`INSERT INTO "clinics" VALUES ($1, $2, $3)`, [`c${n}`, c.slug, c.slug]);
    for (const [i, d] of c.duenos.entries()) {
      await db.query(`INSERT INTO "users" VALUES ($1, $2, $3, 'SUPER_ADMIN')`, [`u${n}-${i}`, d, `c${n}`]);
    }
    // Un doctor en cada una: no cuenta como dueño.
    await db.query(`INSERT INTO "users" VALUES ($1, $2, $3, 'DOCTOR')`, [`doc${n}`, `doc-${n}`, `c${n}`]);
  }
  return db;
}

/** Pega el archivo como el SQL Editor (una transacción) y devuelve el error, si lo hubo. */
async function pegar(db: any, archivo: string): Promise<string | null> {
  try {
    await db.exec(`BEGIN;\n${sql(archivo)}\n;COMMIT;`);
    return null;
  } catch (e) {
    await db.exec("ROLLBACK").catch(() => undefined);
    return (e as Error).message;
  }
}

async function encendidas(db: any): Promise<string[]> {
  const existe = await db.query(`SELECT to_regclass('public.clinic_feature_flags') IS NOT NULL AS t`);
  if (!existe.rows[0].t) return [];
  const r = await db.query(
    `SELECT c."slug" FROM "clinic_feature_flags" f JOIN "clinics" c ON c."id" = f."clinicId"
      WHERE f."flag" = 'agenda-flexible' AND f."enabled" ORDER BY 1`,
  );
  return r.rows.map((x: { slug: string }) => x.slug);
}

const salamanca = (duenos: (slug: string) => (string | null)[] = () => ["dueno-salamanca"]): Clinica[] =>
  SEIS.map((slug) => ({ slug, duenos: duenos(slug) }));

async function caso(nombre: string, clinicas: Clinica[], esperado: { enciende: string[] } | { freno: RegExp }) {
  test(nombre, async (t) => {
    const PGlite = await cargarPGlite();
    if (!PGlite) {
      t.skip("PGlite no está disponible (PGLITE_DIR): el SQL no se ejecutó");
      return;
    }
    const db = await base(PGlite, clinicas);
    for (const vez of [1, 2]) {
      assert.equal(await pegar(db, "salamanca-agenda.sql"), null, `columnas, vez ${vez}`);
      const error = await pegar(db, "salamanca-encender-agenda.sql");
      if ("enciende" in esperado) {
        assert.equal(error, null, `vez ${vez}`);
        assert.deepEqual(await encendidas(db), [...esperado.enciende].sort(), `vez ${vez}`);
      } else {
        assert.match(error ?? "(no frenó)", esperado.freno, `vez ${vez}`);
        assert.deepEqual(await encendidas(db), [], `vez ${vez}: no se encendió NINGUNA`);
      }
    }
    await db.close();
  });
}

void caso("A10 · las 6 del mismo dueño → enciende las 6 (y la ajena no); dos veces, igual", salamanca(), { enciende: SEIS });

void caso("A10 · falta un slug → frena y no enciende ninguna", salamanca().filter((c) => c.slug !== "dental-bas"), {
  freno: /Freno: se esperaban 6 clínicas y hay 5\. Slugs que no existen: dental-bas/,
});

void caso("A10 · dos dueños distintos → frena", salamanca((s) => [s === "clan-dental" ? "otro-dueno" : "dueno-salamanca"]), {
  freno: /hay 2 dueños distintos/,
});

void caso(
  "N-A4 · una clínica AJENA con el slug genérico «centro-dental» y SIN dueño → frena (antes la encendía)",
  salamanca((s) => (s === "centro-dental" ? [] : ["dueno-salamanca"])),
  { freno: /solo 5 de las 6 clínicas tienen al dueño\. Sin dueño: centro-dental/ },
);

void caso(
  "N-A4 · un SUPER_ADMIN sin supabaseId no cuenta como el dueño → frena",
  salamanca((s) => (s === "dental-bas" ? [null] : ["dueno-salamanca"])),
  { freno: /Sin dueño: dental-bas/ },
);
