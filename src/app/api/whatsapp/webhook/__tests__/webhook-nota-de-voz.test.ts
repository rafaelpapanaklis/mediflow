/**
 * Webhook de WhatsApp de punta a punta — notas de voz (ws1-t5).
 *
 * `npm run test:wa-bot-voz`
 *
 * El POST DE VERDAD con un payload firmado como lo firma Meta. Los dobles son
 * los de webhook-bot.test.ts (Prisma en memoria, envío a Meta, motor del bot,
 * efectos laterales) más el de `entenderNotaDeVoz`, cuyo núcleo se prueba aparte
 * en lib/whatsapp/bot/__tests__/nota-de-voz.test.ts. Nada sale a WhatsApp, a
 * OpenAI ni a Anthropic. Lo que se fija aquí es el CONTRATO con el webhook.
 *
 * Para ver el fallo ANTES del arreglo: `WEBHOOK_RUTA=<copia de la ruta vieja>`.
 */
import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { WhatsAppApiError } from "@/lib/whatsapp/errors";

const SECRETO = "secreto-de-prueba";
process.env.WHATSAPP_APP_SECRET = SECRETO;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

const PNID = "pnid-rafael";
const CLINICA = {
  id: "cl-rafael",
  name: "Rafael Clinica",
  timezone: "America/Mexico_City",
  waPhoneNumberId: PNID,
  waAccessToken: "tok",
  waConnected: true,
};
const OTRA_CLINICA = { ...CLINICA, id: "cl-otra", waPhoneNumberId: "pnid-otra" };
// Un teléfono distinto por prueba: el rate-limit del bot (6/min por
// remitente) es real y se acumularía entre pruebas.
let telN = 0;
let TEL = "5215500000000";

// ── Estado del doble ────────────────────────────────────────────────────────
type Msg = {
  id: string;
  threadId: string;
  direction: "IN" | "OUT";
  body: string;
  externalId: string | null;
  sentAt: Date;
  isInternal: boolean;
  sentById: string | null;
  attachments: unknown;
  deliveryStatus?: string | null;
  errorCode?: number | null;
  errorTitle?: string | null;
};
const e = {
  mensajes: [] as Msg[],
  hilo: { id: "th1", botActive: true as boolean, botState: null as unknown },
  recordatorios: [] as any[],
  citasActualizadas: [] as any[],
  sqlCrudo: [] as string[],
  enviados: [] as Array<{ to: string; body: string }>,
  envioFalla: null as Error | null,
  turnos: [] as Array<{ incomingText: string; botState: unknown; firstName?: string | null }>,
  turnoRespuesta: { reply: "respuesta del bot", intent: "SMALLTALK", newBotState: undefined as unknown },
  turnoDemoraMs: 0,
  enCurso: 0,
  maxEnCurso: 0,
  desconectada: [] as string[],
  botConfig: { enabled: true, canBookAppointments: true },
  clinicLookups: [] as unknown[],
  hilosActualizados: [] as any[],
};
let seq = 0;

function coincide(m: Msg, w: any): boolean {
  if (!w) return true;
  if (typeof w.threadId === "string" && m.threadId !== w.threadId) return false;
  if (w.direction && m.direction !== w.direction) return false;
  if (typeof w.body === "string" && m.body !== w.body) return false;
  if (typeof w.externalId === "string" && m.externalId !== w.externalId) return false;
  if (w.externalId?.in && !w.externalId.in.includes(m.externalId)) return false;
  if (w.id?.not && m.id === w.id.not) return false;
  if (w.sentAt?.gt && !(m.sentAt > w.sentAt.gt)) return false;
  if (w.sentAt?.gte && !(m.sentAt >= w.sentAt.gte)) return false;
  if (w.isInternal === false && m.isInternal) return false;
  if (w.attachments && m.attachments != null) return false;
  return true;
}

