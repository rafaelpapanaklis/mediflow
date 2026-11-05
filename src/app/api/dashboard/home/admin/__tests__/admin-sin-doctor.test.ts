/**
 * Inicio (admin) › «Rendimiento del equipo» con citas «Sin doctor» (ws1-t11 · fase 2 · P2,
 * PLAN §1.7).
 *
 * Run: node_modules/.bin/tsx --test src/app/api/dashboard/home/admin/__tests__/admin-sin-doctor.test.ts
 *
 * HANDLER REAL de `GET /api/dashboard/home/admin` con dobles por Module._load (nada toca la base).
 * El `groupBy` por doctor traía las «Sin doctor» con `doctorId: null` y se perdían: la columna
 * «Citas» del equipo sumaba menos que la tarjeta «Citas» (regla C-11), y la fila «Sin doctor»
 * solo salía con cobros sin doctor (y con 0 citas). Con el código de f4d8fe31d fallan las dos
 * primeras pruebas.
 *
 * Ids cuid, de siembra y una cita importada de Dentalink (id no uuid).
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

const CLINICA = "cmclinic0000qa00000000001";
const DRA = "cmabc123xyz0000def456ghi"; // cuid
const DR_SIEMBRA = "seed-doctor-1"; // id de siembra
const TZ = "America/Mexico_City";

let grupos: Array<{ doctorId: string | null; status: string; _count: { _all: number } }>;
let cobrado: Map<string | null, { total: number; orto: number }>;

beforeEach(() => {
  grupos = [
    { doctorId: DRA, status: "COMPLETED", _count: { _all: 3 } },
    { doctorId: DRA, status: "SCHEDULED", _count: { _all: 1 } },
    { doctorId: DR_SIEMBRA, status: "CONFIRMED", _count: { _all: 2 } },
    // «Sin doctor»: p. ej. las importadas de Dentalink («dentalink-appt-88231») y las de recepción.
    { doctorId: null, status: "CHECKED_OUT", _count: { _all: 2 } },
    { doctorId: null, status: "SCHEDULED", _count: { _all: 3 } },
  ];
  cobrado = new Map([[DRA, { total: 1_000, orto: 0 }], [DR_SIEMBRA, { total: 500, orto: 0 }]]);
});

function validarComoPrisma(w: any): void {
  if (!w || typeof w !== "object") return;
  if (Array.isArray(w)) return w.forEach(validarComoPrisma);
  for (const [k, v] of Object.entries(w)) {
    if (k === "in" && Array.isArray(v) && v.some((x) => x == null)) throw new Error("PrismaClientValidationError: `in` con null");
    validarComoPrisma(v);
  }
}

const usuarios = [
  { id: DRA, firstName: "Renata", lastName: "Ruiz" },
  { id: DR_SIEMBRA, firstName: "Mario", lastName: "López" },
];
const prisma: any = new Proxy({}, {
  get: (_t, modelo) => new Proxy({}, {
    get: (_m, op) => async (args: any = {}) => {
      validarComoPrisma(args.where);
      if (args.where && "clinicId" in args.where) assert.equal(args.where.clinicId, CLINICA, `${String(modelo)}.${String(op)} con el clinicId de la sesión`);
      if (modelo === "appointment" && op === "groupBy") return grupos;
      if (modelo === "user" && op === "findMany") {
        return args.where?.id?.in ? usuarios.filter((u) => args.where.id.in.includes(u.id)) : usuarios;
      }
      if (op === "count") return 0;
      if (op === "findMany" || op === "groupBy") return [];
      return null;
    },
  }),
});

const session = {
  user: { id: "cmadmin00000000000000001", role: "ADMIN", clinicId: CLINICA },
  clinic: { id: CLINICA, timezone: TZ, category: "DENTAL", trialEndsAt: null, subscriptionStatus: "active" },
};
const dobles: Record<string, unknown> = {
  "server-only": {},
  "@/lib/prisma": { prisma },
  "@/lib/agenda/api-helpers": { loadClinicSession: async () => session, requireRole: () => null },
  "@/lib/agenda/server": { aggregateAdminPeriodKpis: async () => ({ revenueMXN: 1_500, appointments: 11, noShows: 0 }) },
  "@/lib/caja": { computeReceivables: async () => ({ vencidoPorFactura: {}, vencido: 0 }) },
  "@/lib/dinero/ingresos.server": {
    ingresoNetoDelPeriodo: async () => ({ neto: 0, cobrado: 0, reembolsos: 0 }),
    ingresosPorDoctorDelPeriodo: async (clinicId: string) => { assert.equal(clinicId, CLINICA); return cobrado; },
    movimientosDelPeriodo: async () => ({ cobros: [], reembolsos: [] }),
  },
  "@/lib/agenda/ocupacion-del-periodo.server": { cargarOcupacionDelPeriodo: async () => null },
  "@/lib/inventory/lots.server": { getExpiryAlerts: async () => ({ porCaducar: [], caducado: [] }) },
  "@/lib/inventory/sin-contar.server": { idsSinContar: async () => new Set<string>() },
};
const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  return req in dobles ? dobles[req] : cargaOriginal.call(this, req, ...r);
};

async function equipo() {
  const { GET } = await import("@/app/api/dashboard/home/admin/route");
  const res = await GET({ nextUrl: new URL("http://x/api/dashboard/home/admin?period=month") } as any);
  assert.equal(res.status, 200);
  return (await res.json()).team as Array<{ userId: string; doctorName: string; appointments: number; completionPct: number; revenueMXN: number; sinDoctor?: boolean }>;
}

test("la columna «Citas» del equipo suma todas las citas del periodo, con la fila «Sin doctor»", async () => {
  const team = await equipo();
  const total = grupos.reduce((s, g) => s + g._count._all, 0);
  assert.equal(team.reduce((s, r) => s + r.appointments, 0), total, "suma de filas = citas del periodo");
  const sin = team.find((r) => r.sinDoctor);
  assert.ok(sin, "sale la fila «Sin doctor» aunque no haya cobros sin doctor");
  assert.deepEqual(
    { userId: sin.userId, doctorName: sin.doctorName, appointments: sin.appointments, completionPct: sin.completionPct, revenueMXN: sin.revenueMXN },
    { userId: "sin-doctor", doctorName: "Sin doctor", appointments: 5, completionPct: 40, revenueMXN: 0 },
  );
});

test("con cobros sin doctor, UNA sola fila «Sin doctor» lleva las citas y el dinero", async () => {
  cobrado.set(null, { total: 250, orto: 0 });
  const team = await equipo();
  const sin = team.filter((r) => r.sinDoctor);
  assert.equal(sin.length, 1);
  assert.deepEqual([sin[0]!.appointments, sin[0]!.revenueMXN], [5, 250]);
  assert.equal(team.reduce((s, r) => s + r.revenueMXN, 0), 1_750);
});

test("sin citas «Sin doctor» ni cobros sin doctor, la fila no sale", async () => {
  grupos = grupos.filter((g) => g.doctorId !== null);
  assert.ok(!(await equipo()).some((r) => r.sinDoctor));
});
