/**
 * ws1-t12 (ronda 3) — DECISIONES de Rafael para BEVADENT:
 *  · las citas van a quien la persona ELIJE (el dueño) cuando el doctor del archivo no empareja solo (no existe o
 *    hay dos usuarios con ese nombre); si dos quedan a la misma hora NO se mueve ningún horario: la que choca entra
 *    con un doctor de respaldo libre (Appointment.doctorId no admite vacío);
 *  · tratamientos: «Activo» sigue vivo aunque todas sus líneas estén hechas, «Finalizado» es historial, una línea
 *    con «Fecha Realización» está hecha, lo abonado sale del tratamiento y NO es un Payment (Caja no lo ve).
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/import/__tests__/decisiones-bevadent.test.ts
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { crearBase, type Base } from "./doble-prisma";

const CLINICA = "cli_A";
const DUENO = "u_dueno";
const DOCTOR = "u_doc";

function semilla() {
  return {
    clinic: [{ id: CLINICA, name: "Clínica de prueba", timezone: "America/Mexico_City" }],
    user: [
      { id: DUENO, clinicId: CLINICA, firstName: "Ana", lastName: "Prueba", role: "SUPER_ADMIN", isActive: true },
      { id: DOCTOR, clinicId: CLINICA, firstName: "Ana", lastName: "Prueba", role: "DOCTOR", isActive: true },
    ],
    patient: [
      { id: "p1", clinicId: CLINICA, patientNumber: "P-0001", firstName: "Lucía", lastName: "Prueba Uno", phone: "5551230001", email: null, dob: null, deletedAt: null, visibleUserIds: [] },
      { id: "p2", clinicId: CLINICA, patientNumber: "P-0002", firstName: "Mario", lastName: "Prueba Dos", phone: "5551230002", email: null, dob: null, deletedAt: null, visibleUserIds: [] },
    ],
    appointment: [], migratedVisit: [], importExternalIds: [], procedureCatalog: [],
    quote: [], quoteItem: [], treatmentPlan: [], treatmentSession: [], invoice: [], payment: [], migratedPayment: [],
  };
}
let base: Base = crearBase(semilla());
mock.module("@/lib/prisma", { namedExports: { prisma: new Proxy({}, { get: (_t, k: string) => base.prisma[k] }) } });
mock.module("@/lib/audit", { namedExports: { logAudit: async () => {} } });
mock.module("@/lib/patient-quota", { namedExports: { getPatientQuota: async () => ({ unlimited: true, used: 0, max: null, remaining: null }) } });
mock.module("@/lib/invoices/next-invoice-number", { namedExports: { lastInvoiceFolio: async () => 500 } });

const engine = () => import("../engine");
const entidades = () => import("../entities");
const csv = (t: string) => new File(["﻿" + t], "archivo.csv", { type: "text/csv" });
async function correr(entidad: string, file: File, opts: { dryRun?: boolean; valueMapping?: any } = {}): Promise<any> {
  const { runImport } = await engine();
  const { HANDLERS } = await entidades();
  return runImport(HANDLERS[entidad], { file, clinicId: CLINICA, userId: DUENO, role: "SUPER_ADMIN", dryRun: opts.dryRun ?? true, skipDuplicates: true, origin: "dentalink", valueMapping: opts.valueMapping ?? null });
}
const tabla = (m: string) => base.tablas[m] ?? [];

const CAB = "Fecha Cita,Hora Inicio Cita,Hora Fin Cita,Nombre Profesional Cita,Apellidos Profesional Cita,Nombre Paciente,Apellidos Paciente,Celular,Estado Cita";
const cita = (hora: string, fin: string, doc: [string, string], pac: [string, string, string], estado = "No confirmado") => `2030-10-05,${hora},${fin},${doc[0]},${doc[1]},${pac[0]},${pac[1]},${pac[2]},${estado}`;
const L1: [string, string, string] = ["Lucía", "Prueba Uno", "5551230001"];
const M2: [string, string, string] = ["Mario", "Prueba Dos", "5551230002"];

test("dos usuarios con el mismo nombre: la cita NO se asigna sola, pide elegir; elegido el dueño, entra con él", async () => {
  base = crearBase(semilla());
  const f = () => csv(`${CAB}\n${cita("09:00:00", "09:30:00", ["ANA", "PRUEBA"], L1)}\n`);
  const r = await correr("appointments", f());
  assert.equal(r.preview[0].status, "error");
  assert.deepEqual(r.unresolved.map((u: any) => [u.field, u.value, u.rows]), [["doctor", "ANA PRUEBA", 1]]);
  assert.equal(r.options.doctor.length, 2);
  assert.ok(r.options.doctor.some((o: any) => o.id === DUENO && /dueño/.test(o.label)));
  const elegido = await correr("appointments", f(), { valueMapping: { doctor: { anaprueba: DUENO } } });
  assert.equal(elegido.validos, 1);
  assert.equal(elegido.preview[0].data.doctorId, DUENO);
  const real = await correr("appointments", f(), { dryRun: false, valueMapping: { doctor: { anaprueba: DUENO } } });
  assert.equal(real.created, 1);
  assert.equal(tabla("appointment")[0].doctorId, DUENO);
});

test("un doctor que no existe también se asigna a quien la persona elige", async () => {
  base = crearBase(semilla());
  const f = csv(`${CAB}\n${cita("09:00:00", "09:30:00", ["DAISY", "GARCIA"], L1)}\n`);
  const sin = await correr("appointments", f);
  assert.equal(sin.unresolved[0].value, "DAISY GARCIA");
  const con = await correr("appointments", f, { valueMapping: { doctor: { daisygarcia: DUENO } } });
  assert.equal(con.preview[0].data.doctorId, DUENO);
});

test("dos citas a la misma hora del dueño: NO se mueve ningún horario; la que choca entra con el doctor de respaldo libre", async () => {
  base = crearBase(semilla());
  const f = csv(`${CAB}\n${cita("09:00:00", "09:30:00", ["ANA", "PRUEBA"], L1)}\n${cita("09:00:00", "09:30:00", ["ANA", "PRUEBA"], M2)}\n`);
  const r = await correr("appointments", f, { valueMapping: { doctor: { anaprueba: DUENO } } });
  const [a, b] = r.preview;
  assert.equal(a.status, "ok"); assert.equal(a.data.doctorId, DUENO);
  assert.equal(b.status, "ok"); assert.equal(b.data.doctorId, DOCTOR, "la que chocaba va al doctor de respaldo");
  assert.equal(a.data.startsAt.getTime(), b.data.startsAt.getTime(), "los dos horarios siguen siendo el mismo: nada se movió");
  assert.match(b.warnings.join(" "), /no se movió ningún horario/);
  assert.match(b.data.notes, /se asignó a Ana Prueba sin mover el horario/);
  assert.ok(b.data.reasignadaPorChoque);
});

test("si tampoco el respaldo está libre, la cita sigue siendo error (no se inventa ni se mueve)", async () => {
  base = crearBase(semilla());
  const f = csv(`${CAB}\n${cita("09:00:00", "09:30:00", ["ANA", "PRUEBA"], L1)}\n${cita("09:00:00", "09:30:00", ["ANA", "PRUEBA"], M2)}\n${cita("09:00:00", "09:30:00", ["ANA", "PRUEBA"], ["Otro", "Paciente", "5551230003"])}\n`);
  base.tablas["patient"].push({ id: "p3", clinicId: CLINICA, patientNumber: "P-0003", firstName: "Otro", lastName: "Paciente", phone: "5551230003", email: null, dob: null, deletedAt: null, visibleUserIds: [] });
  const r = await correr("appointments", f, { valueMapping: { doctor: { anaprueba: DUENO } } });
  assert.deepEqual(r.preview.map((x: any) => x.status), ["ok", "ok", "error"]);
  assert.match(r.preview[2].errors.join(" "), /se empalma/i);
});

test("sin elección, un choque con doctor emparejado solo sigue siendo error (el respaldo es solo para lo asignado por elección)", async () => {
  base = crearBase(semilla());
  base.tablas["user"] = base.tablas["user"].filter((u) => u.id === DOCTOR);
  base.tablas["user"].push({ id: "u_otro", clinicId: CLINICA, firstName: "Beto", lastName: "Respaldo", role: "DOCTOR", isActive: true });
  const f = csv(`${CAB}\n${cita("09:00:00", "09:30:00", ["ANA", "PRUEBA"], L1)}\n${cita("09:00:00", "09:30:00", ["ANA", "PRUEBA"], M2)}\n`);
  const r = await correr("appointments", f);
  assert.deepEqual(r.preview.map((x: any) => x.status), ["ok", "error"]);
});

test("historial de citas: con dos usuarios iguales ya no gana el último en silencio; se elige y entra con ese doctor", async () => {
  base = crearBase(semilla());
  const f = () => csv(`${CAB}\n2026-01-05,09:00:00,10:00:00,ANA,PRUEBA,Lucía,Prueba Uno,5551230001,Atendido\n`);
  const sin = await correr("appointmentHistory", f());
  assert.equal(sin.preview[0].data.doctorId, null);
  assert.match(sin.preview[0].warnings.join(" "), /Varios usuarios coinciden/);
  assert.equal(sin.unresolved[0].field, "doctor");
  const con = await correr("appointmentHistory", f(), { valueMapping: { doctor: { anaprueba: DUENO } } });
  assert.equal(con.preview[0].data.doctorId, DUENO);
  assert.equal(con.preview[0].warnings.length, 0);
});

// ── Tratamientos (06_Presupuestos_Detalle) ────────────────────────────────────
const CAB06 = "# Tratamiento,Fecha de generación del tratamiento,Nombre Prestación,Fecha Realización,Precio Paciente,Total Pagos Tratamiento,Estado Tratamiento,Nombre Paciente,Apellidos Paciente,Celular,Pagado Prestación";
const l06 = (trat: string, prest: string, realiz: string, precio: number, pagos: number, estado: string, pac: [string, string, string]) =>
  `${trat},2026-03-10 10:00:00,${prest},${realiz},${precio},${pagos},${estado},${pac[0]},${pac[1]},${pac[2]},0`;

test("tratamientos: «Activo» con TODAS sus líneas hechas sigue vivo; «Finalizado» es historial; línea hecha = con fecha de realización", async () => {
  base = crearBase(semilla());
  const f = csv([CAB06,
    l06("1", "Profilaxis", "2026-03-12", 1000, 400, "Tratamiento Activo", L1),
    l06("1", "Resina", "", 500, 400, "Tratamiento Activo", L1),
    l06("2", "Extracción", "2026-03-15", 800, 800, "Tratamiento Activo", M2),
    l06("3", "Corona", "2026-03-20", 2000, 2000, "Tratamiento Finalizado", M2),
  ].join("\n") + "\n");
  const res = await correr("treatmentPlans", f, { dryRun: false });
  assert.equal(res.created, 3);
  const planes = tabla("treatmentPlan");
  assert.equal(planes.length, 3);
  const estados = Object.fromEntries(planes.map((p) => [p.totalCost, p.status]));
  assert.equal(estados[1500], "ACTIVE", "una línea hecha y otra pendiente");
  assert.equal(estados[800], "ACTIVE", "activo con todas las líneas hechas: sigue vivo");
  assert.equal(estados[2000], "COMPLETED", "finalizado = historial");
  assert.equal(planes.find((p) => p.totalCost === 2000)!.nextExpectedDate, null, "un finalizado no dispara seguimientos");
  assert.ok(planes.find((p) => p.totalCost === 800)!.nextExpectedDate, "el activo sí tiene próxima visita");
  assert.equal(tabla("treatmentSession").length, 3, "una sesión por día con línea hecha (marzo 12, 15 y 20)");
});

test("tratamientos: lo abonado sale de «Total Pagos Tratamiento» (no de la suma por línea) y NO es un Payment", async () => {
  base = crearBase(semilla());
  const f = csv([CAB06,
    l06("1", "Profilaxis", "2026-03-12", 1000, 700, "Tratamiento Activo", L1),
    l06("1", "Resina", "", 500, 700, "Tratamiento Activo", L1),
  ].join("\n") + "\n");
  await correr("treatmentPlans", f, { dryRun: false });
  const inv = tabla("invoice")[0];
  assert.equal(inv.total, 1500);
  assert.equal(inv.paid, 700);
  assert.equal(inv.balance, 800);
  assert.equal(inv.status, "PARTIAL");
  assert.equal(tabla("payment").length, 0, "Caja y Finanzas suman Payment: aquí no hay ninguno");
  const mig = tabla("migratedPayment");
  assert.equal(mig.length, 1);
  assert.equal(mig[0].amount, 700);
  assert.equal(mig[0].patientId, "p1");
  assert.equal(mig[0].paidAt.toISOString().slice(0, 10), "2026-03-10", "sin fecha de abono, la del tratamiento");
});
