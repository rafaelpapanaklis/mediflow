// SUCURSALES DE VERDAD (decisión #11 de Rafael, 15-nov-2026; hallazgo G3 de
// REPORTE-ws6-t2): «el plan Profesional tiene sedes ilimitadas» → el dueño
// opera TODAS sus sedes desde su cuenta.
//
// Antes, getBarberContext devolvía SIEMPRE la sede propia: al cambiar de
// sede, Agenda, Caja, Servicios, Clientes, Productos, Fila, Horarios, Mi web
// y Configuración seguían enseñando la matriz. Ahora el contexto nace con la
// sede elegida (cookie dcb_branch) SI la sesión tiene acceso a ella.
//
// Aquí corre el getBarberContext REAL (con Supabase y la cookie simulados) y
// las rutas de verdad contra Postgres local, para cada rol:
//   · dueño de cadena      → entra a la sucursal; plan y cobro, de la matriz.
//   · encargado de una sede → no puede entrar a otra, ni con la cookie a mano.
//   · usuario con dos sedes → entra a la suya y a la que le dieron; a la tercera no.
//   · Barbero con dos sedes → en la ajena no tiene «lo suyo»: no ve nada.
//   · cookie de otra cadena → se ignora.
//   · «Toda la cadena»      → la sesión opera su sede propia.
//
//   DATABASE_URL=postgresql://…local… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/sede-activa-integration.test.ts
//
// La primera parte es pura; la integración se SALTA sin base local.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import Module from "node:module";
import { Prisma } from "@prisma/client";
import { BASE_LOCAL as HAS_DB, skip } from "./_base-local";
import { BARBER_BRANCH_ALL, BARBER_BRANCH_COOKIE, isConsolidatedPath } from "../branch-cookie";

// ═══════════════════════════════════════════════════════════════════════
// Dobles: la sesión de Supabase y la cookie del selector
// ═══════════════════════════════════════════════════════════════════════

let sesion: string | null = null; // supabaseId "logueado"
let cookieSede: string | null = null; // valor de dcb_branch

const SRC = path.resolve(__dirname, "../../..");
const dobles = new Map<string, unknown>([
  [
    path.join(SRC, "lib/supabase/server.ts"),
    {
      __esModule: true,
      createClient: async () => ({
        auth: {
          getUser: async () => ({
            data: { user: sesion ? { id: sesion, app_metadata: {}, last_sign_in_at: null } : null },
          }),
        },
      }),
    },
  ],
]);
const headersDoble = {
  __esModule: true,
  cookies: async () => ({
    get: (name: string) => (name === BARBER_BRANCH_COOKIE && cookieSede ? { name, value: cookieSede } : undefined),
  }),
  headers: async () => new Headers(),
};

const M = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (request: string, parent: unknown) => string;
};
const cargaOriginal = M._load;
M._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only" || request === "client-only") return {};
  if (request === "next/headers") return headersDoble;
  try {
    const r = M._resolveFilename(request, parent);
    if (dobles.has(r)) return dobles.get(r);
  } catch {
    /* que lo resuelva el cargador original */
  }
  return cargaOriginal.call(this, request, parent, isMain);
};

// ═══════════════════════════════════════════════════════════════════════
// 0. Puro
// ═══════════════════════════════════════════════════════════════════════

test("pickActiveBranchId: la cookie solo elige dentro de lo accesible", async () => {
  const { pickActiveBranchId } = await import("@/lib/barber-auth");
  const accessible = ["m", "s1"];
  assert.equal(pickActiveBranchId({ homeId: "m", requested: null, accessible }), "m");
  assert.equal(pickActiveBranchId({ homeId: "m", requested: "s1", accessible }), "s1");
  assert.equal(pickActiveBranchId({ homeId: "m", requested: "ajena", accessible }), "m", "cookie a mano");
  assert.equal(pickActiveBranchId({ homeId: "m", requested: BARBER_BRANCH_ALL, accessible }), "m", "toda la cadena");
  assert.equal(pickActiveBranchId({ homeId: "s1", requested: "m", accessible: ["s1"] }), "s1");
});

