// ws1-t8 — revisión en panel.108 de ws1-t9, fallo 1 (bloqueante): «Iniciar consulta» y «Próxima cita» de la
// ficha tomaban la cita futura MÁS LEJANA (lista `startsAt: desc` + `find` de la primera futura) y nunca la de hoy.
// Run: npx tsx --test src/lib/patients/__tests__/proxima-cita.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { citaParaIniciarDesdeLaFicha, esCitaDeHoy, proximaCitaDeLaFicha } from "../proxima-cita";

const ZONA = "America/Mexico_City";
// 2-oct-2026 16:00 en CDMX (22:00Z).
const AHORA = new Date("2026-10-02T22:00:00Z");
const cita = (id: string, startsAt: string, status = "SCHEDULED") => ({ id, startsAt, status });

test("P0147 (2, 5 y 7 de octubre, lista descendente como la manda el servidor): la próxima es la de HOY, no la del 7", () => {
  const citas = [
    cita("7-oct", "2026-10-07T16:00:00Z"),
    cita("5-oct", "2026-10-05T16:00:00Z"),
    cita("2-oct", "2026-10-02T20:00:00Z"), // 14:00 en CDMX: su hora ya pasó y sigue siendo la de hoy
  ];
  assert.equal(proximaCitaDeLaFicha(citas, AHORA, ZONA)?.id, "2-oct");
});

test("P0159 sin cita de hoy pendiente (2-oct atendida, 21 y 27 de octubre): la futura más PRÓXIMA", () => {
  const citas = [
    cita("27-oct", "2026-10-27T16:00:00Z"),
    cita("21-oct", "2026-10-21T16:00:00Z"),
    cita("2-oct", "2026-10-02T20:00:00Z", "COMPLETED"),
  ];
  assert.equal(proximaCitaDeLaFicha(citas, AHORA, ZONA)?.id, "21-oct");
});

test("la cita en la que el paciente YA está (en consulta, en sillón, llegó) manda sobre todas", () => {
  const citas = [
    cita("hoy-tarde", "2026-10-02T23:00:00Z"),
    cita("hoy-temprano", "2026-10-02T16:00:00Z"),
    cita("futura-en-consulta", "2026-10-07T16:00:00Z", "IN_PROGRESS"),
  ];
  assert.equal(proximaCitaDeLaFicha(citas, AHORA, ZONA)?.id, "futura-en-consulta");
  assert.equal(proximaCitaDeLaFicha([cita("a", "2026-10-02T23:00:00Z"), cita("b", "2026-10-02T21:00:00Z", "CHECKED_IN")], AHORA, ZONA)?.id, "b");
});

test("dos citas hoy: la más temprana; «hoy» es el día de la CLÍNICA, no el UTC", () => {
  const citas = [cita("21h", "2026-10-03T03:00:00Z"), cita("17h", "2026-10-02T23:00:00Z")];
  assert.equal(proximaCitaDeLaFicha(citas, AHORA, ZONA)?.id, "17h");
  // 3-oct 03:00Z es 2-oct 21:00 en CDMX: de hoy.
  assert.equal(esCitaDeHoy("2026-10-03T03:00:00Z", AHORA, ZONA), true);
  assert.equal(esCitaDeHoy("2026-10-03T16:00:00Z", AHORA, ZONA), false);
});

test("nunca una cancelada, con inasistencia, atendida ni una de un día pasado que quedó sin cerrar", () => {
  const citas = [
    cita("cancelada", "2026-10-02T23:00:00Z", "CANCELLED"),
    cita("no-vino", "2026-10-02T21:00:00Z", "NO_SHOW"),
    cita("atendida-futura", "2026-10-03T16:00:00Z", "COMPLETED"),
    cita("salio", "2026-10-02T23:30:00Z", "CHECKED_OUT"),
    cita("ayer", "2026-10-01T16:00:00Z", "SCHEDULED"),
  ];
  assert.equal(proximaCitaDeLaFicha(citas, AHORA, ZONA), null);
  assert.equal(proximaCitaDeLaFicha([], AHORA, ZONA), null);
});

