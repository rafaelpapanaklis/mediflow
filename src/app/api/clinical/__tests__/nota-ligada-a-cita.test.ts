/**
 * WS1-T2 · La nota que se guarda desde el expediente queda ligada a SU cita.
 *
 * Run: npm run test:nota-ligada-a-cita
 *   (--experimental-test-module-mocks: se ejecuta el POST /api/clinical DE
 *   VERDAD. Se sustituyen Prisma, la sesión, la visibilidad del paciente, la
 *   auditoría y la caché de Next; la decisión de ligar es la real.)
 *
 * Lo que esta prueba no deja deshacer:
 *   · con UNA cita del paciente hoy, la nota se guarda con specialtyData.appointmentId
 *   · con DOS citas el mismo día, se guarda SIN ligar (no se adivina)
 *   · un appointmentId de OTRA clínica o de OTRO paciente se ignora, no se guarda
 *   · tampoco entra de contrabando por specialtyData.appointmentId
 *   · no se liga a la cita de OTRO doctor, a una que aún queda lejos, ni a una
 *     que ya tiene su nota
 *
 * El Prisma falso evalúa el `where` de verdad (clinicId, patientId, ventana de
 * startsAt) y LANZA si le falta el filtro de tenant o de paciente: una lectura
 * de citas sin esos filtros no puede pasar la prueba por accidente.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const CLINICA = "cli_1";
const OTRA_CLINICA = "cli_2";
const PACIENTE = "pat_1";
const OTRO_PACIENTE = "pat_2";

interface Cita { id: string; clinicId: string; patientId: string; startsAt: Date; status: string; doctorId?: string }
const DOCTOR = "u_dr";

const ahora = () => new Date();
const ayer = () => new Date(Date.now() - 36 * 3600 * 1000);

let CITAS: Cita[] = [];
let creadas: any[] = [];
let NOTAS_LIGADAS: string[] = [];
const enHoras = (h: number) => new Date(Date.now() + h * 3600 * 1000);

const prismaFalso: any = {
  appointment: {
    findMany: async ({ where, select }: any) => {
      if (typeof where?.clinicId !== "string" || !where.clinicId) throw new Error("findMany de citas SIN clinicId");
      if (typeof where?.patientId !== "string" || !where.patientId) throw new Error("findMany de citas SIN patientId");
      if (!(where?.startsAt?.gte instanceof Date) || !(where?.startsAt?.lt instanceof Date)) {
        throw new Error("findMany de citas SIN ventana de día");
      }
      return CITAS.filter((c) =>
        c.clinicId === where.clinicId && c.patientId === where.patientId &&
        c.startsAt >= where.startsAt.gte && c.startsAt < where.startsAt.lt,
      ).map((c) => ({ doctorId: DOCTOR, ...c })).map((c) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, (c as any)[k]])) : c));
    },
    findFirst: async () => { throw new Error("no se esperaba appointment.findFirst"); },
  },
  medicalRecord: {
    findFirst: async ({ where }: any) => {
      if (where?.clinicId !== CLINICA || !where?.patientId) throw new Error("findFirst de notas SIN tenant o paciente");
      const id = where?.specialtyData?.equals;
      return NOTAS_LIGADAS.includes(id) ? { id: "rec_previa" } : null;
    },
    create: async ({ data }: any) => {
      creadas.push(data);
      return { id: `rec_${creadas.length}`, ...data, doctor: { id: data.doctorId, firstName: "Ana", lastName: "Ruiz" } };
    },
  },
};

mock.module("@/lib/prisma", { namedExports: { prisma: prismaFalso } });
mock.module("@/lib/auth-context", {
  namedExports: {
    getAuthContext: async () => ({
      clinicId: CLINICA,
      userId: "u_dr",
      user: {
        id: "u_dr", role: "ADMIN", clinicId: CLINICA, permissionsOverride: [],
        clinic: { id: CLINICA, timezone: "America/Mexico_City" },
      },
    }),
  },
});
mock.module("@/lib/auth/require-permission", { namedExports: { denyIfMissingPermission: () => null } });
mock.module("@/lib/patient-visibility", { namedExports: { assertPatientVisible: async () => null } });
mock.module("@/lib/branches", {
  namedExports: {
    getVisiblePatientClinicIds: async () => [CLINICA],
    sharedRecordScope: () => ({}),
    ownPrivateRecordsOnly: () => ({}),
  },
});
mock.module("@/lib/audit", { namedExports: { logMutation: async () => {} } });
mock.module("@/lib/invoices/next-invoice-number", {
  namedExports: { nextInvoiceNumber: async () => "F-1", withInvoiceNumberRetry: async (fn: any) => fn() },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

async function guardar(cuerpo: Record<string, unknown>) {
  const { NextRequest } = await import("next/server");
  const { POST } = await import("../route");
  const res = await POST(new NextRequest("http://localhost/api/clinical", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patientId: PACIENTE, subjective: "Dolor en 36", ...cuerpo }),
  }));
  return { status: res.status, body: await res.json() };
}

beforeEach(() => { CITAS = []; creadas = []; NOTAS_LIGADAS = []; });

test("con UNA cita hoy, la nota queda ligada a ella", async () => {
  CITAS = [{ id: "cita_hoy", clinicId: CLINICA, patientId: PACIENTE, startsAt: ahora(), status: "CONFIRMED" }];
  const r = await guardar({ appointmentId: "cita_hoy", specialtyData: { type: "dental", status: "SIGNED" } });
  assert.equal(r.status, 201);
  assert.equal(creadas.length, 1);
  assert.equal(creadas[0].specialtyData.appointmentId, "cita_hoy");
  assert.equal(creadas[0].clinicId, CLINICA);
});

test("con DOS citas el mismo día se guarda SIN ligar", async () => {
  CITAS = [
    { id: "cita_a", clinicId: CLINICA, patientId: PACIENTE, startsAt: ahora(), status: "CONFIRMED" },
    { id: "cita_b", clinicId: CLINICA, patientId: PACIENTE, startsAt: ahora(), status: "SCHEDULED" },
  ];
  const r = await guardar({ appointmentId: "cita_a", specialtyData: { type: "dental" } });
  assert.equal(r.status, 201, "la nota se guarda igual");
  assert.equal(creadas.length, 1);
  assert.ok(!("appointmentId" in creadas[0].specialtyData), "no se adivina entre dos citas");
});

test("dos citas, pero una CANCELADA: la que queda viva sí se liga", async () => {
  CITAS = [
    { id: "cita_a", clinicId: CLINICA, patientId: PACIENTE, startsAt: ahora(), status: "CANCELLED" },
    { id: "cita_b", clinicId: CLINICA, patientId: PACIENTE, startsAt: ahora(), status: "CHECKED_IN" },
  ];
  await guardar({ appointmentId: "cita_b", specialtyData: {} });
  assert.equal(creadas[0].specialtyData.appointmentId, "cita_b");
  creadas = [];
  await guardar({ appointmentId: "cita_a", specialtyData: {} });
  assert.ok(!("appointmentId" in creadas[0].specialtyData), "una cita cancelada no se liga");
});

test("un appointmentId de OTRA clínica se ignora", async () => {
  CITAS = [{ id: "cita_ajena", clinicId: OTRA_CLINICA, patientId: PACIENTE, startsAt: ahora(), status: "CONFIRMED" }];
  const r = await guardar({ appointmentId: "cita_ajena", specialtyData: {} });
  assert.equal(r.status, 201);
  assert.ok(!("appointmentId" in creadas[0].specialtyData));
});

test("un appointmentId de OTRO paciente se ignora", async () => {
  CITAS = [{ id: "cita_de_otro", clinicId: CLINICA, patientId: OTRO_PACIENTE, startsAt: ahora(), status: "CONFIRMED" }];
  const r = await guardar({ appointmentId: "cita_de_otro", specialtyData: {} });
  assert.equal(r.status, 201);
  assert.ok(!("appointmentId" in creadas[0].specialtyData));
});

test("una cita del paciente que NO es de hoy se ignora", async () => {
  CITAS = [{ id: "cita_vieja", clinicId: CLINICA, patientId: PACIENTE, startsAt: ayer(), status: "COMPLETED" }];
  await guardar({ appointmentId: "cita_vieja", specialtyData: {} });
  assert.ok(!("appointmentId" in creadas[0].specialtyData));
});

test("el id no entra de contrabando por specialtyData", async () => {
  CITAS = [{ id: "cita_ajena", clinicId: OTRA_CLINICA, patientId: OTRO_PACIENTE, startsAt: ahora(), status: "CONFIRMED" }];
  await guardar({ specialtyData: { type: "dental", appointmentId: "cita_ajena" } });
  assert.ok(!("appointmentId" in creadas[0].specialtyData));
  assert.equal(creadas[0].specialtyData.type, "dental", "el resto de specialtyData se conserva");
});

test("sin appointmentId, o con basura, se guarda sin ligar y sin leer citas", async () => {
  CITAS = [{ id: "cita_hoy", clinicId: CLINICA, patientId: PACIENTE, startsAt: ahora(), status: "CONFIRMED" }];
  for (const raro of [undefined, null, "", 42, { id: "cita_hoy" }, ["cita_hoy"]]) {
    creadas = [];
    const r = await guardar({ appointmentId: raro, specialtyData: {} });
    assert.equal(r.status, 201, `con ${JSON.stringify(raro)} la nota se guarda`);
    assert.ok(!("appointmentId" in creadas[0].specialtyData));
  }
});

test("la cita de OTRO doctor no se liga a mi nota", async () => {
  CITAS = [{ id: "cita_dra_b", clinicId: CLINICA, patientId: PACIENTE, startsAt: ahora(), status: "CONFIRMED", doctorId: "u_otra" }];
  await guardar({ appointmentId: "cita_dra_b", specialtyData: {} });
  assert.ok(!("appointmentId" in creadas[0].specialtyData));
});

test("una cita que empieza dentro de muchas horas todavía no es esta consulta", async () => {
  // Solo se puede probar si «dentro de 5 h» sigue siendo hoy en la zona de la clínica.
  const lejos = enHoras(5);
  const dia = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
  if (dia(lejos) !== dia(new Date())) return;
  CITAS = [{ id: "cita_tarde", clinicId: CLINICA, patientId: PACIENTE, startsAt: lejos, status: "SCHEDULED" }];
  await guardar({ appointmentId: "cita_tarde", specialtyData: {} });
  assert.ok(!("appointmentId" in creadas[0].specialtyData));
});

test("una cita que YA tiene nota no recibe una segunda", async () => {
  CITAS = [{ id: "cita_hoy", clinicId: CLINICA, patientId: PACIENTE, startsAt: ahora(), status: "COMPLETED" }];
  NOTAS_LIGADAS = ["cita_hoy"];
  const r = await guardar({ appointmentId: "cita_hoy", specialtyData: {} });
  assert.equal(r.status, 201);
  assert.ok(!("appointmentId" in creadas[0].specialtyData));
});
