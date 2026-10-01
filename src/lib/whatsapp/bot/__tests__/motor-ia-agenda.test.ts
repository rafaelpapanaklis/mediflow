/**
 * Motor del bot + IA libre con un MODELO FALSO (ws1-t5).
 *
 * Run: npm run test:wa-bot-fecha
 *
 * Se carga el motor de verdad (engine.ts → ai.ts → ai-prompt.ts) y se
 * sustituye solo lo que sale del proceso o toca la base: Prisma, el cobro de
 * IA (chatMetered devuelve el texto que diga la prueba y guarda el prompt),
 * el monedero, el interruptor, la agenda (handleBookingTurn) y el saldo.
 * Ni una llamada a Anthropic ni a WhatsApp.
 *
 * Lo que se comprueba:
 *  - el system prompt que llega al modelo lleva la fecha y hora del turno en
 *    la zona de la clínica;
 *  - si el modelo pide agenda, el paciente NO recibe texto del modelo: pasa
 *    al flujo de agenda real; sin agendado encendido, se deriva a una persona;
 *  - «quisiera una cita» entra a la agenda sin pasar por la IA;
 *  - #4: al derivar, el paciente recibe un aviso y queda la marca de handoff;
 *  - #9: fuera de horario se contesta FAQ y agenda, y el aviso sale 1 vez al día;
 *  - #14: «a», «de», «ta» no casan con ninguna FAQ.
 */
import Module from "node:module";
import path from "node:path";
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const RAIZ = path.resolve(__dirname, "../../../../..");
type Fila = Record<string, any>;

const estado = {
  config: null as Fila | null,
  textoModelo: "" as string | null,
  prompts: [] as string[],
  agenda: [] as string[],
  /** Respuesta que da la agenda falsa (null = no aplica). */
  respuestaAgenda: { reply: "AGENDA-REAL: ¿qué servicio?", intent: "BOOK_APPOINTMENT", newBotState: { step: "service" } } as Fila | null,
  /** OUT ya enviados en el hilo (para el aviso de fuera de horario). */
  outs: [] as Fila[],
};

const prismaDoble = {
  whatsAppBotConfig: {
    findUnique: async () => estado.config,
  },
  inboxThread: {
    findUnique: async () => ({ botActive: true }),
  },
  inboxMessage: {
    findFirst: async ({ where }: { where: Fila }) =>
      estado.outs.find(
        (m) => m.threadId === where.threadId && m.body === where.body && (!where.sentAt?.gte || m.sentAt >= where.sentAt.gte),
      ) ?? null,
  },
};

const dobles = new Map<string, unknown>([
  [path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prismaDoble }],
  [path.join(RAIZ, "src/lib/ai-billing/meter.ts"), {
    chatMetered: async (_clinicId: string, _funcion: string, req: { system: string | Array<{ text: string }> }) => {
      estado.prompts.push(typeof req.system === "string" ? req.system : req.system.map((b) => b.text).join("\n"));
      // null = la IA falla (timeout, sin saldo…)
      if (estado.textoModelo === null) return { text: "", error: "claude_aborted", mock: false };
      return { text: estado.textoModelo, error: null, mock: false };
    },
  }],
  [path.join(RAIZ, "src/lib/ai-billing/wallet.ts"), { canSpend: async () => true }],
  [path.join(RAIZ, "src/lib/ai-billing/interruptores.server.ts"), { funcionIaApagada: async () => false }],
  [path.join(RAIZ, "src/lib/whatsapp/bot/booking.ts"), {
    isBookingInProgress: () => false,
    handleBookingTurn: async (input: { incomingText: string }) => {
      estado.agenda.push(input.incomingText);
      return estado.respuestaAgenda ? { ...estado.respuestaAgenda } : null;
    },
  }],
  [path.join(RAIZ, "src/lib/whatsapp/bot/saldo.ts"), {
    isSaldoInProgress: () => false,
    handleSaldoTurn: async () => null,
  }],
  [path.join(RAIZ, "src/lib/reminders/config.ts"), { getCobranzaSettings: () => ({ bot: false }) }],
  [path.join(RAIZ, "src/lib/orthodontics/clinic-settings-db.ts"), {
    loadOrthoClinicSettings: async () => ({ proximoControlBotEnabled: false }),
  }],
]);

const M = Module as unknown as {
  _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (req: string, parent: unknown, isMain: boolean) => string;
};
const cargaOriginal = M._load;
M._load = function (req, parent, isMain) {
  if (req === "server-only" || req === "client-only") return {};
  let resuelto: string | null = null;
  try { resuelto = M._resolveFilename(req, parent, isMain); } catch { resuelto = null; }
  if (resuelto && dobles.has(resuelto)) return dobles.get(resuelto);
  return cargaOriginal.call(this, req, parent, isMain);
};

