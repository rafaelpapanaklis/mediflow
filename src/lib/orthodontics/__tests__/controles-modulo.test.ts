/**
 * Controles / agenda — la pantalla del módulo (H16 de la QA en vivo).
 *
 * Run: npx tsx --test src/lib/orthodontics/__tests__/controles-modulo.test.ts
 *
 * El hallazgo: el apartado decía «Esta pantalla todavía no está lista». Estas
 * pruebas fijan que ahora enseña los controles de hoy y de la semana, y quién
 * falta de control, con el día decidido en la zona de la CLÍNICA.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listMissingNextControl, type OrthoCaseSummary } from "../specialty-kpis";
import {
  DIAS_DE_LA_SEMANA,
  DIAS_SIN_CONTROL_URGENTE,
  casosSinControl,
  citaAtendida,
  controlesDeLaSemana,
  diaEnZona,
  estadoDeCita,
  fraseSinControl,
  historialDeControles,
  rotuloDelDia,
  sumarDias,
  type CitaDeControl,
} from "../controles-modulo";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

const ZONA = "America/Mexico_City";
// El día de la QA: lunes 28-sep-2026. Ciudad de México va 6 horas detrás de UTC.
const HOY = "2026-09-28";
const AHORA = new Date("2026-09-28T15:00:00Z"); // 09:00 en la clínica

const cita = (o: Partial<CitaDeControl> & { startsAt: Date }): CitaDeControl => ({
  appointmentId: `c-${o.startsAt.toISOString()}`,
  patientId: "p-1",
  patientName: "Paciente Uno",
  doctorName: "Dra. Mariana Cortés",
  status: "SCHEDULED",
  hoja: null,
  ...o,
});

const caso = (o: Partial<OrthoCaseSummary> = {}): OrthoCaseSummary => ({
  planId: "plan-1",
  patientId: "p-1",
  patientName: "Paciente Uno",
  treatingDoctorId: "d-1",
  treatingDoctorName: "Dra. Mariana Cortés",
  status: "IN_PROGRESS",
  installedAt: null,
  estimatedDurationMonths: 18,
  droppedOutAt: null,
  statusUpdatedAt: new Date("2026-06-01T00:00:00Z"),
  cobranza: null,
  ...o,
});

// ── H16: ya no es un cartel ──────────────────────────────────────────────

test("H16: la página de Controles carga las citas de verdad (antes: «Esta pantalla todavía no está lista»)", () => {
  const pagina = leer("src/app/dashboard/orthodontics/controles/page.tsx");
  assert.doesNotMatch(pagina, /OrthoModulePlaceholder/, "ya no monta el cartel «Próximamente»");
  assert.match(pagina, /await exigirModuloOrtodoncia\(\);/, "la guarda del módulo, también en la página");
  assert.match(pagina, /loadOrthoControles\(user\.clinicId, zona, viewer\)/, "clínica y visibilidad, de la sesión");
  assert.match(pagina, /"agenda\.create"/, "agendar exige su permiso");

  const cargador = leer("src/lib/orthodontics/controles-data.ts");
  // Los controles son citas de la Agenda, no el modelo viejo.
  assert.match(cargador, /type: TIPO_CITA_CONTROL_ORTO,/);
  assert.doesNotMatch(cargador, /orthodonticControlAppointment/);
  // Cada consulta va por clínica; la de citas, además, por visibilidad de paciente.
  const consultas = cargador.split(/await prisma\./).slice(1).map((t) => t.slice(0, 200));
  assert.equal(consultas.length, 3, "citas, hojas de la ventana y última hoja por paciente");
  for (const c of consultas) assert.match(c, /where: \{\s*clinicId,/, "toda consulta filtra por clínica");
  assert.match(cargador, /AND: relatedPatientVisibilityAnd\(viewer\),/);
  assert.match(cargador, /if \(!clinicId\) \{/, "sin clínica no se consulta nada");
  assert.doesNotMatch(cargador, /Promise\.all/, "en fila: no satura el pooler");

  const vista = leer("src/components/specialties/orthodontics/modulo/vista-controles.tsx");
  assert.match(vista, /horaEnZona\(cita\.startsAt, zonaHoraria\)/, "la hora, en la zona de la clínica");
  assert.match(vista, /\/dashboard\/agenda\?date=\$\{dia\}&highlight=\$\{cita\.appointmentId\}/, "cada control lleva a su día en la Agenda");
  const boton = leer("src/components/specialties/orthodontics/modulo/agendar-control.tsx");
  assert.match(boton, /initialReason: TIPO_CITA_CONTROL_ORTO,/, "agenda un CONTROL, con la ventana de Nueva cita de siempre");
  assert.match(boton, /onCreated: \(\) => router\.refresh\(\),/);
});

// ── Hoy y la semana ──────────────────────────────────────────────────────

test("los dos controles de la QA (10:00 y 13:00 del lunes 28) salen en «hoy», en orden", () => {
  const semana = controlesDeLaSemana(
    [
      cita({ patientId: "adulto", patientName: "QA Orto Adulto Debe", startsAt: new Date("2026-09-28T19:00:00Z") }), // 13:00
      cita({ patientId: "menor", patientName: "QA Orto Menor Pruebas", startsAt: new Date("2026-09-28T16:00:00Z") }), // 10:00
    ],
    HOY,
    ZONA,
  );
  assert.deepEqual(semana.hoy.map((c) => c.patientName), ["QA Orto Menor Pruebas", "QA Orto Adulto Debe"]);
  assert.deepEqual(semana.proximosDias, []);
  assert.deepEqual(semana.resumenHoy, { enPie: 2, atendidos: 0, faltaron: 0, cancelados: 0 });
});

test("el día de una cita es el de la CLÍNICA, no el del servidor", () => {
  // 19:30 del lunes en Ciudad de México = 01:30 del martes en UTC.
  const tarde = new Date("2026-09-29T01:30:00Z");
  assert.equal(diaEnZona(tarde, ZONA), "2026-09-28");
  assert.equal(diaEnZona(tarde, "UTC"), "2026-09-29");
  const semana = controlesDeLaSemana([cita({ startsAt: tarde })], HOY, ZONA);
  assert.equal(semana.hoy.length, 1, "es de hoy");
  assert.equal(semana.proximosDias.length, 0);
});

test("el resultado no depende de la zona de la máquina", () => {
  const guion = `
    const { controlesDeLaSemana, diaEnZona } = require("./src/lib/orthodontics/controles-modulo.ts");
    const c = { appointmentId: "x", patientId: "p", patientName: "P", doctorName: null, status: "SCHEDULED", hoja: null, startsAt: new Date("2026-09-29T01:30:00Z") };
    const s = controlesDeLaSemana([c], "2026-09-28", "America/Mexico_City");
    process.stdout.write(JSON.stringify([diaEnZona(c.startsAt, "America/Mexico_City"), s.hoy.length, s.proximosDias.length]));
  `;
  for (const TZ of ["UTC", "America/New_York", "Asia/Tokyo"]) {
    const salida = execFileSync("npx", ["tsx", "-e", guion], { cwd: RAIZ, env: { ...process.env, TZ }, encoding: "utf8" });
    assert.equal(salida, '["2026-09-28",1,0]', `con TZ=${TZ}`);
  }
});

test("los próximos siete días, por día; lo de antes y lo de después no entra", () => {
  const semana = controlesDeLaSemana(
    [
      cita({ patientName: "Ayer", startsAt: new Date("2026-09-27T16:00:00Z") }),
      cita({ patientName: "Hoy", startsAt: new Date("2026-09-28T16:00:00Z") }),
      cita({ patientName: "Mañana B", startsAt: new Date("2026-09-29T20:00:00Z") }),
      cita({ patientName: "Mañana A", startsAt: new Date("2026-09-29T15:00:00Z") }),
      cita({ patientName: "Cancelada", startsAt: new Date("2026-09-29T17:00:00Z"), status: "CANCELLED" }),
      cita({ patientName: "Día 7", startsAt: new Date("2026-10-05T16:00:00Z") }),
      cita({ patientName: "Día 8", startsAt: new Date("2026-10-06T16:00:00Z") }),
    ],
    HOY,
    ZONA,
  );
  assert.deepEqual(semana.hoy.map((c) => c.patientName), ["Hoy"]);
  assert.deepEqual(
    semana.proximosDias.map((d) => [d.dia, d.citas.map((c) => c.patientName)]),
    [
      ["2026-09-29", ["Mañana A", "Cancelada", "Mañana B"]],
      ["2026-10-05", ["Día 7"]],
    ],
  );
  assert.equal(semana.totalProximos, 3, "la cancelada se ve, pero no cuenta");
  assert.equal(DIAS_DE_LA_SEMANA, 7);
});

test("el resumen de hoy separa por atender, atendidos, faltas y cancelados", () => {
  const a = (status: string, h: number) => cita({ status, startsAt: new Date(Date.UTC(2026, 8, 28, 14 + h)) });
  const { resumenHoy } = controlesDeLaSemana(
    [a("SCHEDULED", 0), a("CONFIRMED", 1), a("IN_PROGRESS", 2), a("COMPLETED", 3), a("CHECKED_OUT", 4), a("NO_SHOW", 5), a("CANCELLED", 6)],
    HOY,
    ZONA,
  );
  assert.deepEqual(resumenHoy, { enPie: 3, atendidos: 2, faltaron: 1, cancelados: 1 });
});

test("cada estado de cita tiene su texto, sin claves internas", () => {
  const estados = ["PENDING", "SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_CHAIR", "IN_PROGRESS", "COMPLETED", "CHECKED_OUT", "CANCELLED", "NO_SHOW"];
  for (const e of estados) {
    const { texto } = estadoDeCita(e);
    assert.ok(texto.length > 3, e);
    assert.doesNotMatch(texto, /[A-Z]{3,}|_/, `${e}: nada de «NO_SHOW» a la vista`);
  }
  assert.equal(estadoDeCita("NO_SHOW").texto, "No asistió");
  assert.equal(estadoDeCita("NO_SHOW").tono, "peligro");
  assert.equal(estadoDeCita("algo-nuevo").texto, "Agendada", "un estado desconocido no rompe la pantalla");
  // Fila 24 de la revisión de lógica de uso: los MISMOS nombres que la Agenda
  // y la ficha del paciente. La misma cita no se llama de tres maneras.
  assert.deepEqual(
    ["PENDING", "SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_CHAIR", "IN_PROGRESS", "COMPLETED", "CHECKED_OUT", "CANCELLED", "NO_SHOW"].map(
      (e) => estadoDeCita(e).texto,
    ),
    ["Agendada", "Agendada", "Confirmada", "Registrado", "En sillón", "En consulta", "Completada", "Salió", "Cancelada", "No asistió"],
  );
  for (const viejo of ["Por confirmar", "En sala de espera", "Atendida", "No se presentó"]) {
    assert.ok(!estados.some((e) => estadoDeCita(e).texto === viejo), `«${viejo}» era un nombre solo de esta pantalla`);
  }
  assert.equal(citaAtendida("COMPLETED"), true);
  assert.equal(citaAtendida("CONFIRMED"), false);
});

test("los rótulos de los días", () => {
  assert.equal(sumarDias("2026-09-28", 1), "2026-09-29");
  assert.equal(sumarDias("2026-09-28", 7), "2026-10-05");
  assert.equal(sumarDias("2026-12-31", 1), "2027-01-01");
  assert.equal(sumarDias("2028-02-28", 1), "2028-02-29", "bisiesto");
  assert.equal(rotuloDelDia("2026-09-28", HOY), "Hoy · lunes 28 sep");
  assert.equal(rotuloDelDia("2026-09-29", HOY), "Mañana · martes 29 sep");
  assert.equal(rotuloDelDia("2026-10-01", HOY), "jueves 1 oct");
});

// ── Quién falta de control ───────────────────────────────────────────────

test("quién falta de control: el mismo criterio que la alerta, más hace cuánto fue el último", () => {
  const casos = [
    caso({ planId: "a", patientId: "con-cita", patientName: "Con cita futura" }),
    caso({ planId: "b", patientId: "hace-52", patientName: "Hace 52 días" }),
    caso({ planId: "c", patientId: "hace-10", patientName: "Hace 10 días" }),
    caso({ planId: "d", patientId: "nunca", patientName: "Nunca ha venido" }),
    caso({ planId: "e", patientId: "terminado", patientName: "Terminado", status: "COMPLETED" }),
    caso({ planId: "f", patientId: "falto", patientName: "Faltó" }),
  ];
  const citas = [
    { patientId: "con-cita", startsAt: new Date("2026-10-10T16:00:00Z"), status: "SCHEDULED" },
    { patientId: "hace-52", startsAt: new Date("2026-08-07T16:00:00Z"), status: "COMPLETED" },
    { patientId: "hace-52", startsAt: new Date("2026-07-07T16:00:00Z"), status: "CHECKED_OUT" },
    { patientId: "hace-10", startsAt: new Date("2026-09-18T16:00:00Z"), status: "COMPLETED" },
    // Tenía una futura, pero se canceló: sigue sin control.
    { patientId: "hace-10", startsAt: new Date("2026-10-02T16:00:00Z"), status: "CANCELLED" },
    { patientId: "falto", startsAt: new Date("2026-09-01T16:00:00Z"), status: "COMPLETED" },
    { patientId: "falto", startsAt: new Date("2026-09-21T16:00:00Z"), status: "NO_SHOW" },
    // Pasada y sin marcar: no se sabe si vino, no cuenta como control.
    { patientId: "nunca", startsAt: new Date("2026-09-14T16:00:00Z"), status: "SCHEDULED" },
  ];
  const historial = historialDeControles(citas, AHORA);
  const faltan = casosSinControl(casos, historial, HOY, ZONA);

  assert.deepEqual(
    faltan.map((c) => [c.patientName, c.diasSinControl, c.urgente, c.faltoAlUltimo]),
    [
      ["Hace 52 días", 52, true, false],
      ["Faltó", 27, false, true],
      ["Hace 10 días", 10, false, false],
      ["Nunca ha venido", null, false, false],
    ],
    "arriba quien lleva más tiempo; al final quien no tiene controles registrados",
  );
  assert.equal(DIAS_SIN_CONTROL_URGENTE, 45);

  // Los mismos pacientes que la alerta «Falta de control» de Alertas.
  const alerta = listMissingNextControl(casos, historial.conControlFuturo).map((c) => c.patientId).sort();
  assert.deepEqual(faltan.map((c) => c.patientId).sort(), alerta);
});

test("una hoja de control registrada cuenta como control hecho, aunque nadie marcara la cita", () => {
  const citas = [{ patientId: "p-1", startsAt: new Date("2026-09-14T16:00:00Z"), status: "SCHEDULED" }];
  const sinHoja = casosSinControl([caso()], historialDeControles(citas, AHORA), HOY, ZONA);
  assert.equal(sinHoja[0].diasSinControl, null);
  const conHoja = casosSinControl(
    [caso()],
    historialDeControles(citas, AHORA, [{ patientId: "p-1", visitDate: new Date("2026-09-14T16:30:00Z") }]),
    HOY,
    ZONA,
  );
  assert.equal(conHoja[0].diasSinControl, 14);
  // Una hoja con fecha futura (mal capturada) no cuenta.
  const futura = historialDeControles([], AHORA, [{ patientId: "p-1", visitDate: new Date("2026-12-01T16:00:00Z") }]);
  assert.equal(futura.ultimoAtendido.size, 0);
});

test("un paciente con dos casos sale una sola vez", () => {
  const faltan = casosSinControl(
    [caso({ planId: "uno" }), caso({ planId: "dos" })],
    historialDeControles([], AHORA),
    HOY,
    ZONA,
  );
  assert.equal(faltan.length, 1);
});

test("las frases de quien falta de control", () => {
  assert.equal(fraseSinControl({ diasSinControl: 52, faltoAlUltimo: false }), "Su último control fue hace 52 días");
  assert.equal(fraseSinControl({ diasSinControl: 1, faltoAlUltimo: false }), "Su último control fue ayer");
  assert.equal(fraseSinControl({ diasSinControl: 0, faltoAlUltimo: false }), "Su último control fue hoy");
  assert.equal(fraseSinControl({ diasSinControl: 27, faltoAlUltimo: true }), "Su último control fue hace 27 días · faltó a su última cita");
  assert.equal(fraseSinControl({ diasSinControl: null, faltoAlUltimo: false }), "Sin controles registrados");
  assert.equal(fraseSinControl({ diasSinControl: null, faltoAlUltimo: true }), "Faltó a su cita · sin controles registrados");
});

test("H43: retención, pausa y planeado no aparecen como «falta de control»", () => {
  const mk = (id: string, status: OrthoCaseSummary["status"]) => ({ ...caso(), planId: id, patientId: id, patientName: id, status });
  const casos = [mk("a", "IN_PROGRESS"), mk("b", "RETENTION"), mk("c", "ON_HOLD"), mk("d", "PLANNED")];
  assert.deepEqual(listMissingNextControl(casos, new Set()).map((c) => c.patientId), ["a"]);
});
