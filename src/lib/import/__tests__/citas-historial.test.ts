/**
 * ws1-t12 — HISTORIAL DE CITAS PASADAS MIGRADO (appointmentHistoryHandler,
 * archivo nuevo src/lib/import/citas-historial/handler.ts).
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/import/__tests__/citas-historial.test.ts
 *
 * Se conduce el motor DE VERDAD (runImport + appointmentHistoryHandler) con
 * Prisma sustituido por el doble en memoria (doble-prisma.ts) — mismo doble
 * que pagos-historial.test.ts.
 *
 * Lo que prueban estos tests, en el orden que pide la tarea:
 *   · una cita histórica NUNCA crea una fila en Appointment (no puede
 *     disparar recordatorios ni cobros porque esa tabla no se toca);
 *   · reimportar el mismo archivo no duplica;
 *   · un estado que no es final (no reconocido) es error, nunca se adivina.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { crearBase, type Base } from "./doble-prisma";

const CLINICA = "cli_A";
const IMPORTA = "u_admin";

function semilla() {
  return {
    clinic: [{ id: CLINICA, name: "Clínica Sonrisa", timezone: "America/Mexico_City" }],
    patient: [
      { id: "p1", clinicId: CLINICA, patientNumber: "P-0001", firstName: "María", lastName: "Hernández", phone: "5551234567", email: null, deletedAt: null, visibleUserIds: [] },
    ],
    user: [
      { id: IMPORTA, clinicId: CLINICA, firstName: "Rafael", lastName: "Admin", isActive: true },
      { id: "doc1", clinicId: CLINICA, firstName: "Carlos", lastName: "Nuñez", isActive: true },
    ],
    migratedVisit: [],
  };
}

let base: Base = crearBase(semilla());
mock.module("@/lib/prisma", { namedExports: { prisma: new Proxy({}, { get: (_t, k: string) => base.prisma[k] }) } });
mock.module("@/lib/audit", { namedExports: { logAudit: async () => {} } });

const engine = () => import("../engine");
const manejador = () => import("../citas-historial/handler");

function reiniciar() {
  base = crearBase(semilla());
}

const csv = (nombre: string, texto: string) => new File([texto], nombre, { type: "text/csv" });
const tabla = (m: string) => base.tablas[m] ?? [];
const fila = (res: any, n: number) => res.preview.find((r: any) => r.row === n);

async function correr(file: File, opts: { dryRun?: boolean; skipDuplicates?: boolean } = { dryRun: true }): Promise<any> {
  const { runImport } = await engine();
  const { appointmentHistoryHandler } = await manejador();
  return runImport(appointmentHistoryHandler, {
    file, clinicId: CLINICA, userId: IMPORTA, role: "ADMIN",
    dryRun: opts.dryRun ?? true, skipDuplicates: opts.skipDuplicates ?? true,
    columnMapping: null, origin: null, valueMapping: null, sheet: null,
  });
}

const CABECERA = "nombre,apellido,telefono,doctor,fecha,hora,estado,tipo";

test("importa una cita pasada atendida: crea MigratedVisit y NUNCA toca Appointment", async () => {
  reiniciar();
  const texto = [CABECERA, "María,Hernández,5551234567,Carlos Nuñez,2024-01-15,10:00,Atendida,Consulta"].join("\n");

  const prev = await correr(csv("c1.csv", texto), { dryRun: true });
  assert.equal(prev.mappingError, undefined, JSON.stringify(prev));
  assert.deepEqual([prev.total, prev.validos, prev.invalidos], [1, 1, 0]);

  const hecho = await correr(csv("c1.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 1);
  assert.equal(tabla("migratedVisit").length, 1);
  const v = tabla("migratedVisit")[0];
  assert.equal(v.patientId, "p1");
  assert.equal(v.doctorId, "doc1");
  assert.equal(v.status, "COMPLETED");
  assert.equal(v.type, "Consulta");

  // Lo que hace que esto NUNCA dispare un recordatorio o un cobro: no se toca appointments.
  assert.equal(tabla("appointment").length, 0, "no crea ninguna cita viva");
});

test('"No asistió" entra NO_SHOW, "Cancelada"/"Anulada" entran CANCELLED', async () => {
  reiniciar();
  const texto = [
    CABECERA,
    "María,Hernández,5551234567,Carlos Nuñez,2024-01-15,10:00,No asistió,Consulta",
    "María,Hernández,5551234567,Carlos Nuñez,2024-02-15,10:00,Cancelada,Consulta",
  ].join("\n");
  const hecho = await correr(csv("c2.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 2);
  const estados = tabla("migratedVisit").map((v: any) => v.status).sort();
  assert.deepEqual(estados, ["CANCELLED", "NO_SHOW"]);
});

test("reimportar el mismo archivo no duplica (misma llave paciente+instante+estado)", async () => {
  reiniciar();
  const texto = [CABECERA, "María,Hernández,5551234567,Carlos Nuñez,2024-01-15,10:00,Atendida,Consulta"].join("\n");
  await correr(csv("c3.csv", texto), { dryRun: false });
  assert.equal(tabla("migratedVisit").length, 1);

  const prev2 = await correr(csv("c3.csv", texto), { dryRun: true });
  assert.equal(fila(prev2, 2).status, "skipped");

  const otraVez = await correr(csv("c3.csv", texto), { dryRun: false, skipDuplicates: false });
  assert.equal(otraVez.created, 0);
  assert.equal(tabla("migratedVisit").length, 1);
});

test("estado no reconocido: error, no se adivina cuál de los tres estados finales es", async () => {
  reiniciar();
  const texto = [CABECERA, "María,Hernández,5551234567,Carlos Nuñez,2024-01-15,10:00,Reprogramada,Consulta"].join("\n");
  const prev = await correr(csv("c4.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "error");
  assert.match(fila(prev, 2).errors.join(" · "), /no es un estado final reconocido/);
});

test("estado agendada/confirmada (no es final): error — este archivo es de historial cerrado", async () => {
  reiniciar();
  const texto = [CABECERA, "María,Hernández,5551234567,Carlos Nuñez,2024-01-15,10:00,Confirmada,Consulta"].join("\n");
  const prev = await correr(csv("c5.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "error");
});

test("fecha futura con estado ya cerrado: error (dato incoherente)", async () => {
  reiniciar();
  const futura = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const iso = `${futura.getFullYear()}-${String(futura.getMonth() + 1).padStart(2, "0")}-${String(futura.getDate()).padStart(2, "0")}`;
  const texto = [CABECERA, `María,Hernández,5551234567,Carlos Nuñez,${iso},10:00,Atendida,Consulta`].join("\n");
  const prev = await correr(csv("c6.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "error");
  assert.match(fila(prev, 2).errors.join(" · "), /Fecha futura/);
});

test("doctor no encontrado: se guarda sin doctor, con aviso (no bloquea la fila)", async () => {
  reiniciar();
  const texto = [CABECERA, "María,Hernández,5551234567,Doctor Fantasma,2024-01-15,10:00,Atendida,Consulta"].join("\n");
  const hecho = await correr(csv("c7.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 1);
  assert.equal(tabla("migratedVisit")[0].doctorId, null);
});

test("paciente no encontrado: error", async () => {
  reiniciar();
  const texto = [CABECERA, "Nadie,Desconocido,5559999999,Carlos Nuñez,2024-01-15,10:00,Atendida,Consulta"].join("\n");
  const prev = await correr(csv("c8.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "error");
});
