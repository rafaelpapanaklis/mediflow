/**
 * ws1-t8 · revisión de ws1-t9, fallo 1: «una nota por visita» se rompía en la ruta DENTAL.
 *
 * Run: npm run test:una-nota-por-visita
 *   (--experimental-test-module-mocks: se ejecutan POST /api/clinical y PATCH /api/appointments/[id]/complete
 *   DE VERDAD sobre una «base» en memoria; se sustituyen Prisma, la sesión, la visibilidad, la auditoría y la
 *   caché.)
 *
 * El caso de la revisión (Elena Prueba Cinco, P0166): «Iniciar consulta» crea el BORRADOR vacío ligado a la
 * cita → «Nueva consulta» → «Guardar consulta» (POST /api/clinical) → «Completar consulta» (PATCH complete).
 * Antes: una nota firmada SUELTA + el borrador vacío, y Completar daba 422. Ahora: la consulta se escribe en el
 * borrador (una sola nota, ligada a la cita) y Completar cierra la cita sin volver a firmarla.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const CLINICA = "cli_1";
const PACIENTE = "pat_1";
const DOCTOR = "u_dr";

interface Cita { id: string; clinicId: string; patientId: string; startsAt: Date; status: string; doctorId: string }
interface Nota {
  id: string; clinicId: string; patientId: string; doctorId: string; createdAt: Date;
  subjective: string | null; objective: string | null; assessment: string | null; plan: string | null;
  specialtyData: any; diagnoses?: any; vitals?: any;
}

let CITAS: Cita[] = [];
let NOTAS: Nota[] = [];
let creadas = 0;
let actualizadasDeNota: string[] = [];

const ahora = () => new Date();
const proyecta = (o: any, select?: any) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, o[k]])) : o);

function cumpleNota(n: Nota, where: any): boolean {
  if (typeof where?.clinicId !== "string" || !where.clinicId) throw new Error("lectura de notas SIN clinicId");
  if (typeof where?.patientId !== "string" || !where.patientId) throw new Error("lectura de notas SIN patientId");
  if (n.clinicId !== where.clinicId || n.patientId !== where.patientId) return false;
  if (where.id && n.id !== where.id) return false;
  if (where.specialtyData?.path?.[0] === "appointmentId" && n.specialtyData?.appointmentId !== where.specialtyData.equals) return false;
  return true;
}

const prismaFalso: any = {
  appointment: {
    findMany: async ({ where, select }: any) => {
      if (where?.clinicId !== CLINICA || !where?.patientId) throw new Error("citas SIN tenant o paciente");
      return CITAS.filter((c) =>
        c.clinicId === where.clinicId && c.patientId === where.patientId &&
        c.startsAt >= where.startsAt.gte && c.startsAt < where.startsAt.lt,
      ).map((c) => proyecta(c, select));
    },
    findFirst: async ({ where, select }: any) => {
      if (where?.clinicId !== CLINICA) throw new Error("cita SIN clinicId");
      const c = CITAS.find((x) => x.id === where.id && x.clinicId === where.clinicId);
      return c ? proyecta(c, select) : null;
    },
    update: async ({ where, data }: any) => {
      const c = CITAS.find((x) => x.id === where.id)!;
      Object.assign(c, data);
      return { ...c, patient: { id: c.patientId, firstName: "Elena", lastName: "Cinco" }, doctor: { id: c.doctorId, firstName: "Ana", lastName: "Ruiz" } };
    },
  },
  medicalRecord: {
    findFirst: async ({ where, select, orderBy }: any) => {
      let lista = NOTAS.filter((n) => cumpleNota(n, where));
      if (orderBy?.createdAt === "desc") lista = [...lista].sort((a, b) => +b.createdAt - +a.createdAt);
      return lista[0] ? proyecta(lista[0], select) : null;
    },
    create: async ({ data }: any) => {
      creadas++;
      const n: Nota = { id: `rec_nueva_${creadas}`, createdAt: new Date(), ...data };
      NOTAS.push(n);
      return { ...n, doctor: { id: n.doctorId, firstName: "Ana", lastName: "Ruiz" } };
    },
    update: async ({ where, data }: any) => {
      const n = NOTAS.find((x) => x.id === where.id);
      if (!n) throw new Error("update de una nota que no existe");
      actualizadasDeNota.push(n.id);
      Object.assign(n, data);
      return { ...n, doctor: { id: n.doctorId, firstName: "Ana", lastName: "Ruiz" } };
    },
  },
  $transaction: async (fn: any) => fn(prismaFalso),
};

const usuario = {
  id: DOCTOR, role: "DOCTOR", clinicId: CLINICA, permissionsOverride: [],
  clinic: { id: CLINICA, timezone: "America/Mexico_City" },
};

mock.module("@/lib/prisma", { namedExports: { prisma: prismaFalso } });
mock.module("@/lib/auth-context", {
  namedExports: { getAuthContext: async () => ({ clinicId: CLINICA, userId: DOCTOR, user: usuario }) },
});
mock.module("@/lib/agenda/api-helpers", {
  namedExports: {
    loadClinicSession: async () => ({ user: usuario, clinic: { id: CLINICA, category: "DENTAL" } }),
    requireRole: () => null,
  },
});
mock.module("@/lib/agenda/server", { namedExports: { appointmentToDTO: (a: any) => ({ id: a.id, status: a.status }) } });
mock.module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => {}, revalidatePatientProfile: () => {} } });
mock.module("@/lib/odontogram/snapshot", {
  namedExports: {
    ensureDentalCatalog: async () => { throw new Error("sin odontograma en la prueba"); },
    changesToTreatments: async () => [], createOrUpdateSnapshot: async () => ({ id: "s" }),
    diffSnapshots: () => [], findPreviousSnapshot: async () => null, readCurrentEntries: async () => [],
  },
});
mock.module("@/lib/reviews/invite", { namedExports: { sendReviewInvitation: async () => {} } });
mock.module("@/lib/movimientos-paciente/textos", { namedExports: { textoCita: { completada: () => "Completó la cita" } } });
mock.module("@/lib/movimientos-paciente/zona", { namedExports: { zonaDeClinica: async () => "America/Mexico_City" } });
mock.module("@/lib/auth/require-permission", { namedExports: { denyIfMissingPermission: () => null } });
mock.module("@/lib/patient-visibility", { namedExports: { assertPatientVisible: async () => null } });
mock.module("@/lib/branches", {
  namedExports: { getVisiblePatientClinicIds: async () => [CLINICA], sharedRecordScope: () => ({}), ownPrivateRecordsOnly: () => ({}) },
});
mock.module("@/lib/audit", { namedExports: { logMutation: async () => {} } });
mock.module("@/lib/patients/paciente-de-prueba-db", { namedExports: { esPacienteDePrueba: async () => false } });
mock.module("@/lib/invoices/next-invoice-number", {
  namedExports: { nextInvoiceNumber: async () => "F-1", withInvoiceNumberRetry: async (fn: any) => fn() },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

/** «Guardar consulta» del formulario dental: mismo cuerpo que dental-form.tsx (nace firmada). */
async function guardarConsulta(cuerpo: Record<string, unknown>) {
  const { NextRequest } = await import("next/server");
  const { POST } = await import("../route");
  const res = await POST(new NextRequest("http://localhost/api/clinical", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patientId: PACIENTE,
      subjective: "Dolor al masticar en 36",
      assessment: "Caries oclusal 36",
      specialtyData: { type: "dental", status: "SIGNED", procedures: [] },
      ...cuerpo,
    }),
  }));
  return { status: res.status, body: await res.json() };
}

