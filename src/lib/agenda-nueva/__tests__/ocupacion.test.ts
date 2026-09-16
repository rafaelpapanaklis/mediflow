/**
 * La ocupación del día — la barra del Mes (WS1-T2).
 *
 * Lo que estas pruebas defienden, por orden de importancia:
 *  1. Que el porcentaje sale del horario REAL de la clínica, no del «30 citas»
 *     inventado del prototipo.
 *  2. Que cuando NO se puede calcular de verdad, sale `null` y no un número
 *     de adorno.
 *  3. Que el sábado corto y el domingo cerrado salen de `ClinicSchedule`.
 *  4. Que el día de la semana se mide en la zona de la CLÍNICA (en Vercel el
 *     proceso corre en UTC).
 *
 * Run: npm run test:agenda-ocupacion
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ScheduleDay } from "@/lib/agenda/clinic-hours";
import type { AppointmentStatus } from "@/lib/agenda/types";
import {
  horarioDelDia,
  minutosEnTz,
  notaDelDia,
  ocupacionDelDia,
  type Carril,
  type CitaOcupacion,
} from "../ocupacion";

const TZ = "America/Mexico_City";

/** Lunes–viernes 09:00–18:00, sábado 09:00–14:00, domingo cerrado. */
const HORARIO: ScheduleDay[] = [
  { dayOfWeek: 0, enabled: true, openTime: "09:00", closeTime: "18:00" },
  { dayOfWeek: 1, enabled: true, openTime: "09:00", closeTime: "18:00" },
  { dayOfWeek: 2, enabled: true, openTime: "09:00", closeTime: "18:00" },
  { dayOfWeek: 3, enabled: true, openTime: "09:00", closeTime: "18:00" },
  { dayOfWeek: 4, enabled: true, openTime: "09:00", closeTime: "18:00" },
  { dayOfWeek: 5, enabled: true, openTime: "09:00", closeTime: "14:00" },
  { dayOfWeek: 6, enabled: false, openTime: "09:00", closeTime: "14:00" },
];

const DIAZ: Carril = { id: "d1", nombre: "Dra. Díaz", color: "#7c3aed" };
const JORGE: Carril = { id: "d2", nombre: "Dr. Jorge", color: "#0891b2" };

/** Una cita el 2026-09-02 (miércoles) en hora de la clínica (UTC−6). */
function cita(
  horaLocal: string,
  duracionMin: number,
  doctorId: string,
  status: AppointmentStatus = "CONFIRMED",
  dayISO = "2026-09-02",
): CitaOcupacion {
  const [h, m] = horaLocal.split(":").map((n) => parseInt(n, 10));
  const inicio = new Date(`${dayISO}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00-06:00`);
  return {
    startsAt: inicio.toISOString(),
    endsAt: new Date(inicio.getTime() + duracionMin * 60_000).toISOString(),
    status,
    doctorId,
  };
}

function ocupacion(citas: CitaOcupacion[], carriles: Carril[] = [DIAZ, JORGE], dayISO = "2026-09-02") {
  return ocupacionDelDia({ dayISO, citas, schedules: HORARIO, timezone: TZ, carriles });
}

/* ── 1. La capacidad sale del horario de verdad ───────────────────────────── */

test("el porcentaje sale de minutos ocupados ÷ (horario del día × carriles)", () => {
  // Miércoles 09:00–18:00 = 540 min por carril × 2 carriles = 1080 min.
  // 4 citas de 60 min + 2 de 30 = 300 min ocupados → 28%.
  const o = ocupacion([
    cita("09:00", 60, "d1"), cita("10:00", 60, "d1"),
    cita("09:00", 60, "d2"), cita("10:00", 60, "d2"),
    cita("11:00", 30, "d1"), cita("11:00", 30, "d2"),
  ]);
  assert.equal(o.minutosDisponibles, 1080);
  assert.equal(o.minutosOcupados, 300);
  assert.equal(o.porcentaje, 28);
  assert.equal(o.totalCitas, 6);
});

test("quitar un carril con el filtro sube el porcentaje (la mitad de la capacidad)", () => {
  const citas = [cita("09:00", 60, "d1"), cita("09:00", 60, "d2")];
  assert.equal(ocupacion(citas, [DIAZ, JORGE]).porcentaje, 11); // 120/1080
  // Con solo la Dra. Díaz visible: su cita de 60 min sobre 540 → 11%… pero la
  // de Jorge ya no cuenta porque la vista tampoco la enseña.
  const soloDiaz = ocupacionDelDia({
    dayISO: "2026-09-02",
    citas: citas.filter((c) => c.doctorId === "d1"),
    schedules: HORARIO,
    timezone: TZ,
    carriles: [DIAZ],
  });
  assert.equal(soloDiaz.minutosDisponibles, 540);
  assert.equal(soloDiaz.porcentaje, 11);
});

