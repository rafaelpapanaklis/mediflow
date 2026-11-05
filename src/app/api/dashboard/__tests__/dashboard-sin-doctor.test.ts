/**
 * `GET /api/dashboard` (legado) con citas «Sin doctor» (ws1-t11 · fase 2 · P2, PLAN §1.7).
 *
 * Run: node_modules/.bin/tsx --test src/app/api/dashboard/__tests__/dashboard-sin-doctor.test.ts
 *
 * HANDLER REAL con dobles por Module._load. El `groupBy` por doctor del mes trae las «Sin doctor»
 * con `doctorId: null` y la ruta pedía `user.findMany({ id: { in: [..., null] } })`: Prisma lo
 * rechaza y la ruta respondía 500. Ahora solo busca los ids reales (y de ESTA clínica) y la fila
 * «Sin doctor» sale con su nombre; la suma del desglose es la de las citas del mes. Con el código
 * de f4d8fe31d falla (500).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

const CLINICA = "cmclinic0000qa00000000001";
const DRA = "cmabc123xyz0000def456ghi"; // cuid
const DR_SIEMBRA = "seed-doctor-1"; // id de siembra

const grupos = [
  { doctorId: DRA, _count: { id: 4 } },
  { doctorId: DR_SIEMBRA, _count: { id: 2 } },
  { doctorId: null, _count: { id: 3 } }, // p. ej. «dentalink-appt-88231» y otras importadas sin doctor
];
const lecturasDeUsuarios: any[] = [];

function validarComoPrisma(w: any): void {
  if (!w || typeof w !== "object") return;
  if (Array.isArray(w)) return w.forEach(validarComoPrisma);
  for (const [k, v] of Object.entries(w)) {
    if (k === "in" && Array.isArray(v) && v.some((x) => x == null)) throw new Error("PrismaClientValidationError: `in` con null");
    validarComoPrisma(v);
  }
}

const prisma: any = new Proxy({}, {
  get: (_t, modelo) => new Proxy({}, {
    get: (_m, op) => async (args: any = {}) => {
      validarComoPrisma(args.where);
      if (modelo === "appointment" && op === "groupBy") return grupos;
      if (modelo === "user" && op === "findMany") {
        lecturasDeUsuarios.push(args.where);
        return [
          { id: DRA, firstName: "Renata", lastName: "Ruiz", color: "#0ea5e9" },
          { id: DR_SIEMBRA, firstName: "Mario", lastName: "López", color: "#f97316" },
        ].filter((u) => args.where.id.in.includes(u.id));
      }
      if (op === "count") return 0;
      if (op === "aggregate") return { _sum: { paid: 0, balance: 0 }, _count: 0 };
      if (op === "findMany") return [];
      return null;
    },
  }),
});
const dobles: Record<string, unknown> = {
  "server-only": {},
  "@/lib/prisma": { prisma },
  "@/lib/auth-context": { getAuthContext: async () => ({ userId: "cmadmin00000000000000001", clinicId: CLINICA, role: "ADMIN" }) },
  "@/lib/patient-visibility": { patientVisibilityAnd: () => [], relatedPatientVisibilityAnd: () => [] },
};
const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  return req in dobles ? dobles[req] : cargaOriginal.call(this, req, ...r);
};

test("el desglose por doctor no revienta con «Sin doctor», la nombra y suma las citas del mes", async () => {
  const { GET } = await import("@/app/api/dashboard/route");
  const res = await GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  const total = grupos.reduce((s, g) => s + g._count.id, 0);
  assert.equal(body.doctorBreakdown.reduce((s: number, r: any) => s + r.count, 0), total, "suma de filas = citas del mes");
  const sin = body.doctorBreakdown.find((r: any) => r.sinDoctor);
  assert.deepEqual(sin, { doctor: { id: "sin-doctor", firstName: "Sin doctor", lastName: "", color: null }, count: 3, sinDoctor: true });
  assert.equal(body.doctorBreakdown.find((r: any) => r.doctor?.id === DRA).count, 4);
  // Los doctores se leen solo de esta clínica y sin el null.
  assert.deepEqual(lecturasDeUsuarios, [{ clinicId: CLINICA, id: { in: [DRA, DR_SIEMBRA] } }]);
});
