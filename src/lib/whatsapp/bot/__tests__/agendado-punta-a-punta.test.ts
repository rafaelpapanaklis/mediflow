// ws1-t12 (auditoría BEVADENT) — verificación del NUEVO agendado del bot de
// WhatsApp (menú corto de ws1-t3 + genéricas de ws1-t9) de punta a punta:
// conversaciones completas con `runBookingTurn` y dobles de todas las deps.
// Nada toca la base ni Meta. Correr: npm run test:wa-agendado-e2e
//
// Lo que arregla esta tanda (fallan con el código viejo):
//  · procedimiento marcado que se desactiva o se borra entre el menú y la
//    respuesta: antes la cita salía con el id viejo y el nombre «Resina (60 min)»;
//  · «Consulta o valoración» se casaba con «Valoración de implantes» (60 min y
//    su precio para el anticipo) antes que con «Consulta general».

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runBookingTurn, type BookingDeps } from "../booking-core";
import { casarConCatalogo } from "../menu-agenda-core";
import { todayInTz } from "@/lib/agenda/time-utils";
import { addDaysISO } from "../booking-parse";
import type { SlotResult } from "@/lib/agenda/bot-booking-service";
import type { BotConfigDTO, BotTurnInput, BotTurnResult } from "../types";

const TZ = "America/Mexico_City";
const HOY = todayInTz(TZ);
const MANANA = addDaysISO(HOY, 1);

function configDe(over: Partial<BotConfigDTO> = {}): BotConfigDTO {
  return {
    id: "cfg1", clinicId: "sedeA", enabled: true, botName: "Asistente", persona: null, greeting: null,
    businessHours: null, afterHoursMsg: null, canAnswerFaq: true, canBookAppointments: true, fallbackToHuman: true,
    ...over,
  } as BotConfigDTO;
}

type Fila = { id: string; name: string; duration: number | null; activo?: boolean };
type Genericas = { consulta: boolean; limpieza: boolean; urgencia: boolean };

/** Catálogo de una clínica dental típica (lo que siembra /api/procedures). */
const CATALOGO: Fila[] = [
  { id: "blanq", name: "Blanqueamiento", duration: 90 },
  { id: "cons", name: "Consulta general", duration: 30 },
  { id: "extr", name: "Extracción simple", duration: 30 },
  { id: "limp", name: "Profilaxis (limpieza)", duration: 30 },
  { id: "res1", name: "Restauración resina 1 cara", duration: 30 },
  { id: "res2", name: "Restauración resina 2 caras", duration: 45 },
  { id: "resi", name: "Resina", duration: 60 },
  { id: "orto-v", name: "Valoración de ortodoncia", duration: 30 },
].sort((a, b) => a.name.localeCompare(b.name));

interface Sede {
  catalogo: Fila[];
  marcadosIds: string[];
  genericas?: Genericas;
}

interface Opciones {
  sedes?: Record<string, Sede>;
  doctores?: Array<{ id: string; firstName: string; lastName: string }>;
  slots?: (dateISO: string, doctorId: string) => SlotResult;
  sinMenu?: boolean;
  ortho?: BookingDeps["getOrthoBookingContext"];
  anticipo?: BookingDeps["anticipoParaAnunciar"];
}

