/* ═══════════════════════════════════════════════════════════════════════
   ACUSE AUTOMÁTICO opcional — la decisión PURA (sin base).

     npx tsx --test src/lib/barber/__tests__/wa-acuse.test.ts

   Decisión de Rafael (15-nov-2026, #7). Con base, de punta a punta por el
   webhook: wa-acuse-integration.test.ts.
   ═══════════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BARBER_WA_ACK_DEFAULT_TEXT,
  BARBER_WA_ACK_MARK,
  BARBER_WA_ACK_REMINDER_MAX_AGE_MS,
  BARBER_WA_ACK_TEXT_MAX,
  DEFAULT_BARBER_WA_ACK_SETTINGS,
  barberWaAckText,
  cleanBarberWaAckText,
  decideBarberWaAck,
  isBarberWaAckRow,
  normalizeBarberWaAckSettings,
  type BarberWaAckInput,
} from "../wa-acuse-core";
import { BARBER_WA_SYS_PREFIX } from "../whatsapp-core";

const REMINDER = "recordatorio_cita";
const now = new Date("2026-11-15T18:00:00Z");

function base(over: Partial<BarberWaAckInput> = {}): BarberWaAckInput {
  return {
    settings: { enabled: true, message: null },
    connected: true,
    writtenText: true,
    handled: false,
    botAttended: false,
    lastWord: { templateName: REMINDER, createdAt: new Date(now.getTime() - 60 * 60_000) },
    reminderTemplate: REMINDER,
    alreadyAcked: false,
    quotaFits: true,
    now,
    ...over,
  };
}

test("APAGADO por defecto, y el texto de fábrica es el que dijo Rafael", () => {
  assert.deepEqual(DEFAULT_BARBER_WA_ACK_SETTINGS, { enabled: false, message: null });
  assert.deepEqual(normalizeBarberWaAckSettings(null), { enabled: false, message: null });
  assert.deepEqual(normalizeBarberWaAckSettings({ enabled: "true" }), { enabled: false, message: null });
  assert.equal(BARBER_WA_ACK_DEFAULT_TEXT, "Recibimos tu mensaje. En un momento te contestamos.");
  assert.equal(barberWaAckText({ enabled: true, message: null }), BARBER_WA_ACK_DEFAULT_TEXT);
  assert.equal(barberWaAckText({ enabled: true, message: "¡Ya te leímos!" }), "¡Ya te leímos!");
});

test("el texto de la barbería se limpia y se recorta; vacío = el de fábrica", () => {
  assert.equal(cleanBarberWaAckText("   "), null);
  assert.equal(cleanBarberWaAckText(42), null);
  assert.equal(cleanBarberWaAckText("  Hola\u0000   ahí \r\n\r\n\r\n\r\nvamos  "), "Hola ahí \n\nvamos");
  assert.equal(cleanBarberWaAckText("x".repeat(500))!.length, BARBER_WA_ACK_TEXT_MAX);
  assert.deepEqual(normalizeBarberWaAckSettings({ enabled: true, message: "  " }), { enabled: true, message: null });
});

test("la marca del acuse no es de sistema (la bandeja SÍ lo enseña)", () => {
  assert.ok(isBarberWaAckRow(BARBER_WA_ACK_MARK));
  assert.ok(!BARBER_WA_ACK_MARK.startsWith(BARBER_WA_SYS_PREFIX));
  assert.ok(!isBarberWaAckRow(null));
  assert.ok(!isBarberWaAckRow(REMINDER));
});

test("sale cuando todo se cumple", () => {
  assert.equal(decideBarberWaAck(base()), "send");
});

test("cada condición, por separado, lo apaga", () => {
  assert.equal(decideBarberWaAck(base({ settings: { enabled: false, message: null } })), "off");
  assert.equal(decideBarberWaAck(base({ writtenText: false })), "notText");
  assert.equal(decideBarberWaAck(base({ handled: true })), "handled");
  assert.equal(decideBarberWaAck(base({ botAttended: true })), "botAttended");
  assert.equal(decideBarberWaAck(base({ alreadyAcked: true })), "alreadyAcked");
  assert.equal(decideBarberWaAck(base({ connected: false })), "notConnected");
  assert.equal(decideBarberWaAck(base({ quotaFits: false })), "noQuota");
});

test("solo es «respuesta al recordatorio» si el recordatorio fue lo ÚLTIMO que le dijimos", () => {
  // Nunca le escribimos.
  assert.equal(decideBarberWaAck(base({ lastWord: null })), "notAReminderReply");
  // Alguien de la barbería (o el bot, o un aviso) ya contestó después: su
  // mensaje es lo último, sin plantilla.
  assert.equal(
    decideBarberWaAck(base({ lastWord: { templateName: null, createdAt: new Date(now.getTime() - 60_000) } })),
    "notAReminderReply",
  );
  // Lo último fue otra plantilla (la confirmación de una reserva).
  assert.equal(
    decideBarberWaAck(base({ lastWord: { templateName: "cita_agendada", createdAt: now } })),
    "notAReminderReply",
  );
});

test("un recordatorio de hace más de 48 h ya no abre conversación", () => {
  const justo = new Date(now.getTime() - BARBER_WA_ACK_REMINDER_MAX_AGE_MS);
  assert.equal(decideBarberWaAck(base({ lastWord: { templateName: REMINDER, createdAt: justo } })), "send");
  const viejo = new Date(now.getTime() - BARBER_WA_ACK_REMINDER_MAX_AGE_MS - 1);
  assert.equal(decideBarberWaAck(base({ lastWord: { templateName: REMINDER, createdAt: viejo } })), "reminderTooOld");
});
