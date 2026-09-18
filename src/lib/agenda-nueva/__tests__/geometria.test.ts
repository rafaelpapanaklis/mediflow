/**
 * La aritmética de la cuadrícula de la agenda nueva.
 *
 * Lo que se vigila aquí es lo que el README del diseño da masticado y lo que
 * nos ha mordido antes: las cuentas exactas de `top`/`height`, y que la hora
 * salga SIEMPRE de la zona de la clínica y nunca del reloj del proceso.
 *
 * Run: npm run test:agenda-nueva-geometria
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  altoDeCita,
  carrilDeCita,
  comoHora,
  deHora,
  diaEnTz,
  minutosDeAhora,
  minutosEnTz,
  topDeAhora,
  topDeCita,
  topDeHora,
  ventanaDeRejilla,
} from "../geometria";
import { ALTO_HORA } from "../tokens";
import {
  paintedAgendaWindow,
  scheduleDayOfISO,
  type ScheduleDay,
} from "@/lib/agenda/clinic-hours";

const MX = "America/Mexico_City";
/** Una zona sin horario de verano y con media hora de desfase: rompe atajos. */
const INDIA = "Asia/Kolkata";

/* ── Las dos fórmulas del README ───────────────────────────────────────── */

test("topDeCita: (inicio − 8:00)/60 × 112 + 1, tal cual el README", () => {
  // 8:00 → la primera línea, con el +1 de aire.
  assert.equal(topDeCita(8 * 60), 1);
  // 11:00 → 3 h × 112 + 1.
  assert.equal(topDeCita(11 * 60), 3 * ALTO_HORA + 1);
  // 11:30 → media hora más.
  assert.equal(topDeCita(11 * 60 + 30), 3 * ALTO_HORA + 56 + 1);
  // El ejemplo literal del prototipo: 11:20 de «ahora» cae en 373.33.
  assert.ok(Math.abs(topDeAhora(11 * 60 + 20) - 373.333) < 0.01);
});

test("altoDeCita: duración/60 × 112 − 2", () => {
  assert.equal(altoDeCita(60), ALTO_HORA - 2);
  assert.equal(altoDeCita(45), 45 / 60 * ALTO_HORA - 2);
  assert.equal(altoDeCita(30), 54);
  // Una cita de duración rara no puede dar un alto negativo.
  assert.equal(altoDeCita(0), 0);
  assert.equal(altoDeCita(1), 0);
});

test("topDeHora: k · 112 + 6", () => {
  assert.equal(topDeHora(8), 6);
  assert.equal(topDeHora(20), 12 * ALTO_HORA + 6);
});

test("las cuentas respetan un inicio de rejilla distinto de las 8", () => {
  const siete = 7 * 60;
  assert.equal(topDeCita(7 * 60, siete), 1);
  assert.equal(topDeCita(8 * 60, siete), ALTO_HORA + 1);
  assert.equal(topDeHora(7, siete), 6);
});

/* ── La ventana de la rejilla ──────────────────────────────────────────── */

