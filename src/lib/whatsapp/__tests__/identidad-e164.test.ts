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

// ── Revisión t12 (M1): números completos de 10 dígitos de otros países ──────
// Dinamarca +45, Noruega +47, Singapur +65… miden 10 dígitos con el código de
// país. Lo que llega de Meta (wa_id, externalId de hilos) NUNCA se rellena con
// 52; un teléfono guardado con «+» se respeta tal cual.
const DANES = "4521234567"; // wa_id de un móvil +45 21 23 45 67
const NORUEGO = "4741234567"; // wa_id de un móvil +47 41 23 45 67

test("M1 · el wa_id danés o noruego NO es el paciente de Uruapan (452) ni el de Lagos (474)", async () => {
  pacientes = [
    { id: "pacUruapan", clinicId: CLINICA, phone: "452 123 4567", firstName: "Lupe" },
    { id: "pacLagos", clinicId: CLINICA, phone: "474 123 4567", firstName: "Toño" },
  ];
  const { findPatientsByWhatsAppPhone } = await import("@/lib/whatsapp/inbox-log");
  const { numeroDeMeta } = await import("@/lib/whatsapp/bot/booking-parse");
  assert.deepEqual(await findPatientsByWhatsAppPhone(CLINICA, numeroDeMeta(DANES)), []);
  assert.deepEqual(await findPatientsByWhatsAppPhone(CLINICA, numeroDeMeta(NORUEGO)), []);
  // Los pacientes de verdad, con su wa_id mexicano, sí.
  assert.deepEqual((await findPatientsByWhatsAppPhone(CLINICA, numeroDeMeta("5214521234567"))).map((p) => p.id), ["pacUruapan"]);
  assert.deepEqual((await findPatientsByWhatsAppPhone(CLINICA, numeroDeMeta("524741234567"))).map((p) => p.id), ["pacLagos"]);
});

test("M1 · un paciente extranjero guardado con «+» es su número completo, no un mexicano", async () => {
  pacientes = [
    { id: "pacDK", clinicId: CLINICA, phone: "+45 21 23 45 67", firstName: "Freja" },
    { id: "pacUruapan", clinicId: CLINICA, phone: "452 123 4567", firstName: "Lupe" },
  ];
  const { findPatientsByWhatsAppPhone } = await import("@/lib/whatsapp/inbox-log");
  const { numeroDeMeta } = await import("@/lib/whatsapp/bot/booking-parse");
  assert.deepEqual((await findPatientsByWhatsAppPhone(CLINICA, numeroDeMeta(DANES))).map((p) => p.id), ["pacDK"]);
  // Y el de Uruapan no se vuelve dueño de la ficha danesa.
  assert.deepEqual((await findPatientsByWhatsAppPhone(CLINICA, numeroDeMeta("5214521234567"))).map((p) => p.id), ["pacUruapan"]);
});

test("M1 · el hilo del wa_id danés no es el hilo del paciente de Uruapan (ni para buscarlo ni para los avisos)", async () => {
  hilos.push({ id: "thDanes", clinicId: CLINICA, channel: "WHATSAPP", externalId: DANES, patientId: null, botActive: true, botState: null, lastMessageAt: new Date() });
  const { findWhatsAppThreadsForPhone, upsertWhatsAppThread } = await import("@/lib/whatsapp/inbox-log");
  assert.deepEqual(await findWhatsAppThreadsForPhone(CLINICA, "452 123 4567"), []);
  const t = await upsertWhatsAppThread({
    clinicId: CLINICA, externalId: "5214521234567", now: new Date(), createSubject: "WhatsApp · Lupe",
    createStatus: "READ", matchByLast10: true,
  });
  assert.notEqual(t.id, "thDanes", "el aviso no cae en el hilo del danés, cuyo bot lee ese historial");
  // El paciente danés guardado con «+» sí encuentra su hilo.
  assert.deepEqual((await findWhatsAppThreadsForPhone(CLINICA, "+45 21 23 45 67")).map((h) => h.id), ["thDanes"]);
});

test("M1 · el bot no agenda al danés a nombre del paciente de Uruapan, y lo guarda con su código de país", async () => {
  pacientes = [{ id: "pacUruapan", clinicId: CLINICA, phone: "4521234567", firstName: "Lupe" }];
  const { findOrCreateWhatsAppPatient } = await import("@/lib/whatsapp/bot/booking-helpers");
  const { numeroDeMeta } = await import("@/lib/whatsapp/bot/booking-parse");
  const r = await findOrCreateWhatsAppPatient(CLINICA, numeroDeMeta(DANES), "Freja Jensen");
  assert.equal(r?.id, "pacNuevo");
  assert.equal(creados[0]?.phone, "+4521234567", "se guarda con el «+»: la próxima vez se le reconoce");
});

test("M1 · un recordatorio de Uruapan o de Lagos no lo contesta el danés ni el noruego", async () => {
  const { recordatoriosDeEseNumero } = await import("@/lib/whatsapp/recordatorio-destino");
  const nuevo = { id: "r1", payload: { enviadoA: "524521234567" }, appointment: { patient: { phone: "452 123 4567" } } };
  const viejo = { id: "r2", payload: null, appointment: { patient: { phone: "474 123 4567" } } };
  const aDK = { id: "r3", payload: { enviadoA: "4521234567" }, appointment: { patient: { phone: "+45 21 23 45 67" } } };
  assert.deepEqual(recordatoriosDeEseNumero([nuevo, viejo], DANES), []);
  assert.deepEqual(recordatoriosDeEseNumero([nuevo, viejo], NORUEGO), []);
  assert.deepEqual(recordatoriosDeEseNumero([nuevo, viejo, aDK], "5214521234567").map((r) => r.id), ["r1"]);
  assert.deepEqual(recordatoriosDeEseNumero([nuevo, viejo, aDK], "5214741234567").map((r) => r.id), ["r2"]);
  assert.deepEqual(recordatoriosDeEseNumero([nuevo, viejo, aDK], DANES).map((r) => r.id), ["r3"]);
});

test("M1 · claveRemitente y claveWhatsApp con código de país", async () => {
  const { claveRemitente, claveWhatsApp, numeroDeMeta } = await import("@/lib/whatsapp/bot/booking-parse");
  assert.equal(claveRemitente(DANES), DANES, "nunca se rellena con 52");
  assert.equal(claveRemitente("6581234567"), "6581234567", "Singapur");
  assert.equal(claveRemitente("5214521234567"), "524521234567");
  assert.equal(claveRemitente("524521234567"), "524521234567");
  assert.equal(claveRemitente("13312345678"), "13312345678");
  assert.equal(numeroDeMeta(DANES), "+4521234567");
  assert.equal(numeroDeMeta(""), "");
  assert.equal(claveWhatsApp("+45 21 23 45 67"), DANES);
  assert.equal(claveWhatsApp("0045 21 23 45 67"), DANES);
  assert.equal(claveWhatsApp("452 123 4567"), "524521234567");
  assert.equal(claveWhatsApp("+52 1 452 123 4567"), "524521234567");
  assert.equal(claveWhatsApp("+52 452 123 4567"), "524521234567");
});
