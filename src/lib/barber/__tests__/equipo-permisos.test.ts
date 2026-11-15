// Equipo: quién puede tocar a quién (auditoría 14-nov, G2).
//
// Lo que se encontró EN VIVO: un Encargado (trae team.manage de fábrica)
// podía (1) darse a sí mismo el permiso de cobro, (2) dejar al dueño solo con
// «Ver agenda» y (3) darlo de baja. Aquí se conducen las funciones REALES de
// src/lib/barber/team.ts — updateMember, setMemberPermissions, inviteMember —
// contra una base en memoria, con los mismos pasos de la auditora, y cada
// freno lleva su caso de control («lo permitido sigue pasando») para que la
// prueba no pueda quedar verde a base de rechazarlo todo.
//
//   npx tsx --test src/lib/barber/__tests__/equipo-permisos.test.ts
//
// Sin base y sin .env: src/lib/prisma.ts reutiliza globalThis.prisma si ya
// existe, así que el doble se siembra ahí ANTES de cargar el módulo (por eso
// team.ts entra con import() dentro de before(), no con un import estático,
// que se izaría por encima de la siembra).
import "./_sin-server-only";
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { BarberContext } from "@/lib/barber-auth";
import {
  BARBER_PERMISSION_KEYS,
  BARBER_ROLE_DEFAULT_PERMISSIONS,
  type BarberPermissionKey,
} from "@/lib/barber/permissions";
import type { BarberRole } from "@/lib/barber/types";

// ── Base en memoria ────────────────────────────────────────────────────

type Usuario = {
  id: string;
  barbershopId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: BarberRole;
  barberId: string | null;
  isActive: boolean;
  permissionsOverride: string[];
  lastLogin: Date | null;
  createdAt: Date;
};

const SEDE = { id: "sede-1", parentId: null as string | null, plan: "PROFESIONAL", name: "Barbería Prueba" };
const OTRA_SEDE = { id: "sede-ajena", parentId: null as string | null, plan: "PROFESIONAL", name: "Otra" };

let usuarios: Usuario[] = [];

function usuario(id: string, role: BarberRole, extra: Partial<Usuario> = {}): Usuario {
  return {
    id,
    barbershopId: SEDE.id,
    email: `${id}@prueba.local`,
    firstName: id,
    lastName: "Prueba",
    role,
    barberId: null,
    isActive: true,
    permissionsOverride: [],
    lastLogin: null,
    createdAt: new Date("2026-11-01T00:00:00Z"),
    ...extra,
  };
}

/** Un operador que el doble no conoce truena: nada de verdes por descuido. */
function exigir(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`doble de prisma: ${msg}`);
}

const fila = (u: Usuario) => ({ ...u, barber: null, branchAccess: [] });

const doble = {
  barbershop: {
    async findMany({ where }: { where: { OR: Array<{ id?: string; parentId?: string }> } }) {
      exigir(Array.isArray(where?.OR), "barbershop.findMany sin OR");
      return [SEDE, OTRA_SEDE]
        .filter((s) => where.OR.some((c) => (c.id && s.id === c.id) || (c.parentId && s.parentId === c.parentId)))
        .map((s) => ({ id: s.id }));
    },
    async findUnique({ where }: { where: { id: string } }) {
      exigir(typeof where?.id === "string", "barbershop.findUnique sin id");
      return [SEDE, OTRA_SEDE].find((s) => s.id === where.id) ?? null;
    },
  },
  barberUserBranchAccess: {
    async findMany() {
      return [];
    },
  },
  // Tabla de planes vacía → plans.ts cae a su fallback (Profesional trae
  // advancedRoles, que es lo que abre la matriz de permisos por persona).
  barberPlanConfig: {
    async findMany() {
      return [];
    },
  },
  barberUser: {
    async findFirst({ where }: { where: { id?: string; barbershopId?: { in?: string[] } } }) {
      exigir(typeof where?.id === "string", "barberUser.findFirst sin id");
      // El filtro de sede se aplica DE VERDAD: es el aislamiento entre barberías.
      exigir(Array.isArray(where.barbershopId?.in), "barberUser.findFirst sin barbershopId.in");
      const u = usuarios.find((x) => x.id === where.id && where.barbershopId!.in!.includes(x.barbershopId));
      return u ? fila(u) : null;
    },
    async findMany({ where }: { where: { barbershopId?: string; isActive?: boolean; id?: { not?: string } } }) {
      exigir(typeof where?.barbershopId === "string", "barberUser.findMany sin barbershopId");
      return usuarios
        .filter(
          (x) =>
            x.barbershopId === where.barbershopId &&
            (where.isActive === undefined || x.isActive === where.isActive) &&
            x.id !== where.id?.not,
        )
        .map(fila);
    },
    async update({ where, data }: { where: { id: string }; data: Partial<Usuario> }) {
      const u = usuarios.find((x) => x.id === where.id);
      exigir(u, `barberUser.update de un id que no existe (${where.id})`);
      Object.assign(u, data);
      return fila(u);
    },
  },
};

