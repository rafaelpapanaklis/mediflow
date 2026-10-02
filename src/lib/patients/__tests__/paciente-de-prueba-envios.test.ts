// ws1-t11 (11d) — el freno de «Paciente de prueba / no contactar» en los dos
// transportes: sendWhatsAppLogged (y la cola que lo usa) y sendEmail.
// Correr: npm run test:paciente-de-prueba
//
// Prisma y Meta son dobles (Module._load, igual que
// reviews/__tests__/invite-paciente-y-entrega.test.ts): nada toca una base ni
// manda un mensaje. El doble de `$queryRaw` entiende las tres consultas de
// paciente-de-prueba-db.ts (sonda, marca de un paciente, dueños del número).
import Module from "node:module";
import path from "node:path";
import { before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

const RAIZ = path.resolve(__dirname, "../../../..");

type Paciente = { id: string; phone: string | null; email: string | null; prueba: boolean };
const e = {
  columna: true,
  pacientes: [] as Paciente[],
  consultas: [] as string[],
  meta: [] as Array<{ to: string; body: string }>,
  inbox: 0,
  recordatorios: [] as Array<{ id: string; data: any }>,
  filas: [] as any[],
};

const digitos = (t: string | null) => (t ?? "").replace(/\D/g, "").slice(-10);

const prismaFalso = {
  $queryRaw: async (strings: TemplateStringsArray, ...v: any[]) => {
    const sql = strings.join("?");
    e.consultas.push(sql);
    if (sql.includes("information_schema.columns")) return [{ n: e.columna ? 1 : 0 }];
    if (!e.columna) throw new Error('column "isTestPatient" does not exist');
    if (sql.includes('SELECT "isTestPatient" AS v')) {
      const p = e.pacientes.find((x) => x.id === v[0]);
      return p ? [{ v: p.prueba }] : [];
    }
    if (sql.includes("SELECT EXISTS")) {
      // v: clinicId, telOk, tel, correoOk, correo
      const [, telOk, tel, correoOk, correo] = v;
      const hay = e.pacientes.some(
        (p) =>
          p.prueba &&
          ((telOk && digitos(p.phone) === tel) || (correoOk && (p.email ?? "").toLowerCase() === correo)),
      );
      return [{ v: hay }];
    }
    throw new Error("consulta no esperada: " + sql);
  },
  inboxMessage: { create: async () => ((e.inbox += 1), {}) },
  clinic: { updateMany: async () => ({ count: 0 }), findUnique: async () => null },
  patient: { findFirst: async () => null, findMany: async () => [] },
  whatsAppReminder: {
    updateMany: async () => ({ count: e.filas.length }),
    findMany: async () => e.filas,
    update: async (a: any) => (e.recordatorios.push({ id: a.where.id, data: a.data }), {}),
  },
};

const dobles = new Map<string, unknown>();
dobles.set(path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prismaFalso });
dobles.set(path.join(RAIZ, "src/lib/whatsapp.ts"), {
  sendWhatsAppMessage: async (_pn: string, _tk: string, to: string, body: string) => (
    e.meta.push({ to, body }), { messages: [{ id: "wamid.X" }] }
  ),
  sendWhatsAppTemplate: async () => { throw new Error("no debería usarse plantilla (ventana abierta)"); },
  sendWhatsAppInteractive: async (_pn: string, _tk: string, to: string) => (
    e.meta.push({ to, body: "[interactivo]" }), { messages: [{ id: "wamid.I" }] }
  ),
  sendWhatsAppDocument: async () => ({}),
  uploadWhatsAppMedia: async () => "m1",
});
dobles.set(path.join(RAIZ, "src/lib/whatsapp/inbox-log.ts"), {
  // Ventana de 24 h ABIERTA: sale texto libre sin plantillas.
  lastInboundAtForPhone: async () => new Date(),
  findPatientByWhatsAppPhone: async () => null,
  findPatientsByWhatsAppPhone: async () => [],
  upsertWhatsAppThread: async () => ({ id: "th1", patientId: null }),
});

type M = typeof Module & {
  _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (req: string, parent: unknown, isMain: boolean) => string;
};
const Mod = Module as M;
const cargaOriginal = Mod._load;
Mod._load = function (req, parent, isMain) {
  if (req === "server-only" || req === "client-only") return {};
  let resuelto: string | null = null;
  try {
    resuelto = Mod._resolveFilename(req, parent, isMain);
  } catch {
    resuelto = null;
  }
  if (resuelto && dobles.has(resuelto)) return dobles.get(resuelto);
  return cargaOriginal.call(this, req, parent, isMain);
};

let sendWhatsAppLogged: typeof import("@/lib/whatsapp/send-and-log").sendWhatsAppLogged;
let sendEmail: typeof import("@/lib/email").sendEmail;
let processWhatsAppQueue: typeof import("@/lib/whatsapp/queue-worker").processWhatsAppQueue;
let olvidarSonda: () => void;
let PacienteNoContactarError: typeof import("../paciente-de-prueba").PacienteNoContactarError;

before(async () => {
  ({ sendWhatsAppLogged } = await import("@/lib/whatsapp/send-and-log"));
  ({ sendEmail } = await import("@/lib/email"));
  ({ processWhatsAppQueue } = await import("@/lib/whatsapp/queue-worker"));
  ({ _olvidarSondaDePrueba: olvidarSonda } = await import("../paciente-de-prueba-db"));
  ({ PacienteNoContactarError } = await import("../paciente-de-prueba"));
});

