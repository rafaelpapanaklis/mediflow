// ws1-t4 (11.3) — teléfono compartido: el aviso se atribuye al paciente correcto.
// Correr: npm run test:resenas-entrega
import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { conEtiquetaDePaciente, debeEtiquetarPaciente } from "../atribucion-paciente";

describe("debeEtiquetarPaciente", () => {
  it("un solo dueño del teléfono y hilo suyo o huérfano: sin etiqueta (no meter ruido)", () => {
    assert.equal(debeEtiquetarPaciente({ patientId: "A", hiloPatientId: "A", pacientesConElTelefono: 1 }), false);
    assert.equal(debeEtiquetarPaciente({ patientId: "A", hiloPatientId: null, pacientesConElTelefono: 1 }), false);
  });
  it("teléfono compartido: siempre etiqueta", () => {
    assert.equal(debeEtiquetarPaciente({ patientId: "B", hiloPatientId: "A", pacientesConElTelefono: 2 }), true);
    assert.equal(debeEtiquetarPaciente({ patientId: "B", hiloPatientId: null, pacientesConElTelefono: 2 }), true);
  });
  it("el hilo ya es de otro aunque el conteo no lo vea: etiqueta", () => {
    assert.equal(debeEtiquetarPaciente({ patientId: "B", hiloPatientId: "A", pacientesConElTelefono: 1 }), true);
  });
  it("si el caller no sabe el paciente no hay a quién atribuir", () => {
    assert.equal(debeEtiquetarPaciente({ patientId: null, hiloPatientId: "A", pacientesConElTelefono: 3 }), false);
  });
});

describe("conEtiquetaDePaciente", () => {
  it("antepone «Para <nombre>:» y limpia espacios", () => {
    assert.equal(conEtiquetaDePaciente("Hola", " Ana   Pérez "), "Para Ana Pérez: Hola");
  });
  it("sin nombre deja el cuerpo tal cual", () => {
    assert.equal(conEtiquetaDePaciente("Hola", "  "), "Hola");
  });
});

// ── sendWhatsAppLogged con dobles: el mensaje de B en el hilo de A ──────────
const e = {
  duenos: [] as Array<{ id: string }>,
  hilo: { id: "th", botActive: true, botState: null, patientId: null as string | null },
  upsert: [] as any[],
  bandeja: [] as any[],
};
mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      inboxMessage: { create: async ({ data }: any) => (e.bandeja.push(data), { id: "m" }) },
      clinic: { updateMany: async () => ({ count: 0 }), findUnique: async () => null },
      patient: {
        findFirst: async ({ where }: any) =>
          where.clinicId === "cl1" && where.id === "B" ? { firstName: "Beto", lastName: "Ruiz" } : null,
      },
    },
  },
});
mock.module("@/lib/whatsapp", {
  namedExports: {
    sendWhatsAppMessage: async () => ({ messages: [{ id: "w.t" }] }),
    sendWhatsAppTemplate: async () => ({ messages: [{ id: "w.p" }] }),
    sendWhatsAppInteractive: async () => ({ messages: [{ id: "w.i" }] }),
    sendWhatsAppDocument: async () => ({}),
    uploadWhatsAppMedia: async () => "media",
  },
});
mock.module("@/lib/whatsapp/inbox-log", {
  namedExports: {
    findPatientByWhatsAppPhone: async () => ({ id: "A" }),
    findPatientsByWhatsAppPhone: async () => e.duenos,
    lastInboundAtForPhone: async () => new Date(),
    upsertWhatsAppThread: async (a: any) => (e.upsert.push(a), e.hilo),
  },
});

let sendWhatsAppLogged: typeof import("../send-and-log").sendWhatsAppLogged;
before(async () => {
  ({ sendWhatsAppLogged } = await import("../send-and-log"));
});
const clinica = { id: "cl1", waPhoneNumberId: "pn", waAccessToken: "tok", waConnected: true, waTemplates: null };
beforeEach(() => {
  e.duenos = [{ id: "A" }, { id: "B" }];
  e.hilo = { id: "th", botActive: true, botState: null, patientId: "A" };
  e.upsert = [];
  e.bandeja = [];
});

describe("sendWhatsAppLogged — teléfono compartido", () => {
  it("el aviso de B en el hilo de A queda atribuido a B y el hilo no se liga a nadie nuevo", async () => {
    await sendWhatsAppLogged({ clinic: clinica, to: "5215512345678", body: "Gracias por tu visita", kind: "review", patientId: "B" });
    assert.equal(e.bandeja[0].body, "Para Beto Ruiz: Gracias por tu visita");
    assert.equal(e.upsert[0].patientId, null, "con dos dueños no se liga el hilo a B (lo haría el primero que llegue)");
  });
  it("teléfono de un solo paciente: el cuerpo no cambia y el hilo se liga a él", async () => {
    e.duenos = [{ id: "B" }];
    e.hilo = { id: "th", botActive: true, botState: null, patientId: null };
    await sendWhatsAppLogged({ clinic: clinica, to: "5215512345678", body: "Gracias", kind: "review", patientId: "B" });
    assert.equal(e.bandeja[0].body, "Gracias");
    assert.equal(e.upsert[0].patientId, "B");
  });
  it("sin patientId del caller: se comporta como siempre (adivina por teléfono, sin etiqueta)", async () => {
    await sendWhatsAppLogged({ clinic: clinica, to: "5215512345678", body: "Hola", kind: "manual_api" });
    assert.equal(e.bandeja[0].body, "Hola");
    assert.equal(e.upsert[0].patientId, "A");
  });
});
