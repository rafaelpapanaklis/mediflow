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
  // El caller real (send-and-log) pasa whatsappThreadKey("33 1234 5678") = "5213312345678".
  const t = await upsertWhatsAppThread({
    clinicId: CLINICA, externalId: "5213312345678", now: new Date(), createSubject: "WhatsApp · Ana",
    createStatus: "READ", matchByLast10: true,
  });
  assert.notEqual(t.id, "thExtranjero");
  // Con el wa_id mexicano sí encuentra el hilo del paciente (sin el hilo que
  // acaba de crear la llamada de arriba, que casaría exacto).
  hilos = hilos.filter((h) => h.id === "thExtranjero");
  // El hilo de Ana con su wa_id en formato 52 (sin el 1): casa por el respaldo de 10 dígitos, no exacto.
  hilos.push({ id: "thAna", clinicId: CLINICA, channel: "WHATSAPP", externalId: "523312345678", patientId: "pacMX", botActive: true, botState: null, lastMessageAt: new Date() });
  const t2 = await upsertWhatsAppThread({
    clinicId: CLINICA, externalId: "5213312345678", now: new Date(), createSubject: "WhatsApp · Ana",
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
// 52. Un teléfono GUARDADO de 10 dígitos es mexicano aunque lleve «+» (v4).
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

test("M1 · el wa_id danés tampoco es la ficha guardada «+45 21 23 45 67», que se lee mexicana (v4)", async () => {
  pacientes = [
    { id: "pacDK", clinicId: CLINICA, phone: "+45 21 23 45 67", firstName: "Freja" },
    { id: "pacUruapan", clinicId: CLINICA, phone: "452 123 4567", firstName: "Lupe" },
  ];
  const { findPatientsByWhatsAppPhone } = await import("@/lib/whatsapp/inbox-log");
  const { numeroDeMeta } = await import("@/lib/whatsapp/bot/booking-parse");
  assert.deepEqual(await findPatientsByWhatsAppPhone(CLINICA, numeroDeMeta(DANES)), []);
  // Las dos fichas son el mismo número mexicano: las dos son del wa_id de Uruapan.
  assert.deepEqual((await findPatientsByWhatsAppPhone(CLINICA, numeroDeMeta("5214521234567"))).map((p) => p.id), ["pacDK", "pacUruapan"]);
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
  // Ni con el «+» delante: guardado, «+45 21 23 45 67» es mexicano (v4) y su
  // hilo es el de Uruapan que acaba de abrir el aviso, no el del danés.
  const deUruapan = await findWhatsAppThreadsForPhone(CLINICA, "452 123 4567");
  assert.deepEqual(await findWhatsAppThreadsForPhone(CLINICA, "+45 21 23 45 67"), deUruapan);
  assert.ok(!deUruapan.some((h) => h.id === "thDanes"));
});

test("M1 · el wa_id danés no tiene forma de teléfono guardado: sin número, el bot no lo agenda a nombre de nadie", async () => {
  const { numeroDeMeta, claveWhatsApp, claveRemitente } = await import("@/lib/whatsapp/bot/booking-parse");
  assert.equal(numeroDeMeta(DANES), "", "«+4521234567» guardado sería Uruapan");
  assert.equal(numeroDeMeta(NORUEGO), "");
  // Para todo lo demás, el número de Meta guardado se vuelve a leer igual.
  for (const waId of ["5214521234567", "524521234567", "13312345678", "447911123456", "34612345678"]) {
    assert.equal(claveWhatsApp(numeroDeMeta(waId)), claveRemitente(waId), waId);
  }
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
  assert.equal(numeroDeMeta("5214521234567"), "+524521234567");
  assert.equal(numeroDeMeta(""), "");
  // Guardados (v4): 10 dígitos con «+»/«00» son México.
  assert.equal(claveWhatsApp("+45 21 23 45 67"), "524521234567");
  assert.equal(claveWhatsApp("0045 21 23 45 67"), "524521234567");
  assert.equal(claveWhatsApp("452 123 4567"), "524521234567");
  assert.equal(claveWhatsApp("+52 1 452 123 4567"), "524521234567");
  assert.equal(claveWhatsApp("+52 452 123 4567"), "524521234567");
});

// ── Revisión t12 (DM2, v4): «+» o «00» con 10 dígitos guardado es México ──
// Rafael eligió la opción (b): en producción hay 11 teléfonos guardados como
// «+656 123 4567» (Ciudad Juárez con el «+» por costumbre) y ninguno empieza
// como Dinamarca, Noruega, Singapur o Cuba. Con la v3 esos pacientes recibían
// en Singapur (+65 6123 4567) y su hilo y su wa_id dejaban de casar.
const JUAREZ = "+656 123 4567";

test("DM2 · el envío a «+656 123 4567» sale a Ciudad Juárez (52 656…), como en producción", async () => {
  const { normalizeMxWhatsAppPhone } = await import("@/lib/whatsapp");
  assert.equal(normalizeMxWhatsAppPhone(JUAREZ), "526561234567");
  assert.equal(normalizeMxWhatsAppPhone("+33 1234 5678"), "523312345678", "Guadalajara, no Francia");
  assert.equal(normalizeMxWhatsAppPhone("+81 1234 5678"), "528112345678", "Monterrey, no Japón");
  assert.equal(normalizeMxWhatsAppPhone("0045 21 23 45 67"), "524521234567");
  // Lo de siempre.
  assert.equal(normalizeMxWhatsAppPhone("33 1234 5678"), "523312345678");
  assert.equal(normalizeMxWhatsAppPhone("+52 33 1234 5678"), "523312345678");
  assert.equal(normalizeMxWhatsAppPhone("+52 1 33 1234 5678"), "523312345678");
  assert.equal(normalizeMxWhatsAppPhone("5213312345678"), "523312345678");
  assert.equal(normalizeMxWhatsAppPhone("+1 (331) 234-5678"), "13312345678");
  // El «00» es el prefijo internacional, no parte del número.
  assert.equal(normalizeMxWhatsAppPhone("0052 33 1234 5678"), "523312345678");
  assert.equal(normalizeMxWhatsAppPhone("001 331 234 5678"), "13312345678");
});

test("DM2 · la clave de hilo de «+656 123 4567» es la de Meta para Juárez (521 656…)", async () => {
  const { whatsappThreadKey } = await import("@/lib/whatsapp/send-and-log");
  assert.equal(whatsappThreadKey(JUAREZ), "5216561234567");
  assert.equal(whatsappThreadKey("656 123 4567"), "5216561234567");
  assert.equal(whatsappThreadKey("+52 656 123 4567"), "5216561234567");
  assert.equal(whatsappThreadKey("+52 1 656 123 4567"), "5216561234567");
  assert.equal(whatsappThreadKey("+1 331 234 5678"), "13312345678");
  assert.equal(whatsappThreadKey("0052 33 1234 5678"), "5213312345678");
  assert.equal(whatsappThreadKey("001 331 234 5678"), "13312345678");
});

test("DM2 · la paciente de Juárez guardada con «+» se reconoce por su wa_id (521… y 52…)", async () => {
  pacientes = [{ id: "pacJuarez", clinicId: CLINICA, phone: JUAREZ, firstName: "Sofía" }];
  const { findPatientsByWhatsAppPhone } = await import("@/lib/whatsapp/inbox-log");
  const { numeroDeMeta, claveWhatsApp } = await import("@/lib/whatsapp/bot/booking-parse");
  assert.equal(claveWhatsApp(JUAREZ), "526561234567");
  for (const waId of ["5216561234567", "526561234567"]) {
    assert.deepEqual((await findPatientsByWhatsAppPhone(CLINICA, numeroDeMeta(waId))).map((p) => p.id), ["pacJuarez"], waId);
  }
  // Y Singapur (+65 6123 4567, wa_id de 10 dígitos) no es ella.
  assert.deepEqual(await findPatientsByWhatsAppPhone(CLINICA, numeroDeMeta("6561234567")), []);
});

test("DM2 · su hilo de siempre se encuentra (13, 12 dígitos) y un aviso no abre otro", async () => {
  const { findWhatsAppThreadsForPhone, upsertWhatsAppThread } = await import("@/lib/whatsapp/inbox-log");
  const { whatsappThreadKey } = await import("@/lib/whatsapp/send-and-log");
  for (const externalId of ["5216561234567", "526561234567"]) {
    hilos = [{ id: "thJuarez", clinicId: CLINICA, channel: "WHATSAPP", externalId, patientId: "pacJuarez", botActive: true, botState: null, lastMessageAt: new Date() }];
    assert.deepEqual((await findWhatsAppThreadsForPhone(CLINICA, JUAREZ)).map((h) => h.id), ["thJuarez"], externalId);
    const t = await upsertWhatsAppThread({
      clinicId: CLINICA, externalId: whatsappThreadKey(JUAREZ), now: new Date(), createSubject: "WhatsApp · Sofía",
      createStatus: "READ", matchByLast10: true,
    });
    assert.equal(t.id, "thJuarez", externalId);
    assert.equal(hilos.length, 1, "no se abrió un hilo duplicado");
  }
});

test("DM2 · las tres formas de hilo de producción (13, 12 y 11 dígitos) se siguen encontrando sin duplicar", async () => {
  const { upsertWhatsAppThread, findWhatsAppThreadsForPhone } = await import("@/lib/whatsapp/inbox-log");
  const { whatsappThreadKey } = await import("@/lib/whatsapp/send-and-log");
  const casos: Array<[string, string[]]> = [
    ["5213312345678", ["33 1234 5678", "+52 33 1234 5678", "+3312345678", "0052 33 1234 5678", "+52 52 33 1234 5678"]],
    ["523312345678", ["33 1234 5678", "+52 1 33 1234 5678", "+3312345678", "5213312345678"]],
    ["13312345678", ["+1 (331) 234-5678", "13312345678", "001 331 234 5678"]],
  ];
  for (const [externalId, telefonos] of casos) {
    for (const tel of telefonos) {
      hilos = [{ id: "thViejo", clinicId: CLINICA, channel: "WHATSAPP", externalId, patientId: "pac", botActive: true, botState: null, lastMessageAt: new Date() }];
      assert.deepEqual((await findWhatsAppThreadsForPhone(CLINICA, tel)).map((h) => h.id), ["thViejo"], `${externalId} ← ${tel}`);
      const t = await upsertWhatsAppThread({
        clinicId: CLINICA, externalId: whatsappThreadKey(tel), now: new Date(), createSubject: "WhatsApp",
        createStatus: "READ", matchByLast10: true,
      });
      assert.equal(t.id, "thViejo", `${externalId} ← ${tel}`);
      assert.equal(hilos.length, 1, `${externalId} ← ${tel}: sin hilo duplicado`);
    }
  }
});

test("DM2 · su recordatorio lo contesta ella desde su wa_id (con y sin enviadoA)", async () => {
  const { recordatoriosDeEseNumero } = await import("@/lib/whatsapp/recordatorio-destino");
  const { claveWhatsApp } = await import("@/lib/whatsapp/bot/booking-parse");
  const viejo = { id: "r1", payload: null, appointment: { patient: { phone: JUAREZ } } };
  const nuevo = { id: "r2", payload: { enviadoA: claveWhatsApp(JUAREZ) }, appointment: { patient: { phone: JUAREZ } } };
  assert.deepEqual(recordatoriosDeEseNumero([viejo, nuevo], "5216561234567").map((r) => r.id), ["r1", "r2"]);
  assert.deepEqual(recordatoriosDeEseNumero([viejo, nuevo], "6561234567"), [], "Singapur no");
});

test("DM2 · «+52» con más de 12 dígitos sigue siendo el mexicano de los últimos 10 (como el hilo)", async () => {
  const { claveWhatsApp } = await import("@/lib/whatsapp/bot/booking-parse");
  const { whatsappThreadKey } = await import("@/lib/whatsapp/send-and-log");
  assert.equal(claveWhatsApp("+52 044 33 1234 5678"), "523312345678");
  assert.equal(claveWhatsApp("+52 01 33 1234 5678"), "523312345678");
  assert.equal(whatsappThreadKey("+52 044 33 1234 5678"), "5213312345678");
});