test("ventanaDeRejilla: pinta EXACTAMENTE el rango que recibe, sin estirarlo al 8–20 del diseño", () => {
  // Clínica 9–18: la rejilla arranca a las 9 y acaba a las 18. Ni la hora
  // vacía de 8 a 9 ni las dos de 18 a 20 (lo que pidió Rafael).
  const v = ventanaDeRejilla(9, 18);
  assert.equal(v.horaInicio, 9);
  assert.equal(v.horaFin, 18);
  assert.equal(v.minutoInicio, 540);
  assert.equal(v.alto, 9 * ALTO_HORA + 8);
  assert.deepEqual(v.horas, [9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);

  // La clínica de ejemplo del diseño (8–20) sigue dando el lienzo del README:
  // 12 h × 112 + 8 = 1352.
  const diseno = ventanaDeRejilla(8, 20);
  assert.equal(diseno.alto, 1352);
  assert.equal(diseno.horas.length, 13);
});

test("ventanaDeRejilla: se ensancha con lo que recibe y nunca se sale del día", () => {
  // Abre a las 7 → la rejilla baja a las 7.
  const temprano = ventanaDeRejilla(7, 18);
  assert.equal(temprano.horaInicio, 7);
  assert.equal(temprano.horaFin, 18);

  // Cierra a las 22 → la rejilla sube a las 22.
  const tarde = ventanaDeRejilla(9, 22);
  assert.equal(tarde.horaInicio, 9);
  assert.equal(tarde.horaFin, 22);

  // Horas con fracción: hacia abajo la de arriba, hacia arriba la de abajo.
  const fraccion = ventanaDeRejilla(9.5, 17.25);
  assert.equal(fraccion.horaInicio, 9);
  assert.equal(fraccion.horaFin, 18);

  // Nunca se sale del día ni queda con menos de una hora.
  const extremo = ventanaDeRejilla(-3, 30);
  assert.equal(extremo.horaInicio, 0);
  assert.equal(extremo.horaFin, 24);
  const degenerado = ventanaDeRejilla(12, 12);
  assert.equal(degenerado.horaInicio, 12);
  assert.equal(degenerado.horaFin, 13);

  // Un número que no lo es cae al lienzo del diseño, no a una rejilla vacía.
  const roto = ventanaDeRejilla(Number.NaN, Number.NaN);
  assert.equal(roto.horaInicio, 8);
  assert.equal(roto.horaFin, 20);
});

/* ── Lo que se PINTA, de punta a punta: horario real → rejilla ─────────── */

// `paintedAgendaWindow` (horario del día ensanchado con sus citas) alimenta a
// `ventanaDeRejilla`. Esto prueba la cadena entera con el horario que guarda
// Ajustes (`ClinicSchedule`: 0=Lunes…6=Domingo, "HH:MM").

/** Clínica de siempre: agendaDayStart/End por defecto de la fila Clinic. */
const SIN_HORARIO = { dayStart: 8, dayEnd: 20 };

/** Lunes a viernes 9–18, sábado 9–14, domingo cerrado. */
const HORARIO: ScheduleDay[] = [
  ...[0, 1, 2, 3, 4].map((d) => ({ dayOfWeek: d, enabled: true, openTime: "09:00", closeTime: "18:00" })),
  { dayOfWeek: 5, enabled: true, openTime: "09:00", closeTime: "14:00" },
  { dayOfWeek: 6, enabled: false, openTime: "09:00", closeTime: "14:00" },
];

const MARTES = "2026-09-15"; // martes en México
const SABADO = "2026-09-19";

/** Una cita local de México (UTC−6) a `HH:MM`, de `dur` minutos. */
function cita(dayISO: string, hhmm: string, dur = 30): { startsAt: string; endsAt: string } {
  const [h, m] = hhmm.split(":").map(Number);
  const inicio = Date.UTC(
    Number(dayISO.slice(0, 4)),
    Number(dayISO.slice(5, 7)) - 1,
    Number(dayISO.slice(8, 10)),
    h + 6,
    m,
  );
  return {
    startsAt: new Date(inicio).toISOString(),
    endsAt: new Date(inicio + dur * 60_000).toISOString(),
  };
}

function rejillaDelDia(dayISO: string, schedules: ScheduleDay[], citas: { startsAt: string; endsAt: string }[]) {
  const painted = paintedAgendaWindow({
    fallback: SIN_HORARIO,
    schedules,
    visibleDays: [scheduleDayOfISO(dayISO, MX)],
    appointments: citas,
    onlyDayISO: dayISO,
    timezone: MX,
  });
  return ventanaDeRejilla(painted.dayStart, painted.dayEnd);
}

test("horario normal: clínica 9–18 sin citas raras → la agenda va de 9 a 18 y nada más", () => {
  const v = rejillaDelDia(MARTES, HORARIO, [cita(MARTES, "10:00"), cita(MARTES, "17:00", 60)]);
  assert.equal(v.horaInicio, 9);
  assert.equal(v.horaFin, 18);
  assert.equal(v.horas[0], 9);
  assert.equal(v.horas[v.horas.length - 1], 18);
});

test("cita ANTES de abrir: una urgencia a las 8:00 baja la rejilla a las 8 — nunca se esconde", () => {
  const v = rejillaDelDia(MARTES, HORARIO, [cita(MARTES, "08:00"), cita(MARTES, "10:00")]);
  assert.equal(v.horaInicio, 8);
  assert.equal(v.horaFin, 18);
  // La cita cae DENTRO del lienzo: su top no es negativo.
  assert.equal(topDeCita(8 * 60, v.minutoInicio), 1);
});

test("cita DESPUÉS de cerrar: una que termina a las 19:30 sube la rejilla a las 20", () => {
  const v = rejillaDelDia(MARTES, HORARIO, [cita(MARTES, "18:30", 60)]);
  assert.equal(v.horaInicio, 9);
  assert.equal(v.horaFin, 20);
  // El final de la cita cabe en el alto del lienzo.
  const fondo = topDeCita(18 * 60 + 30, v.minutoInicio) + altoDeCita(60);
  assert.ok(fondo <= v.alto, `la cita se sale del lienzo: ${fondo} > ${v.alto}`);
});

test("clínica SIN horario guardado: se usa la ventana de siempre, nadie se queda sin agenda", () => {
  const v = rejillaDelDia(MARTES, [], [cita(MARTES, "10:00")]);
  assert.equal(v.horaInicio, 8);
  assert.equal(v.horaFin, 20);
  assert.equal(v.alto, 1352);
});

test("por día de la semana: el sábado abre 9–14 → el sábado acaba a las 14", () => {
  const sabado = rejillaDelDia(SABADO, HORARIO, [cita(SABADO, "11:00")]);
  assert.equal(sabado.horaInicio, 9);
  assert.equal(sabado.horaFin, 14);
  // Y el martes de la misma clínica sigue llegando a las 18.
  const martes = rejillaDelDia(MARTES, HORARIO, []);
  assert.equal(martes.horaFin, 18);
});

/* ── La zona horaria de la clínica ─────────────────────────────────────── */

test("minutosEnTz da la hora de PARED de la clínica, no la del proceso", () => {
  // 2026-09-02 17:00 UTC = 11:00 en Ciudad de México (UTC−6).
  const iso = "2026-09-02T17:00:00.000Z";
  assert.equal(minutosEnTz(iso, MX), 11 * 60);
  assert.equal(minutosEnTz(iso, "UTC"), 17 * 60);
  // Media hora de desfase: 22:30 en Kolkata.
  assert.equal(minutosEnTz(iso, INDIA), 22 * 60 + 30);
});

test("diaEnTz: una cita de madrugada UTC sigue siendo del día anterior en México", () => {
  // 03:00 UTC del día 3 = 21:00 del día 2 en Ciudad de México.
  const iso = "2026-09-03T03:00:00.000Z";
  assert.equal(diaEnTz(iso, MX), "2026-09-02");
  assert.equal(diaEnTz(iso, "UTC"), "2026-09-03");
});

test("la línea de «ahora» SOLO se pinta el día de hoy, y en la zona de la clínica", () => {
  const ventana = ventanaDeRejilla(9, 18);
  // 2026-09-02 17:20 UTC = 11:20 en México.
  const ahora = new Date("2026-09-02T17:20:00.000Z");

  assert.equal(
    minutosDeAhora({ dayISO: "2026-09-02", timezone: MX, ventana, ahora }),
    11 * 60 + 20,
  );
  // Otro día: nada.
  assert.equal(minutosDeAhora({ dayISO: "2026-09-03", timezone: MX, ventana, ahora }), null);
  assert.equal(minutosDeAhora({ dayISO: "2026-09-01", timezone: MX, ventana, ahora }), null);
});

test("la línea de «ahora» cambia de DÍA según la zona, no según el servidor", () => {
  // Lienzo de 24 h para que aquí la ÚNICA variable sea el día, no si la hora
  // cabe o no en la rejilla (eso se prueba aparte, más abajo).
  const ventana = ventanaDeRejilla(0, 24);
  // 2026-09-03 04:00 UTC: en México todavía es el 2 (22:00); en UTC ya es el 3.
  const ahora = new Date("2026-09-03T04:00:00.000Z");

  // Con la zona de la CLÍNICA, «ahora» cae en el día 2 a las 22:00.
  assert.equal(minutosDeAhora({ dayISO: "2026-09-02", timezone: MX, ventana, ahora }), 22 * 60);
  assert.equal(minutosDeAhora({ dayISO: "2026-09-03", timezone: MX, ventana, ahora }), null);

  // Con el proceso en UTC —lo que pasa en Vercel— sería el día 3 a las 04:00.
  // Justo al revés. Ésta es la confusión que evita pasar la zona de la clínica.
  assert.equal(minutosDeAhora({ dayISO: "2026-09-03", timezone: "UTC", ventana, ahora }), 4 * 60);
  assert.equal(minutosDeAhora({ dayISO: "2026-09-02", timezone: "UTC", ventana, ahora }), null);
});

test("en un lienzo 9–18, una hora de noche no pinta línea ningún día", () => {
  const ventana = ventanaDeRejilla(9, 18);
  const ahora = new Date("2026-09-03T04:00:00.000Z"); // 22:00 en México
  assert.equal(minutosDeAhora({ dayISO: "2026-09-02", timezone: MX, ventana, ahora }), null);
  assert.equal(minutosDeAhora({ dayISO: "2026-09-03", timezone: MX, ventana, ahora }), null);
});

test("«ahora» fuera del lienzo no se pinta", () => {
  const ventana = ventanaDeRejilla(9, 18);
  // 06:30 en México = 12:30 UTC.
  const temprano = new Date("2026-09-02T12:30:00.000Z");
  assert.equal(minutosDeAhora({ dayISO: "2026-09-02", timezone: MX, ventana, ahora: temprano }), null);
  // 08:30 en México = 14:30 UTC: antes de abrir, ya no hay lienzo ahí.
  const antesDeAbrir = new Date("2026-09-02T14:30:00.000Z");
  assert.equal(minutosDeAhora({ dayISO: "2026-09-02", timezone: MX, ventana, ahora: antesDeAbrir }), null);
});

/* ── Horas ─────────────────────────────────────────────────────────────── */

test("comoHora y deHora se deshacen la una a la otra", () => {
  for (const m of [0, 1, 59, 480, 691, 1080, 1439]) {
    assert.equal(deHora(comoHora(m)), m);
  }
  assert.equal(comoHora(480), "08:00");
  assert.equal(comoHora(1080), "18:00");
});

test("deHora rechaza lo que no es una hora", () => {
  assert.equal(deHora(null), null);
  assert.equal(deHora(""), null);
  assert.equal(deHora("nueve"), null);
  assert.equal(deHora("25:00"), null);
  assert.equal(deHora("08:70"), null);
  assert.equal(deHora("8:00"), 480);
  assert.equal(deHora(" 08:00 "), 480);
});

/* ── Carriles (citas solapadas) ────────────────────────────────────────── */

test("con un solo carril la tarjeta va entera, con los 8 px del diseño", () => {
  assert.deepEqual(carrilDeCita(0, 1), { left: "8px", width: "calc(100% - 16px)" });
});

test("con varios carriles ninguna tarjeta se sale ni se encima", () => {
  for (const n of [2, 3, 4]) {
    for (let i = 0; i < n; i++) {
      const { left, width } = carrilDeCita(i, n);
      assert.ok(left.length > 0 && width.length > 0, `carril ${i}/${n} sin geometría`);
      // El porcentaje de cada carril es el mismo para todos.
      assert.ok(width.includes(`${100 / n}%`), `ancho inesperado en ${i}/${n}: ${width}`);
    }
    // El primero arranca en 0 % (más su margen) y el último no pasa del 100 %.
    assert.ok(carrilDeCita(0, n).left.startsWith("calc(0%"));
    assert.ok(carrilDeCita(n - 1, n).left.includes(`${((n - 1) * 100) / n}%`));
  }
});
