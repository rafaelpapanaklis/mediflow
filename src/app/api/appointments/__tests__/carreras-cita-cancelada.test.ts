/**
 * WS1-T3 v7 (revisión t8 de la v6) — las cinco escrituras que miraban el
 * estado de la cita AL LEER pero escribían con `where: { id }` a secas:
 * check-in, completar, confirmar del paciente (portal), confirmar/cancelar por
 * el enlace público y fin de teleconsulta. Si la cita se cancelaba (o se
 * marcaba no-show) en los milisegundos entre la lectura y la escritura,
 * revivía como CHECKED_IN, COMPLETED o CONFIRMED.
 *
 * Ahora cada una escribe con `updateMany` condicionado al estado leído y a la
 * clínica: si no toca la fila, contesta claro y SIN efectos (ni movimientos,
 * ni bitácora, ni reseña, ni Google, ni firma de la nota).
 *
 * Llama a los HANDLERS REALES sobre una base en memoria: después de que la ruta
 * lee la cita, «otra pantalla» la cancela (`alLeerLaCita`). ⛔ No sale nada a
 * nadie: WhatsApp, Google, reseñas y Daily son dobles que solo apuntan.
 * Run: npm run test:carreras-cita-cancelada
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

type Fila = Record<string, any>;
let citas: Fila[];
let notas: Fila[];
/** Lo que pasa justo después de que la ruta lee la cita (la otra pantalla que cancela). */
let alLeerLaCita: (() => void) | null;
let efectos: string[];

const cumple = (f: Fila, w: Fila = {}): boolean =>
  Object.entries(w).every(([k, v]) => {
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v.in as unknown[]).includes(f[k]);
      if ("notIn" in v) return !(v.notIn as unknown[]).includes(f[k]);
      return true;
    }
    return f[k] === v;
  });

function leida(f: Fila | undefined, a: Fila = {}) {
  if (!f) return null;
  const copia = { ...f, ...(a.include ? { patient: { id: f.patientId, firstName: "Ana", lastName: "G" }, doctor: { id: f.doctorId, firstName: "Luis", lastName: "R" } } : {}) };
  const despues = alLeerLaCita;
  alLeerLaCita = null;
  despues?.();
  return copia;
}

const appointment = {
  findFirst: async (a: Fila) => leida(citas.find((c) => cumple(c, a.where)), a),
  findUnique: async (a: Fila) => leida(citas.find((c) => cumple(c, a.where)), a),
  updateMany: async ({ where, data }: Fila) => {
    assert.equal(where.clinicId, "c1", "cada escritura lleva el clinicId de la sesión (o de la cita leída)");
    const xs = citas.filter((c) => cumple(c, where));
    for (const c of xs) Object.assign(c, data);
    return { count: xs.length };
  },
  update: async () => {
    throw new Error("update sin condición: ya no debe usarse en estas rutas");
  },
};
const prismaStub: Fila = {
  appointment,
  medicalRecord: {
    findFirst: async () => notas[0] ?? null,
    update: async ({ where }: Fila) => {
      efectos.push(`firma:${where.id}`);
      return notas[0];
    },
  },
  appointmentTimeline: { findUnique: async () => null, upsert: async () => undefined },
  $transaction: async (fn: (tx: Fila) => unknown) => fn(prismaStub),
};

const usuario = { id: "d1", role: "DOCTOR", clinicId: "c1", displayName: "Dr. Ruiz", permissionsOverride: [] };
const session = {
  user: usuario,
  clinic: { id: "c1", name: "Clínica QA", category: "DENTAL", timezone: "America/Mexico_City", defaultSlotMinutes: 30, schedules: [] },
};
const anota = (que: string) => async () => {
  efectos.push(que);
};

