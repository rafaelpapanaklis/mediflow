/**
 * ws1-t11 · fase 2 · P1 — mover una cita «Sin doctor» con recordatorios activos no tumba la transacción
 * (antes: `appt.doctor.firstName` con doctor null → TypeError → el PATCH se deshacía con 500).
 * El texto sin doctor (quitar la línea de {doctor}) es de P3; aquí solo que se re-encola sin reventar.
 *
 * Run: npm run test:cita-sin-doctor
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

const M = Module as unknown as { _load: (req: string, parent: unknown, isMain: boolean) => unknown };
const cargaOriginal = M._load;
M._load = function (req, parent, isMain) {
  if (req === "server-only") return {};
  return cargaOriginal.call(this, req, parent, isMain);
};

function txDe(doctor: { firstName: string; lastName: string } | null) {
  const creados: any[] = [];
  const tx: any = {
    appointment: {
      findFirst: async () => ({
        id: "cmh0cita0001", confirmToken: "tok-1", patientId: "p1",
        patient: { firstName: "Ana", phone: "+52 999 123 4567", email: null }, doctor,
      }),
      updateMany: async () => ({ count: 1 }),
      findUnique: async () => ({ confirmToken: "tok-1" }),
    },
    clinic: {
      findUnique: async () => ({
        name: "Centro Dental QA", timezone: "America/Mexico_City", reminderSettings: null,
        waReminderActive: true, waReminder24h: true, waReminder1h: true, waReminderMsg: null,
      }),
    },
    whatsAppReminder: { findMany: async () => [], updateMany: async () => ({ count: 0 }), createMany: async ({ data }: any) => { creados.push(...data); return { count: data.length }; } },
    patientAccountLink: { findFirst: async () => null },
  };
  return { tx, creados };
}

test("reagendar una «Sin doctor» re-encola sus recordatorios sin reventar (y sin «Dr/a. undefined»)", async () => {
  const { applyReminderReschedule } = await import("../reschedule.server");
  const { tx, creados } = txDe(null);
  const r = await applyReminderReschedule(tx, { appointmentId: "cmh0cita0001", clinicId: "c1", newStartsAt: new Date(Date.now() + 3 * 86_400_000) });
  assert.ok(r.created > 0, JSON.stringify(r));
  for (const c of creados) assert.doesNotMatch(c.message, /undefined|null|Dr\/a\. *$/m);
});

test("con doctor, el texto sigue llevando su nombre (sin cambios)", async () => {
  const { applyReminderReschedule } = await import("../reschedule.server");
  const { tx, creados } = txDe({ firstName: "Luis", lastName: "Ruiz" });
  await applyReminderReschedule(tx, { appointmentId: "cmh0cita0001", clinicId: "c1", newStartsAt: new Date(Date.now() + 3 * 86_400_000) });
  assert.ok(creados.length > 0);
  assert.match(creados[0].message, /Dr\/a\. Luis Ruiz/);
});
