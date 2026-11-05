/**
 * Cita «Sin doctor» en el PORTAL del paciente y en la página de confirmar del
 * recordatorio (ws1-t10 · fase 2 · P3).
 *
 * Run: npm run test:cita-sin-doctor-mensajes
 *
 * HANDLERS REALES con un Prisma de mentira que se porta como Postgres en lo que
 * aquí importa: `{ doctorId: null }` es IS NULL (empata con todas las «Sin
 * doctor») y `{ in: [null] }` revienta. Antes, una sola cita «Sin doctor»
 * dejaba al paciente sin ver NINGUNA cita (500) y el enlace de cada
 * recordatorio en una página de error.
 *  · GET /api/paciente/appointments: `doctorName: null`, sin «undefined».
 *  · Reagendar una «Sin doctor» desde el portal: SIEMPRE queda como solicitud
 *    (D6), aunque la clínica tenga la auto-aprobación; otra «Sin doctor» a esa
 *    hora no la bloquea. Con doctor, la auto-aprobación de siempre.
 *  · Los huecos del portal para una «Sin doctor»: los de la clínica y su sillón.
 *  · /cita/[token]/confirmar: sin la fila 👨‍⚕️.
 *  · Reserva web (D4): una «Sin doctor» no le quita horas a ningún doctor.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

const TZ = "America/Mexico_City";
const CL = "seed-clinica-salamanca";
const PAC = "clx9paci0a000108l4aaaa0001";
const DIA = "2031-03-11"; // martes, siempre en el futuro
const MIN = 60_000;
const en = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2031, 2, 11, h! + 6, m!)); // CDMX = UTC-6
};

let citas: any[];
let solicitudes: any[];
let reclamos: any[];
let autoAprobar: boolean;

beforeEach(() => {
  autoAprobar = true;
  solicitudes = [];
  reclamos = [];
  citas = [
    {
      id: "dentalink-cita-48213", clinicId: CL, patientId: PAC, doctorId: null, doctor: null, resourceId: null,
      type: "Limpieza", status: "SCHEDULED", holdExpiresAt: null, startsAt: en("10:00"), endsAt: en("10:30"),
      patient: { firstName: "Ana", lastName: "García" },
    },
    // Otra «Sin doctor» de OTRO paciente a las 12:00: no tiene por qué estorbar.
    { id: "seed-cita-sd-2", clinicId: CL, patientId: "otro", doctorId: null, resourceId: null, status: "SCHEDULED", holdExpiresAt: null, startsAt: en("12:00"), endsAt: en("12:30") },
    {
      id: "clx9cita0a000108l4aaaa0002", clinicId: CL, patientId: PAC, doctorId: "clx9doc0a000108l4aaaa0001",
      doctor: { firstName: "Luis", lastName: "Ruiz" }, resourceId: null, type: "Resina", status: "SCHEDULED", holdExpiresAt: null,
      startsAt: en("16:00"), endsAt: en("16:30"), patient: { firstName: "Ana", lastName: "García" },
    },
  ];
});

function validarComoPrisma(where: any): void {
  const visitar = (w: any) => {
    if (!w || typeof w !== "object") return;
    if (Array.isArray(w)) return w.forEach(visitar);
    for (const [k, v] of Object.entries(w)) {
      if (k === "in" && Array.isArray(v) && v.some((x) => x === null || x === undefined)) throw new Error("PrismaClientValidationError: `in` con null");
      visitar(v);
    }
  };
  visitar(where);
}
/** Lo que casa con un `where` de choque como en Postgres (null = IS NULL). */
function casa(a: any, where: any): boolean {
  if (where.clinicId && a.clinicId !== where.clinicId) return false;
  if ("doctorId" in where && a.doctorId !== where.doctorId) return false;
  if ("resourceId" in where && a.resourceId !== where.resourceId) return false;
  if (where.id?.not && a.id === where.id.not) return false;
  if (where.status?.notIn?.includes(a.status)) return false;
  if (where.startsAt?.lt && !(a.startsAt < where.startsAt.lt)) return false;
  if (where.endsAt?.gt && !(a.endsAt > where.endsAt.gt)) return false;
  return true;
}

const clinica = {
  timezone: TZ, patientChangesMinHours: 24, get patientChangesAutoApprove() { return autoAprobar; },
  schedules: [0, 1, 2, 3, 4].map((d) => ({ dayOfWeek: d, enabled: true, openTime: "09:00", closeTime: "18:00" })),
};

