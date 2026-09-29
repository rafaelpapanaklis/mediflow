/**
 * ws1-t12 — ARREGLOS de la revisión final (ws1-t5, 28-sep-2026): I1, I4, I7, I8, I9 y la guardia de la carga por lote.
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/import/__tests__/arreglos-revision-final.test.ts
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { crearBase, type Base } from "./doble-prisma";
import { tieneAccesoOrtodoncia } from "@/lib/orthodontics/acceso-doctor";
import { mapeoEsDeEsteArchivo, puedeConfirmarSolo } from "../../../components/import/lote-guardia";

const CLINICA = "cli_A";
const IMPORTA = "u_admin";

function semilla() {
  return {
    clinic: [{ id: CLINICA, name: "Clínica de prueba", category: "DENTAL", timezone: "America/Mexico_City", plan: "BASIC", planOverrideFor: null, maxUsersOverride: null, maxClinicsOverride: null, priceMxnMonthlyOverride: null, priceMxnAnnualOverride: null }],
    user: [
      { id: IMPORTA, clinicId: CLINICA, email: "admin@x.test", firstName: "Ana", lastName: "Dueña", role: "SUPER_ADMIN", isActive: true, color: "#3b82f6", cedulaProfesional: null, especialidad: null, phone: null },
      { id: "u_luis", clinicId: CLINICA, email: "luis@x.test", firstName: "Luis", lastName: "Prueba", role: "DOCTOR", isActive: true, color: "#7c3aed", cedulaProfesional: null, especialidad: null, phone: null },
    ],
    patient: [], importExternalIds: [], appointment: [], agendaBlock: [], migratedOrthoCase: [], migratedPayment: [], procedureCatalog: [],
    quote: [], quoteItem: [], treatmentPlan: [], treatmentSession: [], invoice: [], payment: [],
  };
}
let base: Base = crearBase(semilla());
let moduloActivo = true;
const creadosSb: any[] = [];
mock.module("@/lib/prisma", { namedExports: { prisma: new Proxy({}, { get: (_t, k: string) => base.prisma[k] }) } });
mock.module("@/lib/audit", { namedExports: { logAudit: async () => {} } });
mock.module("@/lib/patient-quota", { namedExports: { getPatientQuota: async () => ({ unlimited: true, used: 0, max: null, remaining: null }) } });
mock.module("@/lib/invoices/next-invoice-number", { namedExports: { lastInvoiceFolio: async () => 500 } });
mock.module("@/lib/orthodontics/access", { namedExports: { hasActiveOrthodonticsModule: async () => moduloActivo } });
mock.module("@/lib/plans", { namedExports: { getPlanLimitsForClinic: async () => ({ maxUsers: 100 }) } });
mock.module("../doctores/supabase-admin", {
  namedExports: { getAdminClient: () => ({ auth: { admin: { createUser: async (a: any) => { creadosSb.push(a); return { data: { user: { id: `sb_${creadosSb.length}` } }, error: null }; } } } }) },
});

const engine = () => import("../engine");
const entidades = () => import("../entities");
const csv = (t: string) => new File(["﻿" + t], "archivo.csv", { type: "text/csv" });
async function correr(entidad: string, file: File, opts: { dryRun?: boolean; valueMapping?: any; origin?: string | null } = {}): Promise<any> {
  const { runImport } = await engine();
  const { HANDLERS } = await entidades();
  return runImport(HANDLERS[entidad], { file, clinicId: CLINICA, userId: IMPORTA, role: "SUPER_ADMIN", dryRun: opts.dryRun ?? true, skipDuplicates: true, origin: opts.origin === undefined ? "dentalink" : opts.origin, valueMapping: opts.valueMapping ?? null });
}
const tabla = (m: string) => base.tablas[m] ?? [];

// ── I4: presupuestos y tratamientos por ID de paciente ──────────────────────
test("I4: presupuestos y tratamientos activos empatan por el ID del paciente («# Paciente») sin nombre, teléfono ni correo", async () => {
  base = crearBase(semilla());
  await correr("patients", csv("# Paciente,Nombre,Apellidos\n901,Lucía,Prueba Uno\n902,Mario,Prueba Dos\n"), { dryRun: false });
  assert.equal(tabla("patient").length, 2);
  const quotes = await correr("quotes", csv("# Paciente,# Tratamiento,Fecha de generación del tratamiento,Nombre Prestación,Precio Paciente\n901,7,2026-03-10,Profilaxis,900\n902,8,2026-03-11,Resina,1200\n"));
  assert.equal(quotes.mappingError, undefined);
  assert.deepEqual(quotes.preview.map((r: any) => r.status), ["ok", "ok"], JSON.stringify(quotes.preview.map((r: any) => r.errors)));
  const planes = await correr("treatmentPlans", csv("# Paciente,# Tratamiento,Fecha de generación del tratamiento,Nombre Prestación,Precio Paciente\n901,7,2026-03-10,Profilaxis,900\n902,8,2026-03-11,Resina,1200\n"));
  assert.deepEqual(planes.preview.map((r: any) => r.status), ["ok", "ok"], JSON.stringify(planes.preview.map((r: any) => r.errors)));
  const real = await correr("treatmentPlans", csv("# Paciente,# Tratamiento,Fecha de generación del tratamiento,Nombre Prestación,Precio Paciente\n901,7,2026-03-10,Profilaxis,900\n"), { dryRun: false });
  assert.equal(real.created, 1);
  assert.equal(tabla("treatmentPlan")[0].patientId, tabla("patient").find((p) => p.firstName === "Lucía")!.id);
  // un ID que no existe sigue siendo un error claro, no un «ninguna línea identifica al paciente»
  const malo = await correr("quotes", csv("# Paciente,# Tratamiento,Fecha de generación del tratamiento,Nombre Prestación,Precio Paciente\n999,9,2026-03-10,Profilaxis,900\n"));
  assert.match(malo.preview[0].errors.join(" "), /999|no encontrado/);
  assert.doesNotMatch(malo.preview[0].errors.join(" "), /identifica al paciente/);
});

// ── I1 (servidor): una fila vacía de caso de ortodoncia no se escribe ───────
test("I1: un caso de ortodoncia sin técnica, fecha, precio, doctor ni estado NO se escribe (antes salían «UNKNOWN» vacíos)", async () => {
  base = crearBase(semilla());
  await correr("patients", csv("ID,Nombre,Apellidos\n1,Carla,Prueba Tres\n"), { dryRun: false });
  const conTodo = "ID,Paciente,Técnica,Fecha de colocación,Precio total\n1,Carla Prueba Tres,Brackets metálicos,2025-01-10,18000\n";
  const vacia = "ID,Paciente\n1,Carla Prueba Tres\n";
  const rV = await correr("orthoCases", csv(vacia));
  assert.equal(rV.preview[0].status, "error");
  assert.match(rV.preview[0].errors.join(" "), /no hay nada que migrar/);
  const ok = await correr("orthoCases", csv(conTodo), { dryRun: false });
  assert.equal(ok.created, 1);
  // idempotente: reimportar el mismo archivo no duplica
  const otra = await correr("orthoCases", csv(conTodo), { dryRun: false });
  assert.equal(otra.created, 0);
  assert.equal(tabla("migratedOrthoCase").length, 1);
  assert.ok(tabla("migratedOrthoCase")[0].technique);
});

// ── I8 ──────────────────────────────────────────────────────────────────────
test("I8: un pago con el monto vacío dice «Falta el monto», no «Monto inválido \"\"»", async () => {
  base = crearBase(semilla());
  await correr("patients", csv("ID,Nombre,Apellidos\n1,Ana,Prueba\n"), { dryRun: false });
  const r = await correr("paymentHistory", csv("ID Paciente,Fecha,Monto\n1,2026-01-05,\n"));
  assert.match(r.preview[0].errors.join(" "), /Falta el monto/);
  assert.doesNotMatch(r.preview[0].errors.join(" "), /inválido/);
});

// ── I9 ──────────────────────────────────────────────────────────────────────
test("I9: la especialidad del archivo llena el selector; «Ortodoncia» (con el módulo activo) marca el acceso, como el alta de Equipo", async () => {
  base = crearBase(semilla());
  moduloActivo = true;
  const f = csv("Nombre,Apellidos,Email,Especialidad,Cédula\nOrla,Ortiz,orla@x.test,Ortodoncia,1234567\nPedro,Peña,pedro@x.test,Odontopediatría,7654321\n");
  const r = await correr("doctors", f, { dryRun: false });
  assert.equal(r.created, 2);
  const orla = tabla("user").find((u) => u.email === "orla@x.test")!;
  const pedro = tabla("user").find((u) => u.email === "pedro@x.test")!;
  assert.equal(orla.specialty, "Ortodoncia", "el selector de especialidad");
  assert.equal(orla.especialidad, "Ortodoncia", "y el campo oficial");
  // Igual que el alta de Equipo con «ortodoncista»: el rol DOCTOR ya trae la llave del módulo, así que no hace
  // falta un override (vacío = default del rol); lo que importa es que la tenga.
  assert.equal(tieneAccesoOrtodoncia({ role: "DOCTOR", permissionsOverride: orla.permissionsOverride ?? [] }), true, "acceso al módulo");
  assert.equal(pedro.specialty, "Odontopediatría");
  assert.equal(pedro.permissionsOverride, undefined, "quien no es de ortodoncia no cambia de permisos");
});

test("I9: sin el módulo de Ortodoncia activo, la especialidad se guarda pero NO se da acceso", async () => {
  base = crearBase(semilla());
  moduloActivo = false;
  await correr("doctors", csv("Nombre,Apellidos,Email,Especialidad,Cédula\nOrla,Ortiz,orla@x.test,Ortodoncia,1234567\n"), { dryRun: false });
  const orla = tabla("user").find((u) => u.email === "orla@x.test")!;
  assert.equal(orla.specialty, "Ortodoncia");
  assert.equal(orla.permissionsOverride, undefined);
  moduloActivo = true;
});

// ── I7: bloqueos ────────────────────────────────────────────────────────────
test("I7: un bloqueo con un doctor que no existe ofrece elegir a qué usuario se asigna, y con la elección entra", async () => {
  base = crearBase(semilla());
  const f = () => csv("Doctor,Fecha,Hora inicio,Hora fin,Comentario\nDaisy García,2030-10-12,09:00,11:00,Congreso\n");
  const sin = await correr("blockedHours", f());
  assert.equal(sin.preview[0].status, "error");
  assert.deepEqual(sin.unresolved.map((u: any) => [u.field, u.value]), [["doctor", "Daisy García"]]);
  assert.ok(sin.options.doctor.length >= 2);
  const con = await correr("blockedHours", f(), { valueMapping: { doctor: { daisygarcia: "u_luis" } } });
  assert.equal(con.preview[0].status, "ok");
  assert.equal(con.preview[0].data.doctorId, "u_luis");
});

// ── I1 (cliente): la guardia de la carga por lote ───────────────────────────
const vp = (extra: any = {}) => ({
  columns: [{ source: "Pieza dental", sample: "", suggestion: "tooth" }, { source: "Hallazgo", sample: "" }],
  stats: { valid: 2, errors: 0, duplicates: 0 },
  ...extra,
});
test("I1: nada se confirma solo con la vista previa de OTRO archivo (la causa raíz)", () => {
  const mapping = { "Pieza dental": "tooth" };
  assert.equal(puedeConfirmarSolo({ previewKey: "0-", currentKey: "1-", preview: vp(), mapping }), false, "vista previa del archivo anterior");
  assert.equal(puedeConfirmarSolo({ previewKey: null, currentKey: "1-", preview: vp(), mapping }), false, "aún no hay vista previa de este archivo");
  assert.equal(puedeConfirmarSolo({ previewKey: "1-", currentKey: "1-", preview: vp(), mapping }), true);
});
test("I1: un mapeo con columnas que este archivo no tiene no se confirma", () => {
  assert.equal(mapeoEsDeEsteArchivo({ "Monto": "amount" }, ["Pieza dental", "Hallazgo"]), false);
  assert.equal(mapeoEsDeEsteArchivo({ "Pieza dental": "tooth" }, ["Pieza dental", "Hallazgo"]), true);
  assert.equal(puedeConfirmarSolo({ previewKey: "1-", currentKey: "1-", preview: vp(), mapping: { Monto: "amount" } }), false);
});
test("I1: un archivo al que le falta algo se detiene y lo pide (nunca se confirma a medias)", () => {
  const ok = { previewKey: "1-", currentKey: "1-", mapping: { "Pieza dental": "tooth" } };
  assert.equal(puedeConfirmarSolo({ ...ok, preview: vp({ mappingError: "Falta la columna del monto del pago" }) }), false);
  assert.equal(puedeConfirmarSolo({ ...ok, preview: vp({ needsSheet: true }) }), false);
  assert.equal(puedeConfirmarSolo({ ...ok, preview: vp({ unresolved: [{ field: "doctor", key: "x", value: "X", rows: 1 }] }) }), false);
  assert.equal(puedeConfirmarSolo({ ...ok, preview: vp({ unresolved: [{ field: "amountFormat", key: "x", value: "45.000", rows: 1 }] }) }), false);
  assert.equal(puedeConfirmarSolo({ ...ok, preview: vp({ stats: { valid: 0, errors: 3, duplicates: 0 } }) }), false);
  // procedimientos sin equivalente NO detienen: entran con su nombre e importe
  assert.equal(puedeConfirmarSolo({ ...ok, preview: vp({ unresolved: [{ field: "procedure", key: "x", value: "X", rows: 1 }] }) }), true);
});
