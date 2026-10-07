/**
 * Equipo y sedes (ws1-t3, auditoría del plan Clínica y sedes) — A3, M3 y M7.
 *
 * `npm run test:team-sedes`
 *
 * A3  · dar acceso a otra sede a quien YA tiene cuenta: ficha nueva en la sede activa, con su rol,
 *       sin contraseña nueva; solo si ya está en otra sede VIVA del MISMO dueño; solo dueño/admin.
 * M3  · una sede archivada no existe para la sesión, el selector, los cupos ni switch-clinic.
 * M7  · el tope de usuarios es POR DUEÑO: no se multiplica por sede.
 * Dobles: Prisma (con un evaluador de `where` mínimo), Supabase, sesión, bitácora, caché, planes.
 */
import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decidirSedeAdicional, personasDistintas } from "../sede-adicional";
import { puedeCerrarSede } from "@/lib/sede-cierre";

const A = "sede-a", B = "sede-b", C_ARCH = "sede-archivada", X = "sede-de-otro-dueno";
const SB_DUENO = "sb-dueno", SB_DR = "sb-dr", SB_EXTRANO = "sb-extrano";

interface Fila { id: string; supabaseId: string; clinicId: string; email: string; role: string; isActive: boolean; color: string; firstName: string; lastName: string; createdAt: Date; mustChangePassword?: boolean }
const CLINICAS: Record<string, { id: string; name: string; archivedAt: Date | null }> = {
  [A]: { id: A, name: "Sede A", archivedAt: null },
  [B]: { id: B, name: "Sede B", archivedAt: null },
  [C_ARCH]: { id: C_ARCH, name: "Sede cerrada", archivedAt: new Date("2026-09-01") },
  [X]: { id: X, name: "Clínica ajena", archivedAt: null },
};
const estado = { filas: [] as Fila[], maxUsers: null as number | null, creados: [] as any[], rol: "SUPER_ADMIN", cuentaExiste: true };

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
  clinic: { findUnique: async () => ({ plan: "CLINICA" }) },
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
  }) } });
  const auditReal = await import("@/lib/audit");
  mock.module("@/lib/audit", { namedExports: { ...auditReal, logMutation: async () => {}, logAudit: async () => {} } });
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
  assert.deepEqual(decidirSedeAdicional({ clinicIdActiva: A, sedesDelDueno: [A, B], fichas: [f(B)] }), { ok: true, supabaseId: "s1", otrasSedes: [B] });
  assert.deepEqual(decidirSedeAdicional({ clinicIdActiva: A, sedesDelDueno: [A, B], fichas: [f(X)] }), { ok: false, motivo: "NO_ES_DE_ESTE_DUENO" });
  assert.deepEqual(decidirSedeAdicional({ clinicIdActiva: A, sedesDelDueno: [A, B], fichas: [f(A)] }), { ok: false, motivo: "NO_ES_DE_ESTE_DUENO" });
  assert.deepEqual(decidirSedeAdicional({ clinicIdActiva: A, sedesDelDueno: [A, B], fichas: [f(B, "SUPER_ADMIN")] }), { ok: false, motivo: "ES_DUENO" });
  assert.deepEqual(decidirSedeAdicional({ clinicIdActiva: A, sedesDelDueno: [A, B, C_ARCH], fichas: [f(B, "DOCTOR", "s1"), f(C_ARCH, "DOCTOR", "s2")] }), { ok: false, motivo: "CUENTA_AMBIGUA" });
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
