/**
 * Equipo y sedes (ws1-t3, auditoría del plan Clínica y sedes) — A3, M3 y M7.
 *
 * `npm run test:team-sedes`
 *
 * A3  · dar acceso a otra sede a quien YA tiene cuenta: ficha nueva en la sede activa, con su rol,
 *       sin contraseña nueva; solo si ya está en otra sede VIVA del MISMO dueño; solo dueño/admin.
 * M3  · una sede archivada no existe para la sesión, el selector, los cupos ni switch-clinic.
 * M7  · el tope de usuarios es POR DUEÑO: no se multiplica por sede.
 * v7  · (ws1-t4) quien MIRA solo lee nombres de sedes a las que tiene acceso: «También en», el aviso
 *       del alta, la bitácora y la sede que paga. El dueño las sigue viendo todas.
 * Dobles: Prisma (con un evaluador de `where` mínimo), Supabase, sesión, bitácora, caché, planes.
 */
import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decidirSedeAdicional, personasDistintas } from "../sede-adicional";
import { puedeCerrarSede } from "@/lib/sede-cierre";

const A = "sede-a", B = "sede-b", C_ARCH = "sede-archivada", X = "sede-de-otro-dueno", D = "sede-3-aislada";
const SB_DUENO = "sb-dueno", SB_DR = "sb-dr", SB_EXTRANO = "sb-extrano", SB_ADMIN = "sb-admin-sedes";

interface Fila { id: string; supabaseId: string; clinicId: string; email: string; role: string; isActive: boolean; color: string; firstName: string; lastName: string; createdAt: Date; mustChangePassword?: boolean }
const CLINICAS: Record<string, { id: string; name: string; archivedAt: Date | null }> = {
  [A]: { id: A, name: "Sede A", archivedAt: null },
  [B]: { id: B, name: "Sede B", archivedAt: null },
  [C_ARCH]: { id: C_ARCH, name: "Sede cerrada", archivedAt: new Date("2026-09-01") },
  [X]: { id: X, name: "Clínica ajena", archivedAt: null },
  [D]: { id: D, name: "QA Sede 3 aislada", archivedAt: null },
};
// Antigüedad de cada clínica (la más antigua del grupo es la que paga si ninguna tiene cobro propio).
const CREADA: Record<string, Date> = {
  [A]: new Date("2026-01-01"), [B]: new Date("2026-02-01"), [C_ARCH]: new Date("2026-03-01"),
  [X]: new Date("2026-01-15"), [D]: new Date("2026-04-01"),
};
// Campos de cobro por clínica (solo los usa la prueba de la sede que paga).
const COBRO: Record<string, Record<string, unknown>> = {};
const estado = { filas: [] as Fila[], maxUsers: null as number | null, creados: [] as any[], rol: "SUPER_ADMIN", cuentaExiste: true, quien: SB_DUENO, bitacora: [] as any[] };

const u = (id: string, supabaseId: string, clinicId: string, role: string, over: Partial<Fila> = {}): Fila => ({
  id, supabaseId, clinicId, role, email: `${id}@x.com`, isActive: true, color: "#111111",
  firstName: id, lastName: "T", createdAt: new Date("2026-01-01"), ...over,
});

function cumple(fila: any, where: any): boolean {
  if (!where) return true;
  return Object.keys(where).every((k) => {
    const c = where[k];
    if (c === undefined) return true;
    if (k === "clinic") return Object.keys(c).every((kk) => (CLINICAS[fila.clinicId] as any)[kk] === c[kk]);
    if (c && typeof c === "object" && !(c instanceof Date)) {
      if ("in" in c) return c.in.includes(fila[k]);
      if ("equals" in c) return String(fila[k]).toLowerCase() === String(c.equals).toLowerCase();
      if ("not" in c) return fila[k] !== c.not;
    }
    return fila[k] === c;
  });
}
const conClinica = (f: Fila) => ({ ...f, clinic: CLINICAS[f.clinicId] });
const prismaDoble: any = {
  user: {
    findMany: async ({ where }: any) => estado.filas.filter((r) => cumple(r, where)).map(conClinica),
    findFirst: async ({ where }: any) => { const r = estado.filas.filter((x) => cumple(x, where)); return r[0] ? conClinica(r[0]) : null; },
    count: async ({ where }: any) => estado.filas.filter((r) => cumple(r, where)).length,
    create: async ({ data }: any) => { estado.creados.push(data); return { id: "nuevo", ...data, createdAt: new Date(), updatedAt: new Date() }; },
  },
  clinic: {
    findUnique: async () => ({ plan: "CLINICA" }),
    findMany: async ({ where }: any) => Object.values(CLINICAS).filter((c) => where.id.in.includes(c.id)).map((c) => ({ ...c, createdAt: CREADA[c.id], ...COBRO[c.id] })),
  },
  $transaction: async (fn: any) => fn(prismaDoble),
};

