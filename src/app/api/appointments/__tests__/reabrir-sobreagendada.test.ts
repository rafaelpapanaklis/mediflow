/**
 * REABRIR UNA CITA CUYO HUECO YA OCUPA OTRA — WS1-T5 (revisión t8, A3 y N-A1).
 *
 * Run: npm run test:salamanca-agenda
 *
 * Ana estaba sobreagendada encima de Mario. Recepción cancela a Ana por error
 * y el admin pulsa «Reabrir cita». Antes del arreglo: o se reabría encima sin
 * aviso (si su compañera era otra sobreagendada, la base no la ve), o salía un
 * 409 que mandaba a mover a Ana… que, cancelada, no se puede mover.
 *
 * Llama al HANDLER REAL de `PATCH /api/appointments/:id/status` con
 * `mock.module` sobre prisma, la sesión y los efectos (⛔ ni base ni WhatsApp).
 * La última parte corre el flujo de la PANTALLA (`patchAppointmentStatus` +
 * `enviarConAvisoDeSobreagenda`, lo que usa «Reabrir cita» del panel) con
 * `fetch` apuntando a ese mismo handler.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const TZ = "America/Mexico_City";
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const MARCA = "Sobreagendada por el equipo";

/** Pasado mañana a las 16:00Z (10:00 en CDMX), al minuto. */
const INICIO = new Date(Math.floor((Date.now() + 2 * DAY) / DAY) * DAY + 16 * 60 * MIN);
const FIN = new Date(INICIO.getTime() + 30 * MIN);

let bandera: boolean;
let existente: any;
/** Las citas vivas de la base (lo que lee `buscarChoqueDeCita`). */
let vivas: any[];
/** Lo que escribió el `updateMany` del cambio de estado (null = nada). */
let escrito: any;
/** La constraint de la base: rechaza si la cita queda SIN overrideReason. */
let constraintChoca: boolean;
let movimientos: any[];

const session: any = {
  user: { id: "u-admin", role: "ADMIN", clinicId: "c1", displayName: "Admin", permissionsOverride: [] },
  clinic: { id: "c1", name: "Clínica QA", category: "DENTAL", timezone: TZ, defaultSlotMinutes: 30, schedules: [] },
};

const CLAVE_FLEX = Symbol.for("dalecontrol.agenda.flexible");

beforeEach(() => {
  bandera = true;
  escrito = null;
  constraintChoca = false;
  movimientos = [];
  (globalThis as any)[CLAVE_FLEX] = undefined;
  existente = {
    id: "a-ana",
    clinicId: "c1",
    patientId: "p-ana",
    doctorId: "d1",
    resourceId: null,
    overrideReason: MARCA,
    status: "CANCELLED",
    startsAt: INICIO,
    endsAt: FIN,
  };
  vivas = [cita("a-mario", "Mario", "López", null)];
});

function cita(id: string, nombre: string, apellido: string, overrideReason: string | null) {
  return {
    id,
    clinicId: "c1",
    doctorId: "d1",
    resourceId: null,
    status: "CONFIRMED",
    overrideReason,
    startsAt: INICIO,
    endsAt: FIN,
    patient: { firstName: nombre, lastName: apellido, visibleUserIds: [] },
  };
}

const prismaStub: any = {
  appointmentTimeline: { findUnique: async () => null, upsert: async () => undefined },
  appointment: {
    findFirst: async ({ where }: any) => {
      assert.equal(where.clinicId, "c1", "la cita se lee SIEMPRE con el clinicId de la sesión");
      return existente;
    },
    // buscarChoqueDeCita: las vivas del mismo doctor que pisan el rango.
    findMany: async ({ where }: any) => {
      assert.equal(where.clinicId, "c1");
      return vivas.filter(
        (a) =>
          a.id !== where.id?.not &&
          a.startsAt < where.startsAt.lt &&
          a.endsAt > where.endsAt.gt &&
          where.OR.some((o: any) => (o.doctorId && o.doctorId === a.doctorId) || (o.resourceId && o.resourceId === a.resourceId)),
      );
    },
  },
  clinicFeatureFlag: {
    findMany: async ({ where }: any) =>
      bandera && where.clinicId === "c1" ? [{ flag: "agenda-flexible", enabled: true }] : [],
  },
  $queryRaw: async () => [{ existe: true }],
  $transaction: async (fn: any) =>
    fn({
      appointment: {
        updateMany: async ({ where, data }: any) => {
          assert.equal(where.clinicId, "c1");
          const override = data.overrideReason === undefined ? existente.overrideReason : data.overrideReason;
          if (constraintChoca && override == null) {
            throw Object.assign(new Error("exclusion constraint"), { code: "23P01" });
          }
          escrito = data;
          return { count: 1 };
        },
        findFirst: async () => ({
          ...existente,
          ...(escrito ?? {}),
          patient: { id: "p-ana", firstName: "Ana", lastName: "García" },
          doctor: { id: "d1", firstName: "Luis", lastName: "Ruiz" },
        }),
      },
    }),
};

