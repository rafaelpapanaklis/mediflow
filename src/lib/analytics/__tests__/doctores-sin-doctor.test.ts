/**
 * Analítica › Doctores y la nómina con citas «Sin doctor» (ws1-t11 · fase 2 · P2, PLAN §1.7).
 *
 * Run: node_modules/.bin/tsx --test src/lib/analytics/__tests__/doctores-sin-doctor.test.ts
 *
 * `filasDeDoctores` saltaba las citas con `doctorId = null` (`if (!c.doctorId) continue`): la
 * columna «Citas» sumaba menos que las citas del periodo (regla C-11) y la fila «Sin doctor»
 * solo salía si había cobros sin doctor. Ahora la fila «Sin doctor» lleva sus citas, atendidas,
 * no-asistió, encuestas y tiempos. Con el código de f4d8fe31d fallan las dos primeras (la
 * tercera vigila que la fila no salga de más).
 *
 * Doble de Prisma por Module._load (nada toca la base real). Ids cuid, de siembra y una cita
 * importada de Dentalink (id no uuid).
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

const CLINICA = "cmclinic0000qa00000000001";
const DRA = "cmabc123xyz0000def456ghi"; // cuid
const DR_SIEMBRA = "seed-doctor-1"; // id de siembra
const TZ = "America/Mexico_City";
const VENTANA = { desde: new Date("2026-11-01T06:00:00Z"), hasta: new Date("2026-12-01T06:00:00Z") };

type Cita = { id: string; doctorId: string | null; status: string; startsAt: Date };
let citas: Cita[];
let cobrado: Map<string | null, { total: number; orto: number }>;
let encuestas: Array<{ score: number; appointment: { doctorId: string | null } }>;
let tiempos: Array<{ totalConsultMin: number; appointment: { doctorId: string | null } }>;

beforeEach(() => {
  citas = [
    { id: "cmcita0000000000000000001", doctorId: DRA, status: "COMPLETED", startsAt: new Date("2026-11-03T16:00:00Z") },
    { id: "cmcita0000000000000000002", doctorId: DRA, status: "NO_SHOW", startsAt: new Date("2026-11-04T16:00:00Z") },
    { id: "seed-appt-7", doctorId: DR_SIEMBRA, status: "SCHEDULED", startsAt: new Date("2026-11-05T16:00:00Z") },
    // «Sin doctor»: una importada de Dentalink ya atendida y otra agendada.
    { id: "dentalink-appt-88231", doctorId: null, status: "CHECKED_OUT", startsAt: new Date("2026-11-03T17:00:00Z") },
    { id: "cmcita0000000000000000005", doctorId: null, status: "CONFIRMED", startsAt: new Date("2026-11-06T17:00:00Z") },
  ];
  cobrado = new Map([[DRA, { total: 1_500, orto: 0 }]]);
  encuestas = [{ score: 5, appointment: { doctorId: DRA } }, { score: 4, appointment: { doctorId: null } }];
  tiempos = [{ totalConsultMin: 30, appointment: { doctorId: DRA } }, { totalConsultMin: 20, appointment: { doctorId: null } }];
});

/** Lo que Prisma rechaza antes de llegar a Postgres: `{ in: [null] }`. */
function validarComoPrisma(w: any): void {
  if (!w || typeof w !== "object") return;
  if (Array.isArray(w)) return w.forEach(validarComoPrisma);
  for (const [k, v] of Object.entries(w)) {
    if (k === "in" && Array.isArray(v) && v.some((x) => x == null)) throw new Error("PrismaClientValidationError: `in` con null");
    validarComoPrisma(v);
  }
}

const prisma: any = {
  user: {
    findMany: async ({ where }: any) => {
      validarComoPrisma(where);
      assert.equal(where.clinicId, CLINICA, "las personas se leen con el clinicId de la sesión");
      const todos = [
        { id: DRA, firstName: "Renata", lastName: "Ruiz", color: "#0ea5e9", role: "DOCTOR" },
        { id: DR_SIEMBRA, firstName: "Mario", lastName: "López", color: "#f97316", role: "ADMIN" },
      ];
      return where.id?.in ? todos.filter((u) => where.id.in.includes(u.id)) : todos;
    },
  },
  appointment: {
    findMany: async ({ where }: any) => {
      validarComoPrisma(where);
      assert.equal(where.clinicId, CLINICA);
      return citas.filter((c) => !where.doctorId || c.doctorId === where.doctorId);
    },
  },
  patientSatisfaction: { findMany: async ({ where }: any) => { validarComoPrisma(where); return encuestas; } },
  appointmentTimeline: { findMany: async ({ where }: any) => { validarComoPrisma(where); return tiempos; } },
};

const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  if (req === "@/lib/prisma") return { prisma };
  if (req === "@/lib/dinero/ingresos.server") {
    return { ingresosPorDoctorDelPeriodo: async (clinicId: string) => { assert.equal(clinicId, CLINICA); return cobrado; } };
  }
  return cargaOriginal.call(this, req, ...r);
};

async function filas(soloDoctorId?: string | null) {
  const { filasDeDoctores } = await import("../doctores.server");
  return filasDeDoctores(CLINICA, VENTANA, TZ, soloDoctorId);
}

test("la columna «Citas» suma TODAS las citas del periodo, con la fila «Sin doctor»", async () => {
  const f = await filas();
  const suma = f.reduce((s, r) => s + r.apptsTotal, 0);
  assert.equal(suma, citas.length, "suma de filas = citas del periodo");
  const sin = f.find((r) => r.sinDoctor);
  assert.ok(sin, "sale la fila «Sin doctor» aunque no haya cobros sin doctor");
  assert.equal(sin.id, "sin-doctor");
  assert.equal(sin.name, "Sin doctor");
  assert.equal(sin.apptsTotal, 2);
  assert.equal(sin.apptsCompleted, 1, "CHECKED_OUT cuenta como atendida");
  assert.equal(sin.revenueGenerated, 0);
  // Encuestas y tiempos de las «Sin doctor» van a su fila, no se pierden ni se cuelgan de un doctor.
  assert.equal(sin.avgSatisfaction, 4);
  assert.equal(sin.avgConsultMin, 20);
  const dra = f.find((r) => r.id === DRA)!;
  assert.deepEqual([dra.apptsTotal, dra.apptsNoShow, dra.avgSatisfaction, dra.avgConsultMin], [2, 1, 5, 30]);
});

test("con cobros sin doctor, la MISMA fila lleva el dinero y las citas (una sola fila «Sin doctor»)", async () => {
  cobrado.set(null, { total: 700, orto: 200 });
  const f = await filas();
  const sin = f.filter((r) => r.sinDoctor);
  assert.equal(sin.length, 1);
  assert.deepEqual([sin[0]!.apptsTotal, sin[0]!.revenueGenerated, sin[0]!.revenueOrtho], [2, 700, 200]);
  assert.equal(f.reduce((s, r) => s + r.revenueGenerated, 0), 2_200, "la columna de ingresos sigue sumando lo cobrado");
});

test("un DOCTOR viendo lo suyo no recibe la fila «Sin doctor»; sin citas «Sin doctor» ni cobros, tampoco sale", async () => {
  assert.ok(!(await filas(DRA)).some((r) => r.sinDoctor));
  citas = citas.filter((c) => c.doctorId !== null);
  assert.ok(!(await filas()).some((r) => r.sinDoctor));
});
