/**
 * ws1-t12 (ronda 2) — CITAS DE BEVADENT: el doctor viene PARTIDO en dos columnas y la duración hay que sacarla
 * de la hora de fin.
 *   · «Nombre» + «Apellidos» del profesional se unen en un solo doctor (para todas las entidades con doctor);
 *   · duración = «Duración» si viene; si no, hora de fin − hora de inicio; si no, 30 min; y una hora de fin mala
 *     no se adivina: 30 min y aviso en esa fila.
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/import/__tests__/doctor-partido-y-duracion.test.ts
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { crearBase, type Base } from "./doble-prisma";

const CLINICA = "cli_A";
const IMPORTA = "u_admin";

function semilla() {
  return {
    clinic: [{ id: CLINICA, name: "Clínica de prueba", timezone: "America/Mexico_City" }],
    patient: [{ id: "p1", clinicId: CLINICA, patientNumber: "P-0001", firstName: "Lucía", lastName: "Prueba Uno", phone: "5551234567", email: null, dob: null, deletedAt: null, visibleUserIds: [] }],
    user: [
      { id: IMPORTA, clinicId: CLINICA, firstName: "Rafael", lastName: "Admin", isActive: true },
      { id: "u_ana", clinicId: CLINICA, firstName: "Ana", lastName: "Prueba López", isActive: true },
    ],
    appointment: [],
    importExternalIds: [],
  };
}
let base: Base = crearBase(semilla());
mock.module("@/lib/prisma", { namedExports: { prisma: new Proxy({}, { get: (_t, k: string) => base.prisma[k] }) } });
mock.module("@/lib/audit", { namedExports: { logAudit: async () => {} } });
mock.module("@/lib/patient-quota", { namedExports: { getPatientQuota: async () => ({ unlimited: true, used: 0, max: null, remaining: null }) } });

const engine = () => import("../engine");
const entidades = () => import("../entities");

const csv = (texto: string) => new File(["﻿" + texto], "citas.csv", { type: "text/csv" });
async function correr(entidad: string, file: File, opts: { columnMapping?: Record<string, string> } = {}): Promise<any> {
  const { runImport } = await engine();
  const { HANDLERS } = await entidades();
  return runImport(HANDLERS[entidad], { file, clinicId: CLINICA, userId: IMPORTA, role: "ADMIN", dryRun: true, skipDuplicates: true, origin: "dentalink", columnMapping: opts.columnMapping ?? null });
}
const CAB = "Fecha Cita,Hora Inicio Cita,Hora Fin Cita,Nombre Profesional Cita,Apellidos Profesional Cita,Nombre Paciente,Apellidos Paciente,Celular";
const fila = (fin: string, extra = "") => `2030-10-05,09:00:00,${fin},ANA ,PRUEBA LOPEZ,Lucía,Prueba Uno,5551234567${extra}`;

test("«Nombre» + «Apellidos» del profesional se unen: la cita encuentra al doctor", async () => {
  base = crearBase(semilla());
  const r = await correr("appointments", csv(`${CAB}\n${fila("09:30:00")}\n`));
  assert.equal(r.mappingError, undefined);
  assert.equal(r.validos, 1);
  assert.equal(r.preview[0].data.doctorId, "u_ana");
  assert.equal(r.preview[0].data.doctorName, "ANA PRUEBA LOPEZ");
});

test("con solo el nombre el doctor NO empareja (es lo que pasaba antes de unir las dos columnas)", async () => {
  base = crearBase(semilla());
  const r = await correr("appointments", csv(`${CAB}\n${fila("09:30:00")}\n`), {
    columnMapping: { "Fecha Cita": "date", "Hora Inicio Cita": "time", "Nombre Profesional Cita": "doctor", "Nombre Paciente": "name", "Apellidos Paciente": "lastName", Celular: "phone" },
  });
  assert.equal(r.preview[0].status, "error");
  assert.match(r.preview[0].errors.join(" "), /Doctor "ANA" no encontrado/);
});

test("si el nombre ya trae los apellidos, no se repiten", async () => {
  base = crearBase(semilla());
  const { unirNombreDoctor } = await engine();
  assert.equal(unirNombreDoctor("ANA PRUEBA LOPEZ", "Prueba López"), "ANA PRUEBA LOPEZ");
  assert.equal(unirNombreDoctor("ANA ", "PRUEBA LOPEZ"), "ANA PRUEBA LOPEZ");
  assert.equal(unirNombreDoctor("", "PRUEBA"), "PRUEBA");
  assert.equal(unirNombreDoctor("ANA", ""), "ANA");
});

test("duración: sale de la hora de fin (30, 60 y 90 min)", async () => {
  base = crearBase(semilla());
  const filas = [
    "2030-10-05,09:00:00,09:30:00,ANA,PRUEBA LOPEZ,Lucía,Prueba Uno,5551234567",
    "2030-10-05,11:00:00,12:00:00,ANA,PRUEBA LOPEZ,Lucía,Prueba Uno,5551234567",
    "2030-10-05,14:00:00,15:30:00,ANA,PRUEBA LOPEZ,Lucía,Prueba Uno,5551234567",
  ];
  const r = await correr("appointments", csv(`${CAB}\n${filas.join("\n")}\n`));
  assert.deepEqual(r.preview.map((x: any) => x.data.durationMin), [30, 60, 90]);
  assert.deepEqual(r.preview.map((x: any) => x.status), ["ok", "ok", "ok"]);
});

test("duración: la hora de fin manda cuando no hay «Duración» y «Duración» manda cuando viene", async () => {
  base = crearBase(semilla());
  const solo = await correr("appointments", csv(`${CAB}\n2030-10-05,09:00:00,10:00:00,ANA,PRUEBA LOPEZ,Lucía,Prueba Uno,5551234567\n`));
  assert.equal(solo.preview[0].data.durationMin, 60);
  assert.equal(solo.preview[0].data.endsAt.getTime() - solo.preview[0].data.startsAt.getTime(), 60 * 60_000);
  const con = await correr("appointments", csv(`${CAB},Duración\n2030-10-05,09:00:00,10:00:00,ANA,PRUEBA LOPEZ,Lucía,Prueba Uno,5551234567,45\n`));
  assert.equal(con.preview[0].data.durationMin, 45, "«Duración» gana a la hora de fin");
});

test("sin hora de fin ni «Duración»: 30 min, sin aviso", async () => {
  base = crearBase(semilla());
  const r = await correr("appointments", csv(`Fecha Cita,Hora Inicio Cita,Nombre Profesional Cita,Apellidos Profesional Cita,Nombre Paciente,Apellidos Paciente,Celular\n2030-10-05,09:00:00,ANA,PRUEBA LOPEZ,Lucía,Prueba Uno,5551234567\n`));
  assert.equal(r.preview[0].data.durationMin, 30);
  assert.deepEqual(r.preview[0].warnings, []);
});

test("una hora de fin anterior al inicio o ilegible NO se adivina: 30 min y aviso", async () => {
  base = crearBase(semilla());
  const antes = await correr("appointments", csv(`${CAB}\n2030-10-05,09:00:00,08:00:00,ANA,PRUEBA LOPEZ,Lucía,Prueba Uno,5551234567\n`));
  assert.equal(antes.preview[0].data.durationMin, 30);
  assert.match(antes.preview[0].warnings.join(" "), /no es posterior al inicio/);
  const raro = await correr("appointments", csv(`${CAB}\n2030-10-05,09:00:00,mañana,ANA,PRUEBA LOPEZ,Lucía,Prueba Uno,5551234567\n`));
  assert.equal(raro.preview[0].data.durationMin, 30);
  assert.match(raro.preview[0].warnings.join(" "), /ilegible/);
  assert.equal(raro.preview[0].status, "ok", "un aviso no bloquea la cita");
});

test("la duración se calcula en la zona de la clínica (no depende del huso del servidor)", async () => {
  base = crearBase(semilla());
  const r = await correr("appointments", csv(`${CAB}\n2030-10-05,09:00:00,11:00:00,ANA,PRUEBA LOPEZ,Lucía,Prueba Uno,5551234567\n`));
  assert.equal(r.preview[0].data.durationMin, 120);
  assert.equal(r.preview[0].data.startsLocal.includes("09:00"), true);
});

test("el doctor partido también sirve en el historial de citas", async () => {
  base = crearBase(semilla());
  for (const entidad of ["appointmentHistory"]) {
    const r = await correr(entidad, csv(`${CAB},Estado Cita\n2026-01-05,09:00:00,10:00:00,ANA,PRUEBA LOPEZ,Lucía,Prueba Uno,5551234567,Atendido\n`));
    assert.equal(r.mappingError, undefined, entidad);
    assert.equal(r.preview[0].status, "ok", entidad + " " + r.preview[0].errors.join());
    assert.deepEqual(r.preview[0].warnings.filter((w: string) => /Doctor/.test(w)), [], entidad + ": el doctor se encontró");
  }
});