(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
(mock as any).module("@/lib/agenda/api-helpers", {
  namedExports: { loadClinicSession: async () => session, requireRole: () => null },
});
(mock as any).module("@/lib/auth/require-permission", { namedExports: { denyIfMissingPermission: () => null } });
(mock as any).module("@/lib/agenda/server", {
  namedExports: { appointmentToDTO: (a: any) => ({ id: a.id, status: a.status, startsAt: a.startsAt }) },
});
(mock as any).module("@/lib/patient-visibility", {
  namedExports: { assertPatientVisible: async () => null, canSeePatient: () => true },
});
(mock as any).module("@/lib/reviews/invite", { namedExports: { sendReviewInvitation: async () => undefined } });
(mock as any).module("@/lib/cache/revalidate", {
  namedExports: { revalidateAfter: () => undefined, revalidatePatientProfile: () => undefined },
});
(mock as any).module("@/lib/whatsapp/avisos-cita", {
  namedExports: { avisarCitaPorWhatsApp: async () => ({ enviado: false, motivo: "doble" }) },
});
(mock as any).module("@/lib/anticipos/cita-cancelada.server", {
  namedExports: { decidirDineroDeCitaCancelada: async () => ({ ok: true }), dineroDeLaCita: async () => null },
});
(mock as any).module("@/lib/agenda/google-sync", { namedExports: { sincronizarCitaEnSegundoPlano: async () => undefined } });
(mock as any).module("@/lib/reminders/reschedule.server", {
  namedExports: { cancelPendingRemindersForAppointment: async () => 0 },
});
(mock as any).module("@/lib/walk-in/cerrar-fila-de-la-cita", { namedExports: { cerrarFilaDeLaCita: async () => undefined } });
(mock as any).module("@/lib/movimientos-paciente/registrar", {
  namedExports: {
    registrarMovimientoDelPaciente: async (m: any) => {
      movimientos.push(m);
    },
  },
});
(mock as any).module("@/lib/movimientos-paciente/zona", { namedExports: { zonaDeClinica: async () => TZ } });

const URL_STATUS = "http://localhost/api/appointments/a-ana/status";

async function reabrir(extra: Record<string, unknown> = {}) {
  const { PATCH } = await import("@/app/api/appointments/[id]/status/route");
  const res = await PATCH(
    new Request(URL_STATUS, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "SCHEDULED", ...extra }) }) as any,
    { params: Promise.resolve({ id: "a-ana" }) },
  );
  return { status: res.status, body: await res.json() };
}

// ═══════════════════════════════════════════════════════════════════════
// LA RUTA
// ═══════════════════════════════════════════════════════════════════════

test("N-A1 · con bandera: reabrir a Ana encima de Mario pide el «¿Seguro?» (409 sobreagendable) y no escribe nada", async () => {
  const r = await reabrir();
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error, "appointment_overlap");
  assert.equal(r.body.sobreagendable, true);
  assert.equal(r.body.conflictingAppointment.id, "a-mario");
  assert.equal(r.body.conflictingAppointment.patientName, "Mario López");
  assert.match(r.body.reason, /hazlo desde la Agenda/, "las pantallas que no preguntan dicen dónde hacerlo");
  assert.equal(escrito, null);
});

