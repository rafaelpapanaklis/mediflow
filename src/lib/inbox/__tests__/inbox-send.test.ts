// Tests puros (sin BD, sin Meta) del envío del Inbox y del match de teléfono.
// Patrón node:test + tsx, igual que src/lib/whatsapp/bot/__tests__/booking.test.ts.
// Correr: npm run test:inbox

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveWhatsappSendChannel,
  isWithin24hWindow,
  digitsLast10,
  pickPatientByPhone,
  WHATSAPP_24H_MS,
} from "../send-core";
import { classifyReminderReply } from "../../whatsapp/reminder-reply";

describe("resolveWhatsappSendChannel", () => {
  it("usa Meta cuando la clínica está conectada por Meta", () => {
    const r = resolveWhatsappSendChannel({
      waConnected: true,
      waPhoneNumberId: "123456",
      waAccessToken: "v1:tok",
    });
    assert.deepEqual(r, { channel: "meta" });
  });

  it("Meta tiene prioridad sobre Twilio cuando ambos existen", () => {
    const r = resolveWhatsappSendChannel({
      waConnected: true,
      waPhoneNumberId: "123",
      waAccessToken: "tok",
      twilioAccountSid: "AC",
      twilioAuthToken: "auth",
      twilioWhatsappNumber: "+5215500000000",
    });
    assert.equal(r.channel, "meta");
  });

  it("cae a Twilio legacy si NO hay Meta pero sí Twilio", () => {
    const r = resolveWhatsappSendChannel({
      waConnected: false,
      twilioAccountSid: "AC",
      twilioAuthToken: "auth",
      twilioWhatsappNumber: "+5215500000000",
    });
    assert.equal(r.channel, "twilio");
  });

  it("Meta a medias (waConnected pero sin credenciales) cae a Twilio", () => {
    const r = resolveWhatsappSendChannel({
      waConnected: true,
      waPhoneNumberId: null,
      waAccessToken: null,
      twilioAccountSid: "AC",
      twilioAuthToken: "auth",
      twilioWhatsappNumber: "+5215500000000",
    });
    assert.equal(r.channel, "twilio");
  });

  it("error claro si no hay ni Meta ni Twilio", () => {
    const r = resolveWhatsappSendChannel({});
    assert.equal(r.channel, "none");
    if (r.channel === "none") assert.equal(r.error, "whatsapp_not_connected");
  });
});

describe("isWithin24hWindow", () => {
  const now = new Date("2026-06-12T12:00:00.000Z");

  it("dentro de la ventana (1h)", () => {
    assert.equal(isWithin24hWindow(new Date(now.getTime() - 60 * 60 * 1000), now), true);
  });

  it("exactamente 24h sigue dentro (<=)", () => {
    assert.equal(isWithin24hWindow(new Date(now.getTime() - WHATSAPP_24H_MS), now), true);
  });

  it("un minuto más de 24h queda fuera", () => {
    assert.equal(isWithin24hWindow(new Date(now.getTime() - WHATSAPP_24H_MS - 60_000), now), false);
  });

  it("sin mensaje entrante (null) está fuera de ventana", () => {
    assert.equal(isWithin24hWindow(null, now), false);
  });

  it("acepta string ISO", () => {
    assert.equal(isWithin24hWindow(new Date(now.getTime() - 1000).toISOString(), now), true);
  });
});

describe("digitsLast10 + pickPatientByPhone", () => {
  it("normaliza con y sin +52, espacios y guiones a los mismos 10 dígitos", () => {
    assert.equal(digitsLast10("+52 1 55 1234 5678"), "5512345678");
    assert.equal(digitsLast10("5215512345678"), "5512345678");
    assert.equal(digitsLast10("55-1234-5678"), "5512345678");
    assert.equal(digitsLast10("5512345678"), "5512345678");
  });

  it("empareja el paciente correcto por últimos 10 dígitos", () => {
    const cands = [
      { id: "right", phone: "+52 55 1234 5678" },
      { id: "other", phone: "5599999999" },
    ];
    assert.equal(pickPatientByPhone(cands, "5215512345678")?.id, "right");
  });

  it("rechaza el falso positivo de contains (10 dígitos como substring de otro número)", () => {
    // "55123456780" CONTIENE "5512345678" pero NO es el mismo número.
    const cands = [{ id: "falsePositive", phone: "55123456780" }];
    assert.equal(pickPatientByPhone(cands, "5215512345678"), null);
  });

  it("elige el verdadero aunque haya un falso positivo en la lista", () => {
    const cands = [
      { id: "falsePositive", phone: "55123456780" },
      { id: "right", phone: "5215512345678" },
    ];
    assert.equal(pickPatientByPhone(cands, "5215512345678")?.id, "right");
  });

  it("número de origen inválido (<10 dígitos) no empareja", () => {
    assert.equal(pickPatientByPhone([{ id: "x", phone: "5512345678" }], "123"), null);
  });
});

describe("classifyReminderReply", () => {
  it("confirma con 1 y con palabras afirmativas (incluye acento)", () => {
    assert.equal(classifyReminderReply("1"), "confirm");
    assert.equal(classifyReminderReply("sí"), "confirm");
    assert.equal(classifyReminderReply("si"), "confirm");
    assert.equal(classifyReminderReply("ok"), "confirm");
    assert.equal(classifyReminderReply("claro"), "confirm");
  });

  it("cancela con 2 y con palabras negativas/cancelar", () => {
    assert.equal(classifyReminderReply("2"), "cancel");
    assert.equal(classifyReminderReply("no"), "cancel");
    assert.equal(classifyReminderReply("cancelar"), "cancel");
  });

  it("en frases ambiguas, CANCELAR gana sobre confirmar", () => {
    // Contiene "no" (negativo) → debe ser cancel, no confirm por el "sí".
    assert.equal(classifyReminderReply("mejor no, sí cancélala"), "cancel");
  });

  it("texto no relacionado no confirma ni cancela", () => {
    assert.equal(classifyReminderReply("hola buenas"), "none");
    assert.equal(classifyReminderReply("quiero una cita"), "none");
  });
});
