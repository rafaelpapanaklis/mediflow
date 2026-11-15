/* ═══════════════════════════════════════════════════════════════════════
   LA REJILLA DE LA AGENDA: posición ↔ hora, el hueco bajo el mouse, si
   ahí se puede agendar, a dónde cae lo que se arrastra y lo que se alarga.

     npx tsx --test "src/components/barber/agenda/__tests__/rejilla.test.ts"

   México (Ciudad de México) es UTC-6 todo el año desde 2022.
   ═══════════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BARBER_DAY_PX_PER_MIN,
  BARBER_WEEK_PX_PER_MIN,
  shopLocalToUtc,
  type BusyAppointmentLike,
  type ScheduleLike,
  type TimeOffLike,
} from "@/lib/barber/agenda";
import {
  EDGE_SCROLL_MAX_PX,
  LONG_PRESS_MS,
  complementWindows,
  edgeScrollDelta,
  freeBarbersAt,
  halfHourLabel,
  minuteAtOffset,
  moveStartMinute,
  quickActions,
  resizeDuration,
  rulerMarks,
  slotAtOffset,
  slotIssueText,
  slotVerdict,
  touchGesture,
  weekClosedBands,
  type SlotContext,
} from "../rejilla";

const TZ = "America/Mexico_City";
const DAY = "2026-11-16"; // lunes
const DAY_START = shopLocalToUtc(DAY, 0, TZ).getTime();
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(DAY_START + (h * 60 + m) * 60_000).toISOString();
};
const min = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

// Beto trabaja lunes 10–14 y 16–20 (turno partido). Ana no tiene horario.
const schedules: ScheduleLike[] = [
  { barberId: "beto", dayOfWeek: 1, startMinute: min("10:00"), endMinute: min("14:00"), isActive: true },
  { barberId: "beto", dayOfWeek: 1, startMinute: min("16:00"), endMinute: min("20:00"), isActive: true },
];
const timeOff: TimeOffLike[] = [
  { id: "comida", barberId: "beto", startAt: at("12:00"), endAt: at("12:30"), reason: "Comida" },
];
const appointments: BusyAppointmentLike[] = [
  { id: "a1", barberId: "beto", startAt: at("10:30"), endAt: at("11:00"), status: "CONFIRMED" },
  { id: "a2", barberId: "beto", startAt: at("11:00"), endAt: at("11:30"), status: "CANCELLED" },
];
const ctx: SlotContext = { timezone: TZ, schedules, timeOff, appointments };

test("el horario de prueba usa las columnas reales de ScheduleLike", () => {
  // Si el contrato cambia de nombre de campos, estas pruebas mentirían.
  const verdict = slotVerdict(ctx, { barberId: "beto", dayStartUtc: DAY_START, startMin: min("15:00"), durationMin: 15 });
  assert.equal(verdict.ok, false, "15:00 está entre turnos: fuera de horario");
  assert.equal(verdict.issue, "OUTSIDE_SCHEDULE");
});

// ── Posición ↔ hora ──────────────────────────────────────────────────
test("slotAtOffset: el hueco en el que CAE el puntero, hacia abajo", () => {
  const base = { boundsStart: min("09:00"), boundsEnd: min("21:00"), pxPerMin: BARBER_DAY_PX_PER_MIN };
  // 10:07 → 10:00 ; 10:16 → 10:15 (el criterio del dental)
  assert.equal(slotAtOffset({ ...base, offsetY: (min("10:07") - min("09:00")) * 2 }), min("10:00"));
  assert.equal(slotAtOffset({ ...base, offsetY: (min("10:16") - min("09:00")) * 2 }), min("10:15"));
  // justo en la línea de las 10:30 → 10:30
  assert.equal(slotAtOffset({ ...base, offsetY: 90 * 2 }), min("10:30"));
});

test("slotAtOffset: acotado a la rejilla (ni antes de abrir ni el colchón de abajo)", () => {
  const base = { boundsStart: min("09:00"), boundsEnd: min("21:00"), pxPerMin: 2 };
  assert.equal(slotAtOffset({ ...base, offsetY: -30 }), min("09:00"));
  assert.equal(slotAtOffset({ ...base, offsetY: 99_999 }), min("20:45"));
});

test("slotAtOffset en Semana (1.1 px/min) cae en el mismo hueco que el minuto real", () => {
  const base = { boundsStart: min("08:00"), boundsEnd: min("20:00"), pxPerMin: BARBER_WEEK_PX_PER_MIN };
  for (const hhmm of ["08:00", "08:14", "08:15", "13:44", "13:45", "19:59"]) {
    const offsetY = (min(hhmm) - min("08:00")) * BARBER_WEEK_PX_PER_MIN + 0.01;
    const expected = Math.floor(min(hhmm) / 15) * 15;
    assert.equal(slotAtOffset({ ...base, offsetY }), Math.min(expected, min("19:45")), hhmm);
  }
});

test("minuteAtOffset es la inversa de la posición", () => {
  assert.equal(minuteAtOffset(120, min("09:00"), 2), min("10:00"));
});

// ── Validación del hueco (la misma función del servidor) ─────────────
test("hueco libre dentro del horario: vale", () => {
  const v = slotVerdict(ctx, { barberId: "beto", dayStartUtc: DAY_START, startMin: min("11:00"), durationMin: 30 });
  assert.equal(v.ok, true, "la cancelada de las 11:00 no bloquea");
});

test("antes de abrir: fuera de su horario", () => {
  const v = slotVerdict(ctx, { barberId: "beto", dayStartUtc: DAY_START, startMin: min("09:30"), durationMin: 15 });
  assert.equal(v.issue, "OUTSIDE_SCHEDULE");
  assert.deepEqual(slotIssueText(v, ctx), { key: "barber.agenda.slot.outside" });
});

test("bloqueo del barbero: dice el motivo", () => {
  const v = slotVerdict(ctx, { barberId: "beto", dayStartUtc: DAY_START, startMin: min("12:15"), durationMin: 15 });
  assert.equal(v.issue, "TIME_OFF");
  assert.deepEqual(slotIssueText(v, ctx), {
    key: "barber.agenda.slot.timeOffReason",
    vars: { reason: "Comida" },
  });
});

test("barbería cerrada (bloqueo sin barbero): se dice distinto", () => {
  const closed: SlotContext = {
    ...ctx,
    timeOff: [{ id: "fest", barberId: null, startAt: at("00:00"), endAt: at("23:59"), reason: null }],
  };
  const v = slotVerdict(closed, { barberId: "ana", dayStartUtc: DAY_START, startMin: min("10:00"), durationMin: 15 });
  assert.deepEqual(slotIssueText(v, closed), { key: "barber.agenda.slot.shopClosed" });
});

test("ocupado: nombra a quién y a qué hora", () => {
  const v = slotVerdict(ctx, { barberId: "beto", dayStartUtc: DAY_START, startMin: min("10:45"), durationMin: 15 });
  assert.equal(v.issue, "OVERLAP");
  assert.deepEqual(
    slotIssueText(v, { ...ctx, clientNameOf: (id) => (id === "a1" ? "Juan" : null) }),
    { key: "barber.agenda.slot.busyWith", vars: { client: "Juan", time: "10:30 a. m." } },
  );
  assert.deepEqual(slotIssueText(v, ctx), {
    key: "barber.agenda.slot.busyAt",
    vars: { time: "10:30 a. m." },
  });
});

test("una visita que se mueve no choca consigo misma", () => {
  const v = slotVerdict(ctx, {
    barberId: "beto",
    dayStartUtc: DAY_START,
    startMin: min("10:45"),
    durationMin: 30,
    excludeAppointmentId: "a1",
  });
  assert.equal(v.ok, true);
});

test("barbero sin horario cargado: se le agenda a cualquier hora (matiz del servidor)", () => {
  const v = slotVerdict(ctx, { barberId: "ana", dayStartUtc: DAY_START, startMin: min("07:00"), durationMin: 30 });
  assert.equal(v.ok, true);
});

test("Semana: quién está libre, en orden", () => {
  const args = { dayStartUtc: DAY_START, startMin: min("10:30"), durationMin: 15 };
  assert.deepEqual(freeBarbersAt(ctx, ["beto", "ana"], args), ["ana"]);
  assert.deepEqual(freeBarbersAt(ctx, ["beto", "ana"], { ...args, startMin: min("11:00") }), ["beto", "ana"]);
});

// ── Arrastrar / alargar ──────────────────────────────────────────────
test("moveStartMinute: la hora bajo el puntero menos el agarre, en la rejilla de 15", () => {
  const b = { boundsStart: min("09:00"), boundsEnd: min("21:00") };
  // agarrada 10 min por debajo de su inicio, puntero a las 11:12 → 11:02 → 11:00
  assert.equal(moveStartMinute({ ...b, pointerMin: min("11:12"), grabOffsetMin: 10 }), min("11:00"));
  assert.equal(moveStartMinute({ ...b, pointerMin: min("11:20"), grabOffsetMin: 10 }), min("11:15"));
  assert.equal(moveStartMinute({ ...b, pointerMin: min("08:00"), grabOffsetMin: 0 }), min("09:00"));
  assert.equal(moveStartMinute({ ...b, pointerMin: min("23:00"), grabOffsetMin: 0 }), min("20:45"));
  // una de 30 min no se suelta asomándose fuera de la rejilla (20:45–21:15)
  assert.equal(
    moveStartMinute({ ...b, pointerMin: min("23:00"), grabOffsetMin: 0, durationMin: 30 }),
    min("20:30"),
  );
  // una de 40 min: el último inicio en la rejilla de 15 que la deja caber
  assert.equal(
    moveStartMinute({ ...b, pointerMin: min("23:00"), grabOffsetMin: 0, durationMin: 40 }),
    min("20:15"),
  );
});

test("halfHourLabel: reloj de 12 h como la regleta", () => {
  assert.equal(halfHourLabel(min("09:30")), "9:30");
  assert.equal(halfHourLabel(min("13:30")), "1:30");
  assert.equal(halfHourLabel(min("00:30")), "12:30");
});

test("resizeDuration: pasos de 5 min, entre 5 y 480 (los del servidor)", () => {
  assert.equal(resizeDuration({ startMin: min("10:00"), pointerMin: min("10:44") }), 45);
  assert.equal(resizeDuration({ startMin: min("10:00"), pointerMin: min("10:41") }), 40);
  assert.equal(resizeDuration({ startMin: min("10:00"), pointerMin: min("09:00") }), 5);
  assert.equal(resizeDuration({ startMin: min("10:00"), pointerMin: min("23:59") }), 480);
});

test("edgeScrollDelta: quieto en medio, sube y baja en los bordes", () => {
  assert.equal(edgeScrollDelta(300, 100, 700), 0);
  assert.ok(edgeScrollDelta(110, 100, 700) < 0);
  assert.ok(edgeScrollDelta(690, 100, 700) > 0);
  assert.equal(edgeScrollDelta(40, 100, 700), -EDGE_SCROLL_MAX_PX);
  assert.equal(edgeScrollDelta(900, 100, 700), EDGE_SCROLL_MAX_PX);
});

test("touchGesture: mantener apretado para mover; moverse antes es scroll", () => {
  assert.equal(touchGesture(100, 2), "wait");
  assert.equal(touchGesture(LONG_PRESS_MS, 2), "drag");
  assert.equal(touchGesture(100, 20), "scroll");
  assert.equal(touchGesture(LONG_PRESS_MS + 200, 20), "scroll");
});

// ── Franjas ──────────────────────────────────────────────────────────
test("complementWindows: lo rayado de un turno partido", () => {
  assert.deepEqual(
    complementWindows(
      [{ start: min("16:00"), end: min("20:00") }, { start: min("10:00"), end: min("14:00") }],
      { start: min("09:00"), end: min("21:00") },
    ),
    [
      { start: min("09:00"), end: min("10:00") },
      { start: min("14:00"), end: min("16:00") },
      { start: min("20:00"), end: min("21:00") },
    ],
  );
});

test("weekClosedBands: raya lo que NADIE trabaja; con alguien sin horario, nada", () => {
  const bounds = { start: min("09:00"), end: min("21:00") };
  assert.equal(weekClosedBands(schedules, ["beto"], 1, bounds).length, 3);
  assert.deepEqual(weekClosedBands(schedules, ["beto"], 0, bounds), [bounds], "domingo no trabaja");
  assert.deepEqual(weekClosedBands(schedules, ["beto", "ana"], 1, bounds), []);
});

test("rulerMarks: medias horas en Día, solo horas en Semana", () => {
  const b = { start: min("09:00"), end: min("11:00") };
  assert.deepEqual(
    rulerMarks(b, BARBER_DAY_PX_PER_MIN).map((m) => m.kind),
    ["hour", "half", "hour", "half", "hour"],
  );
  assert.deepEqual(rulerMarks(b, BARBER_WEEK_PX_PER_MIN).map((m) => m.kind), ["hour", "hour", "hour"]);
});

// ── Acciones rápidas: los permisos de siempre ────────────────────────
const base = {
  barberId: "beto",
  canEdit: true,
  ownBarberId: null as string | null,
  canCharge: true,
  charged: false,
  source: "PANEL",
  canAcceptRequests: true,
};

test("quien edita: el siguiente paso del flujo", () => {
  assert.equal(quickActions({ ...base, status: "PENDING" }).advance, "CONFIRMED");
  assert.equal(quickActions({ ...base, status: "CONFIRMED" }).advance, "IN_PROGRESS");
  assert.equal(quickActions({ ...base, status: "IN_PROGRESS" }).advance, "DONE");
  assert.equal(quickActions({ ...base, status: "DONE" }).advance, null);
});

test("completar encadena con cobrar si hay caja; completada sin ticket ofrece cobrar", () => {
  assert.equal(quickActions({ ...base, status: "IN_PROGRESS" }).chargeOnDone, true);
  assert.equal(quickActions({ ...base, status: "IN_PROGRESS", canCharge: false }).chargeOnDone, false);
  assert.equal(quickActions({ ...base, status: "DONE" }).charge, true);
  assert.equal(quickActions({ ...base, status: "DONE", charged: true }).charge, false);
  assert.equal(quickActions({ ...base, status: "CANCELLED" }).charge, false);
  assert.equal(quickActions({ ...base, status: "NO_SHOW" }).charge, false);
});

test("rol Barbero: solo En silla / Completada y solo en SUS visitas", () => {
  const barbero = { ...base, canEdit: false, ownBarberId: "beto", canCharge: false };
  assert.equal(quickActions({ ...barbero, status: "PENDING" }).advance, null, "confirmar es de recepción");
  assert.equal(quickActions({ ...barbero, status: "CONFIRMED" }).advance, "IN_PROGRESS");
  assert.equal(quickActions({ ...barbero, status: "IN_PROGRESS" }).advance, "DONE");
  assert.equal(
    quickActions({ ...barbero, status: "CONFIRMED", barberId: "otro" }).advance,
    null,
    "la visita de otro barbero no la avanza",
  );
  assert.equal(quickActions({ ...barbero, status: "CONFIRMED", barberId: null }).advance, null);
});

test("sin permisos: nada", () => {
  const nadie = { ...base, canEdit: false, ownBarberId: null, canCharge: false };
  for (const status of ["PENDING", "CONFIRMED", "IN_PROGRESS", "DONE"] as const) {
    const q = quickActions({ ...nadie, status });
    assert.equal(q.advance, null, status);
    assert.equal(q.charge, false, status);
  }
});

// ── Ronda 2, M1: una SOLICITUD web/bot no se «confirma»: se acepta ────
// Confirmarla por la ruta de estado se saltaba resolveBookingRequest, el
// cliente nunca recibía «quedó agendada» y luego sí le llegaba el recordatorio.
for (const source of ["PUBLIC", "WHATSAPP"] as const) {
  test(`solicitud ${source} pendiente: nunca «Confirmar»; «Aceptar solicitud» con requests.manage`, () => {
    const q = quickActions({ ...base, status: "PENDING", source });
    assert.equal(q.advance, null, "no se ofrece CONFIRMED por la ruta de estado");
    assert.equal(q.isRequest, true);
    assert.equal(q.accept, true);
    assert.equal(q.viewRequests, false);
  });

  test(`solicitud ${source} sin requests.manage: «Ver en Solicitudes», sin Confirmar`, () => {
    const q = quickActions({ ...base, status: "PENDING", source, canAcceptRequests: false });
    assert.equal(q.advance, null);
    assert.equal(q.accept, false);
    assert.equal(q.viewRequests, true);
  });

  test(`solicitud ${source}: ni el rol Barbero ni quien solo mira reciben nada`, () => {
    const barbero = { ...base, canEdit: false, ownBarberId: "beto", canCharge: false, canAcceptRequests: false };
    const q = quickActions({ ...barbero, status: "PENDING", source });
    assert.deepEqual([q.advance, q.accept, q.viewRequests], [null, false, false]);
  });

  test(`${source} ya aceptada (Confirmada) sigue el flujo normal: «Iniciar»`, () => {
    const q = quickActions({ ...base, status: "CONFIRMED", source });
    assert.equal(q.isRequest, false);
    assert.equal(q.advance, "IN_PROGRESS");
    assert.equal(q.accept, false);
  });
}

test("Pendiente agendada en el panel (no es solicitud): «Confirmar» como siempre", () => {
  for (const source of ["PANEL", "WALKIN"]) {
    const q = quickActions({ ...base, status: "PENDING", source });
    assert.equal(q.advance, "CONFIRMED", source);
    assert.equal(q.isRequest, false, source);
    assert.equal(q.accept, false, source);
  }
});