function armar(o: Opciones = {}) {
  // Copia por prueba: una prueba que «desactiva» un procedimiento no debe tocar a las demás.
  const sedes: Record<string, Sede> = Object.fromEntries(
    Object.entries(o.sedes ?? { sedeA: { catalogo: CATALOGO, marcadosIds: [] } }).map(([id, s]) => [
      id,
      { ...s, catalogo: s.catalogo.map((f) => ({ ...f })) },
    ]),
  );
  const creadas: Parameters<BookingDeps["createBotAppointment"]>[0][] = [];
  const movidas: Parameters<BookingDeps["rescheduleBotAppointment"]>[0][] = [];
  const consultasDeSlots: Array<{ dateISO: string; doctorId: string; durationMin: number }> = [];
  const slots = o.slots ?? (() => ({ closed: false, slots: ["09:00", "09:30", "10:00"] }));
  const activos = (s: Sede) => s.catalogo.filter((c) => c.activo !== false);
  const d: BookingDeps = {
    getClinicTimezone: async () => TZ,
    getClinicName: async () => "Clínica Demo",
    listBookableServices: async (clinicId) => activos(sedes[clinicId]).slice(0, 24),
    listBookableDoctors: async () => o.doctores ?? [{ id: "doc1", firstName: "Ana", lastName: "García" }],
    getAvailableSlots: async (p) => {
      consultasDeSlots.push({ dateISO: p.dateISO, doctorId: p.doctorId, durationMin: p.durationMin });
      return slots(p.dateISO, p.doctorId);
    },
    createBotAppointment: async (p) => {
      creadas.push(p);
      return { ok: true, appointmentId: `appt${creadas.length}` };
    },
    rescheduleBotAppointment: async (p) => {
      movidas.push(p);
      return { ok: true, appointmentId: p.appointmentId };
    },
    getUpcomingAppointmentsForPatient: async () => [],
    findOrCreateWhatsAppPatient: async () => ({ id: "patNuevo" }),
    findServiceById: async (clinicId, id) => {
      const f = activos(sedes[clinicId]).find((c) => c.id === id);
      return f ? { name: f.name, duration: f.duration } : null;
    },
    findThreadExternalId: async () => "5215512345678",
    findAppointmentById: async () => null,
    ...(o.ortho ? { getOrthoBookingContext: o.ortho } : {}),
    ...(o.anticipo ? { anticipoParaAnunciar: o.anticipo } : {}),
  };
  if (!o.sinMenu) {
    d.listBotServiceMenu = async (clinicId) => {
      const s = sedes[clinicId];
      const catalogo = activos(s);
      return { marcados: catalogo.filter((c) => s.marcadosIds.includes(c.id)), catalogo, genericas: s.genericas };
    };
  }
  return { d, creadas, movidas, consultasDeSlots, sedes };
}

type Paciente = { id: string; phone: string } | null;

function convo(d: BookingDeps, opts: { paciente?: Paciente; clinicId?: string; config?: BotConfigDTO } = {}) {
  let state: BotTurnResult["newBotState"] = null;
  const paciente = opts.paciente === undefined ? { id: "pat1", phone: "5215512345678" } : opts.paciente;
  const clinicId = opts.clinicId ?? "sedeA";
  const config = opts.config ?? configDe({ clinicId });
  const ultimo = { res: null as BotTurnResult | null };
  async function turno(text: string, eleccion?: { id: string; titulo: string }): Promise<BotTurnResult> {
    const input: BotTurnInput = {
      clinicId, threadId: "t1", incomingText: text, history: [], botState: state ?? null,
      ...(paciente ? { patient: paciente } : {}),
      ...(eleccion ? { eleccion } : {}),
    };
    const res = await runBookingTurn(input, config, d);
    assert.ok(res, "runBookingTurn devolvió null");
    if (res.newBotState !== undefined) state = res.newBotState;
    ultimo.res = res;
    return res;
  }
  return {
    say: (t: string) => turno(t),
    tap: (id: string, titulo = id) => turno(titulo, { id, titulo }),
    get state(): any { return state; },
    get ultimo() { return ultimo.res; },
  };
}

/** Del paso «¿qué necesitas?» hasta el «¿confirmas?» eligiendo fecha mañana y el primer horario. */
async function hastaConfirmar(c: ReturnType<typeof convo>, respuestaDelMenu: string, nombre?: string) {
  await c.say("quiero agendar una cita");
  const r = await c.say(respuestaDelMenu);
  assert.equal(c.state?.step, "date", `esperaba pedir fecha tras «${respuestaDelMenu}», contestó: ${r.reply}`);
  await c.say("mañana");
  assert.equal(c.state?.step, "slot");
  const r2 = await c.say("1");
  if (nombre) {
    assert.equal(c.state?.step, "name", `esperaba pedir nombre: ${r2.reply}`);
    await c.say(nombre);
  }
  assert.equal(c.state?.step, "confirm", `esperaba el «¿confirmas?»: ${c.ultimo?.reply}`);
  return c.ultimo!;
}

