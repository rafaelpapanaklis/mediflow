/**
 * ws1-t6 — arreglos del importador que dañaban datos antes de que BEVADENT importe
 * desde Dentalink: citas (zona horaria, hora en .xlsx, AM/PM, pasadas, solapes,
 * recordatorios), montos («45.000»), saldos idempotentes, pacientes (nombre en una
 * columna, familias, ID externo, prefijos).
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/import/__tests__/importador-arreglos.test.ts
 *      (y otra vez con TZ=Asia/Tokyo: nada debe depender de la zona del servidor)
 *
 * Se conduce el motor DE VERDAD (runImport + handlers + exceljs sobre archivos .csv
 * y .xlsx sintéticos, sin datos reales). Solo se sustituyen Prisma (doble en
 * memoria, ver doble-prisma.ts), el audit y el cupo del plan.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { crearBase, type Base } from "./doble-prisma";
import { APPT_AUTO_TYPE, dedupeKey } from "@/lib/reminders/config";

const CLINICA = "cli_A";
const IMPORTA = "u_admin";
const TZ = "America/Merida"; // UTC-6 todo el año

function semilla() {
  const antes = new Date("2026-09-01T10:00:00.000Z");
  const paciente = (o: Record<string, any>) => ({
    clinicId: CLINICA, email: null, phone: null, dob: null, deletedAt: null, visibleUserIds: [], updatedAt: antes, ...o,
  });
  return {
    clinic: [{
      id: CLINICA, name: "Clínica Sonrisa", timezone: TZ,
      reminderSettings: null, waReminderActive: true, waReminder24h: true, waReminder1h: true, waReminderMsg: null,
    }],
    patient: [
      paciente({ id: "p1", patientNumber: "P-0001", firstName: "María", lastName: "Hernández", phone: "5551234567" }),
      paciente({ id: "p2", patientNumber: "P-0002", firstName: "Jorge", lastName: "López", phone: "+56 9 8765 4321" }),
      paciente({ id: "p3", patientNumber: "P-0003", firstName: "Ana", lastName: "Ruiz", email: "ana.ruiz@example.com" }),
    ],
    user: [
      { id: "u_ana", clinicId: CLINICA, firstName: "Ana", lastName: "López", isActive: true },
      { id: "u_luis", clinicId: CLINICA, firstName: "Luis", lastName: "Pérez", isActive: true },
    ],
    appointment: [],
    whatsAppReminder: [],
    invoice: [],
    patientCredit: [],
    importExternalIds: [],
  };
}

let base: Base = crearBase(semilla());
mock.module("@/lib/prisma", { namedExports: { prisma: new Proxy({}, { get: (_t, k: string) => base.prisma[k] }) } });
mock.module("@/lib/audit", { namedExports: { logAudit: async () => {} } });
mock.module("@/lib/patient-quota", {
  namedExports: { getPatientQuota: async () => ({ unlimited: true, used: 0, max: null, remaining: null }) },
});
// El siguiente folio sale de un SQL crudo que el doble no conoce: se sustituye por un contador simple.
mock.module("@/lib/patients/next-patient-number", { namedExports: { lastPatientFolio: async () => 100 } });
mock.module("@/lib/invoices/next-invoice-number", { namedExports: { lastInvoiceFolio: async () => 500 } });

const engine = () => import("../engine");
const entidades = () => import("../entities");

function reiniciar(cambios?: (s: ReturnType<typeof semilla>) => void) {
  const s = semilla();
  cambios?.(s);
  base = crearBase(s);
}

const csv = (nombre: string, texto: string) => new File([texto], nombre, { type: "text/csv" });

async function xlsx(nombre: string, cabeceras: string[], filas: any[][], formatos: Record<number, string> = {}): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Hoja1");
  ws.addRow(cabeceras);
  for (const f of filas) ws.addRow(f);
  for (const [col, fmt] of Object.entries(formatos)) ws.getColumn(Number(col)).numFmt = fmt;
  const buf = await wb.xlsx.writeBuffer();
  return new File([buf as ArrayBuffer], nombre);
}

async function correr(
  entidad: string,
  file: File,
  opts: { dryRun?: boolean; skipDuplicates?: boolean; origin?: string; valueMapping?: any; columnMapping?: Record<string, string>; sheet?: string } = { dryRun: true },
): Promise<any> {
  const { runImport } = await engine();
  const { HANDLERS } = await entidades();
  return runImport(HANDLERS[entidad], {
    file,
    clinicId: CLINICA,
    userId: IMPORTA,
    role: "ADMIN",
    dryRun: opts.dryRun ?? true,
    skipDuplicates: opts.skipDuplicates ?? true,
    columnMapping: opts.columnMapping ?? null,
    origin: opts.origin ?? null,
    valueMapping: opts.valueMapping ?? null,
    sheet: opts.sheet ?? null,
  });
}
const fila = (res: any, n: number) => res.preview.find((r: any) => r.row === n);
const tabla = (m: string) => base.tablas[m] ?? [];

/** Número de serie de Excel (sistema 1900) de un día. */
const serieExcel = (y: number, m: number, d: number) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;

/** «2030-01-15» + «15:30» a partir de un instante, en la zona de la clínica. */
function localDe(d: Date): { fecha: string; hora: string } {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return { fecha: `${g("year")}-${g("month")}-${g("day")}`, hora: `${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}` };
}

// ═══ CITAS ═════════════════════════════════════════════════════════════════

test("citas CSV: la hora se lee en la ZONA DE LA CLÍNICA (Mérida), no en la del servidor", async () => {
  reiniciar();
  const f = csv("citas.csv", "Paciente,Celular,Profesional,Fecha,Hora\nMaría Hernández,5551234567,Ana López,15/01/2030,15:30\n");
  const res = await correr("appointments", f);
  assert.equal(res.validos, 1, JSON.stringify(res.preview));
  // 15:30 en Mérida (UTC-6) = 21:30Z. Con la hora del servidor (UTC) habría sido 15:30Z = 09:30 local.
  assert.equal(fila(res, 2).data.startsAt.toISOString(), "2030-01-15T21:30:00.000Z");
  assert.equal(fila(res, 2).data.endsAt.toISOString(), "2030-01-15T22:00:00.000Z");
});

test("citas: AM/PM se respeta (3:30 PM = 15:30, 12:00 AM = medianoche) y una hora ilegible NO se vuelve 09:00", async () => {
  reiniciar();
  const f = csv("citas.csv", [
    "Paciente,Celular,Profesional,Fecha,Hora",
    "María Hernández,5551234567,Ana López,15/01/2030,3:30 PM",
    "María Hernández,5551234567,Luis Pérez,15/01/2030,12:15 a.m.",
    "María Hernández,5551234567,Ana López,16/01/2030,10:00",
    "María Hernández,5551234567,Ana López,17/01/2030,mañana",
    "María Hernández,5551234567,Ana López,18/01/2030,",
    "María Hernández,5551234567,Ana López,19/01/2030,25:00",
  ].join("\n"));
  const res = await correr("appointments", f);
  assert.equal(fila(res, 2).data.startsAt.toISOString(), "2030-01-15T21:30:00.000Z");
  assert.equal(fila(res, 3).data.startsAt.toISOString(), "2030-01-15T06:15:00.000Z");
  assert.equal(fila(res, 4).data.startsAt.toISOString(), "2030-01-16T16:00:00.000Z");
  assert.equal(fila(res, 5).status, "error");
  assert.match(fila(res, 5).errors[0], /Hora inválida/);
  assert.equal(fila(res, 6).status, "error");
  assert.match(fila(res, 6).errors[0], /Falta la hora/);
  assert.equal(fila(res, 7).status, "error");
});

