// G1 (ronda 6 de la revisión, 14-nov-2026) — EL ROL BARBERO VE SOLO LO SUYO.
//
// Al darlo de alta, Equipo le promete al dueño: «Ve lo suyo: su agenda, sus
// clientes y sus comisiones». Antes veía la agenda de todos (con nombres y el
// total del día de la barbería) y la cartera completa con teléfonos.
//
// Con las rutas y la capa de datos de verdad, la sesión simulada y Postgres:
//   · Agenda (GET de la agenda, detalle de una visita, horarios): el Barbero
//     recibe SOLO su columna y sus visitas; de lo ajeno no viaja nada.
//   · Clientes (lista, búsqueda, «no han vuelto», búsqueda por teléfono,
//     ficha, lealtad, fotos, autocompletar de la agenda y de la caja): solo
//     los que él atendió o tiene agendados.
//   · Barbero sin ficha ligada: ni agenda ni clientes de nadie.
//   · Dueño, Encargado y Recepción: igual que antes (todo).
//   · Un permiso por persona más amplio (agenda.edit / clients.edit) se respeta.
//   · La fila virtual sigue siendo de todos.
//
//   DATABASE_URL=postgresql://…local… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/barbero-ve-lo-suyo-integration.test.ts
//
// La primera parte es pura; la integración se SALTA sin base local.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import Module from "node:module";
import { Prisma } from "@prisma/client";
import type { BarberContext } from "@/lib/barber-auth";
import { BarberForbiddenError, hasBarberPermission } from "@/lib/barber/permissions";
import { FALLBACK_BARBER_PLAN_CONFIG } from "@/lib/barber/plan-shared";
import {
  agendaViewScope,
  clientsViewScope,
  scopeAppointmentsWhere,
  scopeClientsWhere,
} from "../own-visits";
import { BASE_LOCAL as HAS_DB, skip } from "./_base-local";

// ═══════════════════════════════════════════════════════════════════════
// 0. La regla, pura
// ═══════════════════════════════════════════════════════════════════════

test("la regla: Dueño, Encargado y Recepción ven todo; el Barbero, lo suyo; sin ficha, nada", () => {
  for (const role of ["OWNER", "MANAGER", "RECEPTION"] as const) {
    assert.deepEqual(agendaViewScope({ role, barberId: "b1" }), { kind: "all" }, role);
    assert.deepEqual(clientsViewScope({ role, barberId: null }), { kind: "all" }, role);
  }
  assert.deepEqual(agendaViewScope({ role: "BARBER", barberId: "b1" }), { kind: "own", barberId: "b1" });
  assert.deepEqual(clientsViewScope({ role: "BARBER", barberId: "b1" }), { kind: "own", barberId: "b1" });
  assert.deepEqual(agendaViewScope({ role: "BARBER", barberId: null }), { kind: "none" });
  assert.deepEqual(clientsViewScope({ role: "BARBER", barberId: "" }), { kind: "none" });

  // Permiso por persona más amplio: se respeta, cada uno en lo suyo.
  const conAgenda = { role: "BARBER" as const, barberId: "b1", permissionsOverride: ["agenda.view", "agenda.edit", "clients.view"] };
  assert.deepEqual(agendaViewScope(conAgenda), { kind: "all" });
  assert.deepEqual(clientsViewScope(conAgenda), { kind: "own", barberId: "b1" });
  const conClientes = { role: "BARBER" as const, barberId: "b1", permissionsOverride: ["agenda.view", "clients.view", "clients.edit"] };
  assert.deepEqual(agendaViewScope(conClientes), { kind: "own", barberId: "b1" });
  assert.deepEqual(clientsViewScope(conClientes), { kind: "all" });

  assert.deepEqual(scopeAppointmentsWhere({ kind: "all" }), {});
  assert.deepEqual(scopeAppointmentsWhere({ kind: "own", barberId: "b1" }), { barberId: "b1" });
  assert.deepEqual(scopeAppointmentsWhere({ kind: "none" }), { id: { in: [] } });
  assert.equal(scopeClientsWhere({ kind: "all" }), null);
  assert.deepEqual(scopeClientsWhere({ kind: "none" }), { id: { in: [] } });
});

// ═══════════════════════════════════════════════════════════════════════
// Integración
// ═══════════════════════════════════════════════════════════════════════

