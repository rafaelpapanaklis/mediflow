/**
 * ws1-t2 — HISTORIAL DE GASTOS DE LABORATORIO MIGRADO (labExpenseHandler,
 * archivo nuevo src/lib/import/laboratorio-historial/handler.ts — NO vive en
 * entities.ts porque varias pantallas de esta ola cambian ese archivo en
 * paralelo; el registro final es de ws1-t12).
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/import/__tests__/laboratorio-historial.test.ts
 *
 * Se conduce el motor DE VERDAD (runImport + labExpenseHandler) con Prisma
 * sustituido por el doble en memoria (doble-prisma.ts) — el mismo doble que ya
 * usa pagos-historial.test.ts; soporta `migratedLabExpense` sin cambios porque
 * el modelo genérico del doble no distingue de tabla.
 *
 * Lo que prueban estos tests, en el orden que pide la tarea:
 *   · el saldo del paciente NUNCA cambia (invoices/payments/patientCredit
 *     quedan intactos: el handler jamás los escribe);
 *   · reimportar el mismo archivo no duplica;
 *   · Caja no cambia (misma prueba que el saldo: Caja deriva de invoices/
 *     payments en vivo, y esas tablas no se tocan).
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
    user: [{ id: IMPORTA, clinicId: CLINICA, firstName: "Rafael", lastName: "Admin", isActive: true }],
    migratedLabExpense: [],
    invoice: [],
    payment: [],
    patientCredit: [],
  };
}

let base: Base = crearBase(semilla());
mock.module("@/lib/prisma", { namedExports: { prisma: new Proxy({}, { get: (_t, k: string) => base.prisma[k] }) } });
mock.module("@/lib/audit", { namedExports: { logAudit: async () => {} } });

const engine = () => import("../engine");
const manejador = () => import("../laboratorio-historial/handler");

function reiniciar() {
  base = crearBase(semilla());
}

const csv = (nombre: string, texto: string) => new File([texto], nombre, { type: "text/csv" });
const tabla = (m: string) => base.tablas[m] ?? [];
const fila = (res: any, n: number) => res.preview.find((r: any) => r.row === n);

async function correr(file: File, opts: { dryRun?: boolean; skipDuplicates?: boolean } = { dryRun: true }): Promise<any> {
  const { runImport } = await engine();
  const { labExpenseHandler } = await manejador();
  return runImport(labExpenseHandler, {
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

const CABECERA = "nombre,apellido,telefono,fecha,laboratorio,accion,costo,preciopaciente";

test("importa un gasto de laboratorio histórico: crea MigratedLabExpense y NO toca invoices/payments/patientCredit (saldo y Caja no cambian)", async () => {
  reiniciar();
  const texto = [CABECERA, "María,Hernández,5551234567,2024-01-15,Lab Dental Sur,Corona zirconia,1500,2500"].join("\n");

  const prev = await correr(csv("p1.csv", texto), { dryRun: true });
  assert.equal(prev.mappingError, undefined, JSON.stringify(prev));
  assert.deepEqual([prev.total, prev.validos, prev.invalidos, prev.duplicados], [1, 1, 0, 0]);

  const hecho = await correr(csv("p1.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 1);
  assert.equal(tabla("migratedLabExpense").length, 1);
  const g = tabla("migratedLabExpense")[0];
  assert.equal(g.patientId, "p1");
  assert.equal(g.cost, 1500);
  assert.equal(g.patientPrice, 2500);
  assert.equal(g.labName, "Lab Dental Sur");
  assert.equal(g.action, "Corona zirconia");
  assert.equal(g.origin, "otro sistema");

  // Lo que hace que el saldo y Caja no cambien: este handler nunca escribe ahí.
  assert.equal(tabla("invoice").length, 0, "no crea facturas");
  assert.equal(tabla("payment").length, 0, "no crea pagos de Caja");
  assert.equal(tabla("patientCredit").length, 0, "no crea saldo a favor");
});

test("reimportar el mismo archivo no duplica (misma llave paciente+fecha+costo+acción)", async () => {
  reiniciar();
  const texto = [CABECERA, "María,Hernández,5551234567,2024-01-15,Lab Dental Sur,Corona zirconia,1500,2500"].join("\n");
  await correr(csv("p1.csv", texto), { dryRun: false });
  assert.equal(tabla("migratedLabExpense").length, 1);

  const prev2 = await correr(csv("p1.csv", texto), { dryRun: true });
  assert.equal(fila(prev2, 2).status, "skipped");
  assert.match(fila(prev2, 2).warnings.join(" · "), /ya se importó antes/);

  const otraVez = await correr(csv("p1.csv", texto), { dryRun: false, skipDuplicates: false });
  assert.equal(otraVez.created, 0, "ni con «omitir duplicados» apagado se vuelve a crear: ya se importó");
  assert.equal(tabla("migratedLabExpense").length, 1, "sigue habiendo solo un gasto");
});

test("dos acciones de laboratorio del MISMO paciente, costos distintos: NO son duplicados entre sí", async () => {
  reiniciar();
  const texto = [
    CABECERA,
    "María,Hernández,5551234567,2024-01-15,Lab Dental Sur,Corona zirconia,1500,2500",
    "María,Hernández,5551234567,2024-02-10,Lab Dental Sur,Placa oclusal,800,1200",
  ].join("\n");
  const hecho = await correr(csv("p2.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 2);
  assert.equal(tabla("migratedLabExpense").length, 2);
});

test("teléfono compartido con otra persona: el nombre de la fila manda (no se le carga el gasto a la mamá)", async () => {
  reiniciar();
  const texto = [CABECERA, "Juanito,Hernández,5551234567,2024-01-15,Lab Dental Sur,Placa,300,500"].join("\n");
  const hecho = await correr(csv("p3.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 1);
  assert.equal(tabla("migratedLabExpense")[0].patientId, "p2", "el gasto quedó en Juanito, no en su mamá");
});

test("costo ambiguo sin evidencia en el archivo: se marca pendiente, no se adivina (igual que saldos)", async () => {
  reiniciar();
  const texto = [CABECERA, "María,Hernández,5551234567,2024-01-15,Lab Dental Sur,Corona,45.000,"].join("\n");
  const prev = await correr(csv("p4.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "error");
  assert.ok(prev.unresolved?.some((u: any) => u.field === "amountFormat"), "queda pendiente de confirmar el formato");
});

test("costo en cero o negativo: error, no se importa", async () => {
  reiniciar();
  const texto = [CABECERA, "María,Hernández,5551234567,2024-01-15,Lab Dental Sur,Corona,0,"].join("\n");
  const prev = await correr(csv("p5.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "error");
  assert.match(fila(prev, 2).errors.join(" · "), /mayor que cero/);
});

test("sin fecha: error (el historial necesita la fecha ORIGINAL de la acción)", async () => {
  reiniciar();
  const texto = ["nombre,apellido,telefono,fecha,laboratorio,accion,costo", "María,Hernández,5551234567,,Lab Dental Sur,Corona,1000"].join("\n");
  const prev = await correr(csv("p6.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "error");
  assert.match(fila(prev, 2).errors.join(" · "), /Falta la fecha/);
});

test("sin acción ni laboratorio: error (la fila no dice qué se le pidió al laboratorio)", async () => {
  reiniciar();
  const texto = ["nombre,apellido,telefono,fecha,costo", "María,Hernández,5551234567,2024-01-15,1000"].join("\n");
  const prev = await correr(csv("p7.csv", texto), { dryRun: true });
  assert.equal(prev.mappingError, "Falta una columna con la acción o el laboratorio");
});

test("precio al paciente ambiguo: se omite (informativo) sin bloquear la fila por el costo", async () => {
  reiniciar();
  // Dos costos con el mismo formato demostrado ("1.234,50" con coma decimal) para
  // que el costo SÍ resuelva; el precio al paciente queda con una sola muestra
  // ambigua y ninguna evidencia propia: se guarda null, no bloquea el costo.
  const texto = [
    "nombre,apellido,telefono,fecha,laboratorio,accion,costo,preciopaciente",
    'María,Hernández,5551234567,2024-01-15,Lab Dental Sur,Corona,"1.234,50","45.000"',
    'María,Hernández,5551234567,2024-02-10,Lab Dental Sur,Placa,"2.234,50",',
  ].join("\n");
  const prev = await correr(csv("p8.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "ok", JSON.stringify(fila(prev, 2)));
  assert.equal(fila(prev, 2).data.patientPrice, null, "precio ambiguo sin evidencia propia: se omite, no bloquea");
});
