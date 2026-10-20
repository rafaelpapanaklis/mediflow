/**
 * LA HORA DE COMIDA EN LAS OTRAS DOS PUERTAS DEL MOSTRADOR — WS1-T5 (revisión
 * t8, A6).
 *
 * Run: npm run test:salamanca-agenda
 *
 * Con la bandera `agenda-flexible` y la comida del doctor guardada:
 *   · aprobar una SOLICITUD DE CAMBIO del portal que cae en la comida no mueve
 *     la cita: 409 `lunch_overlap` con su frase y la solicitud sigue pendiente;
 *   · aceptar una SOLICITUD DE RESERVA web descarta a los doctores en su
 *     comida (y si no queda nadie, 409 con la frase);
 *   · el PANEL del portal enseña esa frase y deja la solicitud en la lista
 *     (antes decía «Esta solicitud ya fue resuelta»).
 *
 * Los HANDLERS REALES con `mock.module` (el arnés de
 * candado-bloqueo-otras-puertas.test.ts), sin base: la bandera y la comida
 * salen de dobles de `clinicFeatureFlag` y del SQL crudo.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { respuestaAl409 } from "@/components/dashboard/change-requests-409";

const TZ = "America/Mexico_City";
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** Pasado mañana a las 16:00Z (10:00 en CDMX), al minuto. */
const INICIO = new Date(Math.floor((Date.now() + 2 * DAY) / DAY) * DAY + 16 * 60 * MIN);
const FIN = new Date(INICIO.getTime() + 30 * MIN);
/** El día de la semana del horario (0 = lunes) de INICIO en CDMX. */
const DIA = (() => {
  const corto = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(INICIO);
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(corto);
})();

let bandera: boolean;
/** Doctores con la comida de 10:00 a 11:00 ese día. */
let enComida: string[];
let crActualizadas: any[];
let slotFreeLlamadas: number;
let candidatosEnTx: string[] | null;

const session: any = {
  user: { id: "u1", role: "RECEPTIONIST", clinicId: "c1", displayName: "Recepción", permissionsOverride: [] },
  clinic: { id: "c1", timezone: TZ, defaultSlotMinutes: 30 },
};

const CLAVE_FLEX = Symbol.for("dalecontrol.agenda.flexible");
const CLAVE_COLUMNAS = Symbol.for("dalecontrol.horarioDoctor.columnasComida");

beforeEach(() => {
  bandera = true;
  enComida = ["d1"];
  crActualizadas = [];
  slotFreeLlamadas = 0;
  candidatosEnTx = null;
  (globalThis as any)[CLAVE_FLEX] = undefined;
  (globalThis as any)[CLAVE_COLUMNAS] = { existe: true, at: Date.now() };
});

const LLEGO_A_LA_TX = "llegó a la transacción";