const ROOT = path.resolve(__dirname, "../../../..");
const abs = (rel: string) => path.join(ROOT, rel);
const FEATURES = FALLBACK_BARBER_PLAN_CONFIG.PROFESIONAL.features;

let session: BarberContext | null = null;

const DOUBLES = new Map<string, unknown>([
  [
    abs("src/lib/barber-auth.ts"),
    {
      __esModule: true,
      getBarberContext: async () => session,
      assertBarberPermission: (ctx: Pick<BarberContext, "role" | "user">, key: Parameters<typeof hasBarberPermission>[1]) => {
        if (!hasBarberPermission({ role: ctx.role, permissionsOverride: ctx.user.permissionsOverride }, key)) {
          throw new BarberForbiddenError(key);
        }
      },
      getAccessibleBranchIds: async (ctx: BarberContext) => [ctx.barbershopId],
      BarberForbiddenError,
      hasBarberPermission,
    },
  ],
  [abs("src/lib/barber/plans.ts"), { __esModule: true, getBarberPlan: async () => ({ id: "PROFESIONAL", name: "Profesional", features: FEATURES }) }],
]);

const M = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (request: string, parent: unknown) => string;
};
const originalLoad = M._load;
M._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only" || request === "client-only") return {};
  try {
    const resolved = M._resolveFilename(request, parent);
    if (DOUBLES.has(resolved)) return DOUBLES.get(resolved);
  } catch {
    /* que lo resuelva (o falle) el cargador original */
  }
  return originalLoad.call(this, request, parent, isMain);
};

let prisma: typeof import("@/lib/prisma")["prisma"];
let clients: typeof import("@/lib/barber/clients");
let loyalty: typeof import("@/lib/barber/loyalty");
let cash: typeof import("@/lib/barber/cash");
let agendaRoute: typeof import("@/app/api/barber/appointments/route");
let detailRoute: typeof import("@/app/api/barber/appointments/[id]/route");
let pickerRoute: typeof import("@/app/api/barber/appointments/clients/route");
let schedulesRoute: typeof import("@/app/api/barber/schedules/route");
let clientsRoute: typeof import("@/app/api/barber/clients/route");
let clientRoute: typeof import("@/app/api/barber/clients/[id]/route");
let walkinsRoute: typeof import("@/app/api/barber/walkins/route");

const RUN = `v${Date.now().toString(36)}`;
const MIN = 60_000;

let shopId: string;
let uno: string;
let dos: string;
let serviceId: string;
let owner: BarberContext;
let manager: BarberContext;
let reception: BarberContext;
let barberoUno: BarberContext;
let barberoSuelto: BarberContext;
let barberoConPermisos: BarberContext;

// Clientes sembrados
let cMio: string; // agendado con Uno
let cAtendidoPorTicket: string; // solo un ticket de Uno (fila / mostrador)
let cAjeno: string; // solo lo atendió Dos
let cCancelado: string; // con Uno, pero la visita se canceló
let cNadie: string; // nunca vino
let citaUno: string;
let citaDos: string;

const ALL_NAMES = ["Mío Pérez", "Ticket Ruiz", "Ajeno López", "Cancelado Díaz", "Nadie Soto"];

async function makeUser(
  role: "OWNER" | "MANAGER" | "RECEPTION" | "BARBER",
  tag: string,
  barberId: string | null = null,
  permissionsOverride: string[] = [],
): Promise<BarberContext> {
  const shop = await prisma.barbershop.findUniqueOrThrow({ where: { id: shopId } });
  const user = await prisma.barberUser.create({
    data: { barbershopId: shopId, supabaseId: `${RUN}-${tag}`, email: `${RUN}-${tag}@test.local`, firstName: tag, lastName: "Prueba", role, barberId, permissionsOverride },
  });
  const barber = barberId ? await prisma.barber.findUniqueOrThrow({ where: { id: barberId } }) : null;
  return { barberUserId: user.id, barbershopId: shopId, barbershop: shop, user, barber, role };
}

let slot = 0;
async function cita(barberId: string | null, clientId: string, name: string, phone: string, status = "CONFIRMED") {
  const start = new Date(Date.now() + (90 + slot++ * 45) * MIN);
  const a = await prisma.barberAppointment.create({
    data: {
      barbershopId: shopId, barberId, clientId, clientName: name, clientPhone: phone, status: status as never,
      startAt: start, endAt: new Date(start.getTime() + 30 * MIN),
      services: { create: [{ serviceId, priceAtBooking: new Prisma.Decimal(180) }] },
    },
  });
  return a.id;
}

