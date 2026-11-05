/**
 * Factura de una cita «Sin doctor» (ws1-t11 · fase 2 · P2, PLAN §1.6).
 *
 * Run: node_modules/.bin/tsx --test src/lib/invoices/__tests__/doctor-de-factura-sin-doctor.test.ts
 *
 * Regla (v2, decisión M1-a de la revisión de t12): con una cita ligada «Sin doctor» —por atender o ya
 * atendida sin consulta— la factura NO adivina con el plan, la cabecera ni las citas del día: nace sin
 * doctor y el dinero sigue al doctor que se le ponga a la cita. Solo la nota de esa cita dice quién
 * atendió, y su autor pasa por la validación `ATIENDE_WHERE` (m3). Con doctor en la cita, nada cambia.
 * Nunca cae a quien pulsa Guardar. Con f4d8fe31d falla «toma la nota»; con f63681a44 (v1) fallan las
 * de «ya atendida» (adivinaba el plan o la cabecera) y la de la nota de quien no atiende.
 *
 * El db es un doble que se inyecta (segundo argumento); `@/lib/prisma` se dobla con Module._load
 * para que nada abra una conexión real. Ids cuid, de siembra y una cita importada de Dentalink.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
const prismaQueNoSeUsa = new Proxy({}, { get: () => { throw new Error("se usó el prisma global en vez del db inyectado"); } });
Mod._load = function (req: string, ...r: unknown[]) {
  if (req === "@/lib/prisma") return { prisma: prismaQueNoSeUsa };
  return cargaOriginal.call(this, req, ...r);
};

const CLINICA = "cmclinic0000qa00000000001";
const PACIENTE = "cmpac000000000000000ana01";
const DRA = "cmabc123xyz0000def456ghi"; // cuid
const DR_SIEMBRA = "seed-doctor-1"; // id de siembra
const RECEPCION = "cmrecep00000000000000001"; // quien pulsa Guardar: nunca es el doctor de la factura
const CITA_DENTALINK = "dentalink-appt-88231"; // importada, sin doctor
const TZ = "America/Mexico_City";
const AHORA = new Date("2026-11-04T18:00:00Z"); // 12:00 en CDMX
const HOY = new Date("2026-11-04T16:00:00Z");

type Cita = { id: string; clinicId: string; patientId: string; doctorId: string | null; startsAt: Date; status: string };
let citas: Cita[];
let planes: Array<{ clinicId: string; patientId: string; doctorId: string; status: string }>;
let casos: Array<{ clinicId: string; patientId: string; treatingDoctorId: string; status: string }>;
let cabecera: string | null;
let lecturas: string[];

beforeEach(() => {
  citas = [{ id: CITA_DENTALINK, clinicId: CLINICA, patientId: PACIENTE, doctorId: null, startsAt: HOY, status: "COMPLETED" }];
  planes = [];
  casos = [];
  cabecera = null;
  lecturas = [];
});

const usuarios = [
  { id: DRA, clinicId: CLINICA, role: "DOCTOR", isActive: true },
  { id: DR_SIEMBRA, clinicId: CLINICA, role: "ADMIN", isActive: true },
  { id: RECEPCION, clinicId: CLINICA, role: "RECEPTIONIST", isActive: true },
];

const db: any = {
  appointment: {
    findFirst: async ({ where }: any) => {
      lecturas.push("cita");
      assert.equal(where.clinicId, CLINICA, "la cita se busca con el clinicId de la sesión");
      const c = citas.find((x) => x.id === where.id && x.clinicId === where.clinicId && x.patientId === where.patientId);
      return c ? { doctorId: c.doctorId, status: c.status, startsAt: c.startsAt } : null;
    },
    findMany: async ({ where }: any) => {
      lecturas.push("citasDeHoy");
      assert.equal(where.clinicId, CLINICA);
      return citas
        .filter((x) => x.clinicId === where.clinicId && x.patientId === where.patientId
          && x.startsAt >= where.startsAt.gte && x.startsAt < where.startsAt.lt
          && !(where.status?.notIn ?? []).includes(x.status))
        .map((x) => ({ doctorId: x.doctorId }));
    },
  },
  treatmentPlan: {
    findMany: async ({ where }: any) => {
      lecturas.push("planes");
      assert.equal(where.clinicId, CLINICA);
      return planes.filter((p) => p.clinicId === where.clinicId && p.patientId === where.patientId).map((p) => ({ doctorId: p.doctorId, status: p.status }));
    },
  },
  orthodonticTreatmentPlan: {
    findMany: async ({ where }: any) => {
      assert.equal(where.clinicId, CLINICA);
      return casos.filter((c) => c.clinicId === where.clinicId && c.patientId === where.patientId).map((c) => ({ treatingDoctorId: c.treatingDoctorId, status: c.status }));
    },
  },
  patient: {
    findFirst: async ({ where }: any) => {
      lecturas.push("cabecera");
      assert.equal(where.clinicId, CLINICA);
      return where.id === PACIENTE ? { primaryDoctorId: cabecera } : null;
    },
  },
  user: {
    findFirst: async ({ where }: any) => {
      assert.equal(where.clinicId, CLINICA, "el doctor se valida con clinicId");
      const u = usuarios.find((x) => x.id === where.id && x.clinicId === where.clinicId
        && (where.role?.in ?? [x.role]).includes(x.role) && (where.isActive === undefined || x.isActive === where.isActive));
      return u ? { id: u.id } : null;
    },
  },
};

async function doctorDe(extra: Record<string, unknown> = {}) {
  const { doctorDeFacturaNueva } = await import("../doctor-de-factura.server");
  return doctorDeFacturaNueva({ clinicId: CLINICA, patientId: PACIENTE, appointmentId: CITA_DENTALINK, timezone: TZ, now: AHORA, ...extra }, db);
}

test("cita «Sin doctor» + nota de esa cita → el doctor de la nota", async () => {
  assert.deepEqual(await doctorDe({ autorDeNota: DRA }), { doctorId: DRA, origen: "nota" });
});

test("m3: la nota de quien NO atiende (recepción) no le pone la factura: pasa por ATIENDE_WHERE y nace sin doctor", async () => {
  citas[0]!.status = "SCHEDULED"; // la «Sin doctor» por atender: en v1 esta rama devolvía la nota sin validarla
  const r = await doctorDe({ autorDeNota: RECEPCION });
  assert.deepEqual(r, { doctorId: null, origen: "ninguno" });
});

for (const estado of ["SCHEDULED", "CHECKED_IN", "COMPLETED", "CHECKED_OUT"]) {
  test(`M1-a: cita «Sin doctor» ${estado} sin nota → nace sin doctor aunque haya plan, cabecera o cita de hoy`, async () => {
    citas[0]!.status = estado;
    planes.push({ clinicId: CLINICA, patientId: PACIENTE, doctorId: DR_SIEMBRA, status: "ACTIVE" });
    cabecera = DRA;
    citas.push({ id: "cmcita0000000000000000002", clinicId: CLINICA, patientId: PACIENTE, doctorId: DRA, startsAt: HOY, status: "CONFIRMED" });
    const r = await doctorDe();
    assert.deepEqual(r, { doctorId: null, origen: "ninguno" });
    assert.notEqual(r.doctorId, RECEPCION);
    assert.deepEqual(lecturas, ["cita"], "no se leen pistas: el dinero sigue al doctor que se le ponga a la cita");
  });
}

test("con doctor en la cita, manda la cita (no se leen las demás pistas); una cita de otro paciente no deja seguir", async () => {
  citas[0]!.doctorId = DRA;
  planes.push({ clinicId: CLINICA, patientId: PACIENTE, doctorId: DR_SIEMBRA, status: "ACTIVE" });
  assert.deepEqual(await doctorDe({ autorDeNota: DR_SIEMBRA }), { doctorId: DRA, origen: "cita" });
  assert.deepEqual(lecturas, ["cita"]);

  citas[0]!.patientId = "cmotropaciente00000000001";
  assert.deepEqual(await doctorDe(), { doctorId: null, origen: "ninguno" });
});

test("sin cita ligada, las pistas de siempre (plan); una «Sin doctor» de hoy no cuenta como doctor", async () => {
  planes.push({ clinicId: CLINICA, patientId: PACIENTE, doctorId: DR_SIEMBRA, status: "ACTIVE" });
  assert.deepEqual(await doctorDe({ appointmentId: null }), { doctorId: DR_SIEMBRA, origen: "plan" });
});

test("el doctor elegido a mano o «Sin asignar» a propósito siguen mandando", async () => {
  planes.push({ clinicId: CLINICA, patientId: PACIENTE, doctorId: DR_SIEMBRA, status: "ACTIVE" });
  assert.deepEqual(await doctorDe({ pedido: null }), { doctorId: null, origen: "sin_asignar" });
  assert.deepEqual(await doctorDe({ pedido: DRA }), { doctorId: DRA, origen: "elegido" });
});