const prismaFalso = {
  clinic: {
    findUnique: async ({ where }: any) => {
      e.clinicLookups.push(where.waPhoneNumberId);
      if (where.waPhoneNumberId === undefined) throw new Error("findUnique sin clave única (Prisma lanza)");
      return [CLINICA, OTRA_CLINICA].find((c) => c.waPhoneNumberId === where.waPhoneNumberId) ?? null;
    },
    // Lo que hace Prisma de verdad con `undefined`: descarta la clave y
    // devuelve la primera fila. Solo lo usa la ruta vieja.
    findFirst: async ({ where }: any) => {
      e.clinicLookups.push(where?.waPhoneNumberId);
      if (where?.waPhoneNumberId === undefined) return CLINICA;
      return [CLINICA, OTRA_CLINICA].find((c) => c.waPhoneNumberId === where.waPhoneNumberId) ?? null;
    },
  },
  inboxMessage: {
    findFirst: async ({ where }: any) => e.mensajes.find((m) => coincide(m, where)) ?? null,
    findMany: async ({ where }: any) => e.mensajes.filter((m) => coincide(m, where)).slice(-10).reverse(),
    count: async () => 0,
    create: async ({ data }: any) => {
      if (data.externalId && e.mensajes.some((m) => m.threadId === data.threadId && m.externalId === data.externalId)) {
        throw new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" });
      }
      const m: Msg = {
        id: `m${++seq}`,
        threadId: data.threadId,
        direction: data.direction,
        body: data.body,
        externalId: data.externalId ?? null,
        sentAt: data.sentAt ?? new Date(),
        isInternal: !!data.isInternal,
        sentById: data.sentById ?? null,
        attachments: data.attachments ?? null,
        deliveryStatus: data.deliveryStatus ?? null,
        errorCode: data.errorCode ?? null,
        errorTitle: data.errorTitle ?? null,
      };
      e.mensajes.push(m);
      return { id: m.id };
    },
    update: async () => ({}),
  },
  inboxThread: {
    findUnique: async () => ({ botActive: e.hilo.botActive, botState: e.hilo.botState }),
    update: async ({ data }: any) => {
      e.hilosActualizados.push(data);
      if (data.botActive !== undefined) e.hilo.botActive = data.botActive;
      if (data.botState !== undefined) e.hilo.botState = data.botState === Prisma.DbNull ? null : data.botState;
      return {};
    },
  },
  whatsAppReminder: {
    findMany: async () => e.recordatorios,
    updateMany: async () => ({ count: 0 }),
  },
  whatsAppBotConfig: { findUnique: async () => e.botConfig },
  appointment: {
    update: async (args: any) => {
      e.citasActualizadas.push(args);
      return {};
    },
  },
  $transaction: async (fn: any) =>
    fn({ appointment: { update: async (args: any) => (e.citasActualizadas.push(args), {}) } }),
  $executeRaw: (strings: TemplateStringsArray) => {
    e.sqlCrudo.push(strings.join("?"));
    return Promise.resolve(1);
  },
};

mock.module("@/lib/prisma", { namedExports: { prisma: prismaFalso } });
mock.module("@/lib/whatsapp", {
  namedExports: {
    sendWhatsAppMessage: async (_p: string, _t: string, to: string, body: string) => {
      if (e.envioFalla) throw e.envioFalla;
      e.enviados.push({ to, body });
      return { messages: [{ id: `wamid.${e.enviados.length}` }] };
    },
    sendWhatsAppInteractive: async (_p: string, _t: string, to: string, inter: any) => {
      e.enviados.push({ to, body: String(inter?.body?.text ?? "") });
      return { messages: [{ id: `wamid.${e.enviados.length}` }] };
    },
  },
});
mock.module("@/lib/whatsapp/bot/engine", {
  namedExports: {
    runBotTurn: async (input: any) => {
      e.enCurso++;
      e.maxEnCurso = Math.max(e.maxEnCurso, e.enCurso);
      e.turnos.push({ incomingText: input.incomingText, botState: input.botState, firstName: input.patient?.firstName });
      if (e.turnoDemoraMs) await new Promise((r) => setTimeout(r, e.turnoDemoraMs));
      e.enCurso--;
      return { ...e.turnoRespuesta, newBotState: e.turnoRespuesta.newBotState ?? { paso: e.turnos.length } };
    },
  },
});
mock.module("@/lib/whatsapp/inbox-log", {
  namedExports: {
    findPatientsByWhatsAppPhone: async () => [{ id: "pac1", phone: TEL, firstName: "Ana" }],
    findPatientByWhatsAppPhone: async () => ({ id: "pac1" }),
    upsertWhatsAppThread: async () => ({ id: e.hilo.id, botActive: e.hilo.botActive, botState: e.hilo.botState, patientId: "pac1" }),
  },
});
mock.module("@/lib/agenda/legacy-helpers", {
  namedExports: { timeHHMMInTz: () => "10:00" },
});
mock.module("@/lib/whatsapp/connection", {
  namedExports: { markWhatsAppDisconnected: async (id: string) => void e.desconectada.push(id) },
});
mock.module("@/lib/whatsapp/provision-templates", { namedExports: { ingestTemplateStatusUpdate: async () => {} } });
mock.module("@/lib/reminders/reschedule.server", { namedExports: { cancelPendingRemindersForAppointment: async () => {} } });
mock.module("@/lib/anticipos/cita-cancelada.server", { namedExports: { marcarPendienteSiHayDinero: async () => {} } });
mock.module("@/lib/whatsapp/bot/movimientos-bot", { namedExports: { anotarRespuestaARecordatorio: async () => {} } });
mock.module("@/lib/agenda/google-sync", { namedExports: { sincronizarCitaEnSegundoPlano: async () => {} } });
mock.module("@/lib/whatsapp/bot/handoff", {
  namedExports: {
    reactivarBotSiVencioHandoff: async () => false,
    anotarHandoffEnInbox: async () => {},
    leerHandoff: () => null,
  },
});