async function cliente(name: string, phone: string) {
  return (await prisma.barberClient.create({ data: { barbershopId: shopId, name, phone } })).id;
}

before(async () => {
  if (!HAS_DB) return;
  ({ prisma } = await import("@/lib/prisma"));
  clients = await import("@/lib/barber/clients");
  loyalty = await import("@/lib/barber/loyalty");
  cash = await import("@/lib/barber/cash");
  agendaRoute = await import("@/app/api/barber/appointments/route");
  detailRoute = await import("@/app/api/barber/appointments/[id]/route");
  pickerRoute = await import("@/app/api/barber/appointments/clients/route");
  schedulesRoute = await import("@/app/api/barber/schedules/route");
  clientsRoute = await import("@/app/api/barber/clients/route");
  clientRoute = await import("@/app/api/barber/clients/[id]/route");
  walkinsRoute = await import("@/app/api/barber/walkins/route");

  const shop = await prisma.barbershop.create({
    data: { name: "Barbería Lo Suyo", slug: `${RUN}-a`, plan: "PROFESIONAL", subscriptionStatus: "active", timezone: "America/Mexico_City" },
  });
  shopId = shop.id;
  uno = (await prisma.barber.create({ data: { barbershopId: shopId, name: "Uno", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) } })).id;
  dos = (await prisma.barber.create({ data: { barbershopId: shopId, name: "Dos", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) } })).id;
  serviceId = (await prisma.barberService.create({ data: { barbershopId: shopId, name: "Corte", durationMin: 30, price: new Prisma.Decimal(180) } })).id;
  for (const b of [uno, dos]) {
    await prisma.barberSchedule.create({ data: { barbershopId: shopId, barberId: b, dayOfWeek: 1, startMinute: 600, endMinute: 1200 } });
  }

  owner = await makeUser("OWNER", "duena");
  manager = await makeUser("MANAGER", "encargado");
  reception = await makeUser("RECEPTION", "recepcion");
  barberoUno = await makeUser("BARBER", "barbero-uno", uno);
  barberoSuelto = await makeUser("BARBER", "barbero-suelto");
  barberoConPermisos = await makeUser("BARBER", "barbero-amplio", uno, ["agenda.view", "agenda.edit", "clients.view", "clients.edit", "walkin.manage"]);

  cMio = await cliente("Mío Pérez", "5511110001");
  cAtendidoPorTicket = await cliente("Ticket Ruiz", "5511110002");
  cAjeno = await cliente("Ajeno López", "5511110003");
  cCancelado = await cliente("Cancelado Díaz", "5511110004");
  cNadie = await cliente("Nadie Soto", "5511110005");

  citaUno = await cita(uno, cMio, "Mío Pérez", "5511110001");
  citaDos = await cita(dos, cAjeno, "Ajeno López", "5511110003");
  await cita(uno, cCancelado, "Cancelado Díaz", "5511110004", "CANCELLED");
  await prisma.barberSale.create({
    data: { barbershopId: shopId, soldByUserId: owner.barberUserId, barberId: uno, clientId: cAtendidoPorTicket },
  });
});

after(async () => {
  M._load = originalLoad;
  if (!HAS_DB) return;
  await prisma.barberSale.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberAppointmentService.deleteMany({ where: { appointment: { barbershopId: shopId } } });
  await prisma.barberAppointment.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberUser.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barbershop.deleteMany({ where: { id: shopId } });
  await prisma.$disconnect();
});

const today = () => new Date().toISOString().slice(0, 10);

async function agenda(who: BarberContext) {
  session = who;
  // Una semana desde hoy: cubre todas las visitas sembradas.
  const res = await agendaRoute.GET(new Request(`http://localhost/api/barber/appointments?date=${today()}&days=7`));
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) };
}

/* ═══════════════ Agenda ═══════════════ */

