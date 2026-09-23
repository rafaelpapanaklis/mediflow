/**
 * EL «NO» DE LA CLÍNICA TAMBIÉN CIERRA LAS OTRAS DOS PUERTAS DEL MOSTRADOR — WS1-T5.
 *
 * Run: npm run test:agenda-candado-otras-puertas
 *
 * Con «¿Recepción puede agendar sobre un día bloqueado?» en «No», el POST y el
 * PATCH de la cita rechazan agendar encima (reglas-servidor.test.ts). Pero hay
 * otras dos maneras de poner una cita en la agenda desde el panel, y las dos
 * lo dejaban pasar:
 *
 *   · aprobar una SOLICITUD DE CAMBIO del portal
 *     (`POST /api/appointment-change-requests/:id/resolve`), que mueve la cita
 *     con su propio `update`;
 *   · aceptar una SOLICITUD DE RESERVA de la web
 *     (`PATCH /api/booking-requests/:id`), que la crea con su propio `create`.
 *
 * Cómo prueba: los HANDLERS REALES con `mock.module`. El candado está antes de
 * escribir nada, así que cada caso de control comprueba que el handler pasó de
 * largo (llegó a `isSlotFree` o a la transacción) y cada caso en rojo que no
 * llegó.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const TZ = "America/Mexico_City";
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** Mañana + 2 a las 16:00Z (10:00 en CDMX): un hueco de día laborable, al minuto. */
const INICIO = new Date(Math.floor((Date.now() + 2 * DAY) / DAY) * DAY + 16 * 60 * MIN);
const FIN = new Date(INICIO.getTime() + 30 * MIN);

let bloqueos: any[];
let politicas: { clinicId: string; recepcionPuedeAgendar: boolean }[];
let crActualizadas: any[];
let slotFreeLlamadas: number;
/** Doctores que la transacción de «aceptar» llegó a considerar. */
let candidatosEnTx: string[] | null;

const session: any = {
  user: { id: "u1", role: "RECEPTIONIST", clinicId: "c1", displayName: "Recepción", permissionsOverride: [] },
  clinic: { id: "c1", timezone: TZ, defaultSlotMinutes: 30 },
};

beforeEach(() => {
  bloqueos = [];
  politicas = [];
  crActualizadas = [];
  slotFreeLlamadas = 0;
  candidatosEnTx = null;
  session.user.role = "RECEPTIONIST";
  session.user.permissionsOverride = [];
});

function bloqueo(doctorId: string | null, clinicId = "c1") {
  bloqueos.push({
    id: `b-${doctorId ?? "clinica"}-${clinicId}`,
    clinicId,
    doctorId,
    kind: "PERSONAL",
    reason: "Congreso",
    startsAt: new Date(INICIO.getTime() - 60 * MIN),
    endsAt: new Date(FIN.getTime() + 60 * MIN),
    holidayKey: null,
  });
}

const LLEGO_A_LA_TX = "llegó a la transacción";

const prismaStub: any = {
  agendaBlock: {
    findMany: async ({ where }: any) =>
      bloqueos.filter((b) => {
        if (b.clinicId !== where.clinicId) return false;
        if (!(b.startsAt < where.startsAt.lt && b.endsAt > where.endsAt.gt)) return false;
        const ids: string[] | undefined = where.OR?.[1]?.doctorId?.in;
        return b.doctorId === null || !ids || ids.includes(b.doctorId);
      }),
  },
  agendaBlockPolicy: {
    findUnique: async ({ where }: any) => politicas.find((p) => p.clinicId === where.clinicId) ?? null,
  },
  appointmentChangeRequest: {
    findFirst: async ({ where }: any) =>
      where.clinicId === "c1"
        ? {
            id: "cr1",
            clinicId: "c1",
            status: "PENDING",
            type: "RESCHEDULE",
            patientId: "p1",
            proposedStartsAt: INICIO,
            proposedEndsAt: FIN,
            appointment: { id: "a1", doctorId: "d1", resourceId: null, startsAt: new Date(INICIO.getTime() - DAY), endsAt: new Date(FIN.getTime() - DAY), status: "SCHEDULED" },
            patient: { id: "p1", firstName: "Ana", lastName: "García" },
          }
        : null,
    update: async (args: any) => {
      crActualizadas.push(args);
      return args;
    },
  },
  bookingRequest: {
    findFirst: async ({ where }: any) =>
      where.clinicId === "c1"
        ? {
            id: "br1",
            clinicId: "c1",
            status: "PENDIENTE",
            requestedAt: INICIO,
            serviceDurationMin: 30,
            serviceName: "Limpieza",
            doctorId: null,
            patientName: "Ana García",
            patientWhatsapp: "+525512345678",
            patientDob: null,
            notes: null,
          }
        : null,
  },
  patient: { findMany: async () => [] },
  doctorSchedule: { findMany: async () => [] },
  $transaction: async (fn: any) =>
    fn({
      appointment: {
        findMany: async ({ where }: any) => {
          candidatosEnTx = where.doctorId.in;
          throw new Error(LLEGO_A_LA_TX);
        },
      },
    }),
};

