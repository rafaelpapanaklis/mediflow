// ws1-t11 (11c y 11d) — la invitación a reseña respeta «Pedir reseña al
// terminar la cita» y no se crea para un «Paciente de prueba / no contactar».
// Correr: npm run test:paciente-de-prueba
// Mismo andamio que invite-paciente-y-entrega.test.ts (Module._load: invite.ts
// lleva "server-only").
import Module from "node:module";
import path from "node:path";
import { before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

const RAIZ = path.resolve(__dirname, "../../../..");

const e = {
  reminderSettings: null as unknown,
  prueba: false,
  creadas: 0,
  whatsapp: 0,
  correos: [] as any[],
};
const dobles = new Map<string, unknown>();
dobles.set(path.join(RAIZ, "src/lib/prisma.ts"), {
  prisma: {
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("information_schema.columns")) return [{ n: 1 }];
      if (sql.includes('SELECT "isTestPatient" AS v')) return [{ v: e.prueba }];
      throw new Error("consulta no esperada: " + sql);
    },
    clinicReview: {
      findUnique: async () => null,
      create: async () => ((e.creadas += 1), {}),
      update: async () => ({}),
    },
    appointment: {
      findUnique: async () => ({
        id: "ap1", clinicId: "cl1", patientId: "pP", status: "COMPLETED",
        patient: { firstName: "Prueba", lastName: "Orto", phone: "0000000000", email: "p@ejemplo.mx" },
        clinic: {
          name: "Clínica", waConnected: true, waPhoneNumberId: "pn", waAccessToken: "t", waTemplates: null,
          reminderSettings: e.reminderSettings,
        },
      }),
    },
  },
});
dobles.set(path.join(RAIZ, "src/lib/whatsapp/send-and-log.ts"), {
  sendWhatsAppLogged: async () => ((e.whatsapp += 1), { messages: [{ id: "wamid.R" }] }),
});
dobles.set(path.join(RAIZ, "src/lib/email.ts"), {
  sendEmail: async (a: any) => (e.correos.push(a), { delivered: true }),
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

let sendReviewInvitation: typeof import("../invite").sendReviewInvitation;
before(async () => {
  ({ sendReviewInvitation } = await import("../invite"));
});
beforeEach(() => {
  e.reminderSettings = null;
  e.prueba = false;
  e.creadas = 0;
  e.whatsapp = 0;
  e.correos = [];
});

describe("sendReviewInvitation — interruptor y paciente de prueba", () => {
  it("de fábrica (nada guardado) se invita como siempre", async () => {
    await sendReviewInvitation("ap1");
    assert.equal(e.creadas, 1);
    assert.equal(e.whatsapp, 1);
    assert.equal(e.correos.length, 1);
  });

  it("11c — con «Pedir reseña al terminar la cita» apagado no se crea ni se manda nada", async () => {
    e.reminderSettings = { resenas: { alTerminar: false } };
    await sendReviewInvitation("ap1");
    assert.equal(e.creadas, 0);
    assert.equal(e.whatsapp, 0);
    assert.equal(e.correos.length, 0);
  });

  it("11d — al paciente de prueba no se le crea la invitación (no cuenta en Reseñas)", async () => {
    e.prueba = true;
    await sendReviewInvitation("ap1");
    assert.equal(e.creadas, 0);
    assert.equal(e.whatsapp, 0);
    assert.equal(e.correos.length, 0);
  });

  it("el correo de la invitación lleva el paciente (lo frena sendEmail si hace falta)", async () => {
    await sendReviewInvitation("ap1");
    assert.deepEqual(e.correos[0].paciente, { clinicId: "cl1", patientId: "pP" });
  });
});