// ── Doble de entenderNotaDeVoz (el núcleo real se prueba aparte) ────────────
const voz = {
  respuesta: { accion: "como_antes", motivo: "bot_apagado" } as any,
  lanza: false,
  llamadas: [] as any[],
};
mock.module("@/lib/whatsapp/bot/nota-de-voz", {
  namedExports: {
    entenderNotaDeVoz: async (entrada: any) => {
      voz.llamadas.push(entrada);
      if (voz.lanza) throw new Error("no debería lanzar");
      // Como el real: con texto, la bandeja pasa a «🎤 Nota de voz: …».
      if (voz.respuesta.accion === "texto") {
        const m = e.mensajes.find((x) => x.id === entrada.inMsgId);
        if (m) m.body = `🎤 Nota de voz: ${voz.respuesta.texto}`;
      }
      return voz.respuesta;
    },
  },
});

const RUTA = process.env.WEBHOOK_RUTA ? path.resolve(process.env.WEBHOOK_RUTA) : "../route";
let POST: (req: any) => Promise<Response>;
before(async () => {
  ({ POST } = await import(RUTA));
});

beforeEach(() => {
  TEL = `52155${String(++telN).padStart(8, "0")}`;
  e.mensajes = [];
  e.hilo = { id: "th1", botActive: true, botState: null };
  e.recordatorios = [];
  e.citasActualizadas = [];
  e.sqlCrudo = [];
  e.enviados = [];
  e.envioFalla = null;
  e.turnos = [];
  e.turnoRespuesta = { reply: "respuesta del bot", intent: "SMALLTALK", newBotState: undefined };
  e.turnoDemoraMs = 0;
  e.enCurso = 0;
  e.maxEnCurso = 0;
  e.desconectada = [];
  e.botConfig = { enabled: true, canBookAppointments: true };
  e.clinicLookups = [];
  e.hilosActualizados = [];
  voz.respuesta = { accion: "como_antes", motivo: "bot_apagado" };
  voz.lanza = false;
  voz.llamadas = [];
});

// ── Payloads de audio ───────────────────────────────────────────────────────
let wamidSeq = 0;
function mensaje(texto: string) {
  return { from: TEL, id: `wamid.IN.${++wamidSeq}`, type: "text", text: { body: texto } };
}
function notaDeVoz(voice = true) {
  return {
    from: TEL,
    id: `wamid.IN.${++wamidSeq}`,
    type: "audio",
    audio: { id: `media.${wamidSeq}`, mime_type: "audio/ogg; codecs=opus", voice },
  };
}
function foto() {
  return { from: TEL, id: `wamid.IN.${++wamidSeq}`, type: "image", image: { id: "media.foto", mime_type: "image/jpeg" } };
}
function cambio(msgs: any[], pnid: string | null = PNID) {
  return {
    field: "messages",
    value: {
      messaging_product: "whatsapp",
      ...(pnid ? { metadata: { phone_number_id: pnid } } : {}),
      contacts: [{ profile: { name: "Ana" } }],
      messages: msgs,
    },
  };
}
function peticion(body: unknown) {
  const raw = JSON.stringify(body);
  const firma = "sha256=" + createHmac("sha256", SECRETO).update(raw).digest("hex");
  return new Request("https://x/api/whatsapp/webhook", {
    method: "POST",
    headers: { "x-hub-signature-256": firma, "content-type": "application/json" },
    body: raw,
  });
}
const mandar = (msg: any) => POST(peticion({ entry: [{ id: "waba", changes: [cambio([msg])] }] }));
const enviar = (texto: string) => mandar(mensaje(texto));

function recordatorio(over: Partial<any> = {}) {
  return {
    id: "rec1",
    clinicId: CLINICA.id,
    type: "APPT_AUTO",
    status: "SENT",
    sentAt: new Date(Date.now() - 3_600_000),
    appointmentId: "cita1",
    appointment: { id: "cita1", status: "SCHEDULED", patientId: "pac1", startsAt: new Date("2026-10-08T16:00:00Z") },
    ...over,
  };
}

const RECIBI = "Recibí tu archivo, en un momento te atiende una persona.";