/** «Completar consulta» de la barra de la ficha. */
async function completar(citaId: string, clinicalNoteId: string) {
  const { NextRequest } = await import("next/server");
  const { PATCH } = await import("../../appointments/[id]/complete/route");
  const res = await PATCH(new NextRequest(`http://localhost/api/appointments/${citaId}/complete`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clinicalNoteId, signNote: true }),
  }), { params: { id: citaId } } as any);
  return { status: res.status, body: await res.json() };
}

/** Lo que deja «Iniciar consulta»: la cita En consulta y su borrador (POST /api/clinical-notes). */
function iniciarConsulta(citaId: string, borrador: Partial<Nota> = {}) {
  const c = CITAS.find((x) => x.id === citaId)!;
  c.status = "IN_PROGRESS";
  NOTAS.push({
    id: "borrador_1", clinicId: CLINICA, patientId: PACIENTE, doctorId: DOCTOR, createdAt: new Date(),
    subjective: null, objective: null, assessment: null, plan: null,
    specialtyData: { status: "DRAFT", appointmentId: citaId, attachments: [] },
    ...borrador,
  });
}

beforeEach(() => {
  CITAS = [{ id: "cita_hoy", clinicId: CLINICA, patientId: PACIENTE, startsAt: ahora(), status: "CONFIRMED", doctorId: DOCTOR }];
  NOTAS = [];
  creadas = 0;
  actualizadasDeNota = [];
});

test("P0166: «Guardar consulta» escribe en el borrador de la cita — UNA nota, ligada y firmada", async () => {
  iniciarConsulta("cita_hoy");
  const r = await guardarConsulta({ appointmentId: "cita_hoy" });
  assert.equal(r.status, 201);
  assert.equal(creadas, 0, "no se crea una segunda nota suelta");
  assert.equal(NOTAS.length, 1, "la visita tiene una sola nota");
  assert.equal(r.body.id, "borrador_1", "la respuesta es el borrador adoptado (la ficha lo reemplaza en la lista)");
  const nota = NOTAS[0];
  assert.equal(nota.subjective, "Dolor al masticar en 36");
  assert.equal(nota.assessment, "Caries oclusal 36");
  assert.equal(nota.specialtyData.appointmentId, "cita_hoy", "sigue ligada a su cita");
  assert.equal(nota.specialtyData.status, "SIGNED");
  assert.equal(typeof nota.specialtyData.signedAt, "string");
  assert.equal(nota.specialtyData.type, "dental");
});

