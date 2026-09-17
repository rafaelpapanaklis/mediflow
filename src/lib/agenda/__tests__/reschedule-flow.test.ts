/**
 * Mover una cita arrastrándola: la lógica que comparten la agenda de siempre y
 * la agenda nueva (`reschedule-flow.ts`).
 *
 * Run: npm run test:reschedule-flow
 *
 * Lo que NO puede pasar, y es lo que muerde aquí: que el servidor diga que no
 * y la cita se quede pintada en el hueco nuevo mientras en la base sigue en el
 * viejo. Las pruebas de rechazo corren con el REDUCTOR DE VERDAD de la agenda
 * (`agendaReducer`), no con un doble: si mañana alguien quita el
 * `ROLLBACK_RESCHEDULE` o lo rompe dentro del reductor, esto sale en rojo.
 *
 * Todas las horas son de la clínica (America/Mexico_City, UTC−6 en septiembre),
 * y ninguna prueba depende de la zona del proceso: en Vercel corre en UTC.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  commitReschedule,
  planReschedule,
  reschedulePayload,
  type PlanRescheduleInput,
} from "../reschedule-flow";
import { agendaReducer, buildInitialState } from "../store";
import type { ApiError, RescheduleAppointmentInput } from "../mutations";
import type { AgendaAppointmentDTO, AgendaStoreState } from "../types";

const TZ = "America/Mexico_City";
const DIA = "2026-09-24";

/** `HH:MM` del 24-sep en la clínica → ISO UTC. */
function hora(hhmm: string, dia = DIA): string {
  const [h, m] = hhmm.split(":").map(Number);
  const [y, mo, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(y!, mo! - 1, d!, h! + 6, m!)).toISOString();
}

function cita(over: Partial<AgendaAppointmentDTO> & { id: string }): AgendaAppointmentDTO {
  return {
    startsAt: hora("10:00"),
    endsAt: hora("10:45"),
    status: "CONFIRMED",
    patient: { id: `p-${over.id}`, name: "Zutanita Pruebas" },
    doctor: { id: "doc-a", shortName: "Dra. Díaz" },
    reason: "Resina",
    resourceId: "u1",
    source: "STAFF",
    requiresValidation: false,
    overrideReason: null,
    ...over,
  };
}

function estadoCon(citas: AgendaAppointmentDTO[]): AgendaStoreState {
  return buildInitialState(
    {
      range: { from: hora("00:00"), to: hora("23:59") },
      timezone: TZ,
      slotMinutes: 15,
      dayStart: 8,
      dayEnd: 20,
      schedules: [],
      appointments: citas,
      doctors: [],
      resources: [],
      pendingValidation: [],
      waitlistCount: 0,
    },
    DIA,
  );
}

/** 112 px por hora → un hueco de 15 min mide 28 px. */
const HUECO_PX = 28;

function plan(over: Partial<PlanRescheduleInput> & Pick<PlanRescheduleInput, "original">): ReturnType<typeof planReschedule> {
  return planReschedule({
    target: { kind: "doctor-col", columnKey: "doctor:doc-a", doctorId: "doc-a", resourceId: null },
    deltaY: 0,
    slotHpx: HUECO_PX,
    slotMinutes: 15,
    dayStart: 8,
    dayEnd: 20,
    currentDayISO: DIA,
    timezone: TZ,
    appointments: [over.original],
    ...over,
  });
}

/* ── Dónde cae ──────────────────────────────────────────────────────────── */

test("bajar dos huecos mueve la cita 30 min y conserva su duración", () => {
  const original = cita({ id: "c1" });
  const p = plan({ original, deltaY: 2 * HUECO_PX });
  assert.equal(p.newStartsAt, hora("10:30"));
  assert.equal(p.newEndsAt, hora("11:15"));
  assert.equal(p.unchanged, false);
  assert.equal(p.overlap, false);
});

test("el desplazamiento se redondea al hueco más cercano, no a minutos sueltos", () => {
  const original = cita({ id: "c1" });
  // 1,4 huecos → 1 hueco; 1,6 → 2.
  assert.equal(plan({ original, deltaY: 1.4 * HUECO_PX }).newStartsAt, hora("10:15"));
  assert.equal(plan({ original, deltaY: 1.6 * HUECO_PX }).newStartsAt, hora("10:30"));
});

