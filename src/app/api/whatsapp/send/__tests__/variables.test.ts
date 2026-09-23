/**
 * EL RECORDATORIO MANUAL YA NO MANDA «Hola {nombre}» — ws1-t4.
 *
 * Run: npm run test:wa-recordatorio-manual
 *
 * El fallo, en una línea: `POST /api/whatsapp/send` mandaba `clinic.waReminderMsg`
 * TAL CUAL. La clínica BEVADENT lo había guardado con {nombre}/{fecha}/{hora}/
 * {doctor} y a un paciente de verdad le llegaron las llaves.
 *
 * Cómo prueba: llama al HANDLER REAL con `mock.module` sobre prisma, la sesión
 * y el embudo `sendWhatsAppLogged`. ⛔ Aquí no sale ni un mensaje: el doble
 * solo apunta con qué lo habrían llamado. El primer caso está EN ROJO con la
 * ruta de antes (el cuerpo llegaba con «{nombre}»).
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const TZ = "America/Mexico_City";
// Lunes 5 de octubre de 2026, 10:30 en Ciudad de México (UTC-6, sin horario de verano).
const STARTS_AT = new Date("2026-10-05T16:30:00.000Z");

/** El texto EXACTO que recibió el paciente (el por defecto de /dashboard/whatsapp). */
const TEXTO_BEVADENT =
  "Hola {nombre} 👋, te recordamos tu cita en *BEVADENT* el *{fecha}* a las *{hora}h*.\n\n" +
  "Dr/a. {doctor}\n\n_Responde este mensaje si necesitas cambiarla._";

const LLAVE = /[{}]/;

// ── Estado del doble ────────────────────────────────────────────────────────
let clinicRow: any;
let apptRow: any;
/** Lo que el embudo habría mandado. NUNCA llega a Meta. */
let envios: any[];
let tokenWrites: any[];
let reminderRows: any[];

beforeEach(() => {
  envios = [];
  tokenWrites = [];
  reminderRows = [];
  clinicRow = {
    id: "c1",
    name: "BEVADENT",
    timezone: TZ,
    waConnected: true,
    waPhoneNumberId: "pn-1",
    waAccessToken: "token",
    waTemplates: null,
    waReminderMsg: TEXTO_BEVADENT,
  };
  apptRow = {
    id: "a1",
    clinicId: "c1",
    startsAt: STARTS_AT,
    confirmToken: "tok-existente",
    patient: { id: "p1", firstName: "Ana", phone: "+52 999 123 4567" },
    doctor: { id: "d1", firstName: "Luis", lastName: "Ruiz" },
  };
});

const prismaStub: any = {
  clinic: {
    findUnique: async ({ where }: any) => {
      assert.equal(where.id, "c1", "la clínica sale de la sesión");
      return clinicRow;
    },
  },
  appointment: {
    findFirst: async ({ where, select }: any) => {
      assert.equal(where.clinicId, "c1", "la cita se busca SIEMPRE con el clinicId de la sesión");
      if (select?.confirmToken) return { confirmToken: apptRow.confirmToken };
      return where.id === apptRow.id ? apptRow : null;
    },
    updateMany: async ({ where, data }: any) => {
      assert.equal(where.clinicId, "c1", "el token se escribe con filtro de tenant");
      assert.equal(where.confirmToken, null, "nunca se pisa un token ya enviado");
      tokenWrites.push(data);
      if (apptRow.confirmToken) return { count: 0 };
      apptRow.confirmToken = data.confirmToken;
      return { count: 1 };
    },
    update: async () => undefined,
  },
  whatsAppReminder: {
    create: async ({ data }: any) => {
      reminderRows.push(data);
      return data;
    },
  },
};