// Si algo intentara salir a la red, la prueba revienta.
globalThis.fetch = (async () => {
  throw new Error("La prueba no debe llamar a la red");
}) as typeof fetch;

let runBotTurn: typeof import("../engine")["runBotTurn"];
before(async () => {
  ({ runBotTurn } = await import("../engine"));
});

function configBase(extra: Fila = {}): Fila {
  return {
    id: "cfg",
    clinicId: "clinica_prueba",
    enabled: true,
    botName: "Asistente",
    persona: "Eres amable.",
    greeting: null,
    businessHours: null,
    afterHoursMsg: null,
    canAnswerFaq: true,
    canBookAppointments: true,
    fallbackToHuman: true,
    faqs: [],
    clinic: { timezone: "America/Mexico_City", reminderSettings: null },
    ...extra,
  };
}

beforeEach(() => {
  estado.config = configBase();
  estado.textoModelo = "";
  estado.prompts.length = 0;
  estado.agenda.length = 0;
  estado.outs.length = 0;
  estado.respuestaAgenda = { reply: "AGENDA-REAL: ¿qué servicio?", intent: "BOOK_APPOINTMENT", newBotState: { step: "service" } };
});

const turno = (incomingText: string) =>
  runBotTurn({ clinicId: "clinica_prueba", threadId: "t1", incomingText, history: [] });

test("el prompt del turno lleva la fecha y hora reales en la zona de la clínica", async () => {
  estado.textoModelo = "Estamos en 2026.";
  const antes = new Date();
  const r = await turno("¿en qué año estamos?");
  assert.equal(r.reply, "Estamos en 2026.");
  const prompt = estado.prompts[0];
  const hoy = new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City", weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(antes).replace(",", "");
  assert.ok(prompt.includes(`Hoy es ${hoy}`), `el prompt no trae «Hoy es ${hoy}»`);
  assert.match(prompt, /zona America\/Mexico_City, UTC-6/);
});

test("otra zona de clínica, otro reloj", async () => {
  estado.config = configBase({ clinic: { timezone: "America/Cancun", reminderSettings: null } });
  estado.textoModelo = "Hola.";
  await turno("hola");
  assert.match(estado.prompts[0], /zona America\/Cancun, UTC-5/);
});

test("si el modelo pide agenda, el paciente entra al flujo real y no recibe texto del modelo", async () => {
  estado.textoModelo = "__AGENDA__";
  const r = await turno("me quedaría bien el lunes en la tarde para que me revisen");
  assert.equal(estado.agenda.length, 1);
  assert.equal(r.reply, "AGENDA-REAL: ¿qué servicio?");
  assert.ok(!r.reply?.includes("__AGENDA__"));
});

test("sin agendado encendido, la petición de cita se deriva a una persona", async () => {
  estado.config = configBase({ canBookAppointments: false });
  estado.textoModelo = "__HANDOFF__";
  const r = await turno("me quedaría bien el lunes en la tarde");
  assert.equal(estado.agenda.length, 0);
  assert.equal(r.handoff, true);
  assert.ok(estado.prompts[0].includes("disponibles: responde EXACTAMENTE __HANDOFF__"));
});

test("aunque el modelo diga agenda con el agendado apagado, nunca se agenda ni se manda el centinela", async () => {
  estado.config = configBase({ canBookAppointments: false });
  estado.textoModelo = "__AGENDA__";
  const r = await turno("una cita porfa");
  assert.equal(estado.agenda.length, 0);
  // #4: ya no es mudo — sale el aviso de handoff, nunca el centinela.
  assert.equal(r.reply, "Te comunico con el equipo de la clínica, en breve te responden. 🙋");
  assert.equal(r.handoff, true);
});

test("«quisiera una cita» entra a la agenda sin gastar IA", async () => {
  const r = await turno("Quisiera una cita para el martes");
  assert.equal(estado.prompts.length, 0);
  assert.equal(estado.agenda.length, 1);
  assert.equal(r.reply, "AGENDA-REAL: ¿qué servicio?");
});

/* ── #4 handoff con aviso ───────────────────────────────────────────── */

