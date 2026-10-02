// ws1-t8 — revisión en panel.108 de ws1-t9, fallo 1 (bloqueante): «Iniciar consulta» y «Próxima cita» de la
// ficha tomaban la cita futura MÁS LEJANA (lista `startsAt: desc` + `find` de la primera futura) y nunca la de hoy.
// Run: npx tsx --test src/lib/patients/__tests__/proxima-cita.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { esCitaDeHoy, proximaCitaDeLaFicha } from "../proxima-cita";

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
  assert.match(ficha, /const nextAppt = proximaCitaDeLaFicha\(appointments, new Date\(\), zonaClinica\) \?\? undefined;/);
  const pagina = readFileSync(join(SRC, "app/dashboard/patients/[id]/page.tsx"), "utf8");
  assert.match(pagina, /zonaClinica=\{tz\}/);
});

test("«Iniciar consulta» (cabecera e «Iniciar visita» de Ortodoncia) pasa la cita de HOY a «En consulta», como la Agenda", () => {
  const SRC = join(__dirname, "..", "..", "..");
  const ficha = readFileSync(join(SRC, "app/dashboard/patients/[id]/patient-detail-client.tsx"), "utf8");
  const i = ficha.indexOf("const iniciarConsulta = async () => {");
  assert.ok(i > 0);
  const cuerpo = ficha.slice(i, ficha.indexOf("\n  };", i));
  assert.match(cuerpo, /esCitaDeHoy\(nextAppt\.startsAt, new Date\(\), zonaClinica\)/);
  assert.match(cuerpo, /\/api\/appointments\/\$\{nextAppt\.id\}\/status/);
  assert.match(cuerpo, /status: "IN_PROGRESS"/);
  assert.match(cuerpo, /marcarEstadoDeCita\(nextAppt\.id, "IN_PROGRESS"\)/);
  assert.match(ficha, /onStartConsult=\{\(\) => void iniciarConsulta\(\)\}/);
  assert.match(ficha, /onIniciarConsulta=\{\(\) => void iniciarConsulta\(\)\}/);
  const tab = readFileSync(join(SRC, "components/specialties/orthodontics/redesign/OrthodonticsPatientTab.tsx"), "utf8");
  assert.match(tab, /if \(nextAppt && onIniciarConsulta\) onIniciarConsulta\(\);/);
});
