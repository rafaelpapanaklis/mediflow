// Mover a un barbero de sede (lógica L3 ronda 2, D4).
//
//   npx tsx --test src/lib/barber/__tests__/barbero-cambio-de-sede.test.ts
//
// Se conduce updateBarberProfile REAL contra un prisma en memoria (sembrado en
// globalThis.prisma antes de cargar team.ts, como equipo-permisos.test.ts):
//   · con citas próximas → 409 que dice cuántas, y NO se mueve nada;
//   · sin citas próximas → cambia de sede, se va al final de la lista de la
//     nueva y se lleva su horario y sus bloqueos vigentes;
//   · una sede cerrada o de otra cadena no recibe a nadie.
import "./_sin-server-only";
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { BarberContext } from "@/lib/barber-auth";

type Sede = { id: string; parentId: string | null; isActive: boolean; plan: string; name: string };
const MATRIZ: Sede = { id: "matriz", parentId: null, isActive: true, plan: "PROFESIONAL", name: "Matriz" };
const NORTE: Sede = { id: "norte", parentId: "matriz", isActive: true, plan: "PROFESIONAL", name: "Norte" };
const CERRADA: Sede = { id: "cerrada", parentId: "matriz", isActive: false, plan: "PROFESIONAL", name: "Cerrada" };
const AJENA: Sede = { id: "ajena", parentId: null, isActive: true, plan: "PROFESIONAL", name: "Otra cadena" };
const SEDES = [MATRIZ, NORTE, CERRADA, AJENA];

type Barbero = { id: string; barbershopId: string; name: string; sortOrder: number; isActive: boolean; [k: string]: unknown };
type Fila = { barberId: string; barbershopId: string; startAt?: Date; endAt?: Date; status?: string };
let barberos: Barbero[] = [];
let citas: Fila[] = [];
let horarios: Fila[] = [];
let bloqueos: Fila[] = [];

const AHORA = Date.now();
const enDias = (d: number) => new Date(AHORA + d * 86_400_000);

function exigir(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`doble de prisma: ${msg}`);
}
const fila = (b: Barbero) => ({
  id: b.id,
  barbershopId: b.barbershopId,
  name: b.name,
  nickname: null,
  photoUrl: null,
  bio: null,
  commissionType: "COMMISSION",
  commissionPct: 50,
  chairRent: null,
  isActive: b.isActive,
  sortOrder: b.sortOrder,
  createdAt: new Date(),
  users: [],
  _count: { schedules: horarios.filter((h) => h.barberId === b.id).length },
});

const doble = {
  barbershop: {
    async findMany({ where }: { where: { OR: Array<{ id?: string; parentId?: string }> } }) {
      return SEDES.filter((s) => where.OR.some((c) => (c.id && s.id === c.id) || (c.parentId && s.parentId === c.parentId))).map((s) => ({ id: s.id }));
    },
    async count({ where }: { where: { id: string; isActive: boolean } }) {
      return SEDES.filter((s) => s.id === where.id && s.isActive === where.isActive).length;
    },
  },
  barberUserBranchAccess: { findMany: async () => [] },
  barber: {
    async findFirst({ where }: { where: { id?: string; barbershopId?: string | { in: string[] } } }) {
      if (where.id) {
        exigir(typeof where.barbershopId === "object" && Array.isArray(where.barbershopId.in), "barber.findFirst por id sin filtro de sedes");
        const b = barberos.find((x) => x.id === where.id && (where.barbershopId as { in: string[] }).in.includes(x.barbershopId));
        return b ? { ...fila(b), commissionPct: 50 } : null;
      }
      const lista = barberos.filter((x) => x.barbershopId === where.barbershopId).sort((a, b) => b.sortOrder - a.sortOrder);
      return lista[0] ? { sortOrder: lista[0].sortOrder } : null;
    },
    async update({ where, data }: { where: { id: string }; data: Partial<Barbero> }) {
      const b = barberos.find((x) => x.id === where.id);
      exigir(b, "barber.update de un id que no existe");
      Object.assign(b, data);
      return fila(b);
    },
  },
  barberAppointment: {
    async count({ where }: { where: { barberId: string; barbershopId: string; startAt: { gte: Date }; status: { notIn: string[] } } }) {
      exigir(where.barbershopId && where.startAt?.gte && where.status?.notIn, "barberAppointment.count sin filtros");
      return citas.filter(
        (c) => c.barberId === where.barberId && c.barbershopId === where.barbershopId && c.startAt! >= where.startAt.gte && !where.status.notIn.includes(c.status!),
      ).length;
    },
  },
  barberSchedule: {
    async updateMany({ where, data }: { where: Fila; data: { barbershopId: string } }) {
      const m = horarios.filter((h) => h.barberId === where.barberId && h.barbershopId === where.barbershopId);
      m.forEach((h) => (h.barbershopId = data.barbershopId));
      return { count: m.length };
    },
  },
  barberTimeOff: {
    async updateMany({ where, data }: { where: { barberId: string; barbershopId: string; endAt: { gt: Date } }; data: { barbershopId: string } }) {
      const m = bloqueos.filter((h) => h.barberId === where.barberId && h.barbershopId === where.barbershopId && h.endAt! > where.endAt.gt);
      m.forEach((h) => (h.barbershopId = data.barbershopId));
      return { count: m.length };
    },
  },
  async $transaction(ops: Promise<unknown>[]) {
    return Promise.all(ops);
  },
};