test("«Toda la cadena» solo en las pantallas que ya consolidaban", () => {
  for (const p of ["/barber/inicio", "/barber/reportes", "/barber/barberos", "/barber/equipo"]) {
    assert.equal(isConsolidatedPath(p), true, p);
  }
  for (const p of ["/barber/agenda", "/barber/caja", "/barber/clientes", "/barber/productos", "/barber/inicios", null]) {
    assert.equal(isConsolidatedPath(p), false, String(p));
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Integración
// ═══════════════════════════════════════════════════════════════════════

const RUN = `sede${Date.now().toString(36)}`;

let prisma: typeof import("@/lib/prisma")["prisma"];
let auth: typeof import("@/lib/barber-auth");
let paid: typeof import("@/lib/barber/paid-access");
let gating: typeof import("@/lib/barber/gating");
let servicesRoute: typeof import("@/app/api/barber/services/route");
let clientsRoute: typeof import("@/app/api/barber/clients/route");
let productsRoute: typeof import("@/app/api/barber/products/route");
let cashRoute: typeof import("@/app/api/barber/cash-sessions/current/route");
let agendaRoute: typeof import("@/app/api/barber/appointments/route");

let matriz: string;
let sucursal: string;
let tercera: string;
let ajena: string;
let barberoMatriz: string;
const sb: Record<string, string> = {};

async function persona(tag: string, shopId: string, role: "OWNER" | "MANAGER" | "RECEPTION" | "BARBER", barberId: string | null = null) {
  const supabaseId = `${RUN}-${tag}`;
  const u = await prisma.barberUser.create({
    data: { barbershopId: shopId, supabaseId, email: `${supabaseId}@test.local`, firstName: tag, lastName: "Prueba", role, barberId },
  });
  sb[tag] = supabaseId;
  return u.id;
}

async function sembrarSede(shopId: string, etiqueta: string, ownerUserId: string) {
  await prisma.barberService.create({ data: { barbershopId: shopId, name: `Corte ${etiqueta}`, durationMin: 30, price: new Prisma.Decimal(150) } });
  await prisma.barberClient.create({ data: { barbershopId: shopId, name: `Cliente ${etiqueta}`, phone: `55${Math.floor(Math.random() * 1e8)}` } });
  await prisma.barberProduct.create({ data: { barbershopId: shopId, name: `Cera ${etiqueta}`, price: new Prisma.Decimal(120), stock: 5 } });
  await prisma.barberCashSession.create({ data: { barbershopId: shopId, openedByUserId: ownerUserId, openingAmount: new Prisma.Decimal(etiqueta === "Matriz" ? 500 : 77) } });
}

before(async () => {
  if (!HAS_DB) return;
  ({ prisma } = await import("@/lib/prisma"));
  auth = await import("@/lib/barber-auth");
  paid = await import("@/lib/barber/paid-access");
  gating = await import("@/lib/barber/gating");
  servicesRoute = await import("@/app/api/barber/services/route");
  clientsRoute = await import("@/app/api/barber/clients/route");
  productsRoute = await import("@/app/api/barber/products/route");
  cashRoute = await import("@/app/api/barber/cash-sessions/current/route");
  agendaRoute = await import("@/app/api/barber/appointments/route");

  // La matriz paga Profesional; la sucursal trae una copia VIEJA del plan
  // (Básico, sin productos ni membresías) y un estado impago: si algo leyera
  // el plan de la sucursal en vez del de la matriz, se notaría.
  matriz = (await prisma.barbershop.create({
    data: { name: "Cadena Prueba", branchName: "Matriz", slug: `${RUN}-m`, plan: "PROFESIONAL", subscriptionStatus: "active" },
  })).id;
  sucursal = (await prisma.barbershop.create({
    data: { name: "Cadena Prueba", branchName: "Norte", slug: `${RUN}-n`, plan: "BASICO", subscriptionStatus: "pending_payment", parentId: matriz, isMainBranch: false },
  })).id;
  tercera = (await prisma.barbershop.create({
    data: { name: "Cadena Prueba", branchName: "Sur", slug: `${RUN}-s`, plan: "PROFESIONAL", subscriptionStatus: "active", parentId: matriz, isMainBranch: false, isActive: false },
  })).id;
  ajena = (await prisma.barbershop.create({
    data: { name: "Otra Cadena", slug: `${RUN}-x`, plan: "PROFESIONAL", subscriptionStatus: "active" },
  })).id;

  barberoMatriz = (await prisma.barber.create({ data: { barbershopId: matriz, name: "Beto Matriz", commissionType: "COMMISSION", commissionPct: new Prisma.Decimal(50) } })).id;

  const duenoId = await persona("dueno", matriz, "OWNER");
  await persona("encargado-norte", sucursal, "MANAGER");
  // Un «dueño» dado de alta en la sucursal (socio o franquiciatario).
  await persona("dueno-norte", sucursal, "OWNER");
  const dosSedes = await persona("recepcion-dos-sedes", matriz, "RECEPTION");
  await prisma.barberUserBranchAccess.create({ data: { userId: dosSedes, barbershopId: sucursal } });
  // Una fila de acceso que apunta a OTRA cadena: se ignora.
  await prisma.barberUserBranchAccess.create({ data: { userId: dosSedes, barbershopId: ajena } });
  const barbero = await persona("barbero-dos-sedes", matriz, "BARBER", barberoMatriz);
  await prisma.barberUserBranchAccess.create({ data: { userId: barbero, barbershopId: sucursal } });
  const encargadoSur = await persona("encargado-sur", tercera, "MANAGER");
  void encargadoSur;

  await sembrarSede(matriz, "Matriz", duenoId);
  await sembrarSede(sucursal, "Norte", duenoId);
  await sembrarSede(ajena, "Ajena", duenoId);
});

after(async () => {
  M._load = cargaOriginal;
  if (!HAS_DB) return;
  const ids = [matriz, sucursal, tercera, ajena];
  await prisma.barberCashSession.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberProduct.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberClient.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberService.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberUserBranchAccess.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberUser.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barber.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barbershop.deleteMany({ where: { id: { in: [sucursal, tercera] } } });
  await prisma.barbershop.deleteMany({ where: { id: { in: [matriz, ajena] } } });
  await prisma.$disconnect();
});

async function como(tag: string, cookie: string | null) {
  sesion = sb[tag];
  cookieSede = cookie;
  const ctx = await auth.getBarberContext();
  assert.ok(ctx, `sin contexto para ${tag}`);
  return ctx!;
}

async function texto(res: Response) {
  return { status: res.status, text: await res.text() };
}

/* ═══════════════ Dueño de cadena ═══════════════ */

test("dueño: sin cookie opera la matriz; con la sucursal elegida, el contexto ES la sucursal", { skip }, async () => {
  const enMatriz = await como("dueno", null);
  assert.equal(enMatriz.barbershopId, matriz);
  assert.equal(enMatriz.homeBarbershopId, matriz);

  const enNorte = await como("dueno", sucursal);
  assert.equal(enNorte.barbershopId, sucursal);
  assert.equal(enNorte.barbershop.id, sucursal);
  assert.equal(enNorte.homeBarbershopId, matriz, "la sede propia no cambia");
  assert.equal(enNorte.role, "OWNER");
});

test("🔴 dueño en la sucursal: TODAS las APIs operan la sucursal (servicios, clientes, productos, caja, agenda)", { skip }, async () => {
  await como("dueno", sucursal);
  const servicios = await texto(await servicesRoute.GET());
  assert.equal(servicios.status, 200, servicios.text);
  assert.ok(servicios.text.includes("Corte Norte") && !servicios.text.includes("Corte Matriz"), servicios.text);

  const clientes = await texto(await clientsRoute.GET(new Request("http://localhost/api/barber/clients") as never));
  assert.equal(clientes.status, 200, clientes.text);
  assert.ok(clientes.text.includes("Cliente Norte") && !clientes.text.includes("Cliente Matriz"), clientes.text);

  const { NextRequest } = await import("next/server");
  const productos = await texto(await productsRoute.GET(new NextRequest("http://localhost/api/barber/products")));
  assert.equal(productos.status, 200, `productos: el plan es el de la MATRIZ (Profesional), no la copia Básico de la sucursal — ${productos.text}`);
  assert.ok(productos.text.includes("Cera Norte") && !productos.text.includes("Cera Matriz"), productos.text);

  const caja = await texto(await cashRoute.GET());
  assert.equal(caja.status, 200, caja.text);
  assert.ok(caja.text.includes('"openingAmount":77') || caja.text.includes('"openingAmount":"77'), `la caja abierta es la de la sucursal: ${caja.text}`);

  const today = new Date().toISOString().slice(0, 10);
  const agenda = await texto(await agendaRoute.GET(new Request(`http://localhost/api/barber/appointments?date=${today}&days=1`)));
  assert.equal(agenda.status, 200, agenda.text);
  assert.ok(!agenda.text.includes("Beto Matriz"), "la agenda de la sucursal no trae barberos de la matriz");
});

test("dueño de vuelta en la matriz: las mismas APIs enseñan la matriz", { skip }, async () => {
  await como("dueno", matriz);
  const servicios = await texto(await servicesRoute.GET());
  assert.ok(servicios.text.includes("Corte Matriz") && !servicios.text.includes("Corte Norte"));
  const caja = await texto(await cashRoute.GET());
  assert.ok(caja.text.includes('"openingAmount":500') || caja.text.includes('"openingAmount":"500'), caja.text);
});

test("plan y cobro: en la sucursal el contexto lleva el plan y el estado de la MATRIZ", { skip }, async () => {
  const ctx = await como("dueno", sucursal);
  assert.equal(ctx.barbershop.plan, "PROFESIONAL");
  assert.equal(ctx.barbershop.subscriptionStatus, "active");
  assert.equal(await paid.hasBarberPaidAccess(ctx), true);
  const gate = await gating.getBarberGate(ctx);
  assert.equal(gate.rootBarbershopId, matriz, "quien paga es la matriz");
  // Límite de sedes: cuenta la cadena entera, no la sede elegida.
  assert.equal(gate.limits.branches.used, 2, "matriz + Norte activas (Sur está cerrada)");
});

test("🔴 el candado de pago mira a la matriz: matriz impaga → la sucursal tampoco entra", { skip }, async () => {
  await prisma.barbershop.update({ where: { id: matriz }, data: { subscriptionStatus: "pending_payment" } });
  await prisma.barbershop.update({ where: { id: sucursal }, data: { subscriptionStatus: "active" } });
  try {
    const ctx = await como("dueno", sucursal);
    assert.equal(ctx.barbershop.subscriptionStatus, "pending_payment");
    assert.equal(await paid.hasBarberPaidAccess(ctx), false);
    // El gate común de features (gating.ts) exige suscripción al día: con la
    // matriz impaga, la sucursal tampoco pasa aunque su fila diga «active».
    await assert.rejects(gating.assertBarberFeature(ctx, "walkinQueue"), (e: Error & { code?: string }) => e.code === "SUBSCRIPTION_INACTIVE");
  } finally {
    await prisma.barbershop.update({ where: { id: matriz }, data: { subscriptionStatus: "active" } });
    await prisma.barbershop.update({ where: { id: sucursal }, data: { subscriptionStatus: "pending_payment" } });
  }
});

test("🔴 RONDA 2 · M1: una sucursal CERRADA no se opera, ni siquiera el dueño (se queda en su sede)", { skip }, async () => {
  const ctx = await como("dueno", tercera);
  assert.equal(ctx.barbershopId, matriz, "la cerrada no se adopta como sede activa");
  assert.equal(await paid.hasBarberPaidAccess(ctx), true, "y no queda encerrado en Suscripción");
  // Tampoco por la puerta de Equipo: dar de alta un barbero en la cerrada.
  const team = await import("@/lib/barber/team");
  await assert.rejects(
    team.createBarberProfile(ctx, { name: "Intruso", barbershopId: tercera, commissionType: "COMMISSION", commissionPct: 50 }),
    (e: Error & { status?: number }) => e.status === 409 && /cerrada/.test(e.message),
  );
  assert.equal(await prisma.barber.count({ where: { barbershopId: tercera } }), 0);
  // Recepción con acceso a la cerrada tampoco la opera.
  const recepId = (await prisma.barberUser.findFirstOrThrow({ where: { supabaseId: sb["recepcion-dos-sedes"] } })).id;
  const grant = await prisma.barberUserBranchAccess.create({ data: { userId: recepId, barbershopId: tercera } });
  try {
    assert.equal((await como("recepcion-dos-sedes", tercera)).barbershopId, matriz);
  } finally {
    await prisma.barberUserBranchAccess.delete({ where: { id: grant.id } });
  }
});

test("🔴 cookie de OTRA cadena puesta a mano: se ignora, el dueño sigue en su matriz", { skip }, async () => {
  const ctx = await como("dueno", ajena);
  assert.equal(ctx.barbershopId, matriz);
  const servicios = await texto(await servicesRoute.GET());
  assert.ok(!servicios.text.includes("Corte Ajena"));
});

test("«Toda la cadena» en la cookie: las pantallas de una sede operan la sede propia", { skip }, async () => {
  const ctx = await como("dueno", BARBER_BRANCH_ALL);
  assert.equal(ctx.barbershopId, matriz);
});

/* ═══════════════ Encargado de una sede ═══════════════ */

test("🔴 encargado de la sucursal: no entra a la matriz ni poniendo la cookie a mano", { skip }, async () => {
  const ctx = await como("encargado-norte", matriz);
  assert.equal(ctx.barbershopId, sucursal);
  assert.deepEqual(await auth.getAccessibleBranchIds(ctx), [sucursal]);
  const servicios = await texto(await servicesRoute.GET());
  assert.ok(servicios.text.includes("Corte Norte") && !servicios.text.includes("Corte Matriz"));
  // Plan de la matriz también para él (su fila trae la copia Básico).
  assert.equal(ctx.barbershop.plan, "PROFESIONAL");
});

test("encargado de una sucursal CERRADA: sigue sin poder trabajar (su sede está cerrada)", { skip }, async () => {
  const ctx = await como("encargado-sur", null);
  assert.equal(ctx.barbershopId, tercera);
  assert.equal(await paid.hasBarberPaidAccess(ctx), false);
});

/* ═══════════════ Dueño de una sucursal (ronda 2, M2) ═══════════════ */

test("🔴 RONDA 2 · M2: un DUEÑO cuya sede es una sucursal no opera la matriz ni las demás", { skip }, async () => {
  const ctx = await como("dueno-norte", matriz);
  assert.equal(ctx.barbershopId, sucursal, "la cookie de la matriz no lo saca de su sede");
  assert.deepEqual(await auth.getAccessibleBranchIds(ctx), [sucursal]);
  const servicios = await texto(await servicesRoute.GET());
  assert.ok(servicios.text.includes("Corte Norte") && !servicios.text.includes("Corte Matriz"), servicios.text);
  // Con un acceso concedido, sí (como cualquier otro rol).
  const id = (await prisma.barberUser.findFirstOrThrow({ where: { supabaseId: sb["dueno-norte"] } })).id;
  const grant = await prisma.barberUserBranchAccess.create({ data: { userId: id, barbershopId: matriz } });
  try {
    assert.equal((await como("dueno-norte", matriz)).barbershopId, matriz);
  } finally {
    await prisma.barberUserBranchAccess.delete({ where: { id: grant.id } });
  }
  // El dueño de la matriz sigue alcanzando toda la cadena.
  assert.deepEqual(await auth.getAccessibleBranchIds(await como("dueno", null)), [matriz, sucursal, tercera]);
});

/* ═══════════════ Usuario con acceso a dos sedes ═══════════════ */

test("recepción con acceso a dos sedes: opera las dos; la tercera y la ajena, no", { skip }, async () => {
  const enNorte = await como("recepcion-dos-sedes", sucursal);
  assert.equal(enNorte.barbershopId, sucursal);
  assert.equal(enNorte.role, "RECEPTION");
  assert.deepEqual(await auth.getAccessibleBranchIds(enNorte), [matriz, sucursal], "el acceso no crece al cambiar de sede");
  const servicios = await texto(await servicesRoute.GET());
  assert.notEqual(servicios.status, 200, "Recepción sigue sin administrar servicios aunque cambie de sede");
  const clientes = await texto(await clientsRoute.GET(new Request("http://localhost/api/barber/clients") as never));
  assert.ok(clientes.text.includes("Cliente Norte") && !clientes.text.includes("Cliente Matriz"), clientes.text);

  assert.equal((await como("recepcion-dos-sedes", tercera)).barbershopId, matriz, "sin acceso a Sur");
  assert.equal((await como("recepcion-dos-sedes", ajena)).barbershopId, matriz, "la fila de acceso a otra cadena no cuenta");
});

/* ═══════════════ Barbero ═══════════════ */

test("🔴 Barbero con acceso a dos sedes: en la ajena no tiene ficha → no ve la agenda ni los clientes de nadie", { skip }, async () => {
  const enMatriz = await como("barbero-dos-sedes", null);
  assert.equal(enMatriz.barber?.id, barberoMatriz);

  const enNorte = await como("barbero-dos-sedes", sucursal);
  assert.equal(enNorte.barbershopId, sucursal);
  assert.equal(enNorte.role, "BARBER");
  assert.equal(enNorte.barber, null, "su ficha es de la matriz");
  const clientes = await texto(await clientsRoute.GET(new Request("http://localhost/api/barber/clients") as never));
  assert.ok(!clientes.text.includes("Cliente Norte") && !clientes.text.includes("Cliente Matriz"), clientes.text);
});