let ALTA: (b: unknown) => Promise<Response>;
let LISTA: () => Promise<Response>;
let CUPO: (clinicId: string) => Promise<{ usados: number; max: number | null; lleno: boolean }>;

before(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sr-prueba-no-es-real";
  mock.module("@/lib/prisma", { namedExports: { prisma: prismaDoble } });
  mock.module(require.resolve("@supabase/supabase-js"), {
    namedExports: { createClient: () => ({ auth: { admin: {
      createUser: async () => estado.cuentaExiste
        ? { data: { user: null }, error: { message: "A user with this email address has already been registered" } }
        : { data: { user: { id: "sb-nuevo" } }, error: null },
    } } }) },
  });
  mock.module("@/lib/auth/two-factor-identity", {
    namedExports: { personaTieneDosFactores: async () => false, dosFactoresDeLaPersona: async () => false },
  });
  const authReal = await import("@/lib/auth-context");
  mock.module("@/lib/auth-context", { namedExports: { ...authReal, getAuthContext: async () => ({
    userId: "u-dueno-a", clinicId: A, role: estado.rol, permissionsOverride: estado.rol === "RECEPTIONIST" ? ["team.edit"] : [], clinicCategory: "DENTAL",
    clinic: { name: "Sede A", timezone: "America/Mexico_City", category: "DENTAL" },
    isSuperAdmin: estado.rol === "SUPER_ADMIN", isAdmin: estado.rol !== "RECEPTIONIST",
    user: { supabaseId: estado.quien },
  }) } });
  const auditReal = await import("@/lib/audit");
  mock.module("@/lib/audit", { namedExports: { ...auditReal, logMutation: async (a: any) => { estado.bitacora.push(a); }, logAudit: async () => {} } });
  mock.module("@/lib/orthodontics/access", { namedExports: { hasActiveOrthodonticsModule: async () => false } });
  mock.module("@/lib/plans", { namedExports: { getPlanLimitsForClinic: async () => ({ maxUsers: estado.maxUsers }) } });
  mock.module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => {} } });

  const { NextRequest } = await import("next/server");
  const alta = await import("@/app/api/team/route");
  ALTA = (b) => alta.POST(new NextRequest("http://app.test/api/team", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b),
  }));
  LISTA = () => alta.GET(new NextRequest("http://app.test/api/team"));
  CUPO = (await import("../cupo-usuarios")).getCupoUsuarios;
});

beforeEach(() => {
  estado.rol = "SUPER_ADMIN"; estado.maxUsers = null; estado.creados = []; estado.cuentaExiste = true;
  estado.quien = SB_DUENO; estado.bitacora = [];
  estado.filas = [
    u("u-dueno-a", SB_DUENO, A, "SUPER_ADMIN"),
    u("u-dueno-b", SB_DUENO, B, "SUPER_ADMIN", { createdAt: new Date("2026-02-01") }),
    u("u-dueno-c", SB_DUENO, C_ARCH, "SUPER_ADMIN", { createdAt: new Date("2026-03-01") }),
    u("u-dr-b", SB_DR, B, "DOCTOR", { email: "dr@x.com" }),
    u("u-dr-c", "sb-solo-archivada", C_ARCH, "DOCTOR", { email: "archivada@x.com" }),
    u("u-extrano", SB_EXTRANO, X, "DOCTOR", { email: "extrano@x.com" }),
    u("u-otro-dueno", "sb-otro-dueno", X, "SUPER_ADMIN", { email: "otrodueno@x.com" }),
  ];
});

const alta = (email: string, over: Record<string, unknown> = {}) => ({ firstName: "Dr", lastName: "X", email, role: "DOCTOR", ...over });

/* ── A3 ─────────────────────────────────────────────────────────────── */

