/**
 * ws1-t12 — PERFIL DENTALINK contra los ENCABEZADOS REALES de BEVADENT (28-sep-2026).
 *
 * Los cuatro archivos que la clínica subió por «Migración asistida» (tickets 7-10):
 * 01_Pacientes, 05_Citas_2026_a_2028 (CSV), 04_Saldos («Mora») y
 * 06_Presupuestos_Detalle_2026-2027. Aquí van SOLO sus encabezados (no son datos de
 * pacientes) y filas inventadas. Lo que se prueba es lo que el perfil controla: qué
 * columna reconoce el motor sin que nadie la empareje a mano.
 *
 * También fija lo que el perfil resuelve con ayuda del motor: el doctor partido en dos
 * columnas, la duración por «Hora Fin Cita» y que «Arancel» / «Prestación» NO se tomen
 * por precio / procedimiento (y que otros orígenes sigan autodetectándolas).
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/import/__tests__/perfil-dentalink-bevadent.test.ts
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { crearBase, type Base } from "./doble-prisma";

const CLINICA = "cli_A";
const IMPORTA = "u_admin";

let base: Base = crearBase({
  clinic: [{ id: CLINICA, name: "Clínica de prueba", timezone: "America/Mexico_City" }],
  user: [{ id: IMPORTA, clinicId: CLINICA, firstName: "Ana", lastName: "Prueba", isActive: true }],
  patient: [],
  importExternalIds: [],
});
mock.module("@/lib/prisma", { namedExports: { prisma: new Proxy({}, { get: (_t, k: string) => base.prisma[k] }) } });
mock.module("@/lib/audit", { namedExports: { logAudit: async () => {} } });
mock.module("@/lib/patient-quota", {
  namedExports: { getPatientQuota: async () => ({ unlimited: true, used: 0, max: null, remaining: null }) },
});
mock.module("@/lib/invoices/next-invoice-number", { namedExports: { lastInvoiceFolio: async () => 500 } });

const engine = () => import("../engine");
const entidades = () => import("../entities");

const PACIENTES = ["# Paciente", "# Interno", "Cédula identidad / DNI", "Nombre", "Apellidos", "Fecha de nac.", "Edad", "Teléfono", "Celular", "Ciudad", "Comuna", "Dirección", "E-Mail", "Alertas", "Observaciones", "Sexo", "Tipo Paciente", "# Apoderado", "Convenio", "Nombre Empresa Convenio", "Empleador", "Referencia"];
const CITAS = ["# Cita", "Estado Cita", "Fecha Cita", "Mes Cita", "Año Cita", "Hora Inicio Cita", "Hora Fin Cita", "Comentario Cita", "Sillón (Recurso)", "# Tratamiento", "Nombre Profesional Cita", "Apellidos Profesional Cita", "Especialidad Profesional", "# Paciente", "Número interno", "Cédula identidad / DNI Paciente", "Nombre Paciente", "Apellidos Paciente", "Fecha de nac.", "E-Mail", "Teléfono", "Celular", "Referencia Paciente", "Cédula identidad / DNI Apoderado", "Nombre Apoderado", "Teléfono Apoderado", "Celular Apoderado", "Convenio Paciente", "Convenio Tratamiento", "Tipo Paciente", "Fecha de generación del tratamiento", "Mes de generación del tratamiento", "Año de generación del tratamiento", "Nombre Sucursal", "Agendado por", "Fecha de creación de cita", "Observaciones", "Motivo de Atención"];
const SALDOS = ["Nombre Sucursal", "# Tratamiento", "Paciente", "Número Interno", "Cédula identidad / DNI Paciente", "Nombre Paciente", "Apellidos Paciente", "Teléfono", "Celular", "E-Mail", "Referencia Paciente", "Cédula identidad / DNI Apoderado", "Nombre Apoderado", "Nombre Profesional Tratante", "Apellidos Profesional Tratante", "Tipo Paciente", "Convenio Actual Paciente", "Mora"];
const PRESUPUESTOS = ["Nombre Sucursal", "# Tratamiento", "Convenio Tratamiento", "Fecha de generación del tratamiento", "Mes de generación del tratamiento", "Año de generación del tratamiento", "Fecha de captura del tratamiento", "Mes de captura del tratamiento", "Año de captura del tratamiento", "# Detalle Presupuesto", "Código Prestación", "Nombre Prestación", "Nombre Categoría", "Arancel", "Prestación", "Fecha Realización", "Precio Original", "Precio Paciente", "Pagado Prestación", "Especialidad Profesional Tratamiento", "Nombre Profesional Tratamiento", "# Paciente", "Cédula identidad / DNI Paciente", "Número Interno", "Nombre Paciente", "Apellidos Paciente", "Fecha de nac.", "Teléfono", "Celular", "Ciudad", "Municipio", "Dirección", "E-Mail", "Referencia Paciente", "Fecha Afiliación", "Fecha última acción realizada", "Total Presupuesto", "Tratamiento Iniciado", "Tratamiento Capturado", "Total Pagos Tratamiento", "Estado Tratamiento"];

/** CSV con los encabezados tal cual y una fila inventada (valores sin sentido: aquí solo importa la estructura). */
function csv(nombre: string, cabeceras: string[], valores: Record<string, string> = {}): File {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const fila = cabeceras.map((h) => esc(valores[h] ?? "1"));
  return new File(["﻿" + cabeceras.map(esc).join(",") + "\n" + fila.join(",") + "\n"], nombre, { type: "text/csv" });
}

