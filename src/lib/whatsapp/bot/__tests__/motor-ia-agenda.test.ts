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
 *  - «quisiera una cita» entra a la agenda sin pasar por la IA.
 */
import Module from "node:module";
import path from "node:path";
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const RAIZ = path.resolve(__dirname, "../../../../..");
type Fila = Record<string, any>;

const estado = {
  config: null as Fila | null,
  textoModelo: "",
  prompts: [] as string[],
  agenda: [] as string[],
};

const prismaDoble = {
  whatsAppBotConfig: {
    findUnique: async () => estado.config,
  },
  inboxThread: {
    findUnique: async () => ({ botActive: true }),
  },
};

const dobles = new Map<string, unknown>([
  [path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prismaDoble }],
  [path.join(RAIZ, "src/lib/ai-billing/meter.ts"), {
    chatMetered: async (_clinicId: string, _funcion: string, req: { system: string }) => {
      estado.prompts.push(req.system);
      return { text: estado.textoModelo, error: null, mock: false };
    },
  }],
  [path.join(RAIZ, "src/lib/ai-billing/wallet.ts"), { canSpend: async () => true }],
  [path.join(RAIZ, "src/lib/ai-billing/interruptores.server.ts"), { funcionIaApagada: async () => false }],
  [path.join(RAIZ, "src/lib/whatsapp/bot/booking.ts"), {
    isBookingInProgress: () => false,
    handleBookingTurn: async (input: { incomingText: string }) => {
      estado.agenda.push(input.incomingText);
      return { reply: "AGENDA-REAL: ¿qué servicio?", intent: "BOOK_APPOINTMENT", newBotState: { step: "service" } };
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
  assert.equal(r.reply, undefined);
  assert.equal(r.handoff, true);
});

test("«quisiera una cita» entra a la agenda sin gastar IA", async () => {
  const r = await turno("Quisiera una cita para el martes");
  assert.equal(estado.prompts.length, 0);
  assert.equal(estado.agenda.length, 1);
  assert.equal(r.reply, "AGENDA-REAL: ¿qué servicio?");
});