describe("nota de voz — se entiende como si el paciente lo hubiera escrito", () => {
  it("el texto transcrito llega al motor y el bot contesta; la bandeja dice «🎤 Nota de voz: …»", async () => {
    voz.respuesta = { accion: "texto", texto: "Quiero agendar una limpieza" };
    await mandar(notaDeVoz());
    assert.deepEqual(e.turnos.map((t) => t.incomingText), ["Quiero agendar una limpieza"]);
    assert.equal(e.enviados.at(-1)?.body, "respuesta del bot");
    assert.ok(!e.enviados.some((m) => m.body === RECIBI), "ya no dice «recibí tu archivo»");
    const entrada = e.mensajes.find((m) => m.direction === "IN")!;
    assert.equal(entrada.body, "🎤 Nota de voz: Quiero agendar una limpieza");
    assert.ok(Array.isArray(entrada.attachments), "el audio sigue en la bandeja para escucharlo");
  });

  it("el módulo recibe la clínica, el IN recién creado, el token de ESA clínica y el estado del hilo", async () => {
    voz.respuesta = { accion: "texto", texto: "hola" };
    await mandar(notaDeVoz());
    const llamada = voz.llamadas[0];
    const entrada = e.mensajes.find((m) => m.direction === "IN")!;
    assert.equal(llamada.clinicId, CLINICA.id);
    assert.equal(llamada.threadId, e.hilo.id);
    assert.equal(llamada.inMsgId, entrada.id);
    assert.equal(llamada.accessToken, CLINICA.waAccessToken);
    assert.equal(llamada.botActive, true);
    assert.equal(llamada.from, TEL);
    assert.equal(llamada.audio.id, entrada.attachments && (entrada.attachments as any[])[0].mediaId);
  });

  it("«confirmo» dicho en voz confirma la cita del recordatorio, como escrito", async () => {
    e.recordatorios = [recordatorio()];
    voz.respuesta = { accion: "texto", texto: "Confirmo" };
    await mandar(notaDeVoz());
    assert.ok(e.citasActualizadas.some((a) => a.data?.status === "CONFIRMED"));
    assert.equal(e.turnos.length, 0);
  });

  it("un «no» suelto en voz NO cancela (mismas reglas que el texto)", async () => {
    e.recordatorios = [recordatorio()];
    voz.respuesta = { accion: "texto", texto: "No." };
    await mandar(notaDeVoz());
    assert.ok(!e.citasActualizadas.some((a) => a.data?.status === "CANCELLED"));
  });
});

describe("nota de voz — no se pudo escuchar", () => {
  it("el paciente recibe «No pude escuchar tu audio, ¿me lo escribes?» y el bot no corre", async () => {
    voz.respuesta = { accion: "avisar", mensaje: "No pude escuchar tu audio, ¿me lo escribes? 🙏", motivo: "audio_danado" };
    const r = await mandar(notaDeVoz());
    assert.equal(r.status, 200);
    assert.deepEqual(e.enviados.map((m) => m.body), ["No pude escuchar tu audio, ¿me lo escribes? 🙏"]);
    assert.equal(e.turnos.length, 0);
  });

  it("si el módulo LANZA (no debería), el webhook responde 200 y el audio queda en la bandeja", async () => {
    voz.lanza = true;
    const r = await mandar(notaDeVoz());
    assert.equal(r.status, 200);
    assert.equal(e.mensajes.filter((m) => m.direction === "IN").length, 1);
    assert.equal(e.turnos.length, 0);
  });
});

describe("nota de voz — cuando no toca transcribir, todo como antes", () => {
  it("como_antes → «Recibí tu archivo…» y el bot no corre", async () => {
    voz.respuesta = { accion: "como_antes", motivo: "sin_cupo" };
    await mandar(notaDeVoz());
    assert.deepEqual(e.enviados.map((m) => m.body), [RECIBI]);
    assert.equal(e.turnos.length, 0);
    assert.equal(e.mensajes.find((m) => m.direction === "IN")?.body, "🎤 Te mandaron una nota de voz");
  });

  it("una foto no pasa por el transcriptor", async () => {
    await mandar(foto());
    assert.equal(voz.llamadas.length, 0);
    assert.deepEqual(e.enviados.map((m) => m.body), [RECIBI]);
  });

  it("un texto no pasa por el transcriptor", async () => {
    await enviar("hola");
    assert.equal(voz.llamadas.length, 0);
    assert.equal(e.turnos.length, 1);
  });

  it("una nota de voz repetida por Meta (mismo wamid) no se transcribe dos veces", async () => {
    voz.respuesta = { accion: "texto", texto: "hola" };
    const msg = notaDeVoz();
    await mandar(msg);
    await mandar(msg);
    assert.equal(voz.llamadas.length, 1);
    assert.equal(e.turnos.length, 1);
  });
});