test("A3 núcleo: solo se liga a quien ya está en OTRA sede viva del mismo dueño", () => {
  const f = (clinicId: string, role = "DOCTOR", supabaseId = "s1") => ({ supabaseId, clinicId, clinicName: clinicId, role, isActive: true });
  const ve = [A, B, C_ARCH];
  assert.deepEqual(decidirSedeAdicional({ clinicIdActiva: A, sedesDelDueno: [A, B], fichas: [f(B)], sedesDeQuienMira: ve }), { ok: true, supabaseId: "s1", otrasSedes: [B] });
  assert.deepEqual(decidirSedeAdicional({ clinicIdActiva: A, sedesDelDueno: [A, B], fichas: [f(X)], sedesDeQuienMira: ve }), { ok: false, motivo: "NO_ES_DE_ESTE_DUENO" });
  assert.deepEqual(decidirSedeAdicional({ clinicIdActiva: A, sedesDelDueno: [A, B], fichas: [f(A)], sedesDeQuienMira: ve }), { ok: false, motivo: "NO_ES_DE_ESTE_DUENO" });
  assert.deepEqual(decidirSedeAdicional({ clinicIdActiva: A, sedesDelDueno: [A, B], fichas: [f(B, "SUPER_ADMIN")], sedesDeQuienMira: ve }), { ok: false, motivo: "ES_DUENO" });
  assert.deepEqual(decidirSedeAdicional({ clinicIdActiva: A, sedesDelDueno: [A, B, C_ARCH], fichas: [f(B, "DOCTOR", "s1"), f(C_ARCH, "DOCTOR", "s2")], sedesDeQuienMira: ve }), { ok: false, motivo: "CUENTA_AMBIGUA" });
  // v7: la decisión de ligar no depende de quién mira; solo lo que se nombra.
  assert.deepEqual(decidirSedeAdicional({ clinicIdActiva: A, sedesDelDueno: [A, B], fichas: [f(B)], sedesDeQuienMira: [A] }), { ok: true, supabaseId: "s1", otrasSedes: [] });
  assert.equal(personasDistintas([{ supabaseId: "a" }, { supabaseId: "a" }, { supabaseId: "b" }]), 2);
});

test("🔴 A3: el dueño agrega por correo a quien ya tiene ficha en su otra sede → ficha nueva aquí, sin contraseña nueva", async () => {
  const r = await ALTA(alta("dr@x.com", { role: "ADMIN" }));
  assert.equal(r.status, 201, JSON.stringify(await r.clone().json()));
  const j = await r.json();
  assert.equal(j.cuentaExistente, true);
  assert.deepEqual(j.tambienEn, ["Sede B"]);
  assert.equal(j.tempPassword, undefined, "no se le da contraseña temporal a quien ya tiene la suya");
  assert.equal(estado.creados.length, 1);
  const c = estado.creados[0];
  assert.equal(c.clinicId, A, "la ficha nace en la sede activa de la SESIÓN");
  assert.equal(c.supabaseId, SB_DR, "es la MISMA cuenta");
  assert.equal(c.role, "ADMIN", "el rol de esta sede es el que se eligió aquí, no el de la otra");
  assert.equal(c.mustChangePassword, false);
});

test("🔴 A3: un correo que es cuenta de OTRO cliente NO se liga (y el aviso es el de siempre)", async () => {
  const r = await ALTA(alta("extrano@x.com"));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /ya tiene cuenta/);
  assert.equal(estado.creados.length, 0);
});

test("🔴 A3: tampoco se liga a quien solo tiene ficha en una sede ARCHIVADA, ni al dueño de otras sedes", async () => {
  assert.equal((await ALTA(alta("archivada@x.com"))).status, 400);
  estado.filas.push(u("u-dueno2-b", "sb-otro-dueno", B, "SUPER_ADMIN", { email: "otrodueno@x.com" }));
  assert.equal((await ALTA(alta("otrodueno@x.com"))).status, 400);
  assert.equal(estado.creados.length, 0);
});

test("🔴 A3: solo dueño/admin de la sede: recepción con `team.edit` por override no puede ligar a nadie", async () => {
  estado.rol = "RECEPTIONIST";
  const r = await ALTA(alta("dr@x.com"));
  assert.equal(r.status, 400);
  assert.equal(estado.creados.length, 0);
});

