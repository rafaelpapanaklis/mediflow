/**
 * Equipo — el dueño (SUPER_ADMIN) que también atiende edita TODOS sus datos.
 *
 * `npm run test:team-dueno-edita`
 *
 * El caso real (BEVADENT, 2-oct-2026): la dueña atiende como doctora y no podía
 * guardar su propia cédula en Equipo → Editar: salía «No puedes cambiar tu propio
 * rol». La causa NO está en el servidor (ese rechazo es correcto: nadie se cambia
 * el rol ni se desactiva a sí mismo) sino en el modal: el selector de rol solo
 * ofrece Doctor / Administrador / Recepción, ninguno marcado para un dueño, y
 * quien toca «Doctor» (porque atiende) manda `role: "DOCTOR"` en el mismo PATCH
 * que la cédula → 400 y el guardado ENTERO se cae.
 *
 * Aquí se ejecutan los route handlers de verdad (dobles: sesión, Prisma, bitácora,
 * caché y Supabase) y las funciones puras del formulario.
 */
import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

import {
  formDeMiembro, motivoRolFijo, ofreceHorario, parcheDeCambios, puedeMarcarAtiende,
  type DatosEditablesDeMiembro,
} from "../parche-miembro";

const CL = "cl-bevadent";
const SB_DUENO = "11111111-1111-4111-8111-111111111111";

interface Fila {
  id: string; clinicId: string; supabaseId: string; role: string; email: string;
  firstName: string; lastName: string; isActive: boolean;
  phone?: string | null; specialty?: string | null; color?: string; services?: string[];
  cedulaProfesional?: string | null; especialidad?: string | null; cedulaEspecialidad?: string | null;
  agendaActive?: boolean; permissionsOverride?: string[];
}

const estado = {
  sesion: null as any,
  filas: [] as Fila[],
  updates: [] as any[],
  bitacora: [] as any[],
  authUpdate: [] as any[],
};

const dueno = (): Fila => ({
  id: "us-dueno", clinicId: CL, supabaseId: SB_DUENO, role: "SUPER_ADMIN", email: "bevadent@outlook.com",
  firstName: "Johnnifer", lastName: "Benítez Valencia", isActive: true,
  phone: "4523093809", specialty: "Ortodoncia", color: "#3b82f6", services: ["ortodoncia"],
  cedulaProfesional: null, especialidad: "Ortodoncia y Ortopedia Dentofacial", cedulaEspecialidad: null,
  agendaActive: true, permissionsOverride: [],
});

function coincide(f: Fila, where: any): boolean {
  if (!where) return true;
  if (typeof where.id === "string" && f.id !== where.id) return false;
  if (typeof where.clinicId === "string" && f.clinicId !== where.clinicId) return false;
  if (typeof where.supabaseId === "string" && f.supabaseId !== where.supabaseId) return false;
  return true;
}

const prismaDoble: any = {
  user: {
    findFirst: async ({ where }: any) => {
      const f = estado.filas.find((x) => coincide(x, where));
      return f ? { ...f, _count: { appointments: 0, records: 0 } } : null;
    },
    findMany: async ({ where }: any) => estado.filas.filter((x) => coincide(x, where)).map((x) => ({ ...x })),
    update: async ({ where, data }: any) => {
      const f = estado.filas.find((x) => x.id === where.id)!;
      Object.assign(f, data);
      estado.updates.push({ where, data });
      return { ...f, totpSecret: "SECRETO" };
    },
    updateMany: async () => ({ count: 0 }),
  },
  clinic: { findUnique: async () => ({}) },
  $transaction: async (fn: any) => fn(prismaDoble),
};

const adminDoble = {
  auth: { admin: { updateUserById: async (id: string, attrs: any) => { estado.authUpdate.push({ id, attrs }); return { data: {}, error: null }; } } },
};

