// Bloqueos por rol (lógica L3 ronda 2, decisión del gerente 15-nov):
//   · Recepción, por omisión, pone y quita bloqueos de cualquiera (no horarios);
//   · el Barbero pone y quita SOLO los suyos (nunca toda la barbería ni los de otro);
//   · el horario recurrente sigue siendo de schedule.manage.
//
//   npx tsx --test src/lib/barber/__tests__/bloqueos-por-rol.test.ts
//
// Se conducen las rutas REALES (POST /api/barber/schedules/timeoff y
// DELETE /api/barber/schedules/timeoff/[id]) con dos dobles por Module._load:
// el gate de la agenda (quién está logueado) y prisma (en memoria).
import "./_sin-server-only";
import Module from "node:module";
import path from "node:path";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  BARBER_ROLE_DEFAULT_PERMISSIONS,
  hasBarberPermission,
  timeOffAllowed,
  timeOffScope,
  type BarberPermissionKey,
} from "@/lib/barber/permissions";
import type { BarberRole } from "@/lib/barber/types";

// ── Lo puro ────────────────────────────────────────────────────────────

test("por omisión: Recepción bloquea a cualquiera pero no toca horarios", () => {
  const r = { role: "RECEPTION" as BarberRole, permissionsOverride: null };
  assert.equal(hasBarberPermission(r, "schedule.manage"), false);
  assert.equal(timeOffScope({ ...r, ownBarberId: null }), "all");
});

test("por omisión: el Barbero solo lo suyo, y sin ficha nada", () => {
  const b = { role: "BARBER" as BarberRole, permissionsOverride: null };
  assert.equal(hasBarberPermission(b, "schedule.manage"), false);
  assert.deepEqual(timeOffScope({ ...b, ownBarberId: "luis" }), { barberId: "luis" });
  assert.equal(timeOffScope({ ...b, ownBarberId: null }), null);
});

test("quien administra horarios (dueño, encargado u override viejo) sigue bloqueando todo", () => {
  assert.equal(timeOffScope({ role: "OWNER", permissionsOverride: null, ownBarberId: null }), "all");
  assert.equal(timeOffScope({ role: "MANAGER", permissionsOverride: null, ownBarberId: null }), "all");
  // Override hecho antes de que existieran las claves de bloqueos: schedule.manage las incluye.
  assert.equal(
    timeOffScope({ role: "BARBER", permissionsOverride: ["agenda.view", "schedule.manage"], ownBarberId: "luis" }),
    "all",
  );
  // Y el dueño puede quitárselo a un barbero con un override sin timeoff.own.
  assert.equal(timeOffScope({ role: "BARBER", permissionsOverride: ["agenda.view"], ownBarberId: "luis" }), null);
});

test("alcance propio: ni toda la barbería ni otro barbero", () => {
  const propio = { barberId: "luis" };
  assert.equal(timeOffAllowed(propio, "luis"), true);
  assert.equal(timeOffAllowed(propio, "tono"), false);
  assert.equal(timeOffAllowed(propio, null), false);
  assert.equal(timeOffAllowed("all", null), true);
  assert.equal(timeOffAllowed(null, "luis"), false);
});

test("las claves nuevas están en el rol que toca y no en el que no", () => {
  const def = BARBER_ROLE_DEFAULT_PERMISSIONS;
  assert.ok(def.RECEPTION.includes("timeoff.manage"));
  assert.ok(!def.RECEPTION.includes("schedule.manage"));
  assert.ok(def.BARBER.includes("timeoff.own"));
  assert.ok(!def.BARBER.includes("timeoff.manage"));
});

// ── Las rutas reales ───────────────────────────────────────────────────

type Sesion = { role: BarberRole; override: string[] | null; barberId: string | null };
let sesion: Sesion = { role: "OWNER", override: null, barberId: null };

type Bloqueo = { id: string; barbershopId: string; barberId: string | null; startAt: Date; endAt: Date; reason: string | null; type: string; createdByUserId: string };
let bloqueos: Bloqueo[] = [];
let n = 0;
const SHOP = "shop1";
const BARBEROS = ["luis", "tono"];

const prismaDoble = {
  barber: {
    findFirst: async ({ where }: { where: { id: string; barbershopId: string } }) =>
      where.barbershopId === SHOP && BARBEROS.includes(where.id) ? { id: where.id } : null,
  },
  barberTimeOff: {
    findFirst: async ({ where }: { where: Partial<Bloqueo> }) =>
      bloqueos.find((b) =>
        (where.id === undefined || b.id === where.id) &&
        b.barbershopId === where.barbershopId &&
        (where.barberId === undefined || b.barberId === where.barberId) &&
        (where.startAt === undefined || b.startAt.getTime() === (where.startAt as Date).getTime()) &&
        (where.endAt === undefined || b.endAt.getTime() === (where.endAt as Date).getTime()),
      ) ?? null,
    create: async ({ data }: { data: Omit<Bloqueo, "id"> }) => {
      const row = { id: `off${++n}`, ...data };
      bloqueos.push(row);
      return row;
    },
    deleteMany: async ({ where }: { where: { id: string; barbershopId: string } }) => {
      const antes = bloqueos.length;
      bloqueos = bloqueos.filter((b) => !(b.id === where.id && b.barbershopId === where.barbershopId));
      return { count: antes - bloqueos.length };
    },
  },
  barberAppointment: { findMany: async () => [] },
};