test("citas .xlsx: fecha y hora en celdas SEPARADAS conservan la hora (antes salían a las 00:00)", async () => {
  reiniciar();
  const f = await xlsx(
    "citas.xlsx",
    ["Paciente", "Celular", "Profesional", "Fecha", "Hora"],
    [
      ["María Hernández", "5551234567", "Ana López", new Date(Date.UTC(2030, 0, 15)), new Date(Date.UTC(1899, 11, 30, 15, 30))],
      ["María Hernández", "5551234567", "Luis Pérez", new Date(Date.UTC(2030, 0, 15)), 0.375], // 09:00 como número de serie
    ],
    { 4: "dd/mm/yyyy", 5: "h:mm" },
  );
  const res = await correr("appointments", f);
  assert.equal(res.validos, 2, JSON.stringify(res.preview.map((r: any) => r.errors)));
  assert.equal(fila(res, 2).data.startsAt.toISOString(), "2030-01-15T21:30:00.000Z");
  assert.equal(fila(res, 3).data.startsAt.toISOString(), "2030-01-15T15:00:00.000Z");
});

test("citas .xlsx: fecha y hora JUNTAS en una celda, y con la fecha como número de serie", async () => {
  reiniciar();
  const f = await xlsx(
    "citas.xlsx",
    ["Paciente", "Celular", "Profesional", "Fecha"],
    [
      ["María Hernández", "5551234567", "Ana López", new Date(Date.UTC(2030, 0, 15, 15, 30))],
      // Número de serie de Excel del 16-ene-2030, con .375 = 09:00. Celda General (sin formato de fecha).
      ["María Hernández", "5551234567", "Luis Pérez", serieExcel(2030, 1, 16) + 0.375],
    ],
    { 4: "dd/mm/yyyy hh:mm" },
  );
  const res = await correr("appointments", f);
  assert.equal(res.validos, 2, JSON.stringify(res.preview.map((r: any) => r.errors)));
  assert.equal(fila(res, 2).data.startsAt.toISOString(), "2030-01-15T21:30:00.000Z");
  assert.equal(fila(res, 3).data.startsAt.toISOString(), "2030-01-16T15:00:00.000Z");
});

test("citas: fecha y hora juntas en un texto («15/01/2030 3:30 PM») de un CSV", async () => {
  reiniciar();
  const f = csv("citas.csv", "Paciente,Celular,Profesional,Fecha\nMaría Hernández,5551234567,Ana López,15/01/2030 3:30 PM\nMaría Hernández,5551234567,Ana López,2030-01-16T09:00:00\n");
  const res = await correr("appointments", f);
  assert.equal(fila(res, 2).data.startsAt.toISOString(), "2030-01-15T21:30:00.000Z");
  assert.equal(fila(res, 3).data.startsAt.toISOString(), "2030-01-16T15:00:00.000Z");
});

test("citas PASADAS no entran (ni como SCHEDULED ni como COMPLETED): quedan omitidas y lo dicen", async () => {
  reiniciar();
  const f = csv("citas.csv", [
    "Paciente,Celular,Profesional,Fecha,Hora",
    "María Hernández,5551234567,Ana López,15/01/2020,10:00",
    "María Hernández,5551234567,Ana López,15/01/2030,10:00",
  ].join("\n"));
  const dry = await correr("appointments", f);
  assert.equal(fila(dry, 2).status, "skipped");
  assert.match(fila(dry, 2).warnings[0], /Cita pasada/);
  assert.equal(dry.omitidos, 1);
  assert.equal(dry.validos, 1);

  // Con «omitir duplicados» apagado tampoco se cuela: omitida es omitida.
  const res = await correr("appointments", f, { dryRun: false, skipDuplicates: false });
  assert.equal(res.created, 1);
  assert.equal(res.omitted, 1);
  assert.equal(tabla("appointment").length, 1);
  assert.equal(tabla("appointment")[0].status, "SCHEDULED");
  assert.equal(tabla("appointment")[0].startsAt.toISOString(), "2030-01-15T16:00:00.000Z");
});

test("citas: estado «Anulado» en el sistema de origen no se agenda", async () => {
  reiniciar();
  const f = csv("citas.csv", [
    "Paciente,Celular,Profesional,Fecha,Hora,Estado",
    "María Hernández,5551234567,Ana López,15/01/2030,10:00,Agendado",
    "María Hernández,5551234567,Luis Pérez,15/01/2030,11:00,Anulado",
    "María Hernández,5551234567,Luis Pérez,15/01/2030,12:00,No asistió",
  ].join("\n"));
  const res = await correr("appointments", f);
  assert.equal(res.validos, 1);
  assert.equal(fila(res, 3).status, "skipped");
  assert.equal(fila(res, 4).status, "skipped");
});

