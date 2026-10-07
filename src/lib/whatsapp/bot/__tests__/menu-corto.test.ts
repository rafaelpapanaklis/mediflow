// ws1-t3 (auditoría BEVADENT) — menú corto de «¿qué necesitas?» al agendar por
// WhatsApp. Máquina de estados pura con dependencias simuladas: nada pega a la
// base ni a Meta. Correr: npm run test:wa-menu-corto

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runBookingTurn, type BookingDeps } from "../booking-core";
import { casarConCatalogo, indiceDeRespuesta, construirMenu } from "../menu-agenda-core";
import type { BotConfigDTO, BotTurnInput, BotTurnResult } from "../types";

const TZ = "America/Mexico_City";

const config = {
  id: "cfg1", clinicId: "clinic1", enabled: true, botName: "Asistente", persona: null, greeting: null,
  businessHours: null, afterHoursMsg: null, canAnswerFaq: true, canBookAppointments: true, fallbackToHuman: true,
} as BotConfigDTO;

type Fila = { id: string; name: string; duration: number | null };

// Catálogo grande: 40 procedimientos; «Limpieza», «Extracción» y «Resina» quedan DESPUÉS de la «C».
const GRANDE: Fila[] = [
  ...Array.from({ length: 30 }, (_, i) => ({ id: `a${i}`, name: `Acto ${String.fromCharCode(65 + (i % 3))}${i}`, duration: 30 })),
  { id: "cons", name: "Consulta general", duration: 20 },
  { id: "extr", name: "Extracción simple", duration: 45 },
  { id: "limp", name: "Limpieza dental", duration: 40 },
  { id: "resi", name: "Resina", duration: 60 },
  { id: "orto-v", name: "Valoración de ortodoncia", duration: 30 },
].sort((a, b) => a.name.localeCompare(b.name));

function deps(over: Partial<BookingDeps> & { marcados?: Fila[]; catalogo?: Fila[] } = {}) {
  const creadas: any[] = [];
  const consultasDeSlots: any[] = [];
  const catalogo = over.catalogo ?? GRANDE;
  const marcados = over.marcados ?? [];
  const d: BookingDeps = {
    getClinicTimezone: async () => TZ,
    getClinicName: async () => "Clínica Demo",
    // Lo que hacía el código viejo: el catálogo alfabético con tope de 24.
    listBookableServices: async () => catalogo.slice(0, 24),
    listBotServiceMenu: async () => ({ marcados, catalogo }),
    listBookableDoctors: async () => [{ id: "doc1", firstName: "Ana", lastName: "García" }],
    getAvailableSlots: async (p) => {
      consultasDeSlots.push(p);
      return { closed: false, slots: ["09:00", "09:30"] };
    },
    createBotAppointment: async (p) => {
      creadas.push(p);
      return { ok: true, appointmentId: "appt1" };
    },
    rescheduleBotAppointment: async () => ({ ok: true, appointmentId: "appt1" }),
    getUpcomingAppointmentsForPatient: async () => [],
    findOrCreateWhatsAppPatient: async () => ({ id: "patNew" }),
    findServiceById: async (_c, id) => catalogo.find((c) => c.id === id) ?? null,
    findThreadExternalId: async () => "5215512345678",
    findAppointmentById: async () => null,
    ...over,
  } as BookingDeps;
  delete (d as any).marcados;
  delete (d as any).catalogo;
  return { d, creadas, consultasDeSlots };
}

function convo(d: BookingDeps) {
  let state: BotTurnResult["newBotState"] = null;
  return {
    async say(text: string): Promise<BotTurnResult> {
      const res = await runBookingTurn(
        { clinicId: "clinic1", threadId: "t1", incomingText: text, history: [], patient: { id: "pat1", phone: "5215512345678" }, botState: state ?? null } as BotTurnInput,
        config,
        d,
      );
      assert.ok(res, "runBookingTurn devolvió null");
      if (res.newBotState !== undefined) state = res.newBotState;
      return res;
    },
    get state(): any {
      return state;
    },
  };
}

const lineas = (r: BotTurnResult) => (r.reply ?? "").split("\n").filter((l) => /^\d+\. /.test(l));

