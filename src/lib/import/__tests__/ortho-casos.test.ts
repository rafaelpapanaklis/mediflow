/**
 * ws1-t1 — CASOS DE ORTODONCIA MIGRADOS (orthoCasesHandler, archivo nuevo
 * src/lib/import/ortho-casos/handler.ts — NO vive en entities.ts porque
 * ws1-t12 está cambiando ese archivo en paralelo).
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/import/__tests__/ortho-casos.test.ts
 *
 * Se conduce el motor DE VERDAD (runImport + orthoCasesHandler) con Prisma
 * sustituido por el doble en memoria (doble-prisma.ts). hasActiveOrthodonticsModule
 * se mockea aparte: el doble no resuelve el filtro por relación
 * (`module: { key }`) que esa función usa contra ClinicModule.
 *
 * Lo que prueban estos tests, en el orden que pide la tarea:
 *   · sin el módulo de Ortodoncia activo, ninguna fila se importa y dice por qué;
 *   · con el módulo activo, crea MigratedOrthoCase y NUNCA
 *     OrthodonticDiagnosis/OrthodonticTreatmentPlan/Invoice (nada de examen
 *     clínico inventado, nada de saldo duplicado);
 *   · reimportar el mismo archivo no duplica;
 *   · el paciente se resuelve STRICT (no se le abre el caso al hermano que
 *     comparte el teléfono);
 *   · el modo de cobro PAGO_POR_CONTROL se avisa pero no bloquea.
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
      // Comparte celular con "María" (la mamá que registró su número para los hijos).
      { id: "p2", clinicId: CLINICA, patientNumber: "P-0002", firstName: "Juanito", lastName: "Hernández", phone: "5551234567", email: null, deletedAt: null, visibleUserIds: [] },
    ],
    user: [
      { id: IMPORTA, clinicId: CLINICA, firstName: "Rafael", lastName: "Admin", isActive: true },
      { id: "doc1", clinicId: CLINICA, firstName: "Carla", lastName: "Ruiz", isActive: true },
    ],
    orthodonticsClinicSettings: [],
    migratedOrthoCase: [],
    orthodonticDiagnosis: [],
    orthodonticTreatmentPlan: [],
    invoice: [],
    payment: [],
  };
}

let base: Base = crearBase(semilla());
let moduloActivo = true;
mock.module("@/lib/prisma", { namedExports: { prisma: new Proxy({}, { get: (_t, k: string) => base.prisma[k] }) } });
mock.module("@/lib/audit", { namedExports: { logAudit: async () => {} } });
mock.module("@/lib/orthodontics/access", {
  namedExports: { hasActiveOrthodonticsModule: async () => moduloActivo },
});

const engine = () => import("../engine");
const manejador = () => import("../ortho-casos/handler");

function reiniciar() {
  base = crearBase(semilla());
  moduloActivo = true;
}

const csv = (nombre: string, texto: string) => new File([texto], nombre, { type: "text/csv" });
const tabla = (m: string) => base.tablas[m] ?? [];
const fila = (res: any, n: number) => res.preview.find((r: any) => r.row === n);

async function correr(file: File, opts: { dryRun?: boolean; skipDuplicates?: boolean } = { dryRun: true }): Promise<any> {
  const { runImport } = await engine();
  const { orthoCasesHandler } = await manejador();
  return runImport(orthoCasesHandler, {
    file,
    clinicId: CLINICA,
    userId: IMPORTA,
    role: "ADMIN",
    dryRun: opts.dryRun ?? true,
    skipDuplicates: opts.skipDuplicates ?? true,
    columnMapping: null,
    origin: null,
    valueMapping: null,
    sheet: null,
  });
}

const CABECERA = "nombre,apellido,telefono,tecnica,doctor,fechacolocacion,estado,duracion,preciototal";

test("sin el módulo de Ortodoncia activo: ninguna fila se importa, y dice por qué", async () => {
  reiniciar();
  moduloActivo = false;
  const texto = [CABECERA, "María,Hernández,5551234567,Brackets metálicos,Carla Ruiz,2024-01-15,Activo,18,45000"].join("\n");
  const prev = await correr(csv("p1.csv", texto), { dryRun: true });
  assert.deepEqual([prev.total, prev.validos, prev.invalidos], [1, 0, 1]);
  assert.match(fila(prev, 2).errors.join(" · "), /módulo de Ortodoncia no está activo/);

  const hecho = await correr(csv("p1.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 0);
  assert.equal(tabla("migratedOrthoCase").length, 0);
});

test("con el módulo activo: crea MigratedOrthoCase y NUNCA el caso clínico vivo ni una factura", async () => {
  reiniciar();
  const texto = [CABECERA, "María,Hernández,5551234567,Brackets metálicos,Carla Ruiz,2024-01-15,Activo,18,45000"].join("\n");

  const prev = await correr(csv("p1.csv", texto), { dryRun: true });
  assert.equal(prev.mappingError, undefined, JSON.stringify(prev));
  assert.deepEqual([prev.total, prev.validos, prev.invalidos, prev.duplicados], [1, 1, 0, 0]);

  const hecho = await correr(csv("p1.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 1);
  assert.equal(tabla("migratedOrthoCase").length, 1);
  const c = tabla("migratedOrthoCase")[0];
  assert.equal(c.patientId, "p1");
  assert.equal(c.technique, "Brackets metálicos");
  assert.equal(c.treatingDoctorId, "doc1");
  assert.equal(c.status, "ACTIVE");
  assert.equal(c.statusRaw, "Activo");
  assert.equal(c.estimatedDurationMonths, 18);
  assert.equal(c.totalAmount, 45000);
  assert.equal(c.origin, "otro sistema");

  // Lo que hace que NO se invente examen clínico ni se duplique el saldo:
  assert.equal(tabla("orthodonticDiagnosis").length, 0, "no crea diagnóstico clínico");
  assert.equal(tabla("orthodonticTreatmentPlan").length, 0, "no crea plan de tratamiento");
  assert.equal(tabla("invoice").length, 0, "no crea facturas");
});

test("reimportar el mismo archivo no duplica (misma llave paciente+técnica+fecha)", async () => {
  reiniciar();
  const texto = [CABECERA, "María,Hernández,5551234567,Brackets metálicos,Carla Ruiz,2024-01-15,Activo,18,45000"].join("\n");
  await correr(csv("p1.csv", texto), { dryRun: false });
  assert.equal(tabla("migratedOrthoCase").length, 1);

  const prev2 = await correr(csv("p1.csv", texto), { dryRun: true });
  assert.equal(fila(prev2, 2).status, "skipped");
  assert.match(fila(prev2, 2).warnings.join(" · "), /ya se importó antes/);

  const otraVez = await correr(csv("p1.csv", texto), { dryRun: false, skipDuplicates: false });
  assert.equal(otraVez.created, 0, "ni con «omitir duplicados» apagado se vuelve a crear: ya se importó");
  assert.equal(tabla("migratedOrthoCase").length, 1);
});

test("teléfono compartido con otra persona: el nombre de la fila manda (no se le abre el caso a la mamá)", async () => {
  reiniciar();
  const texto = [CABECERA, "Juanito,Hernández,5551234567,Alineadores,,2024-02-01,En tratamiento,12,"].join("\n");
  const hecho = await correr(csv("p3.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 1);
  assert.equal(tabla("migratedOrthoCase")[0].patientId, "p2", "el caso quedó en Juanito, no en su mamá");
  assert.equal(tabla("migratedOrthoCase")[0].status, "ACTIVE");
});

test("doctor que no existe como usuario: avisa y guarda solo el nombre, no bloquea la fila", async () => {
  reiniciar();
  const texto = [CABECERA, "María,Hernández,5551234567,Brackets,Dr. Fulano,2024-01-15,Activo,18,"].join("\n");
  const prev = await correr(csv("p1.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "ok");
  assert.match(fila(prev, 2).warnings.join(" · "), /Doctor "Dr\. Fulano" no encontrado/);

  const hecho = await correr(csv("p1.csv", texto), { dryRun: false });
  assert.equal(tabla("migratedOrthoCase")[0].treatingDoctorId, null);
  assert.equal(tabla("migratedOrthoCase")[0].treatingDoctorName, "Dr. Fulano");
});

test("modo de cobro PAGO_POR_CONTROL: se avisa pero no bloquea la importación", async () => {
  reiniciar();
  base.tablas.orthodonticsClinicSettings.push({ clinicId: CLINICA, billingMode: "PAGO_POR_CONTROL" });
  const texto = [CABECERA, "María,Hernández,5551234567,Brackets,Carla Ruiz,2024-01-15,Activo,18,45000"].join("\n");
  const prev = await correr(csv("p1.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "ok");
  assert.match(fila(prev, 2).warnings.join(" · "), /cobra por control/);
});

test("monto ambiguo sin evidencia: se marca pendiente, no se adivina", async () => {
  reiniciar();
  const texto = [CABECERA, "María,Hernández,5551234567,Brackets,Carla Ruiz,2024-01-15,Activo,18,45.000"].join("\n");
  const prev = await correr(csv("p1.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "error");
  assert.ok(prev.unresolved?.some((u: any) => u.field === "amountFormat"), "queda pendiente de confirmar el formato");
});

test("sin ninguna columna de identidad: mappingError, no se procesa nada", async () => {
  reiniciar();
  const texto = ["tecnica,estado", "Brackets,Activo"].join("\n");
  const prev = await correr(csv("p1.csv", texto), { dryRun: true });
  assert.match(prev.mappingError ?? "", /identificar al paciente/);
});