test("un temblor de ratón sobre su propia columna no es un movimiento", () => {
  const original = cita({ id: "c1" });
  const p = plan({ original, deltaY: 9 });
  assert.equal(p.unchanged, true);
});

test("soltar en la columna de otro doctor cambia el doctor y conserva el sillón", () => {
  const original = cita({ id: "c1" });
  const p = plan({
    original,
    target: { kind: "doctor-col", columnKey: "doctor:doc-b", doctorId: "doc-b", resourceId: null },
  });
  assert.equal(p.newDoctorId, "doc-b");
  assert.equal(p.newResourceId, "u1");
  assert.equal(p.unchanged, false);
  assert.deepEqual(reschedulePayload(p), {
    startsAt: hora("10:00"),
    endsAt: hora("10:45"),
    doctorId: "doc-b",
  });
});

test("soltar en otro día (Semana) conserva la hora y el doctor", () => {
  const original = cita({ id: "c1" });
  const p = plan({ original, target: { kind: "day-col", dayISO: "2026-09-25" } });
  assert.equal(p.toDayISO, "2026-09-25");
  assert.equal(p.newStartsAt, hora("10:00", "2026-09-25"));
  assert.equal(p.newDoctorId, "doc-a");
  assert.deepEqual(reschedulePayload(p), {
    startsAt: hora("10:00", "2026-09-25"),
    endsAt: hora("10:45", "2026-09-25"),
  });
});

test("soltar en la columna de otro sillón (agenda de siempre, «Por sillón») cambia el sillón y no el doctor", () => {
  const original = cita({ id: "c1" });
  const p = plan({
    original,
    target: { kind: "resource-col", columnKey: "resource:u2", doctorId: null, resourceId: "u2" },
  });
  assert.equal(p.newResourceId, "u2");
  assert.equal(p.newDoctorId, "doc-a");
  assert.equal(p.unchanged, false);
  assert.deepEqual(reschedulePayload(p), {
    startsAt: hora("10:00"),
    endsAt: hora("10:45"),
    resourceId: "u2",
  });
});

test("columna unificada: solo cambia la hora; una cita sin doctor nunca manda doctorId", () => {
  const sinDoctor = cita({ id: "c1", doctor: undefined, resourceId: null });
  const p = plan({
    original: sinDoctor,
    deltaY: 2 * HUECO_PX,
    target: { kind: "unified-col", columnKey: "unified", doctorId: null, resourceId: null },
  });
  assert.equal(p.newDoctorId, null);
  assert.equal(p.newResourceId, null);
  assert.deepEqual(reschedulePayload(p), { startsAt: hora("10:30"), endsAt: hora("11:15") });
});

test("choca con otra cita viva del mismo doctor; una cancelada no estorba", () => {
  const original = cita({ id: "c1" });
  const vecina = cita({ id: "c2", startsAt: hora("11:00"), endsAt: hora("11:30"), resourceId: "u2" });
  const conVecina = plan({ original, deltaY: 4 * HUECO_PX, appointments: [original, vecina] });
  assert.equal(conVecina.overlap, true);

  const cancelada = { ...vecina, status: "CANCELLED" as const };
  const sinVecina = plan({ original, deltaY: 4 * HUECO_PX, appointments: [original, cancelada] });
  assert.equal(sinVecina.overlap, false);
});

test("no se sale de la rejilla: al fondo se queda pegada a la última hora", () => {
  const original = cita({ id: "c1" });
  const p = plan({ original, deltaY: 400 * HUECO_PX });
  assert.equal(p.newEndsAt <= hora("20:00"), true);
  assert.equal(p.newStartsAt, hora("19:15"));
});

/* ── Lo que se guarda ───────────────────────────────────────────────────── */