let team: typeof import("@/lib/barber/team");
before(async () => {
  (globalThis as unknown as { prisma: unknown }).prisma = doble;
  team = await import("@/lib/barber/team");
});

beforeEach(() => {
  barberos = [
    { id: "luis", barbershopId: "matriz", name: "Luis", sortOrder: 0, isActive: true },
    { id: "pepe", barbershopId: "norte", name: "Pepe", sortOrder: 4, isActive: true },
  ];
  citas = [];
  horarios = [
    { barberId: "luis", barbershopId: "matriz" },
    { barberId: "luis", barbershopId: "matriz" },
  ];
  bloqueos = [
    { barberId: "luis", barbershopId: "matriz", endAt: enDias(10) }, // vacaciones que vienen
    { barberId: "luis", barbershopId: "matriz", endAt: enDias(-30) }, // historia: se queda
  ];
});

const dueno = {
  barberUserId: "u-dueno",
  barbershopId: "matriz",
  barbershop: MATRIZ,
  user: { permissionsOverride: [] },
  barber: null,
  role: "OWNER",
} as unknown as BarberContext;

async function rechaza(p: Promise<unknown>, status: number, texto?: RegExp) {
  await assert.rejects(p, (err: unknown) => {
    assert.ok(err instanceof team.BarberAdminError, `se esperaba BarberAdminError, llegó: ${String(err)}`);
    assert.equal((err as { status: number }).status, status);
    if (texto) assert.match((err as Error).message, texto);
    return true;
  });
}

test("con citas próximas no se mueve y dice cuántas", async () => {
  citas = [
    { barberId: "luis", barbershopId: "matriz", startAt: enDias(1), status: "CONFIRMED" },
    { barberId: "luis", barbershopId: "matriz", startAt: enDias(3), status: "PENDING" },
    { barberId: "luis", barbershopId: "matriz", startAt: enDias(2), status: "CANCELLED" }, // no cuenta
    { barberId: "luis", barbershopId: "matriz", startAt: enDias(-5), status: "COMPLETED" }, // pasada: no cuenta
  ];
  await rechaza(team.updateBarberProfile(dueno, "luis", { barbershopId: "norte" }), 409, /Tiene 2 citas próximas/);
  assert.equal(barberos[0].barbershopId, "matriz");
  assert.ok(horarios.every((h) => h.barbershopId === "matriz"));
});

test("sin citas próximas se muda con su horario y sus bloqueos vigentes, al final de la lista", async () => {
  citas = [{ barberId: "luis", barbershopId: "matriz", startAt: enDias(-2), status: "COMPLETED" }];
  const row = await team.updateBarberProfile(dueno, "luis", { barbershopId: "norte" });
  assert.equal(row.barbershopId, "norte");
  assert.equal(barberos[0].sortOrder, 5);
  assert.ok(horarios.every((h) => h.barbershopId === "norte"));
  assert.deepEqual(bloqueos.map((b) => b.barbershopId), ["norte", "matriz"]);
});

test("misma sede o sin sede en el cuerpo: es una edición normal, no revisa citas", async () => {
  citas = [{ barberId: "luis", barbershopId: "matriz", startAt: enDias(1), status: "CONFIRMED" }];
  const row = await team.updateBarberProfile(dueno, "luis", { barbershopId: "matriz", name: "Luis R" });
  assert.equal(row.barbershopId, "matriz");
  assert.equal(barberos[0].name, "Luis R");
});

test("a una sede cerrada (409) o de otra cadena (404) no se mueve", async () => {
  await rechaza(team.updateBarberProfile(dueno, "luis", { barbershopId: "cerrada" }), 409, /cerrada/);
  await rechaza(team.updateBarberProfile(dueno, "luis", { barbershopId: "ajena" }), 404);
  assert.equal(barberos[0].barbershopId, "matriz");
});

test("el mensaje habla en singular con una sola cita", () => {
  assert.match(team.mensajeCitasFuturas(1), /^Tiene 1 cita próxima en esta sede/);
});