const prismaStub: any = {
  appointment: {
    findUnique: async ({ where }: any) => {
      const a = citas.find((c) => c.id === where.id);
      return a ? { ...a, clinic: clinica } : null;
    },
    findFirst: async ({ where }: any) => { validarComoPrisma(where); return citas.find((c) => casa(c, where)) ?? null; },
    findMany: async ({ where }: any) => {
      validarComoPrisma(where);
      if (where.patientId?.in) return citas.filter((c) => where.patientId.in.includes(c.patientId) && c.doctor !== undefined);
      return citas.filter((c) => casa(c, where));
    },
    updateMany: async (args: any) => { reclamos.push(args); return { count: 1 }; },
  },
  appointmentChangeRequest: {
    findFirst: async () => null,
    findMany: async () => [],
    create: async ({ data }: any) => { solicitudes.push(data); return { id: `cr-${solicitudes.length}`, ...data }; },
  },
  patientAccountLink: {
    findMany: async () => [{ clinicId: CL, patient: { id: PAC, patientNumber: "P1", clinic: { id: CL, name: "Centro Dental Salamanca QA", slug: "salamanca", logoUrl: null, city: null, phone: null, patientChangesMinHours: 24, patientChangesAutoApprove: true } } }],
  },
  agendaBlock: { findMany: async ({ where }: any) => { validarComoPrisma(where); return []; } },
  doctorSchedule: { findMany: async () => [] },
  clinicFeatureFlag: { findMany: async () => [] },
  $queryRaw: async () => [],
  $transaction: async (fn: any) => fn(prismaStub),
};

mock.module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
mock.module("@/lib/patient-portal/guard", {
  namedExports: {
    getPatientPortalContext: async () => ({ account: { id: "acc-1" }, links: [{ patientId: PAC, clinicId: CL }] }),
    pacienteUnauthorized: () => new Response(null, { status: 401 }),
  },
});
mock.module("@/lib/reminders/reschedule.server", {
  namedExports: { applyReminderReschedule: async () => ({ cancelled: 0, created: 0 }), cancelPendingRemindersForAppointment: async () => 0 },
});
mock.module("@/lib/appointment-change/notify", { namedExports: { notifyPatientChangeResolution: async () => undefined } });
mock.module("@/lib/movimientos-paciente/registrar", { namedExports: { registrarMovimientoExterno: async () => undefined } });
mock.module("@/lib/agenda/google-sync", { namedExports: { sincronizarCitaEnSegundoPlano: async () => undefined } });
mock.module("@/lib/agenda/sobreagendar.server", { namedExports: { quitarMarcaDeSobreagenda: async () => undefined } });
mock.module("@/lib/anticipos/cita-cancelada.server", { namedExports: { marcarPendienteSiHayDinero: async () => undefined } });
mock.module("@/lib/whatsapp/send-and-log", { namedExports: { sendWhatsAppLogged: async () => { throw new Error("aquí no se manda nada"); } } });
mock.module("@/lib/failban", { namedExports: { persistentRateLimit: async () => null } });
mock.module("@/lib/reserva-web/db", { namedExports: { reservaWebAbierta: async () => true } });
mock.module("next/navigation", { namedExports: { notFound: () => { throw new Error("NOT_FOUND"); }, useRouter: () => ({ refresh() {} }) } });

function req(body: unknown, url = "http://localhost/api/paciente/appointments/x/change-request"): any {
  return { json: async () => body, headers: new Headers(), url, nextUrl: new URL(url) };
}
async function pedirCambio(citaId: string, hora: string) {
  const { POST } = await import("@/app/api/paciente/appointments/[id]/change-request/route");
  const res = await POST(req({ type: "RESCHEDULE", date: DIA, startTime: hora }), { params: Promise.resolve({ id: citaId }) });
  return { status: res.status, body: await res.json() };
}

test("🔴 el portal lista una cita «Sin doctor» (antes: 500 y el paciente no veía ninguna)", async () => {
  const { GET } = await import("@/app/api/paciente/appointments/route");
  const res = await GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  const sd = body.upcoming.find((c: any) => c.id === "dentalink-cita-48213");
  assert.equal(sd.doctorName, null);
  const con = body.upcoming.find((c: any) => c.id === "clx9cita0a000108l4aaaa0002");
  assert.equal(con.doctorName, "Luis Ruiz", "con doctor, «Nombre Apellido» como siempre");
  assert.doesNotMatch(JSON.stringify(body), /undefined/);
});