test("N-A1 · confirmado: se reabre y SIGUE sobreagendada (la marca no se toca)", async () => {
  constraintChoca = true; // sin la marca, la base la pararía
  const r = await reabrir({ sobreagendar: true, sobreagendarCita: "a-mario", sobreagendarOtras: 0 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(escrito.status, "SCHEDULED");
  assert.equal(escrito.overrideReason, undefined, "conserva su marca");
});

test("N-A1 · una cita normal (sin marca) cancelada, reabierta encima con confirmación: queda con la MARCA y el rastro", async () => {
  existente.overrideReason = null;
  constraintChoca = true;
  const r = await reabrir({ sobreagendar: true, sobreagendarCita: "a-mario" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(escrito.overrideReason, MARCA);
  assert.equal(escrito.overriddenBy, "u-admin");
  assert.ok(escrito.overriddenAt instanceof Date);
  const mov = movimientos.find((m) => m.campos?.[0] === "status");
  assert.deepEqual(mov.cambios.sobreagendada, { before: null, after: { conCita: "a-mario" } });
});

test("N-A1 · la confirmación vale para la cita que se enseñó: con otra se vuelve a preguntar", async () => {
  const r = await reabrir({ sobreagendar: true, sobreagendarCita: "otra" });
  assert.equal(r.status, 409);
  assert.equal(r.body.sobreagendable, true);
  assert.equal(escrito, null);
});

test("A3 (a) · el hueco lo ocupa OTRA SOBREAGENDADA (la base no la ve): ya no se reabre encima sin aviso", async () => {
  vivas = [cita("a-eva", "Eva", "Paz", MARCA)];
  const r = await reabrir();
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.sobreagendable, true);
  assert.equal(r.body.conflictingAppointment.id, "a-eva");
  assert.equal(escrito, null);
});

test("A3 · hueco LIBRE: se reabre y pierde la marca (vuelve a ser una cita normal)", async () => {
  vivas = [];
  const r = await reabrir();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(escrito.overrideReason, null);
  assert.equal(escrito.overriddenBy, null);
});

test("A3 · bandera APAGADA y el hueco ocupado: 409 que dice qué hacer (agendar una nueva), sin pregunta y sin escribir", async () => {
  bandera = false;
  const r = await reabrir({ sobreagendar: true, sobreagendarCita: "a-mario" });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "invalid_transition");
  assert.equal(r.body.sobreagendable, undefined);
  assert.match(r.body.reason, /Mario López/);
  assert.match(r.body.reason, /agéndale una cita nueva/);
  assert.equal(escrito, null);
});

test("A3 · otra cita entra en el hueco entre la revisión y la escritura: 409 claro, no un 500", async () => {
  vivas = [];
  constraintChoca = true;
  const r = await reabrir();
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.match(r.body.reason, /Intenta de nuevo/);
});

test("un motivo de ADMINISTRACIÓN (no la marca) sigue como siempre: se reabre sin preguntar", async () => {
  existente.overrideReason = "Urgencia autorizada";
  const r = await reabrir();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(escrito.overrideReason, undefined);
});

// ═══════════════════════════════════════════════════════════════════════
// LA PANTALLA: «Reabrir cita» del panel (patchAppointmentStatus +
// enviarConAvisoDeSobreagenda), con fetch apuntando al handler real
// ═══════════════════════════════════════════════════════════════════════

async function conFetchALaRuta<T>(fn: (peticiones: any[]) => Promise<T>): Promise<T> {
  const { PATCH } = await import("@/app/api/appointments/[id]/status/route");
  const peticiones: any[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    peticiones.push(JSON.parse(String(init.body)));
    return PATCH(new Request(new URL(url, "http://localhost"), init) as any, { params: Promise.resolve({ id: "a-ana" }) });
  }) as typeof fetch;
  try {
    return await fn(peticiones);
  } finally {
    globalThis.fetch = original;
  }
}

test("N-A1 · pantalla: Reabrir → «¿Seguro?» con Mario → «Sí» → se reabre sobreagendada (dos peticiones)", async () => {
  const { patchAppointmentStatus } = await import("@/lib/agenda/mutations");
  const { enviarConAvisoDeSobreagenda } = await import("@/lib/agenda/agenda-flexible");
  constraintChoca = true;
  const avisos: any[] = [];
  const { resultado, peticiones } = await conFetchALaRuta(async (peticiones) => ({
    peticiones,
    resultado: await enviarConAvisoDeSobreagenda({
      enviar: (confirmacion) => patchAppointmentStatus("a-ana", "SCHEDULED", confirmacion),
      preguntar: async (aviso) => {
        avisos.push(aviso);
        return true;
      },
      intento: { doctorId: "d1", resourceId: null },
      timeZone: TZ,
    }),
  }));
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].tipo, "doctor");
  assert.equal(avisos[0].paciente, "Mario López");
  assert.equal(avisos[0].hora, "10:00–10:30", "en la zona de la clínica");
  assert.deepEqual(peticiones[1], { status: "SCHEDULED", sobreagendar: true, sobreagendarCita: "a-mario", sobreagendarOtras: 0 });
  assert.equal(resultado?.status, "SCHEDULED");
  assert.equal(escrito.status, "SCHEDULED");
});

test("N-A1 · pantalla: «Cancelar» en el «¿Seguro?» no manda nada más y no cambia la cita", async () => {
  const { patchAppointmentStatus } = await import("@/lib/agenda/mutations");
  const { enviarConAvisoDeSobreagenda } = await import("@/lib/agenda/agenda-flexible");
  const { resultado, peticiones } = await conFetchALaRuta(async (peticiones) => ({
    peticiones,
    resultado: await enviarConAvisoDeSobreagenda({
      enviar: (confirmacion) => patchAppointmentStatus("a-ana", "SCHEDULED", confirmacion),
      preguntar: async () => false,
      intento: { doctorId: "d1", resourceId: null },
      timeZone: TZ,
    }),
  }));
  assert.equal(resultado, null);
  assert.equal(peticiones.length, 1);
  assert.equal(escrito, null);
});

test("pantalla: sin la bandera no hay pregunta; el error sale tal cual (con su frase)", async () => {
  const { patchAppointmentStatus } = await import("@/lib/agenda/mutations");
  const { enviarConAvisoDeSobreagenda } = await import("@/lib/agenda/agenda-flexible");
  bandera = false;
  let preguntas = 0;
  await conFetchALaRuta(async () => {
    await assert.rejects(
      enviarConAvisoDeSobreagenda({
        enviar: (confirmacion) => patchAppointmentStatus("a-ana", "SCHEDULED", confirmacion),
        preguntar: async () => {
          preguntas++;
          return true;
        },
        intento: { doctorId: "d1", resourceId: null },
        timeZone: TZ,
      }),
      (e: any) => e.status === 409 && /agéndale una cita nueva/.test(e.reason),
    );
  });
  assert.equal(preguntas, 0);
});
