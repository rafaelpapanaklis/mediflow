// ws1-t3 — el recordatorio con botones por sendWhatsAppLogged: dentro de la
// ventana sale interactivo (y si Meta lo rechaza, el texto de siempre); fuera,
// la plantilla actual sale IGUAL que hoy y la propuesta con botones lleva los
// payloads del recordatorio. Dobles de Prisma y de Meta: nada sale a WhatsApp.
// Correr: npm run test:wa-botones
import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { WhatsAppApiError } from "@/lib/whatsapp/errors";
import { botonesRecordatorio } from "@/lib/whatsapp/interactivo";

const e = {
  ventanaAbierta: true,
  llamadas: [] as Array<{ tipo: string; args: any[] }>,
  interactivoFalla: null as Error | null,
  bandeja: [] as any[],
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      inboxMessage: { create: async ({ data }: any) => (e.bandeja.push(data), { id: "m" }) },
      clinic: { updateMany: async () => ({ count: 0 }), findUnique: async () => null },
    },
  },
});
mock.module("@/lib/whatsapp", {
  namedExports: {
    sendWhatsAppMessage: async (...args: any[]) => (e.llamadas.push({ tipo: "texto", args }), { messages: [{ id: "w.t" }] }),
    sendWhatsAppTemplate: async (...args: any[]) => (e.llamadas.push({ tipo: "plantilla", args }), { messages: [{ id: "w.p" }] }),
    sendWhatsAppInteractive: async (...args: any[]) => {
      if (e.interactivoFalla) throw e.interactivoFalla;
      e.llamadas.push({ tipo: "interactivo", args });
      return { messages: [{ id: "w.i" }] };
    },
    sendWhatsAppDocument: async () => ({}),
    uploadWhatsAppMedia: async () => "media",
  },
});
mock.module("@/lib/whatsapp/inbox-log", {
  namedExports: {
    findPatientByWhatsAppPhone: async () => null,
    lastInboundAtForPhone: async () => (e.ventanaAbierta ? new Date() : null),
    upsertWhatsAppThread: async () => ({ id: "th" }),
  },
});

let sendWhatsAppLogged: typeof import("../send-and-log").sendWhatsAppLogged;
before(async () => {
  ({ sendWhatsAppLogged } = await import("../send-and-log"));
});

const clinica = (waTemplates: unknown = null) => ({
  id: "cl1",
  waPhoneNumberId: "pn",
  waAccessToken: "tok",
  waConnected: true,
  waTemplates,
});
const PARAMS = ["Ana", "Clínica", "jueves 8 de octubre", "10:00", "Dr/a. Luis"];
const BOTONES = { tipo: "botones" as const, botones: botonesRecordatorio("rem1") };

beforeEach(() => {
  e.ventanaAbierta = true;
  e.llamadas = [];
  e.interactivoFalla = null;
  e.bandeja = [];
});

describe("recordatorio con botones — sendWhatsAppLogged", () => {
  it("dentro de la ventana: sale interactivo con los 3 botones y la bandeja los muestra", async () => {
    await sendWhatsAppLogged({ clinic: clinica(), to: "5215512345678", body: "Hola Ana, tu cita…", kind: "reminder", templateParams: PARAMS, interactivo: BOTONES });
    assert.deepEqual(e.llamadas.map((l) => l.tipo), ["interactivo"]);
    const payload = e.llamadas[0].args[3];
    assert.equal(payload.type, "button");
    assert.deepEqual(payload.action.buttons.map((b: any) => b.reply.id), ["rec.confirmar:rem1", "rec.reagendar:rem1", "rec.cancelar:rem1"]);
    assert.match(e.bandeja[0].body, /\n\n🔘 Opciones: ✅ Confirmar · 🔁 Reagendar · ❌ Cancelar$/);
    assert.equal(e.bandeja[0].externalId, "sys:reminder:w.i");
  });

  it("si Meta rechaza el interactivo, sale el texto de siempre (una sola vez)", async () => {
    e.interactivoFalla = new WhatsAppApiError({ message: "(#131009) bad", code: 131009, httpStatus: 400 });
    await sendWhatsAppLogged({ clinic: clinica(), to: "5215512345678", body: "Hola Ana", kind: "reminder", interactivo: BOTONES });
    assert.deepEqual(e.llamadas.map((l) => l.tipo), ["texto"]);
    assert.equal(e.bandeja[0].body, "Hola Ana");
  });

  it("un timeout del interactivo NO se reintenta como texto (pudo haber salido): lanza como siempre", async () => {
    e.interactivoFalla = new Error("The operation was aborted due to timeout");
    await assert.rejects(
      sendWhatsAppLogged({ clinic: clinica(), to: "5215512345678", body: "Hola Ana", kind: "reminder", interactivo: BOTONES }),
    );
    assert.equal(e.llamadas.length, 0);
  });

  it("fuera de la ventana con la plantilla ACTUAL: sale igual que hoy, sin botones", async () => {
    e.ventanaAbierta = false;
    const tpl = { reminder: { name: "dc_recordatorio_cita", lang: "es_MX", status: "APPROVED" } };
    await sendWhatsAppLogged({ clinic: clinica(tpl), to: "5215512345678", body: "x", kind: "reminder", templateParams: PARAMS, interactivo: BOTONES });
    assert.deepEqual(e.llamadas.map((l) => l.tipo), ["plantilla"]);
    assert.deepEqual(e.llamadas[0].args[5], [], "sin payloads de botones");
    assert.doesNotMatch(e.bandeja[0].body, /🔘/);
  });

  it("fuera de la ventana con la plantilla propuesta: lleva los payloads del recordatorio", async () => {
    e.ventanaAbierta = false;
    const tpl = { reminder: { name: "dc_recordatorio_cita_botones", lang: "es_MX", status: "APPROVED" } };
    await sendWhatsAppLogged({ clinic: clinica(tpl), to: "5215512345678", body: "x", kind: "reminder", templateParams: PARAMS, interactivo: BOTONES });
    assert.deepEqual(e.llamadas[0].args[5], ["rec.confirmar:rem1", "rec.reagendar:rem1", "rec.cancelar:rem1"]);
    assert.match(e.bandeja[0].body, /🔘 Opciones: ✅ Confirmar · 🔁 Reagendar · ❌ Cancelar$/);
  });

  it("sin `interactivo` (todos los demás envíos): texto como siempre", async () => {
    await sendWhatsAppLogged({ clinic: clinica(), to: "5215512345678", body: "Tu receta", kind: "prescription" });
    assert.deepEqual(e.llamadas.map((l) => l.tipo), ["texto"]);
    assert.equal(e.bandeja[0].body, "Tu receta");
  });
});
