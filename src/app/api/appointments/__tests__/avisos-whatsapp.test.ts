/**
 * EL BOTÓN «ENVIAR WHATSAPP» YA NO MIENTE — ws1-t2 (H-1 y H-2 de la auditoría).
 *
 * Run: npm run test:agenda-avisos-whatsapp
 *
 * El fallo, en una línea: el diálogo de nueva cita mandaba `notifyPatient: true`
 * y `POST /api/appointments` lo tiraba en un `TODO(M3.b)` — cinco meses con un
 * interruptor que decía «avisado» sin avisar. Lo mismo al reprogramar y en lote.
 *
 * Cómo prueba: llama a los HANDLERS REALES (POST, PATCH, DELETE, PATCH /status)
 * con `mock.module` sobre prisma, la sesión y —lo importante— sobre el embudo
 * `sendWhatsAppLogged`. ⛔ Aquí no sale ni un mensaje: el doble solo apunta con
 * qué lo habrían llamado. El primer caso está EN ROJO con el código de antes
 * (respondía 201 y el doble se quedaba sin una sola llamada).
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TZ = "America/Mexico_City";
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

function atMinute(offsetMs: number): Date {
  return new Date(Math.floor((Date.now() + offsetMs) / MIN) * MIN);
}

const SRC = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

// ── Estado del doble ────────────────────────────────────────────────────────
let existingRow: any;
/** La fila de `clinics` tal como la vería el emisor de avisos. */
let clinicRow: any;
let patientPhone: string | null;
/** Lo que el embudo habría mandado. NUNCA llega a Meta. */
let envios: any[];
/** Si no es null, el embudo lanza esto (envío bloqueado / Meta caído). */
let falloDelEmbudo: Error | null;
let apptStartsAt: Date;

beforeEach(() => {
  existingRow = null;
  patientPhone = "+52 999 123 4567";
  envios = [];
  falloDelEmbudo = null;
  apptStartsAt = atMinute(2 * DAY);
  clinicRow = {
    id: "c1",
    name: "Clínica QA",
    phone: "9990000000",
    timezone: TZ,
    reminderSettings: null,
    waConnected: true,
    waPhoneNumberId: "pn-1",
    waAccessToken: "token",
    waTemplates: null,
  };
});

function apptRow(data: any) {
  return {
    id: "a1",
    clinicId: "c1",
    patientId: "p1",
    doctorId: "d1",
    resourceId: null,
    type: "Consulta general",
    notes: null,
    overrideReason: null,
    status: "SCHEDULED",
    patient: { id: "p1", firstName: "Ana", lastName: "García", visibleUserIds: [] },
    doctor: { id: "d1", firstName: "Luis", lastName: "Ruiz" },
    ...data,
  };
}

const prismaStub: any = {
  patient: { findFirst: async () => ({ id: "p1", status: "ACTIVE" }) },
  user: { findFirst: async ({ where }: any) => ({ id: where.id }) },
  resource: { findFirst: async ({ where }: any) => ({ id: where.id }) },
  appointmentTimeline: { findUnique: async () => null, upsert: async () => undefined },
  appointment: {
    findFirst: async ({ where, select, include }: any = {}) => {
      // La consulta del emisor de avisos: pide la clínica y filtra por tenant.
      if (select?.clinic) {
        assert.equal(where.clinicId, "c1", "el emisor consulta SIEMPRE con el clinicId de la sesión");
        return {
          startsAt: apptStartsAt,
          patient: { id: "p1", firstName: "Ana", phone: patientPhone },
          doctor: { firstName: "Luis", lastName: "Ruiz" },
          clinic: clinicRow,
        };
      }
      return (
        existingRow && {
          ...existingRow,
          ...(include?.patient?.select?.status ? { patient: { status: "ACTIVE" } } : {}),
        }
      );
    },
    findUnique: async () => null,
    findMany: async () => [],
    update: async () => undefined,
  },
  $transaction: async (fn: any) =>
    fn({
      appointment: {
        create: async ({ data }: any) => {
          apptStartsAt = data.startsAt;
          return apptRow({ ...data, id: "nueva" });
        },
        update: async ({ data }: any) => {
          if (data.startsAt) apptStartsAt = data.startsAt;
          return apptRow({
            ...existingRow,
            ...(data.startsAt ? { startsAt: data.startsAt } : {}),
            ...(data.endsAt ? { endsAt: data.endsAt } : {}),
            ...(data.status ? { status: data.status } : {}),
          });
        },
      },
    }),
};

