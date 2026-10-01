/**
 * Webhook de WhatsApp de punta a punta — arreglos de la auditoría del bot
 * (ws1-t3: #1, #5, #7, #10, #11, #15, #19, #20).
 *
 * `npm run test:wa-webhook-bot`
 *
 * Se ejecuta el POST DE VERDAD con un payload firmado como lo firma Meta.
 * Dobles: Prisma (en memoria), el envío a Meta, el motor del bot y los efectos
 * laterales (Google, movimientos, anticipos). Nada sale a WhatsApp ni a
 * Anthropic.
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
});

// ── Payloads ────────────────────────────────────────────────────────────────
let wamidSeq = 0;
function mensaje(texto: string) {
  return { from: TEL, id: `wamid.IN.${++wamidSeq}`, type: "text", text: { body: texto } };
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
const enviar = (texto: string) => POST(peticion({ entry: [{ id: "waba", changes: [cambio([mensaje(texto)])] }] }));

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
const cancelo = () => e.citasActualizadas.some((a) => a.data?.status === "CANCELLED");

// ── #1 ──────────────────────────────────────────────────────────────────────
describe("#1 — una frase con «no» ya no cancela la cita del recordatorio", () => {
  it("«¿no tienen estacionamiento?» no cancela y la contesta el bot", async () => {
    e.recordatorios = [recordatorio()];
    await enviar("¿no tienen estacionamiento?");
    assert.equal(cancelo(), false, "la cita no debe cancelarse");
    assert.ok(!e.enviados.some((m) => m.body.includes("cancelada")), "no se dice «cita cancelada»");
    assert.equal(e.turnos.length, 1, "la pregunta pasa al bot");
  });

  it("«no» suelto pide CANCELAR, sin cancelar; «cancelar» después sí cancela", async () => {
    e.recordatorios = [recordatorio()];
    await enviar("no");
    assert.equal(cancelo(), false);
    assert.ok(e.enviados.at(-1)?.body.includes("responde *CANCELAR*"), "se le pide la palabra");
    assert.equal(e.turnos.length, 0);

    await enviar("cancelar");
    assert.equal(cancelo(), true);
    assert.ok(e.enviados.at(-1)?.body.includes("cancelada"));
  });

  it("«quiero reagendar» no cancela y va al flujo de agenda del bot", async () => {
    e.recordatorios = [recordatorio()];
    await enviar("quiero reagendar");
    assert.equal(cancelo(), false);
    assert.deepEqual(e.turnos.map((t) => t.incomingText), ["quiero reagendar"]);
  });

  it("«confirmo» sigue confirmando", async () => {
    e.recordatorios = [recordatorio()];
    await enviar("confirmo");
    assert.ok(e.citasActualizadas.some((a) => a.data?.status === "CONFIRMED"));
  });
});

// ── #15 ─────────────────────────────────────────────────────────────────────
describe("#15 — una pregunta con recordatorio pendiente se contesta", () => {
  it("no manda «No te entendí» y pasa al bot", async () => {
    e.recordatorios = [recordatorio()];
    await enviar("¿dónde están ubicados?");
    assert.ok(!e.enviados.some((m) => m.body.includes("No te entendí")));
    assert.equal(e.turnos.length, 1);
    assert.equal(e.enviados.at(-1)?.body, "respuesta del bot");
  });
});

// ── #5 ──────────────────────────────────────────────────────────────────────
describe("#5 — una encuesta sin contestar no se come el siguiente mensaje", () => {
  it("encuesta de hace 90 días + «hola, quiero una cita» → al bot, la encuesta no se toca", async () => {
    e.recordatorios = [
      recordatorio({ id: "enc", type: "FOLLOWUP", sentAt: new Date(Date.now() - 90 * 86_400_000), appointment: { id: "c0", status: "COMPLETED", patientId: "pac1", startsAt: new Date() } }),
    ];
    await enviar("hola, quiero una cita");
    assert.equal(e.turnos.length, 1);
    assert.equal(e.sqlCrudo.length, 0, "la encuesta no se cierra con un texto ajeno");
  });

  it("encuesta de hace 3 h + «excelente» → es la respuesta a la encuesta", async () => {
    e.recordatorios = [
      recordatorio({ id: "enc", type: "FOLLOWUP", sentAt: new Date(Date.now() - 3 * 3_600_000), appointment: { id: "c0", status: "COMPLETED", patientId: "pac1", startsAt: new Date() } }),
    ];
    await enviar("excelente");
    assert.equal(e.turnos.length, 0);
    assert.ok(e.sqlCrudo.some((q) => q.includes('"repliedAt"=NOW()')));
  });
});

// ── #10 ─────────────────────────────────────────────────────────────────────
describe("#10 — se procesa TODO lo que Meta agrupa en una llamada", () => {
  it("dos entradas, una con dos mensajes → tres IN y tres turnos", async () => {
    await POST(
      peticion({
        entry: [
          { id: "waba", changes: [cambio([mensaje("hola"), mensaje("quiero saber precios")])] },
          { id: "waba", changes: [cambio([mensaje("gracias")])] },
        ],
      }),
    );
    const ins = e.mensajes.filter((m) => m.direction === "IN").map((m) => m.body);
    assert.deepEqual(ins, ["hola", "quiero saber precios", "gracias"]);
    assert.equal(e.turnos.length, 3);
  });
});

// ── #19 ─────────────────────────────────────────────────────────────────────
describe("#19 — sin phone_number_id no se resuelve ninguna clínica", () => {
  it("mensaje sin metadata: no entra al Inbox de nadie", async () => {
    await POST(peticion({ entry: [{ id: "waba", changes: [cambio([mensaje("hola")], null)] }] }));
    assert.equal(e.mensajes.length, 0, "no se ingestó en ninguna clínica");
    assert.equal(e.turnos.length, 0);
  });
});

// ── #7 ──────────────────────────────────────────────────────────────────────
describe("#7 — las respuestas del bot guardan su wamid y el fallo se ve", () => {
  it("OUT con externalId sys:bot:<wamid>", async () => {
    await enviar("hola");
    const out = e.mensajes.find((m) => m.direction === "OUT");
    assert.equal(out?.externalId, "sys:bot:wamid.1");
  });

  it("si Meta rechaza (token 190): OUT FAILED con el código, conexión apagada y el estado del bot se guarda", async () => {
    e.envioFalla = new WhatsAppApiError({ message: "(#190) Session expired", code: 190, httpStatus: 401 });
    e.turnoRespuesta = { reply: "hola!", intent: "SMALLTALK", newBotState: { flow: "booking" } };
    await enviar("hola");
    const out = e.mensajes.find((m) => m.direction === "OUT");
    assert.ok(out, "la respuesta queda registrada aunque falló");
    assert.equal(out?.deliveryStatus, "FAILED");
    assert.equal(out?.errorCode, 190);
    assert.deepEqual(e.desconectada, [CLINICA.id]);
    assert.deepEqual(e.hilo.botState, { flow: "booking" });
  });

  it("un estado de Meta (delivered) encuentra la respuesta del bot por su wamid", async () => {
    await enviar("hola");
    const out = e.mensajes.find((m) => m.direction === "OUT")!;
    const busqueda = prismaFalso.inboxMessage.findFirst;
    let candidatos: string[] = [];
    prismaFalso.inboxMessage.findFirst = async (args: any) => {
      if (args?.where?.externalId?.in) candidatos = args.where.externalId.in;
      return busqueda(args);
    };
    try {
      await POST(
        peticion({
          entry: [{ id: "waba", changes: [{ field: "messages", value: { metadata: { phone_number_id: PNID }, statuses: [{ id: "wamid.1", status: "delivered", timestamp: "1790000000" }] } }] }],
        }),
      );
    } finally {
      prismaFalso.inboxMessage.findFirst = busqueda;
    }
    assert.ok(candidatos.includes(out.externalId!), `candidatos: ${candidatos.join(", ")}`);
  });
});

// ── #11 ─────────────────────────────────────────────────────────────────────
describe("#11 — un turno del bot a la vez por conversación", () => {
  it("dos mensajes casi juntos: nunca dos turnos a la vez, y el segundo ve el estado del primero", async () => {
    e.turnoDemoraMs = 150;
    const p1 = enviar("quiero agendar");
    await new Promise((r) => setTimeout(r, 20));
    const p2 = enviar("para mañana");
    await Promise.all([p1, p2]);
    assert.equal(e.maxEnCurso, 1, "turnos solapados");
    assert.equal(e.turnos.length, 2);
    assert.deepEqual(e.turnos[1].botState, { paso: 1 }, "el segundo turno arrancó con el estado guardado por el primero");
  });
});

// ── #17 (pedido de la pantalla C) ───────────────────────────────────────────
describe("el bot recibe el nombre del paciente", () => {
  it("firstName viaja a runBotTurn", async () => {
    await enviar("hola");
    assert.equal(e.turnos[0].firstName, "Ana");
  });
});
