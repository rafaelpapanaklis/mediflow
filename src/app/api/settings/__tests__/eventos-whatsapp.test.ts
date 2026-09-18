/**
 * LA CONFIGURACIÓN DE AVISOS DE CITAS — ws1-t2.
 *
 * Run: npm run test:settings-avisos-whatsapp
 *
 * `Clinic.reminderSettings` es UN Json con tres mitades: recordatorios de cita
 * (offsets/canal/plantilla), `recall` y `eventos` (al agendar / reprogramar /
 * cancelar). El PATCH arma el Json DE CERO con las partes que conoce, así que
 * una parte que no se arrastre se BORRA al guardar cualquiera de las otras.
 * Esto prueba que ninguna pisa a ninguna, y que guardar solo `eventos` no
 * cambia lo que hace hoy el cron de recordatorios.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_APPOINTMENT_EVENT_SETTINGS,
  getAppointmentEventSettings,
  getEffectiveReminderSettings,
  getRecallSettings,
  sanitizeAppointmentEventSettings,
} from "@/lib/reminders/config";

let guardado: any;
let escrito: any;

beforeEach(() => {
  guardado = null;
  escrito = undefined;
});

(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      clinic: {
        findUnique: async ({ where }: any) => {
          assert.equal(where.id, "c1", "se lee la clínica de la sesión");
          return { reminderSettings: guardado };
        },
        update: async ({ where, data }: any) => {
          assert.equal(where.id, "c1", "se escribe la clínica de la sesión, nunca una del cuerpo");
          escrito = data;
          return { id: "c1", ...data };
        },
      },
    },
  },
});
(mock as any).module("@/lib/auth-context", {
  namedExports: { getAuthContext: async () => ({ clinicId: "c1", userId: "u1", role: "ADMIN" }) },
});
(mock as any).module("@/lib/auth/require-permission", {
  namedExports: { denyIfMissingPermission: () => null },
});
(mock as any).module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => undefined } });
(mock as any).module("@/lib/clinic-secrets", { namedExports: { stripClinicSecrets: (c: any) => c } });

async function patch(body: unknown) {
  const { PATCH } = await import("@/app/api/settings/route");
  const res = await PATCH({ json: async () => body } as any);
  return { status: res.status, body: await res.json() };
}

// ── El modelo ───────────────────────────────────────────────────────────────

test("sin nada guardado valen los defaults: confirmación al agendar sí; reprogramar y cancelar no", () => {
  assert.deepEqual(getAppointmentEventSettings({ reminderSettings: null }), DEFAULT_APPOINTMENT_EVENT_SETTINGS);
  assert.deepEqual(DEFAULT_APPOINTMENT_EVENT_SETTINGS, { alAgendar: true, alReprogramar: false, alCancelar: false });
});

test("un Json a medias no apaga ni enciende lo que la clínica no tocó", () => {
  assert.deepEqual(sanitizeAppointmentEventSettings({ alCancelar: true }), {
    alAgendar: true,
    alReprogramar: false,
    alCancelar: true,
  });
  assert.deepEqual(sanitizeAppointmentEventSettings({ alAgendar: "no" }), DEFAULT_APPOINTMENT_EVENT_SETTINGS);
  assert.equal(sanitizeAppointmentEventSettings([true]), null);
  assert.equal(sanitizeAppointmentEventSettings("x"), null);
});

test("guardar SOLO `eventos` no convierte el Json en config de recordatorios: el cron sigue con los toggles de siempre", () => {
  const clinica = {
    reminderSettings: { eventos: { alAgendar: false, alReprogramar: true, alCancelar: false } },
    waReminderActive: true,
    waReminder24h: true,
    waReminder1h: true,
    waReminderMsg: null,
  };
  const r = getEffectiveReminderSettings(clinica);
  assert.equal(r.enabled, true);
  assert.deepEqual(r.offsets, [1440, 60], "siguen mandando waReminder24h / waReminder1h");
});

// ── El PATCH ────────────────────────────────────────────────────────────────

test("PATCH { eventos } guarda los tres avisos bajo reminderSettings.eventos", async () => {
  const r = await patch({ eventos: { alAgendar: true, alReprogramar: true, alCancelar: false } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(escrito.reminderSettings, {
    eventos: { alAgendar: true, alReprogramar: true, alCancelar: false },
  });
});

test("guardar `eventos` NO pisa los recordatorios ni el recall que ya había", async () => {
  guardado = {
    enabled: true,
    offsets: [1440, 120],
    channel: "whatsapp",
    template: "Hola {paciente}",
    recall: { enabled: true, intervalDays: 90, channel: "whatsapp", message: "Vuelve {nombre}" },
  };
  await patch({ eventos: { alAgendar: false, alReprogramar: false, alCancelar: true } });
  const rs = escrito.reminderSettings;
  assert.deepEqual(rs.offsets, [1440, 120]);
  assert.equal(rs.enabled, true);
  assert.equal(getRecallSettings({ reminderSettings: rs }).intervalDays, 90);
  assert.deepEqual(rs.eventos, { alAgendar: false, alReprogramar: false, alCancelar: true });
});

test("🔴→🟢 y al revés: guardar recordatorios o recall NO borra `eventos`", async () => {
  guardado = { eventos: { alAgendar: false, alReprogramar: true, alCancelar: true } };
  await patch({ recall: { enabled: true, intervalDays: 180, channel: "whatsapp", message: "Hola {nombre}" } });
  assert.deepEqual(escrito.reminderSettings.eventos, { alAgendar: false, alReprogramar: true, alCancelar: true });

  await patch({ reminderSettings: { enabled: true, offsets: [1440], channel: "whatsapp", template: "Hola" } });
  assert.deepEqual(escrito.reminderSettings.eventos, { alAgendar: false, alReprogramar: true, alCancelar: true });

  // `reminderSettings: null` limpia SOLO la mitad de recordatorios.
  await patch({ reminderSettings: null });
  assert.deepEqual(escrito.reminderSettings.eventos, { alAgendar: false, alReprogramar: true, alCancelar: true });
});

test("`eventos` con forma inválida responde 400 y no escribe nada", async () => {
  const r = await patch({ eventos: "todo" });
  assert.equal(r.status, 400);
  assert.equal(escrito, undefined);
});
