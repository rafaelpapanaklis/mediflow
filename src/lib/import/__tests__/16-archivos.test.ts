/**
 * ws1-t12 — lote de prueba de los 16 archivos de BEVADENT (export de Dentalink):
 * cada uno con columnas sintéticas probables, pasado por la detección y
 * ordenado con ENTITY_IMPORT_ORDER. Los encabezados NO están validados contra
 * un export real (perfil verified:false): el test fija el comportamiento del
 * motor, no el de Dentalink.
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/import/__tests__/16-archivos.test.ts
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("@/lib/prisma", { namedExports: { prisma: new Proxy({}, { get: () => ({}) }) } });
mock.module("@/lib/audit", { namedExports: { logAudit: async () => {} } });
mock.module("@/lib/patient-quota", {
  namedExports: { getPatientQuota: async () => ({ unlimited: true, used: 0, max: null, remaining: null }) },
});

const mod = () => import("../detect-entity");

const ID = ["Id paciente", "Nombre", "Apellidos"];
const LOTE: { archivo: string; cols: string[]; esperado: string | null }[] = [
  { archivo: "01_Pacientes.csv", cols: ["Id", "Nombre", "Apellidos", "Celular", "Email", "Fecha de nacimiento", "Sexo"], esperado: "patients" },
  { archivo: "04_Saldos.csv", cols: [...ID, "Celular", "Saldo pendiente"], esperado: "balances" },
  { archivo: "05b_Citas_Estados_Historico.csv", cols: ["Paciente", "Celular", "Fecha", "Hora", "Dentista", "Estado"], esperado: "appointmentHistory" },
  { archivo: "06_Presupuestos_Detalle_2026-2027.csv", cols: [...ID, "N° Presupuesto", "Fecha presupuesto", "Prestación", "Pieza", "Valor", "Total"], esperado: "quotes" },
  { archivo: "08_Pagos_Movimientos.csv", cols: [...ID, "Fecha", "Monto pagado", "Medio de pago"], esperado: "paymentHistory" },
  { archivo: "08c_Pagos_Por_Vencimiento_2026-2027.csv", cols: [...ID, "N° Cuota", "Monto cuota", "Fecha de vencimiento", "Estado"], esperado: "installmentPlans" },
  { archivo: "09_Odontogramas.csv", cols: [...ID, "Pieza", "Hallazgo", "Superficie"], esperado: "odontogram" },
  { archivo: "10_Usuarios_Profesionales.csv", cols: ["Nombre", "Apellidos", "Email", "Cédula profesional", "Especialidad"], esperado: "doctors" },
  { archivo: "11_Pacientes_Ortodoncia.csv", cols: [...ID, "Doctor", "Fecha de inicio", "Total del tratamiento"], esperado: "orthoCases" },
  { archivo: "12_Aranceles_Precios.csv", cols: ["Código", "Prestación", "Categoría", "Precio"], esperado: "procedureCatalog" },
  { archivo: "13_Horas_Bloqueadas.csv", cols: ["Dentista", "Fecha", "Hora inicio", "Hora fin", "Motivo"], esperado: "blockedHours" },
  { archivo: "14_Laboratorio_Acciones_Costos.csv", cols: [...ID, "Laboratorio", "Acción", "Costo", "Fecha"], esperado: "labExpenseHistory" },
];

test("cada archivo del lote se detecta como su tipo (o queda sin identificar, nunca mal)", async () => {
  const { detectEntitiesForColumns, mejorEntidad } = await mod();
  for (const f of LOTE) {
    const { entity } = mejorEntidad(detectEntitiesForColumns(f.cols, f.archivo, undefined, null));
    assert.equal(entity, f.esperado, `${f.archivo} → ${entity}`);
  }
});

test("el lote se ordena por dependencia: pacientes primero, doctores antes de citas/bloqueos, sin repetir", async () => {
  const { ENTITY_IMPORT_ORDER, ordenDe } = await mod();
  const tipos = LOTE.map((f) => f.esperado as string);
  const ordenados = [...tipos].sort((a, b) => ordenDe(a as never) - ordenDe(b as never));
  assert.equal(ordenados[0], "patients");
  const pos = (e: string) => ordenados.indexOf(e);
  assert.ok(ordenDe("doctors") < ordenDe("appointments"));
  assert.ok(pos("doctors") < pos("blockedHours"));
  assert.ok(ordenDe("appointments") < ordenDe("blockedHours"), "el bloqueo revisa choque contra citas vivas");
  assert.ok(pos("doctors") < pos("appointmentHistory"));
  assert.ok(pos("orthoCases") < pos("installmentPlans"));
  assert.equal(new Set(ENTITY_IMPORT_ORDER).size, ENTITY_IMPORT_ORDER.length);
  for (const t of tipos) assert.ok(ENTITY_IMPORT_ORDER.includes(t as never), `${t} está en el orden`);
});

test("05 (citas vivas) y 05b (historial) comparten columnas: 05 nunca sale con confianza alta, 05b sí", async () => {
  const { detectEntitiesForColumns, mejorEntidad } = await mod();
  const cols = ["Paciente", "Celular", "Fecha", "Hora", "Dentista", "Estado"];
  const vivas = detectEntitiesForColumns(cols, "05_Citas_2026_a_2028.csv", undefined, null);
  assert.ok(vivas.slice(0, 2).some((g) => g.entity === "appointments"), "citas vivas entre las dos primeras sugerencias");
  assert.notEqual(mejorEntidad(vivas).confianza, "alta", "empate estructural: el usuario confirma a mano");
  const hist = detectEntitiesForColumns(cols, "05b_Citas_Estados_Historico.csv", undefined, null);
  assert.deepEqual(mejorEntidad(hist), { entity: "appointmentHistory", confianza: "alta" });
});

test("todo tipo registrado tiene handler y viceversa", async () => {
  const { ENTITY_IMPORT_ORDER } = await mod();
  const { HANDLERS } = await import("../entities");
  for (const e of ENTITY_IMPORT_ORDER) assert.ok(HANDLERS[e], `handler de ${e}`);
  for (const e of Object.keys(HANDLERS)) assert.ok(ENTITY_IMPORT_ORDER.includes(e as never), `${e} en el orden`);
});
