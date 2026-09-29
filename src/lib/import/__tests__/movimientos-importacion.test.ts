/**
 * ws1-t10 — la importación queda en «Movimientos» de cada paciente.
 *
 * Run: TZ=UTC npx tsx --test --experimental-test-module-mocks src/lib/import/__tests__/movimientos-importacion.test.ts
 *
 * Lo que prueban:
 *   · un movimiento por paciente y por archivo, con origen, archivo y qué entró (citas, saldo, tratamientos…);
 *   · en bloque: UNA sentencia por archivo, no una por paciente;
 *   · reimportar el mismo archivo no repite movimientos;
 *   · si escribir el movimiento falla, la importación termina igual;
 *   · sin la columna patientId (falta el SQL) el paciente viaja en `changes` y no se pierde;
 *   · lo que trae dinero va en la categoría «dinero» (quien no ve facturación no lo lee); lo demás en «archivos».
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { crearBase, type Base } from "./doble-prisma";
import type { PreviewRow } from "../types";

const CLINICA = "cli_A";
const OTRA = "cli_B";
const IMPORTA = "u_admin";

function semilla() {
  return {
    clinic: [{ id: CLINICA, name: "Clínica Sonrisa", timezone: "America/Mexico_City" }],
    patient: [
      { id: "p1", clinicId: CLINICA, patientNumber: "P-0001", firstName: "María", lastName: "Hernández", phone: "5551234567", email: null, deletedAt: null, visibleUserIds: [] },
      { id: "p2", clinicId: CLINICA, patientNumber: "P-0002", firstName: "Luis", lastName: "Pérez", phone: "5557654321", email: null, deletedAt: null, visibleUserIds: [] },
      { id: "p9", clinicId: OTRA, patientNumber: "P-0001", firstName: "Otra", lastName: "Clínica", phone: "5550000000", email: null, deletedAt: null, visibleUserIds: [] },
    ],
    user: [
      { id: IMPORTA, clinicId: CLINICA, firstName: "Rafael", lastName: "Admin", isActive: true, role: "SUPER_ADMIN" },
      { id: "doc1", clinicId: CLINICA, firstName: "Carlos", lastName: "Nuñez", isActive: true, role: "DOCTOR" },
    ],
    importExternalIds: [],
    appointment: [],
    auditLog: [],
    invoice: [],
    whatsAppReminder: [],
  };
}

let base: Base = crearBase(semilla());
mock.module("@/lib/prisma", { namedExports: { prisma: new Proxy({}, { get: (_t, k: string) => base.prisma[k] }) } });
// La bitácora del motor (una fila global por archivo) no es lo que se prueba aquí.
mock.module("@/lib/audit", { namedExports: { logAudit: async () => {} } });
mock.module("@/lib/invoices/next-invoice-number", { namedExports: { lastInvoiceFolio: async () => 0 } });
mock.module("@/lib/patient-quota", { namedExports: { getPatientQuota: async () => ({ unlimited: true, used: 0, max: null, remaining: null }) } });
mock.module("@/lib/patients/next-patient-number", { namedExports: { lastPatientFolio: async () => 100 } });

const engine = () => import("../engine");
const entidades = () => import("../entities");
const modulo = () => import("../movimientos");

function reiniciar() {
  base = crearBase(semilla());
}
const tabla = (m: string) => base.tablas[m] ?? [];
const csv = (nombre: string, texto: string) => new File([texto], nombre, { type: "text/csv" });
const movs = () => tabla("auditLog").filter((r: any) => r.entityType === "import");
const texto = (r: any) => r.changes?._mov?.after?.texto as string;
const categoria = (r: any) => r.changes?._mov?.after?.categoria as string;

async function correr(cual: string, file: File, origin: string | null = "dentalink", dryRun = false): Promise<any> {
  const { runImport } = await engine();
  return runImport((await entidades()).HANDLERS[cual], {
    file, clinicId: CLINICA, userId: IMPORTA, role: "SUPER_ADMIN",
    dryRun, skipDuplicates: true, columnMapping: null, origin, valueMapping: null, sheet: null,
  });
}

const CITAS = "paciente,apellido,telefono,doctor,fecha,hora\nMaría,Hernández,5551234567,Carlos Nuñez,2031-05-06,10:00\nMaría,Hernández,5551234567,Carlos Nuñez,2031-05-07,10:00\nLuis,Pérez,5557654321,Carlos Nuñez,2031-05-06,11:00";

// ─────────────────────────── la parte pura ───────────────────────────

const fila = (data: Record<string, any>, status: PreviewRow["status"] = "ok", row = 2): PreviewRow => ({ row, data, status, errors: [], warnings: [] });
const O = (entity: string, extra: Record<string, unknown> = {}) => ({ entity, origen: "Dentalink", fileName: "arch.xlsx", skipDuplicates: true, ...extra });

test("solo cuentan las filas que de verdad entraron: las ya importadas, duplicadas y con error no dejan rastro", async () => {
  const { resumirImportacion } = await modulo();
  const r = resumirImportacion(
    [fila({ patientId: "p1" }), fila({ patientId: "p1" }, "skipped"), fila({ patientId: "p2" }, "error"), fila({ patientId: "p3" }, "duplicate")],
    O("appointments"),
  );
  assert.deepEqual(r.map((x: any) => [x.patientId, x.texto]), [["p1", "Importado desde Dentalink (arch.xlsx): 1 cita futura"]]);
  // Con «omitir duplicados» apagado, el duplicado sí entra.
  const conDup = resumirImportacion([fila({ patientId: "p3" }, "duplicate")], O("appointments", { skipDuplicates: false }));
  assert.equal(conDup.length, 1);
  assert.deepEqual(resumirImportacion([], O("appointments")), []);
});

test("frases por archivo: ficha, citas futuras, historial con controles, saldo de mora, mora anotada, a favor", async () => {
  const { resumirImportacion } = await modulo();
  const un = (entity: string, filas: PreviewRow[], quien = "p1") => resumirImportacion(filas, O(entity)).find((x: any) => x.patientId === quien)!;
  assert.equal(un("patients", [fila({ newId: "p1" })]).texto, "Importado desde Dentalink (arch.xlsx): ficha del paciente");
  assert.match(un("appointments", [fila({ patientId: "p1" }), fila({ patientId: "p1" }), fila({ patientId: "p1" })]).texto, /: 3 citas futuras$/);
  assert.match(
    un("appointmentHistory", [...Array(12)].map((_, i) => fila({ patientId: "p1", comoControl: i < 2 }, "ok", i + 2))).texto,
    /: 12 citas del historial \(2 como controles de ortodoncia\)$/,
  );
  const mora = un("balances", [fila({ patientId: "p1", kind: "debt", amount: 600 })]);
  assert.match(mora.texto, /: saldo de mora \$600$/);
  assert.equal(mora.categoria, "dinero");
  assert.match(un("balances", [fila({ patientId: "p1", kind: "debt", amount: 600, ligadoA: { tipo: "caso" } })]).texto, /: mora de \$600 anotada en su tratamiento$/);
  assert.match(un("balances", [fila({ patientId: "p1", kind: "credit", amount: 1250.5 })]).texto, /: saldo a favor \$1,250\.50$/);
  // Sin rastro por paciente: doctores, bloqueos, catálogo.
  for (const e of ["doctors", "blockedHours", "procedureCatalog"]) assert.deepEqual(resumirImportacion([fila({ name: "x" })], O(e)), []);
});

test("tratamientos: cuántos, cuántos son caso de ortodoncia, cuántos controles hechos y lo pagado migrado", async () => {
  const { resumirImportacion } = await modulo();
  const hoy = new Date("2026-03-04T12:00:00Z");
  const renglon = (row: number, groupKey: string, extra: Record<string, unknown>) =>
    fila({ patientId: "p1", groupKey, procedure: "Limpieza", categoria: "", ...extra }, "ok", row);
  const filas = [
    // Tratamiento 1: caso de ortodoncia con colocación y 2 controles hechos + 1 sin hacer; pagado 3000.
    renglon(2, "16", { ortoCaso: true, procedure: "Colocación de brackets", categoria: "Ortodoncia", hecho: true, fechaRealizado: hoy, abonado: 3000 }),
    renglon(3, "16", { ortoCaso: true, procedure: "Control mensual ortodoncia", categoria: "Ortodoncia", hecho: true, fechaRealizado: hoy, abonado: 3000 }),
    renglon(4, "16", { ortoCaso: true, procedure: "Control mensual ortodoncia", categoria: "Ortodoncia", hecho: true, fechaRealizado: hoy, abonado: 3000 }),
    renglon(5, "16", { ortoCaso: true, procedure: "Control mensual ortodoncia", categoria: "Ortodoncia", hecho: false, abonado: 3000 }),
    // Tratamiento 2: dental, pagado 1800 en total (no por renglón).
    renglon(6, "17", { abonado: 1800 }),
    renglon(7, "17", { abonado: 1800 }),
  ];
  const r = resumirImportacion(filas, O("treatmentPlans"));
  assert.equal(r.length, 1);
  assert.equal(r[0].texto, "Importado desde Dentalink (arch.xlsx): 2 tratamientos (1 caso de ortodoncia, 2 controles), pagado migrado $4,800");
  assert.equal(r[0].categoria, "dinero");
  // Sin nada pagado: sin dinero → categoría «archivos».
  const sinPago = resumirImportacion([renglon(2, "17", {})], O("treatmentPlans"));
  assert.equal(sinPago[0].texto, "Importado desde Dentalink (arch.xlsx): 1 tratamiento");
  assert.equal(sinPago[0].categoria, "archivos");
});

// ─────────────────────────── de punta a punta con el motor ───────────────────────────

test("importar citas deja UN movimiento por paciente y por archivo, con origen y archivo; el resto de la clínica no se toca", async () => {
  reiniciar();
  const hecho = await correr("appointments", csv("Citas.csv", CITAS), null);
  assert.equal(hecho.created, 3);
  const m = movs();
  assert.equal(m.length, 2, "una por paciente, no una por cita");
  const deMaria = m.find((r: any) => r.patientId === "p1");
  assert.equal(texto(deMaria), "Importado desde otro sistema (Citas.csv): 2 citas futuras");
  assert.equal(categoria(deMaria), "archivos");
  assert.deepEqual([deMaria.clinicId, deMaria.userId, deMaria.action, deMaria.actorType], [CLINICA, IMPORTA, "create", "staff"]);
  assert.equal(texto(m.find((r: any) => r.patientId === "p2")), "Importado desde otro sistema (Citas.csv): 1 cita futura");
  assert.equal(m.some((r: any) => r.patientId === "p9"), false);
  assert.equal(base.llamadas["$executeRaw.auditLogs"], 1, "una sentencia para todo el archivo");
});

test("con el perfil de Dentalink el movimiento dice «Dentalink»", async () => {
  reiniciar();
  await correr("appointments", csv("05_Citas.csv", CITAS), "dentalink");
  assert.match(texto(movs()[0]), /^Importado desde Dentalink \(05_Citas\.csv\): /);
});

test("la vista previa (dry-run) no deja ningún movimiento", async () => {
  reiniciar();
  await correr("appointments", csv("Citas.csv", CITAS), null, true);
  assert.equal(movs().length, 0);
});

test("reimportar el mismo archivo sin cambios NO repite movimientos", async () => {
  reiniciar();
  await correr("appointments", csv("Citas.csv", CITAS), null);
  await correr("appointments", csv("Citas.csv", CITAS), null);
  assert.equal(movs().length, 2);
});

test("el mismo movimiento no se escribe dos veces aunque las filas vuelvan a entrar (red por identificador)", async () => {
  reiniciar();
  const { registrarImportacionEnMovimientos } = await modulo();
  const args = { clinicId: CLINICA, userId: IMPORTA, entity: "appointments", origen: "Dentalink", fileName: "a.csv", skipDuplicates: true, preview: [fila({ patientId: "p1" })] };
  assert.equal(await registrarImportacionEnMovimientos(args), 1);
  assert.equal(await registrarImportacionEnMovimientos(args), 0);
  // Otro archivo, otro movimiento.
  assert.equal(await registrarImportacionEnMovimientos({ ...args, fileName: "b.csv" }), 1);
  assert.equal(movs().length, 2);
});

test("la mora de un tratamiento ya importado deja «mora anotada en su tratamiento»; la otra, «saldo de mora»", async () => {
  reiniciar();
  base.tablas.quote = [{ id: "q291", clinicId: CLINICA, patientId: "p2", status: "ACCEPTED", treatmentPlanId: "tp", total: 14400, notes: "Tratamiento activo migrado de Dentalink el 01/09/2026.\nFolio original (tratamiento activo): 291" }];
  base.tablas.importExternalIds = [
    { id: "e1", clinicId: CLINICA, source: "dentalink", entity: "patient", externalId: "202", localId: "p1" },
    { id: "e2", clinicId: CLINICA, source: "dentalink", entity: "patient", externalId: "203", localId: "p2" },
  ];
  const f = csv("04_Saldos.csv", "Nombre Sucursal,# Tratamiento,Paciente,Nombre Paciente,Apellidos Paciente,Mora\nB,56,202,María,Hernández,600\nB,291,203,Luis,Pérez,600");
  await correr("balances", f, "dentalink");
  const m = movs();
  assert.equal(texto(m.find((r: any) => r.patientId === "p1")), "Importado desde Dentalink (04_Saldos.csv): saldo de mora $600");
  assert.equal(texto(m.find((r: any) => r.patientId === "p2")), "Importado desde Dentalink (04_Saldos.csv): mora de $600 anotada en su tratamiento");
  assert.ok(m.every((r: any) => categoria(r) === "dinero"));
});

test("si escribir los movimientos falla, la importación termina igual (y lo dice en el log, no en la pantalla)", async () => {
  reiniciar();
  base.ganchos["$executeRaw.auditLogs"] = () => { throw new Error("la bitácora se cayó"); };
  const silenciar = console.error;
  const avisos: string[] = [];
  console.error = (...a: unknown[]) => { avisos.push(a.map(String).join(" ")); };
  try {
    const hecho = await correr("appointments", csv("Citas.csv", CITAS), null);
    assert.equal(hecho.created, 3, "las citas entraron");
    assert.equal(tabla("appointment").length, 3);
    assert.equal(movs().length, 0);
    assert.ok(avisos.some((a) => /registrarMovimientosEnBloque error/.test(a)));
  } finally {
    console.error = silenciar;
  }
});

test("sin la columna patientId (falta el SQL) el movimiento se guarda igual con el paciente dentro de changes", async () => {
  reiniciar();
  const { _reiniciarEstadoDeColumna } = await import("@/lib/movimientos-paciente/fila");
  _reiniciarEstadoDeColumna();
  base.ganchos["$executeRaw.auditLogs"] = () => {
    const e: any = new Error('column "patientId" of relation "audit_logs" does not exist');
    e.code = "P2010";
    e.meta = { code: "42703", message: 'column "patientId" of relation "audit_logs" does not exist' };
    throw e;
  };
  await correr("appointments", csv("Citas.csv", CITAS), null);
  _reiniciarEstadoDeColumna();
  const m = movs();
  assert.equal(m.length, 2);
  const deMaria = m.find((r: any) => r.changes?._mov?.after?.patientId === "p1");
  assert.ok(deMaria, "el paciente viaja en changes._mov.after.patientId");
  assert.match(texto(deMaria), /2 citas futuras/);
});

test("importar pacientes: cada paciente creado recibe «ficha del paciente»", async () => {
  reiniciar();
  const f = csv("01_Pacientes.csv", "nombre,apellido,telefono\nAna,Soto,5550001111\nJosé,Ruiz,5552223333");
  const hecho = await correr("patients", f, null);
  assert.equal(hecho.created, 2);
  const m = movs();
  assert.equal(m.length, 2);
  assert.ok(m.every((r: any) => /: ficha del paciente$/.test(texto(r))));
  const ids = new Set(tabla("patient").filter((p: any) => p.clinicId === CLINICA).map((p: any) => p.id));
  assert.ok(m.every((r: any) => ids.has(r.patientId)));
});