const session = {
  user: { id: "u-recep", role: "RECEPTIONIST", clinicId: "c1", displayName: "Recepción", permissionsOverride: [] },
  clinic: {
    id: "c1",
    name: "Clínica QA",
    category: "DENTAL",
    timezone: TZ,
    defaultSlotMinutes: 30,
    agendaDayStart: 0,
    agendaDayEnd: 24,
    waConnected: true,
    trialEndsAt: null,
    subscriptionStatus: "active",
    schedules: [],
  },
  timeConfig: { timezone: TZ, slotMinutes: 30, dayStart: 0, dayEnd: 24 },
};

(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
// ⛔ EL EMBUDO ES UN DOBLE: este test no manda nada a nadie.
(mock as any).module("@/lib/whatsapp/send-and-log", {
  namedExports: {
    sendWhatsAppLogged: async (args: any) => {
      if (falloDelEmbudo) throw falloDelEmbudo;
      envios.push(args);
      return { messages: [{ id: "wamid.doble" }] };
    },
  },
});
(mock as any).module("@/lib/agenda/api-helpers", {
  namedExports: { loadClinicSession: async () => session, requireRole: () => null },
});
(mock as any).module("@/lib/auth/require-permission", {
  namedExports: { denyIfMissingPermission: () => null },
});
(mock as any).module("@/lib/agenda/server", {
  namedExports: {
    appointmentToDTO: (a: any) => ({ id: a.id, status: a.status, startsAt: a.startsAt, reason: a.type }),
    fetchActiveDoctors: async () => [],
    fetchAppointmentsForDay: async () => [],
    fetchPendingValidation: async () => [],
    fetchResources: async () => [],
    fetchWaitlistCount: async () => 0,
  },
});
(mock as any).module("@/lib/patient-visibility", {
  namedExports: {
    ensureUserCanSeePatient: async () => undefined,
    assertPatientVisible: async () => null,
    canSeePatient: () => true,
  },
});
(mock as any).module("@/lib/agenda/resource-schedule.server", {
  namedExports: { loadResourceSchedule: async () => [] },
});
(mock as any).module("@/lib/audit", { namedExports: { logMutation: async () => undefined } });
(mock as any).module("@/lib/cache/revalidate", {
  namedExports: { revalidateAfter: () => undefined, revalidatePatientProfile: () => undefined },
});
(mock as any).module("@/lib/agenda/google-sync", {
  namedExports: {
    syncCreateToGoogleCalendar: async () => undefined,
    syncUpdateToGoogleCalendar: async () => undefined,
    syncDeleteFromGoogleCalendar: async () => undefined,
  },
});
(mock as any).module("@/lib/reminders/reschedule.server", {
  namedExports: {
    applyReminderReschedule: async () => undefined,
    cancelPendingRemindersForAppointment: async () => undefined,
  },
});

function req(body: unknown): any {
  return {
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
    nextUrl: new URL("http://localhost/api/appointments"),
    url: "http://localhost/api/appointments",
  };
}

async function post(body: unknown) {
  const { POST } = await import("@/app/api/appointments/route");
  const res = await POST(req(body));
  return { status: res.status, body: await res.json() };
}
async function patch(body: unknown) {
  const { PATCH } = await import("@/app/api/appointments/[id]/route");
  const res = await PATCH(req(body), { params: { id: "a1" } });
  return { status: res.status, body: await res.json() };
}
async function del() {
  const { DELETE } = await import("@/app/api/appointments/[id]/route");
  const res = await DELETE(req({}), { params: { id: "a1" } });
  return { status: res.status, body: await res.json() };
}
async function patchStatus(body: unknown) {
  const { PATCH } = await import("@/app/api/appointments/[id]/status/route");
  const res = await PATCH(req(body), { params: { id: "a1" } });
  return { status: res.status, body: await res.json() };
}

function futureBody(extra: Record<string, unknown> = {}) {
  const startsAt = atMinute(2 * DAY);
  return {
    patientId: "p1",
    doctorId: "d1",
    resourceId: null,
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 30 * MIN).toISOString(),
    reason: "Limpieza",
    isTeleconsult: false,
    ...extra,
  };
}

