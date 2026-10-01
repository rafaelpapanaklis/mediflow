// ws1-t3 — el agendado del bot con BOTONES y LISTAS: cada pregunta con opciones
// sale además como interactivo, y un toque se resuelve por id EXACTO (sin
// analizar el texto). Máquina de estados PURA con dependencias falsas: sin
// base, sin Meta. Correr: npm run test:wa-botones
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runBookingTurn, type BookingDeps } from "../booking-core";
import type { BotConfigDTO, BotTurnInput, BotTurnResult } from "../types";
import { construirInteractivo } from "../../interactivo";

const TZ = "America/Mexico_City";

const config: BotConfigDTO = {
  id: "cfg1",
  clinicId: "clinic1",
  enabled: true,
  botName: "Asistente",
  persona: null,
  greeting: null,
  businessHours: null,
  afterHoursMsg: null,
  canAnswerFaq: true,
  canBookAppointments: true,
  fallbackToHuman: true,
};

function huecos(n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const m = 9 * 60 + i * 30;
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  });
}

function makeDeps(over: Partial<BookingDeps> = {}) {
  const creadas: any[] = [];
  const deps: BookingDeps = {
    getClinicTimezone: async () => TZ,
    getClinicName: async () => "Clínica Demo",
    listBookableServices: async () => [
      { id: "svc1", name: "Limpieza", duration: 30 },
      { id: "svc2", name: "Resina", duration: 45 },
      { id: "svc3", name: "Extracción", duration: 60 },
      { id: "svc4", name: "Valoración de ortodoncia con estudios", duration: 60 },
    ],
    listBookableDoctors: async () => [
      { id: "doc1", firstName: "Ana", lastName: "García" },
      { id: "doc2", firstName: "Luis", lastName: "Pérez" },
    ],
    getAvailableSlots: async () => ({ closed: false, slots: huecos(14) }),
    createBotAppointment: async (p) => {
      creadas.push(p);
      return { ok: true, appointmentId: "appt1" };
    },
    rescheduleBotAppointment: async (p) => ({ ok: true, appointmentId: p.appointmentId }),
    getUpcomingAppointmentsForPatient: async () => [],
    findOrCreateWhatsAppPatient: async () => ({ id: "patNew" }),
    findServiceById: async (_c, id) =>
      ({ svc1: { name: "Limpieza", duration: 30 }, svc2: { name: "Resina", duration: 45 } } as any)[id] ?? null,
    findThreadExternalId: async () => "5215512345678",
    findAppointmentById: async () => null,
    ...over,
  };
  return { deps, creadas };
}

function convo(deps: BookingDeps, patient?: { id: string; phone?: string }) {
  let state: BotTurnResult["newBotState"] = null;
  const turno = async (incomingText: string, eleccion?: { id: string; titulo: string }) => {
    const res = await runBookingTurn(
      { clinicId: "clinic1", threadId: "t1", incomingText, history: [], patient, botState: state ?? null, eleccion } as BotTurnInput,
      config,
      deps,
    );
    assert.ok(res);
    if (res.newBotState !== undefined) state = res.newBotState;
    return res;
  };
  return {
    say: (t: string) => turno(t),
    /** Toca la opción del último interactivo cuyo título empieza por `titulo`. */
    tap: async (ultimo: BotTurnResult, titulo: string) => {
      const ops = ultimo.interactivo?.tipo === "botones" ? ultimo.interactivo.botones : ultimo.interactivo?.filas ?? [];
      const o = ops.find((x) => x.titulo.startsWith(titulo));
      assert.ok(o, `no hay opción «${titulo}» en ${JSON.stringify(ops)}`);
      return turno(o.titulo, { id: o.id, titulo: o.titulo });
    },
    tapId: (id: string, titulo: string) => turno(titulo, { id, titulo }),
    get state(): any {
      return state;
    },
  };
}