const M = mock as any;
M.module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
M.module("@/lib/agenda/api-helpers", { namedExports: { loadClinicSession: async () => session, requireRole: () => null } });
M.module("@/lib/auth-context", { namedExports: { getAuthContext: async () => ({ clinicId: "c1", userId: "d1", role: "DOCTOR", user: usuario }) } });
M.module("@/lib/auth/require-permission", { namedExports: { denyIfMissingPermission: () => null } });
M.module("@/lib/patient-visibility", { namedExports: { assertPatientVisible: async () => null } });
M.module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => undefined, revalidatePatientProfile: () => undefined } });
M.module("@/lib/agenda/server", { namedExports: { appointmentToDTO: (a: Fila) => ({ id: a.id, status: a.status }) } });
M.module("@/lib/movimientos-paciente/registrar", {
  namedExports: { registrarMovimientoDelPaciente: anota("movimiento"), registrarMovimientoExterno: anota("movimiento") },
});
M.module("@/lib/movimientos-paciente/zona", { namedExports: { zonaDeClinica: async () => "America/Mexico_City" } });
M.module("@/lib/agenda/adelantar-cita-a-hoy", {
  namedExports: { prepararAdelantoAHoy: async () => null, adelantoParaRespuesta: () => ({}), MOTIVO_RECORDATORIOS_ADELANTO: "adelanto" },
});
M.module("@/lib/reminders/reschedule.server", { namedExports: { cancelPendingRemindersForAppointment: anota("recordatorios") } });
M.module("@/lib/agenda/google-sync", { namedExports: { sincronizarCitaEnSegundoPlano: anota("google") } });
M.module("@/lib/audit", { namedExports: { logMutation: anota("bitacora") } });
M.module("@/lib/reviews/invite", { namedExports: { sendReviewInvitation: anota("resena") } });
M.module("@/lib/walk-in/cerrar-fila-de-la-cita", { namedExports: { cerrarFilaDeLaCita: anota("fila") } });
M.module("@/lib/odontogram/snapshot", {
  namedExports: {
    ensureDentalCatalog: anota("odontograma"),
    readCurrentEntries: async () => [],
    createOrUpdateSnapshot: async () => ({ id: "s1" }),
    findPreviousSnapshot: async () => null,
    diffSnapshots: () => [],
    changesToTreatments: async () => [],
  },
});
M.module("@/lib/daily", { namedExports: { deleteRoom: anota("sala-borrada") } });
M.module("@/lib/rate-limit", { namedExports: { rateLimit: () => null } });
M.module("@/lib/patient-portal/guard", {
  namedExports: {
    getPatientPortalContext: async () => ({ account: { id: "acc1" }, links: [{ patientId: "p1", clinicId: "c1" }] }),
    pacienteUnauthorized: () => new Response("{}", { status: 401 }),
  },
});
M.module("@/lib/anticipos/cita-cancelada.server", { namedExports: { marcarPendienteSiHayDinero: anota("dinero") } });

const HORA = 3_600_000;
beforeEach(() => {
  const inicio = new Date(Date.now() + 2 * HORA);
  citas = [
    {
      id: "a1", clinicId: "c1", patientId: "p1", doctorId: "d1", resourceId: null, overrideReason: null,
      status: "SCHEDULED", startsAt: inicio, endsAt: new Date(inicio.getTime() + HORA / 2), startedAt: null,
      holdExpiresAt: null, confirmToken: "tok-1", mode: "TELECONSULTATION", teleRoomId: "sala-1",
    },
  ];
  notas = [];
  alLeerLaCita = null;
  efectos = [];
});
const a1 = () => citas[0];
const laCancelan = (status = "CANCELLED") => () => {
  a1().status = status;
};
const req = (body: unknown): any =>
  new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const conId = { params: Promise.resolve({ id: "a1" }) };

// ── Check-in ────────────────────────────────────────────────────────────────
test("check-in: la cancelan justo después de leerla → 409 «cambió de estado», sigue CANCELLED y sin efectos", async () => {
  session.user.role = "RECEPTIONIST";
  try {
    const { POST } = await import("@/app/api/appointments/[id]/check-in/route");
    alLeerLaCita = laCancelan();
    const res = await POST(req({}), conId);
    assert.equal(res.status, 409);
    assert.match((await res.json()).reason, /cambió de estado/);
    assert.equal(a1().status, "CANCELLED");
    assert.deepEqual(efectos, []);
    // Sin carrera: llega como siempre.
    a1().status = "SCHEDULED";
    const ok = await POST(req({}), conId);
    assert.equal(ok.status, 200);
    assert.equal(a1().status, "CHECKED_IN");
  } finally {
    session.user.role = "DOCTOR";
  }
});

// ── Completar ───────────────────────────────────────────────────────────────
test("completar: la marcan no-show justo después de leerla → 409, sigue NO_SHOW, la nota NO se firma y sin bitácora ni reseña", async () => {
  a1().status = "IN_PROGRESS";
  a1().startedAt = new Date(Date.now() - HORA);
  a1().startsAt = new Date(Date.now() - HORA);
  notas = [{ id: "n1", specialtyData: { appointmentId: "a1" }, subjective: "dolor", objective: "caries", assessment: "x", plan: "y" }];
  const { PATCH } = await import("@/app/api/appointments/[id]/complete/route");
  alLeerLaCita = laCancelan("NO_SHOW");
  const res = await PATCH(req({}), conId);
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, "invalid_transition");
  assert.equal(a1().status, "NO_SHOW");
  assert.deepEqual(efectos, [], "ni firma, ni bitácora, ni reseña, ni fila");
  // Sin carrera: se cierra y se firma.
  a1().status = "IN_PROGRESS";
  const ok = await PATCH(req({}), conId);
  assert.equal(ok.status, 200);
  assert.equal(a1().status, "COMPLETED");
  assert.ok(efectos.includes("firma:n1"));
});

