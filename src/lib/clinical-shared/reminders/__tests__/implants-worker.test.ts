/**
 * Cron de recordatorios de implantes (ws1-t1, 3-oct-2026): programado en vercel.json y seguro de encender.
 *
 * Run: npm run test:implants-reminders
 *
 * La ruta existía pero no estaba en vercel.json, así que nunca corría. Tal cual habría encolado el atraso entero
 * (que la cola expira a los 7 días y quedaba «enviado» sin salir) y, sin reclamo ni transacción, podía encolar
 * dos veces el mismo aviso. Con el código viejo el worker no existe y vercel.json no lista la ruta.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const AHORA = new Date("2026-10-03T12:15:00.000Z");
let recordatorios: any[];
let mensajes: any[];
let wheres: any[];
let fallarCrear: boolean;

beforeEach(() => {
  recordatorios = [
    { id: "r1", clinicId: "c1", reminderType: "implant_cicatrizacion_7d", status: "pending", dueDate: new Date("2026-10-03T15:00:00.000Z"), payload: { toothFdi: 36 }, patient: { firstName: "Ana", phone: "5215550000001" } },
    { id: "r2", clinicId: "c2", reminderType: "implant_control_anual", status: "pending", dueDate: new Date("2026-10-01T15:00:00.000Z"), payload: null, patient: { firstName: "Beto", phone: "5215550000002" } },
  ];
  mensajes = [];
  wheres = [];
  fallarCrear = false;
});

const tx: any = {
  clinicalReminder: {
    updateMany: async (a: any) => {
      assert.ok(a.where.clinicId, "toda escritura lleva la clínica del recordatorio");
      const r = recordatorios.find((x) => x.id === a.where.id && x.clinicId === a.where.clinicId && (!a.where.status || x.status === a.where.status));
      if (!r) return { count: 0 };
      Object.assign(r, a.data);
      return { count: 1 };
    },
  },
  whatsAppReminder: {
    create: async (a: any) => {
      if (fallarCrear) throw new Error("fallo de red");
      mensajes.push(a.data);
      return { id: `wa-${mensajes.length}` };
    },
  },
};

(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      clinicalReminder: {
        findMany: async (a: any) => {
          wheres.push(a);
          // La lectura devuelve lo que había al empezar (dos corridas pueden leer lo mismo).
          return recordatorios.map((r) => ({ ...r, status: "pending" }));
        },
      },
      $transaction: async (fn: any) => {
        const respaldo = { r: recordatorios.map((x) => ({ ...x })), m: [...mensajes] };
        try { return await fn(tx); } catch (e) { recordatorios = respaldo.r; mensajes = respaldo.m; throw e; }
      },
    },
  },
});

test("la consulta filtra lo que se puede mandar: ventana [−7 días, +24 h], tipos con plantilla, clínica con recordatorios y WhatsApp, paciente vivo con teléfono, por fecha", async () => {
  const { processImplantReminders } = await import("@/lib/clinical-shared/reminders/implants-worker");
  await processImplantReminders({ now: AHORA });
  const { where, orderBy } = wheres[0];
  assert.equal(where.module, "implants");
  assert.equal(where.status, "pending");
  assert.equal(where.deletedAt, null);
  assert.equal(where.dueDate.gte.toISOString(), "2026-09-26T12:15:00.000Z", "nada con más de 7 días de atraso (la cola lo expiraría)");
  assert.equal(where.dueDate.lte.toISOString(), "2026-10-04T12:15:00.000Z");
  assert.deepEqual([...where.reminderType.in].sort(), [
    "implant_cicatrizacion_7d", "implant_control_anual", "implant_oseointegracion_4m", "implant_peri_implantitis_6m", "implant_retiro_sutura_10d",
  ]);
  assert.deepEqual(where.clinic, { waReminderActive: true, waConnected: true });
  assert.deepEqual(where.patient, { deletedAt: null, phone: { not: null } });
  assert.deepEqual(orderBy, { dueDate: "asc" });
});

test("encola un mensaje por recordatorio, a su hora, y marca el recordatorio enviado con su liga", async () => {
  const { processImplantReminders } = await import("@/lib/clinical-shared/reminders/implants-worker");
  const r = await processImplantReminders({ now: AHORA });
  assert.equal(r.enqueued, 2);
  assert.equal(mensajes.length, 2);
  assert.equal(mensajes[0].clinicId, "c1");
  assert.equal(mensajes[0].type, "IMPLANT");
  assert.equal(mensajes[0].scheduledFor.toISOString(), "2026-10-03T15:00:00.000Z");
  assert.match(mensajes[0].message, /Ana/);
  assert.match(mensajes[0].message, /36/);
  assert.equal(mensajes[0].payload.sourceClinicalReminderId, "r1");
  assert.equal(recordatorios[0].status, "sent");
  assert.equal(recordatorios[0].whatsappReminderId, "wa-1");
});

test("dos corridas seguidas (o a la vez) no encolan dos veces el mismo aviso", async () => {
  const { processImplantReminders } = await import("@/lib/clinical-shared/reminders/implants-worker");
  await processImplantReminders({ now: AHORA });
  const segunda = await processImplantReminders({ now: AHORA });
  assert.equal(segunda.enqueued, 0);
  assert.equal(segunda.alreadyTaken, 2);
  assert.equal(mensajes.length, 2);
});

test("si crear el mensaje falla, el recordatorio sigue pendiente (se intenta mañana) y no queda nada a medias", async () => {
  const { processImplantReminders } = await import("@/lib/clinical-shared/reminders/implants-worker");
  fallarCrear = true;
  const r = await processImplantReminders({ now: AHORA });
  assert.equal(r.errors, 2);
  assert.equal(mensajes.length, 0);
  assert.ok(recordatorios.every((x) => x.status === "pending"));
});

test("vercel.json programa la ruta una vez al día y la ruta usa el worker", () => {
  const v = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8"));
  const c = v.crons.filter((x: any) => x.path === "/api/cron/implants-reminders");
  assert.equal(c.length, 1);
  assert.match(c[0].schedule, /^\d+ \d+ \* \* \*$/);
  const ruta = readFileSync(join(process.cwd(), "src/app/api/cron/implants-reminders/route.ts"), "utf8");
  assert.match(ruta, /processImplantReminders\(\)/);
  assert.match(ruta, /Bearer \$\{process\.env\.CRON_SECRET\}/);
});
