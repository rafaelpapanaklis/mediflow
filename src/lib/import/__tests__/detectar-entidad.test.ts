/**
 * ws1-t12 — detección automática de QUÉ ES un archivo/hoja subido al
 * importador (`detect-entity.ts`), para "subir varios archivos a la vez".
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/import/__tests__/detectar-entidad.test.ts
 *
 * `detect-entity.ts` importa `entities.ts` (HANDLERS), que arrastra Prisma —
 * se sustituye por un proxy vacío (no se hace NINGUNA consulta: solo se usan
 * `headerVariants`/`validateMapping`, puros y síncronos).
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("@/lib/prisma", { namedExports: { prisma: new Proxy({}, { get: () => ({}) }) } });
mock.module("@/lib/audit", { namedExports: { logAudit: async () => {} } });
mock.module("@/lib/patient-quota", {
  namedExports: { getPatientQuota: async () => ({ unlimited: true, used: 0, max: null, remaining: null }) },
});

const mod = () => import("../detect-entity");

test("pacientes: columnas claras → alta confianza, sin ambigüedad", async () => {
  const { detectEntitiesForColumns, mejorEntidad } = await mod();
  const cols = ["Nombre", "Apellido", "Teléfono", "Correo", "Fecha de nacimiento"];
  const guesses = detectEntitiesForColumns(cols, "pacientes.csv", undefined, null);
  const { entity, confianza } = mejorEntidad(guesses);
  assert.equal(entity, "patients");
  assert.equal(confianza, "alta");
});

test("saldos: columnas de monto + identidad → balances", async () => {
  const { detectEntitiesForColumns, mejorEntidad } = await mod();
  const cols = ["Nombre", "Teléfono", "Saldo pendiente"];
  const { entity } = mejorEntidad(detectEntitiesForColumns(cols, "morosos.csv", undefined, null));
  assert.equal(entity, "balances");
});

test("citas: fecha + doctor + identidad → appointments", async () => {
  const { detectEntitiesForColumns, mejorEntidad } = await mod();
  const cols = ["Paciente", "Teléfono", "Fecha", "Hora", "Doctor", "Estado"];
  const { entity } = mejorEntidad(detectEntitiesForColumns(cols, "agenda.csv", undefined, null));
  assert.equal(entity, "appointments");
});

test("presupuestos vs tratamientos activos: sin columnas exclusivas, casi empatan (confianza rebajada)", async () => {
  const { detectEntitiesForColumns, mejorEntidad } = await mod();
  // Ni "Estado" ni "Abonado" ni fechas de realizado: ambas entidades cubren
  // sus campos obligatorios con las MISMAS columnas.
  const cols = ["Nombre", "Apellido", "Teléfono", "Fecha", "Procedimiento", "Precio"];
  const guesses = detectEntitiesForColumns(cols, "datos.csv", undefined, null);
  const quotes = guesses.find((g) => g.entity === "quotes")!;
  const plans = guesses.find((g) => g.entity === "treatmentPlans")!;
  assert.equal(quotes.requiredOk, true);
  assert.equal(plans.requiredOk, true);
  const { entity, confianza } = mejorEntidad(guesses);
  assert.ok(entity === "quotes" || entity === "treatmentPlans");
  assert.notEqual(confianza, "alta", "un empate estructural nunca sale con confianza alta");
});

test("tratamientos activos: con «Estado»/«Abonado» ya no hay ambigüedad", async () => {
  const { detectEntitiesForColumns, mejorEntidad } = await mod();
  const cols = ["Nombre", "Apellido", "Teléfono", "Fecha", "Procedimiento", "Precio", "Estado", "Abonado", "Fecha de abono"];
  const { entity } = mejorEntidad(detectEntitiesForColumns(cols, "tratamientos_activos.csv", undefined, null));
  assert.equal(entity, "treatmentPlans");
});

test("el nombre del archivo/hoja desempata cuando las columnas por sí solas empatan", async () => {
  const { detectEntitiesForColumns, mejorEntidad } = await mod();
  const cols = ["Nombre", "Apellido", "Teléfono", "Fecha", "Procedimiento", "Precio"];
  const conNombre = detectEntitiesForColumns(cols, "cualquiera.csv", "Tratamientos activos", null);
  const { entity } = mejorEntidad(conNombre);
  assert.equal(entity, "treatmentPlans", "el nombre de la pestaña coincide con sheetNames de treatmentPlans");
});

test("notas de evolución vs notas de tratamiento: el folio decide", async () => {
  const { detectEntitiesForColumns, mejorEntidad } = await mod();
  const sinFolio = ["Nombre", "Apellido", "Teléfono", "Fecha", "Doctor", "Nota"];
  assert.equal(mejorEntidad(detectEntitiesForColumns(sinFolio, "archivo1.csv", undefined, null)).entity, "clinicalNotes");

  const conFolio = ["Nombre", "Apellido", "Teléfono", "Fecha", "Doctor", "Folio", "Nota"];
  assert.equal(mejorEntidad(detectEntitiesForColumns(conFolio, "archivo2.csv", undefined, null)).entity, "treatmentNotes");
});

test("odontograma: pieza + hallazgo → odontogram", async () => {
  const { detectEntitiesForColumns, mejorEntidad } = await mod();
  const cols = ["Nombre", "Apellido", "Teléfono", "Pieza", "Cara", "Hallazgo"];
  assert.equal(mejorEntidad(detectEntitiesForColumns(cols, "odontograma.csv", undefined, null)).entity, "odontogram");
});

test("columnas sin relación con ninguna entidad → sin identificar (nunca se adivina)", async () => {
  const { detectEntitiesForColumns, mejorEntidad } = await mod();
  const cols = ["Producto", "Precio unitario", "Cantidad en stock", "Proveedor"];
  const guesses = detectEntitiesForColumns(cols, "inventario.csv", undefined, null);
  assert.ok(guesses.every((g) => !g.requiredOk), "ninguna entidad debería cubrir sus campos obligatorios");
  const { entity, confianza } = mejorEntidad(guesses);
  assert.equal(entity, null);
  assert.equal(confianza, null);
});

test("orden de dependencia: pacientes primero, tratamientos activos antes que sus notas", async () => {
  const { ENTITY_IMPORT_ORDER, ordenDe } = await mod();
  assert.equal(ENTITY_IMPORT_ORDER[0], "patients");
  assert.ok(ordenDe("treatmentPlans") < ordenDe("treatmentNotes"));
  assert.ok(ordenDe("patients") < ordenDe("balances"));
  assert.ok(ordenDe("patients") < ordenDe("appointments"));
  // Sin identificar siempre queda al final, después de cualquier entidad real
  // (incluidas las 6 registradas por ws1-t1/t2/t6/t12 en esta ola: doctors,
  // blockedHours, appointmentHistory, orthoCases, labExpenseHistory,
  // installmentPlans — ver ENTITY_IMPORT_ORDER).
  for (const e of ENTITY_IMPORT_ORDER) assert.ok(ordenDe(null) > ordenDe(e), `null debe ir después de ${e}`);
  // Doctores resuelto antes que lo que lo necesita (citas, bloqueos, casos de ortodoncia).
  assert.ok(ordenDe("doctors") < ordenDe("appointments"));
  assert.ok(ordenDe("doctors") < ordenDe("blockedHours"));
  assert.ok(ordenDe("doctors") < ordenDe("orthoCases"));
  // Cuotas por vencer, después de lo que puede anclar su deuda.
  assert.ok(ordenDe("balances") < ordenDe("installmentPlans"));
  assert.ok(ordenDe("orthoCases") < ordenDe("installmentPlans"));
});