test("Dueño, Encargado y Recepción ven la agenda completa, como antes", { skip }, async () => {
  for (const who of [owner, manager, reception]) {
    const r = await agenda(who);
    assert.equal(r.status, 200, who.role);
    assert.deepEqual(r.json.barbers.map((b: { id: string }) => b.id).sort(), [uno, dos].sort(), who.role);
    const ids = r.json.appointments.map((a: { id: string }) => a.id);
    assert.ok(ids.includes(citaUno) && ids.includes(citaDos), who.role);
    assert.equal(r.json.schedules.length, 2, who.role);
  }
});

test("🔴 el Barbero recibe SOLO su columna y sus visitas: de lo ajeno no viaja nada", { skip }, async () => {
  const r = await agenda(barberoUno);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.barbers.map((b: { id: string }) => b.id), [uno]);
  assert.ok(r.json.appointments.length >= 1);
  for (const a of r.json.appointments) assert.equal(a.barberId, uno);
  assert.ok(r.json.schedules.every((s: { barberId: string }) => s.barberId === uno));
  // Ni el nombre, ni el teléfono, ni el id de la visita del otro barbero.
  assert.ok(!r.text.includes("Ajeno López"));
  assert.ok(!r.text.includes("5511110003"));
  assert.ok(!r.text.includes(citaDos));
  assert.ok(!r.text.includes(dos), "ni siquiera la columna del otro barbero");

  // El detalle de una visita ajena «no existe»; la suya sí abre.
  session = barberoUno;
  const ajena = await detailRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ id: citaDos }) });
  assert.equal(ajena.status, 404);
  const suya = await detailRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ id: citaUno }) });
  assert.equal(suya.status, 200);

  // Horarios: también solo los suyos.
  const h = await schedulesRoute.GET(new Request("http://localhost/api/barber/schedules"));
  const hj = await h.json();
  assert.deepEqual(hj.barbers.map((b: { id: string }) => b.id), [uno]);
  assert.ok(hj.schedules.every((s: { barberId: string }) => s.barberId === uno));
});

test("el Barbero sin ficha ligada no ve la agenda de nadie y se le dice por qué", { skip }, async () => {
  const r = await agenda(barberoSuelto);
  assert.equal(r.status, 403);
  assert.equal(r.json.code, "BARBER_NOT_LINKED");
  assert.match(r.json.error, /Pídele al dueño que lo ligue/);
  assert.ok(!r.text.includes("Mío Pérez") && !r.text.includes("Ajeno López"));
  session = barberoSuelto;
  const h = await schedulesRoute.GET(new Request("http://localhost/api/barber/schedules"));
  assert.equal(h.status, 403);
});

test("un Barbero con agenda.edit por permiso personal ve la agenda entera (se respeta)", { skip }, async () => {
  const r = await agenda(barberoConPermisos);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.barbers.map((b: { id: string }) => b.id).sort(), [uno, dos].sort());
});

test("la fila virtual sigue siendo de todos: el Barbero la sigue viendo", { skip }, async () => {
  session = barberoUno;
  const res = await walkinsRoute.GET(new Request("http://localhost/api/barber/walkins"));
  assert.equal(res.status, 200);
});

/* ═══════════════ Clientes ═══════════════ */

const nombres = (items: Array<{ name: string }>) => items.map((c) => c.name).sort();

test("Dueño, Encargado y Recepción ven a todos los clientes, como antes", { skip }, async () => {
  for (const who of [owner, manager, reception]) {
    const list = await clients.listBarberClients(who, { filter: "all", page: 1 });
    assert.deepEqual(nombres(list.items), [...ALL_NAMES].sort(), who.role);
    assert.ok(await clients.barberCanSeeClient(who, cAjeno), who.role);
    assert.ok(await loyalty.getBarberClientDetail(who, cAjeno), who.role);
  }
});

