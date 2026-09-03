/**
 * LA REJILLA de la agenda del instituto, sin base de datos ni navegador.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-agenda-rejilla.test.ts
 *       (o `npm run test:edu`, que lo descubre solo)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * QUÉ FIJA ESTE ARCHIVO — las cuatro cosas que, si se rompen, se rompen
 * calladas:
 *
 *  1. EL MODELO DE LECTURA POR SILLÓN respeta la SEDE. Las columnas salen
 *     de los sillones que mandó el servidor (ya recortados por sede) y de
 *     ningún otro sitio; una cita cuyo sillón no está en esa lista no
 *     desaparece, se recoge aparte.
 *  2. LOS CARRILES de las citas encimadas — incluido el caso que el motor
 *     del dental resuelve al revés que aquí: una cancelada no ocupa sillón
 *     pero SÍ ocupa píxeles.
 *  3. EL MAPEO DE ESTADOS a la tarjeta, y que el tema declare de verdad la
 *     clase de cada uno (si no, el estado sale del color de relleno y nadie
 *     se entera).
 *  4. LAS LLAVES DE LA URL. Hay enlaces repartidos por el producto que usan
 *     las siete de siempre; renombrar una es gratis de escribir y rompe
 *     enlaces que nadie puede arreglar.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_SLOT_HPX,
  EDU_AGENDA_DEFAULT_WINDOW,
  EDU_AGENDA_FIT_MIN_SLOT_HPX,
  EDU_AGENDA_SLOT_MINUTES,
  EDU_AGENDA_STATUS_TONE,
  EDU_AGENDA_URL_KEYS,
  EDU_AGENDA_URL_KEYS_HEREDADAS,
  eduAgendaConflicto,
  eduAgendaDrop,
  eduAgendaHref,
  eduAgendaLanes,
  eduAgendaLayout,
  eduAgendaLegend,
  eduAgendaParams,
  eduAgendaSlotAtY,
  eduAgendaSlotLabel,
  eduAgendaSlots,
  eduAgendaVisibleDays,
  eduAgendaWindow,
  eduChairScheduleDays,
  eduChairSinHorario,
  eduProgramColor,
  eduSlotHeightFor,
  eduRowPlacement,
  eduRowStartMinute,
  eduRowToAgendaDTO,
  parseEduAgendaDensity,
  type EduAgendaChair,
} from "../agenda-rejilla";
import {
  eduZonedToUtc,
  parseEduAgendaQuery,
  type EduAgendaQuery,
  type EduAppointmentRow,
} from "../agenda-core";
import { EDU_APPOINTMENT_STATUSES, type EduAppointmentStatus } from "../types";
// Del DENTAL, y solo para leerlo: el piso de "fit" de allá es el que esta
// ola tuvo que dejar de usar. Se importa en vez de copiar el número para
// que la prueba siga diciendo la verdad si allá lo cambian.
import { FIT_MIN_SLOT_HPX } from "@/lib/agenda/slot-metrics";

const CDMX = "America/Mexico_City";
const RAIZ = join(__dirname, "..", "..", "..", "..");
const TEMA = "src/app/instituto/edu-theme.css";

// ─────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────

function sillon(over: Partial<EduAgendaChair> & { id: string }): EduAgendaChair {
  return {
    name: `Sillón ${over.number ?? 1}`,
    number: 1,
    isActive: true,
    orderIndex: 0,
    campusId: "sede-a",
    campusName: "Sede Centro",
    schedules: [],
    ...over,
  };
}

/** Una cita del día 2026-09-02 (miércoles), en la hora de pared que se pida. */
function cita(over: {
  id: string;
  startLabel: string;
  minutes: number;
  chairId?: string;
  studentId?: string;
  programId?: string;
  status?: EduAppointmentStatus;
  dayISO?: string;
}): EduAppointmentRow {
  const dayISO = over.dayISO ?? "2026-09-02";
  const inicio = eduZonedToUtc(dayISO, minutoDe(over.startLabel), CDMX)!;
  const fin = new Date(inicio.getTime() + over.minutes * 60_000);
  return {
    id: over.id,
    startsAt: inicio.toISOString(),
    endsAt: fin.toISOString(),
    dayISO,
    startLabel: over.startLabel,
    endLabel: etiqueta(minutoDe(over.startLabel) + over.minutes),
    minutes: over.minutes,
    type: "TRATAMIENTO",
    status: over.status ?? "SCHEDULED",
    notes: null,
    patientId: `pac-${over.id}`,
    patientName: `Paciente ${over.id}`,
    patientFolio: `P-${over.id}`,
    studentId: over.studentId ?? `alu-${over.id}`,
    studentName: `Estudiante ${over.id}`,
    studentMatricula: `A-${over.id}`,
    studentProgramId: over.programId ?? "prog-endo",
    studentProgramName: "Endodoncia",
    chairId: over.chairId ?? "s1",
    chairName: "Sillón 1",
    chairNumber: 1,
    chairCampusName: "Sede Centro",
    supervisorUserId: null,
    supervisorName: null,
    caseId: null,
    caseStatus: null,
    caseProgramName: null,
  };
}