test("🔴 reagendar una «Sin doctor» desde el portal queda como SOLICITUD aunque la clínica auto-apruebe (D6)", async () => {
  // A las 12:00 hay OTRA «Sin doctor»: no la bloquea (no son de nadie).
  const r = await pedirCambio("dentalink-cita-48213", "12:00");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true, autoApproved: false, status: "PENDING" });
  assert.equal(solicitudes.length, 1);
  assert.equal(solicitudes[0].clinicId, CL, "clinicId de la cita, nunca del cuerpo");
  assert.equal(reclamos.length, 0, "la cita NO se movió");
});

test("con doctor y auto-aprobación, se mueve sola como siempre", async () => {
  const r = await pedirCambio("clx9cita0a000108l4aaaa0002", "17:00");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.autoApproved, true);
  assert.equal(reclamos.length, 1);
  // Revisión m1: el reclamo exige el MISMO doctor; si recepción se lo quitó entretanto, no se mueve sola.
  assert.equal(reclamos[0].where.doctorId, "clx9doc0a000108l4aaaa0001");
});

test("una «Sin doctor» con sillón sí choca con otra cita en ESE sillón (slot_taken)", async () => {
  citas[0].resourceId = "res_sillon_1";
  citas[1].resourceId = "res_sillon_1";
  const r = await pedirCambio("dentalink-cita-48213", "12:00");
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "slot_taken");
});

test("huecos del portal para una «Sin doctor»: los de la clínica, y otra «Sin doctor» no tapa nada", async () => {
  const { GET } = await import("@/app/api/paciente/appointments/[id]/slots/route");
  const res = await GET(req(null, `http://localhost/api/paciente/appointments/x/slots?date=${DIA}`), { params: Promise.resolve({ id: "dentalink-cita-48213" }) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.slots.includes("12:00"), JSON.stringify(body.slots));
  assert.ok(body.slots.includes("16:00"), "la cita del Dr. Ruiz tampoco ocupa a una «Sin doctor»");
  assert.equal(body.slots[0], "09:00");
  assert.equal(body.slots.at(-1), "17:30", "horario de la clínica completo");
});

test("🔴 /cita/[token]/confirmar de una «Sin doctor»: la página carga y no pinta la fila del doctor", async () => {
  const MANANA = new Date(Date.now() + 24 * 60 * MIN);
  prismaStub.appointment.findUnique = async () => ({
    startsAt: MANANA, status: "SCHEDULED", doctor: null,
    clinic: { name: "Centro Dental Salamanca QA", logoUrl: null, phone: null, address: null, city: null, timezone: TZ },
    patient: { firstName: "Ana" },
  });
  const { default: Pagina } = await import("@/app/cita/[token]/confirmar/page");
  const el: any = await Pagina({ params: Promise.resolve({ token: "tok-1" }) } as any);
  assert.equal(el.props.info.doctorName, null);
  const html = renderToStaticMarkup(el);
  assert.doesNotMatch(html, /👨‍⚕️|undefined|null|Dr\/a\./, html);
  assert.match(html, /Centro Dental Salamanca QA/);
});

test("reserva web (D4): dos «Sin doctor» a las 12:00 no le quitan esa hora a ningún doctor", async () => {
  const DOC = "clx9doc0a000108l4aaaa0001";
  prismaStub.clinic = {
    findUnique: async () => ({
      id: CL, name: "Centro Dental Salamanca QA", slug: "salamanca", specialty: null, timezone: TZ, phone: null, address: null, city: null, logoUrl: null,
      schedules: clinica.schedules,
      users: [{ id: DOC, firstName: "Luis", lastName: "Ruiz", specialty: null, color: null }],
    }),
  };
  citas.push({ id: "seed-cita-sd-3", clinicId: CL, patientId: "otro2", doctorId: null, resourceId: null, status: "SCHEDULED", holdExpiresAt: null, startsAt: en("12:00"), endsAt: en("12:30") });
  const { GET } = await import("@/app/api/public/availability/route");
  for (const doctorId of ["any", DOC]) {
    const res = await GET(req(null, `http://localhost/api/public/availability?slug=salamanca&date=${DIA}&doctorId=${doctorId}`));
    assert.equal(res.status, 200);
    const body = await res.json();
    const libres: string[] = body.availableSlots ?? body.slots;
    assert.ok(libres.includes("12:00"), `${doctorId}: ${JSON.stringify(body)}`);
    assert.ok(!libres.includes("16:00"), `${doctorId}: la cita del Dr. Ruiz sí ocupa`);
  }
});