async function vistaPrevia(entidad: string, file: File): Promise<any> {
  const { runImport } = await engine();
  const { HANDLERS } = await entidades();
  return runImport(HANDLERS[entidad], { file, clinicId: CLINICA, userId: IMPORTA, role: "ADMIN", dryRun: true, skipDuplicates: true, origin: "dentalink" });
}

test("01_Pacientes: cada una de las 22 columnas tiene destino — a su campo, o (sin campo) a las notas", async () => {
  const r = await vistaPrevia("patients", csv("01_Pacientes.csv", PACIENTES, { Nombre: "Lucía", Apellidos: "Prueba Uno", "Fecha de nac.": "1990-05-17", Celular: "+525512345678", "E-Mail": "lucia@ejemplo.test" }));
  assert.equal(r.mappingError, undefined);
  const m = r.suggestedMapping;
  assert.deepEqual(m, {
    "# Paciente": "externalId",
    "Cédula identidad / DNI": "nationalId",
    "Nombre": "firstName",
    "Apellidos": "lastName",
    "Fecha de nac.": "dob",
    "Teléfono": "phoneAlt",
    "Celular": "phone",
    "Ciudad": "city",
    "Comuna": "colonia",
    "Dirección": "address",
    "E-Mail": "email",
    "Alertas": "patientAlerts",
    "Observaciones": "notes",
    "Sexo": "gender",
    "Tipo Paciente": "tags",
    "# Apoderado": "guardianName",
    "Convenio": "insuranceProvider",
    "Referencia": "source",
  });
  // Sin campo en Patient: no se reconocen, y el importador las conserva en las notas («Dato de Dentalink: …»)
  // — ver paciente-ficha-completa.test.ts. «Edad» solo se conserva si falta la fecha de nacimiento.
  const sinCampo = PACIENTES.filter((c) => !m[c]);
  assert.deepEqual(sinCampo, ["# Interno", "Edad", "Nombre Empresa Convenio", "Empleador"]);
  assert.equal(r.validos, 1);
});

test("04_Saldos: «Paciente» es el ID (no el nombre) y «Mora» es el monto", async () => {
  const r = await vistaPrevia("balances", csv("04_Saldos.csv", SALDOS, { Paciente: "1042", "Nombre Paciente": "Lucía", "Apellidos Paciente": "Prueba Uno", Mora: "600" }));
  assert.equal(r.mappingError, undefined, "con «Mora» + ID el saldo ya no se detiene en el mapeo");
  assert.equal(r.suggestedMapping["Paciente"], "patientExternalId");
  assert.equal(r.suggestedMapping["Mora"], "amount");
  assert.equal(r.suggestedMapping["Nombre Paciente"], "name");
  assert.equal(r.suggestedMapping["Apellidos Paciente"], "lastName");
});

