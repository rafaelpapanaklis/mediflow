// ws1-t4 (11.3 y 11.4) — la invitación de reseña pasa el paciente de LA cita a
// sendWhatsAppLogged y guarda el id del mensaje de Meta para cruzar la entrega.
// Correr: npm run test:resenas-entrega
// Sin --experimental-test-module-mocks: invite.ts lleva `import "server-only"`
// (inexistente fuera de Next) y con ese flag no se deja sustituir. Se parchea
// Module._load, igual que agenda-bloqueos/__tests__/politica.test.ts.
import Module from "node:module";
import path from "node:path";
import { before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

const RAIZ = path.resolve(__dirname, "../../../..");

const e = {
  envios: [] as any[],
  actualizado: null as any,
  meta: { messages: [{ id: "wamid.R1" }] } as any,
};
const dobles = new Map<string, unknown>();
dobles.set(path.join(RAIZ, "src/lib/prisma.ts"), {
  prisma: {
    clinicReview: {
      findUnique: async () => null,
      create: async () => ({}),
      update: async ({ data }: any) => ((e.actualizado = data), { catch: () => {} }),
    },
    appointment: {
      findUnique: async () => ({
        id: "ap1", clinicId: "cl1", patientId: "pB", status: "COMPLETED",
        patient: { firstName: "Beto", lastName: "Ruiz", phone: "0000000000", email: null },
        clinic: { name: "Clínica", waConnected: true, waPhoneNumberId: "pn", waAccessToken: "t", waTemplates: null },
      }),
    },
  },
});
dobles.set(path.join(RAIZ, "src/lib/whatsapp/send-and-log.ts"), {
  sendWhatsAppLogged: async (a: any) => (e.envios.push(a), e.meta),
});
dobles.set(path.join(RAIZ, "src/lib/email.ts"), { sendEmail: async () => ({ delivered: false }) });

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
  e.envios = [];
  e.actualizado = null;
  e.meta = { messages: [{ id: "wamid.R1" }] };
});

describe("sendReviewInvitation", () => {
  it("11.3 — manda el patientId de la cita (no se adivina por teléfono)", async () => {
    await sendReviewInvitation("ap1");
    assert.equal(e.envios.length, 1);
    assert.equal(e.envios[0].patientId, "pB");
    assert.equal(e.envios[0].kind, "review");
  });
  it("11.4 — guarda el canal Y el id del mensaje de Meta", async () => {
    await sendReviewInvitation("ap1");
    assert.deepEqual(e.actualizado.invitedChannels, ["whatsapp", "wamid:wamid.R1"]);
  });
  it("sin id en la respuesta de Meta: solo el canal", async () => {
    e.meta = {};
    await sendReviewInvitation("ap1");
    assert.deepEqual(e.actualizado.invitedChannels, ["whatsapp"]);
  });
});