test("A3: un ADMIN de la sede sí puede", async () => {
  estado.rol = "ADMIN";
  assert.equal((await ALTA(alta("dr@x.com", { role: "RECEPTIONIST" }))).status, 201);
});

test("A3: Equipo muestra «también en» solo con sedes vivas del mismo dueño", async () => {
  estado.filas.push(u("u-dr-a", SB_DR, A, "DOCTOR", { email: "dr@x.com" }));
  const lista = await (await LISTA()).json();
  const dr = lista.find((m: any) => m.email === "dr@x.com");
  assert.deepEqual(dr.tambienEn, ["Sede B"]);
  assert.equal(dr.supabaseId, undefined, "el supabaseId no sale al cliente");
});

/* ── M3 ─────────────────────────────────────────────────────────────── */

test("🔴 M3: cuenta de sedes y cupos ignoran la archivada (countOwnedClinics / sedes del dueño)", async () => {
  // branches.ts lleva `import "server-only"` y no carga fuera de Next: sus tres consultas
  // (countOwnedClinics, getOwnedClinicIds, getOwnedBranches) se fijan por el texto.
  const ramas = readFileSync("src/lib/branches.ts", "utf8");
  assert.equal((ramas.match(/role: "SUPER_ADMIN", isActive: true, clinic: \{ archivedAt: null \}/g) ?? []).length, 3);
  const { sedesDelDueno } = await import("@/lib/storage-owner");
  assert.deepEqual((await sedesDelDueno(A)).sort(), [A, B]);
});

test("M3: puedeCerrarSede — ni la activa, ni la única, ni la principal, ni la ajena", () => {
  const s = (id: string, dia: number, archivedAt: Date | null = null) => ({ id, createdAt: new Date(2026, 0, dia), archivedAt });
  const sedes = [s(A, 1), s(B, 2), s(C_ARCH, 3, new Date())];
  assert.deepEqual(puedeCerrarSede({ clinicId: B, clinicIdActiva: A, sedes }), { ok: true });
  assert.deepEqual(puedeCerrarSede({ clinicId: B, clinicIdActiva: B, sedes }), { ok: false, motivo: "ES_LA_ACTIVA" });
  assert.deepEqual(puedeCerrarSede({ clinicId: A, clinicIdActiva: B, sedes }), { ok: false, motivo: "ES_LA_PRINCIPAL" });
  assert.deepEqual(puedeCerrarSede({ clinicId: X, clinicIdActiva: A, sedes }), { ok: false, motivo: "NO_ES_TUYA" });
  assert.deepEqual(puedeCerrarSede({ clinicId: C_ARCH, clinicIdActiva: A, sedes }), { ok: false, motivo: "YA_CERRADA" });
  assert.deepEqual(puedeCerrarSede({ clinicId: A, clinicIdActiva: A, sedes: [s(A, 1)] }), { ok: false, motivo: "ES_LA_ACTIVA" });
  assert.deepEqual(puedeCerrarSede({ clinicId: B, clinicIdActiva: A, sedes: [s(B, 1)] }), { ok: false, motivo: "ES_LA_UNICA" });
});

test("🔴 M3: sesión, selector, switch-clinic y webhook del bot leen `archivedAt` (cada uno con su filtro)", () => {
  const lee = (p: string) => readFileSync(p, "utf8");
  assert.match(lee("src/lib/auth/sesion-en-cache.ts"), /clinic: \{ archivedAt: null \}/);
  assert.match(lee("src/lib/auth.ts"), /isActive: true, clinic: \{ archivedAt: null \}/);
  assert.match(lee("src/app/api/switch-clinic/route.ts"), /clinic: \{ archivedAt: null \}/);
  assert.match(lee("src/app/api/whatsapp/webhook/route.ts"), /clinic\.archivedAt/);
  assert.match(lee("src/lib/sabina/sedes.ts"), /clinic: \{ archivedAt: null \}/);
});

/* ── M7 ─────────────────────────────────────────────────────────────── */

test("🔴 M7: con tope finito el cupo es del DUEÑO: lo de la otra sede cuenta (no se multiplica)", async () => {
  estado.maxUsers = 3;
  // Sede A: solo el dueño. Sede B: dueño + doctor. Personas distintas del dueño: 2 (dueño, Dr).
  assert.deepEqual(await CUPO(A), { usados: 2, max: 3, lleno: false });
  estado.filas.push(u("u-rec-b", "sb-rec", B, "RECEPTIONIST"));
  const c = await CUPO(A);
  assert.equal(c.usados, 3);
  assert.equal(c.lleno, true, "con el tope de 3 repartido en dos sedes, A no tiene otros 3");
});