test("06_Presupuestos_Detalle: presupuesto por «# Tratamiento», línea por «Nombre Prestación», precio = «Precio Paciente»", async () => {
  for (const entidad of ["quotes", "treatmentPlans"]) {
    const r = await vistaPrevia(entidad, csv("06_Presupuestos_Detalle.csv", PRESUPUESTOS, {
      "# Paciente": "1042", "# Tratamiento": "77", "Fecha de generación del tratamiento": "2026-05-12 10:30:00",
      "Nombre Prestación": "Profilaxis", "Precio Paciente": "1200", "Precio Original": "1500", "Nombre Profesional Tratamiento": "Ana  Prueba",
    }));
    assert.equal(r.mappingError, undefined, `${entidad}: ya no se detiene en el mapeo`);
    const m = r.suggestedMapping;
    assert.equal(m["# Paciente"], "patientExternalId", entidad);
    assert.equal(m["# Tratamiento"], "folio", entidad);
    assert.equal(m["Fecha de generación del tratamiento"], "date", entidad);
    assert.equal(m["Nombre Prestación"], "procedure", entidad);
    assert.equal(m["Precio Paciente"], "price", entidad);
    assert.equal(m["Nombre Profesional Tratamiento"], "doctor", entidad);
    // Se REPITEN en cada fila del tratamiento: mapearlos a un total de línea lo duplicaría en cada línea.
    assert.equal(m["Total Presupuesto"], undefined, entidad);
    assert.equal(m["Pagado Prestación"] || undefined, undefined, entidad + ": el pagado por línea no es lo abonado");
  }
  const tp = await vistaPrevia("treatmentPlans", csv("06.csv", PRESUPUESTOS, { "# Paciente": "1042", "# Tratamiento": "77", "Fecha de generación del tratamiento": "2026-05-12 10:30:00", "Nombre Prestación": "Profilaxis", "Precio Paciente": "1200" }));
  assert.equal(tp.suggestedMapping["Total Pagos Tratamiento"], "abonado", "lo abonado es del tratamiento (igual en todas sus líneas)");
  assert.equal(tp.suggestedMapping["Estado Tratamiento"], "estadoTratamiento");
  const q = await vistaPrevia("quotes", csv("06q.csv", PRESUPUESTOS, { "# Paciente": "1042", "# Tratamiento": "77", "Fecha de generación del tratamiento": "2026-05-12 10:30:00", "Nombre Prestación": "Profilaxis", "Precio Paciente": "1200" }));
  assert.equal(q.suggestedMapping["Total Pagos Tratamiento"], undefined, "presupuestos no lleva abonado");
  assert.equal(tp.suggestedMapping["Fecha Realización"], "fechaRealizado");
});

test("05_Citas: reconoce ID, fecha, hora de inicio y de fin, estado, motivo y el doctor partido en dos columnas", async () => {
  const r = await vistaPrevia("appointments", csv("05_Citas.csv", CITAS, { "Fecha Cita": "2030-10-05", "Hora Inicio Cita": "09:30:00", "Hora Fin Cita": "10:30:00", "Estado Cita": "No confirmado", "Nombre Paciente": "Lucía", "Apellidos Paciente": "Prueba Uno", "Nombre Profesional Cita": "ANA", "Apellidos Profesional Cita": "PRUEBA" }));
  const m = r.suggestedMapping;
  assert.equal(m["# Paciente"], "patientExternalId");
  assert.equal(m["Fecha Cita"], "date");
  assert.equal(m["Hora Inicio Cita"], "time");
  assert.equal(m["Hora Fin Cita"], "endTime", "la hora de fin NO va a `time`: pisaría la de inicio");
  assert.equal(m["Estado Cita"], "status");
  assert.equal(m["Motivo de Atención"], "type");
  assert.equal(m["Comentario Cita"], "notes");
  assert.equal(m["Nombre Profesional Cita"], "doctor");
  assert.equal(m["Apellidos Profesional Cita"], "doctorLastName");
  assert.equal(r.mappingError, undefined, "con el doctor reconocido la cita ya no se detiene en el mapeo");
});

test("06_Presupuestos_Detalle: «Arancel» y «Prestación» se IGNORAN (no son precio ni procedimiento) en presupuestos y tratamientos", async () => {
  for (const entidad of ["quotes", "treatmentPlans"]) {
    const r = await vistaPrevia(entidad, csv("06.csv", PRESUPUESTOS, { "# Paciente": "1042", "# Tratamiento": "77", "Fecha de generación del tratamiento": "2026-05-12", "Nombre Prestación": "Profilaxis", "Precio Paciente": "1200", Arancel: "Arancel Base", "Prestación": "Acción Clínica" }));
    const m = r.suggestedMapping;
    assert.ok(!m["Arancel"], `${entidad}: «Arancel» no es precio`);
    assert.ok(!m["Prestación"], `${entidad}: «Prestación» (la categoría) no es procedimiento`);
    assert.equal(m["Precio Paciente"], "price", entidad);
    assert.equal(m["Nombre Prestación"], "procedure", entidad);
    assert.equal(r.mappingError, undefined, entidad);
    assert.ok(!r.preview[0].errors.some((e: string) => /Precio inválido/.test(e)), `${entidad}: el precio sale de «Precio Paciente», sin quitar columnas a mano`);
  }
});

test("«Arancel» sigue autodetectándose como precio en OTROS orígenes (el marcador de ignorar es solo de Dentalink)", async () => {
  const { runImport } = await engine();
  const { HANDLERS } = await entidades();
  const r: any = await runImport(HANDLERS.quotes, { file: new File(["\uFEFFPaciente,Fecha,Procedimiento,Arancel\nLucía Prueba,2026-05-12,Profilaxis,1200\n"], "otro.csv", { type: "text/csv" }), clinicId: CLINICA, userId: IMPORTA, role: "ADMIN", dryRun: true, skipDuplicates: true, origin: "opendental" });
  assert.equal(r.suggestedMapping["Arancel"], "price");
});
