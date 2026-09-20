/**
 * LOS DOS INTERRUPTORES DE COBRANZA — ws1-t3.
 *
 * Run: npm run test:settings-cobranza
 *
 * `Clinic.reminderSettings` es UN Json que ahora tiene CUATRO partes:
 * recordatorios de cita, `recall`, `eventos` (ws1-t2) y `cobranza` (esta). El
 * PATCH arma el Json DE CERO con las partes que conoce, así que una parte que
 * no se arrastre se BORRA al guardar cualquiera de las otras. Esto prueba que
 * la cuarta no pisa a las tres de antes, que las tres no la pisan a ella, y
 * —lo más importante— que sin que la clínica lo guarde, los dos interruptores
 * están APAGADOS.
 *
 * Imita a `eventos-whatsapp.test.ts` (ws1-t2) a propósito: mismo patrón de
 * dobles y mismo contrato.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_COBRANZA_SETTINGS,
  getAppointmentEventSettings,
  getCobranzaSettings,
  getEffectiveReminderSettings,
  getRecallSettings,
  sanitizeCobranzaSettings,
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

test("sin nada guardado, los DOS interruptores están apagados", () => {
  assert.deepEqual(getCobranzaSettings({ reminderSettings: null }), DEFAULT_COBRANZA_SETTINGS);
  assert.equal(DEFAULT_COBRANZA_SETTINGS.enabled, false, "no se avisa de cobranza sin pedirlo");
  assert.equal(DEFAULT_COBRANZA_SETTINGS.bot, false, "el bot no habla de dinero sin pedirlo");
});

test("una clínica que solo configuró recordatorios y recall NO tiene cobranza encendida", () => {
  const rs = {
    enabled: true,
    offsets: [1440],
    channel: "whatsapp",
    recall: { enabled: true, intervalDays: 90, channel: "whatsapp", message: "x" },
    eventos: { alAgendar: true, alReprogramar: true, alCancelar: true },
  };
  const c = getCobranzaSettings({ reminderSettings: rs });
  assert.equal(c.enabled, false);
  assert.equal(c.bot, false);
});

test("solo un booleano de verdad enciende: ni «true», ni 1, ni [] valen", () => {
  assert.equal(sanitizeCobranzaSettings({ enabled: "true" })!.enabled, false);
  assert.equal(sanitizeCobranzaSettings({ enabled: 1 })!.enabled, false);
  assert.equal(sanitizeCobranzaSettings({ bot: "sí" })!.bot, false);
  assert.equal(sanitizeCobranzaSettings({ enabled: true })!.enabled, true);
  assert.equal(sanitizeCobranzaSettings([true]), null, "un array no es config");
  assert.equal(sanitizeCobranzaSettings("x"), null);
  assert.equal(sanitizeCobranzaSettings(null), null);
});

test("los dos interruptores son INDEPENDIENTES: uno no enciende al otro", () => {
  const soloAviso = sanitizeCobranzaSettings({ enabled: true })!;
  assert.equal(soloAviso.enabled, true);
  assert.equal(soloAviso.bot, false, "avisar no implica dejar que el bot hable de dinero");

  const soloBot = sanitizeCobranzaSettings({ bot: true })!;
  assert.equal(soloBot.bot, true);
  assert.equal(soloBot.enabled, false, "ni al revés");
});

test("un `diasAntes` que no está en la lista cae al default, no a cero", () => {
  // Con 0 el aviso saldría el mismo día del vencimiento para todo el mundo.
  assert.equal(sanitizeCobranzaSettings({ diasAntes: 99 })!.diasAntes, 3);
  assert.equal(sanitizeCobranzaSettings({ diasAntes: 0 })!.diasAntes, 3);
  assert.equal(sanitizeCobranzaSettings({ diasAntes: 7 })!.diasAntes, 7);
});

test("guardar SOLO `cobranza` no convierte el Json en config de recordatorios", () => {
  // Igual que `eventos`: el cron de citas tiene que seguir con los toggles de
  // siempre, sin enterarse.
  const clinica = {
    reminderSettings: { cobranza: { enabled: true, diasAntes: 3, bot: true } },
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

test("PATCH { cobranza } guarda los dos interruptores bajo reminderSettings.cobranza", async () => {
  const r = await patch({ cobranza: { enabled: true, diasAntes: 5, bot: false } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(escrito.reminderSettings.cobranza.enabled, true);
  assert.equal(escrito.reminderSettings.cobranza.diasAntes, 5);
  assert.equal(escrito.reminderSettings.cobranza.bot, false);
});

test("un `cobranza` con forma inválida se rechaza con 400, no se guarda a medias", async () => {
  const r = await patch({ cobranza: "encendido" });
  assert.equal(r.status, 400);
  assert.equal(escrito, undefined, "no se escribió nada");
});

test("guardar `cobranza` NO pisa recordatorios, recall ni eventos", async () => {
  guardado = {
    enabled: true,
    offsets: [1440, 120],
    channel: "whatsapp",
    template: "Hola {paciente}",
    recall: { enabled: true, intervalDays: 90, channel: "whatsapp", message: "Vuelve {nombre}" },
    eventos: { alAgendar: true, alReprogramar: false, alCancelar: true },
  };
  await patch({ cobranza: { enabled: true, diasAntes: 3, bot: true } });
  const rs = escrito.reminderSettings;
  assert.deepEqual(rs.offsets, [1440, 120], "los recordatorios de cita siguen");
  assert.equal(getRecallSettings({ reminderSettings: rs }).intervalDays, 90, "el recall sigue");
  assert.deepEqual(
    getAppointmentEventSettings({ reminderSettings: rs }),
    { alAgendar: true, alReprogramar: false, alCancelar: true },
    "los avisos de cita siguen",
  );
  assert.equal(rs.cobranza.bot, true);
});

test("y al revés: guardar `eventos` NO borra la cobranza que ya había", async () => {
  // Éste es el que de verdad importa: el PATCH arma el Json de cero, así que
  // sin arrastrar `cobranza` la clínica se quedaría sin sus avisos de
  // mensualidad por tocar un interruptor de citas.
  guardado = { cobranza: { enabled: true, diasAntes: 7, bot: true } };
  await patch({ eventos: { alAgendar: true, alReprogramar: false, alCancelar: false } });
  const c = getCobranzaSettings({ reminderSettings: escrito.reminderSettings });
  assert.equal(c.enabled, true, "el aviso de mensualidad sobrevive");
  assert.equal(c.bot, true, "y el permiso del bot también");
  assert.equal(c.diasAntes, 7);
});

test("guardar los recordatorios de cita tampoco borra la cobranza", async () => {
  guardado = { cobranza: { enabled: true, diasAntes: 3, bot: false } };
  await patch({ reminderSettings: { enabled: true, offsets: [1440], channel: "whatsapp" } });
  assert.equal(
    getCobranzaSettings({ reminderSettings: escrito.reminderSettings }).enabled,
    true,
  );
});

test("guardar el recall tampoco", async () => {
  guardado = { cobranza: { enabled: true, diasAntes: 3, bot: true } };
  await patch({ recall: { enabled: true, intervalDays: 180, channel: "whatsapp", message: "x" } });
  assert.equal(getCobranzaSettings({ reminderSettings: escrito.reminderSettings }).bot, true);
});

test("`cobranza: null` apaga SOLO la cobranza y deja lo demás en pie", async () => {
  guardado = {
    enabled: true,
    offsets: [1440],
    channel: "whatsapp",
    cobranza: { enabled: true, diasAntes: 3, bot: true },
  };
  await patch({ cobranza: null });
  const rs = escrito.reminderSettings;
  assert.equal(rs.cobranza, undefined, "la cobranza se fue");
  assert.deepEqual(rs.offsets, [1440], "los recordatorios siguen");
  assert.equal(
    getCobranzaSettings({ reminderSettings: rs }).enabled,
    false,
    "y sin fila, vuelve al default apagado",
  );
});