test("P0166: después, «Completar consulta» cierra la cita (antes: 422 por el borrador vacío) sin re-firmar la nota", async () => {
  iniciarConsulta("cita_hoy");
  const g = await guardarConsulta({ appointmentId: "cita_hoy" });
  const firmadaEn = NOTAS[0].specialtyData.signedAt;
  actualizadasDeNota = [];
  const c = await completar("cita_hoy", g.body.id);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(CITAS[0].status, "COMPLETED");
  assert.equal(c.body.clinicalNoteId, "borrador_1");
  assert.deepEqual(actualizadasDeNota, [], "una nota ya firmada no se vuelve a firmar");
  assert.equal(NOTAS[0].specialtyData.signedAt, firmadaEn, "su hora de firma es la de verdad");
});

test("lo que el doctor ya escribió en la barra de consulta no se pierde: va delante; los adjuntos se quedan", async () => {
  iniciarConsulta("cita_hoy", {
    subjective: "Viene por dolor",
    plan: "Control en 1 semana",
    specialtyData: { status: "DRAFT", appointmentId: "cita_hoy", attachments: [{ id: "f1" }] },
  });
  await guardarConsulta({ appointmentId: "cita_hoy", plan: "Resina 36" });
  const nota = NOTAS[0];
  assert.equal(nota.subjective, "Viene por dolor\n\nDolor al masticar en 36");
  assert.equal(nota.plan, "Control en 1 semana\n\nResina 36");
  assert.equal(nota.assessment, "Caries oclusal 36");
  assert.deepEqual(nota.specialtyData.attachments, [{ id: "f1" }]);
});

test("con OTRA cita del paciente ese día, la que está «En consulta» del doctor sí se liga (no es adivinar)", async () => {
  CITAS.push({ id: "cita_tarde", clinicId: CLINICA, patientId: PACIENTE, startsAt: ahora(), status: "SCHEDULED", doctorId: DOCTOR });
  iniciarConsulta("cita_hoy");
  await guardarConsulta({ appointmentId: "cita_hoy" });
  assert.equal(creadas, 0);
  assert.equal(NOTAS.length, 1);
  assert.equal(NOTAS[0].specialtyData.status, "SIGNED");
});

test("una cita con su nota ya FIRMADA no se toca: la nueva va suelta, como siempre", async () => {
  NOTAS.push({
    id: "firmada_previa", clinicId: CLINICA, patientId: PACIENTE, doctorId: DOCTOR, createdAt: new Date(),
    subjective: "Consulta de la mañana", objective: null, assessment: null, plan: null,
    specialtyData: { status: "SIGNED", appointmentId: "cita_hoy" },
  });
  await guardarConsulta({ appointmentId: "cita_hoy" });
  assert.equal(creadas, 1);
  assert.deepEqual(actualizadasDeNota, []);
  assert.equal(NOTAS[0].subjective, "Consulta de la mañana", "lo firmado no cambia");
  assert.ok(!("appointmentId" in NOTAS[1].specialtyData));
});

test("el borrador de OTRO paciente con la misma cita no se adopta (lectura con paciente y clínica)", async () => {
  NOTAS.push({
    id: "borrador_ajeno", clinicId: CLINICA, patientId: "pat_otro", doctorId: DOCTOR, createdAt: new Date(),
    subjective: null, objective: null, assessment: null, plan: null,
    specialtyData: { status: "DRAFT", appointmentId: "cita_hoy" },
  });
  await guardarConsulta({ appointmentId: "cita_hoy" });
  assert.equal(creadas, 1);
  assert.deepEqual(actualizadasDeNota, []);
});

test("la ficha manda al formulario dental la cita en consulta, y este la usa al guardar", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const SRC = join(__dirname, "..", "..", "..", "..");
  const form = readFileSync(join(SRC, "components/clinical/dental-form.tsx"), "utf8");
  assert.match(form, /const appointmentId = citaEnCursoId \?\? \(await fetchTodayAppointmentId\(patientId\)\);/);
  const ficha = readFileSync(join(SRC, "app/dashboard/patients/[id]/patient-detail-client.tsx"), "utf8");
  const dentales = ficha.match(/formularioConsulta === "dental"\s+&& <DentalForm[^\n]*/g) ?? [];
  assert.equal(dentales.length, 2);
  for (const l of dentales) assert.match(l, /citaEnCursoId=\{activeAppointment\?\.id \?\? null\}/);
  // Guardada la nota de la consulta, la lista la reemplaza (mismo id) en vez de duplicarla.
  assert.match(ficha, /setRecords\(prev => \[record, \.\.\.prev\.filter\(\(r: any\) => r\.id !== record\?\.id\)\]\);/);
});
