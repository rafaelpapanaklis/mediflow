/**
 * LAS FILAS DEL PLAN EN LA BASE (ws1-t12 · P1) — `sql/plan-tratamiento-filas.sql` y `items-db.ts`,
 * EJECUTADOS contra un Postgres en memoria (PGlite).
 *
 * Run: PGLITE_DIR=<carpeta con node_modules/@electric-sql/pglite> npm run test:plan-filas
 *
 * El SQL entra dos veces seguidas en una transacción (como el SQL Editor). Sin él, el código no
 * consulta la tabla (ni una sola vez). Con él: centavos exactos, nada se borra, la fila cobrada no
 * cambia de precio ni con un plan de cambios falsificado, cada clínica ve lo suyo.
 * Sin PGlite la prueba se SALTA diciéndolo (no pasa en verde).
 */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { cargarPGlite, crearBase, sembrarPlan, pegar, type Base } from "./arnes-pg";

let PGlite: (new () => any) | null = null;
let base: Base;
const consultas: string[] = [];
const prismaVivo: any = {};

// Todo doble por Module._load (como herencia-agenda-flexible.test.ts): el prisma de PGlite, contado.
const dobles: Record<string, unknown> = { "@/lib/prisma": { prisma: prismaVivo } };
const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  return req in dobles ? dobles[req] : cargaOriginal.call(this, req, ...r);
};

function usar(b: Base) {
  base = b;
  for (const k of Object.keys(prismaVivo)) delete prismaVivo[k];
  Object.assign(prismaVivo, b.prisma);
  const qr = b.prisma.$queryRaw;
  const er = b.prisma.$executeRaw;
  prismaVivo.$queryRaw = (s: TemplateStringsArray, ...v: unknown[]) => { consultas.push(s.join("?")); return qr(s, ...v); };
  prismaVivo.$executeRaw = (s: TemplateStringsArray, ...v: unknown[]) => { consultas.push(s.join("?")); return er(s, ...v); };
}

const mod = () => import("@/lib/treatments/items-db");
const contrato = () => import("@/lib/treatments/items");

before(async () => {
  PGlite = await cargarPGlite();
});

beforeEach(async () => {
  consultas.length = 0;
  (await mod())._olvidarSondas();
});

const salta = (t: { skip: (m: string) => void }) => {
  if (!PGlite) {
    t.skip("PGlite no está: pasa PGLITE_DIR=<carpeta con node_modules/@electric-sql/pglite>");
    return true;
  }
  return false;
};

