/**
 * Seguridad ola 2b · v2 · M1 de la revisión t5, camino B — cancelar por
 * PATCH /api/appointments/[id]/status una cita que el paciente YA usó (llegó,
 * pasó al sillón) y mandar en la misma petición `dineroCita: "a_favor"`.
 *
 * Recepción (FRONT_DESK) puede cancelar desde CHECKED_IN e IN_CHAIR, y con
 * billing.charge `decisionEfectiva` dejaba pasar «a favor»: lo cobrado al
 * llegar volvía como saldo a favor. Ahora, con la cita atendida, «a favor»
 * pide billing.refund; sin él, el dinero queda «pendiente de decidir».
 *
 * Handler REAL de la ruta y servicio REAL (`decidirDineroDeCitaCancelada`)
 * sobre la base en memoria; ⛔ WhatsApp, Google, recordatorios y movimientos
 * son dobles que no hacen nada.
 *
 * Run: npm run test:seg-ola2b
 */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import { DobleBase } from "@/lib/anticipos/__tests__/doble-base";

const RAIZ = process.cwd();
const CLINICA = "c1";
const FACTURADA = new Date(Date.now() - 2 * 3600_000);

let db: DobleBase;
const sesion: { rol: string } = { rol: "RECEPTIONIST" };

function cliente() {
  const c = db.cliente();
  c.$executeRaw = async () => 0;
  return c;
}
const prismaProxy = new Proxy({}, { get: (_t, k) => (cliente() as any)[k] });

const nada = async () => undefined;
const dobles = new Map<string, unknown>([
  [path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prismaProxy }],
  [path.join(RAIZ, "src/lib/agenda/api-helpers.ts"), {
    loadClinicSession: async () => ({
      user: { id: "u1", role: sesion.rol, clinicId: CLINICA, displayName: "Rita", permissionsOverride: [] },
      clinic: { id: CLINICA, name: "Clínica", category: "DENTAL", timezone: "America/Mexico_City", defaultSlotMinutes: 30, schedules: [] },
    }),
    requireRole: () => null,
  }],
  [path.join(RAIZ, "src/lib/agenda/server.ts"), { appointmentToDTO: (a: any) => ({ id: a.id, status: a.status }) }],
  [path.join(RAIZ, "src/lib/patient-visibility.ts"), { assertPatientVisible: async () => null }],
  [path.join(RAIZ, "src/lib/cache/revalidate.ts"), { revalidateAfter: () => undefined, revalidatePatientProfile: () => undefined }],
  [path.join(RAIZ, "src/lib/reminders/reschedule.server.ts"), { cancelPendingRemindersForAppointment: async () => 0 }],
  [path.join(RAIZ, "src/lib/whatsapp/avisos-cita.ts"), { avisarCitaPorWhatsApp: async () => ({ enviado: false, motivo: "doble" }) }],
  [path.join(RAIZ, "src/lib/movimientos-paciente/registrar.ts"), { registrarMovimientoDelPaciente: nada }],
  [path.join(RAIZ, "src/lib/movimientos-paciente/zona.ts"), { zonaDeClinica: async () => "America/Mexico_City" }],
  [path.join(RAIZ, "src/lib/agenda/google-sync.ts"), { sincronizarCitaEnSegundoPlano: nada }],
  [path.join(RAIZ, "src/lib/reviews/invite.ts"), { sendReviewInvitation: nada }],
  [path.join(RAIZ, "src/lib/walk-in/cerrar-fila-de-la-cita.ts"), { cerrarFilaDeLaCita: nada }],
  [path.join(RAIZ, "src/lib/agenda/adelantar-cita-a-hoy.ts"), {
    MOTIVO_RECORDATORIOS_ADELANTO: "x", adelantoParaRespuesta: () => null, prepararAdelantoAHoy: async () => null,
  }],
  [path.join(RAIZ, "src/lib/audit.ts"), { logAudit: nada, logMutation: nada }],
  [path.join(RAIZ, "src/lib/factura-mp/servicio.server.ts"), { cerrarLinksDeFactura: async () => 0 }],
  [path.join(RAIZ, "src/lib/anticipos/panel.server.ts"), { cerrarAnticiposDePanel: async () => 0 }],
]);
const M = Module as unknown as {
  _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (req: string, parent: unknown, isMain: boolean) => string;
};
const cargaOriginal = M._load;
M._load = function (req, parent, isMain) {
  if (req === "server-only" || req === "client-only") return {};
  let resuelto: string | null = null;
  try { resuelto = M._resolveFilename(req, parent, isMain); } catch { resuelto = null; }
  if (resuelto && dobles.has(resuelto)) return dobles.get(resuelto);
  return cargaOriginal.call(this, req, parent, isMain);
};

