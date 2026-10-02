/**
 * ws1-t8 — decisión 6 de Rafael (2-oct): el paciente de una cita FUTURA llega HOY.
 *
 * Al marcar su llegada (POST /check-in o PATCH /status a «Llegó», «En sillón» o «En consulta») la cita se MUEVE
 * A HOY: empieza ahora, dura lo mismo y conserva su doctor. Sin aviso de «cita reprogramada» al paciente, los
 * recordatorios de la fecha vieja se cancelan, queda en Movimientos y Google Calendar se pone al día. Si a esta
 * hora el sillón está ocupado la cita queda sin sillón; si el doctor tiene otra cita encima entra como
 * sobreturno con el motivo escrito. Con el código viejo la cita se quedaba en su día futuro (los casos de
 * «se mueve» fallan: el UPDATE no traía startsAt).
 *
 * Llama a los HANDLERS REALES con `mock.module` sobre prisma, la sesión, WhatsApp, Google, recordatorios y
 * movimientos: ⛔ no sale ningún mensaje ni se toca ninguna base.
 * Run: npm run test:cita-futura-llega-hoy
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const TZ = "America/Mexico_City";
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

let existente: any;
/** Lo que `updateMany` (PATCH /status) o `update` (check-in) escribió en la cita. */
let escrito: any;
let avisosWhatsApp: any[];
let llamadasGoogle: string[];
let recordatoriosCancelados: any[];
let movimientos: any[];
/** Citas que ya ocupan la agenda (para los choques de doctor y sillón). */
let otrasCitas: any[];

beforeEach(() => {
  escrito = null;
  avisosWhatsApp = [];
  llamadasGoogle = [];
  recordatoriosCancelados = [];
  movimientos = [];
  otrasCitas = [];
  // Mañana pasado, 10:00-10:45 (45 min), con el sillón r1.
  const inicio = new Date(Math.floor((Date.now() + 2 * DAY) / MIN) * MIN);
  existente = {
    id: "a1",
    clinicId: "c1",
    patientId: "p1",
    doctorId: "d1",
    resourceId: "r1",
    overrideReason: null,
    status: "SCHEDULED",
    startsAt: inicio,
    endsAt: new Date(inicio.getTime() + 45 * MIN),
  };
});

function choca(c: any, where: any): boolean {
  if (where.clinicId !== "c1" || c.id === where.id?.not) return false;
  if (where.doctorId && c.doctorId !== where.doctorId) return false;
  if (where.resourceId && c.resourceId !== where.resourceId) return false;
  if (where.status?.notIn?.includes(c.status)) return false;
  return c.startsAt < where.startsAt.lt && c.endsAt > where.endsAt.gt;
}

const prismaStub: any = {
  appointmentTimeline: { findUnique: async () => null, upsert: async () => undefined },
  appointment: {
    findFirst: async ({ where }: any) => {
      // Los choques de agenda del adelanto: `id: { not }` + rango.
      if (where?.id?.not) {
        const c = otrasCitas.find((x) => choca(x, where));
        return c ? { id: c.id, startsAt: c.startsAt, patient: { firstName: "Otro", lastName: "Paciente" } } : null;
      }
      assert.equal(where.clinicId, "c1", "la cita se lee SIEMPRE con el clinicId de la sesión");
      return existente;
    },
  },
  $transaction: async (fn: any) =>
    fn({
      appointment: {
        updateMany: async ({ where, data }: any) => {
          assert.equal(where.clinicId, "c1");
          escrito = data;
          return { count: 1 };
        },
        update: async ({ data }: any) => {
          escrito = data;
          return { ...existente, ...data };
        },
        findFirst: async () => ({
          ...existente,
          ...(escrito ?? {}),
          patient: { id: "p1", firstName: "Ana", lastName: "García" },
          doctor: { id: "d1", firstName: "Luis", lastName: "Ruiz" },
        }),
      },
    }),
};

const session = {
  user: { id: "d1", role: "DOCTOR", clinicId: "c1", displayName: "Dr. Ruiz", permissionsOverride: [] },
  clinic: { id: "c1", name: "Clínica QA", category: "DENTAL", timezone: TZ, defaultSlotMinutes: 30, schedules: [] },
};