test("si el servidor acepta, la cita queda como la devuelve el servidor", async () => {
  const original = cita({ id: "c1" });
  const otra = cita({ id: "c2", startsAt: hora("12:00"), endsAt: hora("12:30") });
  let estado = estadoCon([original, otra]);
  const p = plan({ original, deltaY: 4 * HUECO_PX });

  const delServidor = { ...original, startsAt: hora("11:00"), endsAt: hora("11:45"), reason: "Resina (servidor)" };
  const enviado: RescheduleAppointmentInput[] = [];

  const r = await commitReschedule(p, {
    dispatch: (a) => {
      estado = agendaReducer(estado, a);
    },
    reschedule: async (id, input) => {
      assert.equal(id, "c1");
      enviado.push(input);
      return { appointment: delServidor, scheduleWarning: null };
    },
  });

  assert.equal(r.ok, true);
  assert.deepEqual(enviado, [{ startsAt: hora("11:00"), endsAt: hora("11:45") }]);
  assert.deepEqual(estado.appointments.find((a) => a.id === "c1"), delServidor);
  assert.deepEqual(estado.appointments.find((a) => a.id === "c2"), otra);
});

test("🔴 si el servidor dice que no, la cita VUELVE a su hora original", async () => {
  const original = cita({ id: "c1" });
  const otra = cita({ id: "c2", startsAt: hora("12:00"), endsAt: hora("12:30"), doctor: { id: "doc-b", shortName: "Dr. Jorge" } });
  let estado = estadoCon([original, otra]);
  // Del Dr. A a las 10:00 → al Dr. B a las 11:00: cambia hora Y columna.
  const p = plan({
    original,
    deltaY: 4 * HUECO_PX,
    target: { kind: "doctor-col", columnKey: "doctor:doc-b", doctorId: "doc-b", resourceId: null },
    appointments: [original, otra],
  });

  const rechazo: ApiError = {
    status: 422,
    error: "appointment_in_past",
    reason: "No se puede mover una cita al pasado.",
  };

  let mientrasTanto: AgendaAppointmentDTO | undefined;
  const r = await commitReschedule(p, {
    dispatch: (a) => {
      estado = agendaReducer(estado, a);
    },
    reschedule: async () => {
      // Mientras el servidor piensa, la pantalla ya la enseña en el hueco nuevo.
      mientrasTanto = estado.appointments.find((a) => a.id === "c1");
      throw rechazo;
    },
  });

  assert.equal(mientrasTanto?.startsAt, hora("11:00"), "el movimiento optimista tiene que verse");
  assert.equal(mientrasTanto?.doctor?.id, "doc-b");

  assert.equal(r.ok, false);
  assert.equal(r.ok ? null : r.error, rechazo, "el rechazo llega entero para poder decir por qué");

  const despues = estado.appointments.find((a) => a.id === "c1");
  assert.deepEqual(despues, original, "la cita tiene que volver EXACTA: hora, fin, doctor y sillón");
  assert.equal(despues?.startsAt, hora("10:00"));
  assert.equal(despues?.doctor?.id, "doc-a");
  assert.deepEqual(estado.appointments.find((a) => a.id === "c2"), otra, "las demás no se tocan");
});

test("🔴 sin conexión también vuelve: un fallo de red no deja la cita a medias", async () => {
  const original = cita({ id: "c1" });
  let estado = estadoCon([original]);
  const p = plan({ original, deltaY: -2 * HUECO_PX });

  const r = await commitReschedule(p, {
    dispatch: (a) => {
      estado = agendaReducer(estado, a);
    },
    reschedule: async () => {
      throw new TypeError("Failed to fetch");
    },
  });

  assert.equal(r.ok, false);
  assert.deepEqual(estado.appointments, [original]);
});

test("un 403 (sin permiso) vuelve igual y conserva el código para explicarlo", async () => {
  const original = cita({ id: "c1" });
  let estado = estadoCon([original]);
  const p = plan({ original, deltaY: 2 * HUECO_PX });
  const sinPermiso: ApiError = { status: 403, error: "Permiso requerido: agenda.edit" };

  const r = await commitReschedule(p, {
    dispatch: (a) => {
      estado = agendaReducer(estado, a);
    },
    reschedule: async () => {
      throw sinPermiso;
    },
  });

  assert.equal(r.ok, false);
  assert.equal(r.ok ? null : (r.error as ApiError).status, 403);
  assert.deepEqual(estado.appointments, [original]);
});
