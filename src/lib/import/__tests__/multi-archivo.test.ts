/**
 * ws1-t12 — "Importar mi clínica": subir VARIOS archivos a la vez, detectar
 * cuál es cuál e importarlos en el orden correcto.
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/import/__tests__/multi-archivo.test.ts
 *
 * Dos partes:
 *  1. Clasificación de un lote sintético tipo Dentalink (6 archivos: pacientes,
 *     citas, saldos, presupuestos, tratamientos activos, notas de evolución de
 *     tratamiento) con `detectEntitiesForColumns` + el orden que produce
 *     `ordenDe`/`ENTITY_IMPORT_ORDER` — sin tocar la base.
 *  2. Integración real (doble de Prisma en memoria, como `importar-clinico.
 *     test.ts`): se corre `runImport` EN el orden detectado — pacientes primero
 *     — y la fila de citas resuelve al paciente que el archivo de pacientes
 *     ACABA de crear en el mismo lote. Con el orden invertido, la misma fila de
 *     citas falla: es la prueba de que el orden automático no es cosmético.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { crearBase, type Base } from "./doble-prisma";

mock.module("@/lib/patient-quota", {
  namedExports: { getPatientQuota: async () => ({ unlimited: true, used: 0, max: null, remaining: null }) },
});

const CLINICA = "cli_A";
const IMPORTA = "u_admin";

function semilla() {
  return {
    clinic: [{ id: CLINICA, name: "Clínica Sonrisa", logoUrl: null, timezone: "America/Mexico_City", city: "CDMX", address: "Av. Reforma 1", state: "CDMX", phone: "5550001111" }],
    patient: [],
    user: [{ id: IMPORTA, clinicId: CLINICA, firstName: "Rafael", lastName: "Admin", isActive: true }],
    procedureCatalog: [],
    quote: [],
    quoteItem: [],
    patientDocument: [],
    invoice: [],
    patientCredit: [],
    appointment: [],
  };
}

let base: Base;
const auditorias: any[] = [];

mock.module("@/lib/prisma", { namedExports: { prisma: new Proxy({}, { get: (_t, k: string) => base.prisma[k] }) } });
mock.module("@/lib/audit", { namedExports: { logAudit: async (o: any) => { auditorias.push(o); } } });

function reiniciar() {
  base = crearBase(semilla());
  auditorias.length = 0;
}

const detectMod = () => import("../detect-entity");
const engine = () => import("../engine");
const entidades = () => import("../entities");

async function correr(entidad: string, file: File, opts: { dryRun: boolean; sheet?: string | null } = { dryRun: false }) {
  const { runImport } = await engine();
  const { HANDLERS } = await entidades();
  return runImport(HANDLERS[entidad], {
    file,
    clinicId: CLINICA,
    userId: IMPORTA,
    role: "ADMIN",
    dryRun: opts.dryRun,
    skipDuplicates: true,
    columnMapping: null,
    origin: null,
    valueMapping: null,
    sheet: opts.sheet ?? null,
  });
}

// ═══ Parte 1: clasificar un lote de 6 archivos tipo Dentalink ══════════════

test("lote BEVADENT (6 archivos): cada uno se clasifica como lo que es, con requiredOk", async () => {
  const { detectEntitiesForColumns, mejorEntidad } = await detectMod();

  const archivos: { nombre: string; columnas: string[]; esperado: string }[] = [
    { nombre: "pacientes.csv", columnas: ["Nombre", "Apellido", "Celular", "Correo", "Fecha de nacimiento"], esperado: "patients" },
    { nombre: "citas.csv", columnas: ["Paciente", "Celular", "Fecha", "Hora", "Dentista", "Estado"], esperado: "appointments" },
    { nombre: "pagos.csv", columnas: ["Paciente", "Celular", "Monto adeudado"], esperado: "balances" },
    { nombre: "presupuestos.csv", columnas: ["Paciente", "Celular", "Fecha", "Procedimiento", "Precio", "Estado"], esperado: "quotes" },
    { nombre: "tratamientos_activos.csv", columnas: ["Paciente", "Celular", "Fecha", "Procedimiento", "Precio", "Estado", "Abonado", "Fecha de abono"], esperado: "treatmentPlans" },
    { nombre: "evolucion_tratamiento.csv", columnas: ["Paciente", "Celular", "Fecha", "Dentista", "Folio", "Nota"], esperado: "treatmentNotes" },
  ];

  for (const a of archivos) {
    const guesses = detectEntitiesForColumns(a.columnas, a.nombre, undefined, null);
    const { entity } = mejorEntidad(guesses);
    assert.equal(entity, a.esperado, `«${a.nombre}» debería detectarse como ${a.esperado}, salió ${entity}`);
    const top = guesses.find((g) => g.entity === entity)!;
    assert.equal(top.requiredOk, true, `«${a.nombre}»: la entidad detectada debe poder importarse de verdad`);
  }
});

test("lote BEVADENT: el orden calculado pone pacientes primero y notas de tratamiento al final", async () => {
  const { detectEntitiesForColumns, mejorEntidad, ordenDe } = await detectMod();
  const archivos = [
    { nombre: "evolucion_tratamiento.csv", columnas: ["Paciente", "Celular", "Fecha", "Dentista", "Folio", "Nota"] },
    { nombre: "tratamientos_activos.csv", columnas: ["Paciente", "Celular", "Fecha", "Procedimiento", "Precio", "Estado", "Abonado", "Fecha de abono"] },
    { nombre: "citas.csv", columnas: ["Paciente", "Celular", "Fecha", "Hora", "Dentista", "Estado"] },
    { nombre: "pacientes.csv", columnas: ["Nombre", "Apellido", "Celular", "Correo", "Fecha de nacimiento"] },
    { nombre: "pagos.csv", columnas: ["Paciente", "Celular", "Monto adeudado"] },
  ];
  const clasificados = archivos.map((a) => ({
    nombre: a.nombre,
    entity: mejorEntidad(detectEntitiesForColumns(a.columnas, a.nombre, undefined, null)).entity,
  }));
  const ordenado = [...clasificados].sort((x, y) => ordenDe(x.entity as any) - ordenDe(y.entity as any));
  assert.deepEqual(ordenado.map((x) => x.nombre), [
    "pacientes.csv",
    "pagos.csv",
    "citas.csv",
    "tratamientos_activos.csv",
    "evolucion_tratamiento.csv",
  ]);
});

// ═══ Parte 2: la dependencia entre archivos es REAL, no solo cosmética ═════

const CSV_PACIENTES = "nombre,apellido,celular\nCarla Mena,,9998436196\n";
const CSV_CITAS = "paciente,celular,fecha,hora,dentista\nCarla Mena,9998436196,15/01/2030,10:00,Dr. Rafael Admin\n";

test("pacientes → citas EN ESE ORDEN: la cita resuelve al paciente que el lote acaba de crear", async () => {
  reiniciar();
  assert.equal(base.tablas.patient.length, 0);

  const pacientes = new File([CSV_PACIENTES], "pacientes.csv");
  const rPacientes = await correr("patients", pacientes, { dryRun: false });
  assert.equal(rPacientes.created, 1, "el archivo de pacientes debe crear a Carla");
  assert.equal(base.tablas.patient.length, 1);

  const citas = new File([CSV_CITAS], "citas.csv");
  const rCitas = await correr("appointments", citas, { dryRun: false });
  assert.equal(rCitas.created, 1, "con pacientes YA importado en este mismo lote, la cita debe resolver a Carla");
  assert.equal(rCitas.errors.length, 0);
});

test("citas → pacientes EN ORDEN INVERTIDO: la cita falla («paciente no encontrado») — por eso el orden automático importa", async () => {
  reiniciar();
  assert.equal(base.tablas.patient.length, 0);

  const citas = new File([CSV_CITAS], "citas.csv");
  const rCitas = await correr("appointments", citas, { dryRun: false });
  assert.equal(rCitas.created, 0, "sin pacientes importados todavía, la cita no tiene a quién agendarle");
  assert.equal(rCitas.errors.length, 1);
  assert.match(rCitas.errors[0].errors[0], /no encontrad/i);
});
