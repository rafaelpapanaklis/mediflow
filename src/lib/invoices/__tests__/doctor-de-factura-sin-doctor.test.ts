/**
 * Factura de una cita «Sin doctor» (ws1-t11 · fase 2 · P2, PLAN §1.6).
 *
 * Run: node_modules/.bin/tsx --test src/lib/invoices/__tests__/doctor-de-factura-sin-doctor.test.ts
 *
 * Con cita ligada, `doctorDeFacturaNueva` solo miraba `cita.doctorId`: con una cita «Sin doctor»
 * la factura nacía sin doctor aunque la nota, las citas de hoy, el plan o el doctor de cabecera
 * dijeran quién atiende. Ahora sigue con esas pistas, en el mismo orden de
 * `elegirDoctorDeFactura`, y nunca cae a quien pulsa Guardar. Con el código de f4d8fe31d fallan
 * «toma la nota», «toma el plan», «toma la cabecera» y «toma la cita de hoy» (daba `ninguno`).
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

test("cita «Sin doctor» + nota firmada → el doctor de la nota", async () => {
  assert.deepEqual(await doctorDe({ autorDeNota: DRA }), { doctorId: DRA, origen: "nota" });
});

test("cita «Sin doctor», sin nota ni otras citas hoy → el doctor del plan activo", async () => {
  planes.push({ clinicId: CLINICA, patientId: PACIENTE, doctorId: DR_SIEMBRA, status: "ACTIVE" });
  assert.deepEqual(await doctorDe(), { doctorId: DR_SIEMBRA, origen: "plan" });
  // La propia cita «Sin doctor» de hoy no cuenta como «dos doctores distintos» ni corta el plan.
  assert.ok(lecturas.includes("citasDeHoy") && lecturas.includes("planes"));
});

test("cita «Sin doctor» y otra cita de hoy con doctor → ese doctor (cita de hoy)", async () => {
  citas.push({ id: "cmcita0000000000000000002", clinicId: CLINICA, patientId: PACIENTE, doctorId: DRA, startsAt: HOY, status: "CONFIRMED" });
  assert.deepEqual(await doctorDe(), { doctorId: DRA, origen: "cita_de_hoy" });
});

test("cita «Sin doctor», sin plan → el doctor de cabecera", async () => {
  cabecera = DRA;
  assert.deepEqual(await doctorDe(), { doctorId: DRA, origen: "cabecera" });
});

test("cita «Sin doctor» sin ninguna pista → nace sin doctor (nunca quien pulsa Guardar)", async () => {
  const r = await doctorDe();
  assert.deepEqual(r, { doctorId: null, origen: "ninguno" });
  assert.notEqual(r.doctorId, RECEPCION);
});

test("con doctor en la cita, manda la cita (no se leen las demás pistas); una cita de otro paciente no deja seguir", async () => {
  citas[0]!.doctorId = DRA;
  planes.push({ clinicId: CLINICA, patientId: PACIENTE, doctorId: DR_SIEMBRA, status: "ACTIVE" });
  assert.deepEqual(await doctorDe({ autorDeNota: DR_SIEMBRA }), { doctorId: DRA, origen: "cita" });
  assert.deepEqual(lecturas, ["cita"]);

  citas[0]!.patientId = "cmotropaciente00000000001";
  assert.deepEqual(await doctorDe(), { doctorId: null, origen: "ninguno" });
});

test("el doctor elegido a mano o «Sin asignar» a propósito siguen mandando", async () => {
  planes.push({ clinicId: CLINICA, patientId: PACIENTE, doctorId: DR_SIEMBRA, status: "ACTIVE" });
  assert.deepEqual(await doctorDe({ pedido: null }), { doctorId: null, origen: "sin_asignar" });
  assert.deepEqual(await doctorDe({ pedido: DRA }), { doctorId: DRA, origen: "elegido" });
});

// ── revisión de P2: una «Sin doctor» que todavía no se atiende no adivina doctor ───────────────────

test("cita «Sin doctor» todavía por atender (anticipo, cobro previo) → nace sin doctor aunque haya plan o cabecera", async () => {
  citas[0]!.status = "SCHEDULED";
  planes.push({ clinicId: CLINICA, patientId: PACIENTE, doctorId: DR_SIEMBRA, status: "ACTIVE" });
  cabecera = DRA;
  assert.deepEqual(await doctorDe(), { doctorId: null, origen: "ninguno" });
  assert.deepEqual(lecturas, ["cita"], "no se leen pistas: el doctor llega cuando se asigne en la cita");
  // con nota (quien escribió la consulta), la nota sí manda
  assert.deepEqual(await doctorDe({ autorDeNota: DRA }), { doctorId: DRA, origen: "nota" });
});

test("cita «Sin doctor» ya atendida AYER y cobrada hoy → las citas de SU día, no las de hoy", async () => {
  const AYER = new Date("2026-11-03T16:00:00Z");
  citas[0]!.startsAt = AYER;
  // Hoy el paciente vino con la Dra.: esa visita no dice quién atendió la de ayer.
  citas.push({ id: "cmcita0000000000000000003", clinicId: CLINICA, patientId: PACIENTE, doctorId: DRA, startsAt: HOY, status: "CONFIRMED" });
  planes.push({ clinicId: CLINICA, patientId: PACIENTE, doctorId: DR_SIEMBRA, status: "ACTIVE" });
  assert.deepEqual(await doctorDe(), { doctorId: DR_SIEMBRA, origen: "plan" });
});
