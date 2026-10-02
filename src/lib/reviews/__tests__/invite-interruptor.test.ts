// ws1-t11 (11c) — la invitación a reseña respeta «Pedir reseña al terminar la
// cita». Y, desde que Rafael canceló «Paciente de prueba / no contactar»
// (decisión 12, 2-oct-2026), nada vuelve a leer su columna de «patients»:
// quedó pegada en producción (sql/ws1-t11-paciente-de-prueba.sql) pero sin uso.
// Correr: npm run test:resena-interruptor
// Mismo andamio que invite-paciente-y-entrega.test.ts (Module._load: invite.ts
// lleva "server-only").
import Module from "node:module";
import fs from "node:fs";
import path from "node:path";
import { before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

const RAIZ = path.resolve(__dirname, "../../../..");
// Partido a propósito: así esta prueba no se encuentra a sí misma.
const COLUMNA = "isTest" + "Patient";

const e = {
  reminderSettings: null as unknown,
  consultasCrudas: [] as string[],
  creadas: 0,
  whatsapp: 0,
  correos: [] as any[],
};
const dobles = new Map<string, unknown>();
dobles.set(path.join(RAIZ, "src/lib/prisma.ts"), {
  prisma: {
    $queryRaw: async (strings: TemplateStringsArray) => {
      e.consultasCrudas.push(strings.join("?"));
      return [];
    },
    clinicReview: {
      findUnique: async () => null,
      create: async () => ((e.creadas += 1), {}),
      update: async () => ({}),
    },
    appointment: {
      findUnique: async () => ({
        id: "ap1", clinicId: "cl1", patientId: "pP", status: "COMPLETED",
        patient: { firstName: "Ana", lastName: "Orto", phone: "0000000000", email: "p@ejemplo.mx" },
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
  e.consultasCrudas = [];
  e.creadas = 0;
  e.whatsapp = 0;
  e.correos = [];
});

describe("sendReviewInvitation — «Pedir reseña al terminar la cita»", () => {
  it("de fábrica (nada guardado) se invita como siempre, sin consultas crudas", async () => {
    await sendReviewInvitation("ap1");
    assert.equal(e.creadas, 1);
    assert.equal(e.whatsapp, 1);
    assert.equal(e.correos.length, 1);
    assert.deepEqual(e.consultasCrudas, []);
  });

  it("encendido a mano también invita", async () => {
    e.reminderSettings = { resenas: { alTerminar: true } };
    await sendReviewInvitation("ap1");
    assert.equal(e.creadas, 1);
    assert.equal(e.whatsapp, 1);
  });

  it("apagado no se crea ni se manda nada", async () => {
    e.reminderSettings = { resenas: { alTerminar: false } };
    await sendReviewInvitation("ap1");
    assert.equal(e.creadas, 0);
    assert.equal(e.whatsapp, 0);
    assert.equal(e.correos.length, 0);
  });

  it("el correo ya no lleva la marca `paciente` del freno de prueba", async () => {
    await sendReviewInvitation("ap1");
    assert.equal("paciente" in e.correos[0], false);
  });
});

describe("«Paciente de prueba / no contactar» no existe (decisión 12)", () => {
  function archivos(dir: string, out: string[] = []): string[] {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === "node_modules" || ent.name.startsWith(".")) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) archivos(p, out);
      else if (/\.(ts|tsx|js|mjs|cjs|json|prisma)$/.test(ent.name)) out.push(p);
    }
    return out;
  }

  it(`nada en src/ ni en prisma/ lee la columna ${COLUMNA}`, () => {
    const con = [...archivos(path.join(RAIZ, "src")), ...archivos(path.join(RAIZ, "prisma"))]
      .filter((f) => fs.readFileSync(f, "utf8").includes(COLUMNA))
      .map((f) => path.relative(RAIZ, f));
    assert.deepEqual(con, []);
  });

  it("no quedan sus módulos, su API ni su pantalla", () => {
    for (const r of [
      "src/lib/patients/paciente-de-prueba.ts",
      "src/lib/patients/paciente-de-prueba-db.ts",
      "src/lib/patients/textos-paciente-de-prueba.ts",
      "src/app/api/patients/[id]/prueba/route.ts",
      "src/components/dashboard/patient-detail/paciente-de-prueba.tsx",
    ]) {
      assert.equal(fs.existsSync(path.join(RAIZ, r)), false, r);
    }
  });
});