describe("menú de fábrica: paciente nuevo y existente, por número y por texto", () => {
  it("paciente NUEVO: menú → «2» (Limpieza) → fecha → horario → nombre → sí; la cita lleva la limpieza del catálogo", async () => {
    const { d, creadas } = armar();
    const c = convo(d, { paciente: null });
    const menu = await c.say("hola, quiero agendar");
    assert.match(menu.reply!, /1\. Consulta o valoración\n2\. Limpieza\n3\. Urgencia o dolor\n4\. Otro tratamiento/);
    // Sale también como lista interactiva con ids por opción.
    assert.equal(menu.interactivo?.tipo, "lista");
    const conf = await hastaConfirmar(c, "2", "Juan Pérez");
    assert.match(conf.reply!, /Profilaxis \(limpieza\)/);
    const fin = await c.say("sí");
    assert.match(fin.reply!, /Registré tu cita/);
    assert.equal(creadas.length, 1);
    assert.equal(creadas[0].patientId, "patNuevo");
    assert.equal(creadas[0].serviceId, "limp");
    assert.equal(creadas[0].durationMin, 30);
    assert.equal(creadas[0].doctorId, "doc1");
    assert.equal(creadas[0].reason, "Profilaxis (limpieza)");
    assert.equal(creadas[0].dateISO, MANANA);
    assert.equal(creadas[0].time, "09:00");
    assert.equal(c.state, null, "la sesión se limpia al terminar");
  });

  it("paciente EXISTENTE escribe «limpieza» en vez del número: mismo resultado sin pedir nombre", async () => {
    const { d, creadas } = armar();
    const c = convo(d);
    await hastaConfirmar(c, "limpieza");
    await c.say("si");
    assert.equal(creadas[0].patientId, "pat1");
    assert.equal(creadas[0].serviceId, "limp");
  });

  it("«Consulta o valoración» se casa con «Consulta general» (30 min), no con otra valoración más larga", async () => {
    const { d, creadas } = armar({
      sedes: { sedeA: { catalogo: [...CATALOGO, { id: "val-imp", name: "Valoración de implantes", duration: 60 }], marcadosIds: [] } },
    });
    const c = convo(d);
    await hastaConfirmar(c, "1");
    await c.say("sí");
    assert.equal(creadas[0].serviceId, "cons");
    assert.equal(creadas[0].durationMin, 30);
    assert.equal(creadas[0].reason, "Consulta general");
  });

  it("«me duele una muela» = Urgencia: no pregunta fecha, enseña el primer día con lugar desde hoy", async () => {
    const { d, creadas, consultasDeSlots } = armar({
      // Hoy cerrado; mañana sí hay.
      slots: (dateISO) => (dateISO === HOY ? { closed: true, reason: "closed_day", slots: [] } : { closed: false, slots: ["11:00", "11:30"] }),
    });
    const c = convo(d);
    await c.say("agendar");
    const r = await c.say("me duele una muela desde hace 2 días");
    assert.equal(c.state?.step, "slot", `esperaba horarios: ${r.reply}`);
    assert.match(r.reply!, /urgencia/i);
    assert.match(r.reply!, /El día más cercano con lugar/);
    assert.deepEqual(consultasDeSlots.map((s) => s.dateISO).slice(0, 2), [HOY, MANANA]);
    assert.equal(c.state.dateISO, MANANA);
    await c.say("2");
    await c.say("sí");
    assert.equal(creadas[0].time, "11:30");
    // Sin «Urgencia» en el catálogo: cita genérica (duración del paso de la agenda) con el motivo como tipo.
    assert.equal(creadas[0].serviceId, null);
    assert.equal(creadas[0].durationMin, 0);
    assert.equal(creadas[0].reason, "Urgencia o dolor");
  });

  it("«blanqueamiento» (no está en el menú): no se entiende; a la segunda pasa a una persona", async () => {
    const { d } = armar();
    const c = convo(d);
    await c.say("agendar");
    const r1 = await c.say("blanqueamiento");
    assert.match(r1.reply!, /No te entendí/);
    assert.equal(c.state?.step, "service");
    const r2 = await c.say("quiero un blanqueamiento");
    assert.equal(r2.handoff, true);
    assert.equal(c.state, null);
  });

  it("texto basura y número fuera de rango: re-pregunta (y sin derivación si la clínica lo apagó)", async () => {
    const { d } = armar();
    const c = convo(d, { config: configDe({ fallbackToHuman: false }) });
    await c.say("agendar");
    for (const basura of ["asdf qwerty", "9", "0", "opción 12"]) {
      const r = await c.say(basura);
      assert.match(r.reply!, /No te entendí/, `con «${basura}»`);
      assert.equal(r.handoff, undefined);
      assert.equal(c.state?.step, "service");
    }
    // Y tras tanta basura sigue entendiendo.
    await c.say("3");
    assert.equal(c.state?.step, "slot");
  });

  it("un dígito suelto dentro de una frase no manda: «me duele desde hace 2 días» es Urgencia, no la opción 2", async () => {
    const { d } = armar();
    const c = convo(d);
    await c.say("agendar");
    await c.say("me duele desde hace 2 días");
    assert.equal(c.state?.serviceName, "Urgencia o dolor");
  });

  it("tocar la fila de la lista interactiva elige por id exacto", async () => {
    const { d } = armar();
    const c = convo(d);
    const m = await c.say("agendar");
    const ids = (m.interactivo as any).secciones?.flatMap((s: any) => s.filas.map((f: any) => f.id)) ?? (m.interactivo as any).filas?.map((f: any) => f.id);
    assert.ok(ids?.includes("bk.service.menu:urgencia"), JSON.stringify(m.interactivo));
    await c.tap("bk.service.menu:urgencia", "Urgencia o dolor");
    assert.equal(c.state?.serviceName, "Urgencia o dolor");
  });
});