describe("menú corto — sin procedimientos marcados (menú de fábrica)", () => {
  it("catálogo grande: 4 opciones cortas, no la lista del catálogo", async () => {
    const { d } = deps();
    const c = convo(d);
    const r = await c.say("quiero agendar");
    assert.deepEqual(lineas(r).map((l) => l.replace(/^\d+\. /, "")), ["Consulta o valoración", "Limpieza", "Urgencia o dolor", "Otro tratamiento"]);
    assert.doesNotMatch(r.reply ?? "", /Acto|Resina|Extracción/);
  });

  it("«Limpieza» (número o escrito) se casa con el procedimiento del catálogo aunque esté después de la C", async () => {
    for (const resp of ["2", "limpieza", "quiero una limpieza porfa"]) {
      const { d, creadas } = deps();
      const c = convo(d);
      await c.say("agendar");
      const r2 = await c.say(resp);
      assert.match(r2.reply ?? "", /fecha/i, resp);
      assert.equal(c.state.serviceId, "limp", resp);
      assert.equal(c.state.durationMin, 40);
      await c.say("mañana");
      await c.say("1");
      await c.say("sí");
      assert.equal(creadas[0].serviceId, "limp");
      assert.equal(creadas[0].reason, "Limpieza dental");
    }
  });

  it("«Consulta o valoración» sin procedimiento equivalente: cita genérica con el motivo", async () => {
    const { d, creadas } = deps({ catalogo: [{ id: "x", name: "Resina", duration: 60 }] });
    const c = convo(d);
    await c.say("agendar");
    await c.say("1");
    assert.equal(c.state.serviceId, null);
    assert.equal(c.state.durationMin, 0); // la agenda usa su paso por defecto
    await c.say("mañana");
    await c.say("1");
    await c.say("sí");
    assert.equal(creadas[0].serviceId, null);
    assert.equal(creadas[0].reason, "Consulta o valoración");
  });

  it("«me duele una muela» vale como Urgencia y ofrece el primer hueco sin preguntar la fecha", async () => {
    const { d, consultasDeSlots } = deps();
    const c = convo(d);
    await c.say("agendar");
    const r = await c.say("me duele una muela");
    assert.match(r.reply ?? "", /primer horario disponible/i);
    assert.match(r.reply ?? "", /Horarios disponibles/);
    assert.equal(c.state.step, "slot");
    assert.equal(consultasDeSlots.length, 1);
    assert.equal(c.state.serviceName, "Urgencia o dolor");
  });

  it("un dígito suelto dentro de una frase no gana a las palabras («me duele desde hace 2 días»)", async () => {
    const { d } = deps();
    const c = convo(d);
    await c.say("agendar");
    await c.say("me duele desde hace 2 días");
    assert.equal(c.state.serviceName, "Urgencia o dolor"); // no «2 = Limpieza»
  });

  it("«Otro tratamiento» pide una frase y agenda como valoración con ese texto en la nota", async () => {
    const { d, creadas } = deps();
    const c = convo(d);
    await c.say("agendar");
    const r = await c.say("4");
    assert.match(r.reply ?? "", /en una frase/i);
    assert.equal(c.state.step, "otro_texto");
    const r2 = await c.say("quiero que me revisen un puente flojo");
    assert.match(r2.reply ?? "", /fecha/i);
    await c.say("mañana");
    await c.say("1");
    await c.say("sí");
    assert.equal(creadas[0].serviceId, "cons");
    assert.equal(creadas[0].reason, "Consulta general — quiero que me revisen un puente flojo");
  });
});

describe("menú corto — con procedimientos marcados por la clínica", () => {
  const marcados = [GRANDE.find((g) => g.id === "extr")!, GRANDE.find((g) => g.id === "resi")!];

  it("el menú son los marcados + Otro tratamiento", async () => {
    const { d } = deps({ marcados });
    const r = await convo(d).say("agendar");
    assert.deepEqual(lineas(r).map((l) => l.replace(/^\d+\. /, "")), ["Extracción simple (45 min)", "Resina (60 min)", "Otro tratamiento"]);
    assert.doesNotMatch(r.reply ?? "", /Limpieza|Urgencia/);
  });

  it("más de 8 marcados: se muestran 8 + Otro tratamiento", async () => {
    const muchos = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, name: `Marcado ${i}`, duration: 30 }));
    const { d } = deps({ marcados: muchos });
    const r = await convo(d).say("agendar");
    assert.equal(lineas(r).length, 9);
    assert.match(lineas(r)[8], /Otro tratamiento/);
  });

  it("elegir un marcado (por número o por nombre) agenda ESE procedimiento", async () => {
    for (const resp of ["2", "resina", "quiero una resina"]) {
      const { d } = deps({ marcados });
      const c = convo(d);
      await c.say("agendar");
      await c.say(resp);
      assert.equal(c.state.serviceId, "resi", resp);
      assert.equal(c.state.durationMin, 60);
    }
  });
});

describe("menú corto — ortodoncia", () => {
  it("paciente con ortodoncia activa: primero su control u otro servicio; «otro servicio» no repite el control", async () => {
    const { d } = deps({
      getOrthoBookingContext: async () => ({
        casoActivo: { treatmentPlanId: "tp1", treatingDoctorId: "doc1", label: "Control de ortodoncia", durationMin: 20 },
        valoracion: { label: "Valoración de ortodoncia", durationMin: 30 },
      }),
    });
    const c = convo(d);
    const r = await c.say("agendar");
    assert.match(r.reply ?? "", /ortodoncia activo/);
    const r2 = await c.say("2"); // otro servicio
    assert.deepEqual(lineas(r2).map((l) => l.replace(/^\d+\. /, "")), ["Consulta o valoración", "Limpieza", "Urgencia o dolor", "Otro tratamiento"]);
  });

  it("clínica con el módulo (sin caso activo): el menú trae «Control de ortodoncia» y agenda la valoración", async () => {
    const { d } = deps({
      getOrthoBookingContext: async () => ({ casoActivo: null, valoracion: { label: "Valoración de ortodoncia", durationMin: 30 } }),
    });
    const c = convo(d);
    const r = await c.say("agendar");
    assert.ok(lineas(r).some((l) => /Control de ortodoncia/.test(l)));
    await c.say("ortodoncia");
    assert.equal(c.state.serviceName, "Valoración de ortodoncia");
    assert.equal(c.state.durationMin, 30);
  });

  it("clínica sin módulo: el menú no trae ortodoncia", async () => {
    const { d } = deps();
    assert.doesNotMatch((await convo(d).say("agendar")).reply ?? "", /ortodoncia/i);
  });
});

describe("menú corto — piezas puras", () => {
  it("casarConCatalogo no toma la valoración de ortodoncia como consulta general", () => {
    assert.equal(casarConCatalogo("consulta", [{ id: "o", name: "Valoración de ortodoncia", duration: 30 }]), null);
  });
  it("indiceDeRespuesta: sin sentido → null", () => {
    assert.equal(indiceDeRespuesta("jajaja", construirMenu({ marcados: [], conOrto: false })), null);
  });
});
