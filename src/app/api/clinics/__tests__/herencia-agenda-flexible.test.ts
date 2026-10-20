/**
 * UNA SEDE NUEVA HEREDA LA AGENDA FLEXIBLE SIEMPRE — WS1-T5 (revisión t8, C4).
 *
 * Run: npm run test:salamanca-agenda
 *
 * El criterio acordado: la sede nueva hereda las banderas de la agenda
 * flexible (y su «Colorear por») de la SEDE PRINCIPAL DE SU DUEÑO, aunque el
 * dueño NO marque «copiar la configuración». La revisión notó que nada probaba
 * la ruta con `copiarConfiguracion: false`.
 *
 * Llama al HANDLER REAL de `POST /api/clinics` con dobles de prisma,
 * la sesión, el cupo y la bitácora. `heredarBanderasDeAgenda` y
 * `sedePrincipalDe` son los de verdad. ⛔ Sin base.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

/** Las banderas de cada clínica en la «base». */
let banderas: { clinicId: string; flag: string; enabled: boolean }[];
let creadas: any[];
/** Las sedes del dueño de la sesión, de la más antigua a la más nueva. */
let sedesDelDueno: { id: string; name: string }[];

beforeEach(() => {
  banderas = [
    { clinicId: "c-principal", flag: "agenda-flexible", enabled: true },
    { clinicId: "c-principal", flag: "agenda-color-procedimiento", enabled: true },
    // Una clínica AJENA con la bandera: nunca se copia de ella.
    { clinicId: "c-ajena", flag: "agenda-flexible", enabled: true },
  ];
  creadas = [];
  sedesDelDueno = [
    { id: "c-principal", name: "Centro Dental" },
    { id: "c-activa", name: "Centro Dental San Felipe" },
  ];
});

const prismaStub: any = {
  user: {
    findFirst: async ({ where }: any) => {
      assert.equal(where.supabaseId, "sb-dueno", "el dueño sale de la SESIÓN");
      const principal = sedesDelDueno[0];
      if (!principal) return null;
      return { agendaActive: true, clinic: { id: principal.id, name: principal.name } };
    },
  },
  clinic: {
    create: async ({ data }: any) => {
      creadas.push(data);
      return { id: "c-nueva", name: data.name, slug: data.slug, plan: data.plan, category: data.category, users: [{ id: "u-nuevo" }] };
    },
  },
  clinicFeatureFlag: {
    findMany: async ({ where }: any) =>
      banderas
        .filter((b) => b.clinicId === where.clinicId && where.flag.in.includes(b.flag))
        .map(({ flag, enabled }) => ({ flag, enabled })),
    createMany: async ({ data }: any) => {
      for (const d of data) banderas.push(d);
      return { count: data.length };
    },
  },
  $queryRaw: async () => [{ existe: true }],
};

const ctx: any = {
  userId: "u-activa",
  clinicId: "c-activa",
  role: "SUPER_ADMIN",
  clinicCategory: "DENTAL",
  user: { supabaseId: "sb-dueno", email: "dueno@example.com", firstName: "Dueño", lastName: "QA", mustChangePassword: false },
  clinic: { id: "c-activa", plan: "CLINIC", country: "MX", locale: "es" },
};

// `copia-sede.server.ts` lleva `import "server-only"` (Next lo resuelve por
// alias; no hay paquete suelto), que con `mock.module` no se deja pisar: como
// en anulables-cancelada.test.ts, todo va por `Module._load`.
const dobles: Record<string, unknown> = {
  "server-only": {},
  "@/lib/prisma": { prisma: prismaStub },
  "@/lib/auth-context": { getAuthContext: async () => ctx },
  "@/lib/plans": { getPlanLimits: async () => ({ aiTokensDefault: 0 }) },
  "@/lib/billing/plan-overrides": { inheritedOverridesData: () => ({}) },
  "@/lib/active-clinic": { writeActiveClinicCookie: () => undefined },
  "@/lib/failban": { persistentRateLimit: async () => null },
  "@/lib/audit": { logMutation: async () => undefined },
  "@/lib/branches": {
    getBranchQuota: async () => ({ canCreate: true, used: 2, max: null }),
    countOwnedClinics: async () => 2,
    generateClinicSlug: async () => "centro-dental-nueva",
    getOwnedClinicIds: async () => [],
    createPatientLink: async () => undefined,
    PATIENT_SHARING_ENABLED: false,
  },
};
const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  return req in dobles ? dobles[req] : cargaOriginal.call(this, req, ...r);
};

async function crearSede(copiarConfiguracion: boolean) {
  const { POST } = await import("@/app/api/clinics/route");
  const res = await POST({
    json: async () => ({ name: "Centro Dental Nueva", category: "DENTAL", copiarConfiguracion }),
    headers: new Headers(),
  } as any);
  return { status: res.status, body: await res.json() };
}

const delaNueva = () => banderas.filter((b) => b.clinicId === "c-nueva").map(({ flag, enabled }) => ({ flag, enabled }));

test("C4 · SIN «copiar la configuración», la sede nueva hereda la agenda flexible y el color de la PRINCIPAL", async () => {
  const r = await crearSede(false);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.copia, null, "no se copió la configuración");
  assert.deepEqual(
    delaNueva().sort((a, b) => a.flag.localeCompare(b.flag)),
    [
      { flag: "agenda-color-procedimiento", enabled: true },
      { flag: "agenda-flexible", enabled: true },
    ],
  );
});

test("C4 · la principal sin la bandera → la sede nueva nace APAGADA (sin filas)", async () => {
  banderas = banderas.filter((b) => b.clinicId !== "c-principal");
  const r = await crearSede(false);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(delaNueva(), []);
});

test("C4 · se hereda de la PRINCIPAL del dueño, no de la sede activa ni de otra clínica", async () => {
  banderas = [{ clinicId: "c-activa", flag: "agenda-flexible", enabled: true }, { clinicId: "c-ajena", flag: "agenda-flexible", enabled: true }];
  const r = await crearSede(false);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(delaNueva(), [], "la principal (c-principal) no la tiene");
});