// ── Carga del módulo real ──────────────────────────────────────────────

let team: typeof import("@/lib/barber/team");

before(async () => {
  (globalThis as unknown as { prisma: unknown }).prisma = doble;
  team = await import("@/lib/barber/team");
});

beforeEach(() => {
  usuarios = [
    usuario("dueno", "OWNER"),
    usuario("dueno2", "OWNER"),
    usuario("gerente", "MANAGER"),
    usuario("recepcion", "RECEPTION"),
    usuario("barbero", "BARBER"),
    // De OTRA barbería: nadie de la sede-1 debe poder alcanzarlo.
    usuario("ajeno", "RECEPTION", { barbershopId: OTRA_SEDE.id }),
  ];
});

function sesion(id: string): BarberContext {
  const u = usuarios.find((x) => x.id === id);
  assert.ok(u, `no existe el usuario ${id}`);
  const sede = u.barbershopId === SEDE.id ? SEDE : OTRA_SEDE;
  return {
    barberUserId: u.id,
    barbershopId: u.barbershopId,
    barbershop: sede,
    user: u,
    barber: null,
    role: u.role,
  } as unknown as BarberContext;
}

const de = (id: string) => usuarios.find((x) => x.id === id)!;
const delRol = (role: BarberRole): BarberPermissionKey[] => [...BARBER_ROLE_DEFAULT_PERMISSIONS[role]];

/** Espera un BarberAdminError con ese status (y, si se pide, ese texto). */
async function rechaza(p: Promise<unknown>, status: number, texto?: RegExp) {
  await assert.rejects(p, (err: unknown) => {
    assert.ok(err instanceof team.BarberAdminError, `se esperaba BarberAdminError, llegó: ${String(err)}`);
    assert.equal((err as { status: number }).status, status);
    if (texto) assert.match((err as Error).message, texto);
    return true;
  });
}

// ── 1. Los tres pasos de la auditora ───────────────────────────────────

test("un encargado NO puede darse a sí mismo el permiso de cobro", async () => {
  await rechaza(
    team.setMemberPermissions(sesion("gerente"), "gerente", [...BARBER_PERMISSION_KEYS]),
    403,
    /Suscripción y pagos DaleControl/,
  );
  assert.deepEqual(de("gerente").permissionsOverride, [], "no se guardó nada");
});

test("un encargado NO puede recortarle los permisos a un dueño", async () => {
  await rechaza(team.setMemberPermissions(sesion("gerente"), "dueno", ["agenda.view"]), 403, /otro dueño/);
  assert.deepEqual(de("dueno").permissionsOverride, []);
});

test("un encargado NO puede dar de baja a un dueño", async () => {
  await rechaza(team.updateMember(sesion("gerente"), "dueno", { isActive: false }), 403, /otro dueño/);
  assert.equal(de("dueno").isActive, true);
});

test("un encargado NO puede cambiarle el rol ni los datos a un dueño", async () => {
  await rechaza(team.updateMember(sesion("gerente"), "dueno", { role: "BARBER" }), 403);
  await rechaza(team.updateMember(sesion("gerente"), "dueno", { firstName: "Otro" }), 403);
  assert.equal(de("dueno").role, "OWNER");
  assert.equal(de("dueno").firstName, "dueno");
});

test("un encargado tampoco puede reactivar a un dueño dado de baja", async () => {
  de("dueno2").isActive = false;
  await rechaza(team.updateMember(sesion("gerente"), "dueno2", { isActive: true }), 403);
  assert.equal(de("dueno2").isActive, false);
});

// ── 2. Nadie reparte lo que no tiene ───────────────────────────────────

test("un encargado NO puede darle el permiso de cobro a otra persona", async () => {
  await rechaza(
    team.setMemberPermissions(sesion("gerente"), "recepcion", [...delRol("RECEPTION"), "billing.manage"]),
    403,
    /un permiso que tú no tienes/,
  );
  assert.deepEqual(de("recepcion").permissionsOverride, []);
});