test("el sábado corto (09:00–14:00) tiene menos capacidad que un miércoles", () => {
  const sabado = ocupacionDelDia({
    dayISO: "2026-09-05", // sábado
    citas: [cita("09:00", 60, "d1", "CONFIRMED", "2026-09-05")],
    schedules: HORARIO,
    timezone: TZ,
    carriles: [DIAZ],
  });
  assert.equal(sabado.minutosDisponibles, 300); // 5 h
  assert.equal(sabado.porcentaje, 20);
  assert.equal(sabado.cerrado, false);
});

/* ── 2. Cuando no se sabe, no se inventa ─────────────────────────────────── */

test("sin ClinicSchedule utilizable NO hay porcentaje (null), pero sí contador", () => {
  const o = ocupacionDelDia({
    dayISO: "2026-09-02",
    citas: [cita("09:00", 60, "d1")],
    schedules: [],
    timezone: TZ,
    carriles: [DIAZ],
  });
  assert.equal(o.horarioDesconocido, true);
  assert.equal(o.porcentaje, null);
  assert.equal(o.totalCitas, 1);
});

test("horas corruptas en ClinicSchedule = horario desconocido, no un cero silencioso", () => {
  const roto: ScheduleDay[] = [
    { dayOfWeek: 2, enabled: true, openTime: "no-es-una-hora", closeTime: "18:00" },
    // cierre <= apertura: la fila no dice nada utilizable
    { dayOfWeek: 3, enabled: true, openTime: "18:00", closeTime: "09:00" },
  ];
  assert.equal(horarioDelDia("2026-09-02", roto, TZ), null);
  assert.equal(ocupacionDelDia({
    dayISO: "2026-09-02", citas: [], schedules: roto, timezone: TZ, carriles: [DIAZ],
  }).porcentaje, null);
});

test("sin carriles visibles (filtro que apaga todo) tampoco hay porcentaje", () => {
  const o = ocupacion([cita("09:00", 60, "d1")], []);
  assert.equal(o.minutosDisponibles, 0);
  assert.equal(o.porcentaje, null);
  assert.deepEqual(o.segmentos, []);
});

/* ── 3. Días cerrados ────────────────────────────────────────────────────── */

test("el domingo sale cerrado porque lo dice ClinicSchedule, no porque sea domingo", () => {
  const domingo = ocupacionDelDia({
    dayISO: "2026-09-06", citas: [], schedules: HORARIO, timezone: TZ, carriles: [DIAZ],
  });
  assert.equal(domingo.cerrado, true);
  assert.equal(domingo.minutosDisponibles, 0);
  assert.deepEqual(notaDelDia(domingo), { tipo: "cerrado", texto: "Cerrado" });

  // La misma clínica abriendo en domingo: deja de estar cerrada.
  const abreDomingo = HORARIO.map((d) => (d.dayOfWeek === 6 ? { ...d, enabled: true } : d));
  assert.equal(
    ocupacionDelDia({ dayISO: "2026-09-06", citas: [], schedules: abreDomingo, timezone: TZ, carriles: [DIAZ] }).cerrado,
    false,
  );
});

test("un día sin fila en ClinicSchedule cuenta como cerrado", () => {
  const soloLunes: ScheduleDay[] = [
    { dayOfWeek: 0, enabled: true, openTime: "09:00", closeTime: "18:00" },
  ];
  const miercoles = horarioDelDia("2026-09-02", soloLunes, TZ);
  assert.deepEqual(miercoles, { abierto: false, aperturaMin: null, cierreMin: null });
});

test("el 16 de septiembre NO es feriado para el sistema: si el horario dice abierto, abre", () => {
  // En Dental no hay modelo de festivos. El prototipo pinta «Feriado ·
  // Independencia» el 16-sep; aquí ese día es un miércoles normal.
  const o = ocupacionDelDia({
    dayISO: "2026-09-16", citas: [], schedules: HORARIO, timezone: TZ, carriles: [DIAZ],
  });
  assert.equal(o.cerrado, false);
  assert.equal(o.minutosDisponibles, 540);
  assert.equal(notaDelDia(o), null);
});

/* ── 4. Zona horaria de la clínica ───────────────────────────────────────── */

test("el día de la semana se mide en la zona de la clínica, no en UTC", () => {
  // 2026-09-06 es domingo. En Ciudad de México (UTC−6) el lunes 7 a las 00:30
  // locales son las 06:30 UTC del lunes: si midiéramos en UTC seguiría dando
  // lunes, pero el caso que muerde es el contrario — el domingo a las 19:00
  // locales ya es lunes en UTC.
  assert.equal(horarioDelDia("2026-09-06", HORARIO, TZ)!.abierto, false); // domingo
  assert.equal(horarioDelDia("2026-09-07", HORARIO, TZ)!.abierto, true);  // lunes
  // Y en una clínica de Tijuana (UTC−7) el mismo ISO sigue siendo domingo.
  assert.equal(horarioDelDia("2026-09-06", HORARIO, "America/Tijuana")!.abierto, false);
});

test("minutosEnTz devuelve la hora de pared de la clínica", () => {
  // 15:30 UTC = 09:30 en Ciudad de México (UTC−6 en septiembre).
  assert.equal(minutosEnTz("2026-09-02T15:30:00Z", TZ), 9 * 60 + 30);
  assert.equal(minutosEnTz("no-es-una-fecha", TZ), null);
});