test("la ficha usa la regla (y ya no el `find` sobre la lista descendente) y le pasa la zona de la clínica", () => {
  const SRC = join(__dirname, "..", "..", "..");
  const ficha = readFileSync(join(SRC, "app/dashboard/patients/[id]/patient-detail-client.tsx"), "utf8");
  assert.doesNotMatch(ficha, /appointments\.find\(a => new Date\(a\.date\) >= new Date\(\)/);
  assert.match(ficha, /const nextAppt = paraIniciar\.cita \?\? proximaCitaDeLaFicha\(appointments, new Date\(\), zonaClinica\) \?\? undefined;/);
  const pagina = readFileSync(join(SRC, "app/dashboard/patients/[id]/page.tsx"), "utf8");
  assert.match(pagina, /zonaClinica=\{tz\}/);
});

test("«Iniciar consulta» (cabecera e «Iniciar visita» de Ortodoncia) pasa la cita de HOY a «En consulta», como la Agenda", () => {
  const SRC = join(__dirname, "..", "..", "..");
  const ficha = readFileSync(join(SRC, "app/dashboard/patients/[id]/patient-detail-client.tsx"), "utf8");
  const i = ficha.indexOf("const iniciarConsulta = async () => {");
  assert.ok(i > 0);
  const cuerpo = ficha.slice(i, ficha.indexOf("\n  };", i));
  // Revisión final (fallo nuevo 1): arranca la cita que la sesión PUEDE iniciar, no la próxima a secas.
  assert.match(cuerpo, /const cita = paraIniciar\.cita;/);
  assert.match(cuerpo, /esCitaDeHoy\(cita\.startsAt, new Date\(\), zonaClinica\)/);
  assert.match(cuerpo, /\/api\/appointments\/\$\{cita\.id\}\/status/);
  assert.match(cuerpo, /status: "IN_PROGRESS"/);
  assert.match(cuerpo, /marcarEstadoDeCita\(cita\.id, "IN_PROGRESS"\)/);
  assert.match(ficha, /onStartConsult=\{\(\) => void iniciarConsulta\(\)\}/);
  assert.match(ficha, /onIniciarConsulta=\{\(\) => void iniciarConsulta\(\)\}/);
  const tab = readFileSync(join(SRC, "components/specialties/orthodontics/redesign/OrthodonticsPatientTab.tsx"), "utf8");
  assert.match(tab, /if \(nextAppt && onIniciarConsulta\) onIniciarConsulta\(\);/);
});

// ═══ Revisión final de ws1-t9, fallo nuevo 1 ═══════════════════════════════════════════════════════════════
// P0147: hoy 14:00 con la Dra. Cortés y 15:00 con el doctor en sesión. La cabecera proponía la de 14:00 y
// «Iniciar consulta» moría con 403 `not_your_appointment`.
const conDoctor = (id: string, startsAt: string, doctorId: string, status = "SCHEDULED") => ({ id, startsAt, status, doctorId });
const P0147 = [conDoctor("15h-mia", "2026-10-02T21:00:00Z", "yo"), conDoctor("14h-cortes", "2026-10-02T20:00:00Z", "cortes")];
const doctor = { id: "yo", role: "DOCTOR", puedeEditarAgenda: true };

test("fallo nuevo 1 (P0147): el doctor ve propuesta SU cita de las 15:00, no la de 14:00 de otra doctora", () => {
  const r = citaParaIniciarDesdeLaFicha(P0147, doctor, AHORA, ZONA);
  assert.equal(r.cita?.id, "15h-mia");
  assert.equal(r.motivo, null);
});

test("fallo nuevo 1: si el paciente solo tiene citas de OTRO doctor, no hay cita para iniciar y se dice por qué", () => {
  const r = citaParaIniciarDesdeLaFicha([P0147[1]], doctor, AHORA, ZONA);
  assert.equal(r.cita, null);
  assert.equal(r.motivo, "deOtroProfesional");
  // Su cita futura gana a la de hoy ajena: es la única que puede iniciar.
  const conFutura = [...P0147.slice(1), conDoctor("5-oct-mia", "2026-10-05T16:00:00Z", "yo")];
  assert.equal(citaParaIniciarDesdeLaFicha(conFutura, doctor, AHORA, ZONA).cita?.id, "5-oct-mia");
});

test("fallo nuevo 1: un ADMIN puede iniciar la de cualquier doctor (la primera de hoy)", () => {
  const r = citaParaIniciarDesdeLaFicha(P0147, { id: "admin", role: "ADMIN", puedeEditarAgenda: true }, AHORA, ZONA);
  assert.equal(r.cita?.id, "14h-cortes");
});

test("fallo nuevo 1: recepción (su rol no pasa citas a «En consulta») o sin «Editar/mover citas» no tiene botón", () => {
  const recepcion = citaParaIniciarDesdeLaFicha(P0147, { id: "rec", role: "RECEPTIONIST", puedeEditarAgenda: true }, AHORA, ZONA);
  assert.deepEqual(recepcion, { cita: null, motivo: "sinPermiso" });
  const sinPermiso = citaParaIniciarDesdeLaFicha(P0147, { ...doctor, puedeEditarAgenda: false }, AHORA, ZONA);
  assert.deepEqual(sinPermiso, { cita: null, motivo: "sinPermiso" });
  // Sin ninguna cita pendiente no hay motivo que mostrar: el botón ya se apaga por «sin próxima cita».
  assert.deepEqual(citaParaIniciarDesdeLaFicha([], doctor, AHORA, ZONA), { cita: null, motivo: null });
});

test("fallo nuevo 1: la cabecera apaga «Iniciar consulta» con el motivo y la ficha no llama a una cita ajena", () => {
  const SRC = join(__dirname, "..", "..", "..");
  const hero = readFileSync(join(SRC, "components/dashboard/patient-detail/hero-card.tsx"), "utf8");
  assert.match(hero, /disabled=\{!hasNextAppt \|\| !!motivoSinIniciar\}/);
  assert.match(hero, /motivoSinIniciar \?\? t\("patients\.heroCard\.startConsultTitle"\)/);
  const ficha = readFileSync(join(SRC, "app/dashboard/patients/[id]/patient-detail-client.tsx"), "utf8");
  assert.match(ficha, /motivoSinIniciar=\{motivoSinIniciar\}/);
  assert.match(ficha, /\{ id: currentUser\.id, role: currentUser\.role, puedeEditarAgenda \}/);
  const i = ficha.indexOf("const iniciarConsulta = async () => {");
  const cuerpo = ficha.slice(i, ficha.indexOf("\n  };", i));
  assert.doesNotMatch(cuerpo, /nextAppt/, "«Iniciar consulta» no debe arrancar la próxima cita a secas");
  const pagina = readFileSync(join(SRC, "app/dashboard/patients/[id]/page.tsx"), "utf8");
  assert.match(pagina, /puedeEditarAgenda=\{hasPermission\(permsUser, "agenda\.edit"\)\}/);
});