test("M7: la misma persona en dos sedes cuenta UNA vez; la sede archivada no cuenta; sin tope no cambia nada", async () => {
  estado.maxUsers = 5;
  estado.filas.push(u("u-dr-a", SB_DR, A, "DOCTOR"));
  assert.equal((await CUPO(A)).usados, 2, "dueño + Dr (en A y en B) = 2; la archivada no suma");
  estado.maxUsers = null;
  assert.deepEqual(await CUPO(A), { usados: 2, max: null, lleno: false });
});

test("M7: el cupo del otro cliente no se mezcla", async () => {
  estado.maxUsers = 1;
  assert.equal((await CUPO(X)).usados, 2, "su clínica sola (dueño ajeno + extraño), sin las sedes de Rafael");
});

/* ── v7 (ws1-t4): solo se nombran las sedes a las que tiene acceso quien MIRA ─ */

// El caso del QA en panel.108: el dueño está en A, B y D («QA Sede 3 aislada»); el admin, solo en A y B.
function conSedeAislada() {
  estado.filas.push(
    u("u-dueno-d", SB_DUENO, D, "SUPER_ADMIN", { createdAt: new Date("2026-04-01") }),
    u("u-admin-a", SB_ADMIN, A, "ADMIN", { email: "admin@x.com" }),
    u("u-admin-b", SB_ADMIN, B, "ADMIN", { email: "admin@x.com" }),
  );
}
const tambienDe = (lista: any[], email: string) => lista.find((m: any) => m.email === email)?.tambienEn;

test("🔴 v7: en Equipo, el ADMIN no lee en la tarjeta del dueño el nombre de la sede a la que no tiene acceso", async () => {
  conSedeAislada();
  estado.rol = "ADMIN"; estado.quien = SB_ADMIN;
  const lista = await (await LISTA()).json();
  assert.deepEqual(tambienDe(lista, "u-dueno-a@x.com"), ["Sede B"], "sin «QA Sede 3 aislada»");
  assert.deepEqual(tambienDe(lista, "admin@x.com"), ["Sede B"]);
  assert.ok(!JSON.stringify(lista).includes("QA Sede 3 aislada"), "el nombre no viaja en ninguna parte de la respuesta");
});

test("v7: el dueño, que está en todas sus sedes, las sigue viendo todas", async () => {
  conSedeAislada();
  const lista = await (await LISTA()).json();
  assert.deepEqual([...tambienDe(lista, "u-dueno-a@x.com")].sort(), ["QA Sede 3 aislada", "Sede B"]);
});

test("v7: una sede archivada no cuenta como acceso, y sin supabaseId en la sesión no se nombra ninguna", async () => {
  conSedeAislada();
  const { sedesQueVe } = await import("@/lib/sedes-que-ve");
  assert.deepEqual([...(await sedesQueVe(SB_DUENO, [A, B, C_ARCH, D, X]))].sort(), [A, B, D].sort());
  assert.deepEqual([...(await sedesQueVe(SB_ADMIN, [A, B, D]))].sort(), [A, B].sort());
  assert.equal((await sedesQueVe(undefined, [A, B])).size, 0);
  const { sedesDeMiembros } = await import("../tambien-en");
  assert.equal((await sedesDeMiembros(A, [SB_DUENO], null)).size, 0);
});

test("🔴 v7: el alta por correo de quien solo está en la sede aislada no le nombra esa sede al ADMIN (ni en la respuesta ni en la bitácora)", async () => {
  conSedeAislada();
  estado.filas.push(u("u-dr-d", "sb-dr-d", D, "DOCTOR", { email: "drd@x.com" }));
  estado.rol = "ADMIN"; estado.quien = SB_ADMIN;
  const r = await ALTA(alta("drd@x.com"));
  assert.equal(r.status, 201, "ligar no cambia: es la misma regla A3 de siempre");
  const j = await r.json();
  assert.deepEqual(j.tambienEn, []);
  assert.equal(estado.bitacora.length, 1);
  assert.deepEqual(estado.bitacora[0].after.tambienEn, []);
  assert.ok(!JSON.stringify(estado.bitacora).includes("QA Sede 3 aislada"));
});

