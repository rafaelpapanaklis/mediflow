// Una ficha de barbero = una persona activa (lógica L3 ronda 2, D5).
//
//   npx tsx --test src/lib/barber/__tests__/ficha-una-persona.test.ts
//
// En panel.108 tres usuarios quedaron ligados a «Barbero Prueba Dos»: las
// citas y comisiones de esa ficha eran «suyas» de los tres. Se conduce
// updateMember REAL contra un prisma en memoria (sembrado en globalThis.prisma
// antes de cargar team.ts, como equipo-permisos.test.ts).
import "./_sin-server-only";
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { BarberContext } from "@/lib/barber-auth";
import type { BarberRole } from "@/lib/barber/types";

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
const FICHAS = ["luis", "tono"];
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

function exigir(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`doble de prisma: ${msg}`);
}
const fila = (u: Usuario) => ({ ...u, barber: null, branchAccess: [] });

type WhereUsuario = {
  id?: string | { not?: string };
  barbershopId?: string | { in?: string[] };
  barberId?: string;
  isActive?: boolean;
};

const doble = {
  barbershop: {
    async findMany() {
      return [{ id: SEDE.id }];
    },
    async findUnique() {
      return SEDE;
    },
  },
  barberUserBranchAccess: { findMany: async () => [] },
  barberPlanConfig: { findMany: async () => [] },
  barber: {
    async findFirst({ where }: { where: { id: string; barbershopId: string } }) {
      exigir(where.barbershopId === SEDE.id, "barber.findFirst sin la sede");
      return FICHAS.includes(where.id) ? { id: where.id } : null;
    },
  },
  barberUser: {
    async findFirst({ where }: { where: WhereUsuario }) {
      if (typeof where.id === "string") {
        exigir(typeof where.barbershopId === "object" && Array.isArray(where.barbershopId.in), "findFirst por id sin sedes");
        const u = usuarios.find((x) => x.id === where.id && (where.barbershopId as { in: string[] }).in.includes(x.barbershopId));
        return u ? fila(u) : null;
      }
      // La búsqueda de la ficha ocupada.
      exigir(typeof where.barberId === "string", "findFirst sin id ni barberId");
      const not = typeof where.id === "object" ? where.id.not : undefined;
      const u = usuarios.find(
        (x) => x.barberId === where.barberId && (where.isActive === undefined || x.isActive === where.isActive) && x.id !== not,
      );
      return u ? { firstName: u.firstName, lastName: u.lastName } : null;
    },
    async findMany({ where }: { where: WhereUsuario }) {
      const not = typeof where.id === "object" ? where.id.not : undefined;
      return usuarios.filter((x) => (where.isActive === undefined || x.isActive === where.isActive) && x.id !== not).map(fila);
    },
    async update({ where, data }: { where: { id: string }; data: Partial<Usuario> }) {
      const u = usuarios.find((x) => x.id === where.id);
      exigir(u, "update de un id que no existe");
      Object.assign(u, data);
      return fila(u);
    },
  },
};

let team: typeof import("@/lib/barber/team");
before(async () => {
  (globalThis as unknown as { prisma: unknown }).prisma = doble;
  team = await import("@/lib/barber/team");
});

beforeEach(() => {
  usuarios = [
    usuario("dueno", "OWNER"),
    usuario("luis", "BARBER", { barberId: "luis", firstName: "Luis", lastName: "Ramírez" }),
    usuario("nuevo", "BARBER"),
    usuario("viejo", "BARBER", { barberId: "tono", isActive: false }),
  ];
});

const dueno = {
  barberUserId: "dueno",
  barbershopId: SEDE.id,
  barbershop: SEDE,
  user: usuarios[0] ?? { permissionsOverride: [] },
  barber: null,
  role: "OWNER",
} as unknown as BarberContext;
const de = (id: string) => usuarios.find((x) => x.id === id)!;

async function rechaza(p: Promise<unknown>, status: number, texto?: RegExp) {
  await assert.rejects(p, (err: unknown) => {
    assert.ok(err instanceof team.BarberAdminError, `se esperaba BarberAdminError, llegó: ${String(err)}`);
    assert.equal((err as { status: number }).status, status);
    if (texto) assert.match((err as Error).message, texto);
    return true;
  });
}

test("ligar a otra persona activa la ficha de Luis: 409 que dice de quién es", async () => {
  await rechaza(team.updateMember(dueno, "nuevo", { barberId: "luis" }), 409, /ya es de Luis Ramírez/);
  assert.equal(de("nuevo").barberId, null);
});

test("si quien la tenía está de baja, la ficha está libre", async () => {
  const row = await team.updateMember(dueno, "nuevo", { barberId: "tono" });
  assert.equal(row.barberId, "tono");
});

test("reactivar a alguien cuya ficha tomó otro mientras estaba de baja: 409", async () => {
  de("nuevo").barberId = "tono"; // tomó la ficha de «viejo»
  await rechaza(team.updateMember(dueno, "viejo", { isActive: true }), 409, /ya es de nuevo/);
  assert.equal(de("viejo").isActive, false);
});

test("editar el nombre de alguien con su misma ficha no choca consigo mismo", async () => {
  const row = await team.updateMember(dueno, "luis", { firstName: "Luis Ángel", barberId: "luis" });
  assert.equal(row.firstName, "Luis Ángel");
});

test("datos viejos compartidos: se pueden seguir editando sin tocar la ficha", async () => {
  de("nuevo").barberId = "luis"; // ya estaba duplicada antes de la regla
  const row = await team.updateMember(dueno, "nuevo", { lastName: "Otro", barberId: "luis" });
  assert.equal(row.lastName, "Otro");
});

test("desligar siempre se puede", async () => {
  const row = await team.updateMember(dueno, "luis", { barberId: null });
  assert.equal(row.barberId, null);
});