test("el SQL entra dos veces, crea 26 columnas, la columna de la nota y el candado RLS", async (t) => {
  if (salta(t)) return;
  const b = await crearBase(PGlite!); // ya lo pegó dos veces
  const cols = await b.db.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'treatment_plan_items'`);
  assert.equal(cols.rows[0].n, 26);
  const col = await b.db.query(`SELECT data_type FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'treatmentPlanId'`);
  assert.equal(col.rows[0].data_type, "text");
  const pol = await b.db.query(`SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'treatment_plan_items'`);
  assert.equal(pol.rows[0].n, 1, "una sola política aunque se pegó dos veces");
  const fks = await b.db.query(`SELECT count(*)::int AS n FROM information_schema.table_constraints WHERE table_name = 'invoices' AND constraint_type = 'FOREIGN KEY'`);
  assert.equal(fks.rows[0].n, 2, "clinicId + treatmentPlanId: la segunda pasada no duplica la llave");
  // Una tercera, ya con datos, tampoco cambia nada.
  await sembrarPlan(b.db);
  await b.db.query(`INSERT INTO "treatment_plan_items" ("id","clinicId","planId","nombre","precio") VALUES ('f1','c1','plan1','Resina',1250.5)`);
  assert.equal(await pegar(b.db, "plan-tratamiento-filas.sql"), null);
  assert.equal((await b.db.query(`SELECT "precio"::text AS p FROM "treatment_plan_items"`)).rows[0].p, "1250.50");
  // El estado solo admite los cuatro.
  await assert.rejects(b.db.query(`INSERT INTO "treatment_plan_items" ("id","clinicId","planId","nombre","estado") VALUES ('f2','c1','plan1','X','borrado')`));
});

test("el SQL no tiene DROP, DELETE ni UPDATE de datos, y usa delimitadores con nombre", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync("sql/plan-tratamiento-filas.sql", "utf8").replace(/--.*$/gm, "");
  assert.doesNotMatch(sql, /\bDROP\b/i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(sql, /\bUPDATE\s+"/i);
  assert.doesNotMatch(sql, /\$\$/);
  assert.match(sql, /\$tpi\$/);
});

test("sin el SQL: no se consulta la tabla ni una vez, y todo devuelve vacío", async (t) => {
  if (salta(t)) return;
  usar(await crearBase(PGlite!, { conSqlDelPlan: false }));
  await sembrarPlan(base.db);
  const { repoFilas, tablaDeFilasExiste, columnaNotaDelPlanExiste } = await mod();
  assert.equal(await tablaDeFilasExiste(), false);
  assert.equal(await columnaNotaDelPlanExiste(), false);
  for (let i = 0; i < 5; i++) assert.deepEqual(await repoFilas.leer("c1", "plan1"), []);
  assert.equal((await repoFilas.leerDePlanes("c1", ["plan1"])).size, 0);
  const aLaTabla = consultas.filter((s) => /FROM "treatment_plan_items"/.test(s));
  assert.equal(aLaTabla.length, 0);
  assert.equal(consultas.filter((s) => /to_regclass/.test(s)).length, 1, "una pregunta, recordada");
});

test("sin clinicId se corta antes de consultar", async (t) => {
  if (salta(t)) return;
  usar(await crearBase(PGlite!));
  const { repoFilas } = await mod();
  await assert.rejects(repoFilas.leer("", "plan1"), /clinicId ausente/);
  await assert.rejects(repoFilas.leer(undefined as unknown as string, "plan1"), /clinicId ausente/);
  assert.equal(consultas.length, 0);
});

test("alta y lectura: centavos exactos, dientes, caras, hallazgo y orden; otra clínica no ve nada", async (t) => {
  if (salta(t)) return;
  usar(await crearBase(PGlite!));
  await sembrarPlan(base.db);
  const { repoFilas } = await mod();
  const { leerFilas, comoNueva } = await contrato();
  const filas = leerFilas([
    { nombre: "Resina", dientes: "16", caras: "MO", precio: "1250.50", cantidad: 2, fase: "restauradora", motivo: "Caries", hallazgo: { condicion: "caries", diente: 16, caras: ["M"] } },
    { nombre: "Limpieza", precio: 0.29, fase: "higienica" },
    { nombre: "Extracción 18", estado: "hecho", precio: 900 },
  ]).filas!.map(comoNueva);
  const creadas = await repoFilas.insertar(base.prisma, { clinicId: "c1", planId: "plan1", userId: "u1", filas });
  assert.equal(creadas.length, 3);
  const leidas = await repoFilas.leer("c1", "plan1");
  assert.deepEqual(leidas.map((f) => f.nombre), ["Resina", "Limpieza", "Extracción 18"]);
  assert.equal(leidas[0].precioCentavos, 125050);
  assert.equal(leidas[1].precioCentavos, 29);
  assert.deepEqual(leidas[0].dientes, [16]);
  assert.deepEqual(leidas[0].caras, ["M", "O"]);
  assert.deepEqual(leidas[0].hallazgo, { condicion: "caries", diente: 16, caras: ["M"], entryId: null });
  assert.equal(leidas[2].estado, "hecho");
  assert.ok(leidas[2].hechoEn instanceof Date);
  assert.equal(leidas[2].hechoPor, "u1");
  assert.deepEqual(await repoFilas.leer("c2", "plan1"), [], "la otra clínica no ve las filas");
  assert.equal((await repoFilas.leerDePlanes("c1", ["plan1", "otro"])).get("plan1")!.length, 3);
  // Una fila no se cuelga de un plan ajeno.
  await assert.rejects(repoFilas.insertar(base.prisma, { clinicId: "c2", planId: "plan1", userId: "u9", filas: [filas[0]] }), /otra clínica/);
});

test("editar: cambia, cancela sin borrar, reordena; la cobrada no cambia de precio ni con un plan falsificado", async (t) => {
  if (salta(t)) return;
  usar(await crearBase(PGlite!));
  await sembrarPlan(base.db);
  const { repoFilas, FilaError } = await mod();
  const { leerFilas, comoNueva, planearCambios } = await contrato();
  await repoFilas.insertar(base.prisma, {
    clinicId: "c1", planId: "plan1", userId: "u1",
    filas: leerFilas([{ nombre: "A", precio: 100 }, { nombre: "B", precio: 200 }, { nombre: "C", precio: 300 }]).filas!.map(comoNueva),
  });
  const [a, b, c] = await repoFilas.leer("c1", "plan1");
  const entrantes = leerFilas([{ id: c.id, nombre: "C", precio: 350 }, { nombre: "D", precio: 50 }, { id: a.id, nombre: "A", precio: 100 }]).filas!;
  const plan = planearCambios(await repoFilas.leer("c1", "plan1", { conCanceladas: true }), entrantes);
  const despues = await base.prisma.$transaction((tx: any) => repoFilas.aplicarCambios(tx, { clinicId: "c1", planId: "plan1", userId: "u2", cambios: plan }));
  assert.deepEqual(despues.map((f: any) => `${f.nombre}:${f.precioCentavos}`), ["C:35000", "D:5000", "A:10000"]);
  const todas = await repoFilas.leer("c1", "plan1", { conCanceladas: true });
  const bb = todas.find((f) => f.id === b.id)!;
  assert.equal(bb.estado, "cancelado", "B no vino: cancelada, no borrada");
  assert.equal(bb.canceladoPor, "u2");
  assert.ok(bb.canceladoEn instanceof Date);
  assert.equal((await base.db.query(`SELECT count(*)::int AS n FROM "treatment_plan_items"`)).rows[0].n, 4);

  // Cobrada: aunque alguien se salte planearCambios, el UPDATE no cambia su precio.
  await base.db.query(`INSERT INTO "invoices" ("id","clinicId","patientId","invoiceNumber","items","subtotal","total","balance") VALUES ('inv1','c1','pac-c1','F-1','[]',0,0,0)`);
  await base.db.query(`UPDATE "treatment_plan_items" SET "invoiceId" = 'inv1' WHERE "id" = $1`, [a.id]);
  const falsificado = { ok: true, altas: [], cancelar: [], orden: [a.id], cambios: [{ id: a.id, antes: a, despues: { ...comoNueva(entrantes[2]), precioCentavos: 1 } }] };
  await assert.rejects(base.prisma.$transaction((tx: any) => repoFilas.aplicarCambios(tx, { clinicId: "c1", planId: "plan1", userId: "u2", cambios: falsificado as any })), (e: any) => e instanceof FilaError && e.codigo === "fila_cobrada");
  assert.equal((await repoFilas.leer("c1", "plan1")).find((f) => f.id === a.id)!.precioCentavos, 10000);
  // Ni se cancela.
  const cancelarCobrada = { ok: true, altas: [], cambios: [], orden: [], cancelar: [{ ...a, invoiceId: null }] };
  await assert.rejects(base.prisma.$transaction((tx: any) => repoFilas.aplicarCambios(tx, { clinicId: "c1", planId: "plan1", userId: "u2", cambios: cancelarCobrada as any })), (e: any) => e.codigo === "fila_cobrada");
});

test("estado: hecho anota quién, cuándo y la cita; deshacer lo limpia; un hecho no se cancela", async (t) => {
  if (salta(t)) return;
  usar(await crearBase(PGlite!));
  await sembrarPlan(base.db);
  await base.db.query(`INSERT INTO "appointments" VALUES ('cita1','c1')`);
  const { repoFilas } = await mod();
  const { leerFilas, comoNueva } = await contrato();
  const [f] = await repoFilas.insertar(base.prisma, { clinicId: "c1", planId: "plan1", userId: "u1", filas: leerFilas([{ nombre: "Endo" }]).filas!.map(comoNueva) });
  const en = new Date("2026-10-20T15:00:00Z");
  const hecha = await repoFilas.cambiarEstado(base.prisma, { clinicId: "c1", planId: "plan1", filaId: f.id, a: "hecho", userId: "doc", citaId: "cita1", en });
  assert.equal(hecha.estado, "hecho");
  assert.equal(hecha.hechoPor, "doc");
  assert.equal(hecha.citaId, "cita1");
  assert.equal(hecha.hechoEn!.toISOString(), en.toISOString());
  await assert.rejects(repoFilas.cambiarEstado(base.prisma, { clinicId: "c1", planId: "plan1", filaId: f.id, a: "cancelado", userId: "doc" }), (e: any) => e.codigo === "fila_hecha");
  const deshecha = await repoFilas.cambiarEstado(base.prisma, { clinicId: "c1", planId: "plan1", filaId: f.id, a: "pendiente", userId: "doc" });
  assert.equal(deshecha.estado, "pendiente");
  assert.equal(deshecha.hechoEn, null);
  assert.equal(deshecha.citaId, "cita1", "la cita se conserva");
  await assert.rejects(repoFilas.cambiarEstado(base.prisma, { clinicId: "c2", planId: "plan1", filaId: f.id, a: "hecho", userId: "x" }), (e: any) => e.codigo === "fila_desconocida");
});

test("ligar a la nota: solo filas sin nota viva; una nota cancelada se reemplaza", async (t) => {
  if (salta(t)) return;
  usar(await crearBase(PGlite!));
  await sembrarPlan(base.db);
  for (const id of ["n1", "n2"]) {
    await base.db.query(`INSERT INTO "invoices" ("id","clinicId","patientId","invoiceNumber","items","subtotal","total","balance") VALUES ($1,'c1','pac-c1',$1,'[]',0,0,0)`, [id]);
  }
  const { repoFilas } = await mod();
  const { leerFilas, comoNueva } = await contrato();
  const [f] = await repoFilas.insertar(base.prisma, { clinicId: "c1", planId: "plan1", userId: "u1", filas: leerFilas([{ nombre: "A", precio: 1 }]).filas!.map(comoNueva) });
  assert.equal(await repoFilas.ligarANota(base.prisma, { clinicId: "c1", planId: "plan1", ligas: [{ filaId: f.id, invoiceId: "n1", linea: 0 }] }), 1);
  assert.equal(await repoFilas.ligarANota(base.prisma, { clinicId: "c1", planId: "plan1", ligas: [{ filaId: f.id, invoiceId: "n2", linea: 0 }] }), 0, "ya tiene nota: no se pisa");
  assert.equal(await repoFilas.ligarANota(base.prisma, { clinicId: "c1", planId: "plan1", ligas: [{ filaId: f.id, invoiceId: "n2", linea: 3 }], reemplazar: ["n1"] }), 1);
  const [l] = await repoFilas.leer("c1", "plan1");
  assert.equal(l.invoiceId, "n2");
  assert.equal(l.invoiceLinea, 3);
  // Borrar la factura no borra la fila: su liga queda en NULL.
  await base.db.query(`DELETE FROM "invoices" WHERE "id" = 'n2'`);
  const [sin] = await repoFilas.leer("c1", "plan1");
  assert.equal(sin.invoiceId, null);
});