describe("genéricas de Configurar bot y procedimientos marcados", () => {
  const sede = (marcadosIds: string[], genericas?: Genericas): Record<string, Sede> => ({ sedeA: { catalogo: CATALOGO, marcadosIds, genericas } });

  it("todas las genéricas y 0 marcados: 3 + Otro", async () => {
    const { d } = armar({ sedes: sede([], { consulta: true, limpieza: true, urgencia: true }) });
    const c = convo(d);
    await c.say("agendar");
    assert.deepEqual(c.state.options.map((o: any) => o.label), ["Consulta o valoración", "Limpieza", "Urgencia o dolor", "Otro tratamiento"]);
  });

  it("ninguna genérica y 0 marcados: vuelven las de fábrica (el menú nunca queda vacío)", async () => {
    const { d } = armar({ sedes: sede([], { consulta: false, limpieza: false, urgencia: false }) });
    const c = convo(d);
    await c.say("agendar");
    assert.equal(c.state.options.length, 4);
  });

  it("ninguna genérica y 2 marcados: solo los marcados + Otro", async () => {
    const { d, creadas } = armar({ sedes: sede(["resi", "extr"], { consulta: false, limpieza: false, urgencia: false }) });
    const c = convo(d);
    const r = await c.say("agendar");
    assert.deepEqual(c.state.options.map((o: any) => o.label), ["Extracción simple (30 min)", "Resina (60 min)", "Otro tratamiento"]);
    assert.match(r.reply!, /1\. Extracción simple \(30 min\)/);
    await c.say("resina");
    assert.equal(c.state?.serviceId, "resi");
    await c.say("mañana");
    await c.say("1");
    await c.say("sí");
    assert.equal(creadas[0].serviceId, "resi");
    assert.equal(creadas[0].durationMin, 60);
    assert.equal(creadas[0].reason, "Resina");
  });

  it("algunas genéricas (solo urgencia) + 2 marcados: urgencia primero, luego los marcados", async () => {
    const { d } = armar({ sedes: sede(["resi", "extr"], { consulta: false, limpieza: false, urgencia: true }) });
    const c = convo(d);
    await c.say("agendar");
    assert.deepEqual(c.state.options.map((o: any) => o.id), ["menu:urgencia", "extr", "resi", "menu:otro"]);
  });

  it("8 marcados con las 3 genéricas: tope de 8 antes de Otro (los últimos alfabéticos se recortan)", async () => {
    const ocho = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `Procedimiento ${String.fromCharCode(65 + i)}`, duration: 30 }));
    const { d } = armar({ sedes: { sedeA: { catalogo: [...CATALOGO, ...ocho], marcadosIds: ocho.map((p) => p.id) } } });
    const c = convo(d);
    await c.say("agendar");
    const ids = c.state.options.map((o: any) => o.id);
    assert.equal(ids.length, 9);
    assert.deepEqual(ids.slice(0, 3), ["menu:consulta", "menu:limpieza", "menu:urgencia"]);
    assert.deepEqual(ids.slice(3, 8), ["p0", "p1", "p2", "p3", "p4"]);
    assert.equal(ids[8], "menu:otro");
  });

  it("9 marcados sin genéricas: salen 8 + Otro; el noveno (alfabético) no", async () => {
    const nueve = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, name: `Procedimiento ${String.fromCharCode(65 + i)}`, duration: 30 }));
    const { d } = armar({ sedes: { sedeA: { catalogo: [...CATALOGO, ...nueve], marcadosIds: nueve.map((p) => p.id), genericas: { consulta: false, limpieza: false, urgencia: false } } } });
    const c = convo(d);
    const r = await c.say("agendar");
    const ids = c.state.options.map((o: any) => o.id);
    assert.deepEqual(ids, ["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7", "menu:otro"]);
    assert.doesNotMatch(r.reply!, /Procedimiento I/);
    // Pedir el que no salió por texto tampoco lo elige (no está en el menú).
    const r2 = await c.say("Procedimiento I");
    assert.match(r2.reply!, /No te entendí/);
  });

  it("FALLA ARREGLADA: el procedimiento marcado se desactiva (o se borra) después de mostrar el menú", async () => {
    const { d, creadas, sedes } = armar({ sedes: sede(["resi"], { consulta: false, limpieza: false, urgencia: false }) });
    const c = convo(d);
    await c.say("agendar");
    assert.equal(c.state.options[0].id, "resi");
    // La clínica lo desactiva en el catálogo mientras el paciente lee el menú.
    sedes.sedeA.catalogo.find((f) => f.id === "resi")!.activo = false;
    await c.say("1");
    assert.equal(c.state?.step, "date");
    // Antes: serviceId "resi" (un id que ya no vale) y serviceName «Resina (60 min)» como tipo de la cita.
    assert.equal(c.state.serviceId, null);
    assert.equal(c.state.serviceName, "Resina");
    await c.say("mañana");
    await c.say("1");
    await c.say("sí");
    assert.equal(creadas[0].serviceId, null);
    assert.equal(creadas[0].reason, "Resina");
  });
});