function citaExistente() {
  const startsAt = atMinute(3 * DAY);
  existingRow = apptRow({ startsAt, endsAt: new Date(startsAt.getTime() + 30 * MIN) });
  apptStartsAt = startsAt;
  return existingRow;
}

// ═══════════════════════════════════════════════════════════════════════════
// H-1 · AGENDAR
// ═══════════════════════════════════════════════════════════════════════════

test("🔴→🟢 agendar con «Enviar WhatsApp» encendido MANDA la confirmación, por el embudo que deja copia en Inbox", async () => {
  const r = await post(futureBody({ notifyPatient: true }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(envios.length, 1, "el servidor tiró `notifyPatient`: no salió ningún WhatsApp");

  const e = envios[0];
  assert.equal(e.kind, "booking", "sale como confirmación de cita (plantilla dc_confirmacion_cita fuera de ventana)");
  assert.equal(e.to, "+52 999 123 4567");
  assert.equal(e.patientId, "p1", "el hilo del Inbox nace ligado a ESTE paciente");
  assert.equal(e.sentById, "u-recep", "queda a nombre de quien agendó, no del bot");
  assert.equal(e.clinic.id, "c1");
  // {{1}} paciente, {{2}} clínica, {{3}} fecha, {{4}} hora, {{5}} doctor.
  assert.equal(e.templateParams.length, 5);
  assert.equal(e.templateParams[0], "Ana");
  assert.equal(e.templateParams[1], "Clínica QA");
  assert.equal(e.templateParams[4], "Dr/a. Luis Ruiz");
  assert.ok(e.templateParams.every((p: string) => p && p.trim() !== ""), "Meta rechaza variables vacías");
  assert.match(e.body, /Cita agendada en Clínica QA/);

  assert.deepEqual(r.body.whatsapp, { enviado: true }, "el diálogo tiene que poder decir que sí salió");
});

test("con el interruptor apagado no se manda nada (y la respuesta lo dice: whatsapp = null)", async () => {
  const r = await post(futureBody({ notifyPatient: false }));
  assert.equal(r.status, 201);
  assert.equal(envios.length, 0);
  assert.equal(r.body.whatsapp, null);
});

test("sin `notifyPatient` (Sabina, el formulario de /dashboard/appointments) tampoco se manda", async () => {
  const r = await post(futureBody());
  assert.equal(r.status, 201);
  assert.equal(envios.length, 0);
});

test("LA CLÍNICA MANDA: con la confirmación apagada en WhatsApp → Avisos de citas no sale, y se dice por qué", async () => {
  clinicRow.reminderSettings = { eventos: { alAgendar: false } };
  const r = await post(futureBody({ notifyPatient: true }));
  assert.equal(r.status, 201);
  assert.equal(envios.length, 0);
  assert.deepEqual(r.body.whatsapp, { enviado: false, motivo: "apagadoPorClinica" });
});

test("clínica sin WhatsApp conectado: no se manda y el motivo viaja (no un «enviado» de mentira)", async () => {
  clinicRow.waConnected = false;
  const r = await post(futureBody({ notifyPatient: true }));
  assert.equal(r.status, 201);
  assert.equal(envios.length, 0);
  assert.deepEqual(r.body.whatsapp, { enviado: false, motivo: "notConnected" });
});

test("paciente sin teléfono: la cita se crea y el motivo es «noPhone»", async () => {
  patientPhone = null;
  const r = await post(futureBody({ notifyPatient: true }));
  assert.equal(r.status, 201);
  assert.equal(envios.length, 0);
  assert.deepEqual(r.body.whatsapp, { enviado: false, motivo: "noPhone" });
});

test("si el embudo bloquea (fuera de ventana y sin plantilla) la cita SE CREA IGUAL y el motivo es legible", async () => {
  falloDelEmbudo = new Error(
    "Fuera de la ventana de 24 h y falta configurar la plantilla de este tipo de mensaje " +
      "en Configuración → WhatsApp → Plantillas.",
  );
  const r = await post(futureBody({ notifyPatient: true }));
  assert.equal(r.status, 201, "un WhatsApp que falla no puede tumbar la cita");
  assert.deepEqual(r.body.whatsapp, { enviado: false, motivo: "templateNotConfigured" });
});

// ═══════════════════════════════════════════════════════════════════════════
// REPROGRAMAR
// ═══════════════════════════════════════════════════════════════════════════

function moverUnaHora() {
  const e = citaExistente();
  const startsAt = new Date(e.startsAt.getTime() + 60 * MIN);
  return { startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 30 * MIN).toISOString() };
}

test("por defecto, reprogramar NO avisa: es lo de hoy, y nadie pulsó un botón", async () => {
  const r = await patch(moverUnaHora());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(envios.length, 0);
  assert.deepEqual(r.body.whatsapp, { enviado: false, motivo: "apagadoPorClinica" });
});

test("con «Aviso al reprogramar» encendido, mover la cita manda la fecha NUEVA con la plantilla de reagendado", async () => {
  clinicRow.reminderSettings = { eventos: { alReprogramar: true } };
  const r = await patch(moverUnaHora());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(envios.length, 1);
  assert.equal(envios[0].kind, "appointment_change");
  assert.equal(envios[0].templateParams.length, 5);
  assert.match(envios[0].body, /cambió/);
  assert.deepEqual(r.body.whatsapp, { enviado: true });
});

test("cambiar solo el motivo (sin mover la hora) no es noticia para el paciente", async () => {
  clinicRow.reminderSettings = { eventos: { alReprogramar: true } };
  citaExistente();
  const r = await patch({ reason: "Revisión" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(envios.length, 0);
  assert.equal(r.body.whatsapp, null);
});

test("`notifyPatient: false` explícito calla el aviso de ESE movimiento", async () => {
  clinicRow.reminderSettings = { eventos: { alReprogramar: true } };
  const r = await patch({ ...moverUnaHora(), notifyPatient: false });
  assert.equal(r.status, 200);
  assert.equal(envios.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// CANCELAR (los dos caminos del panel: DELETE y PATCH /status)
// ═══════════════════════════════════════════════════════════════════════════

test("por defecto, cancelar NO avisa (ni por DELETE ni por /status)", async () => {
  citaExistente();
  const a = await del();
  assert.equal(a.status, 200, JSON.stringify(a.body));
  citaExistente();
  const b = await patchStatus({ status: "CANCELLED" });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal(envios.length, 0);
});

test("con «Aviso al cancelar» encendido avisa, y SIN plantilla: la de reagendado diría que la cita «cambió»", async () => {
  clinicRow.reminderSettings = { eventos: { alCancelar: true } };
  citaExistente();
  const a = await del();
  assert.equal(a.status, 200, JSON.stringify(a.body));
  citaExistente();
  const b = await patchStatus({ status: "CANCELLED" });
  assert.equal(b.status, 200, JSON.stringify(b.body));

  assert.equal(envios.length, 2);
  for (const e of envios) {
    assert.equal(e.kind, "appointment_change");
    assert.equal(e.templateParams, null, "cancelar con la plantilla «cambió al…» sería un mensaje que miente");
    assert.match(e.body, /fue cancelada/);
  }
});

test("marcar NO_SHOW nunca avisa, ni con el aviso de cancelación encendido", async () => {
  clinicRow.reminderSettings = { eventos: { alCancelar: true } };
  existingRow = apptRow({ startsAt: atMinute(-2 * 60 * MIN), endsAt: atMinute(-90 * MIN), status: "CONFIRMED" });
  const r = await patchStatus({ status: "NO_SHOW" });
  assert.equal(envios.length, 0, JSON.stringify(r.body));
});

test("una cita que ya pasó no se le anuncia a nadie", async () => {
  clinicRow.reminderSettings = { eventos: { alCancelar: true } };
  citaExistente();
  apptStartsAt = atMinute(-DAY);
  const r = await del();
  assert.equal(envios.length, 0);
  assert.deepEqual(r.body.whatsapp, { enviado: false, motivo: "citaPasada" });
});

test("agendar «para ahora» (dentro de la tolerancia del POST) SÍ manda: no es una cita pasada", async () => {
  // El paciente llega 10:10 y se le da la de las 10:00. El POST lo permite
  // (slot + 15 min); el aviso tiene que medir con la misma vara.
  clinicRow.defaultSlotMinutes = 30;
  const startsAt = atMinute(-10 * MIN);
  const r = await post(futureBody({
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 30 * MIN).toISOString(),
    notifyPatient: true,
  }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(envios.length, 1);
  assert.deepEqual(r.body.whatsapp, { enviado: true });
});

test("DELETE con `notifyPatient: false` (lo que manda Sabina) no avisa aunque la clínica lo tenga encendido", async () => {
  clinicRow.reminderSettings = { eventos: { alCancelar: true } };
  citaExistente();
  const { DELETE } = await import("@/app/api/appointments/[id]/route");
  const res = await DELETE(req({ reason: "Pidió cambio", notifyPatient: false }), { params: { id: "a1" } });
  assert.equal(res.status, 200);
  assert.equal(envios.length, 0);
  assert.equal((await res.json()).whatsapp, null);
});

test("Sabina pide expresamente que NO se avise: su propuesta promete que el sistema no le escribe al paciente", () => {
  for (const tool of ["lib/sabina/tools/reagendar-cita.ts", "lib/sabina/tools/cancelar-cita.ts"]) {
    const fuente = leer(tool);
    assert.match(fuente, /notifyPatient: false/, `${tool} no pide callar el aviso`);
    assert.match(fuente, /no recibirá ningún aviso/, `${tool} ya no promete silencio: revisa si esto sigue haciendo falta`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CANDADOS DE CÓDIGO
// ═══════════════════════════════════════════════════════════════════════════

test("el emisor de avisos NO importa la capa cruda: todo sale por sendWhatsAppLogged", () => {
  const emisor = leer("lib/whatsapp/avisos-cita.ts");
  assert.match(emisor, /from "@\/lib\/whatsapp\/send-and-log"/);
  assert.ok(!/from "@\/lib\/whatsapp"/.test(emisor), "importa @/lib/whatsapp (envío a ciegas, sin copia en Inbox)");
  assert.ok(!/sendWhatsAppMessage|sendWhatsAppTemplate/.test(emisor));
});

test("ya no queda ningún TODO(M3.b) tirando `notifyPatient` en las rutas de citas", () => {
  for (const ruta of [
    "app/api/appointments/route.ts",
    "app/api/appointments/[id]/route.ts",
    "app/api/appointments/batch-validate/route.ts",
  ]) {
    assert.ok(!/TODO\(M3\.b\)/.test(leer(ruta)), `${ruta} todavía tiene el TODO`);
    assert.match(leer(ruta), /avisarCitaPorWhatsApp/, `${ruta} no llama al emisor`);
  }
});

test("el diálogo solo enseña «Enviar WhatsApp» si la clínica está conectada Y tiene la confirmación encendida", () => {
  const dialogo = leer("components/dashboard/new-appointment/new-appointment-dialog.tsx");
  assert.match(dialogo, /boot\.waConnected && boot\.waConfirmOnCreate && \(/);
  assert.match(dialogo, /setNotifyPatient\(waConnected && waConfirmOnCreate\)/);
  assert.match(dialogo, /toastWhatsAppNotSent/, "si no salió, el diálogo tiene que decirlo");
});
