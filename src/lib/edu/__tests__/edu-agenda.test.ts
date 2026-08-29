/**
 * LA AGENDA sin base de datos — Ola 2 de DaleControl INSTITUCIONAL.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-agenda.test.ts
 *
 * Lo que fija este archivo es lo que se rompe solo si no se prueba:
 *  1. la HORA — pared del instituto ⇄ instante, con horario de verano;
 *  2. el RANGO — qué es el día y qué es la semana, y que el extremo
 *     derecho sea exclusivo;
 *  3. el CHOQUE — [a,b) medio abierto: 9–10 y 10–11 NO chocan;
 *  4. el HORARIO del sillón — sin filas, siempre abierto;
 *  5. el ESTADO — llegó, se sentó, terminó; y que lo terminado no se
 *     reabra.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EDU_APPOINTMENT_ADMIN_STATUSES,
  EDU_APPOINTMENT_CLINICAL_STATUSES,
  EDU_APPOINTMENT_TRANSITIONS,
  EDU_BUSY_STATUSES,
  EDU_WEEKDAY_SHORT,
  EDU_WEEK_ORDER,
  eduAppointmentCanTransition,
  eduAppointmentStamps,
  eduCleanId,
  eduDayRange,
  eduDescribeSchedule,
  eduFormatTime,
  eduMinutesToLabel,
  eduOptionalText,
  eduOverlaps,
  eduSafeTimeZone,
  eduScheduleAllows,
  eduShiftDayISO,
  eduStatusFreesChair,
  eduStatusNeedsManage,
  eduTodayISO,
  eduUtcToZoned,
  eduWeekDays,
  eduWeekStartISO,
  eduWeekdayOf,
  eduZonedToUtc,
  parseEduAgendaQuery,
  parseEduAppointmentStatus,
  parseEduAppointmentType,
  parseEduCaseStatus,
  parseEduDayISO,
  parseEduDurationMinutes,
  parseEduMinuteOfDay,
} from "../agenda-core";
import { EDU_APPOINTMENT_STATUSES, type EduAppointmentStatus } from "../types";

const CDMX = "America/Mexico_City";
const TIJUANA = "America/Tijuana";
const MADRID = "Europe/Madrid";

// ─────────────────────────────────────────────────────────────────────
// 1 · Hora del día
// ─────────────────────────────────────────────────────────────────────

test("los minutos se pintan con cero a la izquierda", () => {
  assert.equal(eduMinutesToLabel(0), "00:00");
  assert.equal(eduMinutesToLabel(510), "08:30");
  assert.equal(eduMinutesToLabel(8 * 60), "08:00");
  assert.equal(eduMinutesToLabel(23 * 60 + 59), "23:59");
  assert.equal(eduMinutesToLabel(1440), "24:00");
});

test("parseEduMinuteOfDay acepta HH:MM y el entero, y rebota lo demás", () => {
  assert.equal(parseEduMinuteOfDay("08:30"), 510);
  assert.equal(parseEduMinuteOfDay("8:05"), 485);
  assert.equal(parseEduMinuteOfDay(510), 510);
  assert.equal(parseEduMinuteOfDay("24:00"), 1440);
  assert.equal(parseEduMinuteOfDay("25:00"), null);
  assert.equal(parseEduMinuteOfDay("08:60"), null);
  assert.equal(parseEduMinuteOfDay("ocho"), null);
  assert.equal(parseEduMinuteOfDay(-1), null);
  assert.equal(parseEduMinuteOfDay(1441), null);
  assert.equal(parseEduMinuteOfDay(90.5), null);
  assert.equal(parseEduMinuteOfDay(null), null);
});

// ─────────────────────────────────────────────────────────────────────
// 2 · Fecha de calendario
// ─────────────────────────────────────────────────────────────────────

test("parseEduDayISO rebota el 31 de febrero (Date lo 'arreglaría' solo)", () => {
  assert.equal(parseEduDayISO("2026-08-31"), "2026-08-31");
  assert.equal(parseEduDayISO("2026-02-31"), null);
  assert.equal(parseEduDayISO("2026-13-01"), null);
  assert.equal(parseEduDayISO("2026-8-1"), null);
  assert.equal(parseEduDayISO("ayer"), null);
  assert.equal(parseEduDayISO(null), null);
  // Bisiesto de verdad.
  assert.equal(parseEduDayISO("2028-02-29"), "2028-02-29");
  assert.equal(parseEduDayISO("2026-02-29"), null);
});

test("mover días cruza meses y años sin tocar zonas horarias", () => {
  assert.equal(eduShiftDayISO("2026-08-31", 1), "2026-09-01");
  assert.equal(eduShiftDayISO("2026-01-01", -1), "2025-12-31");
  assert.equal(eduShiftDayISO("2026-08-29", 7), "2026-09-05");
});

test("la semana empieza en LUNES, y el domingo pertenece a la que ya empezó", () => {
  // 2026-08-29 es sábado.
  assert.equal(eduWeekdayOf("2026-08-29"), 6);
  assert.equal(eduWeekStartISO("2026-08-29"), "2026-08-24");
  // 2026-08-30 es domingo: NO arranca la semana siguiente.
  assert.equal(eduWeekdayOf("2026-08-30"), 0);
  assert.equal(eduWeekStartISO("2026-08-30"), "2026-08-24");
  assert.equal(eduWeekStartISO("2026-08-31"), "2026-08-31");

  const dias = eduWeekDays("2026-08-30");
  assert.equal(dias.length, 7);
  assert.equal(dias[0], "2026-08-24");
  assert.equal(dias[6], "2026-08-30");
});

test("el orden de los días de la pantalla es la semana laboral primero", () => {
  assert.deepEqual(EDU_WEEK_ORDER, [1, 2, 3, 4, 5, 6, 0]);
  assert.equal(EDU_WEEKDAY_SHORT[1], "Lun");
  assert.equal(EDU_WEEKDAY_SHORT[0], "Dom");
});

// ─────────────────────────────────────────────────────────────────────
// 3 · Zona horaria del instituto
// ─────────────────────────────────────────────────────────────────────

test("una zona ilegible cae a UTC en vez de reventar", () => {
  assert.equal(eduSafeTimeZone(CDMX), CDMX);
  assert.equal(eduSafeTimeZone(""), "UTC");
  assert.equal(eduSafeTimeZone(null), "UTC");
  assert.equal(eduSafeTimeZone("Marte/Olympus"), "UTC");
});

test("las 08:00 del instituto son un instante distinto en cada zona", () => {
  // CDMX está en UTC−6 todo el año (México ya no cambia de horario).
  const cdmx = eduZonedToUtc("2026-08-31", 8 * 60, CDMX);
  assert.equal(cdmx?.toISOString(), "2026-08-31T14:00:00.000Z");

  // Tijuana sí cambia: en agosto está en UTC−7 (horario de verano).
  const tij = eduZonedToUtc("2026-08-31", 8 * 60, TIJUANA);
  assert.equal(tij?.toISOString(), "2026-08-31T15:00:00.000Z");

  // Y una zona ilegible se comporta como UTC, sin reventar.
  const utc = eduZonedToUtc("2026-08-31", 8 * 60, "Marte/Olympus");
  assert.equal(utc?.toISOString(), "2026-08-31T08:00:00.000Z");
});

test("el HORARIO DE VERANO no mueve la hora de pared", () => {
  // Madrid cambia a horario de invierno el último domingo de octubre de
  // 2026 (el 25). Las 09:00 del día 24 y las del 26 son horas de pared
  // idénticas y, sin embargo, instantes con una hora de diferencia. Si la
  // conversión se hiciera con un desfase fijo, una de las dos quedaría
  // movida y la clínica llegaría tarde a media agenda.
  const antes = eduZonedToUtc("2026-10-24", 9 * 60, MADRID);
  const despues = eduZonedToUtc("2026-10-26", 9 * 60, MADRID);
  assert.equal(antes?.toISOString(), "2026-10-24T07:00:00.000Z");
  assert.equal(despues?.toISOString(), "2026-10-26T08:00:00.000Z");

  // Y de vuelta: el instante se lee como las 09:00 en las dos fechas.
  assert.equal(eduFormatTime(antes as Date, MADRID), "09:00");
  assert.equal(eduFormatTime(despues as Date, MADRID), "09:00");
});

test("ida y vuelta: de pared a instante y de vuelta a pared", () => {
  for (const tz of [CDMX, TIJUANA, MADRID, "UTC"]) {
    for (const min of [0, 8 * 60, 13 * 60 + 45, 23 * 60 + 30]) {
      const instante = eduZonedToUtc("2026-08-31", min, tz);
      assert.ok(instante);
      const vuelta = eduUtcToZoned(instante, tz);
      assert.equal(vuelta.dayISO, "2026-08-31", `${tz} @ ${min}`);
      assert.equal(vuelta.minuteOfDay, min, `${tz} @ ${min}`);
    }
  }
});

test("HOY es hoy EN EL INSTITUTO, no en el servidor", () => {
  // 07:00 UTC del 1 de septiembre. En CDMX (UTC−6) todavía es 31 de
  // agosto: si la agenda usara la fecha del servidor, abriría en el día
  // equivocado cada madrugada.
  const instante = new Date("2026-09-01T05:00:00.000Z");
  assert.equal(eduTodayISO("UTC", instante), "2026-09-01");
  assert.equal(eduTodayISO(CDMX, instante), "2026-08-31");
  assert.equal(eduTodayISO(TIJUANA, instante), "2026-08-31");
});

test("el rango del día va de medianoche a medianoche DEL INSTITUTO y el fin es exclusivo", () => {
  const r = eduDayRange("2026-08-31", CDMX);
  assert.ok(r);
  assert.equal(r.from.toISOString(), "2026-08-31T06:00:00.000Z");
  assert.equal(r.to.toISOString(), "2026-09-01T06:00:00.000Z");
  // 24 horas exactas, y el extremo derecho es el arranque del día
  // siguiente: con `lte` una cita de las 00:00 saldría en los dos días.
  assert.equal(r.to.getTime() - r.from.getTime(), 24 * 60 * 60 * 1000);

  const semana = eduDayRange("2026-08-24", CDMX, 7);
  assert.ok(semana);
  assert.equal(semana.to.toISOString(), "2026-08-31T06:00:00.000Z");
});

test("un día ilegible no produce un rango (y la pantalla no consulta)", () => {
  assert.equal(eduDayRange("2026-02-31", CDMX), null);
});

// ─────────────────────────────────────────────────────────────────────
// 4 · El choque
// ─────────────────────────────────────────────────────────────────────

function h(hhmm: string): Date {
  return new Date(`2026-08-31T${hhmm}:00.000Z`);
}

test("[a,b) medio abierto: 9–10 y 10–11 NO chocan", () => {
  assert.equal(eduOverlaps(h("09:00"), h("10:00"), h("10:00"), h("11:00")), false);
  assert.equal(eduOverlaps(h("10:00"), h("11:00"), h("09:00"), h("10:00")), false);
});

test("se pisan cuando comparten un minuto, en cualquier orden", () => {
  assert.equal(eduOverlaps(h("09:00"), h("10:00"), h("09:59"), h("11:00")), true);
  assert.equal(eduOverlaps(h("09:00"), h("12:00"), h("10:00"), h("11:00")), true); // contenida
  assert.equal(eduOverlaps(h("10:00"), h("11:00"), h("09:00"), h("12:00")), true); // contenedora
  assert.equal(eduOverlaps(h("09:00"), h("10:00"), h("09:00"), h("10:00")), true); // idéntica
});

test("cancelada y 'no llegó' liberan el sillón; terminada NO", () => {
  assert.equal(eduStatusFreesChair("CANCELLED"), true);
  assert.equal(eduStatusFreesChair("NO_SHOW"), true);
  assert.equal(eduStatusFreesChair("COMPLETED"), false);
  assert.equal(eduStatusFreesChair("SCHEDULED"), false);

  // La lista que va en el `where` del choque es exactamente la
  // complementaria: si se escribiera a mano en dos consultas, una acabaría
  // contando las canceladas y la otra no.
  assert.deepEqual(
    [...EDU_BUSY_STATUSES].sort(),
    EDU_APPOINTMENT_STATUSES.filter((s) => !eduStatusFreesChair(s)).sort(),
  );
  assert.equal(EDU_BUSY_STATUSES.includes("CANCELLED"), false);
  assert.equal(EDU_BUSY_STATUSES.includes("COMPLETED"), true);
});

// ─────────────────────────────────────────────────────────────────────
// 5 · El horario del sillón
// ─────────────────────────────────────────────────────────────────────

test("SIN FILAS = SIEMPRE ABIERTO (y no al revés)", () => {
  assert.equal(eduScheduleAllows([], 1, 8 * 60, 9 * 60), true);
  assert.equal(eduScheduleAllows([], 0, 3 * 60, 4 * 60), true);
});

test("con horario, un día SIN franjas está cerrado", () => {
  const lunesAViernes = [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    startMinute: 8 * 60,
    endMinute: 14 * 60,
  }));
  assert.equal(eduScheduleAllows(lunesAViernes, 1, 8 * 60, 9 * 60), true);
  // Domingo: hay horario, pero no ese día.
  assert.equal(eduScheduleAllows(lunesAViernes, 0, 8 * 60, 9 * 60), false);
});

test("la cita tiene que caber ENTERA en UNA franja", () => {
  const partido = [
    { weekday: 1, startMinute: 8 * 60, endMinute: 12 * 60 },
    { weekday: 1, startMinute: 16 * 60, endMinute: 20 * 60 },
  ];
  assert.equal(eduScheduleAllows(partido, 1, 8 * 60, 12 * 60), true, "el borde exacto cabe");
  assert.equal(eduScheduleAllows(partido, 1, 16 * 60, 17 * 60), true);
  // De 11:30 a 12:30: la mitad cae en el hueco de la comida.
  assert.equal(eduScheduleAllows(partido, 1, 11 * 60 + 30, 12 * 60 + 30), false);
  // De 11 a 17 cruza las dos franjas Y el hueco: tampoco.
  assert.equal(eduScheduleAllows(partido, 1, 11 * 60, 17 * 60), false);
  // Antes de abrir.
  assert.equal(eduScheduleAllows(partido, 1, 7 * 60, 8 * 60), false);
});

test("el horario se describe agrupando los días de la misma franja", () => {
  assert.equal(eduDescribeSchedule([]), "Sin horario: acepta cualquier hora");
  const texto = eduDescribeSchedule([
    { weekday: 3, startMinute: 480, endMinute: 840 },
    { weekday: 1, startMinute: 480, endMinute: 840 },
    { weekday: 6, startMinute: 540, endMinute: 720 },
  ]);
  // Los días salen en el orden de la semana laboral, no en el que llegaron.
  assert.equal(texto, "Lun, Mié 08:00–14:00 · Sáb 09:00–12:00");
});

// ─────────────────────────────────────────────────────────────────────
// 6 · El estado de la cita
// ─────────────────────────────────────────────────────────────────────

test("los tres estados finales no tienen salida: lo terminado no se reabre", () => {
  for (const s of ["COMPLETED", "CANCELLED", "NO_SHOW"] as EduAppointmentStatus[]) {
    assert.deepEqual(EDU_APPOINTMENT_TRANSITIONS[s], [], `${s} tiene salida`);
    for (const destino of EDU_APPOINTMENT_STATUSES) {
      assert.equal(eduAppointmentCanTransition(s, destino), false, `${s} → ${destino}`);
    }
  }
});

test("el camino normal del sillón está abierto de punta a punta", () => {
  assert.equal(eduAppointmentCanTransition("SCHEDULED", "CHECKED_IN"), true);
  assert.equal(eduAppointmentCanTransition("CHECKED_IN", "IN_CHAIR"), true);
  assert.equal(eduAppointmentCanTransition("IN_CHAIR", "IN_PROGRESS"), true);
  assert.equal(eduAppointmentCanTransition("IN_PROGRESS", "COMPLETED"), true);
  // El atajo que pasa de verdad: el paciente llega y el alumno lo sienta
  // de una vez, sin tocar "llegó".
  assert.equal(eduAppointmentCanTransition("SCHEDULED", "IN_CHAIR"), true);
});

test("no se puede saltar hacia atrás ni quedarse donde ya se está", () => {
  assert.equal(eduAppointmentCanTransition("IN_CHAIR", "SCHEDULED"), false);
  assert.equal(eduAppointmentCanTransition("IN_PROGRESS", "CHECKED_IN"), false);
  assert.equal(eduAppointmentCanTransition("SCHEDULED", "COMPLETED"), false);
  for (const s of EDU_APPOINTMENT_STATUSES) {
    assert.equal(eduAppointmentCanTransition(s, s), false, `${s} → ${s}`);
  }
});

test("todo destino declarado existe en el catálogo de estados", () => {
  for (const [origen, destinos] of Object.entries(EDU_APPOINTMENT_TRANSITIONS)) {
    assert.ok(EDU_APPOINTMENT_STATUSES.includes(origen as EduAppointmentStatus), origen);
    for (const d of destinos) {
      assert.ok(EDU_APPOINTMENT_STATUSES.includes(d), `${origen} → ${d} no existe`);
    }
  }
});

test("cancelar y 'no llegó' exigen agenda.manage; lo del sillón, no", () => {
  // Ésta es la razón de que /mi-dia sirva de algo: un ALUMNO solo trae
  // agenda.view y aun así puede apuntar lo que pasa en su sillón.
  for (const s of EDU_APPOINTMENT_CLINICAL_STATUSES) {
    assert.equal(eduStatusNeedsManage(s), false, `${s} no debería exigir agenda.manage`);
  }
  for (const s of EDU_APPOINTMENT_ADMIN_STATUSES) {
    assert.equal(eduStatusNeedsManage(s), true, `${s} debería exigir agenda.manage`);
  }
  // Y entre los dos grupos cubren todo lo que se puede marcar a mano.
  assert.deepEqual(
    [...EDU_APPOINTMENT_CLINICAL_STATUSES, ...EDU_APPOINTMENT_ADMIN_STATUSES].sort(),
    EDU_APPOINTMENT_STATUSES.filter((s) => s !== "SCHEDULED").sort(),
  );
});

test("las marcas de tiempo se derivan del estado y NO se pisan", () => {
  const now = new Date("2026-08-31T15:00:00.000Z");
  const vacio = { checkedInAt: null, startedAt: null, completedAt: null };

  assert.deepEqual(eduAppointmentStamps("CHECKED_IN", vacio, now), { checkedInAt: now });

  // Sentarse implica haber llegado: se rellenan las dos.
  assert.deepEqual(eduAppointmentStamps("IN_CHAIR", vacio, now), {
    checkedInAt: now,
    startedAt: now,
  });

  // Terminar implica haber empezado.
  assert.deepEqual(eduAppointmentStamps("COMPLETED", vacio, now), {
    startedAt: now,
    completedAt: now,
  });

  // Lo YA escrito no se toca: quien llegó a las 9:02 llegó a las 9:02.
  const llego = new Date("2026-08-31T14:02:00.000Z");
  assert.deepEqual(eduAppointmentStamps("IN_CHAIR", { ...vacio, checkedInAt: llego }, now), {
    startedAt: now,
  });

  // Cancelar y "no llegó" no escriben ninguna marca clínica.
  assert.deepEqual(eduAppointmentStamps("CANCELLED", vacio, now), {});
  assert.deepEqual(eduAppointmentStamps("NO_SHOW", vacio, now), {});
});

// ─────────────────────────────────────────────────────────────────────
// 7 · Saneo de lo que entra
// ─────────────────────────────────────────────────────────────────────

test("los enums solo aceptan sus propios valores", () => {
  assert.equal(parseEduAppointmentType("TAMIZAJE"), "TAMIZAJE");
  assert.equal(parseEduAppointmentType("URGENCIA"), null);
  assert.equal(parseEduAppointmentStatus("IN_CHAIR"), "IN_CHAIR");
  assert.equal(parseEduAppointmentStatus("DROP TABLE"), null);
  assert.equal(parseEduCaseStatus("ON_HOLD"), "ON_HOLD");
  assert.equal(parseEduCaseStatus(42), null);
});

test("la duración tiene tope por arriba y por abajo", () => {
  assert.equal(parseEduDurationMinutes(60), 60);
  assert.equal(parseEduDurationMinutes("45"), 45);
  assert.equal(parseEduDurationMinutes(9), null);
  assert.equal(parseEduDurationMinutes(481), null);
  assert.equal(parseEduDurationMinutes(30.5), null);
  assert.equal(parseEduDurationMinutes("una hora"), null);
});

test("un id del cliente se recorta y se rechaza si trae basura", () => {
  assert.equal(eduCleanId(" abc_123 "), "abc_123");
  assert.equal(eduCleanId("a".repeat(41)), null);
  assert.equal(eduCleanId("con espacio"), null);
  assert.equal(eduCleanId("'; DROP TABLE"), null);
  assert.equal(eduCleanId(""), null);
  assert.equal(eduCleanId(123), null);
});

test("un texto opcional distingue 'no lo toques' de 'bórralo'", () => {
  assert.equal(eduOptionalText(undefined, 100), undefined, "undefined = no lo toques");
  assert.equal(eduOptionalText(null, 100), null, "null = bórralo");
  assert.equal(eduOptionalText("   ", 100), null, "vacío = bórralo");
  assert.equal(eduOptionalText("  hola  ", 100), "hola");
  assert.equal(eduOptionalText("x".repeat(300), 100)?.length, 100);
});

// ─────────────────────────────────────────────────────────────────────
// 8 · Lo que se lee de la URL
// ─────────────────────────────────────────────────────────────────────

test("la query de la agenda descarta lo que no reconoce", () => {
  const now = new Date("2026-08-31T18:00:00.000Z");
  const q = parseEduAgendaQuery(
    {
      vista: "semana",
      dia: "2026-09-02",
      sillon: "ch_1",
      programa: "pr_1",
      alumno: "st_1",
      tipo: "TAMIZAJE",
      estado: "IN_CHAIR",
    },
    CDMX,
    now,
  );
  assert.deepEqual(q, {
    view: "semana",
    dayISO: "2026-09-02",
    chairId: "ch_1",
    programId: "pr_1",
    studentId: "st_1",
    type: "TAMIZAJE",
    status: "IN_CHAIR",
  });

  const basura = parseEduAgendaQuery(
    { vista: "mes", dia: "2026-02-31", sillon: "'; DROP", tipo: "URGENCIA", estado: "X" },
    CDMX,
    now,
  );
  assert.equal(basura.view, "dia", "una vista desconocida cae en 'día'");
  assert.equal(basura.dayISO, "2026-08-31", "un día ilegible cae en HOY del instituto");
  assert.equal(basura.chairId, null);
  assert.equal(basura.type, null);
  assert.equal(basura.status, null);
});

test("sin query, la agenda abre en HOY del instituto (no del servidor)", () => {
  // 05:00 UTC del 1 de septiembre: en CDMX todavía es 31 de agosto.
  const now = new Date("2026-09-01T05:00:00.000Z");
  assert.equal(parseEduAgendaQuery(null, CDMX, now).dayISO, "2026-08-31");
  assert.equal(parseEduAgendaQuery(undefined, "UTC", now).dayISO, "2026-09-01");
});

test("la query NO lee ningún institutionId (el tenant sale de la sesión)", () => {
  const q = parseEduAgendaQuery(
    { institutionId: "inst_ajeno", institution: "inst_ajeno" },
    CDMX,
    new Date("2026-08-31T18:00:00.000Z"),
  ) as unknown as Record<string, unknown>;
  assert.equal("institutionId" in q, false);
  for (const v of Object.values(q)) {
    assert.notEqual(v, "inst_ajeno");
  }
});