describe("«Otro tratamiento»", () => {
  it("«4» → pide la frase → se agenda como la consulta del catálogo con el motivo «Consulta general — <frase>»", async () => {
    const { d, creadas } = armar();
    const c = convo(d);
    await c.say("agendar");
    const r = await c.say("4");
    assert.equal(c.state?.step, "otro_texto");
    assert.match(r.reply!, /Cuéntame en una frase/);
    await c.say("quiero que revisen un puente flojo");
    assert.equal(c.state?.step, "date");
    await c.say("mañana");
    await c.say("1");
    await c.say("sí");
    assert.equal(creadas[0].serviceId, "cons");
    assert.equal(creadas[0].durationMin, 30);
    assert.equal(creadas[0].reason, "Consulta general — quiero que revisen un puente flojo");
  });

  it("la palabra «otro» también vale, y la frase se acota a 120 caracteres", async () => {
    const { d, creadas } = armar();
    const c = convo(d);
    await c.say("agendar");
    await c.say("otro tratamiento");
    assert.equal(c.state?.step, "otro_texto");
    await c.say("x".repeat(200));
    assert.equal(c.state.motivo, `Consulta general — ${"x".repeat(120)}`);
    await c.say("mañana");
    await c.say("1");
    await c.say("sí");
    assert.equal(creadas[0].reason!.length, "Consulta general — ".length + 120);
  });

  it("«cancelar» en medio de la frase tira el flujo; «menu» lo reinicia", async () => {
    const { d } = armar();
    const c = convo(d);
    await c.say("agendar");
    await c.say("otro");
    const r = await c.say("cancelar");
    assert.match(r.reply!, /cancelé/);
    assert.equal(c.state, null);
    await c.say("agendar");
    await c.say("otro");
    const r2 = await c.say("menu");
    assert.match(r2.reply!, /¿Qué necesitas\?/);
    assert.equal(c.state?.step, "service");
  });
});

