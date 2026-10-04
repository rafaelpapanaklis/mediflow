/**
 * ws1-t1 (ronda de arreglos de la auditoría de uso, C-107) — la reactivación con WhatsApp desconectado.
 *
 * Con el código de antes: con el canal «WhatsApp» y la clínica SIN WhatsApp conectado, el barrido encolaba una
 * fila por paciente y el botón anunciaba «N por WhatsApp» que nunca iban a salir.
 *
 * Llama al `sweepClinic` REAL con Prisma y el correo sustituidos: aquí no se encola ni se manda nada de verdad.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let encoladas: any[] = [];
let correos: any[] = [];
const pacientes = [
  { id: "p1", firstName: "Ana", lastName: "López", phone: "5512345678", email: "ana@correo.com", last_completed: new Date("2025-01-01") },
  { id: "p2", firstName: "Luis", lastName: "Pérez", phone: "5598765432", email: null, last_completed: new Date("2025-02-01") },
];

beforeEach(() => {
  encoladas = [];
  correos = [];
});

(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      $queryRaw: async () => pacientes,
      whatsAppReminder: {
        findMany: async () => [],
        createMany: async ({ data }: any) => {
          encoladas.push(...data);
          return { count: data.length };
        },
      },
    },
  },
});
(mock as any).module("@/lib/email", {
  namedExports: {
    sendEmail: async (m: any) => {
      correos.push(m);
      return { delivered: true };
    },
  },
});

const clinica = (canal: string, waConnected: boolean) => ({
  id: "c1",
  name: "Clínica QA",
  waConnected,
  reminderSettings: { recall: { enabled: true, intervalDays: 180, channel: canal, message: "Hola {nombre}" } },
});

test("🔴→🟢 canal WhatsApp y clínica SIN WhatsApp: no se encola nada y el resultado lo dice", async () => {
  const { sweepClinic } = await import("../sweep");
  const r = await sweepClinic(clinica("whatsapp", false));
  assert.equal(r.queuedWhatsapp, 0);
  assert.equal(encoladas.filter((e) => e.payload?.channel === "whatsapp").length, 0);
  assert.equal(r.whatsappDesconectado, true);
});

test("con WhatsApp conectado se encola como siempre", async () => {
  const { sweepClinic } = await import("../sweep");
  const r = await sweepClinic(clinica("whatsapp", true));
  assert.equal(r.queuedWhatsapp, 2);
  assert.equal(r.whatsappDesconectado, undefined);
});

test("canal «ambos» sin WhatsApp: el correo sigue saliendo, WhatsApp no se encola", async () => {
  const { sweepClinic } = await import("../sweep");
  const r = await sweepClinic(clinica("both", false));
  assert.equal(r.queuedWhatsapp, 0);
  assert.equal(r.sentEmail, 1);
  assert.equal(correos.length, 1);
  assert.equal(r.whatsappDesconectado, true);
});