// ── Confirmar del paciente (portal) ─────────────────────────────────────────
test("confirmar desde el portal: la cancelan justo después de leerla → 409 not_confirmable con su estado actual; sin movimiento", async () => {
  const { POST } = await import("@/app/api/paciente/appointments/[id]/confirm/route");
  alLeerLaCita = laCancelan();
  const res = await POST(req({}), conId);
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: "not_confirmable", status: "CANCELLED" });
  assert.equal(a1().status, "CANCELLED");
  assert.deepEqual(efectos, []);
  a1().status = "SCHEDULED";
  const ok = await POST(req({}), conId);
  assert.equal((await ok.json()).changed, true);
  assert.equal(a1().status, "CONFIRMED");
});

// ── Enlace público ──────────────────────────────────────────────────────────
test("enlace público: confirmar mientras la cancelan → contesta su estado actual (CANCELLED), changed:false, sin movimiento", async () => {
  const { POST } = await import("@/app/api/public/appointment-confirm/route");
  alLeerLaCita = laCancelan();
  const res = await POST(req({ token: "tok-1", action: "confirm" }));
  assert.deepEqual(await res.json(), { status: "CANCELLED", changed: false });
  assert.equal(a1().status, "CANCELLED");
  assert.deepEqual(efectos, []);
});

test("enlace público: cancelar mientras la clínica le marca la llegada → no la cancela encima (sigue CHECKED_IN), sin Google ni dinero", async () => {
  const { POST } = await import("@/app/api/public/appointment-confirm/route");
  alLeerLaCita = laCancelan("CHECKED_IN");
  const res = await POST(req({ token: "tok-1", action: "cancel" }));
  assert.deepEqual(await res.json(), { status: "CHECKED_IN", changed: false });
  assert.equal(a1().status, "CHECKED_IN");
  assert.deepEqual(efectos, []);
  // Sin carrera: cancela como siempre.
  a1().status = "SCHEDULED";
  const ok = await POST(req({ token: "tok-1", action: "cancel" }));
  assert.equal((await ok.json()).changed, true);
  assert.equal(a1().status, "CANCELLED");
});

// ── Fin de teleconsulta ─────────────────────────────────────────────────────
test("fin de teleconsulta: la cancelan mientras se cuelga → 200 con statusChanged:false y su motivo; sigue CANCELLED, sin bitácora ni reseña, y la sala SÍ se borra", async () => {
  a1().startsAt = new Date(Date.now() - HORA / 4);
  const { POST } = await import("@/app/api/teleconsulta/end/route");
  alLeerLaCita = laCancelan();
  const res = await POST(req({ appointmentId: "a1" }));
  assert.equal(res.status, 200);
  const cuerpo = await res.json();
  assert.equal(cuerpo.statusChanged, false);
  assert.match(cuerpo.reason, /cambió de estado/);
  assert.equal(a1().status, "CANCELLED");
  assert.deepEqual(efectos, ["sala-borrada"], "la llamada termina igual (sala borrada); nada más");
  // Sin carrera: se cierra como siempre.
  a1().status = "SCHEDULED";
  efectos = [];
  const ok = await POST(req({ appointmentId: "a1" }));
  assert.equal((await ok.json()).statusChanged, true);
  assert.equal(a1().status, "COMPLETED");
  assert.ok(efectos.includes("bitacora") && efectos.includes("resena"));
});

test("tenant: una cita de OTRA clínica con el mismo id no se toca (y el doble exige el clinicId en cada escritura de las cinco)", async () => {
  // La lectura de la ruta encuentra la de c1; la fila con el mismo id en c2 nunca casa.
  citas.push({ ...a1(), clinicId: "c2", status: "SCHEDULED" });
  const { POST } = await import("@/app/api/paciente/appointments/[id]/confirm/route");
  const ok = await POST(req({}), conId);
  assert.equal((await ok.json()).changed, true);
  assert.equal(citas[1].status, "SCHEDULED", "la de c2 sigue igual");
});