describe("ortodoncia", () => {
  const conCaso: BookingDeps["getOrthoBookingContext"] = async () => ({
    casoActivo: { treatmentPlanId: "tp1", treatingDoctorId: "doc2", label: "Control de ortodoncia", durationMin: 20 },
    valoracion: { label: "Valoración de ortodoncia", durationMin: 30 },
  });
  const sinCaso: BookingDeps["getOrthoBookingContext"] = async () => ({
    casoActivo: null,
    valoracion: { label: "Valoración de ortodoncia", durationMin: 30 },
  });
  const doctores = [
    { id: "doc1", firstName: "Ana", lastName: "García" },
    { id: "doc2", firstName: "Beto", lastName: "Ruiz" },
  ];

  it("paciente con caso activo: «tu control u otro servicio»; el control va con su tratante sin elegir doctor", async () => {
    const { d, creadas } = armar({ ortho: conCaso, doctores });
    const c = convo(d);
    const r = await c.say("agendar");
    assert.equal(c.state?.step, "service_kind");
    assert.match(r.reply!, /1\. Control de ortodoncia\n2\. Otro servicio/);
    await c.say("1");
    assert.equal(c.state?.step, "date");
    assert.equal(c.state.doctorId, "doc2");
    await c.say("mañana");
    await c.say("1");
    await c.say("sí");
    assert.equal(creadas[0].doctorId, "doc2");
    assert.equal(creadas[0].durationMin, 20);
    assert.equal(creadas[0].reason, "Control de ortodoncia");
  });

  it("«otro servicio» abre el menú corto SIN repetir el control", async () => {
    const { d } = armar({ ortho: conCaso, doctores });
    const c = convo(d);
    await c.say("agendar");
    await c.say("2");
    assert.equal(c.state?.step, "service");
    assert.deepEqual(c.state.options.map((o: any) => o.id), ["menu:consulta", "menu:limpieza", "menu:urgencia", "menu:otro"]);
  });

  it("sin caso pero con el módulo: el menú trae «Control de ortodoncia» y agenda la valoración", async () => {
    const { d, creadas } = armar({ ortho: sinCaso });
    const c = convo(d);
    await c.say("agendar");
    assert.deepEqual(c.state.options.map((o: any) => o.id), ["menu:consulta", "menu:limpieza", "menu:urgencia", "menu:orto", "menu:otro"]);
    await c.say("brackets");
    assert.equal(c.state?.serviceName, "Valoración de ortodoncia");
    await c.say("mañana");
    await c.say("1");
    await c.say("sí");
    assert.equal(creadas[0].durationMin, 30);
    assert.equal(creadas[0].reason, "Valoración de ortodoncia");
  });

  it("«Consulta o valoración» nunca toma la «Valoración de ortodoncia» del catálogo", async () => {
    const { d, creadas } = armar({
      ortho: sinCaso,
      sedes: { sedeA: { catalogo: CATALOGO.filter((f) => f.id !== "cons"), marcadosIds: [] } },
    });
    const c = convo(d);
    await hastaConfirmar(c, "1");
    await c.say("sí");
    assert.equal(creadas[0].serviceId, null);
    assert.equal(creadas[0].reason, "Consulta o valoración");
  });
});