let PATCH: (req: any, props: any) => Promise<Response>;
before(async () => {
  ({ PATCH } = await import("@/app/api/appointments/[id]/status/route"));
});

beforeEach(() => {
  db = new DobleBase();
  (db.tablas as any).appointmentTimeline = [];
  sesion.rol = "RECEPTIONIST";
});

function escenario(cita: Record<string, unknown>) {
  const inicio = new Date(Date.now() - 3600_000);
  db.tablas.appointment.push({
    id: "a1", clinicId: CLINICA, patientId: "p1", doctorId: "d1", resourceId: "r1", status: "SCHEDULED",
    startsAt: inicio, endsAt: new Date(inicio.getTime() + 45 * 60_000), overrideReason: null, overriddenBy: null,
    overriddenAt: null, googleCalendarEventId: null, checkedInAt: null, startedAt: null, completedAt: null, cancelledAt: null,
    ...cita,
  });
  db.tablas.invoice.push({
    id: "inv1", clinicId: CLINICA, patientId: "p1", invoiceNumber: "MF-1", appointmentId: "a1", createdAt: FACTURADA,
    status: "PAID", total: 800, paid: 800, balance: 0, notes: null, cfdiUuid: null,
  });
  db.tablas.payment.push({ id: "pay1", invoiceId: "inv1", amount: 800, method: "cash", notes: null });
}
const inv = () => db.tablas.invoice.find((f) => f.id === "inv1")!;

async function cancelarConAFavor() {
  const res = await PATCH(
    new Request("http://localhost/api/appointments/a1/status", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "CANCELLED", dineroCita: "a_favor", notifyPatient: false }),
    }) as any,
    { params: Promise.resolve({ id: "a1" }) },
  );
  return { status: res.status, body: await res.json() };
}

test("🔴 camino B: recepción cancela una cita CHECKED_IN con «a favor» → queda «pendiente», la factura no se toca", async () => {
  escenario({ status: "CHECKED_IN", checkedInAt: FACTURADA });
  const r = await cancelarConAFavor();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(db.tablas.appointment[0].status, "CANCELLED", "la cita sí se cancela");
  assert.equal(r.body.dineroCita?.decision, "pendiente", JSON.stringify(r.body.dineroCita));
  assert.match(r.body.dineroCita?.motivo ?? "", /reembols/i);
  assert.equal(inv().status, "PAID");
  assert.equal(db.tablas.patientCredit.length, 0, "no nace saldo a favor");
});

test("🔴 camino B: recepción cancela una cita IN_CHAIR (sin check-in; solo timeline) con «a favor» → «pendiente»", async () => {
  escenario({ status: "IN_CHAIR" });
  (db.tablas as any).appointmentTimeline.push({ id: "tl1", appointmentId: "a1", arrivedAt: null, inChairAt: FACTURADA, consultStartAt: null, consultEndAt: null });
  const r = await cancelarConAFavor();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.dineroCita?.decision, "pendiente");
  assert.equal(inv().status, "PAID");
});

test("control: recepción cancela una cita CONFIRMADA que nunca se atendió con «a favor» → se aplica (H15)", async () => {
  escenario({ status: "CONFIRMED" });
  const r = await cancelarConAFavor();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.dineroCita?.decision, "a_favor", JSON.stringify(r.body.dineroCita));
  assert.equal(inv().status, "CANCELLED");
  assert.equal(db.tablas.patientCredit.reduce((s, c) => s + c.amount, 0), 800);
});

test("ADMIN (billing.refund) cancela una cita CHECKED_IN con «a favor» → se aplica", async () => {
  sesion.rol = "ADMIN";
  escenario({ status: "CHECKED_IN", checkedInAt: FACTURADA });
  const r = await cancelarConAFavor();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.dineroCita?.decision, "a_favor", JSON.stringify(r.body.dineroCita));
  assert.equal(inv().status, "CANCELLED");
});
