/**
 * Seguridad (auditoría «cloudflare», nº9): el remitente de WhatsApp se
 * identifica por su número COMPLETO con código de país, no por los últimos 10
 * dígitos. Solo se pliegan las variantes de México (52 / 521 / 044 / 045 / 10
 * dígitos sin código).
 *
 * Run: npm run test:seg-whatsapp-identidad
 *   (--experimental-test-module-mocks: se ejecutan de verdad
 *    findPatientsByWhatsAppPhone, upsertWhatsAppThread (con matchByLast10) y
 *    findOrCreateWhatsAppPatient, con Prisma sustituido. Sin red ni base.)
 *
 * Con el código de 0f61a7e0d, un +1 331 234 5678 era el paciente mexicano
 * «33 1234 5678»: el webhook le cancelaba o confirmaba la cita, el bot le
 * enseñaba su saldo y sus citas, y el bot le agendaba a su nombre.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const CLINICA = "cl1";
let pacientes: Array<{ id: string; clinicId: string; phone: string | null; firstName: string | null }> = [];
let hilos: Array<{ id: string; clinicId: string; channel: string; externalId: string; patientId: string | null; botActive: boolean; botState: unknown; lastMessageAt: Date }> = [];
let creados: any[] = [];

beforeEach(() => {
  pacientes = [{ id: "pacMX", clinicId: CLINICA, phone: "33 1234 5678", firstName: "Ana" }];
  hilos = [];
  creados = [];
});

const digitos = (s: string | null) => (s ?? "").replace(/\D/g, "");

(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      // El SQL de findPatientsByWhatsAppPhone: right(regexp_replace(phone),10) = $last10.
      $queryRaw: async (_s: TemplateStringsArray, clinicId: string, last10: string) =>
        pacientes
          .filter((p) => p.clinicId === clinicId && p.phone && digitos(p.phone).slice(-10) === last10)
          .map((p) => ({ id: p.id, phone: p.phone, firstName: p.firstName })),
      patient: {
        // `contains` de los 10 dígitos sobre el texto crudo (lo que hace Postgres).
        findFirst: async ({ where }: any) =>
          pacientes.find((p) => p.clinicId === where.clinicId && (p.phone ?? "").includes(where.phone.contains)) ?? null,
        findMany: async ({ where }: any) =>
          pacientes.filter((p) => p.clinicId === where.clinicId && (p.phone ?? "").includes(where.phone.contains)),
      },
      inboxThread: {
        findFirst: async ({ where }: any) =>
          hilos.find((h) => h.clinicId === where.clinicId && h.externalId === where.externalId) ?? null,
        findMany: async ({ where }: any) =>
          hilos.filter((h) => h.clinicId === where.clinicId && h.externalId.includes(where.externalId.contains)),
        create: async ({ data }: any) => {
          const h = { id: `th${hilos.length + 1}`, botActive: true, botState: null, lastMessageAt: new Date(), patientId: null, ...data };
          hilos.push(h);
          return { id: h.id, botActive: h.botActive, botState: h.botState, patientId: h.patientId };
        },
        update: async () => ({}),
      },
      $transaction: async (fn: any) =>
        fn({
          $executeRaw: async () => 1,
          patient: {
            create: async ({ data }: any) => {
              creados.push(data);
              return { id: "pacNuevo" };
            },
          },
        }),
    },
  },
});
(mock as any).module("@/lib/patients/next-patient-number", {
  namedExports: { nextPatientNumber: async () => "P9999", withPatientNumberRetry: (fn: any) => fn() },
});
(mock as any).module("@/lib/whatsapp/bot/movimientos-bot", { namedExports: { anotarPacienteCreadoPorBot: async () => undefined } });

const EXTRANJERO = "13312345678"; // +1 331 234 5678: mismos 10 últimos dígitos que «33 1234 5678»

test("nº9 · un +1 que acaba en los mismos 10 dígitos NO es el paciente mexicano", async () => {
  const { findPatientsByWhatsAppPhone } = await import("@/lib/whatsapp/inbox-log");
  assert.deepEqual(await findPatientsByWhatsAppPhone(CLINICA, EXTRANJERO), []);
});

test("nº9 · las variantes de México siguen siendo la misma persona (wa_id 521…, 52…, +52, 10 dígitos)", async () => {
  const { findPatientsByWhatsAppPhone } = await import("@/lib/whatsapp/inbox-log");
  for (const from of ["5213312345678", "523312345678", "+52 33 1234 5678", "3312345678", "045 33 1234 5678", "0052 33 1234 5678"]) {
    const r = await findPatientsByWhatsAppPhone(CLINICA, from);
    assert.deepEqual(r.map((p) => p.id), ["pacMX"], from);
  }
  // Y un paciente extranjero guardado CON su código de país se reconoce.
  pacientes.push({ id: "pacUS", clinicId: CLINICA, phone: "+1 (331) 234-5678", firstName: "John" });
  assert.deepEqual((await findPatientsByWhatsAppPhone(CLINICA, EXTRANJERO)).map((p) => p.id), ["pacUS"]);
  assert.deepEqual((await findPatientsByWhatsAppPhone(CLINICA, "5213312345678")).map((p) => p.id), ["pacMX"]);
});

test("nº9 · el bot no le agenda al extranjero a nombre del paciente mexicano (crea uno nuevo)", async () => {
  // Aquí el teléfono va sin espacios: el pre-filtro de este helper es un
  // `contains` sobre el texto crudo (igual antes y ahora).
  pacientes[0].phone = "3312345678";
  const { findOrCreateWhatsAppPatient } = await import("@/lib/whatsapp/bot/booking-helpers");
  const r = await findOrCreateWhatsAppPatient(CLINICA, EXTRANJERO, "Mallory Pérez");
  assert.equal(r?.id, "pacNuevo", "no es pacMX");
  assert.equal(creados.length, 1);
  // El paciente mexicano real sí se encuentra con su wa_id.
  creados = [];
  const ana = await findOrCreateWhatsAppPatient(CLINICA, "5213312345678", "Ana");
  assert.equal(ana?.id, "pacMX");
  assert.equal(creados.length, 0);
});

test("nº9 · un aviso para el paciente mexicano no cae en el hilo del número extranjero (su bot lee ese historial)", async () => {
  hilos.push({ id: "thExtranjero", clinicId: CLINICA, channel: "WHATSAPP", externalId: EXTRANJERO, patientId: null, botActive: true, botState: null, lastMessageAt: new Date() });
  const { upsertWhatsAppThread } = await import("@/lib/whatsapp/inbox-log");
  const t = await upsertWhatsAppThread({
    clinicId: CLINICA, externalId: "33 1234 5678", now: new Date(), createSubject: "WhatsApp · Ana",
    createStatus: "READ", matchByLast10: true,
  });
  assert.notEqual(t.id, "thExtranjero");
  // Con el wa_id mexicano sí encuentra el hilo del paciente (sin el hilo que
  // acaba de crear la llamada de arriba, que casaría exacto).
  hilos = hilos.filter((h) => h.id === "thExtranjero");
  hilos.push({ id: "thAna", clinicId: CLINICA, channel: "WHATSAPP", externalId: "5213312345678", patientId: "pacMX", botActive: true, botState: null, lastMessageAt: new Date() });
  const t2 = await upsertWhatsAppThread({
    clinicId: CLINICA, externalId: "33 1234 5678", now: new Date(), createSubject: "WhatsApp · Ana",
    createStatus: "READ", matchByLast10: true,
  });
  assert.equal(t2.id, "thAna");
});

test("nº9 · claveWhatsApp: el número completo, plegando solo México", async () => {
  const { claveWhatsApp } = await import("@/lib/whatsapp/bot/booking-parse");
  assert.equal(claveWhatsApp("5213312345678"), "523312345678");
  assert.equal(claveWhatsApp("523312345678"), "523312345678");
  assert.equal(claveWhatsApp("33 1234 5678"), "523312345678");
  assert.equal(claveWhatsApp("044 33 1234 5678"), "523312345678");
  assert.equal(claveWhatsApp("00 52 33 1234 5678"), "523312345678");
  assert.equal(claveWhatsApp("+1 331 234 5678"), "13312345678");
  assert.notEqual(claveWhatsApp(EXTRANJERO), claveWhatsApp("33 1234 5678"));
  assert.equal(claveWhatsApp(""), "");
  assert.equal(claveWhatsApp(null), "");
});

test("nº9 · un recordatorio solo lo contesta el número al que salió", async () => {
  const { recordatoriosDeEseNumero, destinoDelRecordatorio } = await import("@/lib/whatsapp/recordatorio-destino");
  const nuevo = { id: "r1", payload: { enviadoA: "523312345678" }, appointment: { patient: { phone: "33 1234 5678" } } };
  const viejo = { id: "r2", payload: { wamid: "x" }, appointment: { patient: { phone: "33 1234 5678" } } };
  // El teléfono del paciente cambió después de mandarle el recordatorio: manda a dónde salió.
  const movido = { id: "r3", payload: { enviadoA: "523312345678" }, appointment: { patient: { phone: "55 9999 0000" } } };
  const recall = { id: "r4", payload: null, patientPhone: "33 1234 5678", appointment: null };
  assert.equal(destinoDelRecordatorio(viejo), "523312345678");
  assert.deepEqual(recordatoriosDeEseNumero([nuevo, viejo, movido, recall], EXTRANJERO), []);
  assert.deepEqual(recordatoriosDeEseNumero([nuevo, viejo, movido, recall], "5213312345678").map((r) => r.id), ["r1", "r2", "r3", "r4"]);
  assert.deepEqual(recordatoriosDeEseNumero([movido], "5215599990000"), [], "el número nuevo no contesta el que salió al viejo");
});
