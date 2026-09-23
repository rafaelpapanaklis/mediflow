/**
 * EL HORARIO DEL DOCTOR EN LOS CONSUMIDORES PUROS — WS1-T2 · horario.
 *
 * `core.test.ts` prueba la función; esto prueba que los que calculan huecos y
 * capacidad sin base de datos la usan bien:
 *
 *  · Sabina y «Buscar espacio» (`evaluarHora` / `buscarHuecos`, el cuello de
 *    botella de los dos): sin horario propio ofrecen EXACTAMENTE las mismas
 *    horas que antes; con él, la intersección con la clínica; y la frase dice
 *    de quién es el horario que estorba.
 *  · La barra de ocupación de la rejilla (`ocupacionDelDia`) y la de Sabina
 *    (`calcularOcupacion`): la capacidad de un doctor es SU tiempo.
 *  · El reducer de la agenda guarda `horariosDoctores` y no lo pierde.
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/horario-doctor/__tests__/consumidores.test.ts
 * (el mismo arranque que `test:sabina-agenda`: `preparar` sustituye el 2FA con
 * `cache()` de React y el prisma real, que aquí no se usan).
 */
import "@/lib/sabina/tools/__tests__/preparar";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buscarHuecos,
  evaluarHora,
  respuestaNoDisponible,
  type Ocupacion,
} from "@/lib/sabina/tools/agenda-huecos";
import type { ConfigClinica } from "@/lib/sabina/tools/agenda-comun";
import { calcularOcupacion } from "@/lib/sabina/tools/agenda-ocupacion";
import { ocupacionDelDia } from "@/lib/agenda-nueva/ocupacion";
import { agendaReducer, buildInitialState } from "@/lib/agenda/store";
import type { AgendaDayResponse } from "@/lib/agenda/types";
import { SIN_HORARIOS, type DiaHorario, type HorariosDeDoctores } from "../core";

const TZ = "America/Mexico_City";
const LUNES = "2026-11-09";
const MIERCOLES = "2026-11-11";
const SABADO = "2026-11-14";
/** Muy en el pasado: ningún hueco de noviembre de 2026 queda descartado por «ya pasó». */
const AHORA = new Date("2026-01-01T00:00:00Z");

function dia(dayOfWeek: number, enabled: boolean, openTime = "09:00", closeTime = "18:00"): DiaHorario {
  return { dayOfWeek, enabled, openTime, closeTime };
}

/** La clínica: L-V 9–18, sábado 9–14, domingo cerrado. */
const CLINICA: DiaHorario[] = [
  dia(0, true), dia(1, true), dia(2, true), dia(3, true), dia(4, true),
  dia(5, true, "09:00", "14:00"), dia(6, false),
];

/** Dra. A: nunca los miércoles; los lunes solo de 10 a 14; el sábado «de 8 a 20». */
const DRA_A: DiaHorario[] = [
  dia(0, true, "10:00", "14:00"), dia(1, true), dia(2, false), dia(3, true), dia(4, true),
  dia(5, true, "08:00", "20:00"), dia(6, false),
];

function clinica(horariosDoctores: HorariosDeDoctores): ConfigClinica {
  return {
    timezone: TZ,
    agendaDayStart: 8,
    agendaDayEnd: 20,
    defaultSlotMinutes: 30,
    googleCalendarEnabled: false,
    schedules: CLINICA,
    horariosDoctores,
  };
}

function libre(doctorId: string): Ocupacion {
  return { doctor: [], doctorId, sillones: [], bloqueos: [] };
}

function horas(fecha: string, conf: ConfigClinica, doctorId: string, duracion = 30): string[] {
  return buscarHuecos({
    fecha, duracion, clinica: conf, ocupacion: libre(doctorId), sillonId: null, ahora: AHORA, tope: 100,
  }).huecos.map((h) => h.hora);
}