test("alguien con permisos recortados no reparte los que le quitaron", async () => {
  // Recepción a la que el dueño le sumó «Administrar el equipo» y nada más.
  de("recepcion").permissionsOverride = [...delRol("RECEPTION"), "team.manage"];
  await rechaza(
    team.setMemberPermissions(sesion("recepcion"), "barbero", [...delRol("BARBER"), "settings.edit"]),
    403,
    /Configuración de la barbería/,
  );
  // …ni por la vía del rol: subir a alguien a Encargado le daría de todo.
  await rechaza(team.updateMember(sesion("recepcion"), "barbero", { role: "MANAGER" }), 403);
  // …ni dando de alta a un Encargado nuevo (se frena antes de crear la cuenta).
  await rechaza(
    team.inviteMember(sesion("recepcion"), {
      email: "nuevo@prueba.local",
      firstName: "Nuevo",
      lastName: "Prueba",
      role: "MANAGER",
    }),
    403,
  );
  assert.equal(de("barbero").role, "BARBER");
  assert.deepEqual(de("barbero").permissionsOverride, []);
});

// ── 3. Controles: lo permitido sigue pasando ───────────────────────────

test("control: un encargado SÍ reparte un permiso que él tiene", async () => {
  const quiero = [...delRol("BARBER"), "cash.view"];
  const fila = await team.setMemberPermissions(sesion("gerente"), "barbero", quiero);
  assert.ok(de("barbero").permissionsOverride.includes("cash.view"));
  assert.deepEqual(fila.permissions.added, ["cash.view"]);
});

test("control: un encargado SÍ cambia roles por debajo del suyo y da de baja", async () => {
  await team.updateMember(sesion("gerente"), "barbero", { role: "RECEPTION" });
  assert.equal(de("barbero").role, "RECEPTION");
  await team.updateMember(sesion("gerente"), "recepcion", { role: "MANAGER" });
  assert.equal(de("recepcion").role, "MANAGER");
  await team.updateMember(sesion("gerente"), "barbero", { isActive: false });
  assert.equal(de("barbero").isActive, false);
});

test("control: el dueño SÍ da el permiso de cobro y SÍ administra a otro dueño", async () => {
  await team.setMemberPermissions(sesion("dueno"), "gerente", [...delRol("MANAGER"), "billing.manage"]);
  assert.ok(de("gerente").permissionsOverride.includes("billing.manage"));

  await team.setMemberPermissions(sesion("dueno"), "dueno2", ["agenda.view", "team.manage"]);
  assert.deepEqual(de("dueno2").permissionsOverride, ["agenda.view", "team.manage"]);
  await team.updateMember(sesion("dueno"), "dueno2", { isActive: false });
  assert.equal(de("dueno2").isActive, false);
});

test("control: se puede editar a quien YA tenía un permiso que tú no tienes, sin dárselo de nuevo", async () => {
  // El dueño le dio cobro a recepción; el encargado (sin cobro) le quita la fila.
  const base = [...delRol("RECEPTION"), "billing.manage"];
  de("recepcion").permissionsOverride = base;
  const sinFila = base.filter((k) => k !== "walkin.manage");
  await team.setMemberPermissions(sesion("gerente"), "recepcion", sinFila);
  assert.ok(de("recepcion").permissionsOverride.includes("billing.manage"), "conserva lo que ya tenía");
  assert.ok(!de("recepcion").permissionsOverride.includes("walkin.manage"));
});

// ── 4. Lo que ya frenaba sigue frenando ────────────────────────────────

test("sin team.manage no se toca a nadie", async () => {
  await assert.rejects(
    team.setMemberPermissions(sesion("barbero"), "recepcion", delRol("RECEPTION")),
    (err: unknown) => (err as Error).name === "BarberForbiddenError",
  );
  await assert.rejects(
    team.updateMember(sesion("barbero"), "recepcion", { isActive: false }),
    (err: unknown) => (err as Error).name === "BarberForbiddenError",
  );
});

test("un usuario de otra barbería no existe para esta sesión (404)", async () => {
  await rechaza(team.setMemberPermissions(sesion("dueno"), "ajeno", ["agenda.view"]), 404);
  await rechaza(team.updateMember(sesion("dueno"), "ajeno", { isActive: false }), 404);
  assert.equal(de("ajeno").isActive, true);
});

test("nadie se da de baja a sí mismo ni deja la sede sin administrador", async () => {
  await rechaza(team.updateMember(sesion("dueno"), "dueno", { isActive: false }), 409);
  // Con un solo administrador en la sede, no se le puede dar de baja.
  usuarios = [usuario("dueno", "OWNER"), usuario("unico", "MANAGER", { barbershopId: OTRA_SEDE.id })];
  OTRA_SEDE.parentId = SEDE.id; // sucursal de la cadena del dueño
  try {
    await rechaza(team.updateMember(sesion("dueno"), "unico", { isActive: false }), 409);
  } finally {
    OTRA_SEDE.parentId = null;
  }
});
