/**
 * WS1-T3 v5 · revisión t8 de la v4, N1: reactivar una cita CANCELADA cuyo
 * evento de Google ya es OTRA cita viva.
 *
 * El camino: recepción convierte el bloqueo del Dr. JG (cita a1) y la cancela;
 * el bloqueo vuelve (m1) y alguien lo convierte otra vez (cita a2, MISMO
 * evento). Si ahora un admin reactiva a1, quedarían dos citas vivas con un
 * evento: la hora de una pisaría la de la otra en Google (H2). La ruta de
 * estado contesta 409 «Ese evento de Google ya es otra cita» en el idioma de la
 * clínica, antes del «¿Seguro?» de sobreagendar y otra vez dentro de la
 * transacción (con candado: alguien puede estar convirtiendo a la vez).
 *
 * Llama al HANDLER REAL (`PATCH /api/appointments/[id]/status`) y al
 * `convertir.server` real con dobles de la base, la sesión, WhatsApp y Google:
 * ⛔ no sale ningún mensaje ni se toca ninguna base.
 * `npm run test:google-entrante`
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { idEventoDeCita } from "@/lib/google-calendar";
import es from "@/i18n/dictionaries/es.json";
import en from "@/i18n/dictionaries/en.json";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

type Cita = { id: string; clinicId: string; status: string; startsAt: Date; endsAt: Date; googleCalendarEventId: string | null; [k: string]: unknown };
let citas: Cita[];
let locale: string;
let candados: any[];
let sincronizadas: string[];
/** Algo que pasa justo cuando la reactivación toma el candado (otra conversión que ganó). */
let alTomarCandado: (() => void) | null;

beforeEach(() => {
  const inicio = new Date(Math.floor((Date.now() + 3 * DAY) / MIN) * MIN);
  const base = { clinicId: "c1", patientId: "p1", doctorId: "u-jg", resourceId: null, overrideReason: null, overriddenBy: null, overriddenAt: null, startsAt: inicio, endsAt: new Date(inicio.getTime() + 30 * MIN) };
  citas = [
    { ...base, id: "a1", status: "CANCELLED", googleCalendarEventId: "ev1" },
    { ...base, id: "a2", status: "SCHEDULED", googleCalendarEventId: "ev1" },
    // Otra clínica con el mismo id de evento: nunca cuenta.
    { ...base, id: "z1", clinicId: "c2", status: "SCHEDULED", googleCalendarEventId: "ev-c2" },
  ];
  locale = "es";
  candados = [];
  sincronizadas = [];
  alTomarCandado = null;
});

const cumple = (c: Cita, w: any): boolean =>
  Object.entries(w ?? {}).every(([k, v]: [string, any]) => {
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("not" in v) return c[k] !== v.not;
      return true;
    }
    return c[k] === v;
  });

const appointment = {
  findFirst: async ({ where }: any) => {
    assert.equal(where.clinicId, "c1", "siempre con el clinicId de la sesión");
    const c = citas.find((x) => cumple(x, where));
    return c ? { ...c, patient: { id: "p1", firstName: "Juan", lastName: "Pérez" }, doctor: { id: "u-jg", firstName: "J", lastName: "G" } } : null;
  },
  updateMany: async ({ where, data }: any) => {
    const xs = citas.filter((x) => cumple(x, where));
    for (const x of xs) Object.assign(x, data);
    return { count: xs.length };
  },
};
const agendaBlockGoogle = {
  updateMany: async (a: any) => {
    candados.push(a);
    alTomarCandado?.();
    return { count: 1 };
  },
};
const prismaStub: any = {
  appointment,
  agendaBlockGoogle,
  clinic: { findUnique: async ({ where }: any) => (where.id === "c1" ? { locale } : null) },
  appointmentTimeline: { findUnique: async () => null, upsert: async () => undefined },
  // La sonda de tablas de Google (`tablasGoogleListas`).
  $queryRaw: async () => [{ existe: true }],
  // Como Postgres: si algo lanza dentro, nada de lo escrito queda.
  $transaction: async (fn: any) => {
    const antes = citas.map((c) => ({ ...c }));
    try {
      return await fn({ appointment, agendaBlockGoogle });
    } catch (e) {
      citas = antes;
      throw e;
    }
  },
};

const session = {
  user: { id: "u-admin", role: "ADMIN", clinicId: "c1", displayName: "Admin", permissionsOverride: [] },
  clinic: { id: "c1", name: "Rafael Clinica", category: "DENTAL", timezone: "America/Mexico_City", defaultSlotMinutes: 30, schedules: [] },
};