(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
(mock as any).module("@/lib/agenda/api-helpers", {
  namedExports: {
    loadClinicSession: async () => session,
    requireRole: () => null,
    isOverlapError: () => false,
  },
});
(mock as any).module("@/lib/auth/require-permission", { namedExports: { denyIfMissingPermission: () => null } });
(mock as any).module("@/lib/audit", { namedExports: { logMutation: async () => undefined } });
(mock as any).module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => undefined } });
(mock as any).module("@/lib/patient-visibility", { namedExports: { assertPatientVisible: async () => null } });
(mock as any).module("@/lib/agenda/google-sync", {
  namedExports: { syncUpdateToGoogleCalendar: async () => undefined, syncDeleteFromGoogleCalendar: async () => undefined },
});
(mock as any).module("@/lib/reminders/reschedule.server", {
  namedExports: { applyReminderReschedule: async () => undefined, cancelPendingRemindersForAppointment: async () => undefined },
});
(mock as any).module("@/lib/appointment-change/notify", { namedExports: { notifyPatientChangeResolution: async () => undefined } });
(mock as any).module("@/lib/appointment-change/slots", {
  namedExports: {
    // `false` = «ya está ocupado»: el handler se va por el auto-rechazo, que
    // basta para saber que pasó el candado sin montar toda la transacción.
    isSlotFree: async () => {
      slotFreeLlamadas++;
      return false;
    },
  },
});
(mock as any).module("@/lib/booking-requests/server", {
  namedExports: {
    activeDoctors: async () => [
      { id: "d1", firstName: "Luis", lastName: "Ruiz" },
      { id: "d2", firstName: "Eva", lastName: "Paz" },
    ],
    freeSlotsForDay: async () => [],
    isMissingTable: () => false,
  },
});
(mock as any).module("@/lib/patients/next-patient-number", {
  namedExports: { nextPatientNumber: async () => 1, withPatientNumberRetry: (fn: any) => fn() },
});
(mock as any).module("@/lib/whatsapp/inbox-log", { namedExports: { findPatientsByWhatsAppPhone: async () => [] } });

function req(body: unknown): any {
  return { json: async () => body, headers: new Headers() };
}

async function aprobar() {
  const { POST } = await import("@/app/api/appointment-change-requests/[id]/resolve/route");
  const res = await POST(req({ action: "APPROVE" }), { params: { id: "cr1" } });
  return { status: res.status, body: await res.json() };
}

/**
 * La transacción del doble lanza en cuanto la abre, y la ruta convierte eso en
 * su 500 genérico: lo que dice si pasó el candado es `candidatosEnTx`.
 */
async function aceptar(extra: Record<string, unknown> = {}) {
  const { PATCH } = await import("@/app/api/booking-requests/[id]/route");
  const res = await PATCH(req({ action: "accept", ...extra }), { params: { id: "br1" } });
  return { status: res.status, body: await res.json(), tx: candidatosEnTx !== null };
}

/* ── aprobar una solicitud de cambio ───────────────────────────────────── */

test("solicitud de cambio · control: con «Sí» se aprueba sobre un bloqueo como siempre", async () => {
  bloqueo("d1");
  const r = await aprobar();
  assert.equal(slotFreeLlamadas, 1, "no pasó del candado");
  assert.equal(r.status, 409); // el doble dice «ocupado»: auto-rechazo, fuera del alcance de esta prueba
});