describe("agendado con botones y listas", () => {
  it("de punta a punta tocando: servicio (lista) → doctor (botones) → horario (lista) → «Sí» (botón)", async () => {
    const { deps, creadas } = makeDeps();
    const c = convo(deps, { id: "pat1", phone: "5215512345678" });

    const r1 = await c.say("quiero agendar");
    assert.equal(r1.interactivo?.tipo, "lista", "4 servicios → lista");
    assert.match(r1.reply ?? "", /1\. Limpieza/, "el texto numerado se queda de respaldo");

    const r2 = await c.tap(r1, "Resina");
    assert.equal(r2.interactivo?.tipo, "botones", "2 doctores → botones");

    const r3 = await c.tap(r2, "Luis");
    assert.match(r3.reply ?? "", /fecha/i);
    assert.equal(r3.interactivo, undefined, "la fecha se escribe");

    const r4 = await c.say("mañana");
    assert.equal(r4.interactivo?.tipo, "lista");
    if (r4.interactivo?.tipo === "lista") {
      assert.equal(r4.interactivo.filas.length, 10, "10 horarios: el tope de una lista");
      assert.equal(r4.interactivo.boton, "Ver horarios");
    }
    // El texto y la lista enseñan lo mismo.
    assert.match(r4.reply ?? "", /10\. 13:30/);
    assert.doesNotMatch(r4.reply ?? "", /11\. /);

    const r5 = await c.tap(r4, "10:30");
    assert.equal(r5.interactivo?.tipo, "botones");
    assert.match(r5.reply ?? "", /10:30/);

    await c.tap(r5, "✅ Sí");
    assert.equal(creadas.length, 1);
    assert.equal(creadas[0].serviceId, "svc2");
    assert.equal(creadas[0].doctorId, "doc2");
    assert.equal(creadas[0].time, "10:30");
  });

  it("«❌ No, otro horario» (botón) vuelve a la lista sin crear la cita", async () => {
    const { deps, creadas } = makeDeps({ listBookableServices: async () => [], listBookableDoctors: async () => [{ id: "doc1", firstName: "Ana", lastName: "García" }] });
    const c = convo(deps, { id: "pat1", phone: "5215512345678" });
    await c.say("quiero agendar mañana");
    const lista = await c.say("mañana");
    const conf = await c.tap(lista, "09:30");
    const r = await c.tap(conf, "❌ No");
    assert.equal(creadas.length, 0);
    assert.equal(c.state.step, "slot");
    assert.equal(r.interactivo?.tipo, "lista");
  });

  it("el toque gana sobre la lectura del texto: la fila «10:00» es esa hora, no la opción 10", async () => {
    const { deps, creadas } = makeDeps({ listBookableServices: async () => [], listBookableDoctors: async () => [{ id: "doc1", firstName: "Ana", lastName: "García" }] });
    const c = convo(deps, { id: "pat1", phone: "5215512345678" });
    await c.say("quiero agendar");
    await c.say("mañana");
    const conf = await c.tapId("bk.slot.10:00", "10:00");
    assert.match(conf.reply ?? "", /a las 10:00/);
    await c.tapId("bk.confirm.si", "✅ Sí, confirmo");
    assert.equal(creadas[0]?.time, "10:00");
  });

  it("un servicio que se llama «Cancelar…» tocado en la lista NO cancela el agendado", async () => {
    const { deps } = makeDeps({
      listBookableServices: async () => [
        { id: "s1", name: "Cancelar", duration: 30 },
        { id: "s2", name: "Limpieza", duration: 30 },
      ],
      findServiceById: async (_c, id) => (id === "s1" ? { name: "Cancelar", duration: 30 } : null),
    });
    const c = convo(deps, { id: "pat1", phone: "5215512345678" });
    const r1 = await c.say("quiero agendar");
    const r2 = await c.tap(r1, "Cancelar");
    assert.doesNotMatch(r2.reply ?? "", /cancelé la solicitud/);
    assert.equal(c.state.serviceId, "s1");
  });

  it("un toque de OTRO paso (id bk.service.* estando en doctor) no elige nada: se lee el texto y re-pregunta", async () => {
    const { deps } = makeDeps();
    const c = convo(deps, { id: "pat1", phone: "5215512345678" });
    const r1 = await c.say("quiero agendar");
    await c.tap(r1, "Limpieza");
    assert.equal(c.state.step, "doctor");
    const r = await c.tapId("bk.service.svc2", "Resina");
    assert.equal(c.state.step, "doctor");
    assert.equal(c.state.doctorId, undefined);
    assert.equal(r.interactivo?.tipo, "botones", "re-pregunta con los mismos botones");
  });

  it("escribir sigue funcionando igual que siempre", async () => {
    const { deps, creadas } = makeDeps();
    const c = convo(deps, { id: "pat1", phone: "5215512345678" });
    await c.say("quiero agendar");
    await c.say("1");
    await c.say("1");
    await c.say("mañana");
    await c.say("09:00");
    await c.say("sí");
    assert.equal(creadas.length, 1);
  });

  it("número compartido: «¿para quién?» sale como botones y el toque elige a esa persona", async () => {
    const { deps, creadas } = makeDeps({
      listBookableServices: async () => [],
      listBookableDoctors: async () => [{ id: "doc1", firstName: "Ana", lastName: "García" }],
      listPhoneOwners: async () => [
        { id: "hijo1", firstName: "Luis", lastName: "Mora" },
        { id: "hija2", firstName: "Sofía", lastName: "Mora" },
      ],
    });
    const c = convo(deps, { id: "hijo1", phone: "5215512345678" });
    const r1 = await c.say("quiero agendar");
    assert.equal(r1.interactivo?.tipo, "botones");
    await c.tap(r1, "Sofía");
    const lista = await c.say("mañana");
    const conf = await c.tap(lista, "09:00");
    await c.tap(conf, "✅ Sí");
    assert.equal(creadas[0]?.patientId, "hija2");
  });

  it("el botón «🔁 Reagendar» del recordatorio abre el flujo de REAGENDAR", async () => {
    const { deps } = makeDeps({
      getUpcomingAppointmentsForPatient: async () => [
        {
          id: "a1",
          doctorId: "doc1",
          startsAt: new Date("2026-10-08T16:00:00Z"),
          endsAt: new Date("2026-10-08T16:30:00Z"),
          type: "Limpieza",
          doctor: { firstName: "Ana", lastName: "García" },
        },
      ],
    });
    const c = convo(deps, { id: "pat1", phone: "5215512345678" });
    const r = await c.tapId("rec.reagendar:rem1", "🔁 Reagendar");
    assert.equal(c.state.mode, "reschedule");
    assert.match(r.reply ?? "", /Tu cita actual/);
  });

  it("todo interactivo que emite el motor es válido para Meta (construirInteractivo no lo tira)", async () => {
    const { deps } = makeDeps();
    const c = convo(deps, { id: "pat1", phone: "5215512345678" });
    const pasos: BotTurnResult[] = [];
    pasos.push(await c.say("quiero agendar"));
    pasos.push(await c.tap(pasos[0], "Limpieza"));
    pasos.push(await c.tap(pasos[1], "Ana"));
    pasos.push(await c.say("mañana"));
    pasos.push(await c.tap(pasos[3], "09:00"));
    for (const p of pasos) {
      if (p.interactivo) assert.ok(construirInteractivo(p.reply ?? "", p.interactivo), JSON.stringify(p.interactivo));
    }
  });
});