(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
(mock as any).module("@/lib/agenda/api-helpers", { namedExports: { loadClinicSession: async () => session, requireRole: () => null } });
(mock as any).module("@/lib/auth/require-permission", { namedExports: { denyIfMissingPermission: () => null } });
(mock as any).module("@/lib/agenda/server", { namedExports: { appointmentToDTO: (a: any) => ({ id: a.id, status: a.status }) } });
(mock as any).module("@/lib/patient-visibility", { namedExports: { assertPatientVisible: async () => null } });
(mock as any).module("@/lib/reviews/invite", { namedExports: { sendReviewInvitation: async () => undefined } });
(mock as any).module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => undefined, revalidatePatientProfile: () => undefined } });
(mock as any).module("@/lib/whatsapp/avisos-cita", { namedExports: { avisarCitaPorWhatsApp: async () => ({ enviado: false, motivo: "doble" }) } });
(mock as any).module("@/lib/anticipos/cita-cancelada.server", { namedExports: { decidirDineroDeCitaCancelada: async () => ({ ok: true }), dineroDeLaCita: async () => null } });
(mock as any).module("@/lib/agenda/google-sync", { namedExports: { sincronizarCitaEnSegundoPlano: async (_c: string, id: string) => { sincronizadas.push(id); } } });
(mock as any).module("@/lib/reminders/reschedule.server", { namedExports: { cancelPendingRemindersForAppointment: async () => 0 } });
(mock as any).module("@/lib/movimientos-paciente/registrar", { namedExports: { registrarMovimientoDelPaciente: async () => undefined } });
(mock as any).module("@/lib/movimientos-paciente/zona", { namedExports: { zonaDeClinica: async () => "America/Mexico_City" } });
// Sin agenda flexible: reabrir no pregunta «¿Seguro?» (lo decide el no-solape de la base).
(mock as any).module("@/lib/agenda/agenda-flexible.server", { namedExports: { leerAgendaFlexibleConFallo: async () => ({ ajustes: { encendida: false }, fallo: false }) } });

async function reactivar(id = "a1") {
  const { PATCH } = await import("@/app/api/appointments/[id]/status/route");
  const req = new Request("http://localhost/x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "SCHEDULED" }) });
  return PATCH(req as any, { params: Promise.resolve({ id }) });
}
const a1 = () => citas.find((c) => c.id === "a1")!;

test("N1: reactivar la cita cancelada cuyo evento ya es OTRA cita viva → 409 «Ese evento de Google ya es otra cita»; la cita sigue cancelada y nada va a Google", async () => {
  const res = await reactivar();
  assert.equal(res.status, 409);
  const cuerpo = await res.json();
  assert.equal(cuerpo.error, "google_event_taken");
  assert.equal(cuerpo.reason, (es as any).agenda.google.eventoYaEsOtraCita, "las pantallas que reactivan enseñan `reason`");
  assert.match(cuerpo.reason, /^Ese evento de Google ya es otra cita/);
  assert.equal(a1().status, "CANCELLED");
  assert.deepEqual(sincronizadas, []);
  assert.equal(candados.length, 0, "se paró antes de la transacción");
});

test("N1: en una clínica en inglés el motivo sale en inglés", async () => {
  locale = "en";
  const res = await reactivar();
  assert.equal(res.status, 409);
  assert.equal((await res.json()).reason, (en as any).agenda.google.eventoYaEsOtraCita);
});

test("N1: si la otra cita del evento también está cancelada (o es de otra clínica), se reactiva como siempre", async () => {
  citas.find((c) => c.id === "a2")!.status = "CANCELLED";
  citas.find((c) => c.id === "z1")!.googleCalendarEventId = "ev1";
  const res = await reactivar();
  assert.equal(res.status, 200);
  assert.equal(a1().status, "SCHEDULED");
  assert.deepEqual(sincronizadas, ["a1"], "y Google se pone al día como siempre");
  // Dentro de la transacción, el candado sobre los vínculos del evento, de esta clínica.
  assert.deepEqual(candados.map((c) => c.where), [{ clinicId: "c1", googleEventId: "ev1" }]);
});

test("N1: una cita con SU evento (id determinista de DaleControl) ni se consulta: se reactiva como siempre", async () => {
  const propio = idEventoDeCita("c1", "a1");
  a1().googleCalendarEventId = propio;
  citas.find((c) => c.id === "a2")!.googleCalendarEventId = propio; // ni aunque otra lo tuviera (no puede)
  const res = await reactivar();
  assert.equal(res.status, 200);
  assert.equal(candados.length, 0);
});

test("N1: a la vez — la comprobación de fuera pasa, pero mientras tanto convirtieron el bloqueo: dentro de la transacción se ve, 409 y la reactivación se deshace", async () => {
  citas.find((c) => c.id === "a2")!.status = "CANCELLED";
  alTomarCandado = () => {
    // La conversión que tenía el candado termina: su cita (a3) ya está ligada al evento.
    citas.push({ ...a1(), id: "a3", status: "SCHEDULED", googleCalendarEventId: "ev1" });
  };
  const res = await reactivar();
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, "google_event_taken");
  assert.equal(a1().status, "CANCELLED", "la transacción se deshizo");
  assert.deepEqual(sincronizadas, []);
});