function minutoDe(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function etiqueta(min: number): string {
  const m = Math.min(24 * 60, min);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function query(over: Partial<EduAgendaQuery> = {}): EduAgendaQuery {
  return {
    view: "dia",
    dayISO: "2026-09-02",
    chairId: null,
    programId: null,
    studentId: null,
    type: null,
    status: null,
    supervisorUserId: null,
    q: null,
    mode: "rejilla",
    ...over,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 1 · EL MODELO DE LECTURA POR SILLÓN Y LA SEDE
// ═══════════════════════════════════════════════════════════════════════

test("las columnas del día salen SOLO de los sillones que mandó el servidor", () => {
  // El recorte por sede lo hizo `eduChairScopeWhere` en el servidor: los
  // sillones de otra sede no llegan a esta lista. La rejilla no puede
  // inventar una columna a partir de una cita — si lo hiciera, bastaría con
  // una fila mal recortada para pintar el piso de otro edificio.
  const chairs = [
    sillon({ id: "s1", number: 1 }),
    sillon({ id: "s2", number: 2, name: "Sillón 2" }),
  ];
  const layout = eduAgendaLayout({
    rows: [cita({ id: "a", startLabel: "09:00", minutes: 60, chairId: "s1" })],
    chairs,
    query: query(),
    days: ["2026-09-02"],
    todayISO: "2026-09-02",
    timezone: CDMX,
    soloUno: false,
  });

  assert.deepEqual(
    layout.columns.map((c) => c.chairId),
    ["s1", "s2"],
    "una columna por sillón de la lista, en su orden, aunque no tenga citas",
  );
  assert.equal(layout.hiddenRows, 0);
});

test("con dos sedes se NOMBRA la sede; con una sola, no", () => {
  const dos = eduAgendaLayout({
    rows: [],
    chairs: [
      sillon({ id: "s1", number: 1 }),
      sillon({ id: "s9", number: 1, campusId: "sede-b", campusName: "Sede Norte" }),
    ],
    query: query(),
    days: ["2026-09-02"],
    todayISO: "2026-09-02",
    timezone: CDMX,
    soloUno: false,
  });
  assert.equal(dos.variasSedes, true);
  assert.ok(
    dos.columns.every((c) => c.sub.includes("Sede")),
    "con dos sedes hay dos «Sillón 1» y sin el nombre de la sede serían dos columnas idénticas",
  );

  const una = eduAgendaLayout({
    rows: [],
    chairs: [sillon({ id: "s1", number: 1 }), sillon({ id: "s2", number: 2 })],
    query: query(),
    days: ["2026-09-02"],
    todayISO: "2026-09-02",
    timezone: CDMX,
    soloUno: false,
  });
  assert.equal(una.variasSedes, false);
  assert.deepEqual(una.columns.map((c) => c.sub), ["", ""]);
});

test("una cita de un sillón que ya no está en la lista NO desaparece", () => {
  const layout = eduAgendaLayout({
    rows: [
      cita({ id: "a", startLabel: "09:00", minutes: 60, chairId: "s1" }),
      cita({ id: "huerfana", startLabel: "10:00", minutes: 60, chairId: "borrado" }),
    ],
    chairs: [sillon({ id: "s1", number: 1 })],
    query: query(),
    days: ["2026-09-02"],
    todayISO: "2026-09-02",
    timezone: CDMX,
    soloUno: false,
  });
  const recogida = layout.columns.find((c) => c.chairId === null);
  assert.ok(recogida, "hace falta una columna de recogida: un paciente citado que nadie ve es peor que una columna fea");
  assert.deepEqual(recogida!.rows.map((r) => r.id), ["huerfana"]);
  assert.equal(layout.hiddenRows, 0);
});

test("el sillón dado de baja se pinta si tiene citas, y se marca", () => {
  const layout = eduAgendaLayout({
    rows: [cita({ id: "a", startLabel: "09:00", minutes: 60, chairId: "viejo" })],
    chairs: [
      sillon({ id: "s1", number: 1 }),
      sillon({ id: "viejo", number: 7, name: "Sillón 7", isActive: false }),
      sillon({ id: "otroviejo", number: 8, name: "Sillón 8", isActive: false }),
    ],
    query: query(),
    days: ["2026-09-02"],
    todayISO: "2026-09-02",
    timezone: CDMX,
    soloUno: false,
  });
  assert.deepEqual(layout.columns.map((c) => c.chairId), ["s1", "viejo"]);
  assert.match(layout.columns[1].sub, /baja/i);
});

test("el filtro de sillón deja UNA columna y lo que queda fuera se declara", () => {
  const layout = eduAgendaLayout({
    rows: [
      cita({ id: "a", startLabel: "09:00", minutes: 60, chairId: "s1" }),
      cita({ id: "b", startLabel: "09:00", minutes: 60, chairId: "s2" }),
    ],
    chairs: [sillon({ id: "s1", number: 1 }), sillon({ id: "s2", number: 2 })],
    query: query({ chairId: "s1" }),
    days: ["2026-09-02"],
    todayISO: "2026-09-02",
    timezone: CDMX,
    soloUno: false,
  });
  assert.equal(layout.columns.length, 1);
  assert.equal(layout.columns[0].chairId, "s1");
  // Sin este contador, la pantalla enseñaría "2 citas" arriba y una sola
  // abajo, sin decir dónde está la otra.
  assert.equal(layout.hiddenRows, 1);
});

test("en el teléfono se pinta UN sillón y se dice cuántos quedan fuera", () => {
  const chairs = [
    sillon({ id: "s1", number: 1 }),
    sillon({ id: "s2", number: 2 }),
    sillon({ id: "s3", number: 3 }),
  ];
  const layout = eduAgendaLayout({
    rows: [cita({ id: "a", startLabel: "09:00", minutes: 60, chairId: "s2" })],
    chairs,
    query: query(),
    days: ["2026-09-02"],
    todayISO: "2026-09-02",
    timezone: CDMX,
    soloUno: true,
  });
  assert.equal(layout.columns.length, 1);
  assert.equal(layout.columns[0].chairId, "s1", "sin ?sillon= se pinta el primero del piso");
  assert.equal(layout.hiddenChairs, 2);

  // Y con la llave puesta manda la URL, no un estado escondido.
  const elegido = eduAgendaLayout({
    rows: [],
    chairs,
    query: query({ chairId: "s3" }),
    days: ["2026-09-02"],
    todayISO: "2026-09-02",
    timezone: CDMX,
    soloUno: true,
  });
  assert.equal(elegido.columns[0].chairId, "s3");
});

test("la semana reparte por DÍA, no por sillón", () => {
  const days = ["2026-08-31", "2026-09-01", "2026-09-02"];
  const layout = eduAgendaLayout({
    rows: [
      cita({ id: "a", startLabel: "09:00", minutes: 60, dayISO: "2026-08-31" }),
      cita({ id: "b", startLabel: "11:00", minutes: 60, dayISO: "2026-09-02" }),
    ],
    chairs: [sillon({ id: "s1", number: 1 })],
    query: query({ view: "semana" }),
    days,
    todayISO: "2026-09-01",
    timezone: CDMX,
    soloUno: false,
  });
  assert.deepEqual(layout.columns.map((c) => c.dayISO), days);
  assert.deepEqual(layout.columns.map((c) => c.rows.length), [1, 0, 1]);
  assert.equal(layout.columns[1].sub, "Hoy");
});

// ═══════════════════════════════════════════════════════════════════════
// 2 · EL EJE: EL HORARIO REAL, ENSANCHADO POR LAS CITAS
// ═══════════════════════════════════════════════════════════════════════

test("el horario del sillón se traduce al convenio del dental (0=lunes)", () => {
  // Miércoles: 3 aquí (0=domingo), 2 allá (0=lunes).
  const dias = eduChairScheduleDays([
    sillon({ id: "s1", schedules: [{ weekday: 3, startMinute: 420, endMinute: 1260 }] }),
  ]);
  assert.deepEqual(dias, [
    { dayOfWeek: 2, enabled: true, openTime: "07:00", closeTime: "21:00" },
  ]);
  // Domingo (0 aquí) es el 6 de allá: si esto se invierte, el eje de un
  // domingo saldría con el horario del lunes.
  assert.equal(
    eduChairScheduleDays([
      sillon({ id: "s1", schedules: [{ weekday: 0, startMinute: 600, endMinute: 720 }] }),
    ])[0].dayOfWeek,
    6,
  );
});

test("una franja al revés o fuera de rango no aporta horario", () => {
  assert.deepEqual(
    eduChairScheduleDays([
      sillon({
        id: "s1",
        schedules: [
          { weekday: 3, startMinute: 600, endMinute: 600 },
          { weekday: 9, startMinute: 60, endMinute: 120 },
        ],
      }),
    ]),
    [],
  );
});

test("el eje pinta el horario REAL y no la jornada por defecto", () => {
  const ventana = eduAgendaWindow({
    chairs: [
      sillon({ id: "s1", schedules: [{ weekday: 3, startMinute: 420, endMinute: 780 }] }),
    ],
    rows: [],
    view: "dia",
    days: ["2026-09-02"], // miércoles
    timezone: CDMX,
  });
  assert.deepEqual(ventana, { dayStart: 7, dayEnd: 13 });
});

test("una cita fuera de horario ENSANCHA el eje en vez de esconderse", () => {
  const ventana = eduAgendaWindow({
    chairs: [
      sillon({ id: "s1", schedules: [{ weekday: 3, startMinute: 540, endMinute: 1080 }] }),
    ],
    rows: [cita({ id: "temprana", startLabel: "07:30", minutes: 60 })],
    view: "dia",
    days: ["2026-09-02"],
    timezone: CDMX,
  });
  assert.equal(ventana.dayStart, 7, "la cita de las 7:30 existe: el alta AVISA, no bloquea");
  assert.equal(ventana.dayEnd, 18);
});

test("sin ningún horario capturado se pinta la jornada de siempre", () => {
  const ventana = eduAgendaWindow({
    chairs: [sillon({ id: "s1" })],
    rows: [],
    view: "dia",
    days: ["2026-09-02"],
    timezone: CDMX,
  });
  assert.deepEqual(ventana, {
    dayStart: EDU_AGENDA_DEFAULT_WINDOW.dayStart,
    dayEnd: EDU_AGENDA_DEFAULT_WINDOW.dayEnd,
  });
  assert.deepEqual(ventana, { dayStart: 8, dayEnd: 20 }, "el respaldo es el mismo 8–20 del dental");
});

test("dos sillones con horarios distintos: el eje es la UNIÓN, a horas completas", () => {
  const ventana = eduAgendaWindow({
    chairs: [
      // 07:45 y 13:10 a propósito: el eje pinta HORAS enteras, así que la
      // apertura baja a las 7 y el cierre sube a las 15 (el otro sillón).
      sillon({ id: "s1", schedules: [{ weekday: 3, startMinute: 465, endMinute: 790 }] }),
      sillon({ id: "s2", schedules: [{ weekday: 3, startMinute: 600, endMinute: 900 }] }),
    ],
    rows: [],
    view: "dia",
    days: ["2026-09-02"], // miércoles
    timezone: CDMX,
  });
  assert.deepEqual(ventana, { dayStart: 7, dayEnd: 15 });
});

test("un sillón SIN horario no se queda con el eje del vecino", () => {
  // El caso de producción: dos sillones, uno con la franja 08:00–14:00 que
  // el editor de Sillones trae escrita por defecto y otro recién dado de
  // alta. El segundo acepta CUALQUIER hora (regla de la Ola 2, la misma que
  // aplica el servidor en eduScheduleAllows), así que el eje no se puede
  // quedar en seis horas: las tardes en las que sí se puede agendar no se
  // verían ni se podrían tocar.
  const ventana = eduAgendaWindow({
    chairs: [
      sillon({ id: "s1", schedules: [{ weekday: 3, startMinute: 480, endMinute: 840 }] }),
      sillon({ id: "s2" }),
    ],
    rows: [],
    view: "dia",
    days: ["2026-09-02"],
    timezone: CDMX,
  });
  assert.deepEqual(ventana, { dayStart: 8, dayEnd: 20 });
  assert.equal(
    eduChairSinHorario(sillon({ id: "s2" })),
    true,
    "sin filas = siempre abierto, igual que en el servidor",
  );
  assert.equal(
    eduChairSinHorario(
      sillon({ id: "s1", schedules: [{ weekday: 3, startMinute: 480, endMinute: 840 }] }),
    ),
    false,
  );
});

test("el sillón siempre abierto ENSANCHA, nunca estrecha", () => {
  // Un sillón que abre 07:00–21:00 y otro sin horario: la jornada por
  // defecto (8–20) no puede recortar al primero.
  const ventana = eduAgendaWindow({
    chairs: [
      sillon({ id: "s1", schedules: [{ weekday: 3, startMinute: 420, endMinute: 1260 }] }),
      sillon({ id: "s2" }),
    ],
    rows: [],
    view: "dia",
    days: ["2026-09-02"],
    timezone: CDMX,
  });
  assert.deepEqual(ventana, { dayStart: 7, dayEnd: 21 });
});

test("una cita fuera de la jornada por defecto también ensancha el eje", () => {
  // Sin ningún horario capturado, el lienzo es 8–20; una cita a las 07:30 y
  // otra que termina a las 21:15 lo abren por las dos puntas. Si el eje se
  // quedara en 8–20, las dos se pintarían fuera de la rejilla.
  const ventana = eduAgendaWindow({
    chairs: [sillon({ id: "s1" })],
    rows: [
      cita({ id: "temprana", startLabel: "07:30", minutes: 30 }),
      cita({ id: "tardia", startLabel: "20:30", minutes: 45 }),
    ],
    view: "dia",
    days: ["2026-09-02"],
    timezone: CDMX,
  });
  assert.deepEqual(ventana, { dayStart: 7, dayEnd: 22 });
});

test("un día que ningún sillón abre conserva el lienzo del horario general", () => {
  // Domingo con sillones de lunes a viernes: no hay franja de ese día, así
  // que se pinta el horario general en vez de dejar el eje sin nada.
  const ventana = eduAgendaWindow({
    chairs: [
      sillon({
        id: "s1",
        schedules: [1, 2, 3, 4, 5].map((weekday) => ({
          weekday,
          startMinute: 540,
          endMinute: 1080,
        })),
      }),
    ],
    rows: [],
    view: "dia",
    days: ["2026-09-06"], // domingo
    timezone: CDMX,
  });
  assert.deepEqual(ventana, { dayStart: 9, dayEnd: 18 });
});

// ═══════════════════════════════════════════════════════════════════════
// 2b · EL ZOOM: "TODO EL DÍA" TIENE QUE CABER DE VERDAD
// ═══════════════════════════════════════════════════════════════════════

test('"Todo el día" reparte el hueco disponible entre los renglones', () => {
  const slots = eduAgendaSlots({ dayStart: 8, dayEnd: 20 }); // 48
  // 1920×1080 medido: 730 px de contenedor − 46 de cabecera − 2 de bordes.
  assert.equal(eduSlotHeightFor("fit", 682, slots), 14);
  assert.ok(48 * 14 <= 682, "lo repartido no puede pasarse del hueco");
  // 1366×768 medido: 418 − 48 = 370.
  assert.equal(eduSlotHeightFor("fit", 370, slots), 7);
  // Teléfono 390×844 medido: 351 − 48 = 303.
  assert.equal(eduSlotHeightFor("fit", 303, slots), 6);
  // Y una jornada larga (07:00–22:00, 60 renglones) en ese mismo teléfono
  // también entra: es el caso que obligó a bajar el piso a 5.
  const largos = eduAgendaSlots({ dayStart: 7, dayEnd: 22 });
  assert.ok(largos * eduSlotHeightFor("fit", 303, largos) <= 303);
});

test('"Todo el día" NO deja desplazamiento donde antes lo dejaba', () => {
  const slots = eduAgendaSlots({ dayStart: 8, dayEnd: 20 });
  for (const hueco of [303, 370, 682, 1052]) {
    assert.ok(
      slots * eduSlotHeightFor("fit", hueco, slots) <= hueco,
      `la jornada de 12 h no cabe en ${hueco} px: eso es justo lo que el preset promete`,
    );
  }
  // El piso del dental (10 px) era el que sobraba: 48 × 10 = 480 px no
  // caben en los 370 que deja una pantalla de 1366×768.
  assert.ok(slots * FIT_MIN_SLOT_HPX > 370, "si esto deja de ser cierto, el piso del dental ya servía");
});

test("por debajo del piso el eje deja de leerse y vuelve el desplazamiento", () => {
  // Una ventana de 24 h (que solo ocurre si una cita la ensancha hasta ahí)
  // en un teléfono: se respeta el piso y reaparece la barra, que es mejor
  // que un eje de rótulos encimados.
  const slots = eduAgendaSlots({ dayStart: 0, dayEnd: 24 }); // 96
  assert.equal(eduSlotHeightFor("fit", 303, slots), EDU_AGENDA_FIT_MIN_SLOT_HPX);
  // 20 px de banda por hora contra un rótulo de 12 px de caja: 8 px de aire.
  // Medido en el navegador, no supuesto (ver el comentario del piso).
  assert.ok(EDU_AGENDA_FIT_MIN_SLOT_HPX * 4 >= 20, "una hora tiene que medir al menos 20 px");
});

test('"Media" y "Amplia" son fijas y salen del dental, no de una copia', () => {
  const slots = eduAgendaSlots({ dayStart: 8, dayEnd: 20 });
  assert.equal(eduSlotHeightFor("medium", 682, slots), 20);
  assert.equal(eduSlotHeightFor("spacious", 682, slots), 30);
  // El alto disponible no las mueve: son las densidades fijas del dental.
  assert.equal(eduSlotHeightFor("medium", 120, slots), 20);
  assert.equal(eduSlotHeightFor("spacious", null, slots), 30);
  // Y con 12 h no caben en ninguna pantalla razonable: ahí SÍ hay que
  // desplazarse, y por eso la cabecera va pegada.
  assert.ok(slots * 20 > 682);
});

test("sin medida todavía, el alto de renglón es el del servidor", () => {
  const slots = eduAgendaSlots({ dayStart: 8, dayEnd: 20 });
  assert.equal(eduSlotHeightFor("fit", null, slots), DEFAULT_SLOT_HPX);
  assert.equal(eduSlotHeightFor("fit", 0, slots), DEFAULT_SLOT_HPX);
});

test("los días visibles son uno en Día y siete en Semana", () => {
  assert.deepEqual(eduAgendaVisibleDays("dia", ["2026-09-02"]), [2]);
  const semana = eduAgendaVisibleDays("semana", [
    "2026-08-31",
    "2026-09-01",
    "2026-09-02",
    "2026-09-03",
    "2026-09-04",
    "2026-09-05",
    "2026-09-06",
  ]);
  assert.equal(semana.length, 7);
  assert.deepEqual([...semana].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6]);
});

test("los renglones de la ventana son cuartos de hora", () => {
  assert.equal(eduAgendaSlots({ dayStart: 8, dayEnd: 20 }), (12 * 60) / EDU_AGENDA_SLOT_MINUTES);
  assert.equal(eduAgendaSlots({ dayStart: 8, dayEnd: 8 }), 1, "nunca cero: no se divide entre cero");
});

// ═══════════════════════════════════════════════════════════════════════
// 3 · DÓNDE CAE UNA TARJETA
// ═══════════════════════════════════════════════════════════════════════

test("la posición sale de la ETIQUETA del servidor, no de un Date del navegador", () => {
  const c = cita({ id: "a", startLabel: "09:30", minutes: 45 });
  assert.equal(eduRowStartMinute(c), 570);
  const sitio = eduRowPlacement(c, { dayStart: 8, dayEnd: 20 });
  assert.equal(sitio.topSlots, 6, "90 minutos desde las 8 = 6 renglones de 15");
  assert.equal(sitio.spanSlots, 3);
  assert.equal(sitio.clipped, false);
});

test("una cita de 10 minutos conserva un alto tocable", () => {
  const sitio = eduRowPlacement({ startLabel: "09:00", minutes: 10 }, { dayStart: 8, dayEnd: 20 });
  assert.equal(sitio.spanSlots, 0.6666666666666666);
  assert.ok(sitio.spanSlots >= 0.5);
});

test("la que cruza la medianoche se recorta y lo DICE", () => {
  const sitio = eduRowPlacement({ startLabel: "23:30", minutes: 120 }, { dayStart: 20, dayEnd: 24 });
  assert.equal(sitio.endMinute, 24 * 60);
  assert.equal(sitio.clipped, true);
  assert.ok(sitio.spanSlots > 0, "el alto nunca es negativo aunque la etiqueta de fin sea menor");
});

// ═══════════════════════════════════════════════════════════════════════
// 4 · LOS CARRILES
// ═══════════════════════════════════════════════════════════════════════

test("dos citas encimadas se reparten el ancho", () => {
  const carriles = eduAgendaLanes([
    cita({ id: "a", startLabel: "09:00", minutes: 60 }),
    cita({ id: "b", startLabel: "09:30", minutes: 60 }),
  ]);
  assert.equal(carriles.get("a")!.laneCount, 2);
  assert.equal(carriles.get("b")!.laneCount, 2);
  assert.notEqual(carriles.get("a")!.lane, carriles.get("b")!.lane);
});

test("las que no se tocan se llevan la columna entera", () => {
  const carriles = eduAgendaLanes([
    cita({ id: "a", startLabel: "09:00", minutes: 60 }),
    // 10:00 empieza justo cuando la otra acaba: el intervalo es [a,b), así
    // que NO chocan. Si chocaran, en una agenda no cabría nada seguido.
    cita({ id: "b", startLabel: "10:00", minutes: 60 }),
  ]);
  assert.equal(carriles.get("a")!.laneCount, 1);
  assert.equal(carriles.get("b")!.laneCount, 1);
});

test("🔴 una CANCELADA no ocupa sillón pero SÍ ocupa píxeles", () => {
  // El motor del dental descarta las canceladas al repartir carriles porque
  // allá no se pintan. Aquí sí: una cancelada dice que ese hueco se liberó.
  // Sin el ajuste, tomaba el ancho entero de la columna y tapaba a la cita
  // que de verdad está ocupando el sillón.
  const carriles = eduAgendaLanes([
    cita({ id: "cancelada", startLabel: "09:00", minutes: 60, status: "CANCELLED" }),
    cita({ id: "viva", startLabel: "09:00", minutes: 60 }),
  ]);
  assert.equal(carriles.size, 2, "la cancelada también recibe carril");
  assert.equal(carriles.get("cancelada")!.laneCount, 2);
  assert.equal(carriles.get("viva")!.laneCount, 2);
  assert.notEqual(carriles.get("cancelada")!.lane, carriles.get("viva")!.lane);
});

// ═══════════════════════════════════════════════════════════════════════
// 5 · ARRASTRAR
// ═══════════════════════════════════════════════════════════════════════

const VENTANA = { dayStart: 8, dayEnd: 20 };

test("bajar dos renglones mueve media hora", () => {
  const row = cita({ id: "a", startLabel: "09:00", minutes: 60 });
  const drop = eduAgendaDrop({
    row,
    deltaY: 60, // 2 renglones de 30 px
    slotHpx: 30,
    window: VENTANA,
    target: { chairId: "s1", dayISO: "2026-09-02" },
  })!;
  assert.equal(drop.startLabel, "09:30");
  assert.equal(drop.endLabel, "10:30");
  assert.equal(drop.minutes, 60, "arrastrar mueve la hora, nunca la duración");
  assert.equal(drop.changed, true);
});

test("🔴 el alto del renglón lo decide el zoom, no una constante", () => {
  const row = cita({ id: "a", startLabel: "09:00", minutes: 60 });
  const comun = { row, deltaY: 60, window: VENTANA, target: { chairId: "s1", dayISO: "2026-09-02" } };
  // Los mismos 60 px arrastrados valen media hora con renglones de 30 px y
  // una hora con renglones de 15. Un número cableado movería la cita a la
  // hora equivocada en cuanto alguien tocara la densidad.
  assert.equal(eduAgendaDrop({ ...comun, slotHpx: 30 })!.startLabel, "09:30");
  assert.equal(eduAgendaDrop({ ...comun, slotHpx: 15 })!.startLabel, "10:00");
  assert.equal(eduAgendaDrop({ ...comun, slotHpx: 10 })!.startLabel, "10:30");
});

test("🔴 arrastrar CONSERVA el desfase: una cita de las 09:10 no se realinea sola", () => {
  const row = cita({ id: "a", startLabel: "09:10", minutes: 50 });
  const comun = { row, slotHpx: 30, window: VENTANA, target: { chairId: "s1", dayISO: "2026-09-02" } };

  // Soltarla donde estaba NO puede proponer otra hora. Con un realineado
  // al cuarto de hora, este mismo caso se proponía a las 09:15: un cambio
  // que nadie pidió, y el diálogo de confirmar abriéndose por un clic.
  const quieta = eduAgendaDrop({ ...comun, deltaY: 0 })!;
  assert.equal(quieta.startLabel, "09:10");
  assert.equal(quieta.changed, false);

  // Y moverla suma cuartos de hora sobre SU hora, no sobre la rejilla.
  assert.equal(eduAgendaDrop({ ...comun, deltaY: 30 })!.startLabel, "09:25");
  assert.equal(eduAgendaDrop({ ...comun, deltaY: -30 })!.startLabel, "08:55");
});

test("no se puede soltar fuera de lo pintado", () => {
  const row = cita({ id: "a", startLabel: "09:00", minutes: 60 });
  const arriba = eduAgendaDrop({
    row,
    deltaY: -3000,
    slotHpx: 30,
    window: VENTANA,
    target: { chairId: "s1", dayISO: "2026-09-02" },
  })!;
  assert.equal(arriba.startLabel, "08:00");

  const abajo = eduAgendaDrop({
    row,
    deltaY: 3000,
    slotHpx: 30,
    window: VENTANA,
    target: { chairId: "s1", dayISO: "2026-09-02" },
  })!;
  // El techo deja la cita ENTERA dentro del eje: 19:00–20:00, no 20:00–21:00.
  assert.equal(abajo.startLabel, "19:00");
  assert.equal(abajo.endLabel, "20:00");
});

test("soltar donde estaba no es reagendar", () => {
  const row = cita({ id: "a", startLabel: "09:00", minutes: 60 });
  const drop = eduAgendaDrop({
    row,
    deltaY: 4, // menos de medio renglón: redondea a cero
    slotHpx: 30,
    window: VENTANA,
    target: { chairId: "s1", dayISO: "2026-09-02" },
  })!;
  assert.equal(drop.changed, false);
});

test("cambiar de columna cambia el sillón (día) o el día (semana)", () => {
  const row = cita({ id: "a", startLabel: "09:00", minutes: 60, chairId: "s1" });
  const otroSillon = eduAgendaDrop({
    row,
    deltaY: 0,
    slotHpx: 30,
    window: VENTANA,
    target: { chairId: "s7", dayISO: "2026-09-02" },
  })!;
  assert.equal(otroSillon.chairId, "s7");
  assert.equal(otroSillon.changed, true);

  const otroDia = eduAgendaDrop({
    row,
    deltaY: 0,
    slotHpx: 30,
    window: VENTANA,
    // En Semana la columna es un día y no trae sillón: se conserva el suyo.
    target: { chairId: null, dayISO: "2026-09-04" },
  })!;
  assert.equal(otroDia.chairId, "s1");
  assert.equal(otroDia.dayISO, "2026-09-04");
});

test("el choque mira el SILLÓN y el ESTUDIANTE, que es lo que mira el servidor", () => {
  const movida = cita({ id: "a", startLabel: "09:00", minutes: 60, chairId: "s1", studentId: "alu-1" });
  const enElSillon = cita({ id: "b", startLabel: "11:00", minutes: 60, chairId: "s2", studentId: "alu-9" });
  const mismoAlumno = cita({ id: "c", startLabel: "13:00", minutes: 60, chairId: "s5", studentId: "alu-1" });
  const rows = [movida, enElSillon, mismoAlumno];

  const aLasOnce = eduAgendaDrop({
    row: movida,
    deltaY: 0,
    slotHpx: 30,
    window: VENTANA,
    target: { chairId: "s2", dayISO: "2026-09-02" },
  })!;
  assert.equal(
    eduAgendaConflicto({ rows, row: movida, drop: { ...aLasOnce, startMinute: 11 * 60, startLabel: "11:00" }, timezone: CDMX }),
    true,
    "ese sillón ya está ocupado a esa hora",
  );

  const aLaUna = eduAgendaDrop({
    row: movida,
    deltaY: 0,
    slotHpx: 30,
    window: VENTANA,
    target: { chairId: "s8", dayISO: "2026-09-02" },
  })!;
  assert.equal(
    eduAgendaConflicto({ rows, row: movida, drop: { ...aLaUna, startMinute: 13 * 60, startLabel: "13:00" }, timezone: CDMX }),
    true,
    "el estudiante no puede estar en dos sillones a la vez",
  );

  const hueco = eduAgendaDrop({
    row: movida,
    deltaY: 0,
    slotHpx: 30,
    window: VENTANA,
    target: { chairId: "s8", dayISO: "2026-09-02" },
  })!;
  assert.equal(
    eduAgendaConflicto({ rows, row: movida, drop: { ...hueco, startMinute: 16 * 60, startLabel: "16:00" }, timezone: CDMX }),
    false,
  );
});

test("una cancelada NO ocupa el sillón para el choque", () => {
  const movida = cita({ id: "a", startLabel: "09:00", minutes: 60, chairId: "s1", studentId: "alu-1" });
  const muerta = cita({
    id: "b",
    startLabel: "11:00",
    minutes: 60,
    chairId: "s2",
    studentId: "alu-9",
    status: "CANCELLED",
  });
  const drop = eduAgendaDrop({
    row: movida,
    deltaY: 0,
    slotHpx: 30,
    window: VENTANA,
    target: { chairId: "s2", dayISO: "2026-09-02" },
  })!;
  assert.equal(
    eduAgendaConflicto({
      rows: [movida, muerta],
      row: movida,
      drop: { ...drop, startMinute: 11 * 60, startLabel: "11:00" },
      timezone: CDMX,
    }),
    false,
    "cancelada y «no llegó» liberan el hueco — la misma regla que EDU_APPOINTMENT_FREE_STATUSES",
  );
});

test("la traducción al motor del dental pone el sillón de recurso y al estudiante de doctor", () => {
  const dto = eduRowToAgendaDTO(
    cita({ id: "a", startLabel: "09:00", minutes: 60, chairId: "s3", studentId: "alu-7" }),
  );
  assert.equal(dto.resourceId, "s3");
  assert.equal(dto.doctor?.id, "alu-7");
  assert.equal(dto.status, "SCHEDULED");
  assert.equal(dto.requiresValidation, false);
  assert.equal(dto.overrideReason, null, "un `overrideReason` haría que detectOverlap se saltara la fila");
});

// ═══════════════════════════════════════════════════════════════════════
// 6 · EL COLOR Y EL ESTADO
// ═══════════════════════════════════════════════════════════════════════

test("cada especialidad tiene su color, estable y con tinta legible", () => {
  const a = eduProgramColor("prog-endo", "Endodoncia");
  const b = eduProgramColor("prog-endo", "Endodoncia");
  assert.equal(a.color, b.color, "el color sale de un hash del id: no se guarda en ninguna columna");
  assert.match(a.color, /^#[0-9a-f]{6}$/i);
  assert.ok(a.ink === "#000000" || a.ink === "#FFFFFF");
  assert.equal(a.initials, "EN");
  assert.notEqual(eduProgramColor("prog-perio", "Periodoncia").color, a.color);
});

test("la leyenda cubre TODO color pintado, también el de fuera del padrón", () => {
  const leyenda = eduAgendaLegend(
    [{ id: "prog-endo", name: "Endodoncia" }],
    [
      cita({ id: "a", startLabel: "09:00", minutes: 60, programId: "prog-endo" }),
      cita({ id: "b", startLabel: "10:00", minutes: 60, programId: "prog-fantasma" }),
    ],
  );
  const ids = leyenda.map((p) => p.id);
  assert.deepEqual(ids, ["prog-endo", "prog-fantasma"]);
  // Un color en pantalla que la leyenda no nombra no se puede ni entender
  // ni filtrar: es la lección de la leyenda de doctores del dental.
  assert.deepEqual(leyenda.map((p) => p.count), [1, 1]);
});

test("una especialidad sin citas sigue en la leyenda, con cero", () => {
  const leyenda = eduAgendaLegend(
    [
      { id: "prog-endo", name: "Endodoncia" },
      { id: "prog-orto", name: "Ortodoncia" },
    ],
    [cita({ id: "a", startLabel: "09:00", minutes: 60, programId: "prog-endo" })],
  );
  assert.deepEqual(leyenda.map((p) => p.count), [1, 0]);
});

test("🔴 los SIETE estados tienen tono, y el tema declara la clase de cada uno", () => {
  const tonos = Object.keys(EDU_AGENDA_STATUS_TONE) as EduAppointmentStatus[];
  assert.deepEqual(
    [...tonos].sort(),
    [...EDU_APPOINTMENT_STATUSES].sort(),
    "EDU_AGENDA_STATUS_TONE es un Record COMPLETO del enum: un estado nuevo tiene que poner rojo a TypeScript, " +
      "no salir pintado del color de relleno",
  );

  const valores = tonos.map((s) => EDU_AGENDA_STATUS_TONE[s]);
  assert.equal(new Set(valores).size, valores.length, "dos estados con el mismo tono no se distinguen en pantalla");

  const css = readFileSync(join(RAIZ, TEMA), "utf8");
  for (const tono of valores) {
    assert.ok(
      css.includes(`.edu-ag__cita--${tono} .edu-ag__cita-punto`),
      `falta .edu-ag__cita--${tono} .edu-ag__cita-punto en edu-theme.css: ese estado pintaría su punto con el color de relleno`,
    );
  }
});

test("el tema declara las clases con las que la tarjeta distingue tamizaje y control", () => {
  const css = readFileSync(join(RAIZ, TEMA), "utf8");
  // Tamizaje es la cita que ABRE el caso y control es la revisión sin
  // tratamiento nuevo: la pantalla vieja ya los distinguía y no se pierde.
  assert.ok(css.includes(".edu-ag__cita--tamizaje {"));
  assert.ok(css.includes(".edu-ag__cita--control {"));
});

test("la rejilla se mide con @container y no con @media", () => {
  const css = readFileSync(join(RAIZ, TEMA), "utf8");
  assert.ok(css.includes("container-name: edu-ag"), "sin nombre de contenedor las consultas no apuntan a nada");
  assert.ok(
    css.includes("@container edu-ag (max-width: 640px)"),
    "el ancho del panel no es el de la ventana: el menú se lleva 252 px en escritorio",
  );
  assert.ok(
    css.includes("max-height: var(--edu-ag-alto)"),
    "sin alto acotado el encabezado sticky no se pega a nada",
  );
});

test("el respaldo del alto de la rejilla se mide contra la ventana, no es un número", () => {
  const css = readFileSync(join(RAIZ, TEMA), "utf8");
  // Un respaldo fijo falla CALLADO: si la medida de la pantalla no llega,
  // en un monitor de 1080 la rejilla se quedaba con 520 px —la mitad de lo
  // que cabía— y "Todo el día" apretaba la jornada entera ahí dentro.
  assert.ok(
    css.includes("--edu-ag-alto: max(320px, calc(100dvh - 300px))"),
    "el respaldo tiene que salir del alto de la ventana",
  );
  assert.ok(
    css.includes("--edu-ag-alto: max(320px, calc(100vh - 300px))"),
    "y dejar un vh de respaldo para navegadores sin dvh",
  );
  assert.ok(
    !/--edu-ag-alto:\s*\d+px;/.test(css),
    "ningún respaldo en píxeles fijos: ese era el bug",
  );
});

test("los rótulos del eje no arrastran interlineado", () => {
  const css = readFileSync(join(RAIZ, TEMA), "utf8");
  // Medido en el navegador: con el interlineado heredado (1.5) el rótulo de
  // 12 px ocupa una caja de 18 px y dos horas seguidas se encabalgan por
  // debajo de 28 px de banda; con `line-height: 1` la caja es de 12 y
  // aguantan hasta 12 px. De ahí sale el piso de "Todo el día".
  const eje = css.slice(css.indexOf(".edu-ag__hora {"), css.indexOf(".edu-ag__media {"));
  assert.ok(eje.includes("line-height: 1;"), "sin esto el piso del zoom deja de ser legible");
});

test("el tema declara las dos puntas del eje, que no se centran en su línea", () => {
  const css = readFileSync(join(RAIZ, TEMA), "utf8");
  // Centrado, el primer rótulo cae media raya DEBAJO de la fila de
  // encabezados (sticky y opaca) y del "08:00" se veía la mitad.
  assert.ok(css.includes(".edu-ag__hora--primera,"));
  assert.ok(css.includes(".edu-ag__hora--ultima {"));
  // Y el eje recorta su propio sobrante: con la pantalla a 1.25x la caja de
  // la rejilla mide 719.6 px y esa fraccion valia dos pixeles de barra en el
  // preset que promete que no hay ninguna. `clip`, no `hidden`: `hidden`
  // convertiria el eje en un contenedor con desplazamiento propio.
  const eje = css.slice(css.indexOf(".edu-ag__eje {"), css.indexOf(".edu-ag__hora {"));
  assert.ok(eje.includes("overflow: clip;"), "sin esto vuelve la barra de dos pixeles");
  assert.ok(!eje.includes("overflow: hidden;"));
});

// ═══════════════════════════════════════════════════════════════════════
// 6 bis · LA GUÍA DEL CURSOR
//
// 🔴 LO ÚNICO QUE IMPORTA AQUÍ: lo que la guía MARCA y lo que el click
// ABRE tienen que ser el mismo renglón. Una guía que dice 12:15 sobre un
// click que agenda a las 12:30 es peor que no marcar nada.
// ═══════════════════════════════════════════════════════════════════════

const REJILLA_TSX = "src/components/edu/agenda/agenda-rejilla.tsx";
const GUIA_TSX = "src/components/edu/agenda/agenda-guia.tsx";

test("el renglón bajo el puntero sale de repartir el alto medido, no de un alto supuesto", () => {
  const slots = eduAgendaSlots(EDU_AGENDA_DEFAULT_WINDOW); // 8–20 → 48
  assert.equal(slots, 48);
  const alto = slots * 30;

  assert.equal(eduAgendaSlotAtY(0, alto, slots), 0, "el techo es el primer renglón");
  assert.equal(eduAgendaSlotAtY(29.9, alto, slots), 0, "casi el borde sigue siendo el de arriba");
  assert.equal(eduAgendaSlotAtY(30, alto, slots), 1, "el borde exacto ya es el de abajo");
  assert.equal(eduAgendaSlotAtY(alto - 0.1, alto, slots), slots - 1);
});

test("fuera de la columna no se inventa un renglón que no existe", () => {
  const slots = 48;
  const alto = 1440;
  // El borde de abajo justo (y = alto) daría el renglón 48, que no existe:
  // se queda en el último. Y por arriba, negativo, en el primero.
  assert.equal(eduAgendaSlotAtY(alto, alto, slots), slots - 1);
  assert.equal(eduAgendaSlotAtY(alto + 500, alto, slots), slots - 1);
  assert.equal(eduAgendaSlotAtY(-40, alto, slots), 0);
  // Y una medida rota (el nodo aún sin pintar) no puede tirar la pantalla.
  assert.equal(eduAgendaSlotAtY(120, 0, slots), 0);
  assert.equal(eduAgendaSlotAtY(120, Number.NaN, slots), 0);
  assert.equal(eduAgendaSlotAtY(120, alto, 0), 0);
});

test("con el renglón fraccionario del zoom, el último píxel sigue siendo el último renglón", () => {
  // La caja de la rejilla a 1.25x de zoom del navegador mide 719.6 px, no
  // 720: el renglón sale a 14.99… y `y / altoDeRenglón` se pasaba de rango
  // en el último píxel. Repartiendo el alto medido, no.
  const slots = 48;
  const alto = 719.6;
  assert.equal(eduAgendaSlotAtY(alto - 0.05, alto, slots), 47);
  assert.equal(eduAgendaSlotAtY(alto / 2, alto, slots), 24);
});

test("la hora del renglón es la del eje, sacada de un entero de minutos", () => {
  const w = EDU_AGENDA_DEFAULT_WINDOW;
  assert.equal(eduAgendaSlotLabel(0, w), "08:00");
  assert.equal(eduAgendaSlotLabel(1, w), "08:15");
  assert.equal(eduAgendaSlotLabel(9, w), "10:15", "el caso de la captura: cuartos, no horas en punto");
  assert.equal(eduAgendaSlotLabel(47, w), "19:45");
  // Y con el eje recortado por el horario de los sillones, el renglón 0 es
  // la hora en que abren, no las ocho.
  assert.equal(eduAgendaSlotLabel(0, { dayStart: 7 }), "07:00");
  assert.equal(eduAgendaSlotLabel(2, { dayStart: 7 }), "07:30");
});

test("🔴 la guía y el click hacen LA MISMA cuenta, y sale de un solo sitio", () => {
  const rejilla = readFileSync(join(RAIZ, REJILLA_TSX), "utf8");
  const guia = readFileSync(join(RAIZ, GUIA_TSX), "utf8");

  for (const [nombre, src] of [
    [REJILLA_TSX, rejilla],
    [GUIA_TSX, guia],
  ] as const) {
    assert.ok(
      src.includes("eduAgendaSlotAtY("),
      `${nombre} tiene que derivar el renglón con eduAgendaSlotAtY: dos cuentas separadas se desincronizan y la guía empieza a mentir`,
    );
    assert.ok(src.includes("eduAgendaSlotLabel("), `${nombre} tiene que escribir la hora con eduAgendaSlotLabel`);
  }

  // El click ya no reparte el alto a mano.
  assert.ok(
    !/Math\.floor\(\(\(e\.clientY/.test(rejilla),
    "volvió la cuenta copiada dentro del componente",
  );
  // Y la guía no se fabrica su propia etiqueta: si formateara aparte, un
  // cambio de formato dejaría al alta y a la marca diciendo cosas distintas.
  assert.ok(!guia.includes("eduMinutesToLabel"), "la guía no formatea horas por su cuenta");
});

test("la guía sabe por el DOM en qué columna está y si ese click abre el alta", () => {
  const rejilla = readFileSync(join(RAIZ, REJILLA_TSX), "utf8");
  const guia = readFileSync(join(RAIZ, GUIA_TSX), "utf8");

  // La columna lo publica…
  assert.ok(rejilla.includes("data-edu-col={index}"));
  assert.ok(rejilla.includes('data-edu-hueco={abreHueco ? "1" : "0"}'));
  // …y la guía lo lee. Sin esto tendría que adivinar la columna por
  // aritmética de anchos, que es justo lo que falla cuando una columna deja
  // de medir lo mismo que las demás.
  assert.ok(guia.includes("dataset.eduCol"));
  assert.ok(guia.includes('dataset.eduHueco === "1"'));

  // Y `abreHueco` es la MISMA condición que gobierna el click, escrita una
  // sola vez: en Semana la columna es un día (chairId null) y el alta
  // necesita un sillón, así que ahí la marca no se disfraza de borrador.
  assert.ok(
    rejilla.includes("const abreHueco = canManage && column.chairId !== null;"),
    "si la condición del click y la de la marca se separan, la guía promete huecos que no se abren",
  );
  assert.ok(rejilla.includes("if (!abreHueco) return;"), "el click tiene que usar la misma condición");
});

test("la guía se borra al desplazarse: pegada a su renglón, mentiría", () => {
  const guia = readFileSync(join(RAIZ, GUIA_TSX), "utf8");
  // La marca se coloca en coordenadas de la rejilla; al rodar la rueda el
  // cursor —que no se movió— pasa a señalar otro renglón y el siguiente
  // click agendaría en uno distinto al marcado.
  assert.ok(guia.includes('addEventListener("scroll"'), "sin esto la guía sobrevive al desplazamiento");
  assert.ok(guia.includes(".edu-ag__scroll"), "el que se desplaza es el contenedor de la rejilla");
});

test("el tema declara la guía, y la pinta DEBAJO de las citas", () => {
  const css = readFileSync(join(RAIZ, TEMA), "utf8");
  assert.ok(css.includes(".edu-ag__guiafila {"), "falta la fila de la guía");
  assert.ok(css.includes(".edu-ag__guiaceld {"), "falta la celda de la guía");
  assert.ok(css.includes(".edu-ag__guiaceld--hueco {"), "falta la variante que sí abre el alta");
  assert.ok(css.includes(".edu-ag__horacursor {"), "falta la hora resaltada sobre el eje");

  // Los bloques que MAQUETAN viven dentro del @media del ratón fino; el
  // primer `.edu-ag__guiafila` de la hoja es el grupo que las apaga.
  const iFila = css.indexOf(".edu-ag__guiafila {");
  const iCeld = css.indexOf(".edu-ag__guiaceld {", iFila);
  const iHueco = css.indexOf(".edu-ag__guiaceld--hueco {", iCeld);
  assert.ok(iFila > 0 && iCeld > iFila && iHueco > iCeld, "los tres bloques, en ese orden");

  // z-index: la tarjeta es 1 y la guía 0. Al revés, la marca taparía las
  // citas justo cuando se está buscando un hueco entre ellas.
  const celda = css.slice(iCeld, iHueco);
  assert.ok(celda.includes("z-index: 0;"));
  assert.ok(celda.includes("pointer-events: none;"), "sin esto la guía le roba el click a la columna");
  const cita = css.slice(css.indexOf(".edu-ag__cita {"), css.indexOf(".edu-ag__cita:hover {"));
  assert.ok(cita.includes("z-index: 1;"), "si la tarjeta baja a 0, la guía empieza a taparla");

  // La fila empieza donde acaba el eje: cruzar la regla la taparía.
  const fila = css.slice(iFila, iCeld);
  assert.ok(fila.includes("left: var(--edu-ag-eje-w);"));
  assert.ok(fila.includes("z-index: 0;"));
  assert.ok(fila.includes("pointer-events: none;"));

  // Y las marcas se colocan contra la FILA, no contra la página.
  const filaFlex = css.slice(css.indexOf(".edu-ag__fila {"), css.indexOf(".edu-ag__fila--cab {"));
  assert.ok(filaFlex.includes("position: relative;"), "sin ancla, la guía se coloca contra el documento");
});

test("la guía no se pinta donde no hay ratón, y se ve en los dos temas", () => {
  const css = readFileSync(join(RAIZ, TEMA), "utf8");
  // En una pantalla táctil no hay "pasar por encima" y el toque ya cae
  // directo: la marca sería un adorno que tapa.
  const apagadas = css.slice(
    css.indexOf(".edu-ag__guiafila,"),
    css.indexOf("@media (hover: hover) and (pointer: fine) {", css.indexOf(".edu-ag__guiafila,")),
  );
  assert.ok(apagadas.includes("display: none;"), "la guía arranca apagada y solo la enciende el ratón fino");

  // El azul de acción del tema claro sobre el #19203a del oscuro daría
  // ~1.4:1: hay token propio y el modo oscuro lo cambia.
  assert.ok(css.includes("--edu-ag-guia: var(--edu-600);"));
  assert.ok(
    /\.dark \.edu-ag__scroll \{\s*--edu-ag-guia:/.test(css),
    "sin el relevo oscuro la guía se vuelve invisible el día que el vertical tenga interruptor",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 7 · LAS LLAVES DE LA URL
// ═══════════════════════════════════════════════════════════════════════

test("🔴 las siete llaves de siempre siguen llamándose igual", () => {
  assert.deepEqual(
    [...EDU_AGENDA_URL_KEYS_HEREDADAS],
    ["vista", "dia", "sillon", "programa", "alumno", "tipo", "estado"],
    "hay enlaces repartidos por el producto que usan estas llaves: renombrar una las rompe todas",
  );
  for (const k of EDU_AGENDA_URL_KEYS_HEREDADAS) {
    assert.ok((EDU_AGENDA_URL_KEYS as readonly string[]).includes(k), `la llave ${k} desapareció`);
  }
  assert.deepEqual(
    EDU_AGENDA_URL_KEYS.filter((k) => !(EDU_AGENDA_URL_KEYS_HEREDADAS as readonly string[]).includes(k)),
    ["docente", "q", "modo"],
    "esta ola AÑADE tres llaves y no toca ninguna de las viejas",
  );
});

test("las siete viejas se leen igual que antes de la ola", () => {
  const q = parseEduAgendaQuery(
    {
      vista: "semana",
      dia: "2026-09-02",
      sillon: "s1",
      programa: "prog-endo",
      alumno: "alu-1",
      tipo: "CONTROL",
      estado: "COMPLETED",
    },
    CDMX,
    new Date("2026-09-01T12:00:00Z"),
  );
  assert.equal(q.view, "semana");
  assert.equal(q.dayISO, "2026-09-02");
  assert.equal(q.chairId, "s1");
  assert.equal(q.programId, "prog-endo");
  assert.equal(q.studentId, "alu-1");
  assert.equal(q.type, "CONTROL");
  assert.equal(q.status, "COMPLETED");
  // Y las nuevas, ausentes, no cambian nada.
  assert.equal(q.supervisorUserId, null);
  assert.equal(q.q, null);
  assert.equal(q.mode, "rejilla");
});

test("las tres llaves nuevas se leen y se sanean", () => {
  const q = parseEduAgendaQuery(
    { docente: "doc-1", q: "  María   Rodríguez ", modo: "lista" },
    CDMX,
    new Date("2026-09-01T12:00:00Z"),
  );
  assert.equal(q.supervisorUserId, "doc-1");
  assert.equal(q.q, "María Rodríguez", "se colapsan los espacios; el escapado de LIKE lo hace eduSearchTokens");
  assert.equal(q.mode, "lista");

  // Un `modo` inventado cae a la rejilla en vez de dejar la pantalla vacía.
  assert.equal(parseEduAgendaQuery({ modo: "diagrama" }, CDMX).mode, "rejilla");
  // Un docente con caracteres raros no llega al `where`.
  assert.equal(parseEduAgendaQuery({ docente: "'; drop table" }, CDMX).supervisorUserId, null);
  // Y un término larguísimo se recorta: no encuentra nada y hace trabajar.
  assert.equal(parseEduAgendaQuery({ q: "x".repeat(400) }, CDMX).q!.length, 80);
});

test("lo vacío no se escribe en la URL", () => {
  const params = eduAgendaParams(query({ view: "dia", dayISO: "2026-09-02" }));
  assert.equal(params.toString(), "vista=dia&dia=2026-09-02");
  // `modo=rejilla` es el default: escribirlo daría dos URLs para lo mismo.
  assert.equal(eduAgendaParams(query({ mode: "rejilla" })).has("modo"), false);
  assert.equal(eduAgendaParams(query({ mode: "lista" })).get("modo"), "lista");
});

test("un cambio conserva el resto de los filtros", () => {
  const actual = query({ chairId: "s1", programId: "prog-endo", q: "ruiz" });
  const href = eduAgendaHref(actual, { dia: "2026-09-09" });
  assert.ok(href.startsWith("/instituto/agenda?"));
  const params = new URLSearchParams(href.split("?")[1]);
  assert.equal(params.get("dia"), "2026-09-09");
  assert.equal(params.get("sillon"), "s1");
  assert.equal(params.get("programa"), "prog-endo");
  assert.equal(params.get("q"), "ruiz");
});

test("limpiar un filtro lo BORRA de la URL", () => {
  const params = eduAgendaParams(query({ chairId: "s1", programId: "prog-endo" }), { programa: "" });
  assert.equal(params.has("programa"), false);
  assert.equal(params.get("sillon"), "s1");
});

test("el zoom guardado se valida antes de usarse", () => {
  assert.equal(parseEduAgendaDensity("fit"), "fit");
  assert.equal(parseEduAgendaDensity("spacious"), "spacious");
  assert.equal(parseEduAgendaDensity("gigante"), null);
  assert.equal(parseEduAgendaDensity(null), null);
});
