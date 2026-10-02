/**
 * «INICIAR» EN LA FILA DE WALK-IN CREA LA CITA DEL MOMENTO — ws1-t4, decisión 8 (Rafael, 2-oct-2026).
 *
 * Run: npm run test:walk-in-iniciar-cita
 *
 * «Asignar» solo marca. «Iniciar» crea la cita de hoy, ahora, con el profesional asignado y en consulta
 * (IN_PROGRESS), ligada a la fila, sin avisos al paciente; sin profesional pide elegir uno. Con el código viejo
 * «Iniciar» solo cambiaba el estado de la fila: ninguna de estas pruebas pasa.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ctx: any = { userId: "u1", clinicId: "c1", role: "RECEPTIONIST", permissionsOverride: [] };
let fila: any;
let citas: any[];
let pacientes: any[];
let errorAlCrearCita: any;
let wheresUser: any[];

beforeEach(() => {
  fila = { id: "w1", clinicId: "c1", patientId: null, patientName: "Ana María López", service: "Dolor de muela", status: "WAITING", assignedTo: null, startedAt: null };
  citas = [];
  pacientes = [];
  errorAlCrearCita = null;
  wheresUser = [];
});

(mock as any).module("@/lib/auth-context", { namedExports: { getAuthContext: async () => ctx } });
(mock as any).module("@/lib/audit", { namedExports: { logMutation: async () => {} } });
(mock as any).module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => {} } });
(mock as any).module("@/lib/patient-visibility", {
  namedExports: { assertPatientVisible: async () => null, ensureUserCanSeePatient: async () => null },
});

const tx: any = {
  $executeRaw: async () => 1,
  $queryRaw: async () => [{ max: null }],
  walkInQueue: {
    updateMany: async (a: any) => {
      assert.equal(a.where.clinicId, "c1");
      if (a.where.status && !a.where.status.in.includes(fila.status)) return { count: 0 };
      Object.assign(fila, a.data);
      return { count: 1 };
    },
  },
  patient: {
    create: async (a: any) => { assert.equal(a.data.clinicId, "c1"); pacientes.push(a.data); return { id: "p-nuevo" }; },
  },
  appointment: {
    create: async (a: any) => {
      if (errorAlCrearCita) throw errorAlCrearCita;
      citas.push(a.data);
      return { id: "cita1" };
    },
  },
};

(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      $executeRaw: async () => 1,
      // Como la base: si algo falla dentro, la fila y la lista de citas vuelven a como estaban.
      $transaction: async (fn: any) => {
        const respaldo = { fila: { ...fila }, citas: [...citas], pacientes: [...pacientes] };
        try { return await fn(tx); } catch (e) { fila = respaldo.fila; citas = respaldo.citas; pacientes = respaldo.pacientes; throw e; }
      },
      user: {
        findFirst: async (a: any) => {
          wheresUser.push(a.where);
          return a.where.id === "doc1" && a.where.clinicId === "c1" ? { id: "doc1" } : null;
        },
      },
      clinic: { findFirst: async () => ({ category: "DENTAL", defaultSlotMinutes: 20 }) },
      walkInQueue: {
        findFirst: async (a: any) => (a.where.id === fila.id && a.where.clinicId === fila.clinicId ? { ...fila } : null),
        updateMany: async (a: any) => {
          if (a.where.status && !a.where.status.in.includes(fila.status)) return { count: 0 };
          Object.assign(fila, a.data);
          return { count: 1 };
        },
      },
    },
  },
});

const req = (body?: any) => ({ json: async () => body }) as any;
const idp = { params: { id: "w1" } };

test("sin profesional asignado: no inicia, pide elegir uno y no crea nada", async () => {
  const { PATCH } = await import("@/app/api/walk-in/[id]/route");
  const r = await PATCH(req({ action: "start" }), idp);
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, "assignedTo_required");
  assert.equal(citas.length, 0);
  assert.equal(fila.status, "WAITING");
});

test("«Asignar» solo marca: no crea cita", async () => {
  const { PATCH } = await import("@/app/api/walk-in/[id]/route");
  const r = await PATCH(req({ action: "assign", assignedTo: "doc1" }), idp);
  assert.equal(r.status, 200);
  assert.equal(fila.status, "ASSIGNED");
  assert.equal(citas.length, 0);
  assert.equal(pacientes.length, 0);
});

test("«Iniciar» con profesional asignado: cita de hoy, ahora, en consulta, con ese profesional y la clínica de la sesión", async () => {
  const { PATCH } = await import("@/app/api/walk-in/[id]/route");
  fila.status = "ASSIGNED";
  fila.assignedTo = "doc1";
  const antes = Date.now();
  const r = await PATCH(req({ action: "start" }), idp);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.status, "IN_PROGRESS");
  assert.equal(citas.length, 1);
  const c = citas[0];
  assert.equal(c.clinicId, "c1");
  assert.equal(c.doctorId, "doc1");
  assert.equal(c.status, "IN_PROGRESS");
  assert.equal(c.type, "Dolor de muela");
  assert.equal(c.source, "STAFF");
  assert.equal(c.requiresValidation, false);
  assert.ok(Math.abs(c.startsAt.getTime() - antes) < 5000, "empieza ahora");
  assert.equal(c.endsAt.getTime() - c.startsAt.getTime(), 20 * 60_000, "dura el hueco de la clínica");
  assert.ok(c.startedAt && c.checkedInAt);
  // La fila queda ligada al paciente de la cita.
  assert.equal(fila.patientId, "p-nuevo");
  assert.equal(c.patientId, "p-nuevo");
});

test("la fila sin paciente da de alta uno con ese nombre; con paciente, lo reutiliza", async () => {
  const { PATCH } = await import("@/app/api/walk-in/[id]/route");
  const r = await PATCH(req({ action: "start", assignedTo: "doc1" }), idp);
  assert.equal(r.status, 200);
  assert.equal(pacientes.length, 1);
  assert.equal(pacientes[0].firstName, "Ana");
  assert.equal(pacientes[0].lastName, "María López");
  assert.equal(pacientes[0].clinicId, "c1");

  fila.status = "WAITING"; fila.patientId = "p-viejo"; citas = []; pacientes = [];
  assert.equal((await PATCH(req({ action: "start", assignedTo: "doc1" }), idp)).status, 200);
  assert.equal(pacientes.length, 0);
  assert.equal(citas[0].patientId, "p-viejo");
});

test("el profesional elegido al iniciar manda sobre el asignado antes; ajeno o que no recibe citas: 404 y nada se escribe", async () => {
  const { PATCH } = await import("@/app/api/walk-in/[id]/route");
  const r = await PATCH(req({ action: "start", assignedTo: "recepcion-o-ajeno" }), idp);
  assert.equal(r.status, 404);
  assert.equal(citas.length, 0);
  assert.equal(fila.status, "WAITING");
  assert.equal(wheresUser[0].clinicId, "c1");
  assert.deepEqual(wheresUser[0].role.in, ["DOCTOR", "ADMIN", "SUPER_ADMIN"]);
});

test("el profesional ya tiene una cita encima: 409 con motivo, la fila sigue esperando y no queda cita ni paciente a medias", async () => {
  const { PATCH } = await import("@/app/api/walk-in/[id]/route");
  errorAlCrearCita = Object.assign(new Error('exclusion constraint "appointments_no_overlap"'), { code: "23P01" });
  const r = await PATCH(req({ action: "start", assignedTo: "doc1" }), idp);
  assert.equal(r.status, 409);
  const j = await r.json();
  assert.equal(j.error, "appointment_overlap");
  assert.ok(typeof j.reason === "string" && j.reason.length > 10);
  assert.equal(fila.status, "WAITING");
  assert.equal(fila.startedAt, null);
  assert.equal(citas.length, 0);
  assert.equal(pacientes.length, 0);
});

test("dos «Iniciar» a la vez o repetido: una sola cita", async () => {
  const { PATCH } = await import("@/app/api/walk-in/[id]/route");
  assert.equal((await PATCH(req({ action: "start", assignedTo: "doc1" }), idp)).status, 200);
  assert.equal((await PATCH(req({ action: "start", assignedTo: "doc1" }), idp)).status, 409);
  assert.equal(citas.length, 1);
});

test("sin avisos al paciente: el módulo no toca WhatsApp ni recordatorios", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/walk-in/iniciar-consulta.ts"), "utf8");
  const imports = src.split("\n").filter((l) => l.startsWith("import")).join("\n");
  assert.doesNotMatch(imports, /whatsapp|reminder|aviso/i);
  assert.doesNotMatch(src, /notifyPatient|avisarCita/);
});

test("la pantalla pide profesional al iniciar sin uno y reutiliza el selector de «Asignar»", () => {
  const cliente = readFileSync(join(process.cwd(), "src/app/dashboard/walk-in/walk-in-client.tsx"), "utf8");
  assert.match(cliente, /action === "start" && !assignedTo && !queue\.find/);
  assert.match(cliente, /iniciarAlElegir === id/);
});

test("la tarjeta de Hoy lee la fila de walk-in (de hoy, esperando), no la lista de espera de citas", () => {
  const api = readFileSync(join(process.cwd(), "src/app/api/dashboard/home/receptionist/route.ts"), "utf8");
  assert.match(api, /prisma\.walkInQueue\.findMany/);
  assert.doesNotMatch(api, /prisma\.waitlistEntry/);
  assert.match(api, /clinicId: session\.clinic\.id,\s*status: \{ in: \["WAITING", "ASSIGNED"\] \}/);
});