test("🔴 el Barbero ve SOLO a los clientes que atendió o tiene agendados", { skip }, async () => {
  const list = await clients.listBarberClients(barberoUno, { filter: "all", page: 1 });
  assert.deepEqual(nombres(list.items), ["Mío Pérez", "Ticket Ruiz"]);
  assert.equal(list.total, 2);

  // Buscar a un cliente ajeno, por nombre o por teléfono: nada.
  assert.equal((await clients.listBarberClients(barberoUno, { search: "Ajeno" })).items.length, 0);
  assert.equal((await clients.listBarberClients(barberoUno, { search: "5511110003" })).items.length, 0);
  // «No han vuelto»: tampoco salen los ajenos.
  const outreach = await clients.listBarberOutreach(barberoUno, { kind: "inactive" });
  assert.ok(outreach.targets.every((t) => [cMio, cAtendidoPorTicket].includes(t.clientId)));
  // Búsqueda por teléfono (la usa la agenda): el ajeno «no existe».
  assert.equal((await clients.lookupBarberClientByPhone(barberoUno, "5511110003")).client, null);
  assert.equal((await clients.lookupBarberClientByPhone(barberoUno, "5511110001")).client?.id, cMio);

  // Ficha, lealtad, historial y fotos de un ajeno: nada.
  assert.equal(await clients.barberCanSeeClient(barberoUno, cAjeno), false);
  assert.equal(await clients.barberCanSeeClient(barberoUno, cCancelado), false, "una visita cancelada no lo hace suyo");
  assert.equal(await clients.barberCanSeeClient(barberoUno, cNadie), false);
  assert.equal(await loyalty.getBarberClientDetail(barberoUno, cAjeno), null);
  assert.equal(await loyalty.syncBarberClientLoyalty(barberoUno, cAjeno), null);
  assert.deepEqual((await loyalty.getBarberVisitHistory(barberoUno, cAjeno)).entries, []);
  assert.deepEqual(await clients.listBarberClientPhotos(barberoUno, cAjeno), []);
  // Los suyos sí abren.
  assert.equal((await loyalty.getBarberClientDetail(barberoUno, cMio))?.client.id, cMio);
  assert.ok(await clients.barberCanSeeClient(barberoUno, cAtendidoPorTicket));
});

test("🔴 las APIs de clientes y el autocompletar de la agenda tampoco le dan ajenos", { skip }, async () => {
  session = barberoUno;
  const lista = await clientsRoute.GET(new Request("http://localhost/api/barber/clients"));
  const texto = await lista.text();
  assert.equal(lista.status, 200);
  for (const ajeno of ["Ajeno López", "Nadie Soto", "Cancelado Díaz", "5511110003"]) {
    assert.ok(!texto.includes(ajeno), ajeno);
  }
  const ficha = await clientRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ id: cAjeno }) });
  assert.equal(ficha.status, 404);
  const suya = await clientRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ id: cMio }) });
  assert.equal(suya.status, 200);

  const picker = await pickerRoute.GET(new Request("http://localhost/api/barber/appointments/clients?q=ez"));
  const pj = await picker.json();
  assert.deepEqual(pj.clients.map((c: { name: string }) => c.name), ["Mío Pérez"], "«López» y «Pérez» llevan «ez»: solo el suyo");

  session = reception;
  const pr = await (await pickerRoute.GET(new Request("http://localhost/api/barber/appointments/clients?q=ez"))).json();
  assert.deepEqual(pr.clients.map((c: { name: string }) => c.name).sort(), ["Ajeno López", "Mío Pérez"]);
});

test("autocompletar de la caja: un Barbero con caja por permiso personal solo ve a los suyos", { skip }, async () => {
  const conCaja = { ...barberoUno, user: { ...barberoUno.user, permissionsOverride: ["agenda.view", "clients.view", "cash.view", "cash.manage"] } };
  const vistos = (await cash.lookupClients(conCaja, "ez")).map((c) => c.name);
  assert.deepEqual(vistos, ["Mío Pérez"]);
  const deRecepcion = (await cash.lookupClients(reception, "ez")).map((c) => c.name).sort();
  assert.deepEqual(deRecepcion, ["Ajeno López", "Mío Pérez"]);
});

test("el Barbero sin ficha ligada no ve clientes de nadie", { skip }, async () => {
  const list = await clients.listBarberClients(barberoSuelto, { filter: "all", page: 1 });
  assert.equal(list.total, 0);
  assert.equal(await clients.barberCanSeeClient(barberoSuelto, cMio), false);
  session = barberoSuelto;
  const pj = await (await pickerRoute.GET(new Request("http://localhost/api/barber/appointments/clients?q=ez"))).json();
  assert.deepEqual(pj.clients, []);
});

test("un Barbero con clients.edit por permiso personal ve a todos los clientes (se respeta)", { skip }, async () => {
  const list = await clients.listBarberClients(barberoConPermisos, { filter: "all", page: 1 });
  assert.deepEqual(nombres(list.items), [...ALL_NAMES].sort());
});
