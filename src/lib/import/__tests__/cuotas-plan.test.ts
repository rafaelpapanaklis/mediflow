/**
 * ws1-t6 — MENSUALIDADES / CUOTAS POR VENCER MIGRADAS (installmentPlansHandler,
 * archivo nuevo src/lib/import/cuotas-plan/handler.ts — NO vive en entities.ts
 * porque ws1-t12 puede estar cambiando ese archivo en paralelo).
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/import/__tests__/cuotas-plan.test.ts
 *
 * Se conduce el motor DE VERDAD (runImport + installmentPlansHandler) con Prisma
 * sustituido por el doble en memoria (doble-prisma.ts).
 *
 * Lo que prueban estos tests, en el orden que pide la tarea:
 *   · la cuota se ancla a la factura de "Saldo inicial migrado" (o al caso de
 *     ortodoncia migrado si el paciente tiene uno) SIN escribir en ella —
 *     invoices/payments/patientCredit quedan intactos;
 *   · reimportar el mismo archivo no duplica;
 *   · si la suma de cuotas no cuadra con el ancla, se avisa (no bloquea);
 *   · resolución de paciente STRICT (es dinero).
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { crearBase, type Base } from "./doble-prisma";

const CLINICA = "cli_A";
const IMPORTA = "u_admin";
const OPENING_BALANCE_NOTE = "Saldo inicial migrado";

function semilla() {
  return {
    clinic: [{ id: CLINICA, name: "Clínica Sonrisa", timezone: "America/Mexico_City" }],
    patient: [
      { id: "p1", clinicId: CLINICA, patientNumber: "P-0001", firstName: "María", lastName: "Hernández", phone: "5551234567", email: null, deletedAt: null, visibleUserIds: [] },
      // Comparte celular con "María" (la mamá que registró su número para los hijos).
      { id: "p2", clinicId: CLINICA, patientNumber: "P-0002", firstName: "Juanito", lastName: "Hernández", phone: "5551234567", email: null, deletedAt: null, visibleUserIds: [] },
      { id: "p3", clinicId: CLINICA, patientNumber: "P-0003", firstName: "Sofía", lastName: "Ortiz", phone: "5559876543", email: null, deletedAt: null, visibleUserIds: [] },
    ],
    user: [{ id: IMPORTA, clinicId: CLINICA, firstName: "Rafael", lastName: "Admin", isActive: true }],
    invoice: [
      { id: "inv_p1", clinicId: CLINICA, patientId: "p1", invoiceNumber: "F-0001", items: [], subtotal: 6000, discount: 0, total: 6000, paid: 0, balance: 6000, status: "PENDING", notes: OPENING_BALANCE_NOTE, taxRate: 16, taxIncluded: true },
    ],
    migratedOrthoCase: [
      { id: "oc_p3", clinicId: CLINICA, patientId: "p3", technique: "Brackets metálicos", status: "ACTIVE", totalAmount: 3000, origin: "Dentalink", createdById: IMPORTA },
    ],
    migratedInstallment: [],
    payment: [],
    patientCredit: [],
  };
}

let base: Base = crearBase(semilla());
mock.module("@/lib/prisma", { namedExports: { prisma: new Proxy({}, { get: (_t, k: string) => base.prisma[k] }) } });
mock.module("@/lib/audit", { namedExports: { logAudit: async () => {} } });

const engine = () => import("../engine");
const manejador = () => import("../cuotas-plan/handler");

function reiniciar() {
  base = crearBase(semilla());
}

const csv = (nombre: string, texto: string) => new File([texto], nombre, { type: "text/csv" });
const tabla = (m: string) => base.tablas[m] ?? [];
const fila = (res: any, n: number) => res.preview.find((r: any) => r.row === n);

async function correr(file: File, opts: { dryRun?: boolean; skipDuplicates?: boolean } = { dryRun: true }): Promise<any> {
  const { runImport } = await engine();
  const { installmentPlansHandler } = await manejador();
  return runImport(installmentPlansHandler, {
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

const CABECERA = "nombre,apellido,telefono,folio,ncuota,montocuota,fechavencimiento";

test("importa una cuota: se ancla a la factura de saldo inicial y NO la modifica (saldo intacto)", async () => {
  reiniciar();
  const texto = [CABECERA, "María,Hernández,5551234567,TX-1,1,1500,2026-11-01"].join("\n");

  const prev = await correr(csv("p1.csv", texto), { dryRun: true });
  assert.equal(prev.mappingError, undefined, JSON.stringify(prev));
  assert.deepEqual([prev.total, prev.validos, prev.invalidos, prev.duplicados], [1, 1, 0, 0]);

  const hecho = await correr(csv("p1.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 1);
  assert.equal(tabla("migratedInstallment").length, 1);
  const c = tabla("migratedInstallment")[0];
  assert.equal(c.patientId, "p1");
  assert.equal(c.amount, 1500);
  assert.equal(c.invoiceId, "inv_p1");
  assert.equal(c.migratedOrthoCaseId, null);
  assert.equal(c.installmentNumber, 1);

  // Lo que hace que el saldo no cambie: este handler nunca escribe en invoices.
  const inv = tabla("invoice").find((i: any) => i.id === "inv_p1");
  assert.equal(inv.balance, 6000, "el saldo de la factura no cambia");
  assert.equal(inv.paid, 0);
  assert.equal(tabla("payment").length, 0, "no crea pagos de Caja");
  assert.equal(tabla("patientCredit").length, 0, "no crea saldo a favor");
});

test("paciente con caso de ortodoncia migrado: la cuota se ancla al CASO, no a una factura", async () => {
  reiniciar();
  const texto = [CABECERA, "Sofía,Ortiz,5559876543,ORTO-1,1,1000,2026-11-01"].join("\n");
  const hecho = await correr(csv("p3.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 1);
  const c = tabla("migratedInstallment")[0];
  assert.equal(c.migratedOrthoCaseId, "oc_p3");
  assert.equal(c.invoiceId, null);
});

test("sin factura de saldo ni caso de ortodoncia: se guarda sin ancla, con aviso", async () => {
  reiniciar();
  // p2 (Juanito) no tiene factura de apertura ni caso migrado.
  const texto = [CABECERA, "Juanito,Hernández,5551234567,,1,500,2026-11-01"].join("\n");
  const prev = await correr(csv("p2.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "ok");
  assert.match(fila(prev, 2).warnings.join(" · "), /sin ligar a una deuda/);
});

test("reimportar el mismo archivo no duplica (misma llave paciente+vencimiento+monto+folio)", async () => {
  reiniciar();
  const texto = [CABECERA, "María,Hernández,5551234567,TX-1,1,1500,2026-11-01"].join("\n");
  await correr(csv("p1.csv", texto), { dryRun: false });
  assert.equal(tabla("migratedInstallment").length, 1);

  const prev2 = await correr(csv("p1.csv", texto), { dryRun: true });
  assert.equal(fila(prev2, 2).status, "skipped");
  assert.match(fila(prev2, 2).warnings.join(" · "), /ya se importó antes/);

  const otraVez = await correr(csv("p1.csv", texto), { dryRun: false, skipDuplicates: false });
  assert.equal(otraVez.created, 0, "ni con «omitir duplicados» apagado se vuelve a crear: ya se importó");
  assert.equal(tabla("migratedInstallment").length, 1);
});

test("dos cuotas del MISMO paciente, montos y vencimientos distintos: NO son duplicados entre sí", async () => {
  reiniciar();
  const texto = [
    CABECERA,
    "María,Hernández,5551234567,TX-1,1,1500,2026-11-01",
    "María,Hernández,5551234567,TX-1,2,1500,2026-12-01",
  ].join("\n");
  const hecho = await correr(csv("p1b.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 2);
  assert.equal(tabla("migratedInstallment").length, 2);
});

test("N° de cuota ausente: se asigna por orden de vencimiento dentro del mismo folio", async () => {
  reiniciar();
  const texto = [
    "nombre,apellido,telefono,folio,montocuota,fechavencimiento",
    "María,Hernández,5551234567,TX-1,1500,2026-12-01",
    "María,Hernández,5551234567,TX-1,1500,2026-11-01",
  ].join("\n");
  const hecho = await correr(csv("p1c.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 2);
  const cuotas = tabla("migratedInstallment").sort((a: any, b: any) => a.dueDate.getTime() - b.dueDate.getTime());
  assert.equal(cuotas[0].installmentNumber, 1, "la de noviembre (más próxima) es la cuota 1");
  assert.equal(cuotas[1].installmentNumber, 2);
});

test("la suma de cuotas NO cuadra con el saldo de la factura ligada: aviso, no error", async () => {
  reiniciar();
  // La factura de p1 tiene total 6000; aquí solo se cargan 1000 en cuotas.
  const texto = [CABECERA, "María,Hernández,5551234567,TX-1,1,1000,2026-11-01"].join("\n");
  const prev = await correr(csv("p1d.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "ok");
  assert.match(fila(prev, 2).warnings.join(" · "), /no coincide con el saldo/);
});

test("teléfono compartido con otra persona: el nombre de la fila manda (no se le carga la cuota a la mamá)", async () => {
  reiniciar();
  const texto = [CABECERA, "Juanito,Hernández,5551234567,,1,300,2026-11-01"].join("\n");
  const hecho = await correr(csv("p2b.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 1);
  assert.equal(tabla("migratedInstallment")[0].patientId, "p2", "la cuota quedó en Juanito, no en su mamá");
});

test("monto ambiguo sin evidencia en el archivo: se marca pendiente, no se adivina", async () => {
  reiniciar();
  const texto = [CABECERA, "María,Hernández,5551234567,TX-1,1,45.000,2026-11-01"].join("\n");
  const prev = await correr(csv("p1e.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "error");
  assert.ok(prev.unresolved?.some((u: any) => u.field === "amountFormat"));
});

test("sin fecha de vencimiento: error", async () => {
  reiniciar();
  const texto = ["nombre,apellido,telefono,folio,ncuota,montocuota,fechavencimiento", "María,Hernández,5551234567,TX-1,1,1500,"].join("\n");
  const prev = await correr(csv("p1f.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "error");
  assert.match(fila(prev, 2).errors.join(" · "), /Falta la fecha de vencimiento/);
});

test("cuota en cero: error, no se importa", async () => {
  reiniciar();
  const texto = [CABECERA, "María,Hernández,5551234567,TX-1,1,0,2026-11-01"].join("\n");
  const prev = await correr(csv("p1g.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "error");
  assert.match(fila(prev, 2).errors.join(" · "), /mayor que cero/);
});