(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
(mock as any).module("@/lib/agenda/api-helpers", {
  namedExports: { loadClinicSession: async () => session, requireRole: () => null },
});
(mock as any).module("@/lib/auth/require-permission", { namedExports: { denyIfMissingPermission: () => null } });
(mock as any).module("@/lib/agenda/server", {
  namedExports: { appointmentToDTO: (a: any) => ({ id: a.id, status: a.status, startsAt: a.startsAt }) },
});
(mock as any).module("@/lib/patient-visibility", { namedExports: { assertPatientVisible: async () => null } });
(mock as any).module("@/lib/reviews/invite", { namedExports: { sendReviewInvitation: async () => undefined } });
(mock as any).module("@/lib/cache/revalidate", {
  namedExports: { revalidateAfter: () => undefined, revalidatePatientProfile: () => undefined },
});
// ⛔ WhatsApp es un doble: solo apunta.
(mock as any).module("@/lib/whatsapp/avisos-cita", {
  namedExports: {
    avisarCitaPorWhatsApp: async (args: any) => {
      avisosWhatsApp.push(args);
      return { enviado: false, motivo: "doble" };
    },
  },
});
(mock as any).module("@/lib/anticipos/cita-cancelada.server", {
  namedExports: { decidirDineroDeCitaCancelada: async () => ({ ok: true }), dineroDeLaCita: async () => null },
});
(mock as any).module("@/lib/agenda/google-sync", {
  namedExports: {
    sincronizarCitaEnSegundoPlano: async (_c: string, id: string) => {
      llamadasGoogle.push(id);
    },
  },
});
(mock as any).module("@/lib/reminders/reschedule.server", {
  namedExports: {
    cancelPendingRemindersForAppointment: async (_tx: any, args: any) => {
      recordatoriosCancelados.push(args);
      return 1;
    },
  },
});
(mock as any).module("@/lib/movimientos-paciente/registrar", {
  namedExports: {
    registrarMovimientoDelPaciente: async (m: any) => {
      movimientos.push(m);
    },
  },
});
(mock as any).module("@/lib/movimientos-paciente/zona", { namedExports: { zonaDeClinica: async () => TZ } });

const req = (body: unknown) =>
  new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function patchStatus(status: string) {
  const { PATCH } = await import("@/app/api/appointments/[id]/status/route");
  return PATCH(req({ status }) as any, { params: { id: "a1" } });
}

function ahoraAlMinuto(): number {
  return Math.floor(Date.now() / MIN) * MIN;
}

test("«En consulta» de una cita de pasado mañana la trae a HOY: empieza ahora, misma duración y doctor", async () => {
  const antes = existente.startsAt;
  const res = await patchStatus("IN_PROGRESS");
  assert.equal(res.status, 200);
  assert.ok(escrito.startsAt instanceof Date, "el mismo UPDATE del estado mueve la cita");
  assert.ok(Math.abs(escrito.startsAt.getTime() - ahoraAlMinuto()) <= MIN, "empieza ahora");
  assert.equal(escrito.endsAt.getTime() - escrito.startsAt.getTime(), 45 * MIN, "conserva la duración");
  assert.equal(escrito.doctorId, undefined, "el doctor no cambia");
  assert.equal(escrito.status, "IN_PROGRESS");
  // Sin aviso al paciente, recordatorios de la fecha vieja cancelados, Google al día, y en Movimientos.
  assert.equal(avisosWhatsApp.length, 0, "no se manda «cita reprogramada»");
  assert.equal(recordatoriosCancelados.length, 1);
  assert.match(recordatoriosCancelados[0].reason, /adelantó a hoy/);
  assert.deepEqual(llamadasGoogle, ["a1"]);
  const mov = movimientos.find((m) => /Adelantó a hoy/.test(m.texto ?? ""));
  assert.ok(mov, "queda en Movimientos");
  assert.equal(mov.cambios.startsAt.before, antes);
  const cuerpo = await res.json();
  assert.equal(cuerpo.adelantada.de, antes.toISOString());
  assert.equal(cuerpo.adelantada.sinSillon, false);
});

test("«Llegó» (PATCH /status) también la trae a hoy", async () => {
  session.user.role = "RECEPTIONIST";
  try {
    const res = await patchStatus("CHECKED_IN");
    assert.equal(res.status, 200);
    assert.ok(escrito.startsAt instanceof Date);
    assert.ok(Math.abs(escrito.startsAt.getTime() - ahoraAlMinuto()) <= MIN);
  } finally {
    session.user.role = "DOCTOR";
  }
});

test("POST /check-in de una cita futura la trae a hoy, sin aviso y con Google y Movimientos", async () => {
  session.user.role = "RECEPTIONIST";
  try {
    const { POST } = await import("@/app/api/appointments/[id]/check-in/route");
    const res = await POST(req({}) as any, { params: { id: "a1" } });
    assert.equal(res.status, 200);
    assert.equal(escrito.status, "CHECKED_IN");
    assert.ok(escrito.startsAt instanceof Date, "el check-in mueve la cita");
    assert.equal(escrito.endsAt.getTime() - escrito.startsAt.getTime(), 45 * MIN);
    assert.equal(avisosWhatsApp.length, 0);
    assert.equal(recordatoriosCancelados.length, 1);
    assert.deepEqual(llamadasGoogle, ["a1"]);
    assert.ok(movimientos.some((m) => /Adelantó a hoy/.test(m.texto ?? "")));
    assert.ok((await res.json()).adelantada);
  } finally {
    session.user.role = "DOCTOR";
  }
});

test("una cita de HOY no se mueve (ni avisa, ni toca recordatorios)", async () => {
  const inicio = new Date(ahoraAlMinuto());
  existente = { ...existente, startsAt: inicio, endsAt: new Date(inicio.getTime() + 30 * MIN) };
  const res = await patchStatus("IN_PROGRESS");
  assert.equal(res.status, 200);
  assert.equal(escrito.startsAt, undefined);
  assert.equal(recordatoriosCancelados.length, 0);
  assert.equal((await res.json()).adelantada, null);
});

test("confirmar o cancelar una cita futura NO la mueve (no es una llegada)", async () => {
  session.user.role = "RECEPTIONIST";
  try {
    await patchStatus("CONFIRMED");
    assert.equal(escrito.startsAt, undefined);
    await patchStatus("CANCELLED");
    assert.equal(escrito.startsAt, undefined);
  } finally {
    session.user.role = "DOCTOR";
  }
});

test("sillón ocupado a esta hora: la cita queda sin sillón y se avisa", async () => {
  const ahora = ahoraAlMinuto();
  otrasCitas = [
    { id: "b1", doctorId: "d2", resourceId: "r1", status: "IN_PROGRESS", startsAt: new Date(ahora - 10 * MIN), endsAt: new Date(ahora + 20 * MIN) },
  ];
  const res = await patchStatus("IN_PROGRESS");
  assert.equal(res.status, 200);
  assert.equal(escrito.resourceId, null);
  assert.equal(escrito.overrideReason, undefined, "el doctor está libre: no hay sobreturno");
  assert.equal((await res.json()).adelantada.sinSillon, true);
});

test("el doctor tiene otra cita encima: entra como sobreturno con el motivo escrito, sin bloquear la llegada", async () => {
  const ahora = ahoraAlMinuto();
  otrasCitas = [
    { id: "b2", doctorId: "d1", resourceId: "r9", status: "SCHEDULED", startsAt: new Date(ahora + 15 * MIN), endsAt: new Date(ahora + 45 * MIN) },
  ];
  const res = await patchStatus("IN_PROGRESS");
  assert.equal(res.status, 200);
  assert.match(escrito.overrideReason, /^Adelantada a hoy: el paciente llegó antes de su cita del /);
  assert.equal(escrito.overriddenBy, "d1");
  assert.ok(escrito.overrideReason.length <= 500, "cabe en VarChar(500)");
  assert.equal(escrito.resourceId, undefined, "el sillón sigue libre");
  const cuerpo = await res.json();
  assert.equal(cuerpo.adelantada.seCruzaCon.paciente, "Otro Paciente");
});

test("una cita de un día PASADO no se mueve", async () => {
  const inicio = new Date(ahoraAlMinuto() - 2 * DAY);
  existente = { ...existente, status: "CHECKED_IN", startsAt: inicio, endsAt: new Date(inicio.getTime() + 30 * MIN) };
  const res = await patchStatus("IN_PROGRESS");
  assert.equal(res.status, 200);
  assert.equal(escrito.startsAt, undefined);
});