function sesion(role = "SUPER_ADMIN", userId = "us-dueno") {
  return {
    userId, clinicId: CL, role, permissionsOverride: [],
    clinicCategory: "DENTAL",
    clinic: { timezone: "America/Mexico_City", category: "DENTAL" },
    isSuperAdmin: role === "SUPER_ADMIN", isAdmin: role === "SUPER_ADMIN" || role === "ADMIN",
  };
}

let PATCH: (id: string, body: unknown) => Promise<Response>;

before(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sr-prueba-no-es-real";
  mock.module("@/lib/prisma", { namedExports: { prisma: prismaDoble } });
  mock.module(require.resolve("@supabase/supabase-js"), { namedExports: { createClient: () => adminDoble } });
  mock.module("@/lib/auth/two-factor-identity", {
    namedExports: { personaTieneDosFactores: async () => false, dosFactoresDeLaPersona: async () => false },
  });
  const authReal = await import("@/lib/auth-context");
  mock.module("@/lib/auth-context", { namedExports: { ...authReal, getAuthContext: async () => estado.sesion } });
  const auditReal = await import("@/lib/audit");
  mock.module("@/lib/audit", {
    namedExports: {
      ...auditReal,
      logMutation: async (o: any) => { estado.bitacora.push(o); },
      logAudit: async (o: any) => { estado.bitacora.push(o); },
    },
  });
  mock.module("@/lib/orthodontics/access", { namedExports: { hasActiveOrthodonticsModule: async () => true } });
  mock.module("@/lib/plans", { namedExports: { getPlanLimitsForClinic: async () => ({ maxUsers: null }) } });
  mock.module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => {} } });

  const { NextRequest } = await import("next/server");
  const ruta = await import("@/app/api/team/[id]/route");
  PATCH = (id, body) =>
    ruta.PATCH(
      new NextRequest(`http://app.test/api/team/${id}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      }),
      { params: { id } },
    );
});

beforeEach(() => {
  Object.assign(estado, {
    sesion: sesion(),
    filas: [dueno(), {
      id: "doc-otro", clinicId: CL, supabaseId: "22222222-2222-4222-8222-222222222222", role: "DOCTOR",
      email: "otra@x.com", firstName: "Otra", lastName: "Doctora", isActive: true, agendaActive: true,
    }],
    updates: [], bitacora: [], authUpdate: [],
  });
});

const fila = (id: string) => estado.filas.find((f) => f.id === id)!;

/* ── el servidor: el dueño edita TODO menos su rol y su estado ──────────── */

test("el dueño guarda su cédula, especialidad, cédula de especialidad, teléfono, color y nombre en un solo guardado", async () => {
  const r = await PATCH("us-dueno", {
    firstName: "Johnnifer", lastName: "Benítez", phone: "4521214617", specialty: "Ortodoncia",
    cedulaProfesional: "13318429", especialidad: "Ortodoncia y Ortopedia Dentofacial", cedulaEspecialidad: "9876543",
    color: "#7c3aed", services: ["ortodoncia", "brackets"],
  });
  assert.equal(r.status, 200);
  const f = fila("us-dueno");
  assert.equal(f.cedulaProfesional, "13318429");
  assert.equal(f.cedulaEspecialidad, "9876543");
  assert.equal(f.phone, "4521214617");
  assert.equal(f.color, "#7c3aed");
  assert.equal(f.lastName, "Benítez");
  assert.equal(f.role, "SUPER_ADMIN", "el rol no se toca");
  assert.equal(f.isActive, true);
  assert.equal("totpSecret" in (await r.json()), false);
});

test("reenviar el rol de siempre (SUPER_ADMIN) no estorba: la cédula se guarda", async () => {
  const r = await PATCH("us-dueno", { role: "SUPER_ADMIN", cedulaProfesional: "13318429" });
  assert.equal(r.status, 200);
  assert.equal(fila("us-dueno").cedulaProfesional, "13318429");
});

test("🔴 BEVADENT — el cuerpo que mandaba el modal viejo (el dueño toca «Doctor» y guarda la cédula): 400 «No puedes cambiar tu propio rol» y NO se guarda nada", async () => {
  const r = await PATCH("us-dueno", { role: "DOCTOR", cedulaProfesional: "13318429" });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, "No puedes cambiar tu propio rol");
  assert.equal(fila("us-dueno").cedulaProfesional, null, "la cédula tampoco se guardó: ése era el daño");
  assert.equal(fila("us-dueno").role, "SUPER_ADMIN");
  assert.equal(estado.updates.length, 0);
});

test("el dueño no se puede desactivar a sí mismo (y el resto del cuerpo tampoco se guarda)", async () => {
  const r = await PATCH("us-dueno", { isActive: false, cedulaProfesional: "13318429" });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, "No puedes desactivarte a ti mismo");
  assert.equal(fila("us-dueno").isActive, true);
  assert.equal(estado.updates.length, 0);
});

test("«Aparece en la agenda» (agendaActive): el dueño lo apaga y lo enciende; solo vale un booleano", async () => {
  assert.equal((await PATCH("us-dueno", { agendaActive: false })).status, 200);
  assert.equal(fila("us-dueno").agendaActive, false);
  assert.equal((await PATCH("us-dueno", { agendaActive: true })).status, 200);
  assert.equal(fila("us-dueno").agendaActive, true);
  // "false" (texto) o 0 no se coaccionan: se ignoran y el resto sí se guarda.
  assert.equal((await PATCH("us-dueno", { agendaActive: "false", phone: "5550001111" })).status, 200);
  assert.equal(fila("us-dueno").agendaActive, true);
  assert.equal(fila("us-dueno").phone, "5550001111");
  assert.equal((await PATCH("us-dueno", { agendaActive: 0 })).status, 200);
  assert.equal(fila("us-dueno").agendaActive, true);
});

test("un ADMIN que edita a otro miembro puede cambiarle «atiende pacientes»; un miembro de otra clínica no existe", async () => {
  estado.sesion = sesion("ADMIN", "us-admin");
  assert.equal((await PATCH("doc-otro", { agendaActive: false })).status, 200);
  assert.equal(fila("doc-otro").agendaActive, false);
  estado.filas.push({ id: "ajeno", clinicId: "cl-otra", supabaseId: "33333333-3333-4333-8333-333333333333", role: "DOCTOR", email: "z@x.com", firstName: "Z", lastName: "Z", isActive: true, agendaActive: true });
  assert.equal((await PATCH("ajeno", { agendaActive: false })).status, 404);
  assert.equal(fila("ajeno").agendaActive, true);
});

test("un ADMIN sigue sin poder cambiar el rol ni el correo del dueño", async () => {
  estado.sesion = sesion("ADMIN", "us-admin");
  const rol = await PATCH("us-dueno", { role: "DOCTOR" });
  assert.equal(rol.status, 403);
  const correo = await PATCH("us-dueno", { email: "otro@x.com" });
  assert.equal(correo.status, 403);
  assert.equal(fila("us-dueno").role, "SUPER_ADMIN");
  assert.equal(fila("us-dueno").email, "bevadent@outlook.com");
});

/* ── el formulario: lo que viaja ────────────────────────────────────────── */

const miembroDueno = {
  firstName: "Johnnifer", lastName: "Benítez Valencia", email: "bevadent@outlook.com", role: "SUPER_ADMIN",
  specialty: "Ortodoncia", color: "#3b82f6", phone: "4523093809", services: ["ortodoncia"],
  cedulaProfesional: null, especialidad: "Ortodoncia y Ortopedia Dentofacial", cedulaEspecialidad: null, agendaActive: true,
};

test("el modal arranca con el rol de siempre y, sin tocar el rol, el parche NO lo lleva", () => {
  const inicial = formDeMiembro(miembroDueno);
  assert.equal(inicial.role, "SUPER_ADMIN");
  const parche = parcheDeCambios(inicial, { ...inicial, cedulaProfesional: "13318429" });
  assert.deepEqual(parche, { cedulaProfesional: "13318429" });
});

test("🔴 reproducción: con el modal viejo, tocar «Doctor» metía role en el parche — el cuerpo que el servidor rechaza", async () => {
  const inicial = formDeMiembro(miembroDueno);
  const actual: DatosEditablesDeMiembro = { ...inicial, role: "DOCTOR", cedulaProfesional: "13318429" };
  const viejo = parcheDeCambios(inicial, actual); // sin `rolFijo`: lo que hacía la pantalla
  assert.equal(viejo.role, "DOCTOR");
  assert.equal((await PATCH("us-dueno", viejo)).status, 400);
});

test("con el rol fijo (dueño o uno mismo) el rol nunca viaja, aunque el formulario lo traiga distinto; lo demás sí", async () => {
  const inicial = formDeMiembro(miembroDueno);
  const actual: DatosEditablesDeMiembro = { ...inicial, role: "DOCTOR", cedulaProfesional: "13318429", agendaActive: false };
  const nuevo = parcheDeCambios(inicial, actual, { rolFijo: true });
  assert.equal("role" in nuevo, false);
  assert.deepEqual(nuevo, { cedulaProfesional: "13318429", agendaActive: false });
  const r = await PATCH("us-dueno", nuevo);
  assert.equal(r.status, 200);
  assert.equal(fila("us-dueno").cedulaProfesional, "13318429");
  assert.equal(fila("us-dueno").role, "SUPER_ADMIN");
});

test("editar a otra persona SIN rol fijo sigue mandando el rol cuando cambia (no se rompió el caso normal)", () => {
  const inicial = formDeMiembro({ ...miembroDueno, role: "RECEPTIONIST" });
  assert.deepEqual(parcheDeCambios(inicial, { ...inicial, role: "DOCTOR" }, { rolFijo: false }), { role: "DOCTOR" });
});

test("motivoRolFijo: el dueño siempre; uno mismo siempre; el alta y los demás, nunca", () => {
  assert.equal(motivoRolFijo({ esEdicion: true, rol: "SUPER_ADMIN", esYo: true }), "dueno");
  assert.equal(motivoRolFijo({ esEdicion: true, rol: "SUPER_ADMIN", esYo: false }), "dueno");
  assert.equal(motivoRolFijo({ esEdicion: true, rol: "ADMIN", esYo: true }), "propio");
  assert.equal(motivoRolFijo({ esEdicion: true, rol: "DOCTOR", esYo: false }), null);
  assert.equal(motivoRolFijo({ esEdicion: false, rol: "SUPER_ADMIN", esYo: false }), null);
  assert.equal(motivoRolFijo({ esEdicion: false, rol: "DOCTOR", esYo: true }), null);
});

test("«Aparece en la agenda» y «Horario»: el doctor siempre; administrador y dueño solo si atienden; recepción nunca", () => {
  assert.equal(formDeMiembro({ ...miembroDueno, agendaActive: undefined }).agendaActive, true, "sin dato = atiende (default de la base)");
  assert.equal(formDeMiembro({ ...miembroDueno, agendaActive: false }).agendaActive, false);

  for (const rol of ["DOCTOR", "ADMIN", "SUPER_ADMIN"]) assert.equal(puedeMarcarAtiende(rol), true, rol);
  for (const rol of ["RECEPTIONIST", "READONLY"]) assert.equal(puedeMarcarAtiende(rol), false, rol);

  assert.equal(ofreceHorario({ role: "DOCTOR" }), true);
  assert.equal(ofreceHorario({ role: "DOCTOR", agendaActive: false }), true);
  assert.equal(ofreceHorario({ role: "SUPER_ADMIN", agendaActive: true }), true, "el dueño que atiende ya puede fijar su horario");
  assert.equal(ofreceHorario({ role: "SUPER_ADMIN" }), true);
  assert.equal(ofreceHorario({ role: "ADMIN", agendaActive: false }), false);
  assert.equal(ofreceHorario({ role: "SUPER_ADMIN", agendaActive: false }), false);
  assert.equal(ofreceHorario({ role: "RECEPTIONIST", agendaActive: true }), false);
});