function jsonError(error: string, status: number) {
  return new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } });
}
const serverDoble = {
  APPOINTMENT_INCLUDE: {},
  asDate: (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v) : null),
  asString: (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null),
  jsonError,
  readJson: async (req: Request) => req.json().catch(() => null),
  // Igual que el real: basta CUALQUIERA de los permisos de la lista.
  openAgendaGate: async (opts: { permission: BarberPermissionKey | BarberPermissionKey[] }) => {
    const keys = Array.isArray(opts.permission) ? opts.permission : [opts.permission];
    const perm = { role: sesion.role, permissionsOverride: sesion.override };
    if (!keys.some((k) => hasBarberPermission(perm, k))) return { gate: null, response: jsonError("No tienes permiso para esto.", 403) };
    const ctx = {
      role: sesion.role,
      user: { permissionsOverride: sesion.override },
      barber: sesion.barberId ? { id: sesion.barberId } : null,
      barberUserId: "u1",
    };
    return { gate: { ctx, shopId: SHOP, shopName: "X", timezone: "America/Mexico_City", plan: {} }, response: null };
  },
};

const SRC = path.resolve(__dirname, "../../..");
const dobles = new Map<string, unknown>([
  [path.join(SRC, "lib/prisma.ts"), { prisma: prismaDoble }],
  [path.join(SRC, "app/api/barber/appointments/_server.ts"), serverDoble],
]);
const M = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (request: string, parent: unknown, isMain: boolean) => string;
};
const cargaOriginal = M._load;

let POST: (req: Request) => Promise<Response>;
let DELETE: (req: Request, props: { params: Promise<{ id: string }> }) => Promise<Response>;

before(async () => {
  M._load = function (request: string, parent: unknown, isMain: boolean) {
    try {
      const r = M._resolveFilename(request, parent, isMain);
      if (dobles.has(r)) return dobles.get(r);
    } catch {
      /* que lo resuelva el cargador normal */
    }
    return cargaOriginal.call(this, request, parent, isMain);
  };
  POST = (await import("@/app/api/barber/schedules/timeoff/route")).POST as typeof POST;
  DELETE = (await import("@/app/api/barber/schedules/timeoff/[id]/route")).DELETE as typeof DELETE;
});
after(() => {
  M._load = cargaOriginal;
});
beforeEach(() => {
  bloqueos = [];
});

const como = (role: BarberRole, barberId: string | null = null, override: string[] | null = null) => {
  sesion = { role, barberId, override };
};
let h = 0;
const poner = (barberId: string | null) => {
  h++;
  const body = { barberId, type: "BREAK", startAt: `2026-12-0${(h % 8) + 1}T18:00:00Z`, endAt: `2026-12-0${(h % 8) + 1}T19:00:00Z` };
  return POST(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }));
};
const quitar = (id: string) => DELETE(new Request("http://x/api", { method: "DELETE" }), { params: Promise.resolve({ id }) });
const sembrar = (barberId: string | null) => {
  const row = { id: `s${++n}`, barbershopId: SHOP, barberId, startAt: new Date(), endAt: new Date(), reason: null, type: "BREAK", createdByUserId: "x" };
  bloqueos.push(row);
  return row.id;
};

test("ruta · Barbero: pone su comida (201), no la de otro ni el festivo (403)", async () => {
  como("BARBER", "luis");
  assert.equal((await poner("luis")).status, 201);
  const otro = await poner("tono");
  assert.equal(otro.status, 403);
  assert.match((await otro.json()).error, /tu propia agenda/);
  assert.equal((await poner(null)).status, 403);
  assert.equal(bloqueos.length, 1);
});

test("ruta · Barbero: quita el suyo; el de otro da 403 y sigue ahí", async () => {
  como("BARBER", "luis");
  const suyo = sembrar("luis");
  const ajeno = sembrar("tono");
  const festivo = sembrar(null);
  assert.equal((await quitar(ajeno)).status, 403);
  assert.equal((await quitar(festivo)).status, 403);
  assert.equal((await quitar(suyo)).status, 200);
  assert.deepEqual(bloqueos.map((b) => b.id).sort(), [ajeno, festivo].sort());
});

test("ruta · Barbero sin ficha ligada: no bloquea nada", async () => {
  como("BARBER", null);
  assert.equal((await poner("luis")).status, 403);
});

test("ruta · Recepción: bloquea al que se enfermó y el festivo, y los quita", async () => {
  como("RECEPTION");
  assert.equal((await poner("tono")).status, 201);
  assert.equal((await poner(null)).status, 201);
  for (const b of [...bloqueos]) assert.equal((await quitar(b.id)).status, 200);
  assert.equal(bloqueos.length, 0);
});

test("ruta · Barbero al que el dueño le quitó «sus propios bloqueos»: 403 en la puerta", async () => {
  como("BARBER", "luis", ["agenda.view"]);
  assert.equal((await poner("luis")).status, 403);
  const suyo = sembrar("luis");
  assert.equal((await quitar(suyo)).status, 403);
});
