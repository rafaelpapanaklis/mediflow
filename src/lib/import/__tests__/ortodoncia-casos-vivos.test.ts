/**
 * ws1-t12 — TRATAMIENTOS DE ORTODONCIA DE DENTALINK → CASOS VIVOS del módulo.
 *
 * Lo que se prueba (con datos inventados, ninguno de un paciente real):
 *  · tipo de renglón (control / colocación / tratamiento / extra) y técnica deducida de las prestaciones;
 *  · estado (Planeado / En tratamiento / En retención / Terminado), modo de cobro POR CASO y controles hechos;
 *  · pagos: por renglón, el resto de más viejo a más nuevo, y nunca un pago sin cargo;
 *  · el motor de verdad (runImport + treatmentPlansHandler) con el doble de Prisma: el caso, sus 6 fases, sus hojas,
 *    sus facturas y sus pagos MIGRADOS (nunca `payments`), sin duplicar al reimportar, y el camino de siempre cuando
 *    el módulo no está activo o el origen no es Dentalink.
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/import/__tests__/ortodoncia-casos-vivos.test.ts
 *      (y otra vez con TZ=Asia/Tokyo: nada debe depender de la zona del servidor)
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { crearBase, type Base } from "./doble-prisma";

const CLINICA = "cli_A";
const DUENO = "u_dueno";

function semilla() {
  return {
    clinic: [{ id: CLINICA, name: "Clínica de prueba", timezone: "America/Mexico_City" }],
    user: [{ id: DUENO, clinicId: CLINICA, firstName: "Ana", lastName: "Dueña", role: "SUPER_ADMIN", isActive: true }],
    patient: [
      { id: "p1", clinicId: CLINICA, patientNumber: "P-0001", firstName: "Lucía", lastName: "Prueba Uno", phone: "5551230001", email: null, dob: null, deletedAt: null, visibleUserIds: [] },
      { id: "p2", clinicId: CLINICA, patientNumber: "P-0002", firstName: "Mario", lastName: "Prueba Dos", phone: "5551230002", email: null, dob: null, deletedAt: null, visibleUserIds: [] },
    ],
    appointment: [], importExternalIds: [], procedureCatalog: [],
    quote: [], quoteItem: [], treatmentPlan: [], treatmentSession: [], invoice: [], payment: [], migratedPayment: [],
    orthodonticDiagnosis: [], orthodonticTreatmentPlan: [], orthodonticPhase: [], orthoTreatmentCard: [],
  };
}
let base: Base = crearBase(semilla());
let moduloActivo = true;
const modosGuardados: Array<{ planId: string; modo: string }> = [];
const nombresGuardados: Array<{ planId: string; nombre: string }> = [];
mock.module("@/lib/prisma", { namedExports: { prisma: new Proxy({}, { get: (_t, k: string) => base.prisma[k] }) } });
mock.module("@/lib/audit", { namedExports: { logAudit: async () => {} } });
mock.module("@/lib/patient-quota", { namedExports: { getPatientQuota: async () => ({ unlimited: true, used: 0, max: null, remaining: null }) } });
mock.module("@/lib/invoices/next-invoice-number", { namedExports: { lastInvoiceFolio: async () => 500 } });
mock.module("@/lib/orthodontics/access", { namedExports: { hasActiveOrthodonticsModule: async () => moduloActivo } });
// Los pasos tolerantes (SQL crudo con sonda de columna) se sustituyen: aquí se prueba QUÉ se les pide.
mock.module("@/lib/orthodontics/billing-mode-db", {
  namedExports: { guardarModoDeCobroDelCaso: async (_c: string, planId: string, modo: string) => { modosGuardados.push({ planId, modo }); } },
});
mock.module("@/lib/orthodontics/tecnicas-de-la-clinica-db", {
  namedExports: {
    leerTecnicasDeLaClinica: async () => ({ tecnicas: [], columnaLista: false, editada: false }),
    guardarNombreDeTecnicaDelCaso: async (_c: string, planId: string, nombre: string) => { nombresGuardados.push({ planId, nombre }); return true; },
  },
});
mock.module("@/lib/orthodontics/cobro/extras-db", { namedExports: { existeColumnaDeFacturasDelCaso: async () => false } });

const engine = () => import("../engine");
const entidades = () => import("../entities");
const caso = () => import("../dentalink/ortodoncia-caso");
const casoDb = () => import("../dentalink/ortodoncia-caso-db");

const dia = (s: string) => new Date(`${s}T12:00:00.000Z`);

// ───────────────────────── Parte pura ─────────────────────────

test("tipo de renglón: control, colocación, tratamiento completo y extra", async () => {
  const { tipoDeRenglon } = await caso();
  const t = (p: string, c = "Ortodoncia") => tipoDeRenglon(p, c);
  assert.equal(t("Ajuste control mensual de ortodoncia"), "control");
  assert.equal(t("control mensual nueva italia"), "control");
  assert.equal(t("Control mensual contención"), "control");
  assert.equal(t("CONTROL Y ACTIVACION DAMON"), "control");
  assert.equal(t("Colocación de brackets Metálicos promocional"), "colocacion");
  assert.equal(t("Brackets metálicos Pago inicial"), "colocacion");
  assert.equal(t("brackets Autoligado damon inicial"), "colocacion");
  assert.equal(t("Alineadores invisibles tratamiento completo"), "tratamiento");
  assert.equal(t("alineadores spark"), "tratamiento");
  assert.equal(t("TADS marca TD"), "extra");
  assert.equal(t("bracket despegado"), "extra", "una reposición no es la colocación");
  assert.equal(t("Kit Ortodoncia basic"), "extra");
  assert.equal(t("Retenedores fijos o removibles"), "extra");
  assert.equal(t("Resina estética chica, mediana, grande", "Operatoria"), "extra", "trabajo dental dentro del presupuesto");
  assert.equal(t("Extracción dental simple", "Cirugía"), "extra");
});

test("técnica: se deduce de las prestaciones; sin pista, metálicos con el texto de la colocación", async () => {
  const { deducirTecnica } = await caso();
  const r = (procedure: string) => ({ procedure, categoria: "Ortodoncia" });
  assert.equal(deducirTecnica([r("Colocación de brackets Metálicos promocional"), r("Ajuste control mensual de ortodoncia")]).technique, "METAL_BRACKETS");
  assert.equal(deducirTecnica([r("Control mensual ortodoncia tradicional")]).technique, "METAL_BRACKETS");
  assert.equal(deducirTecnica([r("Alineadores invisibles tratamiento completo")]).technique, "CLEAR_ALIGNERS");
  assert.equal(deducirTecnica([r("alineadores spark")]).technique, "CLEAR_ALIGNERS");
  assert.equal(deducirTecnica([r("brackets Autoligado damon inicial"), r("CONTROL Y ACTIVACION DAMON")]).technique, "SELF_LIGATING_METAL");
  assert.equal(deducirTecnica([r("Brackets estéticos cerámicos")]).technique, "CERAMIC_BRACKETS");
  assert.equal(deducirTecnica([r("Brackets linguales")]).technique, "LINGUAL_BRACKETS");
  assert.equal(deducirTecnica([r("Alineadores invisibles tratamiento completo"), r("Brackets metálicos Pago inicial")]).technique, "HYBRID");

  const nuevaItalia = deducirTecnica([r("control mensual nueva italia"), r("Ajuste mensual nueva Italia")]);
  assert.equal(nuevaItalia.technique, "METAL_BRACKETS", "«nueva italia» es una tarifa, no una técnica");
  assert.equal(nuevaItalia.deducida, false);

  const sinPista = deducirTecnica([{ procedure: "Consulta de valoración", categoria: "Ortodoncia" }, { procedure: "Colocación de ortodoncia", categoria: "Ortodoncia" }]);
  assert.equal(sinPista.technique, "METAL_BRACKETS");
  assert.equal(sinPista.deducida, false);
  assert.equal(sinPista.label, "Colocación de ortodoncia");

  const propia = deducirTecnica([r("Ortodoncia Sonrisa Plus mensual")], [{ id: "t-abc123", nombre: "Sonrisa Plus", base: "CERAMIC_BRACKETS", activa: true }]);
  assert.deepEqual([propia.technique, propia.label], ["CERAMIC_BRACKETS", "Sonrisa Plus"], "la técnica propia de la clínica manda");
});

interface R { row: number; procedure: string; categoria: string; lineTotal: number; hecho?: boolean; fecha?: string; pag?: number | null }
const reng = (x: R) => ({
  row: x.row, procedure: x.procedure, categoria: x.categoria, lineTotal: x.lineTotal, quantity: 1, unitPrice: x.lineTotal, discount: 0,
  hecho: x.hecho ?? false, fechaRealizado: x.fecha ? dia(x.fecha) : null, abonadoLinea: x.pag === undefined ? null : x.pag, itemNotes: null,
});
const entrada = (renglones: R[], extra: Record<string, unknown> = {}) => ({
  folio: "77", patientId: "p1", doctorId: DUENO, doctorName: "Doctora Prueba",
  renglones: renglones.map(reng), estadoTratamiento: "activo" as const, abonadoTratamiento: null, generado: dia("2026-01-05"), ...extra,
});
const O = "Ortodoncia";

test("por control: los controles HECHOS son hojas con su precio y su pago; los no hechos no se inventan", async () => {
  const { armarCaso } = await caso();
  const p = armarCaso(entrada([
    { row: 2, procedure: "Colocación de brackets Metálicos promocional", categoria: O, lineTotal: 3000, hecho: true, fecha: "2026-01-10", pag: 3000 },
    { row: 3, procedure: "Ajuste control mensual de ortodoncia", categoria: O, lineTotal: 600, hecho: true, fecha: "2026-02-10", pag: 600 },
    { row: 4, procedure: "Ajuste control mensual de ortodoncia", categoria: O, lineTotal: 600, hecho: true, fecha: "2026-03-10", pag: 0 },
    { row: 5, procedure: "Ajuste control mensual de ortodoncia", categoria: O, lineTotal: 600 },
    { row: 6, procedure: "Ajuste control mensual de ortodoncia", categoria: O, lineTotal: 600 },
    { row: 7, procedure: "TADS marca TD", categoria: O, lineTotal: 2800, hecho: true, fecha: "2026-02-20", pag: 2800 },
  ]));
  assert.equal(p.billingMode, "PAGO_POR_CONTROL");
  assert.equal(p.status, "IN_PROGRESS");
  assert.equal(p.technique, "METAL_BRACKETS");
  assert.equal(p.installedAt!.toISOString().slice(0, 10), "2026-01-10", "la colocación hecha");
  assert.equal(p.controles.length, 2, "solo los dos hechos");
  assert.deepEqual(p.controles.map((c) => c.cardNumber), [1, 2]);
  assert.deepEqual(p.controles.map((c) => c.cargo!.status), ["PAID", "PENDING"]);
  assert.equal(p.principal!.total, 3000);
  assert.equal(p.principal!.status, "PAID");
  assert.equal(p.extras!.total, 2800, "TADs = cargo aparte del caso");
  assert.equal(p.extras!.status, "PAID");
  assert.equal(p.totalCostMxn, 0, "en «Pago por control» el costo total es solo referencia");
  assert.equal(p.estimatedDurationMonths, 4, "un mes por control del presupuesto");
  assert.deepEqual(
    [p.cifras.controlesDelPresupuesto, p.cifras.controlesHechos, p.cifras.controlesSinHacer, p.cifras.importeControlesSinHacer, p.cifras.controlesHechosPagados, p.cifras.controlesHechosPendientes],
    [4, 2, 2, 1200, 1, 1],
  );
  assert.equal(p.cifras.cobrado, 3000 + 600 + 2800);
  assert.equal(p.cifras.pendiente, 600);
  assert.ok(p.controles[1].monthAt >= 1.9 && p.controles[1].monthAt <= 2.1, "dos meses después de colocar");
});

test("un solo cargo de alineadores sin controles → «Precio total»: el cargo es el total, sin calendario", async () => {
  const { armarCaso } = await caso();
  const p = armarCaso(entrada([{ row: 2, procedure: "Alineadores invisibles tratamiento completo", categoria: O, lineTotal: 45000, pag: 0 }], { abonadoTratamiento: 0 }));
  assert.equal(p.billingMode, "PRECIO_TOTAL");
  assert.equal(p.technique, "CLEAR_ALIGNERS");
  assert.equal(p.totalCostMxn, 45000);
  assert.equal(p.principal!.status, "PENDING");
  assert.equal(p.controles.length, 0);
  assert.equal(p.status, "PLANNED", "activo pero sin nada hecho ni pagado: todavía no se coloca");
  assert.equal(p.installedAt, null);

  const conPago = armarCaso(entrada([{ row: 2, procedure: "Colocación de ortodoncia Metálicos promocional 5000", categoria: O, lineTotal: 5000, pag: 2500 }], { abonadoTratamiento: 2500 }));
  assert.equal(conPago.billingMode, "PRECIO_TOTAL");
  assert.equal(conPago.status, "IN_PROGRESS", "con un pago ya empezó");
  assert.equal(conPago.principal!.pagado, 2500);
  assert.equal(conPago.principal!.status, "PARTIAL");
  assert.equal(conPago.installedAt!.toISOString().slice(0, 10), "2026-01-05", "sin fecha de realización, la generación");
  assert.match(conPago.avisos.join(" "), /Fecha Realización/);
});

test("el modo se decide POR CASO: controles con precio → por control; controles sin precio → precio total", async () => {
  const { armarCaso } = await caso();
  const conPrecio = armarCaso(entrada([
    { row: 2, procedure: "Colocación de brackets Metálicos", categoria: O, lineTotal: 3000, hecho: true, fecha: "2026-01-10" },
    { row: 3, procedure: "Control mensual ortodoncia tradicional", categoria: O, lineTotal: 500 },
  ]));
  const sinPrecio = armarCaso(entrada([
    { row: 2, procedure: "Colocación de brackets Metálicos", categoria: O, lineTotal: 30000, hecho: true, fecha: "2026-01-10" },
    { row: 3, procedure: "Control mensual ortodoncia tradicional", categoria: O, lineTotal: 0, hecho: true, fecha: "2026-02-10" },
  ]));
  assert.equal(conPrecio.billingMode, "PAGO_POR_CONTROL");
  assert.equal(sinPrecio.billingMode, "PRECIO_TOTAL");
  assert.equal(sinPrecio.controles.length, 1, "la visita queda registrada");
  assert.equal(sinPrecio.controles[0].cargo, null, "sin cargo: el control iba incluido");
});

test("estado: retención si su último control hecho es de contención; finalizado = terminado", async () => {
  const { armarCaso } = await caso();
  const lineas: R[] = [
    { row: 2, procedure: "Colocación de brackets Metálicos", categoria: O, lineTotal: 3000, hecho: true, fecha: "2026-01-10", pag: 3000 },
    { row: 3, procedure: "Ajuste control mensual de ortodoncia", categoria: O, lineTotal: 600, hecho: true, fecha: "2026-02-10", pag: 600 },
    { row: 4, procedure: "Control mensual contención", categoria: O, lineTotal: 600, hecho: true, fecha: "2026-03-10", pag: 600 },
  ];
  const ret = armarCaso(entrada(lineas));
  assert.equal(ret.status, "RETENTION");
  assert.deepEqual(ret.controles.map((c) => c.phaseKey), ["ALIGNMENT", "RETENTION"]);
  const fin = armarCaso(entrada(lineas, { estadoTratamiento: "finalizado" }));
  assert.equal(fin.status, "COMPLETED");
  assert.equal(fin.ultimaActividad.toISOString().slice(0, 10), "2026-03-10");
  const sinEstado = armarCaso(entrada(lineas, { estadoTratamiento: null }));
  assert.match(sinEstado.avisos.join(" "), /activo o finalizado/);
});

test("pagos: lo asignado a cada renglón manda; el resto va del cargo más viejo al más nuevo y nunca sobra sin avisar", async () => {
  const { armarCaso } = await caso();
  const lineas: R[] = [
    { row: 2, procedure: "Colocación de brackets Metálicos", categoria: O, lineTotal: 3000, hecho: true, fecha: "2026-01-10", pag: 1000 },
    { row: 3, procedure: "Ajuste control mensual de ortodoncia", categoria: O, lineTotal: 600, hecho: true, fecha: "2026-02-10", pag: 0 },
    { row: 4, procedure: "Ajuste control mensual de ortodoncia", categoria: O, lineTotal: 600, hecho: true, fecha: "2026-03-10", pag: 0 },
  ];
  // Total Pagos = 3100: 1000 asignados + 2100 sin renglón → 2000 completan la colocación, 100 van al primer control.
  const p = armarCaso(entrada(lineas, { abonadoTratamiento: 3100 }));
  assert.equal(p.principal!.pagado, 3000);
  assert.equal(p.controles[0].cargo!.pagado, 100);
  assert.equal(p.controles[1].cargo!.pagado, 0);
  assert.equal(p.pagoSinCargo, 0);
  assert.match(p.avisos.join(" "), /sin asignarlos/);
  // Sin «Pagado Prestación» en el archivo, todo se reparte igual.
  const sinColumna = armarCaso(entrada(lineas.map((l) => ({ ...l, pag: null })), { abonadoTratamiento: 3100 }));
  assert.equal(sinColumna.cifras.cobrado, 3100);
  // Más cobrado que cargos: el exceso no se inventa como cargo.
  const exceso = armarCaso(entrada(lineas, { abonadoTratamiento: 9000 }));
  assert.equal(exceso.cifras.cobrado, 4200);
  assert.equal(exceso.pagoSinCargo, 4800);
  assert.match(exceso.avisos.join(" "), /no caben/);
});

test("registros: facturas numeradas, pagos MIGRADOS (nunca payments), hojas firmadas, fases y claves de control", async () => {
  const { armarCaso } = await caso();
  const { construirRegistros, MARCA_DIAGNOSTICO_MIGRADO } = await casoDb();
  const p = armarCaso(entrada([
    { row: 2, procedure: "Colocación de brackets Metálicos", categoria: O, lineTotal: 3000, hecho: true, fecha: "2026-01-10", pag: 3000 },
    { row: 3, procedure: "Ajuste control mensual de ortodoncia", categoria: O, lineTotal: 600, hecho: true, fecha: "2026-02-10", pag: 600 },
    { row: 4, procedure: "Ajuste control mensual de ortodoncia", categoria: O, lineTotal: 600, hecho: true, fecha: "2026-03-10", pag: 0 },
    { row: 5, procedure: "TADS marca TD", categoria: O, lineTotal: 2800, pag: 0 },
  ]));
  const r = construirRegistros(p, { clinicId: CLINICA, userId: DUENO, origen: "Dentalink", ahora: dia("2026-09-29"), primerNumero: 10, patientId: "p1", doctorId: DUENO });
  assert.deepEqual(r.facturas.map((f: any) => f.invoiceNumber), ["MF-0010", "MF-0011", "MF-0012", "MF-0013"]);
  assert.deepEqual(r.facturas.map((f: any) => f.status), ["PAID", "PAID", "PENDING", "PENDING"]);
  assert.equal(r.pagosMigrados.length, 2, "una por factura con algo pagado");
  assert.deepEqual(r.pagosMigrados.map((x: any) => x.amount), [3000, 600]);
  assert.equal(r.hojas.length, 2);
  assert.ok(r.hojas.every((h: any) => h.status === "SIGNED" && h.soapS.startsWith("Visita migrada de Dentalink")));
  const marcas = r.facturas.filter((f: any) => String(f.notes).startsWith("[control-hoja:"));
  assert.equal(marcas.length, 2, "cada cargo de control lleva la marca de SU hoja");
  for (const [i, h] of r.hojas.entries()) assert.ok(String((marcas[i] as any).notes).startsWith(`[control-hoja:${(h as any).id}]`));
  assert.equal(r.facturasLigadas.length, 3, "controles + extras se ligan al caso; la colocación va por plan.invoiceId");
  assert.equal((r.plan as any).invoiceId, (r.facturas[0] as any).id);
  assert.equal((r.plan as any).treatingDoctorId, DUENO);
  assert.equal(r.fases.length, 6);
  assert.deepEqual(r.fases.map((f: any) => f.status), ["IN_PROGRESS", "NOT_STARTED", "NOT_STARTED", "NOT_STARTED", "NOT_STARTED", "NOT_STARTED"]);
  assert.deepEqual(r.clavesDeControl.map((k) => k.externalId), ["77|2026-02-10", "77|2026-03-10"]);
  assert.equal((r.diagnostico as any).etiologyNotes, MARCA_DIAGNOSTICO_MIGRADO);
  assert.match(String((r.diagnostico as any).clinicalSummary), /no mediciones/);
  assert.ok(String((r.diagnostico as any).clinicalSummary).length >= 40, "cumple el mínimo del formulario");
  assert.ok(String((r.plan as any).retentionPlanText).length >= 20);

  // Sin columnas opcionales (SQL sin pegar): el caso entra igual, sin doctor tratante ni factura ligada.
  const sinOpc = construirRegistros(p, { clinicId: CLINICA, userId: DUENO, origen: "Dentalink", ahora: dia("2026-09-29"), primerNumero: 1, patientId: "p1", doctorId: DUENO, columnasOpcionales: false });
  assert.equal("treatingDoctorId" in (sinOpc.plan as any), false);
  assert.equal("invoiceId" in (sinOpc.plan as any), false);
});

test("fases de un caso en retención y de uno terminado", async () => {
  const { armarCaso } = await caso();
  const { construirRegistros } = await casoDb();
  const lineas: R[] = [
    { row: 2, procedure: "Colocación de brackets Metálicos", categoria: O, lineTotal: 3000, hecho: true, fecha: "2026-01-10", pag: 3000 },
    { row: 3, procedure: "Control mensual contención", categoria: O, lineTotal: 600, hecho: true, fecha: "2026-03-10", pag: 600 },
  ];
  const op = { clinicId: CLINICA, userId: DUENO, origen: "Dentalink", ahora: dia("2026-09-29"), primerNumero: 1, patientId: "p1", doctorId: DUENO };
  const ret = construirRegistros(armarCaso(entrada(lineas)), op);
  assert.deepEqual(ret.fases.map((f: any) => f.status), ["COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED", "IN_PROGRESS"]);
  assert.equal((ret.fases[5] as any).startedAt.toISOString().slice(0, 10), "2026-03-10");
  const fin = construirRegistros(armarCaso(entrada(lineas, { estadoTratamiento: "finalizado" })), op);
  assert.ok(fin.fases.every((f: any) => f.status === "COMPLETED"));
  assert.equal((fin.plan as any).status, "COMPLETED");
});

// ───────────────────────── El motor de verdad ─────────────────────────

const csv = (t: string) => new File(["﻿" + t], "06.csv", { type: "text/csv" });
async function correr(file: File, opts: { dryRun?: boolean; origin?: string | null } = {}): Promise<any> {
  const { runImport } = await engine();
  const { HANDLERS } = await entidades();
  return runImport(HANDLERS.treatmentPlans, {
    file, clinicId: CLINICA, userId: DUENO, role: "SUPER_ADMIN", dryRun: opts.dryRun ?? true, skipDuplicates: true,
    origin: opts.origin === undefined ? "dentalink" : opts.origin, valueMapping: null,
  });
}
const tabla = (m: string) => base.tablas[m] ?? [];
const CAB06 = "# Tratamiento,Fecha de generación del tratamiento,Nombre Prestación,Nombre Categoría,Fecha Realización,Precio Paciente,Pagado Prestación,Total Pagos Tratamiento,Estado Tratamiento,Nombre Paciente,Apellidos Paciente,Celular,Especialidad Profesional Tratamiento";
const L1 = "Lucía,Prueba Uno,5551230001";
const M2 = "Mario,Prueba Dos,5551230002";
const l = (trat: string, prest: string, cat: string, realiz: string, precio: number, pag: number, total: number, estado: string, pac: string) =>
  `${trat},2026-01-05 10:00:00,${prest},${cat},${realiz},${precio},${pag},${total},${estado},${pac},Ortodoncia`;

const ARCHIVO = () => csv([CAB06,
  l("77", "Colocación de brackets Metálicos promocional", "Ortodoncia", "2026-01-10", 3000, 3000, 3600, "Tratamiento Activo", L1),
  l("77", "Ajuste control mensual de ortodoncia", "Ortodoncia", "2026-02-10", 600, 600, 3600, "Tratamiento Activo", L1),
  l("77", "Ajuste control mensual de ortodoncia", "Ortodoncia", "2026-03-10", 600, 0, 3600, "Tratamiento Activo", L1),
  l("77", "Ajuste control mensual de ortodoncia", "Ortodoncia", "", 600, 0, 3600, "Tratamiento Activo", L1),
  l("88", "Alineadores invisibles tratamiento completo", "Ortodoncia", "", 45000, 0, 0, "Tratamiento Activo", M2),
  l("99", "Profilaxis", "Prevención", "2026-01-12", 700, 700, 700, "Tratamiento Activo", L1),
].join("\n") + "\n");

function reiniciar(cambios?: (s: ReturnType<typeof semilla>) => void) {
  const s = semilla();
  cambios?.(s);
  base = crearBase(s);
  moduloActivo = true;
  modosGuardados.length = 0;
  nombresGuardados.length = 0;
}

test("vista previa: los tratamientos de ortodoncia se marcan como caso; el dental sigue su camino", async () => {
  reiniciar();
  const prev = await correr(ARCHIVO());
  assert.equal(prev.mappingError, undefined, JSON.stringify(prev.mappingError));
  const filas = prev.preview as any[];
  assert.deepEqual(filas.map((f) => f.data.ortoCaso === true), [true, true, true, true, true, false]);
  const resumen = filas[0].warnings.join(" ");
  assert.match(resumen, /Entra como CASO de ortodoncia · En tratamiento · Pago por control · 2 control\(es\) hecho\(s\) registrado\(s\) \(1 sin hacer/);
  assert.match(filas[4].warnings.join(" "), /Planeado · Precio total/);
  assert.equal(filas.every((f) => f.status === "ok"), true);
  assert.equal(tabla("orthodonticTreatmentPlan").length, 0, "la vista previa no escribe");
});

test("importar: casos, fases, hojas, facturas y pagos migrados; lo dental como tratamiento normal; NADA en payments", async () => {
  reiniciar();
  const res = await correr(ARCHIVO(), { dryRun: false });
  assert.equal(res.created, 3, "2 casos de ortodoncia + 1 tratamiento dental");
  assert.equal(tabla("orthodonticDiagnosis").length, 2);
  const planes = tabla("orthodonticTreatmentPlan");
  assert.equal(planes.length, 2);
  assert.equal(tabla("orthodonticPhase").length, 12);
  assert.equal(tabla("orthoTreatmentCard").length, 2, "solo los 2 controles hechos del caso 77");
  const p77 = planes.find((p) => p.technique === "METAL_BRACKETS")!;
  const p88 = planes.find((p) => p.technique === "CLEAR_ALIGNERS")!;
  assert.equal(p77.status, "IN_PROGRESS");
  assert.equal(p88.status, "PLANNED");
  assert.equal(p77.treatingDoctorId, DUENO, "sin usuario que empareje, el dueño");
  assert.deepEqual(modosGuardados.map((m) => m.modo).sort(), ["PAGO_POR_CONTROL", "PRECIO_TOTAL"]);
  assert.equal(modosGuardados.find((m) => m.planId === p77.id)!.modo, "PAGO_POR_CONTROL");
  assert.equal(modosGuardados.find((m) => m.planId === p88.id)!.modo, "PRECIO_TOTAL");

  // Facturas: 77 → colocación + 2 controles; 88 → tratamiento; el dental → la suya (camino de siempre).
  const facturas = tabla("invoice");
  assert.equal(facturas.length, 3 + 1 + 1);
  assert.equal(tabla("payment").length, 0, "Caja y Finanzas suman Payment: aquí no hay ninguno");
  const mig = tabla("migratedPayment");
  assert.equal(mig.reduce((s, x) => s + x.amount, 0), 3000 + 600 + 700);
  assert.equal(tabla("quote").length, 1, "solo el tratamiento dental crea presupuesto");
  assert.equal(tabla("treatmentPlan").length, 1);

  // Sin duplicar: el «# Tratamiento» y cada control quedaron recordados.
  const ext = tabla("importExternalIds");
  assert.deepEqual(ext.filter((e) => e.entity === "ortho_case").map((e) => e.externalId).sort(), ["77", "88"]);
  assert.equal(ext.find((e) => e.entity === "ortho_case" && e.externalId === "77")!.localId, p77.id);
  assert.deepEqual(ext.filter((e) => e.entity === "ortho_control").map((e) => e.externalId).sort(), ["77|2026-02-10", "77|2026-03-10"]);
  assert.ok(ext.every((e) => e.source === "dentalink"));
});

test("reimportar no crea otro caso: se ve en la vista previa y el commit no escribe nada más", async () => {
  reiniciar();
  await correr(ARCHIVO(), { dryRun: false });
  const antes = { planes: tabla("orthodonticTreatmentPlan").length, facturas: tabla("invoice").length, hojas: tabla("orthoTreatmentCard").length, pagos: tabla("migratedPayment").length };
  const prev = await correr(ARCHIVO());
  const filas = prev.preview as any[];
  assert.deepEqual(filas.slice(0, 5).map((f) => f.status), ["duplicate", "duplicate", "duplicate", "duplicate", "duplicate"]);
  assert.match(filas[0].warnings.join(" "), /ya se importó antes/);
  const otra = await correr(ARCHIVO(), { dryRun: false });
  assert.equal(otra.created, 0);
  assert.deepEqual(
    { planes: tabla("orthodonticTreatmentPlan").length, facturas: tabla("invoice").length, hojas: tabla("orthoTreatmentCard").length, pagos: tabla("migratedPayment").length },
    antes,
  );
});

test("sin el módulo de Ortodoncia o con otro origen, el tratamiento entra como siempre", async () => {
  reiniciar();
  moduloActivo = false;
  const prev = await correr(ARCHIVO());
  assert.ok((prev.preview as any[]).every((f) => f.data.ortoCaso !== true));
  assert.match((prev.preview as any[])[0].warnings.join(" "), /módulo de Ortodoncia no está activo/);
  const res = await correr(ARCHIVO(), { dryRun: false });
  assert.equal(res.created, 3);
  assert.equal(tabla("orthodonticTreatmentPlan").length, 0);
  assert.equal(tabla("treatmentPlan").length, 3, "los tres como tratamiento dental");

  reiniciar();
  const otro = await correr(ARCHIVO(), { dryRun: true, origin: null });
  assert.ok((otro.preview as any[]).every((f) => f.data.ortoCaso !== true), "solo el origen Dentalink usa este camino");
});

test("un control que 05 ya trajo como cita: la hoja se adjunta a esa cita y su clave no se pisa", async () => {
  reiniciar((s) => {
    (s as any).appointment.push({ id: "cita_1", clinicId: CLINICA, patientId: "p1" });
    (s as any).importExternalIds.push({ id: "x1", clinicId: CLINICA, source: "dentalink", entity: "ortho_control", externalId: "77|2026-02-10", localId: "cita_1" });
  });
  await correr(ARCHIVO(), { dryRun: false });
  const hojas = tabla("orthoTreatmentCard");
  assert.equal(hojas.length, 2);
  const conCita = hojas.filter((h) => h.appointmentId === "cita_1");
  assert.equal(conCita.length, 1, "la del 10 de febrero se ligó a la cita");
  assert.equal(conCita[0].visitDate.toISOString().slice(0, 10), "2026-02-10");
  const factura = tabla("invoice").find((f) => f.appointmentId === "cita_1");
  assert.ok(factura, "el cargo del control cuelga de esa cita");
  const claves = tabla("importExternalIds").filter((e) => e.entity === "ortho_control");
  assert.equal(claves.find((e) => e.externalId === "77|2026-02-10")!.localId, "cita_1", "la clave de 05 manda");
  assert.equal(claves.find((e) => e.externalId === "77|2026-03-10")!.localId, hojas.find((h) => h.appointmentId === undefined)!.id);
});

test("sin la tabla de ID externos no se importa ningún caso (un reintento los duplicaría)", async () => {
  reiniciar();
  base.banderas.sinTablaExternos = true;
  const prev = await correr(ARCHIVO());
  // Sin la tabla ni siquiera se emparejan pacientes por ID: los renglones entran por nombre/teléfono y el caso avisa.
  const filas = (prev.preview as any[]).slice(0, 5);
  assert.ok(filas.every((f) => f.status === "error"));
  assert.match(filas[0].errors.join(" "), /import-ids-externos\.sql/);
});
