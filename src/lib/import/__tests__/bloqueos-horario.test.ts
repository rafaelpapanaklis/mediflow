/**
 * ws1-t12 — BLOQUEOS DE AGENDA MIGRADOS (blockedHoursHandler, archivo nuevo
 * src/lib/import/bloqueos-horario/handler.ts).
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/import/__tests__/bloqueos-horario.test.ts
 *
 * El handler NO importa agenda-bloqueos/service.ts (lleva `import
 * "server-only"`, que no resuelve bajo tsx --test — comprobado, ver el
 * comentario en handler.ts): reimplementa el chequeo de choque + creación a
 * mano, apoyado en las piezas puras de agenda-bloqueos/core.ts. Prisma
 * sustituido por el doble en memoria (doble-prisma.ts).
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { crearBase, type Base } from "./doble-prisma";

const CLINICA = "cli_A";
const IMPORTA = "u_admin";

function semilla() {
  return {
    clinic: [{ id: CLINICA, name: "Clínica Sonrisa", timezone: "America/Mexico_City" }],
    user: [
      { id: IMPORTA, clinicId: CLINICA, firstName: "Rafael", lastName: "Admin", isActive: true },
      { id: "doc1", clinicId: CLINICA, firstName: "Carlos", lastName: "Nuñez", isActive: true },
    ],
    appointment: [],
    agendaBlock: [],
  };
}

let base: Base = crearBase(semilla());
mock.module("@/lib/prisma", { namedExports: { prisma: new Proxy({}, { get: (_t, k: string) => base.prisma[k] }) } });
mock.module("@/lib/audit", { namedExports: { logAudit: async () => {} } });

const engine = () => import("../engine");
const manejador = () => import("../bloqueos-horario/handler");

function reiniciar() {
  base = crearBase(semilla());
}

const csv = (nombre: string, texto: string) => new File([texto], nombre, { type: "text/csv" });
const tabla = (m: string) => base.tablas[m] ?? [];
const fila = (res: any, n: number) => res.preview.find((r: any) => r.row === n);

async function correr(file: File, opts: { dryRun?: boolean; skipDuplicates?: boolean } = { dryRun: true }): Promise<any> {
  const { runImport } = await engine();
  const { blockedHoursHandler } = await manejador();
  return runImport(blockedHoursHandler, {
    file, clinicId: CLINICA, userId: IMPORTA, role: "ADMIN",
    dryRun: opts.dryRun ?? true, skipDuplicates: opts.skipDuplicates ?? true,
    columnMapping: null, origin: null, valueMapping: null, sheet: null,
  });
}

const CABECERA = "doctor,fecha,horainicio,horafin,motivo";

test("bloqueo de un doctor, día completo: crea AgendaBlock con ese doctorId", async () => {
  reiniciar();
  const texto = [CABECERA, "Carlos Nuñez,2026-12-25,,,Navidad"].join("\n");

  const prev = await correr(csv("b1.csv", texto), { dryRun: true });
  assert.equal(prev.mappingError, undefined, JSON.stringify(prev));
  assert.equal(fila(prev, 2).status, "ok");

  const hecho = await correr(csv("b1.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 1);
  assert.equal(tabla("agendaBlock").length, 1);
  const b = tabla("agendaBlock")[0];
  assert.equal(b.doctorId, "doc1");
  assert.equal(b.reason, "Navidad");
});

test("sin doctor en la fila: bloquea TODA la clínica (doctorId null) y avisa en la vista previa", async () => {
  reiniciar();
  const texto = [CABECERA, ",2026-12-25,,,Cierre general"].join("\n");
  const prev = await correr(csv("b2.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "ok");
  assert.match(fila(prev, 2).warnings.join(" · "), /TODA la clínica/);

  const hecho = await correr(csv("b2.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 1);
  assert.equal(tabla("agendaBlock")[0].doctorId, null);
});

test("choque con una cita ya agendada del mismo doctor: NO se crea, queda en error", async () => {
  reiniciar();
  base.tablas.appointment.push({
    id: "a1", clinicId: CLINICA, doctorId: "doc1", patientId: "p1",
    startsAt: new Date("2026-12-25T15:00:00.000Z"), endsAt: new Date("2026-12-25T15:30:00.000Z"),
    status: "SCHEDULED", holdExpiresAt: null,
  });
  const texto = [CABECERA, "Carlos Nuñez,2026-12-25,,,Cierre por mantenimiento"].join("\n");
  const prev = await correr(csv("b3.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "error");
  assert.match(fila(prev, 2).errors.join(" · "), /Se empalma con/);

  const hecho = await correr(csv("b3.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 0);
  assert.equal(tabla("agendaBlock").length, 0, "no se creó nada");
});

test("una cita CANCELLED en el rango no estorba (no cuenta como choque)", async () => {
  reiniciar();
  base.tablas.appointment.push({
    id: "a2", clinicId: CLINICA, doctorId: "doc1", patientId: "p1",
    startsAt: new Date("2026-12-25T15:00:00.000Z"), endsAt: new Date("2026-12-25T15:30:00.000Z"),
    status: "CANCELLED", holdExpiresAt: null,
  });
  const texto = [CABECERA, "Carlos Nuñez,2026-12-25,,,Cierre"].join("\n");
  const hecho = await correr(csv("b4.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 1, "una cita cancelada no bloquea el bloqueo");
});

test("doctor no encontrado en la clínica: error", async () => {
  reiniciar();
  const texto = [CABECERA, "Doctor Fantasma,2026-12-25,,,Cierre"].join("\n");
  const prev = await correr(csv("b5.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "error");
  assert.match(fila(prev, 2).errors.join(" · "), /no encontrado/);
});

test("reimportar el mismo archivo no duplica (mismo alcance + mismo rango exacto)", async () => {
  reiniciar();
  const texto = [CABECERA, "Carlos Nuñez,2026-12-25,,,Navidad"].join("\n");
  await correr(csv("b6.csv", texto), { dryRun: false });
  assert.equal(tabla("agendaBlock").length, 1);

  const prev2 = await correr(csv("b6.csv", texto), { dryRun: true });
  assert.equal(fila(prev2, 2).status, "duplicate");

  const otraVez = await correr(csv("b6.csv", texto), { dryRun: false, skipDuplicates: true });
  assert.equal(otraVez.created, 0);
  assert.equal(tabla("agendaBlock").length, 1, "sigue habiendo solo un bloqueo");
});

test("sin motivo en el archivo: se guarda como «Bloqueo importado», con aviso", async () => {
  reiniciar();
  const texto = ["doctor,fecha,horainicio,horafin", "Carlos Nuñez,2026-12-25,,"].join("\n");
  const hecho = await correr(csv("b7.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 1);
  assert.equal(tabla("agendaBlock")[0].reason, "Bloqueo importado");
});

test("fecha inválida: error, no se importa", async () => {
  reiniciar();
  const texto = [CABECERA, "Carlos Nuñez,no-es-fecha,,,Cierre"].join("\n");
  const prev = await correr(csv("b8.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "error");
  assert.match(fila(prev, 2).errors.join(" · "), /Fecha inválida/);
});