/** Las horas que ofrecía Sabina ANTES de esta tarea: de apertura a cierre de la clínica. */
function horasDeLaClinica(abre: number, cierra: number, duracion = 30): string[] {
  const out: string[] = [];
  for (let t = abre; t + duracion <= cierra; t += 30) {
    out.push(`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// 1 · SABINA Y «BUSCAR ESPACIO»
// ═══════════════════════════════════════════════════════════════════════

test("doctor SIN horario propio → Sabina y «Buscar espacio» ofrecen exactamente las horas de siempre", () => {
  // El mismo doctor, sin fila, con el mapa vacío y con el de otra doctora.
  const vacio = clinica(SIN_HORARIOS);
  const conOtra = clinica(new Map([["dra-a", DRA_A]]));
  for (const fecha of [LUNES, "2026-11-10", MIERCOLES, "2026-11-12", "2026-11-13", SABADO, "2026-11-15"]) {
    for (const dur of [30, 60]) {
      const a = horas(fecha, vacio, "dr-b", dur);
      const b = horas(fecha, conOtra, "dr-b", dur);
      assert.deepEqual(b, a, `${fecha} ${dur} min`);
    }
  }
  // Y «de siempre» es literal: de apertura a cierre de la clínica.
  assert.deepEqual(horas(LUNES, conOtra, "dr-b"), horasDeLaClinica(9 * 60, 18 * 60));
  assert.deepEqual(horas(SABADO, conOtra, "dr-b"), horasDeLaClinica(9 * 60, 14 * 60));
  assert.deepEqual(horas("2026-11-15", conOtra, "dr-b"), []); // domingo cerrado
});

test("con horario propio → la intersección: lunes de 10 a 14, el miércoles nada, el sábado recortado a la clínica", () => {
  const conf = clinica(new Map([["dra-a", DRA_A]]));
  // Lunes: 10:00 … 13:30 (una de 30 que empieza a las 13:30 termina justo a las 14).
  assert.deepEqual(horas(LUNES, conf, "dra-a"), horasDeLaClinica(10 * 60, 14 * 60));
  // Miércoles: la clínica abre, ella no.
  assert.deepEqual(horas(MIERCOLES, conf, "dra-a"), []);
  // Sábado: dijo «de 8 a 20» y la clínica abre de 9 a 14 → de 9 a 14.
  assert.deepEqual(horas(SABADO, conf, "dra-a"), horasDeLaClinica(9 * 60, 14 * 60));
});

test("evaluarHora: la cita que EMPIEZA al salir la doctora no cabe; la que TERMINA a esa hora, sí", () => {
  const conf = clinica(new Map([["dra-a", DRA_A]]));
  const evalua = (hora: string, duracion = 30) =>
    evaluarHora({ fecha: LUNES, hora, duracion, clinica: conf, ocupacion: libre("dra-a"), sillonId: null, ahora: AHORA });
  assert.equal(evalua("13:30").ok, true);
  const alSalir = evalua("14:00");
  assert.equal(alSalir.ok, false);
  assert.equal((alSalir as { causa: string }).causa, "doctor_no_atiende");
  assert.equal((evalua("13:45") as { causa: string }).causa, "doctor_no_atiende");
  assert.equal((evalua("09:30") as { causa: string }).causa, "doctor_no_atiende");
  assert.equal(evalua("10:00").ok, true);
  // Si la CLÍNICA cierra, se dice eso y no el horario de la doctora.
  assert.equal((evalua("18:00") as { causa: string }).causa, "fuera_de_horario");
});

test("la frase de Sabina dice el horario de la doctora (ya recortado) y no inventa «sin huecos»", () => {
  const conf = clinica(new Map([["dra-a", DRA_A]]));
  const tarde = respuestaNoDisponible({
    causa: "doctor_no_atiende", fecha: LUNES, hora: "15:00", duracion: 30, clinica: conf,
    ocupacion: libre("dra-a"), sillon: null, doctor: "Dra. Ana", ahora: AHORA,
  });
  assert.equal(tarde.estado, "no_disponible");
  assert.match((tarde as { frase: string }).frase, /Dra\. Ana atiende el lunes 9 de noviembre de 10:00 a 14:00/);
  assert.equal((tarde as { alternativas: string[] }).alternativas[0], "13:30"); // la más cercana a las 15:00

  const miercoles = respuestaNoDisponible({
    causa: "doctor_no_atiende", fecha: MIERCOLES, hora: "10:00", duracion: 30, clinica: conf,
    ocupacion: libre("dra-a"), sillon: null, doctor: "Dra. Ana", ahora: AHORA,
  });
  const frase = (miercoles as { frase: string }).frase;
  assert.match(frase, /Dra\. Ana no atiende el miércoles 11 de noviembre\./);
  assert.doesNotMatch(frase, /ya no quedan huecos/);

  // Otra causa (la clínica ya cerró a las 20:00) en su día libre: tampoco
  // «agenda llena»; se dice que ese día no viene.
  const noche = respuestaNoDisponible({
    causa: "fuera_de_horario", fecha: MIERCOLES, hora: "20:00", duracion: 30, clinica: conf,
    ocupacion: libre("dra-a"), sillon: null, doctor: "Dra. Ana", ahora: AHORA,
  });
  assert.match((noche as { frase: string }).frase, /fuera del horario de la clínica.*\(09:00–18:00\)\. Además, Dra\. Ana no atiende ese día\./);
  assert.doesNotMatch((noche as { frase: string }).frase, /ya no quedan huecos/);
});

test("buscarHuecos: el día que la doctora no viene NO se reporta como «clínica cerrada»", () => {
  const conf = clinica(new Map([["dra-a", DRA_A]]));
  const r = buscarHuecos({
    fecha: MIERCOLES, duracion: 30, clinica: conf, ocupacion: libre("dra-a"), sillonId: null, ahora: AHORA,
  });
  assert.equal(r.total, 0);
  // `proponer-horarios` lee `ventana: null` como «la clínica cierra»: aquí no.
  assert.deepEqual(r.ventana, { abre: "09:00", cierra: "18:00" });
  // Con horario, la ventana que se devuelve es la de ella (lo que se barrió).
  assert.deepEqual(
    buscarHuecos({ fecha: LUNES, duracion: 30, clinica: conf, ocupacion: libre("dra-a"), sillonId: null, ahora: AHORA }).ventana,
    { abre: "10:00", cierra: "14:00" },
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 2 · LA CAPACIDAD
// ═══════════════════════════════════════════════════════════════════════

const CARRILES = [
  { id: "dra-a", nombre: "Dra. A", color: "#111" },
  { id: "dr-b", nombre: "Dr. B", color: "#222" },
];

test("la barra de la rejilla: sin horarios, la cuenta de siempre (540 min × 2 carriles)", () => {
  const base = { dayISO: LUNES, citas: [], schedules: CLINICA, timezone: TZ, carriles: CARRILES };
  assert.equal(ocupacionDelDia(base).minutosDisponibles, 1080);
  assert.equal(ocupacionDelDia({ ...base, horariosDoctores: {} }).minutosDisponibles, 1080);
  assert.equal(ocupacionDelDia({ ...base, horariosDoctores: null }).minutosDisponibles, 1080);
});

test("la barra de la rejilla: cada carril aporta SU tiempo (lunes 240 + 540; miércoles 0 + 540)", () => {
  const horariosDoctores = { "dra-a": DRA_A };
  const lunes = ocupacionDelDia({ dayISO: LUNES, citas: [], schedules: CLINICA, timezone: TZ, carriles: CARRILES, horariosDoctores });
  assert.equal(lunes.minutosDisponibles, 240 + 540);
  const miercoles = ocupacionDelDia({ dayISO: MIERCOLES, citas: [], schedules: CLINICA, timezone: TZ, carriles: CARRILES, horariosDoctores });
  assert.equal(miercoles.minutosDisponibles, 540);
  // Por sillón no se aplica: el horario de un doctor no son sillones.
  const porSillon = ocupacionDelDia({
    dayISO: MIERCOLES, citas: [], schedules: CLINICA, timezone: TZ, carriles: CARRILES, horariosDoctores, modo: "resource",
  });
  assert.equal(porSillon.minutosDisponibles, 1080);
});

test("la ocupación de Sabina midiendo a UN doctor: su tiempo, no el de la clínica", () => {
  const base = {
    citas: [],
    horarios: CLINICA,
    horarioGeneral: { agendaDayStart: 8, agendaDayEnd: 20 },
    unidades: 1,
    desdeISO: LUNES,
    hastaISO: "2026-11-15",
    timezone: TZ,
  };
  const antes = calcularOcupacion({ ...base, doctorMedido: "dra-a" });
  const sinFilas = calcularOcupacion({ ...base, doctorMedido: "dra-a", horarioDoctor: null });
  assert.deepEqual(sinFilas, antes, "sin horario propio, idéntico");

  const conHorario = calcularOcupacion({ ...base, doctorMedido: "dra-a", horarioDoctor: DRA_A });
  assert.equal(conHorario.porDia[0].capacidadMinutos, 240); // lunes 10–14
  assert.equal(conHorario.porDia[2].cerrado, true); // miércoles: ella no viene
  assert.equal(conHorario.porDia[2].capacidadMinutos, null);
  assert.equal(conHorario.porDia[5].capacidadMinutos, 300); // sábado recortado a 9–14

  // Midiendo la CLÍNICA (sillones) el horario de un doctor no cuenta.
  const clinicaEntera = calcularOcupacion({ ...base, doctorMedido: null, horarioDoctor: DRA_A });
  assert.deepEqual(clinicaEntera, calcularOcupacion({ ...base, doctorMedido: null }));
});

// ═══════════════════════════════════════════════════════════════════════
// 3 · EL ESTADO DE LA AGENDA
// ═══════════════════════════════════════════════════════════════════════

function payload(extra: Partial<AgendaDayResponse> = {}): AgendaDayResponse {
  return {
    range: { from: "2026-11-09T06:00:00.000Z", to: "2026-11-10T06:00:00.000Z" },
    timezone: TZ,
    slotMinutes: 30,
    dayStart: 8,
    dayEnd: 20,
    appointments: [],
    doctors: [],
    resources: [],
    pendingValidation: [],
    waitlistCount: 0,
    ...extra,
  };
}

test("el reducer guarda horariosDoctores y un payload sin el campo no lo borra", () => {
  assert.deepEqual(buildInitialState(payload(), LUNES).horariosDoctores, {});
  const inicial = buildInitialState(payload({ horariosDoctores: { "dra-a": DRA_A } }), LUNES);
  assert.deepEqual(inicial.horariosDoctores, { "dra-a": DRA_A });
  const recargado = agendaReducer(inicial, { type: "LOAD_DAY", payload: payload(), dayISO: MIERCOLES });
  assert.deepEqual(recargado.horariosDoctores, { "dra-a": DRA_A });
  const tras = agendaReducer(recargado, { type: "SET_HORARIOS_DOCTORES", horariosDoctores: {} });
  assert.deepEqual(tras.horariosDoctores, {});
});