(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
(mock as any).module("@/lib/auth-context", {
  namedExports: {
    getAuthContext: async () => ({ clinicId: "c1", isAdmin: true }),
    requireAdmin: () => null,
  },
});
// ⛔ EL EMBUDO ES UN DOBLE: este test no manda nada a nadie.
(mock as any).module("@/lib/whatsapp/send-and-log", {
  namedExports: {
    sendWhatsAppLogged: async (args: any) => {
      envios.push(args);
      return { messages: [{ id: "wamid.doble" }] };
    },
  },
});

async function enviar(appointmentId = "a1") {
  const { POST } = await import("@/app/api/whatsapp/send/route");
  const res = await POST({ json: async () => ({ appointmentId }) } as any);
  return { status: res.status, body: await res.json() };
}

// ═══════════════════════════════════════════════════════════════════════════
// Texto propio de la clínica
// ═══════════════════════════════════════════════════════════════════════════
test("el texto guardado por la clínica sale renderizado: ni una llave hacia el paciente", async () => {
  const r = await enviar();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(envios.length, 1);
  const body: string = envios[0].body;

  assert.doesNotMatch(body, LLAVE, `salieron llaves al paciente:\n${body}`);
  assert.match(body, /^Hola Ana 👋/);
  assert.match(body, /\*BEVADENT\*/);
  assert.match(body, /el \*lunes, 5 de octubre\*/, "la fecha, en la zona de la clínica");
  assert.match(body, /a las \*10:30h\*/, "la hora, en la zona de la clínica");
  assert.match(body, /\nDr\/a\. Luis Ruiz\n/);
  assert.doesNotMatch(body, /Dr\/a\. Dr\/a\./, "«Dr/a. {doctor}» no duplica el tratamiento");
  // El texto no traía {link}: el render lo añade al final, como en los automáticos.
  assert.match(body, /Confirma tu asistencia aquí: https?:\/\/\S+\/cita\/tok-existente\/confirmar$/);
  assert.equal(tokenWrites.length, 0, "con token ya existente no se escribe otro");
  assert.equal(reminderRows[0]?.status, "SENT");
});

test("con las variables nuevas y sus alias también sustituye todo, y {link} no se repite", async () => {
  clinicRow.waReminderMsg =
    "{paciente} ({nombre}) · {clinica}/{clinicName} · {fecha} {hora} · {doctor}/{doctorName} · {link}";
  const r = await enviar();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const body: string = envios[0].body;
  assert.doesNotMatch(body, LLAVE, body);
  assert.match(body, /^Ana \(Ana\) · BEVADENT\/BEVADENT · lunes, 5 de octubre 10:30 · Dr\/a\. Luis Ruiz\/Dr\/a\. Luis Ruiz · /);
  assert.equal(body.split("/cita/tok-existente/confirmar").length - 1, 1, "el link sale una sola vez");
});

// ═══════════════════════════════════════════════════════════════════════════
// Texto de respaldo
// ═══════════════════════════════════════════════════════════════════════════
test("sin texto propio sale el de respaldo, renderizado y con CONFIRMAR / CANCELAR", async () => {
  for (const vacio of [null, "", "   \n "]) {
    envios = [];
    clinicRow.waReminderMsg = vacio;
    const r = await enviar();
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const body: string = envios[0].body;
    assert.doesNotMatch(body, LLAVE, body);
    assert.match(
      body,
      /^Hola Ana 👋, te recordamos que tienes una cita en \*BEVADENT\* el \*lunes, 5 de octubre\* a las \*10:30h\*\.\n\nDr\/a\. Luis Ruiz\n\n/,
    );
    assert.match(body, /Responde \*CONFIRMAR\*/);
    assert.match(body, /Responde \*CANCELAR\*/);
    assert.match(body, /\/cita\/tok-existente\/confirmar$/);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Variable que no existe
// ═══════════════════════════════════════════════════════════════════════════
test("una variable que no existe NO llega al paciente: 400 con el motivo y nada enviado", async () => {
  for (const [texto, esperada] of [
    ["Hola {nombre}, tu cita cuesta {precio}.", "{precio}"],
    ["Hola { nombre }", "{ nombre }"],
    ["Hola {{1}}, te esperamos", "{{1}}"],
    ["Tu cita es el {{fecha}}", "{{fecha}}"],
    ["Hola {Nombre}", "{Nombre}"],
  ] as const) {
    envios = [];
    reminderRows = [];
    clinicRow.waReminderMsg = texto;
    const r = await enviar();
    assert.equal(r.status, 400, texto);
    assert.equal(envios.length, 0, `se envió «${texto}» con una llave sin sustituir`);
    assert.ok(r.body.error.includes(esperada), `el error nombra ${esperada}: ${r.body.error}`);
    assert.deepEqual(r.body.unknownVars, [esperada]);
    assert.equal(reminderRows.length, 0, "no se marca como enviado");
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// La plantilla de Meta (fuera de ventana) NO se toca
// ═══════════════════════════════════════════════════════════════════════════
test("los parámetros {{1}}…{{4}} de la plantilla de Meta siguen siendo los mismos cuatro valores", async () => {
  await enviar();
  assert.deepEqual(envios[0].templateParams, ["Ana", "BEVADENT", "lunes, 5 de octubre", "10:30"]);
  assert.equal(envios[0].kind, "manual_api");
});

// ═══════════════════════════════════════════════════════════════════════════
// Link de confirmación
// ═══════════════════════════════════════════════════════════════════════════
test("si la cita no tenía token se genera uno (con tenant) y el link lo usa", async () => {
  apptRow.confirmToken = null;
  const r = await enviar();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(tokenWrites.length, 1);
  const fresh = tokenWrites[0].confirmToken as string;
  assert.ok(fresh.length >= 24);
  assert.ok(envios[0].body.endsWith(`/cita/${fresh}/confirmar`), envios[0].body);
});