describe("sin doctores, sin horarios, varios doctores", () => {
  it("sin profesionales: lo dice al elegir el servicio y cierra la sesión", async () => {
    const { d } = armar({ doctores: [] });
    const c = convo(d);
    await c.say("agendar");
    const r = await c.say("1");
    assert.match(r.reply!, /no hay profesionales disponibles/);
    assert.equal(c.state, null);
  });

  it("sin lugar en 7 días: lo dice y vuelve a pedir fecha (no se queda colgado)", async () => {
    const { d, consultasDeSlots } = armar({ slots: () => ({ closed: false, slots: [] }) });
    const c = convo(d);
    await c.say("agendar");
    await c.say("1");
    const r = await c.say("mañana");
    assert.match(r.reply!, /No quedan horarios disponibles .* Tampoco encontré lugar en los 7 días siguientes/);
    assert.equal(c.state?.step, "date");
    assert.equal(consultasDeSlots.length, 8);
  });

  it("urgencia sin lugar en 7 días: lo dice y pide fecha, sin repetir la búsqueda de urgencia", async () => {
    const { d, consultasDeSlots } = armar({ slots: () => ({ closed: true, reason: "closed_day", slots: [] }) });
    const c = convo(d);
    await c.say("agendar");
    const r = await c.say("3");
    assert.equal(c.state?.step, "date");
    assert.match(r.reply!, /Tampoco encontré lugar/);
    const n = consultasDeSlots.length;
    await c.say("en 2 semanas");
    assert.equal(consultasDeSlots.length, n + 8);
    assert.equal(c.state?.step, "date");
  });

  it("varios doctores: urgencia pregunta el doctor y después busca el primer hueco", async () => {
    const { d, consultasDeSlots } = armar({
      doctores: [{ id: "doc1", firstName: "Ana", lastName: "García" }, { id: "doc2", firstName: "Beto", lastName: "Ruiz" }],
    });
    const c = convo(d);
    await c.say("agendar");
    const r = await c.say("3");
    assert.equal(c.state?.step, "doctor");
    assert.match(r.reply!, /¿Con qué profesional/);
    await c.say("2");
    assert.equal(c.state?.step, "slot");
    assert.equal(consultasDeSlots[0].doctorId, "doc2");
    assert.equal(consultasDeSlots[0].dateISO, HOY);
  });
});

describe("reagendar y cancelar siguen funcionando con el menú nuevo cableado", () => {
  const cita = {
    id: "a1", doctorId: "doc1",
    startsAt: new Date(`${addDaysISO(HOY, 3)}T16:00:00Z`), endsAt: new Date(`${addDaysISO(HOY, 3)}T16:30:00Z`),
    type: "Limpieza", doctor: { firstName: "Ana", lastName: "García" },
  };

  it("reagendar: una sola cita → fecha → horario → sí (nunca pasa por el menú)", async () => {
    const { d, movidas, creadas } = armar();
    d.getUpcomingAppointmentsForPatient = async () => [cita];
    const c = convo(d);
    const r = await c.say("quiero reagendar mi cita");
    assert.equal(c.state?.step, "date");
    assert.match(r.reply!, /Tu cita actual es el/);
    await c.say("mañana");
    await c.say("2");
    assert.equal(c.state?.step, "confirm");
    const fin = await c.say("sí");
    assert.match(fin.reply!, /reagendada/);
    assert.equal(movidas.length, 1);
    assert.deepEqual(movidas[0], { clinicId: "sedeA", appointmentId: "a1", dateISO: MANANA, time: "09:30" });
    assert.equal(creadas.length, 0);
  });

  it("reagendar sin citas próximas: lo dice; cancelar a mitad del agendado: cierra", async () => {
    const { d } = armar();
    const c = convo(d);
    const r = await c.say("reagendar");
    assert.match(r.reply!, /No encuentro citas próximas/);
    await c.say("agendar");
    await c.say("2");
    await c.say("mañana");
    const fin = await c.say("cancelar");
    assert.match(fin.reply!, /cancelé la solicitud/);
    assert.equal(c.state, null);
  });

  it("«no» al confirmar vuelve a los horarios del mismo día", async () => {
    const { d, creadas } = armar();
    const c = convo(d);
    await hastaConfirmar(c, "2");
    const r = await c.say("no");
    assert.equal(c.state?.step, "slot");
    assert.match(r.reply!, /elijamos otro horario/);
    await c.say("3");
    await c.say("sí");
    assert.equal(creadas[0].time, "10:00");
  });
});

describe("clínica sin las columnas (SQL sin pegar) y camino viejo", () => {
  it("sin botGenericas ni botBookable: menú de fábrica entero", async () => {
    const { d } = armar({ sedes: { sedeA: { catalogo: CATALOGO, marcadosIds: [], genericas: undefined } } });
    const c = convo(d);
    await c.say("agendar");
    assert.deepEqual(c.state.options.map((o: any) => o.id), ["menu:consulta", "menu:limpieza", "menu:urgencia", "menu:otro"]);
  });

  it("deps sin listBotServiceMenu (dobles viejos): el catálogo completo de siempre", async () => {
    const { d } = armar({ sinMenu: true });
    const c = convo(d);
    const r = await c.say("agendar");
    assert.match(r.reply!, /¿Qué servicio necesitas\?/);
    assert.equal(c.state.options.length, CATALOGO.length);
  });

  it("catálogo vacío con el menú: igual ofrece las genéricas y agenda una cita genérica", async () => {
    const { d, creadas } = armar({ sedes: { sedeA: { catalogo: [], marcadosIds: [] } } });
    const c = convo(d);
    await hastaConfirmar(c, "2");
    await c.say("sí");
    assert.equal(creadas[0].serviceId, null);
    assert.equal(creadas[0].durationMin, 0);
    assert.equal(creadas[0].reason, "Limpieza");
  });
});