test("solicitud de cambio · con «No», recepción no aprueba sobre un bloqueo: 422 con frase, y la solicitud sigue pendiente", async () => {
  bloqueo("d1");
  politicas.push({ clinicId: "c1", recepcionPuedeAgendar: false });
  const r = await aprobar();
  assert.equal(r.status, 422, JSON.stringify(r.body));
  assert.equal(r.body.error, "blocked_slot_not_allowed");
  assert.match(r.body.reason, /bloqueada/);
  assert.equal(slotFreeLlamadas, 0, "siguió adelante tras el rechazo");
  assert.equal(crActualizadas.length, 0, "tocó la solicitud");
});

test("solicitud de cambio · con «No», ADMIN sí la aprueba", async () => {
  session.user.role = "ADMIN";
  bloqueo("d1");
  politicas.push({ clinicId: "c1", recepcionPuedeAgendar: false });
  await aprobar();
  assert.equal(slotFreeLlamadas, 1);
});

test("solicitud de cambio · con «No», el bloqueo de OTRO doctor no estorba", async () => {
  bloqueo("d2");
  politicas.push({ clinicId: "c1", recepcionPuedeAgendar: false });
  await aprobar();
  assert.equal(slotFreeLlamadas, 1);
});

test("solicitud de cambio · el panel pinta la frase del 422, no el código", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("src/components/dashboard/change-requests-panel.tsx", "utf8");
  const desde = src.indexOf("res.status === 422");
  const bloque = desde < 0 ? "" : src.slice(desde, src.indexOf("if (!res.ok)", desde));
  assert.ok(bloque.length > 0, "el panel no atiende el 422");
  assert.match(bloque, /bookingRuleMessage\(/);
});

/* ── aceptar una solicitud de reserva web ──────────────────────────────── */

test("reserva web · control: con «Sí» se acepta sobre un bloqueo como siempre (los dos doctores)", async () => {
  bloqueo(null);
  const r = await aceptar();
  assert.ok(r.tx, `no llegó a la transacción: ${JSON.stringify(r.body)}`);
  assert.deepEqual(candidatosEnTx?.sort(), ["d1", "d2"]);
});

test("reserva web · con «No» y un bloqueo de TODA la clínica: 422 con la frase en `error` (así la pinta el panel)", async () => {
  bloqueo(null);
  politicas.push({ clinicId: "c1", recepcionPuedeAgendar: false });
  const r = await aceptar();
  assert.equal(r.tx, false, "creó la cita encima del bloqueo");
  assert.equal(r.status, 422);
  assert.equal(r.body.code, "blocked_slot_not_allowed");
  assert.match(r.body.error, /bloqueada/, "el panel pinta `error`: tiene que ser la frase");
});

test("reserva web · con «No» y solo un doctor bloqueado: se queda con el que está libre", async () => {
  bloqueo("d1");
  politicas.push({ clinicId: "c1", recepcionPuedeAgendar: false });
  const r = await aceptar();
  assert.ok(r.tx);
  assert.deepEqual(candidatosEnTx, ["d2"]);
});

test("reserva web · con «No», forzar al doctor bloqueado → 422", async () => {
  bloqueo("d1");
  politicas.push({ clinicId: "c1", recepcionPuedeAgendar: false });
  const r = await aceptar({ doctorId: "d1" });
  assert.equal(r.status, 422);
});

test("reserva web · con «No», ADMIN sí acepta sobre el bloqueo", async () => {
  session.user.role = "ADMIN";
  bloqueo(null);
  politicas.push({ clinicId: "c1", recepcionPuedeAgendar: false });
  const r = await aceptar();
  assert.ok(r.tx);
  assert.deepEqual(candidatosEnTx?.sort(), ["d1", "d2"]);
});

test("reserva web · el «No» de OTRA clínica no alcanza a ésta", async () => {
  bloqueo(null);
  politicas.push({ clinicId: "c2", recepcionPuedeAgendar: false });
  const r = await aceptar();
  assert.ok(r.tx);
});