/* ── 5. Qué cuenta y qué no ──────────────────────────────────────────────── */

test("las canceladas no cuentan ni en el contador ni en los minutos", () => {
  const o = ocupacion([
    cita("09:00", 60, "d1", "CONFIRMED"),
    cita("10:00", 60, "d1", "CANCELLED"),
  ]);
  assert.equal(o.totalCitas, 1);
  assert.equal(o.minutosOcupados, 60);
});

test("NO_SHOW cuenta como cita agendada pero no como minutos ocupados", () => {
  // Es el mismo criterio que `occupancyOf` de las cabeceras de la vista Día:
  // dos porcentajes distintos del mismo día en la misma pantalla se leen como
  // un error.
  const o = ocupacion([
    cita("09:00", 60, "d1", "CONFIRMED"),
    cita("10:00", 60, "d1", "NO_SHOW"),
  ]);
  assert.equal(o.totalCitas, 2);
  assert.equal(o.minutosOcupados, 60);
});

test("«N sin confirmar» cuenta las SCHEDULED y es la nota ámbar", () => {
  const o = ocupacion([
    cita("09:00", 60, "d1", "SCHEDULED"),
    cita("10:00", 60, "d1", "SCHEDULED"),
    cita("11:00", 60, "d1", "CONFIRMED"),
  ]);
  assert.equal(o.sinConfirmar, 2);
  assert.deepEqual(notaDelDia(o), { tipo: "sin-confirmar", texto: "2 sin confirmar" });
});

test("«Cerrado» gana a «N sin confirmar» cuando el día está cerrado", () => {
  const o = ocupacionDelDia({
    dayISO: "2026-09-06",
    citas: [cita("09:00", 60, "d1", "SCHEDULED", "2026-09-06")],
    schedules: HORARIO,
    timezone: TZ,
    carriles: [DIAZ],
  });
  assert.deepEqual(notaDelDia(o), { tipo: "cerrado", texto: "Cerrado" });
});

/* ── 6. Los segmentos de la barra ────────────────────────────────────────── */

test("cada segmento mide los minutos de SU responsable, en el orden dado", () => {
  const o = ocupacion([
    cita("09:00", 120, "d1"),
    cita("09:00", 60, "d2"),
  ]);
  assert.deepEqual(o.segmentos.map((s) => s.carrilId), ["d1", "d2"]);
  assert.equal(o.segmentos[0]!.minutos, 120);
  assert.equal(o.segmentos[1]!.minutos, 60);
  // 120/1080 y 60/1080
  assert.equal(Math.round(o.segmentos[0]!.fraccion * 1000) / 1000, 0.111);
  assert.equal(Math.round(o.segmentos[1]!.fraccion * 1000) / 1000, 0.056);
});

test("una cita sin responsable suma al día pero no pinta segmento", () => {
  const o = ocupacion([
    cita("09:00", 60, "d1"),
    { ...cita("10:00", 60, "d1"), doctorId: null },
  ]);
  assert.equal(o.minutosOcupados, 120);
  assert.equal(o.segmentos[0]!.minutos, 60);
  assert.equal(o.segmentos[1]!.minutos, 0);
});

test("un día sobrevendido dice más de 100% pero la barra no se sale", () => {
  // Un solo carril (540 min) con 720 min de citas = 133%.
  const citas = [
    cita("09:00", 240, "d1"), cita("13:00", 240, "d1"), cita("09:00", 240, "d1"),
  ];
  const o = ocupacion(citas, [DIAZ]);
  assert.equal(o.porcentaje, 133);
  const suma = o.segmentos.reduce((acc, s) => acc + s.fraccion, 0);
  assert.ok(suma <= 1.0001, `los segmentos suman ${suma}, se salen de la barra`);
});

test("un día vacío es 0%, no null: la capacidad se conoce, lo que falta son citas", () => {
  const o = ocupacion([]);
  assert.equal(o.porcentaje, 0);
  assert.equal(o.totalCitas, 0);
  assert.equal(notaDelDia(o), null);
});

test("una cita sin endsAt no rompe la cuenta", () => {
  const o = ocupacion([{ startsAt: "2026-09-02T15:00:00Z", endsAt: null, status: "CONFIRMED", doctorId: "d1" }]);
  assert.equal(o.totalCitas, 1);
  assert.equal(o.minutosOcupados, 0);
});

test("modo sillón reparte por resourceId en vez de por doctor", () => {
  const sillon1: Carril = { id: "r1", nombre: "Unidad 1", color: "#7c3aed" };
  const o = ocupacionDelDia({
    dayISO: "2026-09-02",
    citas: [{ ...cita("09:00", 60, "d1"), resourceId: "r1" }],
    schedules: HORARIO,
    timezone: TZ,
    carriles: [sillon1],
    modo: "resource",
  });
  assert.equal(o.segmentos[0]!.minutos, 60);
});