const CLINICA = { id: "cl1", waPhoneNumberId: "pn", waAccessToken: "tk", waConnected: true, waTemplates: null };

beforeEach(() => {
  olvidarSonda();
  e.columna = true;
  e.consultas = [];
  e.meta = [];
  e.inbox = 0;
  e.recordatorios = [];
  e.filas = [];
  // P0294 (prueba) y P0263 (real) comparten el número ficticio, como en BEVADENT.
  e.pacientes = [
    { id: "pPrueba", phone: "0000000000", email: "prueba@ejemplo.mx", prueba: true },
    { id: "pReal", phone: "(000) 000-0000", email: "real@ejemplo.mx", prueba: false },
    { id: "pOtro", phone: "5512345678", email: null, prueba: false },
  ];
});

describe("sendWhatsAppLogged — el freno", () => {
  it("al paciente de prueba no le sale nada: ni Meta ni la bandeja", async () => {
    await assert.rejects(
      sendWhatsAppLogged({ clinic: CLINICA, to: "0000000000", body: "Tu reseña", kind: "review", patientId: "pPrueba" }),
      (err: unknown) => err instanceof PacienteNoContactarError,
    );
    assert.equal(e.meta.length, 0);
    assert.equal(e.inbox, 0);
  });

  it("el paciente REAL que comparte el número sí recibe lo suyo", async () => {
    await sendWhatsAppLogged({ clinic: CLINICA, to: "0000000000", body: "Recordatorio", kind: "reminder", patientId: "pReal" });
    assert.equal(e.meta.length, 1);
  });

  it("sin saber de quién es (solo el número), basta un dueño marcado", async () => {
    await assert.rejects(
      sendWhatsAppLogged({ clinic: CLINICA, to: "+52 1 000 000 0000", body: "Feliz cumpleaños", kind: "reminder" }),
      (err: unknown) => err instanceof PacienteNoContactarError,
    );
    await sendWhatsAppLogged({ clinic: CLINICA, to: "5512345678", body: "Hola", kind: "reminder" });
    assert.equal(e.meta.length, 1);
  });

  it("los avisos de sistema a la clínica o al doctor no se frenan", async () => {
    await sendWhatsAppLogged({ clinic: CLINICA, to: "0000000000", body: "Nueva cita", kind: "system" });
    assert.equal(e.meta.length, 1);
  });

  it("sin el SQL pegado: sale todo y solo se pregunta a information_schema", async () => {
    e.columna = false;
    await sendWhatsAppLogged({ clinic: CLINICA, to: "0000000000", body: "Tu reseña", kind: "review", patientId: "pPrueba" });
    await sendWhatsAppLogged({ clinic: CLINICA, to: "0000000000", body: "Otra", kind: "review", patientId: "pPrueba" });
    assert.equal(e.meta.length, 2);
    assert.equal(e.consultas.length, 1, "una sola sonda, recordada");
    assert.match(e.consultas[0], /information_schema/);
  });
});

describe("cola de WhatsApp", () => {
  it("el recordatorio del paciente de prueba queda CANCELADO con el motivo, sin llamar a Meta", async () => {
    e.filas = [
      {
        id: "r1", clinicId: "cl1", type: "APPOINTMENT", message: "Te esperamos", payload: null,
        patientPhone: null,
        clinic: { ...CLINICA, name: "Clínica", timezone: "America/Mexico_City", logoUrl: null },
        appointment: {
          id: "a1", startsAt: new Date(Date.now() + 86_400_000), status: "SCHEDULED", holdExpiresAt: null,
          patientId: "pPrueba",
          patient: { firstName: "Prueba", lastName: "Orto", phone: "0000000000", email: null },
          doctor: null,
        },
      },
    ];
    const r = await processWhatsAppQueue({ batchSize: 5 });
    assert.equal(e.meta.length, 0);
    assert.equal(r.sent, 0);
    assert.equal(r.failed, 0);
    assert.equal(r.skipped, 1);
    const ultimo = e.recordatorios.at(-1)!;
    assert.equal(ultimo.data.status, "CANCELLED");
    assert.match(ultimo.data.errorMsg, /no contactar/);
  });
});

describe("sendEmail — el freno", () => {
  it("correo a un paciente de prueba: no se intenta y dice por qué", async () => {
    const llamadas: unknown[] = [];
    const fetchOriginal = globalThis.fetch;
    const keyOriginal = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "re_prueba";
    globalThis.fetch = (async (...a: unknown[]) => (llamadas.push(a), new Response("{}"))) as typeof fetch;
    try {
      const r = await sendEmail({
        to: "prueba@ejemplo.mx", subject: "Tu receta", html: "<p>x</p>",
        paciente: { clinicId: "cl1", patientId: "pPrueba" },
      });
      assert.equal(r.delivered, false);
      assert.match(r.bloqueado ?? "", /no contactar/);
      assert.equal(llamadas.length, 0);

      const r2 = await sendEmail({
        to: "real@ejemplo.mx", subject: "Tu receta", html: "<p>x</p>",
        paciente: { clinicId: "cl1", patientId: "pReal" },
      });
      assert.equal(r2.delivered, true);
      assert.equal(r2.bloqueado, undefined);
      assert.equal(llamadas.length, 1);
    } finally {
      globalThis.fetch = fetchOriginal;
      if (keyOriginal === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = keyOriginal;
    }
  });
});
