/**
 * ws1-t11 · fase 2 · P1 — un control de ortodoncia «Sin doctor» tampoco está con su tratante.
 * `{ doctorId: { not: X } }` en SQL deja fuera los NULL: hay que pedirlos con OR.
 *
 * Run: npm run test:cita-sin-doctor
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "../../../..");
const consultas: any[] = [];
const prismaStub: any = { appointment: { findMany: async (a: any) => { consultas.push(a); return []; } } };
const M = Module as unknown as {
  _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (req: string, parent: unknown, isMain: boolean) => string;
};
const cargaOriginal = M._load;
M._load = function (req, parent, isMain) {
  if (req === "server-only") return {};
  let r: string | null = null;
  try { r = M._resolveFilename(req, parent, isMain); } catch { r = null; }
  if (r === path.join(RAIZ, "src/lib/prisma.ts")) return { prisma: prismaStub };
  return cargaOriginal.call(this, req, parent, isMain);
};

test("controlesConOtroDoctor: pide los de otro doctor Y los «Sin doctor»", async () => {
  const { controlesConOtroDoctor } = await import("../controles-con-otro-doctor-db");
  await controlesConOtroDoctor({ clinicId: "c1", patientId: "p1", treatingDoctorId: "clx9doc0a000108l4aaaa0001" });
  assert.equal(consultas.length, 1);
  assert.deepEqual(consultas[0].where.OR, [{ doctorId: { not: "clx9doc0a000108l4aaaa0001" } }, { doctorId: null }]);
  assert.equal(consultas[0].where.doctorId, undefined);
});

// ═══ v2 (m3 de la revisión de t12): «Pasar controles al tratante» también PASA los «Sin doctor» ═══
// Antes: el `updateMany` seguía con `{doctorId: {not: tratante}}`, que en SQL deja fuera los NULL → count 0.
test("moverControlesFuturosAlDoctor: el control «Sin doctor» se pasa al tratante (y el tratante ve al paciente)", async () => {
  const TRATANTE = "clx9doc0a000108l4aaaa0001";
  const filas = [{ id: "cmh0ctl00001", doctorId: null, status: "SCHEDULED" }];
  const escrituras: any[] = [];
  const visibilidad: any[] = [];
  const cumple = (f: any, w: any): boolean =>
    Object.entries(w).every(([k, v]: [string, any]) => {
      if (k === "OR") return v.some((o: any) => cumple(f, o));
      if (k === "status") return v.in.includes(f.status);
      if (k === "doctorId") return v === null ? f.doctorId === null : v?.not !== undefined ? f.doctorId !== null && f.doctorId !== v.not : f.doctorId === v;
      if (k === "id") return f.id === v;
      return true;
    });
  Object.assign(prismaStub, {
    orthodonticTreatmentPlan: { findFirst: async () => ({ id: "plan1", patientId: "p1", treatingDoctorId: TRATANTE }) },
  });
  prismaStub.appointment.findMany = async (a: any) => {
    if (a.where.doctorId === TRATANTE) return []; // la agenda del tratante, libre
    return [{ id: "cmh0ctl00001", type: "Control de ortodoncia", startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 86_400_000 + 1_800_000) }];
  };
  (prismaStub.appointment as any).updateMany = async (a: any) => {
    escrituras.push(a);
    const f = filas.find((x) => cumple(x, a.where));
    if (f) f.doctorId = a.data.doctorId;
    return { count: f ? 1 : 0 };
  };
  const dobles = new Map<string, unknown>([
    [path.join(RAIZ, "src/app/actions/orthodontics/_helpers.ts"), {
      getOrthoActionContext: async () => ({ ok: true, data: { ctx: { clinicId: "c1", userId: "u1", role: "ADMIN" } } }),
      loadPatientForOrtho: async () => ({ ok: true, data: {} }),
      auditOrtho: async () => undefined,
    }],
    [path.join(RAIZ, "src/lib/agenda-bloqueos/consulta.server.ts"), { leerBloqueosDelRango: async () => [] }],
    [path.join(RAIZ, "src/lib/patient-visibility.ts"), { ensureUserCanSeePatient: async (...x: unknown[]) => { visibilidad.push(x); return null; } }],
    [path.join(RAIZ, "src/lib/orthodontics/agenda-constants.ts"), { esCitaOrtoConHoja: () => true }],
  ]);
  const anterior = M._load;
  M._load = function (req, parent, isMain) {
    if (req === "next/cache") return { revalidatePath: () => undefined };
    let r: string | null = null;
    try { r = M._resolveFilename(req, parent, isMain); } catch { r = null; }
    if (r && dobles.has(r)) return dobles.get(r);
    return anterior.call(this, req, parent, isMain);
  };
  const { moverControlesFuturosAlDoctor } = await import("../../../app/actions/orthodontics/moverControlesFuturosAlDoctor");
  const r: any = await moverControlesFuturosAlDoctor({ treatmentPlanId: "plan1" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.movidos, 1, "el «Sin doctor» se quedaba sin pasar (count 0) y la ficha lo ofrecía para siempre");
  assert.equal(filas[0].doctorId, TRATANTE);
  assert.deepEqual(escrituras[0].where.OR, [{ doctorId: { not: TRATANTE } }, { doctorId: null }]);
  assert.deepEqual(visibilidad[0]?.slice(1), ["p1", TRATANTE, "c1"]);
});