test("#4: si la IA falla, el paciente recibe el aviso y el hilo queda marcado", async () => {
  estado.textoModelo = null;
  const r = await turno("¿atienden niños de 3 años?");
  assert.equal(r.handoff, true);
  assert.equal(r.reply, "Te comunico con el equipo de la clínica, en breve te responden. 🙋");
  assert.match(JSON.stringify(r.newBotState), /"handoff":\{"at":"[^"]+","motivo":"sin_respuesta"\}/);
});

test("#4: si el modelo pide una persona, también hay aviso y marca", async () => {
  estado.textoModelo = "__HANDOFF__";
  const r = await turno("quiero hablar con el doctor");
  assert.equal(r.handoff, true);
  assert.equal(r.reply, "Te comunico con el equipo de la clínica, en breve te responden. 🙋");
  assert.match(JSON.stringify(r.newBotState), /"motivo":"modelo"/);
});

test("#4: el handoff de la agenda conserva su texto y suma la marca", async () => {
  estado.respuestaAgenda = { reply: "Creo que será más fácil si te ayuda una persona.", intent: "BOOK_APPOINTMENT", handoff: true, newBotState: null };
  const r = await turno("quiero agendar");
  assert.equal(r.reply, "Creo que será más fácil si te ayuda una persona.");
  assert.equal(r.handoff, true);
  assert.match(JSON.stringify(r.newBotState), /"motivo":"agenda"/);
});

test("#4: sin derivación a humano configurada, no hay aviso ni pausa", async () => {
  estado.config = configBase({ fallbackToHuman: false });
  estado.textoModelo = null;
  const r = await turno("¿atienden niños?");
  assert.equal(r.reply, undefined);
  assert.equal(r.handoff, undefined);
});

/* ── #14 matchFaq con textos cortos ─────────────────────────────────── */

const FAQS = [
  { id: "f1", question: "¿Aceptan tarjeta de crédito?", answer: "Sí, todas las tarjetas.", enabled: true, order: 0 },
  { id: "f2", question: "¿Dónde están ubicados?", answer: "En Av. Siempre Viva 123.", enabled: true, order: 1 },
];

for (const corto of ["a", "de", "ta", "ok", "si"]) {
  test(`#14: «${corto}» no dispara ninguna FAQ`, async () => {
    estado.config = configBase({ faqs: FAQS });
    estado.textoModelo = "Hola, ¿en qué te ayudo?";
    const r = await turno(corto);
    assert.notEqual(r.intent, "FAQ");
    assert.equal(r.reply, "Hola, ¿en qué te ayudo?");
  });
}

test("#14: una pregunta real sí casa con su FAQ", async () => {
  estado.config = configBase({ faqs: FAQS });
  assert.equal((await turno("aceptan tarjeta?")).reply, "Sí, todas las tarjetas.");
  assert.equal((await turno("¿dónde están ubicados?")).reply, "En Av. Siempre Viva 123.");
});

/* ── #9 fuera de horario ────────────────────────────────────────────── */

const CERRADO = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), { enabled: false, open: "09:00", close: "18:00" }]));
const AVISO_NOCHE = "Estamos cerrados; te respondemos mañana a partir de las 9.";

test("#9: fuera de horario la FAQ se contesta (antes salía el aviso)", async () => {
  estado.config = configBase({ faqs: FAQS, businessHours: CERRADO, afterHoursMsg: AVISO_NOCHE });
  assert.equal((await turno("¿dónde están ubicados?")).reply, "En Av. Siempre Viva 123.");
});

test("#9: fuera de horario se agenda con la agenda real", async () => {
  estado.config = configBase({ businessHours: CERRADO, afterHoursMsg: AVISO_NOCHE });
  const r = await turno("quiero una cita");
  assert.equal(r.reply, "AGENDA-REAL: ¿qué servicio?");
});

test("#9: el aviso de fuera de horario sale una vez al día; después sigue la IA", async () => {
  estado.config = configBase({ businessHours: CERRADO, afterHoursMsg: AVISO_NOCHE });
  estado.textoModelo = "Respuesta de la IA";
  assert.equal((await turno("hola")).reply, AVISO_NOCHE);
  assert.equal(estado.prompts.length, 0, "el aviso no gasta IA");
  estado.outs.push({ threadId: "t1", body: AVISO_NOCHE, sentAt: new Date() });
  assert.equal((await turno("¿y los domingos?")).reply, "Respuesta de la IA");
});

test("#9: el aviso de ayer no cuenta para hoy", async () => {
  estado.config = configBase({ businessHours: CERRADO, afterHoursMsg: AVISO_NOCHE });
  estado.outs.push({ threadId: "t1", body: AVISO_NOCHE, sentAt: new Date(Date.now() - 30 * 60 * 60 * 1000) });
  assert.equal((await turno("hola")).reply, AVISO_NOCHE);
});
