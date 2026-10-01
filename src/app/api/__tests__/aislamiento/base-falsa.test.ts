/**
 * El DETECTOR de la prueba de aislamiento tiene que detectar — ws1-t10.
 *
 * Run: npm run test:aislamiento-detector
 *
 * Una prueba de «no hay fugas» que no sabe ver una fuga da una paz falsa. Aquí
 * se comprueba, con handlers de juguete escritos MAL a propósito, que la base
 * falsa y el arnés los marcan; y que los escritos BIEN pasan limpios.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BaseFalsa, ID, MARCA, MODELOS, MODELOS_DE_CLINICA, SUPABASE_DE } from "./base-falsa";

test("esquema: hay modelos de clínica y globales, y cada tabla trae una fila por dueño", () => {
  assert.ok(MODELOS.length > 300);
  assert.ok(MODELOS_DE_CLINICA.has("Patient") && MODELOS_DE_CLINICA.has("Appointment") && MODELOS_DE_CLINICA.has("Invoice"));
  const base = new BaseFalsa();
  assert.equal(base.tablas.get("Patient")!.length, 3, "A, C y B");
  assert.deepEqual(base.tablas.get("Patient")!.map((e) => e.fila.id).sort(), ["idA", "idB", "idC"]);
  assert.deepEqual(base.tablas.get("Patient")!.map((e) => e.fila.clinicId).sort(), ["idA", "idB", "idC"]);
  assert.ok(base.tablas.get("Patient")!.every((e) => String(e.fila.firstName).startsWith(MARCA[e.dueno])));
});

test("🔴 detecta: findUnique por id SIN clinicId devuelve la fila de B y se anota como fuga", async () => {
  const base = new BaseFalsa();
  const p: any = await base.cliente().patient.findUnique({ where: { id: ID.B } });
  assert.equal(p.id, ID.B);
  assert.deepEqual(base.fugas.map((f) => [f.tipo, f.modelo, f.dueno]), [["lectura", "Patient", "B"]]);
});

test("🟢 no marca: el mismo findFirst CON clinicId de la sesión no encuentra a B", async () => {
  const base = new BaseFalsa();
  const p = await base.cliente().patient.findFirst({ where: { id: ID.B, clinicId: ID.A } });
  assert.equal(p, null);
  assert.equal(base.fugas.length, 0);
});

test("🔴 detecta: update / delete / updateMany sobre filas de B son fugas de escritura", async () => {
  const base = new BaseFalsa();
  const c = base.cliente();
  await c.patient.update({ where: { id: ID.B }, data: { firstName: "x" } });
  await c.patient.updateMany({ where: { id: ID.B }, data: { firstName: "y" } });
  await c.patient.delete({ where: { id: ID.B } });
  assert.deepEqual(base.fugas.map((f) => f.tipo), ["escritura", "escritura", "escritura"]);
});

test("🟢 no marca: update condicionado por clinicId de la sesión no alcanza a B (count 0)", async () => {
  const base = new BaseFalsa();
  const r = await base.cliente().patient.updateMany({ where: { id: ID.B, clinicId: ID.A }, data: { firstName: "x" } });
  assert.equal(r.count, 0);
  assert.equal(base.fugas.length, 0);
});

test("🔴 detecta: crear con clinicId de B, o atar con connect a un paciente de B, es una fuga", async () => {
  const base = new BaseFalsa();
  const c = base.cliente();
  await c.appointment.create({ data: { clinicId: ID.B, patientId: ID.B } });
  assert.equal(base.fugas.filter((f) => f.tipo === "alta").length >= 1, true);
  const base2 = new BaseFalsa();
  await base2.cliente().appointment.create({ data: { clinicId: ID.A, patient: { connect: { id: ID.B } } } });
  assert.equal(base2.fugas.some((f) => f.tipo === "alta" && f.dueno === "B"), true, "connect a una fila ajena");
});

test("🔴 detecta: findMany sin filtro de tenant devuelve las tres clínicas y marca B y C", async () => {
  const base = new BaseFalsa();
  const filas = await base.cliente().invoice.findMany({});
  assert.equal(filas.length, 3);
  assert.deepEqual([...new Set(base.fugas.map((f) => f.dueno))].sort(), ["B", "C"]);
});

test("🟢 un filtro por RELACIÓN (paciente de mi clínica) excluye a B igual que uno directo", async () => {
  const base = new BaseFalsa();
  const filas = await base.cliente().appointment.findMany({ where: { patient: { clinicId: ID.A } } });
  assert.deepEqual(filas.map((f: any) => f.id), ["idA"]);
  assert.equal(base.fugas.length, 0);
});

test("🔴 detecta: un include trae una relación de otra clínica (hijo sin filtro de tenant)", async () => {
  const base = new BaseFalsa();
  // La cita de A apunta a SU paciente (idA): el include sale limpio…
  await base.cliente().appointment.findFirst({ where: { id: ID.A }, include: { patient: true } });
  assert.equal(base.fugas.length, 0);
  // …pero pedir la de B con include trae a B en las dos tablas.
  await base.cliente().appointment.findFirst({ where: { id: ID.B }, include: { patient: true } });
  assert.deepEqual([...new Set(base.fugas.map((f) => f.modelo))].sort(), ["Appointment", "Patient"]);
});

test("sede hermana: con C permitida solo se leen las filas de C; B sigue marcado", async () => {
  const base = new BaseFalsa({ permitidos: ["C"] });
  const c = base.cliente();
  await c.invoice.findMany({});
  assert.deepEqual([...new Set(base.fugas.map((f) => f.dueno))], ["B"]);
});

test("sesión: leer las filas User del dueño (mis sedes) no es fuga; leer las de OTRO dueño sí", async () => {
  const base = new BaseFalsa();
  const c = base.cliente();
  const mias = await c.user.findMany({ where: { supabaseId: SUPABASE_DE.A, isActive: true }, include: { clinic: true }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(mias.map((u: any) => u.clinicId), ["idA", "idC"]);
  assert.equal(base.fugas.length, 0);
  await c.user.findMany({ where: { supabaseId: SUPABASE_DE.B } });
  assert.deepEqual(base.fugas.map((f) => f.dueno), ["B"]);
  // y la tolerancia NO se queda pegada: la siguiente lectura sin ese filtro sí marca C.
  await c.user.findMany({});
  assert.equal(base.fugas.some((f) => f.dueno === "C"), true);
});

test("el SQL crudo no se puede verificar: se cuenta, no se adivina", async () => {
  const base = new BaseFalsa();
  await (base.cliente() as any).$queryRaw`SELECT 1`;
  await (base.cliente() as any).$executeRaw`UPDATE x SET y = 1`;
  assert.equal(base.crudo, 2);
});

test("transacciones: de arreglo y de función ven la misma base", async () => {
  const base = new BaseFalsa();
  const c = base.cliente();
  const [a, n] = await c.$transaction([c.patient.findFirst({ where: { id: ID.A, clinicId: ID.A } }), c.patient.count({ where: { clinicId: ID.A } })]);
  assert.equal(a.id, "idA");
  assert.equal(n, 1);
  const r = await c.$transaction(async (tx: any) => tx.patient.count({ where: { clinicId: ID.A } }));
  assert.equal(r, 1);
});
