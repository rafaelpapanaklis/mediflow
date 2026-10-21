/**
 * «PEDIR ANTICIPO» DE UNA CITA DEL PLAN — ws1-t1 (plan de tratamiento, fase 2 · P8).
 *
 * Run: npm run test:plan-citas
 *
 * El HANDLER REAL de `POST /api/appointments/[id]/anticipo` con dobles. Una cita con filas del plan
 * («Agendar lo pendiente») se cobra en la nota del plan: pedir aquí un anticipo crearía la factura
 * propia de la cita con su concepto (cobro doble). Fija: 409 `cita_del_plan` sin crear nada; una
 * cita sin filas pide el anticipo como siempre.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let filasDeLaCita: Array<{ id: string }>;
let pedidos: any[];
let preguntasPorCita: Array<{ clinicId: string; appointmentId: string }>;

beforeEach(() => {
  filasDeLaCita = [];
  pedidos = [];
  preguntasPorCita = [];
});

(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      appointment: {
        findFirst: async ({ where }: any) =>
          where.id === "a1" && where.clinicId === "c1"
            ? { id: "a1", patientId: "p1", startsAt: new Date(Date.now() + 86_400_000), status: "SCHEDULED", type: "Plan: Limpieza" }
            : null,
      },
    },
  },
});
(mock as any).module("@/lib/auth-context", {
  namedExports: { getAuthContext: async () => ({ clinicId: "c1", userId: "u1", role: "RECEPTIONIST", permissionsOverride: [] }) },
});
(mock as any).module("@/lib/rate-limit", { namedExports: { rateLimit: () => null } });
(mock as any).module("@/lib/auth/require-permission", { namedExports: { denyIfMissingPermission: () => null } });
(mock as any).module("@/lib/patient-visibility", { namedExports: { assertPatientVisible: async () => null } });
(mock as any).module("@/lib/treatments/citas-del-plan-db", {
  namedExports: {
    filasAgendadasEnCita: async (clinicId: string, appointmentId: string) => {
      preguntasPorCita.push({ clinicId, appointmentId });
      return filasDeLaCita;
    },
  },
});
(mock as any).module("@/lib/anticipos/panel.server", {
  namedExports: {
    canalesAnticipoPanel: async () => ({}),
    estadoAnticipoDeFactura: async () => null,
    sugeridoParaFactura: () => 0,
    pedirAnticipoDeCita: async (args: any) => {
      pedidos.push(args);
      return { ok: false, error: "doble: no se llega aquí en esta prueba", status: 400 };
    },
  },
});

async function post(id: string, body: unknown) {
  const { POST } = await import("@/app/api/appointments/[id]/anticipo/route");
  const req = {
    json: async () => body,
    headers: new Headers(),
    nextUrl: new URL(`http://localhost/api/appointments/${id}/anticipo`),
    url: `http://localhost/api/appointments/${id}/anticipo`,
  } as any;
  const res = await POST(req, { params: Promise.resolve({ id }) });
  return { status: res.status, body: await res.json() };
}

test("cita con filas del plan → 409 «cita_del_plan» y no se pide (ni se factura) nada", async () => {
  filasDeLaCita = [{ id: "f1" }];
  const r = await post("a1", { monto: 500 });
  assert.equal(r.status, 409);
  assert.equal(r.body.codigo, "cita_del_plan");
  assert.match(r.body.error, /nota del plan/);
  assert.equal(pedidos.length, 0);
  assert.deepEqual(preguntasPorCita, [{ clinicId: "c1", appointmentId: "a1" }], "pregunta con la clínica de la SESIÓN");
});

test("cita sin filas del plan → sigue al anticipo de siempre", async () => {
  await post("a1", { monto: 500 });
  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0].appointmentId, "a1");
  assert.equal(pedidos[0].clinicId, "c1");
});

test("cita de otra clínica → 404 antes de preguntar por el plan", async () => {
  const r = await post("a-ajena", { monto: 500 });
  assert.equal(r.status, 404);
  assert.equal(preguntasPorCita.length, 0);
});
