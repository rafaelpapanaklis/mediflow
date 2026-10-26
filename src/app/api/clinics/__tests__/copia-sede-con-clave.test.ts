/**
 * ws1-t4 v2 · G1 (revisión de t8) — al crear una sede, «Copiar la
 * configuración» NO saca la configuración de una sede principal con clave.
 *
 * Run: npm run test:sede-clave
 *
 * Llama al HANDLER REAL de `POST /api/clinics` (y al `origenDeCopiaParaSedeNueva`
 * real) con dobles de prisma, la sesión, la copia y el estado de las claves.
 * Lo que se mira: de qué sede se LEE para copiar, de cuál se heredan las
 * banderas, y qué le dice la respuesta al diálogo. ⛔ Sin base.
 * Todo por `Module._load`, como herencia-agenda-flexible.test.ts.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

const PRINCIPAL = { clinicId: "c-principal", nombre: "Centro Dental (con clave)" };
const ACTIVA = { id: "c-activa", name: "Centro Dental San Felipe" };

/** Sedes con clave activa, y las que esta persona tiene cerradas en este navegador. */
let conClave = new Set<string>();
let cerradas = new Set<string>();
let leidas: string[] = [];
let copiadasDe: string[] = [];
let banderasDe: string[] = [];

beforeEach(() => {
  conClave = new Set();
  cerradas = new Set();
  leidas = [];
  copiadasDe = [];
  banderasDe = [];
});

const prismaStub: any = {
  user: { findFirst: async () => ({ agendaActive: true }) },
  clinic: {
    create: async ({ data }: any) => ({ id: "c-nueva", name: data.name, slug: "c-nueva", plan: data.plan, category: data.category, users: [{ id: "u-nuevo" }] }),
  },
};

const ctx: any = {
  userId: "u-activa",
  clinicId: ACTIVA.id,
  role: "SUPER_ADMIN",
  clinicCategory: "DENTAL",
  user: { supabaseId: "sb-dueno", email: "dueno@example.com", firstName: "Dueño", lastName: "QA", mustChangePassword: false },
  clinic: { id: ACTIVA.id, name: ACTIVA.name, plan: "CLINIC", country: "MX", locale: "es" },
};

const resultado = (origen: { clinicId: string; nombre: string }) => ({
  origen,
  copiado: { catalogo: 3, paquetes: 0, horario: 5, ajustes: 4, plantillasNotas: 0, plantillasConsentimientos: 0, plantillasEvolucion: 0, indicaciones: 0, botWhatsApp: 0 },
  noSeCopia: [],
});

const dobles: Record<string, unknown> = {
  "server-only": {},
  "@/lib/prisma": { prisma: prismaStub },
  "@/lib/auth-context": { getAuthContext: async () => ctx },
  "@/lib/plans": { getPlanLimits: async () => ({ aiTokensDefault: 0 }) },
  "@/lib/billing/plan-overrides": { inheritedOverridesData: () => ({}) },
  "@/lib/active-clinic": { writeActiveClinicCookie: () => undefined },
  "@/lib/failban": { persistentRateLimit: async () => null },
  "@/lib/audit": { logMutation: async () => undefined },
  "@/lib/google/bandera-sede.server": { heredarBanderaGoogle: async (de: string) => { banderasDe.push(`google:${de}`); } },
  "@/lib/branches": {
    getBranchQuota: async () => ({ canCreate: true, used: 2, max: null }),
    countOwnedClinics: async () => 2,
    generateClinicSlug: async () => "c-nueva",
    getOwnedClinicIds: async () => [],
    createPatientLink: async () => undefined,
    PATIENT_SHARING_ENABLED: false,
  },
  "@/lib/branches/copia-sede.server": {
    sedePrincipalDe: async (sb: string) => { assert.equal(sb, "sb-dueno", "el dueño sale de la SESIÓN"); return PRINCIPAL; },
    leerOrigenParaAlta: async (o: { clinicId: string; nombre: string }) => { leidas.push(o.clinicId); return { ...o, ajustes: {}, horario: [] }; },
    copiarConfiguracion: async (a: any) => { copiadasDe.push(a.origen.clinicId); return resultado(a.origen); },
    heredarBanderasDeAgenda: async (de: string) => { banderasDe.push(`agenda:${de}`); },
  },
  // El estado de las claves (la regla en sí la prueba src/lib/sede-clave/__tests__).
  "./gate.server": {
    sedesCerradasPara: async (_sb: string, ids: readonly string[]) => new Set(ids.filter((id) => cerradas.has(id))),
    sedesConClave: async (ids: readonly string[]) => new Set(ids.filter((id) => conClave.has(id))),
  },
};
const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  return req in dobles ? dobles[req] : cargaOriginal.call(this, req, ...r);
};

async function crearSede(copiarConfiguracion = true) {
  const { POST } = await import("@/app/api/clinics/route");
  const res = await POST({
    json: async () => ({ name: "Centro Dental Nueva", category: "DENTAL", copiarConfiguracion }),
    headers: new Headers(),
  } as any);
  return { status: res.status, body: await res.json() };
}

test("G1 · sin clave en la principal: se copia de ella, como siempre", async () => {
  const r = await crearSede();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(leidas, [PRINCIPAL.clinicId]);
  assert.deepEqual(copiadasDe, [PRINCIPAL.clinicId]);
  assert.equal(r.body.avisoCopia, null);
});

test("G1 · principal con clave y sin desbloqueo: NO se lee nada de ella; se copia de la activa y se dice", async () => {
  conClave = new Set([PRINCIPAL.clinicId]);
  cerradas = new Set([PRINCIPAL.clinicId]);
  const r = await crearSede();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(leidas, [ACTIVA.id], "no se leyó la configuración de la principal");
  assert.deepEqual(copiadasDe, [ACTIVA.id]);
  assert.equal(r.body.avisoCopia, "principal_con_clave_desde_activa");
  assert.equal(r.body.copia.origen.clinicId, ACTIVA.id);
  assert.ok(banderasDe.every((b) => !b.endsWith(PRINCIPAL.clinicId)), `banderas heredadas de la principal: ${banderasDe}`);
});

test("G1 · principal con clave y la activa también: la sede nace con los valores de siempre", async () => {
  conClave = new Set([PRINCIPAL.clinicId, ACTIVA.id]);
  cerradas = new Set([PRINCIPAL.clinicId]);
  const r = await crearSede();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(leidas, []);
  assert.deepEqual(copiadasDe, []);
  assert.equal(r.body.copia, null);
  assert.equal(r.body.avisoCopia, "principal_con_clave_sin_copia");
  assert.deepEqual(banderasDe, [], "ni banderas de una sede con clave");
});

test("G1 · principal con clave pero desbloqueada en este navegador: se copia de ella", async () => {
  conClave = new Set([PRINCIPAL.clinicId]);
  const r = await crearSede();
  assert.deepEqual(copiadasDe, [PRINCIPAL.clinicId]);
  assert.equal(r.body.avisoCopia, null);
});

test("G1 · sin «copiar»: no se copia nada, sin aviso, y las banderas no salen de una principal cerrada", async () => {
  conClave = new Set([PRINCIPAL.clinicId]);
  cerradas = new Set([PRINCIPAL.clinicId]);
  const r = await crearSede(false);
  assert.deepEqual(copiadasDe, []);
  assert.equal(r.body.avisoCopia, null);
  assert.ok(banderasDe.every((b) => b.endsWith(ACTIVA.id)), `banderas: ${banderasDe}`);
});