const prismaStub: any = {
  agendaBlock: { findMany: async () => [] },
  agendaBlockPolicy: { findUnique: async () => null },
  clinicFeatureFlag: {
    findMany: async ({ where }: any) =>
      bandera && where.clinicId === "c1" ? [{ flag: "agenda-flexible", enabled: true }] : [],
  },
  doctorSchedule: {
    findMany: async ({ where }: any) => {
      assert.equal(where.clinicId, "c1");
      const ids: string[] = where.doctorId?.in ?? ["d1", "d2"];
      return ids.map((doctorId) => ({ doctorId, dayOfWeek: DIA, enabled: true, openTime: "08:00", closeTime: "18:00" }));
    },
  },
  $queryRaw: async (strings: TemplateStringsArray, ...valores: unknown[]) => {
    const sql = strings.join("?");
    if (sql.includes("to_regclass")) return [{ existe: true }];
    if (sql.includes('"lunchStart"')) {
      assert.equal(valores[0], "c1", "la comida se lee con el clinicId de la sesión");
      return enComida.map((doctorId) => ({ doctorId, dayOfWeek: DIA, lunchStart: "10:00", lunchEnd: "11:00" }));
    }
    return [{ n: 2 }];
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
    updateMany: async (args: any) => {
      crActualizadas.push(args);
      return { count: 1 };
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
    updateMany: async () => ({ count: 1 }),
  },
  patient: { findMany: async () => [] },
  $transaction: async (fn: any) =>
    fn({
      bookingRequest: { updateMany: async () => ({ count: 1 }) },
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
  namedExports: { loadClinicSession: async () => session, requireRole: () => null, isOverlapError: () => false },
});
(mock as any).module("@/lib/auth/require-permission", { namedExports: { denyIfMissingPermission: () => null } });
(mock as any).module("@/lib/audit", { namedExports: { logMutation: async () => undefined } });
(mock as any).module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => undefined } });
(mock as any).module("@/lib/patient-visibility", { namedExports: { assertPatientVisible: async () => null } });
(mock as any).module("@/lib/agenda/google-sync", { namedExports: { sincronizarCitaEnSegundoPlano: async () => undefined } });
(mock as any).module("@/lib/reminders/reschedule.server", {
  namedExports: { applyReminderReschedule: async () => undefined, cancelPendingRemindersForAppointment: async () => undefined },
});
(mock as any).module("@/lib/appointment-change/notify", { namedExports: { notifyPatientChangeResolution: async () => undefined } });
(mock as any).module("@/lib/appointment-change/slots", {
  namedExports: {
    // `false` = «ya está ocupado»: basta para saber que el handler pasó la comida.
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
  const res = await POST(req({ action: "APPROVE" }), { params: Promise.resolve({ id: "cr1" }) });
  return { status: res.status, body: await res.json() };
}

async function aceptar() {
  const { PATCH } = await import("@/app/api/booking-requests/[id]/route");
  const res = await PATCH(req({ action: "accept" }), { params: Promise.resolve({ id: "br1" }) });
  return { status: res.status, body: await res.json(), tx: candidatosEnTx };
}

/* ── aprobar una solicitud de cambio del portal ────────────────────────── */

test("A6 · portal: aprobar un cambio que cae en la comida → 409 `lunch_overlap` con la frase; no se mueve nada y sigue pendiente", async () => {
  const r = await aprobar();
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error, "lunch_overlap");
  assert.match(r.body.reason, /comida del doctor \(de 10:00 a 11:00\)/);
  assert.equal(slotFreeLlamadas, 0, "cortó antes de mirar el hueco");
  assert.equal(crActualizadas.length, 0, "la solicitud no se tocó: sigue PENDIENTE");
});

test("A6 · portal: control — sin la bandera la comida no existe y sigue su camino", async () => {
  bandera = false;
  const r = await aprobar();
  assert.equal(r.body.error, "slot_taken");
  assert.equal(slotFreeLlamadas, 1);
});

test("A6 · portal: el PANEL enseña la frase de la comida y deja la solicitud en la lista", async () => {
  const r = await aprobar();
  const panel = respuestaAl409(r.body);
  assert.equal(panel.texto, r.body.reason);
  assert.equal(panel.refrescar, false);
  assert.equal(panel.resuelta, false);
  assert.notEqual(panel.texto, "Esta solicitud ya fue resuelta");
});

test("A6 · portal: el panel sigue entendiendo «ya resuelta» y «hueco ocupado»", () => {
  assert.deepEqual(respuestaAl409({ error: "not_pending" }), { texto: "Esta solicitud ya fue resuelta", refrescar: true, resuelta: true });
  assert.equal(respuestaAl409({ error: "slot_taken", autoRejected: true }).refrescar, true);
  assert.equal(respuestaAl409(null).texto, "Esta solicitud ya fue resuelta");
});

/* ── aceptar una solicitud de reserva web ──────────────────────────────── */

test("A6 · web: con un doctor en su comida, se acepta con el otro", async () => {
  const r = await aceptar();
  assert.deepEqual(r.tx, ["d2"], JSON.stringify(r.body));
});

test("A6 · web: los dos en su comida → 409 con la frase (y nada se crea)", async () => {
  enComida = ["d1", "d2"];
  const r = await aceptar();
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.code, "lunch_overlap");
  assert.match(r.body.error, /comida del doctor/);
  assert.equal(r.tx, null);
});

test("A6 · web: control — sin la bandera entran los dos", async () => {
  bandera = false;
  enComida = ["d1", "d2"];
  const r = await aceptar();
  assert.deepEqual([...(r.tx ?? [])].sort(), ["d1", "d2"]);
});