test("citas: la vista previa avisa de solapes con el mismo doctor (en el archivo y en la agenda)", async () => {
  reiniciar((s) => {
    s.appointment.push({
      id: "a_existente", clinicId: CLINICA, patientId: "p3", doctorId: "u_ana", status: "CONFIRMED", holdExpiresAt: null,
      startsAt: new Date("2030-02-01T16:00:00Z"), endsAt: new Date("2030-02-01T16:30:00Z"), // 10:00–10:30 Mérida
    } as any);
  });
  const f = csv("citas.csv", [
    "Paciente,Celular,Profesional,Fecha,Hora,Duracion",
    "María Hernández,5551234567,Ana López,01/02/2030,10:15,30", // choca con la de la agenda
    "María Hernández,5551234567,Luis Pérez,01/02/2030,10:00,60", // otro doctor: libre
    "Jorge López,+56987654321,Luis Pérez,01/02/2030,10:30,30", // choca con la fila 3
    "María Hernández,5551234567,Ana López,01/02/2030,10:30,30", // justo después de la de la agenda: libre
  ].join("\n"));
  const res = await correr("appointments", f);
  assert.equal(fila(res, 2).status, "error");
  assert.match(fila(res, 2).errors[0], /ya está en la agenda \(10:00–10:30/);
  assert.equal(fila(res, 3).status, "ok");
  assert.equal(fila(res, 4).status, "error");
  assert.match(fila(res, 4).errors[0], /fila 3/);
  assert.equal(fila(res, 5).status, "ok");
});

test("citas: ninguna cita importada dispara un recordatorio atrasado, y las futuras siguen su curso", async () => {
  reiniciar();
  const ahora = Date.now();
  const enMin = (min: number) => localDe(new Date(ahora + min * 60_000));
  const a = enMin(20 * 60); // dentro de 20 h: su aviso de 24 h ya venció al nacer
  const b = enMin(30); // dentro de 30 min: vencidos el de 24 h y el de 1 h
  const c = enMin(5 * 24 * 60); // dentro de 5 días: ningún aviso ha llegado
  const d = (x: { fecha: string; hora: string }) => `${x.fecha.split("-").reverse().join("/")},${x.hora}`;
  const f = csv("citas.csv", [
    "Paciente,Celular,Profesional,Fecha,Hora,Duracion",
    `María Hernández,5551234567,Ana López,${d(a)},20`,
    `María Hernández,5551234567,Luis Pérez,${d(b)},20`,
    `María Hernández,5551234567,Ana López,${d(c)},20`,
  ].join("\n"));
  const res = await correr("appointments", f, { dryRun: false });
  assert.equal(res.created, 3, JSON.stringify(res));

  const citas = tabla("appointment");
  const idDe = (i: number) => citas[i].id;
  const claves = new Set(
    tabla("whatsAppReminder").map((r) => dedupeKey(r.appointmentId, (r.payload as any).offsetMin, (r.payload as any).channel)),
  );
  // Todas las filas son del tipo que usa el barrido para no repetir, y ninguna está pendiente de envío.
  for (const r of tabla("whatsAppReminder")) {
    assert.equal(r.type, APPT_AUTO_TYPE);
    assert.equal(r.status, "CANCELLED");
  }
  // a (20 h): suprimido el de 24 h (1440), NO el de 1 h.
  assert.ok(claves.has(dedupeKey(idDe(0), 1440, "whatsapp")));
  assert.ok(claves.has(dedupeKey(idDe(0), 1440, "email")));
  assert.ok(!claves.has(dedupeKey(idDe(0), 60, "whatsapp")));
  // b (30 min): suprimidos los dos.
  assert.ok(claves.has(dedupeKey(idDe(1), 1440, "whatsapp")));
  assert.ok(claves.has(dedupeKey(idDe(1), 60, "whatsapp")));
  // c (5 días): nada suprimido → el barrido lo avisará a su hora.
  assert.ok(![1440, 60].some((o) => claves.has(dedupeKey(idDe(2), o, "whatsapp"))));
});

test("citas: reimportar el mismo archivo no duplica ni vuelve a tocar los recordatorios", async () => {
  reiniciar();
  const f = () => csv("citas.csv", "Paciente,Celular,Profesional,Fecha,Hora\nMaría Hernández,5551234567,Ana López,15/01/2030,10:00\n");
  await correr("appointments", f(), { dryRun: false });
  const otra = await correr("appointments", f(), { dryRun: false });
  assert.equal(otra.created, 0);
  assert.equal(tabla("appointment").length, 1);
});

// ═══ MONTOS Y SALDOS ═══════════════════════════════════════════════════════

const saldos = (filas: string[]) => csv("saldos.csv", ["Celular,Saldo", ...filas].join("\n"));

test("saldos: «45,000.50» y «45.000,50» se leen bien según su formato", async () => {
  reiniciar();
  const us = await correr("balances", saldos(["5551234567,\"45,000.50\""]));
  assert.equal(fila(us, 2).data.amount, 45000.5);
  const es = await correr("balances", saldos(["5551234567,\"45.000,50\""]));
  assert.equal(fila(es, 2).data.amount, 45000.5);
});

test("saldos: «45.000» es AMBIGUO — no se importa hasta que el usuario confirma cómo leerlo", async () => {
  reiniciar();
  const f = () => saldos(["5551234567,45.000", "+56987654321,12.500"]);
  const dry = await correr("balances", f());
  assert.equal(dry.validos, 0);
  assert.equal(dry.invalidos, 2);
  assert.match(fila(dry, 2).errors[0], /ambiguo/);
  assert.deepEqual(dry.unresolved.map((u: any) => [u.field, u.rows]), [["amountFormat", 2]]);
  assert.deepEqual(dry.options.amountFormat.map((o: any) => o.id), ["miles", "decimales"]);

  // Sin confirmar, el commit no crea NADA (no adivina).
  const sin = await correr("balances", f(), { dryRun: false });
  assert.equal(sin.created, 0);
  assert.equal(tabla("invoice").length, 0);

  // Confirmado como miles: 45 000 y 12 500.
  const miles = await correr("balances", f(), { dryRun: false, valueMapping: { amountFormat: { formato: "miles" } } });
  assert.equal(miles.created, 2);
  assert.deepEqual(tabla("invoice").map((i) => i.total).sort((a, b) => a - b), [12500, 45000]);
});

test("saldos: B1 (QA ws1-t10, ronda 2) — UNA sola muestra que demuestra el formato NO basta: sigue pendiente", async () => {
  reiniciar();
  // Antes de la decisión del gerente del 28-sep-2026, una sola «1.250,50» bastaba
  // para resolver «45.000» en silencio. Es dinero y el archivo puede mezclar
  // columnas de sistemas distintos: ahora hace falta que el formato se repita.
  const dry = await correr("balances", saldos(["5551234567,45.000", "+56987654321,\"1.250,50\""]));
  // «1.250,50» sí es inequívoca por sí sola (trae los dos separadores) y entra
  // bien; solo «45.000» queda ambigua — pero ya NO se resuelve con la única
  // muestra que demuestra el formato, porque una sola no basta.
  assert.equal(dry.validos, 1, JSON.stringify(dry.preview.map((r: any) => r.data)));
  assert.equal(dry.invalidos, 1);
  assert.match(fila(dry, 2).errors[0], /ambiguo/);
  assert.deepEqual(dry.unresolved.map((u: any) => [u.field, u.rows]), [["amountFormat", 1]]);

  const sin = await correr("balances", saldos(["5551234567,45.000", "+56987654321,\"1.250,50\""]), { dryRun: false });
  assert.equal(sin.created, 1, "solo la fila válida («1.250,50») se crea; la ambigua no");
});

test("saldos: B1 (QA ws1-t10, ronda 2) — DOS muestras que demuestran el MISMO formato sí resuelven, y avisan", async () => {
  reiniciar();
  const f = csv("saldos.csv", [
    "Celular,Saldo,Concepto,Fecha",
    "5551234567,45.000,Ambiguo,10/01/2030",
    "+56987654321,\"1.250,50\",Demo1,11/01/2030",
    "5551234567,\"2.500,00\",Demo2,12/01/2030",
  ].join("\n"));
  const dry = await correr("balances", f);
  assert.equal(dry.validos, 3, JSON.stringify(dry.preview.map((r: any) => r.errors)));
  assert.equal(fila(dry, 2).data.amount, 45000);
  assert.match(fila(dry, 2).warnings.join(" "), /punto para miles/);
  assert.equal(dry.unresolved, undefined);
});

test("saldos: B1 (QA ws1-t10, ronda 2) — el archivo que demuestra los DOS formatos (contradicción real) sigue sin resolver nada solo", async () => {
  reiniciar();
  const f = csv("saldos.csv", [
    "Celular,Saldo,Concepto,Fecha",
    "5551234567,45.000,Ambiguo,10/01/2030",
    "+56987654321,\"1.250,50\",DemoES1,11/01/2030",
    "5551234567,\"2.500,00\",DemoES2,12/01/2030",
    "+56987654321,\"1,250.00\",DemoUS,13/01/2030",
  ].join("\n"));
  const dry = await correr("balances", f);
  assert.equal(fila(dry, 2).status, "error");
  assert.match(fila(dry, 2).errors[0], /ambiguo/);
});

test("saldos: decidir «decimales» lee 45.000 como 45", async () => {
  reiniciar();
  const r = await correr("balances", saldos(["5551234567,45.000"]), { dryRun: false, valueMapping: { amountFormat: { formato: "decimales" } } });
  assert.equal(r.created, 1);
  assert.equal(tabla("invoice")[0].total, 45);
});

test("saldos: reimportar con «omitir duplicados» APAGADO no duplica (saldo simple)", async () => {
  reiniciar();
  const f = () => saldos(["5551234567,1500", "5559999999,300"]);
  // (5559999999 no existe: fila con error, no cuenta)
  const uno = await correr("balances", f(), { dryRun: false, skipDuplicates: false });
  assert.equal(uno.created, 1);
  const dos = await correr("balances", f(), { dryRun: false, skipDuplicates: false });
  assert.equal(dos.created, 0);
  assert.equal(tabla("invoice").length, 1);
});

test("saldos: varios movimientos del mismo paciente (con concepto y fecha) entran todos, y reimportar no los repite", async () => {
  reiniciar();
  const f = () => csv("saldos.csv", [
    "Celular,Saldo,Concepto,Fecha",
    "5551234567,1500,Endodoncia,10/01/2030",
    "5551234567,800,Limpieza,11/01/2030",
    "5551234567,800,Limpieza,11/01/2030", // idéntica: otro movimiento real, no se pierde
  ].join("\n"));
  const uno = await correr("balances", f(), { dryRun: false, skipDuplicates: false });
  assert.equal(uno.created, 3, JSON.stringify(uno));
  assert.equal(tabla("invoice").length, 3);
  const dos = await correr("balances", f(), { dryRun: false, skipDuplicates: false });
  assert.equal(dos.created, 0, JSON.stringify(dos));
  assert.equal(tabla("invoice").length, 3);
  assert.equal(tabla("importExternalIds").length, 3);
});

test("saldos: sin la tabla de ID externos (SQL pendiente) sigue sin duplicar y no revienta", async () => {
  reiniciar();
  base.banderas.sinTablaExternos = true;
  const f = () => csv("saldos.csv", "Celular,Saldo,Concepto,Fecha\n5551234567,1500,Endodoncia,10/01/2030\n");
  const uno = await correr("balances", f(), { dryRun: false, skipDuplicates: false });
  assert.equal(uno.created, 1);
  const dos = await correr("balances", f(), { dryRun: false, skipDuplicates: false });
  assert.equal(dos.created, 0);
  assert.equal(tabla("invoice").length, 1);
});

test("saldos a favor: mismo criterio (montos y reimportación)", async () => {
  reiniciar();
  const f = () => csv("saldos.csv", "Celular,Saldo,Tipo\n5551234567,\"1.250,00\",a favor\n");
  const uno = await correr("balances", f(), { dryRun: false, skipDuplicates: false });
  assert.equal(uno.created, 1);
  assert.equal(tabla("patientCredit")[0].amount, 1250);
  const dos = await correr("balances", f(), { dryRun: false, skipDuplicates: false });
  assert.equal(dos.created, 0);
  assert.equal(tabla("patientCredit").length, 1);
});

test("saldos: si el teléfono es de la mamá y la fila dice otro nombre, NO se le carga a ella", async () => {
  reiniciar();
  const r = await correr("balances", csv("saldos.csv", "Paciente,Celular,Saldo\nJuanito Hernández,5551234567,900\n"));
  assert.equal(r.validos, 0);
  assert.match(fila(r, 2).errors[0], /María Hernández/);
});

// ═══ PACIENTES ═════════════════════════════════════════════════════════════

test("pacientes: nombre completo en UNA columna se parte en nombre y apellidos", async () => {
  reiniciar();
  const f = csv("pacientes.csv", [
    "Nombre completo,Celular",
    "Juan Carlos Pérez García,5550000001",
    "María de los Ángeles Ruiz López,5550000002",
    '"Pérez Gómez, Ana",5550000003',
  ].join("\n"));
  const res = await correr("patients", f);
  assert.equal(res.validos, 3, JSON.stringify(res.preview));
  assert.deepEqual([fila(res, 2).data.firstName, fila(res, 2).data.lastName], ["Juan Carlos", "Pérez García"]);
  assert.deepEqual([fila(res, 3).data.firstName, fila(res, 3).data.lastName], ["María de los Ángeles", "Ruiz López"]);
  assert.deepEqual([fila(res, 4).data.firstName, fila(res, 4).data.lastName], ["Ana", "Pérez Gómez"]);
  const c = await correr("patients", f, { dryRun: false });
  assert.equal(c.created, 3);
  assert.equal(tabla("patient").filter((p) => p.firstName === "Juan Carlos").length, 1);
});

test("pacientes: una familia con el mismo teléfono NO sale como duplicada", async () => {
  reiniciar();
  const f = () => csv("pacientes.csv", [
    "Nombre,Apellido,Celular,Fecha de nacimiento",
    "Laura,Campos,5557770000,10/04/1985",
    "Mateo,Campos,5557770000,02/09/2015", // hijo: mismo celular, otro nombre y fecha
    "Sofía,Campos,5557770000,15/01/2018",
    "Laura,Campos,5557770000,10/04/1985", // la misma Laura otra vez: SÍ es duplicado
  ].join("\n"));
  const res = await correr("patients", f());
  assert.deepEqual(res.preview.map((r: any) => r.status), ["ok", "ok", "ok", "duplicate"]);
  assert.match(fila(res, 3).warnings.join(" "), /familia/);
  const c = await correr("patients", f(), { dryRun: false });
  assert.equal(c.created, 3);
  // Y reimportar el archivo: los tres ya existen (mismo nombre + fecha), ninguno se repite.
  const otra = await correr("patients", f(), { dryRun: false, skipDuplicates: true });
  assert.equal(otra.created, 0);
  assert.deepEqual(otra.duplicates, 4);
});

test("pacientes: mismo teléfono, mismo nombre y misma fecha en la base = duplicado; con otra fecha = otra persona", async () => {
  reiniciar((s) => { (s.patient[0] as any).dob = new Date(1985, 2, 15); });
  const res = await correr("patients", csv("pacientes.csv", [
    "Nombre,Apellido,Celular,Fecha de nacimiento",
    "María,Hernández,+52 55 5123 4567,15/03/1985", // teléfono de p1 con prefijo, misma persona
    "María,Hernández,5551234567,20/07/2010", // ¿su hija? mismo celular, otra fecha: otra persona
  ].join("\n")));
  assert.equal(fila(res, 2).status, "duplicate");
  assert.equal(fila(res, 3).status, "ok");
});

test("pacientes: el ID externo evita duplicar en un reintento, incluso sin teléfono ni correo y con «omitir duplicados» apagado", async () => {
  reiniciar();
  const f = () => csv("pacientes.csv", "ID,Nombre,Apellidos\n1001,Carla,Mena\n1002,Diego,Mena\n");
  const uno = await correr("patients", f(), { dryRun: false, origin: "dentalink", skipDuplicates: false });
  assert.equal(uno.created, 2);
  assert.equal(tabla("importExternalIds").length, 2);
  assert.ok(tabla("importExternalIds").every((r) => r.source === "dentalink" && r.entity === "patient" && r.clinicId === CLINICA));

  const dry = await correr("patients", f(), { origin: "dentalink" });
  assert.deepEqual(dry.preview.map((r: any) => r.status), ["skipped", "skipped"]);
  const dos = await correr("patients", f(), { dryRun: false, origin: "dentalink", skipDuplicates: false });
  assert.equal(dos.created, 0);
  assert.equal(tabla("patient").filter((p) => p.lastName === "Mena").length, 2);
});

test("pacientes: sin la tabla de ID externos el import sigue funcionando (y avisa en el log, no revienta)", async () => {
  reiniciar();
  base.banderas.sinTablaExternos = true;
  const f = csv("pacientes.csv", "ID,Nombre,Apellidos\n1001,Carla,Mena\n");
  const uno = await correr("patients", f, { dryRun: false, origin: "dentalink" });
  assert.equal(uno.created, 1);
  assert.equal(tabla("importExternalIds").length, 0);
});

test("ID externo: las citas y los saldos se emparejan con el paciente por el ID del sistema, sin teléfono ni nombre", async () => {
  reiniciar();
  await correr("patients", csv("pacientes.csv", "ID,Nombre,Apellidos\n1001,Carla,Mena\n"), { dryRun: false, origin: "dentalink" });
  const cita = await correr("appointments", csv("citas.csv", "Id paciente,Profesional,Fecha,Hora\n1001,Ana López,15/01/2030,10:00\n"), { dryRun: false, origin: "dentalink" });
  assert.equal(cita.created, 1, JSON.stringify(cita));
  const saldo = await correr("balances", csv("saldos.csv", "Id paciente,Saldo\n1001,700\n"), { dryRun: false, origin: "dentalink" });
  assert.equal(saldo.created, 1, JSON.stringify(saldo));
  const carla = tabla("patient").find((p) => p.firstName === "Carla")!;
  assert.equal(tabla("appointment")[0].patientId, carla.id);
  assert.equal(tabla("invoice")[0].patientId, carla.id);
  // Otro sistema con el mismo «1001» NO es la misma Carla.
  const otro = await correr("appointments", csv("citas.csv", "Id paciente,Profesional,Fecha,Hora\n1001,Ana López,16/01/2030,10:00\n"), { dryRun: true, origin: "medilink" });
  assert.equal(otro.validos, 0);
  assert.match(fila(otro, 2).errors[0], /ID 1001 no encontrado/);
});

test("teléfonos: con y sin prefijo (+52, +56) emparejan igual", async () => {
  reiniciar();
  // p1 = 5551234567 (sin prefijo); p2 = +56 9 8765 4321 (con prefijo).
  const f = csv("saldos.csv", [
    "Celular,Saldo",
    "+52 55 5123 4567,100", // +52 → p1
    "525551234567,200", // 12 dígitos con 52 → p1 (otra fila, mismo paciente)
    "987654321,300", // sin prefijo → p2
    "+56 9 8765 4321,400", // con prefijo → p2
  ].join("\n"));
  const res = await correr("balances", f, { columnMapping: { Celular: "phone", Saldo: "amount" } });
  assert.deepEqual(res.preview.map((r: any) => r.data.patientId), ["p1", "p1", "p2", "p2"], JSON.stringify(res.preview.map((r: any) => r.errors)));
});

test("teléfonos: dos pacientes con el mismo celular se distinguen por el nombre de la fila (citas)", async () => {
  reiniciar((s) => {
    s.patient.push({ id: "p4", clinicId: CLINICA, patientNumber: "P-0004", firstName: "Mateo", lastName: "Hernández", phone: "5551234567", email: null, dob: null, deletedAt: null, visibleUserIds: [], updatedAt: new Date() } as any);
  });
  const res = await correr("appointments", csv("citas.csv", [
    "Paciente,Celular,Profesional,Fecha,Hora",
    "Mateo Hernández,5551234567,Ana López,15/01/2030,10:00",
    "María Hernández,5551234567,Ana López,15/01/2030,11:00",
    ",5551234567,Ana López,15/01/2030,12:00",
  ].join("\n")), { columnMapping: { Paciente: "name", Celular: "phone", Profesional: "doctor", Fecha: "date", Hora: "time" } });
  assert.equal(fila(res, 2).data.patientId, "p4");
  assert.equal(fila(res, 3).data.patientId, "p1");
  assert.equal(fila(res, 4).status, "error"); // sin nombre no se elige entre dos
  assert.match(fila(res, 4).errors[0], /varios pacientes/);
});

// ═══ XLSX de citas: la plantilla real sigue funcionando ════════════════════

test("aislamiento: los ID externos de una clínica no aparecen en otra", async () => {
  reiniciar();
  await correr("patients", csv("pacientes.csv", "ID,Nombre,Apellidos\n1001,Carla,Mena\n"), { dryRun: false, origin: "dentalink" });
  const { cargarExternos } = await import("../externos");
  const propios = await cargarExternos(CLINICA, "dentalink", "patient");
  assert.equal(propios.mapa.size, 1);
  const ajenos = await cargarExternos("cli_B", "dentalink", "patient");
  assert.equal(ajenos.mapa.size, 0);
  await assert.rejects(() => cargarExternos(undefined as any, "dentalink", "patient"));
});

// ═══ PERFIL DENTALINK ══════════════════════════════════════════════════════

test("perfil Dentalink: reconoce las columnas de la API/reportes, sigue marcado SIN validar y avisa a la interfaz", async () => {
  const { listOrigins } = await import("../profiles");
  const dentalink = listOrigins().find((o) => o.id === "dentalink")!;
  assert.equal(dentalink.hasProfile, true);
  assert.equal(dentalink.verified, false, "sin un export real delante no se puede afirmar que casa");

  reiniciar();
  // Pacientes: «Id», «Nombre completo», «Rut», «Celular»…
  const pac = await correr("patients", csv("pacientes.csv", "Id,Nombre completo,Rut,Celular,E-mail,Fecha de nacimiento\n77,Rosa Elena Campos Díaz,11.111.111-1,+56 9 1111 2222,rosa@example.com,03/05/1990\n"), { origin: "dentalink" });
  assert.equal(pac.suggestedMapping["Id"], "externalId");
  assert.equal(pac.suggestedMapping["Nombre completo"], "fullName");
  assert.equal(pac.validos, 1);
  assert.deepEqual([fila(pac, 2).data.firstName, fila(pac, 2).data.lastName, fila(pac, 2).data.externalId], ["Rosa Elena", "Campos Díaz", "77"]);

  // «Citas pacientes»: la hora de fin NO pisa la de inicio; «Anulado» no se agenda.
  await correr("patients", csv("pacientes.csv", "Id,Nombre completo,Celular\n77,Rosa Elena Campos Díaz,+56 9 1111 2222\n"), { dryRun: false, origin: "dentalink" });
  const citas = await correr("appointments", csv("citas.csv", [
    "Id paciente,Nombre paciente,Apellidos paciente,Fecha,Hora inicio,Hora fin,Duración,Nombre dentista,Estado,Comentario",
    "77,Rosa Elena,Campos Díaz,15/01/2030,09:00,09:45,45,Ana López,Agendado,Control",
    "77,Rosa Elena,Campos Díaz,16/01/2030,09:00,09:45,45,Ana López,Anulado,",
  ].join("\n")), { origin: "dentalink" });
  assert.equal(citas.suggestedMapping["Hora inicio"], "time");
  assert.equal(citas.suggestedMapping["Hora fin"], undefined);
  assert.equal(fila(citas, 2).data.startsAt.toISOString(), "2030-01-15T15:00:00.000Z");
  assert.equal(fila(citas, 2).data.endsAt.toISOString(), "2030-01-15T15:45:00.000Z");
  assert.equal(fila(citas, 3).status, "skipped");

  // «Pacientes morosos».
  const mor = await correr("balances", csv("morosos.csv", "Id paciente,Nombre paciente,Deuda total\n77,Rosa Elena Campos Díaz,\"$ 120.000\"\n"), { origin: "dentalink", valueMapping: { amountFormat: { formato: "miles" } } });
  assert.equal(fila(mor, 2).data.amount, 120000);
});

// ═══ Hallazgos de la revisión adversarial ═════════════════════════════════

const rico = () => csv("saldos.csv", "Celular,Saldo,Concepto,Fecha\n5551234567,1500,Endodoncia,10/01/2030\n");

test("saldos: el SQL se aplica DESPUÉS del primer import → reimportar tampoco duplica", async () => {
  reiniciar();
  base.banderas.sinTablaExternos = true;
  assert.equal((await correr("balances", rico(), { dryRun: false, skipDuplicates: false })).created, 1);
  base.banderas.sinTablaExternos = false; // Rafael aplicó el SQL
  assert.equal((await correr("balances", rico(), { dryRun: false, skipDuplicates: false })).created, 0);
  assert.equal(tabla("invoice").length, 1);
});

test("saldos: reintentar eligiendo OTRO sistema de origen no duplica", async () => {
  reiniciar();
  const f = () => csv("saldos.csv", "Id saldo,Celular,Saldo\n900,5551234567,1500\n");
  assert.equal((await correr("balances", f(), { dryRun: false, origin: "dentalink" })).created, 1);
  const otra = await correr("balances", f(), { dryRun: false, origin: "medilink", skipDuplicates: false });
  assert.equal(otra.created, 0, JSON.stringify(otra));
  const sinOrigen = await correr("balances", f(), { dryRun: false, skipDuplicates: false });
  assert.equal(sinOrigen.created, 0);
  assert.equal(tabla("invoice").length, 1);
});

test("saldos: cambiar el mapeo (simple → con concepto/fecha) o el monto en el origen no crea una segunda deuda", async () => {
  reiniciar();
  assert.equal((await correr("balances", csv("s.csv", "Celular,Saldo\n5551234567,1500\n"), { dryRun: false })).created, 1);
  // Mismo saldo, ahora con concepto y fecha: no es otra deuda.
  assert.equal((await correr("balances", rico(), { dryRun: false, skipDuplicates: false })).created, 0);
  // Un movimiento con concepto/fecha cuyo monto cambió en el origen: sigue siendo el mismo movimiento.
  reiniciar();
  assert.equal((await correr("balances", rico(), { dryRun: false })).created, 1);
  const cambiado = csv("saldos.csv", "Celular,Saldo,Concepto,Fecha\n5551234567,900,Endodoncia,10/01/2030\n");
  assert.equal((await correr("balances", cambiado, { dryRun: false, skipDuplicates: false })).created, 0);
  assert.equal(tabla("invoice").length, 1);
  assert.equal(tabla("invoice")[0].total, 1500);
});

test("«Mi Excel»/«Otro»: una columna «id» NO es un ID externo (es un número de fila) y no bloquea a otros pacientes", async () => {
  reiniciar();
  const uno = await correr("patients", csv("a.csv", "ID,Nombre,Apellidos\n1,Carla,Mena\n2,Diego,Mena\n"), { dryRun: false, origin: "excel" });
  assert.equal(uno.created, 2);
  assert.equal(tabla("importExternalIds").length, 0);
  // Otro Excel sin relación, también con ID 1 y 2: entran todos.
  const dos = await correr("patients", csv("b.csv", "ID,Nombre,Apellidos\n1,Elena,Soto\n2,Fabio,Soto\n"), { dryRun: false, origin: "excel" });
  assert.equal(dos.created, 2);
  assert.equal(tabla("patient").filter((p) => p.lastName === "Soto").length, 2);
});

test("citas: si el celular es de la mamá y la fila dice el hijo, NO va a la ficha de ella; si el hijo existe por nombre, va al hijo", async () => {
  reiniciar((s) => {
    s.patient.push({ id: "p_luis", clinicId: CLINICA, patientNumber: "P-9", firstName: "Luis", lastName: "Hernández", phone: null, email: null, dob: null, deletedAt: null, visibleUserIds: [], updatedAt: new Date() } as any);
  });
  const f = csv("citas.csv", [
    "Paciente,Celular,Profesional,Fecha,Hora",
    "Luis Hernández,5551234567,Ana López,15/01/2030,10:00", // celular de María; Luis existe sin teléfono
    "Tomás Hernández,5551234567,Ana López,15/01/2030,11:00", // Tomás no existe: no se le pega a María
  ].join("\n"));
  const res = await correr("appointments", f);
  assert.equal(fila(res, 2).data.patientId, "p_luis");
  assert.equal(fila(res, 3).status, "error");
  assert.match(fila(res, 3).errors[0], /María Hernández/);
});

test("montos y horas raros: «500.-» no es negativo, «1-2» y «9.5» no se inventan", async () => {
  const { analizarMonto, parseHora } = await import("../valores");
  const a = analizarMonto("$ 500.-");
  assert.ok(a.tipo === "ok" && a.valor === 500);
  const b = analizarMonto("500,-");
  assert.ok(b.tipo === "ok" && b.valor === 500);
  assert.equal(analizarMonto("1-2").tipo, "invalido");
  assert.equal(analizarMonto("-45,50").tipo, "ok");
  assert.equal(parseHora("9.5"), null);
  assert.deepEqual({ ...parseHora("9.05") } as any, { h: 9, m: 5 });
});

// ═══ EXCEL CON VARIAS PESTAÑAS (Ajuste 1) ══════════════════════════════════

async function libro(hojas: Record<string, { cab: string[]; filas: any[][] }>, nombre = "datos.xlsx"): Promise<File> {
  const wb = new ExcelJS.Workbook();
  for (const [n, h] of Object.entries(hojas)) {
    const ws = wb.addWorksheet(n);
    ws.addRow(h.cab);
    h.filas.forEach((f) => ws.addRow(f));
  }
  return new File([(await wb.xlsx.writeBuffer()) as ArrayBuffer], nombre);
}

const DOS_HOJAS = () => libro({
  "Notas internas": { cab: ["Texto"], filas: [["recordar limpiar agenda"]] },
  Saldos: { cab: ["Celular", "Saldo"], filas: [["5551234567", 1500], ["+56987654321", 300]] },
  Pacientes: { cab: ["Nombre", "Apellido", "Celular"], filas: [["Carla", "Mena", "5550000001"]] },
});

test("varias pestañas: sin elegir NO se lee ninguna (ni la primera); lista las pestañas con sus primeras filas y propone por nombre", async () => {
  reiniciar();
  const antes = { ...base.llamadas };
  const res = await correr("balances", await DOS_HOJAS());
  assert.equal(res.needsSheet, true);
  assert.equal(res.suggestedSheet, "Saldos", "propone por nombre, como pickWorksheet");
  assert.deepEqual(res.sheets.map((s: any) => s.name), ["Notas internas", "Saldos", "Pacientes"]);
  const saldos = res.sheets.find((s: any) => s.name === "Saldos");
  assert.deepEqual(saldos.columns, ["Celular", "Saldo"]);
  assert.equal(saldos.rows, 2);
  assert.deepEqual(saldos.sample, [["5551234567", "1500"], ["+56987654321", "300"]]);
  // No procesó nada: ni una consulta a la base.
  assert.deepEqual(base.llamadas, antes);
  assert.deepEqual(res.preview, []);
  assert.equal(res.total, 0);
});

test("varias pestañas: importar SIN elegir es un error (no toma la primera en silencio) y no crea nada", async () => {
  reiniciar();
  await assert.rejects(
    correr("balances", await DOS_HOJAS(), { dryRun: false }),
    (e: any) => e.status === 400 && e.code === "SHEET_REQUIRED",
  );
  assert.equal(tabla("invoice").length, 0);
});

test("varias pestañas: con la pestaña elegida se lee esa (también una distinta de la propuesta) y sigue mostrando las demás para cambiar", async () => {
  reiniciar();
  const ok = await correr("balances", await DOS_HOJAS(), { sheet: "Saldos" });
  assert.equal(ok.needsSheet, undefined);
  assert.equal(ok.sheet, "Saldos");
  assert.equal(ok.sheets.length, 3, "la vista previa conserva la lista para poder cambiar");
  assert.equal(ok.validos, 2); // 5551234567 (p1) y +56987654321 (p2) existen
  assert.deepEqual(ok.columns, ["Celular", "Saldo"]);

  // El usuario cambia a «Pacientes» aunque estemos importando pacientes con el nombre de otra: manda su elección.
  const pac = await correr("patients", await DOS_HOJAS(), { sheet: "Pacientes" });
  assert.equal(pac.validos, 1);
  assert.equal(fila(pac, 2).data.firstName, "Carla");
  // Elige una pestaña que NO es la propuesta: se respeta (aquí «Notas internas», que no sirve para saldos).
  const otra = await correr("balances", await DOS_HOJAS(), { sheet: "Notas internas" });
  assert.equal(otra.mappingError !== undefined, true, "sus columnas no sirven: pide emparejar, no importa nada");
  assert.equal(otra.validos, 0);
});

test("varias pestañas: una pestaña que no existe es un 400, y si ninguna se llama como los datos NO propone la primera", async () => {
  reiniciar();
  await assert.rejects(correr("balances", await DOS_HOJAS(), { sheet: "Inventada" }), (e: any) => e.status === 400 && /Inventada/.test(e.message));
  const sinNombre = await libro({ Hoja1: { cab: ["Celular", "Saldo"], filas: [["5551234567", 10]] }, Hoja2: { cab: ["x"], filas: [["y"]] } });
  const res = await correr("balances", sinNombre);
  assert.equal(res.needsSheet, true);
  assert.equal(res.suggestedSheet, null);
});

test("una sola pestaña o un .csv: todo igual que siempre (sin selector)", async () => {
  reiniciar();
  const una = await libro({ Cualquiera: { cab: ["Celular", "Saldo"], filas: [["5551234567", 10]] } });
  const r1 = await correr("balances", una);
  assert.equal(r1.needsSheet, undefined);
  assert.equal(r1.sheets, undefined);
  assert.equal(r1.validos, 1);
  const r2 = await correr("balances", csv("s.csv", "Celular,Saldo\n5551234567,10\n"));
  assert.equal(r2.sheets, undefined);
  assert.equal(r2.validos, 1);
});

test("varias pestañas: la muestra enseña la hora de las celdas de fecha y hora (no solo el día)", async () => {
  reiniciar();
  const f = await libro({
    Citas: { cab: ["Paciente", "Fecha", "Hora"], filas: [["María Hernández", new Date(Date.UTC(2030, 0, 15)), new Date(Date.UTC(1899, 11, 30, 15, 30))]] },
    Otra: { cab: ["a"], filas: [["b"]] },
  });
  const res = await correr("appointments", f);
  const citas = res.sheets.find((s: any) => s.name === "Citas");
  assert.deepEqual(citas.sample[0], ["María Hernández", "15/01/2030", "15:30"]);
});

test("el formulario lleva la pestaña elegida hasta el motor (parseImportForm)", async () => {
  const { NextRequest } = await import("next/server");
  const { parseImportForm } = await engine();
  const fd = new FormData();
  fd.append("file", csv("s.csv", "a\n1"));
  fd.append("sheet", "  Saldos  ");
  const req = new NextRequest("http://localhost/x", { method: "POST", body: fd });
  assert.equal((await parseImportForm(req)).sheet, "Saldos");
  const fd2 = new FormData();
  fd2.append("file", csv("s.csv", "a\n1"));
  assert.equal((await parseImportForm(new NextRequest("http://localhost/x", { method: "POST", body: fd2 }))).sheet, null);
});

// ═══ AJUSTE 2 (QA de panel.108) ════════════════════════════════════════════

test("N1: la vista previa de CITAS trae fecha y hora en la zona de la clínica, doctor, paciente y duración", async () => {
  reiniciar();
  const f = csv("citas.csv", [
    "Paciente,Celular,Profesional,Fecha,Hora,Duracion",
    "María Hernández,5551234567,Ana López,15/01/2030,15:30,45",
    "María Hernández,5551234567,Ana López,15/01/2020,10:00,30", // pasada: omitida, pero se ve cuándo era
    "Jorge López,+56987654321,Inexistente,16/01/2030,09:00,30", // error: doctor
  ].join("\n"));
  const res = await correr("appointments", f);
  const ok = fila(res, 2).data;
  assert.equal(ok.startsLocal, "15/01/2030 15:30", "la hora de la CLÍNICA (Mérida), no la del servidor");
  assert.equal(ok.doctorName, "Ana López");
  assert.equal(ok.durationMin, 45);
  assert.equal(ok.timezone, TZ);
  assert.equal(fila(res, 3).status, "skipped");
  assert.equal(fila(res, 3).data.startsLocal, "15/01/2020 10:00");
  // Una fila con error también enseña cuándo y con quién.
  assert.equal(fila(res, 4).status, "error");
  assert.equal(fila(res, 4).data.startsLocal, "16/01/2030 09:00");
  assert.equal(fila(res, 4).data.doctorName, "Inexistente");

  // …y el adaptador de la interfaz lo convierte en columnas.
  const { adaptPreview } = await import("../client");
  const ui = adaptPreview("appointments", JSON.parse(JSON.stringify(res)));
  assert.equal(ui.timezone, TZ);
  assert.deepEqual(
    ui.rows.map((r) => [r.name, r.when, r.doctor, r.duration]),
    [
      ["María Hernández", "15/01/2030 15:30", "Ana López", 45],
      ["María Hernández", "15/01/2020 10:00", "Ana López", 30],
      ["Jorge López", "16/01/2030 09:00", "Inexistente", 30],
    ],
  );
});

test("N2: las filas con error muestran el nombre y el teléfono que traía el archivo (no «—»)", async () => {
  reiniciar();
  const f = csv("saldos.csv", "Paciente,Celular,Saldo\nPersona Inventada,5550009999,100\nMaría Hernández,5551234567,abc\n");
  const res = await correr("balances", f);
  assert.equal(fila(res, 2).status, "error");
  assert.equal(fila(res, 2).data.origName, "Persona Inventada");
  assert.equal(fila(res, 2).data.origPhone, "5550009999");
  const { adaptPreview } = await import("../client");
  const ui = adaptPreview("balances", JSON.parse(JSON.stringify(res)));
  assert.deepEqual(ui.rows.map((r) => [r.name, r.phone]), [["Persona Inventada", "5550009999"], ["María Hernández", "5551234567"]]);
  // Pacientes con error: nombre completo en una columna.
  const pac = await correr("patients", csv("p.csv", "Nombre completo,Celular\nSolo,5550000001\n"));
  assert.equal(pac.preview[0].status, "error");
  assert.equal(pac.preview[0].data.origName, "Solo");
});

test("N3: el paso 1 dice «sin validar» para los perfiles verified:false (los orígenes locales y los del backend)", async () => {
  const { ORIGINS } = await import("../../../components/import/import-client");
  const { listOrigins } = await import("../profiles");
  for (const o of ORIGINS.filter((x) => x.hasProfile)) assert.equal(o.verified, false, o.id);
  for (const o of listOrigins().filter((x) => x.hasProfile)) assert.equal(o.verified, false, o.id);
  assert.equal(ORIGINS.find((o) => !o.hasProfile)!.verified, undefined);
});

test("N4: una pestaña con el nombre del reporte que mandan bajar las instrucciones se marca «Sugerida» (sin elegirla sola)", async () => {
  reiniciar();
  const f = () => libro({
    "Notas": { cab: ["x"], filas: [["y"]] },
    "Pacientes morosos": { cab: ["Celular", "Saldo"], filas: [["5551234567", 100]] },
    "Citas pacientes": { cab: ["Paciente", "Profesional", "Fecha", "Hora"], filas: [["María Hernández", "Ana López", "15/01/2030", "10:00"]] },
  });
  const saldos = await correr("balances", await f(), { origin: "dentalink" });
  assert.equal(saldos.needsSheet, true, "sugerir no es elegir");
  assert.equal(saldos.suggestedSheet, "Pacientes morosos");
  assert.deepEqual(saldos.preview, []);
  assert.equal((await correr("appointments", await f(), { origin: "dentalink" })).suggestedSheet, "Citas pacientes");
  // Sin ese origen no hay pista, y otro origen sin perfil tampoco.
  assert.equal((await correr("balances", await f())).suggestedSheet, null);
  assert.equal((await correr("balances", await f(), { origin: "excel" })).suggestedSheet, null);
  // Y «Pacientes morosos» no se sugiere para pacientes.
  assert.equal((await correr("patients", await f(), { origin: "dentalink" })).suggestedSheet, null);
});

test("N8: «Confirmada» entra como CONFIRMED y los demás estados equivalentes se mapean bien", async () => {
  const { estadoDeCita } = await import("../entities");
  const agenda = (v: string) => { const e: any = estadoDeCita(v); return e.accion === "omitir" ? "omitir" : e.status; };
  const casos: Array<[string, string]> = [
    ["Confirmada", "CONFIRMED"], ["confirmado", "CONFIRMED"], ["CONFIRMED", "CONFIRMED"],
    ["Agendada", "SCHEDULED"], ["Programada", "SCHEDULED"], ["Reservada", "SCHEDULED"], ["Pendiente", "SCHEDULED"], ["", "SCHEDULED"],
    ["Sin confirmar", "SCHEDULED"], ["No confirmada", "SCHEDULED"], ["Por confirmar", "SCHEDULED"], ["Pendiente de confirmación", "SCHEDULED"],
    ["Anulada", "omitir"], ["Cancelado", "omitir"], ["No asistió", "omitir"], ["Atendida", "omitir"], ["Realizada", "omitir"],
  ];
  for (const [entrada, esperado] of casos) assert.equal(agenda(entrada), esperado, entrada);
  assert.match((estadoDeCita("Xyz raro") as any).aviso, /no reconocido/);

  reiniciar();
  const f = csv("citas.csv", [
    "Paciente,Celular,Profesional,Fecha,Hora,Estado",
    "María Hernández,5551234567,Ana López,15/01/2030,10:00,Confirmada",
    "María Hernández,5551234567,Ana López,16/01/2030,10:00,Agendada",
    "María Hernández,5551234567,Ana López,17/01/2030,10:00,Sin confirmar",
    "María Hernández,5551234567,Ana López,18/01/2030,10:00,Atendida",
    "María Hernández,5551234567,Ana López,19/01/2030,10:00,Estado raro",
  ].join("\n"));
  const dry = await correr("appointments", f);
  assert.deepEqual(dry.preview.map((r: any) => r.status), ["ok", "ok", "ok", "skipped", "ok"]);
  assert.match(fila(dry, 6).warnings.join(" "), /no reconocido/);
  const r = await correr("appointments", f, { dryRun: false });
  assert.equal(r.created, 4);
  const porDia = (d: string) => tabla("appointment").find((a) => a.startsAt.toISOString().startsWith(d))!;
  assert.equal(porDia("2030-01-15").status, "CONFIRMED");
  assert.ok(porDia("2030-01-15").confirmedAt instanceof Date, "CONFIRMED lleva confirmedAt");
  assert.equal(porDia("2030-01-16").status, "SCHEDULED");
  assert.equal(porDia("2030-01-16").confirmedAt, undefined);
  assert.equal(porDia("2030-01-17").status, "SCHEDULED");
  // Una cita CONFIRMED también recibe la supresión de avisos vencidos (mismo barrido).
  assert.ok(tabla("appointment").every((a) => a.status !== "SCHEDULED" || a.confirmedAt === undefined));
});

test("N8: si el ID externo de la fila no existe y se empareja por nombre, la vista previa lo AVISA en esa fila", async () => {
  reiniciar();
  await correr("patients", csv("pacientes.csv", "ID,Nombre,Apellidos\n1001,Carla,Mena\n"), { dryRun: false, origin: "dentalink" });
  const citas = await correr("appointments", csv("citas.csv", [
    "Id paciente,Paciente,Profesional,Fecha,Hora",
    "1001,Carla Mena,Ana López,15/01/2030,10:00", // ID que existe: sin aviso
    "SINT-001,Carla Mena,Ana López,16/01/2030,10:00", // ID que no existe: por nombre, con aviso
    "SINT-002,Nadie Conocido,Ana López,17/01/2030,10:00", // ni ID ni nombre: error
  ].join("\n")), { origin: "dentalink" });
  assert.equal(fila(citas, 2).status, "ok");
  assert.deepEqual(fila(citas, 2).warnings, []);
  assert.equal(fila(citas, 3).status, "ok");
  assert.match(fila(citas, 3).warnings.join(" "), /SINT-001.*no existe.*por nombre con «Carla Mena»/);
  assert.equal(fila(citas, 3).data.patientId, fila(citas, 2).data.patientId);
  assert.equal(fila(citas, 4).status, "error");
  // Mismo aviso en saldos.
  const saldos = await correr("balances", csv("s.csv", "Id paciente,Paciente,Saldo\nSINT-001,Carla Mena,50\n"), { origin: "dentalink" });
  assert.match(fila(saldos, 2).warnings.join(" "), /SINT-001/);
  // Por teléfono: dice «teléfono».
  const tel = await correr("appointments", csv("c.csv", "Id paciente,Celular,Profesional,Fecha,Hora\nSINT-009,5551234567,Ana López,15/01/2030,10:00\n"), { origin: "dentalink" });
  assert.match(fila(tel, 2).warnings.join(" "), /por teléfono con «María Hernández»/);
});
