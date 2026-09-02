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
  EDU_AGENDA_DEFAULT_WINDOW,
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
  eduAgendaSlots,
  eduAgendaVisibleDays,
  eduAgendaWindow,
  eduChairScheduleDays,
  eduProgramColor,
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
  assert.ok(css.includes("height: var(--edu-ag-alto)"), "sin alto acotado el encabezado sticky no se pega a nada");
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