test("v7: en el alta, las sedes que el ADMIN sí ve se siguen nombrando; el dueño ve todas", async () => {
  conSedeAislada();
  estado.filas.push(u("u-dr-d", SB_DR, D, "DOCTOR", { email: "dr@x.com" }));
  estado.rol = "ADMIN"; estado.quien = SB_ADMIN;
  assert.deepEqual((await (await ALTA(alta("dr@x.com"))).json()).tambienEn, ["Sede B"]);
  estado.rol = "SUPER_ADMIN"; estado.quien = SB_DUENO; estado.creados = [];
  assert.deepEqual([...(await (await ALTA(alta("dr@x.com"))).json()).tambienEn].sort(), ["QA Sede 3 aislada", "Sede B"]);
});

test("🔴 v7: la sede que paga solo se nombra a quien tiene acceso a ella", async () => {
  // El grupo de pago: D tiene el cobro propio y paga; A va incluida.
  estado.filas = [
    u("u-dueno-d", SB_DUENO, D, "SUPER_ADMIN"),
    u("u-dueno-a", SB_DUENO, A, "SUPER_ADMIN"),
    u("u-admin-a", SB_ADMIN, A, "ADMIN", { email: "admin@x.com" }),
  ];
  COBRO[D] = { stripeSubscriptionId: "sub_d", subscriptionStatus: "active" };
  COBRO[A] = { subscriptionStatus: "active" };
  try {
    const { leerGrupoDePago } = await import("@/lib/billing/sedes-incluidas");
    const delDueno = await leerGrupoDePago(A, SB_DUENO);
    assert.equal(delDueno.esSedeIncluida, true);
    assert.equal(delDueno.pagadoraId, D);
    assert.equal(delDueno.pagadoraNombre, "QA Sede 3 aislada");
    assert.equal((await leerGrupoDePago(A, SB_ADMIN)).pagadoraNombre, null, "el admin no está en la que paga");
    assert.equal((await leerGrupoDePago(A)).pagadoraNombre, null, "sin quien mira no se nombra");
  } finally {
    delete COBRO[D];
    delete COBRO[A];
  }
  const { avisoSedeIncluida } = await import("@/lib/billing/sedes-incluidas-core");
  assert.doesNotMatch(avisoSedeIncluida(null), /«|Cambia a esa clínica/);
  assert.match(avisoSedeIncluida(null), /pídeselo al dueño/);
});

test("v7: toda pantalla o ruta que enseña la sede que paga le pasa a leerGrupoDePago el supabaseId de la sesión", () => {
  const llamadas: Record<string, RegExp> = {
    "src/app/dashboard/settings/page.tsx": /leerGrupoDePago\(user\.clinicId, user\.supabaseId\)/,
    "src/app/dashboard/suspended/page.tsx": /leerGrupoDePago\(user\.clinicId, user\.supabaseId\)/,
    "src/app/api/clinic/subscription/cancel-request/route.ts": /leerGrupoDePago\(ctx\.clinicId, ctx\.user\?\.supabaseId\)/,
    "src/app/api/billing/change-plan/route.ts": /leerGrupoDePago\(clinic\.id, user\.supabaseId\)/,
    "src/app/api/billing/checkout/route.ts": /leerGrupoDePago\(clinic\.id, user\.supabaseId\)/,
    "src/app/api/billing/spei-transferencia/route.ts": /leerGrupoDePago\(user\.clinicId, user\.supabaseId\)/,
    "src/app/api/billing/pago-pendiente/route.ts": /leerGrupoDePago\(clinic\.id, user\.supabaseId\)/,
  };
  for (const [ruta, re] of Object.entries(llamadas)) assert.match(readFileSync(ruta, "utf8"), re, ruta);
  // Y sin nombre no se ofrece «Ir a…» (sin acceso, cambiar de sede fallaría).
  for (const ruta of ["src/components/dashboard/sede-incluida-aviso.tsx", "src/app/dashboard/suspended/sede-incluida.tsx"]) {
    const src = readFileSync(ruta, "utf8");
    assert.match(src, /\{principalNombre && \(\s*<button/, ruta);
    assert.doesNotMatch(src, /Ir a la clínica principal/, ruta);
  }
});
