/**
 * DOS WALK-INS SEGUIDOS DEL MISMO DOCTOR — ws1-t4, vuelta 2 (fallo menor 2 de la pasada corta, 2-oct-2026).
 *
 * Run: npm run test:walk-in-dos-seguidos
 *
 * Tras «Completar» un walk-in, «Iniciar» el siguiente con el mismo doctor daba 409 `appointment_overlap`: la cita
 * completada seguía apartando el resto de su hueco, porque la constraint de la base (appt_doctor_no_overlap)
 * cuenta toda cita que no esté CANCELLED/NO_SHOW. Ahora «Completar» desde la fila termina la cita a la hora real.
 * El doble de Prisma aplica LA MISMA regla que la constraint (intervalo semiabierto [), sin CANCELLED/NO_SHOW ni
 * overrideReason). Con el código viejo la segunda «Iniciar» contesta 409.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const ctx: any = { userId: "u1", clinicId: "c1", role: "RECEPTIONIST", permissionsOverride: [] };
let filas: Record<string, any>;
let citas: any[];
let n = 0;

beforeEach(() => {
  filas = {
    w1: { id: "w1", clinicId: "c1", patientId: "p1", patientName: "Luis Uno", service: "Dolor", status: "ASSIGNED", assignedTo: "doc1", startedAt: null },
    w2: { id: "w2", clinicId: "c1", patientId: "p2", patientName: "Eva Dos", service: "Dolor", status: "ASSIGNED", assignedTo: "doc1", startedAt: null },
  };
  citas = [];
});

/** appt_doctor_no_overlap: EXCLUDE (doctorId, tstzrange(startsAt, endsAt, '[)')) WHERE status NOT IN (CANCELLED, NO_SHOW) AND overrideReason IS NULL. */
function chocaConLaConstraint(c: any): boolean {
  const ocupa = (x: any) => !["CANCELLED", "NO_SHOW"].includes(x.status) && !x.overrideReason;
  if (!ocupa(c)) return false;
  return citas.some((o) => o.id !== c.id && ocupa(o) && o.doctorId === c.doctorId && o.startsAt < c.endsAt && c.startsAt < o.endsAt);
}
const errorDeSolape = () => Object.assign(new Error('exclusion constraint "appt_doctor_no_overlap"'), { code: "23P01" });

const tx: any = {
  $executeRaw: async () => 1,
  $queryRaw: async () => [],
  walkInQueue: {
    updateMany: async (a: any) => {
      const f = filas[a.where.id];
      if (!f || f.clinicId !== a.where.clinicId || (a.where.status && !a.where.status.in.includes(f.status))) return { count: 0 };
      Object.assign(f, a.data);
      return { count: 1 };
    },
  },
  appointment: {
    create: async (a: any) => {
      const c = { id: `cita${++n}`, ...a.data };
      if (chocaConLaConstraint(c)) throw errorDeSolape();
      citas.push(c);
      return { id: c.id };
    },
    findFirst: async (a: any) => {
      const c = citas.find((x) =>
        x.clinicId === a.where.clinicId &&
        (a.where.id === undefined || x.id === a.where.id) &&
        (a.where.patientId === undefined || x.patientId === a.where.patientId) &&
        (a.where.startedAt === undefined || x.startedAt?.getTime() === a.where.startedAt.getTime()),
      );
      return c ? { id: c.id, startsAt: c.startsAt, endsAt: c.endsAt } : null;
    },
    updateMany: async (a: any) => {
      const c = citas.find((x) => x.id === a.where.id && x.clinicId === a.where.clinicId && a.where.status.in.includes(x.status));
      if (!c) return { count: 0 };
      const despues = { ...c, ...a.data };
      if (chocaConLaConstraint(despues)) throw errorDeSolape();
      Object.assign(c, a.data);
      return { count: 1 };
    },
  },
};

(mock as any).module("@/lib/auth-context", { namedExports: { getAuthContext: async () => ctx } });
(mock as any).module("@/lib/audit", { namedExports: { logMutation: async () => {} } });
(mock as any).module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => {} } });
(mock as any).module("@/lib/reviews/invite", { namedExports: { sendReviewInvitation: async () => {} } });
(mock as any).module("@/lib/patient-visibility", {
  namedExports: { assertPatientVisible: async () => null, ensureUserCanSeePatient: async () => null },
});
(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      $executeRaw: async () => 1,
      $transaction: async (fn: any) => {
        const respaldo = { filas: structuredClone(filas), citas: citas.map((c) => ({ ...c })) };
        try { return await fn(tx); } catch (e) { filas = respaldo.filas; citas = respaldo.citas; throw e; }
      },
      user: { findFirst: async (a: any) => (a.where.id === "doc1" && a.where.clinicId === "c1" ? { id: "doc1", role: "DOCTOR", isActive: true, agendaActive: true } : null) },
      clinic: { findFirst: async () => ({ category: "DENTAL", defaultSlotMinutes: 15 }) },
      walkInQueue: {
        findFirst: async (a: any) => {
          const f = filas[a.where.id];
          return f && f.clinicId === a.where.clinicId ? { ...f } : null;
        },
        updateMany: (a: any) => tx.walkInQueue.updateMany(a),
      },
    },
  },
});

const req = (body?: any) => ({ json: async () => body }) as any;
const de = (id: string) => ({ params: { id } });

test("Iniciar → Completar → Iniciar el siguiente con el MISMO doctor: entra, sin 409", async () => {
  const { PATCH } = await import("@/app/api/walk-in/[id]/route");
  assert.equal((await PATCH(req({ action: "start" }), de("w1"))).status, 200);
  assert.equal((await PATCH(req({ action: "complete" }), de("w1"))).status, 200);
  const r = await PATCH(req({ action: "start" }), de("w2"));
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.equal(filas.w2.status, "IN_PROGRESS");
  assert.equal(citas.length, 2);
  assert.equal(citas[1].doctorId, "doc1");
});

test("la cita completada desde la fila termina a la hora real (no antes de empezar, no después de su fin)", async () => {
  const { PATCH } = await import("@/app/api/walk-in/[id]/route");
  await PATCH(req({ action: "start" }), de("w1"));
  const finPlaneado = citas[0].endsAt.getTime();
  const antes = Date.now();
  await PATCH(req({ action: "complete" }), de("w1"));
  const c = citas[0];
  assert.equal(c.status, "COMPLETED");
  assert.ok(c.endsAt.getTime() >= antes && c.endsAt.getTime() < finPlaneado, "endsAt = ahora");
  assert.ok(c.endsAt.getTime() >= c.startsAt.getTime());
  assert.equal(c.endsAt.getTime(), c.completedAt.getTime());
});

test("sin completar, el mismo doctor sigue ocupado: la segunda «Iniciar» da 409 y no mueve la fila", async () => {
  const { PATCH } = await import("@/app/api/walk-in/[id]/route");
  await PATCH(req({ action: "start" }), de("w1"));
  const r = await PATCH(req({ action: "start" }), de("w2"));
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, "appointment_overlap");
  assert.equal(filas.w2.status, "ASSIGNED");
  assert.equal(citas.length, 1);
});
