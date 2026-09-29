/**
 * ws1-t8 — TRATAMIENTOS NO ORTODONCIA de Dentalink (06_Presupuestos_Detalle) con los datos completos del renglón:
 * descuento visible (Precio Original − Precio Paciente), pagado por prestación, categoría y código en el renglón,
 * especialidad y convenio en las notas del tratamiento, y catálogo creado (idempotente). Se conduce el motor DE VERDAD
 * (runImport + treatmentPlansHandler) con el perfil «dentalink» y Prisma sustituido por el doble en memoria.
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/import/__tests__/dentalink-tratamientos-completos.test.ts
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
      { id: "p1", clinicId: CLINICA, patientNumber: "P-0001", firstName: "María", lastName: "Hernández", phone: "5551234567", email: null, dob: null, deletedAt: null, visibleUserIds: [], updatedAt: new Date("2026-09-01T10:00:00.000Z") },
    ],
    user: [
      { id: IMPORTA, clinicId: CLINICA, firstName: "Rafael", lastName: "Admin", isActive: true },
      { id: "u_ana", clinicId: CLINICA, firstName: "Ana", lastName: "López", isActive: true },
    ],
    procedureCatalog: [{ id: "pc_prof", clinicId: CLINICA, name: "Limpieza dental profilaxis", code: null, category: "dental", basePrice: 650, isActive: true }],
    quote: [], quoteItem: [], treatmentPlan: [], treatmentSession: [], invoice: [], payment: [], migratedPayment: [], importExternalIds: [],
  };
}

let base: Base = crearBase(semilla());
mock.module("@/lib/prisma", { namedExports: { prisma: new Proxy({}, { get: (_t, k: string) => base.prisma[k] }) } });
mock.module("@/lib/audit", { namedExports: { logAudit: async () => {} } });
mock.module("@/lib/patient-quota", { namedExports: { getPatientQuota: async () => ({ unlimited: true, used: 0, max: null, remaining: null }) } });
mock.module("@/lib/invoices/next-invoice-number", { namedExports: { lastInvoiceFolio: async () => 500 } });

const reiniciar = () => { base = crearBase(semilla()); };
const csv = (texto: string) => new File([texto], "06_Presupuestos_Detalle.csv", { type: "text/csv" });
const tabla = (m: string) => base.tablas[m] ?? [];

async function correr(file: File, dryRun: boolean): Promise<any> {
  const { runImport } = await import("../engine");
  const { HANDLERS } = await import("../entities");
  return runImport(HANDLERS.treatmentPlans, { file, clinicId: CLINICA, userId: IMPORTA, role: "ADMIN", dryRun, skipDuplicates: true, columnMapping: null, origin: "dentalink", valueMapping: null, sheet: null });
}

const CAB = "# Tratamiento,Convenio Tratamiento,Fecha de generación del tratamiento,Código Prestación,Nombre Prestación,Nombre Categoría,Fecha Realización,Precio Original,Precio Paciente,Pagado Prestación,Especialidad Profesional Tratamiento,Nombre Profesional Tratamiento,# Paciente,Nombre Paciente,Apellidos Paciente,Celular,Total Pagos Tratamiento,Estado Tratamiento";
const fila = (o: { trat?: string; cod?: string; prest: string; cat: string; orig: number; pac: number; pagado: number; total: number; hecha?: string; conv?: string }) =>
  `${o.trat ?? "9001"},${o.conv ?? "Convenio Empresa"},2026-05-12 10:30:00,${o.cod ?? ""},${o.prest},${o.cat},${o.hecha ?? ""},${o.orig},${o.pac},${o.pagado},Odontología General,Ana López,1042,María,Hernández,5551234567,${o.total},Tratamiento Activo`;

const TEXTO = [
  CAB,
  fila({ cod: "OPE-01", prest: "Resina estética", cat: "Operatoria", orig: 1000, pac: 800, pagado: 500, total: 500, hecha: "2026-05-20" }),
  fila({ prest: "Limpieza dental profilaxis", cat: "Prevención", orig: 700, pac: 700, pagado: 0, total: 500 }),
].join("\n");

test("renglón completo: descuento visible, pagado y categoría/código en el renglón; el total sigue siendo Precio Paciente", async () => {
  reiniciar();
  const prev = await correr(csv(TEXTO), true);
  assert.equal(prev.mappingError, undefined, JSON.stringify(prev));
  assert.deepEqual([prev.total, prev.validos, prev.invalidos], [2, 2, 0]);

  const hecho = await correr(csv(TEXTO), false);
  assert.equal(hecho.created, 1);

  const q = tabla("quote")[0];
  assert.equal(q.total, 1500, "800 + 700: precio del paciente, como siempre");
  assert.equal(q.subtotal, 1500);
  const items = tabla("quoteItem").sort((a, b) => a.sortOrder - b.sortOrder);
  const resina = items.find((i) => i.name === "Resina estética")!;
  assert.deepEqual([resina.unitPrice, resina.discount, resina.lineTotal], [1000, 200, 800]);
  assert.match(resina.notes, /Categoría: Operatoria/);
  assert.match(resina.notes, /Código: OPE-01/);
  assert.match(resina.notes, /Pagado en el sistema anterior: \$500\.00/);
  const limpieza = items.find((i) => i.name === "Limpieza dental profilaxis")!;
  assert.deepEqual([limpieza.unitPrice, limpieza.discount, limpieza.lineTotal], [700, 0, 700]);
  assert.equal(limpieza.procedureId, "pc_prof", "ya estaba en el catálogo: se liga, no se crea");
  assert.ok(!/Pagado en el sistema anterior/.test(limpieza.notes), "pagado 0 no ensucia la nota");

  // El abonado del tratamiento es «Total Pagos Tratamiento», no la suma por renglón.
  const inv = tabla("invoice")[0];
  assert.equal(inv.paid, 500);
  assert.equal(inv.balance, 1000);
  assert.equal(inv.status, "PARTIAL");
  assert.equal(inv.items[0].discount, 200, "el descuento viaja a la factura");
  assert.equal(inv.total, 1500);

  // Especialidad y convenio en las notas del tratamiento.
  assert.match(q.notes, /\nEspecialidad del profesional: Odontología General/);
  assert.match(q.notes, /\nConvenio del tratamiento: Convenio Empresa/);
});

test("catálogo: crea solo lo que falta (nombre, código, categoría, precio de lista) y repetir no duplica", async () => {
  reiniciar();
  await correr(csv(TEXTO), false);
  const nuevas = tabla("procedureCatalog").filter((p) => p.id !== "pc_prof");
  assert.equal(nuevas.length, 1);
  assert.deepEqual([nuevas[0].name, nuevas[0].code, nuevas[0].category, nuevas[0].basePrice, nuevas[0].clinicId], ["Resina estética", "DL-OPE-01", "Operatoria", 1000, CLINICA]);
  const q = tabla("quoteItem").find((i) => i.name === "Resina estética")!;
  assert.equal(q.procedureId, nuevas[0].id, "el renglón queda ligado al procedimiento creado");

  // Mismo archivo otra vez: el tratamiento ya está migrado y el catálogo no crece.
  const otra = await correr(csv(TEXTO), false);
  assert.equal(otra.created, 0);
  assert.equal(tabla("procedureCatalog").length, 2);

  // Otro tratamiento con la misma prestación: se liga a la ya creada, sin duplicar.
  const t2 = [CAB, fila({ trat: "9002", cod: "OPE-01", prest: "Resina estética", cat: "Operatoria", orig: 1000, pac: 1000, pagado: 0, total: 0 })].join("\n");
  const r2 = await correr(csv(t2), false);
  assert.equal(r2.created, 1);
  assert.equal(tabla("procedureCatalog").length, 2);
  assert.equal(tabla("quoteItem").filter((i) => i.procedureId === nuevas[0].id).length, 2);
});

test("vista previa: no crea nada en el catálogo y avisa de lo que se agregará", async () => {
  reiniciar();
  const prev = await correr(csv(TEXTO), true);
  assert.equal(tabla("procedureCatalog").length, 1);
  const r = prev.preview.find((x: any) => x.data.procedure === "Resina estética");
  assert.ok(r.warnings.some((w: string) => /se agregará al catálogo/.test(w)), JSON.stringify(r.warnings));
  assert.equal(r.unresolved, undefined, "no pide elegir equivalente");
});

test("si lo pagado por prestación no cuadra con el total, manda el total y avisa", async () => {
  reiniciar();
  const t = [
    CAB,
    fila({ prest: "Resina estética", cat: "Operatoria", orig: 1000, pac: 1000, pagado: 900, total: 500 }),
    fila({ prest: "Limpieza dental profilaxis", cat: "Prevención", orig: 700, pac: 700, pagado: 0, total: 500 }),
  ].join("\n");
  const prev = await correr(csv(t), true);
  assert.ok(prev.preview.some((r: any) => r.warnings.some((w: string) => /supera el total abonado.*manda el total/.test(w))), "avisa");
  await correr(csv(t), false);
  assert.equal(tabla("invoice")[0].paid, 500, "manda Total Pagos Tratamiento");
});

test("precio de lista menor que el del paciente: gana el del paciente, sin descuento, con aviso", async () => {
  reiniciar();
  const t = [CAB, fila({ prest: "Resina estética", cat: "Operatoria", orig: 500, pac: 600, pagado: 0, total: 0 })].join("\n");
  const prev = await correr(csv(t), true);
  assert.ok(prev.preview[0].warnings.some((w: string) => /menor que el que paga el paciente/.test(w)));
  await correr(csv(t), false);
  const it = tabla("quoteItem")[0];
  assert.deepEqual([it.unitPrice, it.discount, it.lineTotal], [600, 0, 600]);
});

test("sin columnas de Dentalink el comportamiento de siempre: sin catálogo nuevo y sin descuento inventado", async () => {
  reiniciar();
  const t = ["nombre,apellido,telefono,folio,fecha,procedimiento,precio", "María,Hernández,5551234567,7001,2024-02-05,Resina simple,850"].join("\n");
  const { runImport } = await import("../engine");
  const { HANDLERS } = await import("../entities");
  const r: any = await runImport(HANDLERS.treatmentPlans, { file: csv(t), clinicId: CLINICA, userId: IMPORTA, role: "ADMIN", dryRun: false, skipDuplicates: true, columnMapping: null, origin: null, valueMapping: null, sheet: null });
  assert.equal(r.created, 1);
  assert.equal(tabla("procedureCatalog").length, 1);
  assert.deepEqual([tabla("quoteItem")[0].unitPrice, tabla("quoteItem")[0].discount], [850, 0]);
});