describe("sedes: cada sede su propio menú y catálogo", () => {
  it("la sede A marcó Resina y apagó Limpieza; la sede B no tocó nada", async () => {
    const { d, creadas } = armar({
      sedes: {
        sedeA: { catalogo: CATALOGO, marcadosIds: ["resi"], genericas: { consulta: true, limpieza: false, urgencia: true } },
        sedeB: { catalogo: CATALOGO.filter((f) => f.id !== "limp"), marcadosIds: [] },
      },
    });
    const a = convo(d, { clinicId: "sedeA" });
    await a.say("agendar");
    assert.deepEqual(a.state.options.map((o: any) => o.id), ["menu:consulta", "menu:urgencia", "resi", "menu:otro"]);
    const b = convo(d, { clinicId: "sedeB" });
    await b.say("agendar");
    assert.deepEqual(b.state.options.map((o: any) => o.id), ["menu:consulta", "menu:limpieza", "menu:urgencia", "menu:otro"]);
    // En B no hay «limpieza» en el catálogo: cita genérica. En A, Resina del catálogo.
    await b.say("limpieza"); await b.say("mañana"); await b.say("1"); await b.say("sí");
    await a.say("resina"); await a.say("mañana"); await a.say("1"); await a.say("sí");
    assert.equal(creadas.length, 2);
    assert.equal(creadas[0].clinicId, "sedeB");
    assert.equal(creadas[0].serviceId, null);
    assert.equal(creadas[0].reason, "Limpieza");
    assert.equal(creadas[1].clinicId, "sedeA");
    assert.equal(creadas[1].serviceId, "resi");
  });
});

describe("anticipo con el menú nuevo", () => {
  it("se anuncia en el «¿confirmas?» con el serviceId del catálogo (y null en una genérica)", async () => {
    const pedidos: Array<string | null | undefined> = [];
    const anticipo: BookingDeps["anticipoParaAnunciar"] = async (_c, serviceId) => {
      pedidos.push(serviceId);
      return serviceId ? { monto: 200, minutos: 60 } : null;
    };
    const { d } = armar({ anticipo });
    const c = convo(d);
    const conf = await hastaConfirmar(c, "2");
    assert.match(conf.reply!, /200/);
    assert.deepEqual(pedidos, ["limp"]);
    // Sin «limpieza» en el catálogo: cita genérica, el anticipo se consulta con serviceId null.
    const { d: d2 } = armar({ anticipo, sedes: { sedeA: { catalogo: CATALOGO.filter((f) => f.id !== "limp"), marcadosIds: [] } } });
    const c2 = convo(d2);
    const conf2 = await hastaConfirmar(c2, "2");
    assert.doesNotMatch(conf2.reply!, /200/);
    assert.deepEqual(pedidos, ["limp", null]);
  });
});

describe("casarConCatalogo", () => {
  it("FALLA ARREGLADA: prefiere el nombre más corto (el genérico) entre los que casan", () => {
    const cat = [
      { id: "v-imp", name: "Valoración de implantes", duration: 60 },
      { id: "cons", name: "Consulta general", duration: 30 },
    ];
    assert.equal(casarConCatalogo("consulta", cat)?.id, "cons");
    assert.equal(casarConCatalogo("limpieza", [{ id: "a", name: "Limpieza profunda (curetaje)", duration: 60 }, { id: "b", name: "Profilaxis (limpieza)", duration: 30 }])?.id, "b");
    assert.equal(casarConCatalogo("urgencia", [{ id: "a", name: "Consulta de urgencia", duration: 30 }, { id: "b", name: "Urgencia", duration: 20 }])?.id, "b");
    assert.equal(casarConCatalogo("consulta", [{ id: "o", name: "Valoración de ortodoncia", duration: 30 }]), null);
  });
});
