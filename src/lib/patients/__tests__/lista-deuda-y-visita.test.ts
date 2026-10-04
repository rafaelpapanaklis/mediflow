// ws1-t1 (ronda de arreglos de la auditoría de uso, C-92 y C-93) — la lista de pacientes del doctor.
// Con el código de antes: «Con deuda» contaba las facturas de TODA la clínica (un doctor con 8 pacientes veía
// «Con deuda 40») y «Última visita» salía solo de la última nota clínica («Nunca» con una cita completada).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ESTADOS_DE_VISITA, ultimaVisita } from "../ultima-visita";

const SRC = join(__dirname, "..", "..", "..");
const RUTA = readFileSync(join(SRC, "app/api/patients/route.ts"), "utf8");

test("🔴→🟢 la última visita cuenta la cita atendida aunque no haya nota", () => {
  assert.equal(ultimaVisita(null, new Date("2026-10-02T16:00:00Z")), "2026-10-02T16:00:00.000Z");
  assert.equal(ultimaVisita(undefined, undefined), null);
  // La más reciente de las dos.
  assert.equal(ultimaVisita("2026-09-01T10:00:00Z", "2026-10-02T16:00:00Z"), "2026-10-02T16:00:00.000Z");
  assert.equal(ultimaVisita("2026-10-03T10:00:00Z", "2026-10-02T16:00:00Z"), "2026-10-03T10:00:00.000Z");
  assert.deepEqual([...ESTADOS_DE_VISITA], ["COMPLETED", "CHECKED_OUT"]);
});

test("🔴→🟢 la lista usa la última cita atendida, en UNA consulta y con el tenant de la sesión", () => {
  assert.match(RUTA, /const lastVisit = ultimaVisita\(p\.records\[0\]\?\.visitDate, ultimaCitaAtendida\.get\(p\.id\)\);/);
  const desde = RUTA.indexOf("const citasAtendidas");
  const bloque = RUTA.slice(desde, RUTA.indexOf("const ultimaCitaAtendida", desde));
  assert.match(bloque, /groupBy\(/);
  assert.match(bloque, /clinicId: ctx\.clinicId/);
  assert.match(bloque, /status: \{ in: \[\.\.\.ESTADOS_DE_VISITA\] \}/);
});

test("🔴→🟢 «Con deuda» cuenta solo a los pacientes que este usuario ve (el mismo set que la lista)", () => {
  const desde = RUTA.indexOf("/* ─── 2ª query: stats agregadas ─── */");
  const stats = RUTA.slice(desde, RUTA.indexOf("const stats = {", desde));
  assert.equal((stats.match(/where: \{ AND: \[deudaInvoiceWhere\(ctx\.clinicId\), \{ patient: baseStatsWhere \}\] \}/g) ?? []).length, 2);
  assert.ok(!/where: deudaInvoiceWhere\(ctx\.clinicId\),\s*\n\s*_sum/.test(stats), "ya no la deuda de toda la clínica");
});

// C-98: el icono de agenda de la fila era un enlace a /dashboard/agenda?newAppointment=1&patientId=…, parámetros
// que la agenda nunca leyó.
test("🔴→🟢 el icono de agenda de la fila abre «Nueva cita» con el paciente ya elegido", () => {
  const lista = readFileSync(join(SRC, "app/dashboard/patients/patients-client.tsx"), "utf8");
  assert.ok(!lista.includes("newAppointment=1"), "ya no el enlace muerto");
  assert.match(lista, /abrirNuevaCita\(\{ initialPatient: \{ id: p\.id, name: p\.fullName \}, openAgendaAfter: true \}\)/);
  assert.match(lista, /const \{ open: abrirNuevaCita \} = useNewAppointmentDialog\(\);/);
});
