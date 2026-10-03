// ws1-t1 (auditoría BEVADENT, F14) — «Avisar al paciente» al EDITAR y al ARRASTRAR una cita.
// Con el código de antes: no existe `aviso-al-reprogramar`, `reschedulePayload` no acepta el aviso, y ninguna de las
// cuatro ventanas pinta la casilla ni manda `notifyPatient: false`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  campoDelAviso,
  cambiaLaHoraDeLaCita,
  estadoDelAvisoReprogramar,
  seOfreceLaCasilla,
  textosAvisoReprogramar,
} from "../aviso-al-reprogramar";
import { commitReschedule, reschedulePayload, type ReschedulePlan } from "../reschedule-flow";
import type { AgendaAppointmentDTO } from "../types";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("el ajuste de la clínica: conectada y encendido → encendido; apagado → apagado; sin WhatsApp → sinWhatsApp", () => {
  assert.equal(estadoDelAvisoReprogramar({ clinic: { waConnected: true, waNotifyOnReschedule: true } }), "encendido");
  assert.equal(estadoDelAvisoReprogramar({ clinic: { waConnected: true, waNotifyOnReschedule: false } }), "apagado");
  assert.equal(estadoDelAvisoReprogramar({ clinic: { waConnected: false, waNotifyOnReschedule: true } }), "sinWhatsApp");
  // Un servidor viejo (sin el campo) o una respuesta rota: no se sabe → no se pinta nada.
  assert.equal(estadoDelAvisoReprogramar({ clinic: { waConnected: true } }), null);
  assert.equal(estadoDelAvisoReprogramar(null), null);
  assert.equal(estadoDelAvisoReprogramar({}), null);
});

test("solo cambia la hora si cambia el instante de inicio", () => {
  assert.equal(cambiaLaHoraDeLaCita("2026-10-05T16:00:00.000Z", "2026-10-05T16:30:00.000Z"), true);
  assert.equal(cambiaLaHoraDeLaCita("2026-10-05T16:00:00.000Z", "2026-10-05T16:00:00Z"), false);
  assert.equal(cambiaLaHoraDeLaCita("2026-10-05T16:00:00.000Z", null), false);
  assert.equal(cambiaLaHoraDeLaCita("basura", "2026-10-05T16:00:00Z"), false);
});

test("la casilla se ofrece solo con la hora cambiada y el aviso encendido", () => {
  assert.equal(seOfreceLaCasilla("encendido", true), true);
  assert.equal(seOfreceLaCasilla("encendido", false), false);
  assert.equal(seOfreceLaCasilla("apagado", true), false);
  assert.equal(seOfreceLaCasilla("sinWhatsApp", true), false);
  assert.equal(seOfreceLaCasilla(null, true), false);
});

test("desmarcada viaja notifyPatient:false; marcada o sin casilla el cuerpo queda como siempre", () => {
  assert.deepEqual(campoDelAviso("encendido", true, false), { notifyPatient: false });
  assert.deepEqual(campoDelAviso("encendido", true, true), {});
  assert.deepEqual(campoDelAviso("encendido", false, false), {}, "sin cambio de hora no hay aviso que callar");
  assert.deepEqual(campoDelAviso("apagado", true, false), {});
  assert.deepEqual(campoDelAviso(null, true, false), {});
});

test("textos en español y en inglés", () => {
  assert.match(textosAvisoReprogramar("es").casilla, /Avisar al paciente/);
  assert.match(textosAvisoReprogramar("en-US").casilla, /Notify the patient/);
  assert.equal(textosAvisoReprogramar(undefined).casilla, textosAvisoReprogramar("es").casilla);
});

const original = {
  id: "cita_1",
  startsAt: "2026-10-05T16:00:00.000Z",
  endsAt: "2026-10-05T16:30:00.000Z",
  status: "SCHEDULED",
  patient: { id: "pac_1", name: "Paciente Ficticio" },
  doctor: { id: "doc_1", shortName: "Dra. Prueba" },
  resourceId: null,
} as unknown as AgendaAppointmentDTO;
const plan: ReschedulePlan = {
  original,
  newStartsAt: "2026-10-05T17:00:00.000Z",
  newEndsAt: "2026-10-05T17:30:00.000Z",
  newDoctorId: "doc_1",
  newResourceId: null,
  toDayISO: "2026-10-05",
};

test("reschedulePayload: notifyPatient:false solo si se pide; el cuerpo de siempre si no", () => {
  assert.deepEqual(reschedulePayload(plan), { startsAt: plan.newStartsAt, endsAt: plan.newEndsAt });
  assert.deepEqual(reschedulePayload(plan, false, false), {
    startsAt: plan.newStartsAt,
    endsAt: plan.newEndsAt,
    notifyPatient: false,
  });
  assert.equal("notifyPatient" in reschedulePayload(plan, false, true), false);
});

test("commitReschedule (arrastrar y soltar) lleva el notifyPatient:false hasta el PATCH", async () => {
  const cuerpos: unknown[] = [];
  const r = await commitReschedule(plan, {
    dispatch: () => {},
    notifyPatient: false,
    reschedule: async (_id, input) => {
      cuerpos.push(input);
      return { appointment: original, scheduleWarning: null };
    },
  });
  assert.equal(r.ok, true);
  assert.deepEqual(cuerpos, [{ startsAt: plan.newStartsAt, endsAt: plan.newEndsAt, notifyPatient: false }]);
});

test("GET /api/clinic/me dice si la clínica avisa «Al reprogramar»", () => {
  const ruta = leer("app/api/clinic/me/route.ts");
  assert.match(ruta, /waNotifyOnReschedule = eventos\.alReprogramar/);
  assert.match(ruta, /waConfirmOnCreate, waNotifyOnReschedule/);
});

test("las cuatro ventanas de mover/editar pintan la casilla y mandan el aviso", () => {
  const editar = leer("components/dashboard/agenda/agenda-edit-appointment-modal.tsx");
  assert.match(editar, /<CasillaAvisarPaciente/);
  assert.match(editar, /\.\.\.campoDelAviso\(avisoClinica, cambiaLaHoraDeLaCita\(appt\.startsAt, startsAtIso\), avisar\)/);

  const moverNueva = leer("components/dashboard/agenda-nueva/confirmar-movimiento.tsx");
  assert.match(moverNueva, /<CasillaAvisarPaciente/);
  assert.match(moverNueva, /onConfirmar\(campoDelAviso\(avisoClinica, cambiaHora, avisar\)\)/);
  assert.match(leer("components/dashboard/agenda-nueva/arrastre-citas.tsx"), /\.\.\.aviso,\n\s*\}\);/);

  const moverSiempre = leer("components/dashboard/agenda/agenda-reschedule-confirm-modal.tsx");
  assert.match(moverSiempre, /<CasillaAvisarPaciente/);
  assert.match(moverSiempre, /onConfirm\(campoDelAviso\(avisoClinica, cambiaHora, avisar\)\)/);
  assert.match(leer("app/dashboard/agenda/agenda-page-client.tsx"), /\.\.\.aviso,\n\s*\}\);/);

  const citasViejas = leer("app/dashboard/appointments/appointments-client.tsx");
  assert.match(citasViejas, /<CasillaAvisarPaciente/);
  assert.match(citasViejas, /\.\.\.campoDelAviso\(avisoClinica, editCambiaHora, avisar\)/);
});
