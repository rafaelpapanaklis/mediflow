// RECEPCIÓN VENDE (decisión #13 de Rafael, 15-nov-2026): «que la Recepción
// sí pueda vender membresías, productos, etc.».
//
// El rol Recepción ahora: vende y renueva membresías, registra y devuelve
// anticipos, vende productos en Caja en el mismo ticket que un servicio, ve
// las existencias y aplica el premio de lealtad al cobrar. NO: crea o edita
// planes de membresía (ni sus precios), pausa o cancela lo vendido, da de
// alta o edita productos, ve su costo, ni toca comisiones, configuración,
// equipo o suscripción.
//
// El permiso de membresías se partió en «vender» (memberships.sell) y
// «administrar» (memberships.manage); el de productos en «ver»
// (products.view) y «administrar» (products.manage). Administrar INCLUYE
// vender/ver: nadie que ya administraba pierde nada, y una persona con un
// permiso por persona que traía «administrar» sigue vendiendo.
//
// Corre el getBarberContext REAL (Supabase simulado) y las rutas de verdad
// contra Postgres local:
//   DATABASE_URL=postgresql://…local… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/recepcion-vende-integration.test.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import Module from "node:module";
import { Prisma } from "@prisma/client";
import { BASE_LOCAL as HAS_DB, skip } from "./_base-local";
import {
  BARBER_ROLE_DEFAULT_PERMISSIONS,
  hasBarberPermission,
  resolveBarberPermissions,
} from "../permissions";
import { BARBER_NAV_ITEMS } from "../types";

// ═══════════════════════════════════════════════════════════════════════
// 0. La regla, pura
// ═══════════════════════════════════════════════════════════════════════

test("Recepción vende y ve existencias; no administra nada", () => {
  const r = resolveBarberPermissions("RECEPTION", []);
  for (const k of ["memberships.sell", "products.view", "cash.view", "cash.manage"] as const) {
    assert.ok(r.has(k), `Recepción debería tener ${k}`);
  }
  for (const k of [
    "memberships.manage",
    "products.manage",
    "inventory.manage",
    "services.manage",
    "commissions.manage",
    "settings.edit",
    "team.manage",
    "billing.manage",
  ] as const) {
    assert.ok(!r.has(k), `Recepción NO debería tener ${k}`);
  }
});

test("dueño y encargado no pierden nada: siguen administrando y además venden", () => {
  for (const role of ["OWNER", "MANAGER"] as const) {
    const s = resolveBarberPermissions(role, []);
    for (const k of ["memberships.manage", "memberships.sell", "products.manage", "products.view"] as const) {
      assert.ok(s.has(k), `${role} ${k}`);
    }
  }
  assert.equal(BARBER_ROLE_DEFAULT_PERMISSIONS.BARBER.includes("memberships.sell"), false, "el Barbero no vende membresías");
});

test("permisos por persona: «administrar» guardado antes incluye vender; uno sin vender se respeta", () => {
  // Una ficha guardada ANTES de partir el permiso (traía memberships.manage).
  const legado = { role: "RECEPTION" as const, permissionsOverride: ["agenda.view", "cash.view", "cash.manage", "memberships.manage", "products.manage"] };
  assert.equal(hasBarberPermission(legado, "memberships.sell"), true);
  assert.equal(hasBarberPermission(legado, "products.view"), true);
  // A quien el dueño le recortó los permisos a mano no le llegan los nuevos.
  const recortada = { role: "RECEPTION" as const, permissionsOverride: ["agenda.view", "cash.view"] };
  assert.equal(hasBarberPermission(recortada, "memberships.sell"), false);
  assert.equal(hasBarberPermission(recortada, "products.view"), false);
  // Vender no da administrar.
  assert.equal(hasBarberPermission({ role: "BARBER", permissionsOverride: ["memberships.sell"] }, "memberships.manage"), false);
});

test("el menú de Recepción enseña Membresías y Productos (y no Servicios, Comisiones ni Barberos)", () => {
  const perms = resolveBarberPermissions("RECEPTION", []);
  const keys = BARBER_NAV_ITEMS.filter((i) => !i.permission || perms.has(i.permission as never)).map((i) => i.key);
  for (const k of ["membresias", "productos", "caja"]) assert.ok(keys.includes(k), k);
  for (const k of ["servicios", "comisiones", "barberos"]) assert.ok(!keys.includes(k), k);
  const productos = BARBER_NAV_ITEMS.find((i) => i.key === "productos");
  assert.equal(productos?.section, "negocio", "Productos vive en Negocio");
});

// ═══════════════════════════════════════════════════════════════════════
// Integración
// ═══════════════════════════════════════════════════════════════════════

let sesion: string | null = null;
const SRC = path.resolve(__dirname, "../../..");
const dobles = new Map<string, unknown>([
  [
    path.join(SRC, "lib/supabase/server.ts"),
    {
      __esModule: true,
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: sesion ? { id: sesion, app_metadata: {}, last_sign_in_at: null } : null } }) },
      }),
    },
  ],
]);
const M = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (request: string, parent: unknown) => string;
};
const cargaOriginal = M._load;
M._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only" || request === "client-only") return {};
  if (request === "next/headers") {
    return { __esModule: true, cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() };
  }
  try {
    const r = M._resolveFilename(request, parent);
    if (dobles.has(r)) return dobles.get(r);
  } catch {
    /* que lo resuelva el cargador original */
  }
  return cargaOriginal.call(this, request, parent, isMain);
};

const RUN = `recep${Date.now().toString(36)}`;
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

let prisma: typeof import("@/lib/prisma")["prisma"];
let plansRoute: typeof import("@/app/api/barber/memberships/plans/route");
let subsRoute: typeof import("@/app/api/barber/memberships/subscriptions/route");
let productsRoute: typeof import("@/app/api/barber/products/route");
let productRoute: typeof import("@/app/api/barber/products/[id]/route");
let statsRoute: typeof import("@/app/api/barber/products/stats/route");
let salesRoute: typeof import("@/app/api/barber/sales/route");
let depositsRoute: typeof import("@/app/api/barber/deposits/actions/route");
let openRoute: typeof import("@/app/api/barber/cash-sessions/open/route");
let NextRequestCls: typeof import("next/server").NextRequest;

let shopId: string;
let serviceId: string;
let productId: string;
let planId: string;
let clientId: string;
let loyalClientId: string;
const sb: Record<string, string> = {};

async function persona(tag: string, role: "OWNER" | "MANAGER" | "RECEPTION", permissionsOverride: string[] = []) {
  const supabaseId = `${RUN}-${tag}`;
  await prisma.barberUser.create({
    data: { barbershopId: shopId, supabaseId, email: `${supabaseId}@test.local`, firstName: tag, lastName: "Prueba", role, permissionsOverride },
  });
  sb[tag] = supabaseId;
}

const como = (tag: string) => {
  sesion = sb[tag];
};
const req = (url: string, method = "GET", body?: unknown) =>
  new NextRequestCls(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
async function call(res: Response | Promise<Response>) {
  const r = await res;
  const text = await r.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* no es JSON */
  }
  return { status: r.status, text, json };
}

before(async () => {
  if (!HAS_DB) return;
  ({ prisma } = await import("@/lib/prisma"));
  plansRoute = await import("@/app/api/barber/memberships/plans/route");
  subsRoute = await import("@/app/api/barber/memberships/subscriptions/route");
  productsRoute = await import("@/app/api/barber/products/route");
  productRoute = await import("@/app/api/barber/products/[id]/route");
  statsRoute = await import("@/app/api/barber/products/stats/route");
  salesRoute = await import("@/app/api/barber/sales/route");
  depositsRoute = await import("@/app/api/barber/deposits/actions/route");
  openRoute = await import("@/app/api/barber/cash-sessions/open/route");
  ({ NextRequest: NextRequestCls } = await import("next/server"));

  shopId = (await prisma.barbershop.create({
    data: {
      name: "Barbería Mostrador", slug: `${RUN}-a`, plan: "PROFESIONAL", subscriptionStatus: "active",
      timezone: "America/Mexico_City", loyaltyThreshold: 2, loyaltyReward: "Corte gratis",
    },
  })).id;
  serviceId = (await prisma.barberService.create({ data: { barbershopId: shopId, name: "Corte", durationMin: 30, price: new Prisma.Decimal(180) } })).id;
  productId = (await prisma.barberProduct.create({
    data: { barbershopId: shopId, name: "Cera mate", price: new Prisma.Decimal(120), cost: new Prisma.Decimal(50), stock: 5, minStock: 2 },
  })).id;
  planId = (await prisma.barberMembership.create({
    data: { barbershopId: shopId, name: "Mensual 4 cortes", price: new Prisma.Decimal(600), includedCuts: 4, periodDays: 30 },
  })).id;
  clientId = (await prisma.barberClient.create({ data: { barbershopId: shopId, name: "Cliente Membresía", phone: `553${Date.now().toString().slice(-7)}` } })).id;
  loyalClientId = (await prisma.barberClient.create({ data: { barbershopId: shopId, name: "Cliente Fiel", phone: `554${Date.now().toString().slice(-7)}` } })).id;
  // Dos visitas ya hechas: con umbral 2 tiene su premio.
  for (let i = 0; i < 2; i++) {
    const start = new Date(Date.now() - (20 + i) * DAY);
    await prisma.barberAppointment.create({
      data: { barbershopId: shopId, clientId: loyalClientId, status: "DONE", startAt: start, endAt: new Date(start.getTime() + 30 * MIN) },
    });
  }

  await persona("dueno", "OWNER");
  await persona("encargado", "MANAGER");
  await persona("recepcion", "RECEPTION");
  await persona("recepcion-recortada", "RECEPTION", ["agenda.view", "clients.view", "cash.view", "cash.manage"]);
  await persona("recepcion-legado", "RECEPTION", ["agenda.view", "clients.view", "cash.view", "cash.manage", "memberships.manage"]);

  como("recepcion");
  const opened = await call(openRoute.POST(req("/api/barber/cash-sessions/open", "POST", { openingAmount: 300 })));
  assert.ok(opened.status < 300, `abrir turno: ${opened.text}`);
});

after(async () => {
  M._load = cargaOriginal;
  if (!HAS_DB) return;
  await prisma.barberSaleItem.deleteMany({ where: { sale: { barbershopId: shopId } } });
  await prisma.barberClientMembership.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberSale.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberStockMovement.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberCashSession.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberAppointmentService.deleteMany({ where: { appointment: { barbershopId: shopId } } });
  await prisma.barberAppointment.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberProduct.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberMembership.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberClient.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberService.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barberUser.deleteMany({ where: { barbershopId: shopId } });
  await prisma.barbershop.deleteMany({ where: { id: shopId } });
  await prisma.$disconnect();
});

/* ═══════════════ Membresías ═══════════════ */

test("Recepción ve los planes, pero no los crea, edita, archiva ni borra", { skip }, async () => {
  como("recepcion");
  const lista = await call(plansRoute.GET(req("/api/barber/memberships/plans?all=1")));
  assert.equal(lista.status, 200, lista.text);
  assert.ok(lista.text.includes("Mensual 4 cortes"));
  assert.equal((await call(plansRoute.POST(req("/api/barber/memberships/plans", "POST", { name: "Pirata", price: 1, periodDays: 30 })))).status, 403);
  assert.equal((await call(plansRoute.PATCH(req("/api/barber/memberships/plans", "PATCH", { id: planId, price: 1 })))).status, 403);
  assert.equal((await call(plansRoute.PATCH(req("/api/barber/memberships/plans", "PATCH", { id: planId, isActive: false })))).status, 403);
  assert.equal((await call(plansRoute.DELETE(req(`/api/barber/memberships/plans?id=${planId}`, "DELETE")))).status, 403);
  const plan = await prisma.barberMembership.findUniqueOrThrow({ where: { id: planId } });
  assert.equal(Number(plan.price), 600);
  assert.equal(plan.isActive, true);
});

let vendida: string;

test("🔴 Recepción VENDE y RENUEVA una membresía (con su ticket en el corte)", { skip }, async () => {
  como("recepcion");
  const venta = await call(subsRoute.POST(req("/api/barber/memberships/subscriptions", "POST", { clientId, membershipId: planId, paymentMethod: "CASH" })));
  assert.equal(venta.status, 201, venta.text);
  vendida = (venta.json.membership as { id: string }).id;
  assert.ok(venta.json.saleId, "la venta deja su ticket");

  const renovar = await call(subsRoute.PATCH(req("/api/barber/memberships/subscriptions", "PATCH", { id: vendida, action: "renew", paymentMethod: "CASH" })));
  assert.equal(renovar.status, 200, renovar.text);

  const lista = await call(subsRoute.GET(req("/api/barber/memberships/subscriptions?filter=all")));
  assert.equal(lista.status, 200);
  assert.ok(lista.text.includes("Cliente Membresía"));
});

test("Recepción NO pausa ni cancela una membresía vendida; el encargado sí, como antes", { skip }, async () => {
  como("recepcion");
  for (const action of ["pause", "cancel"]) {
    const r = await call(subsRoute.PATCH(req("/api/barber/memberships/subscriptions", "PATCH", { id: vendida, action })));
    assert.equal(r.status, 403, `${action}: ${r.text}`);
  }
  assert.equal((await prisma.barberClientMembership.findUniqueOrThrow({ where: { id: vendida } })).status, "ACTIVE");

  como("encargado");
  const pausa = await call(subsRoute.PATCH(req("/api/barber/memberships/subscriptions", "PATCH", { id: vendida, action: "pause" })));
  assert.equal(pausa.status, 200, pausa.text);
  const reanuda = await call(subsRoute.PATCH(req("/api/barber/memberships/subscriptions", "PATCH", { id: vendida, action: "resume" })));
  assert.equal(reanuda.status, 200, reanuda.text);
  const nuevo = await call(plansRoute.POST(req("/api/barber/memberships/plans", "POST", { name: `Ocho cortes ${RUN}`, price: 900, periodDays: 30, includedCuts: 8 })));
  assert.ok(nuevo.status < 300, `el encargado sigue creando planes: ${nuevo.text}`);
});

test("permisos por persona: la recepción recortada a mano no vende; la que traía «administrar» sí", { skip }, async () => {
  como("recepcion-recortada");
  const r = await call(subsRoute.POST(req("/api/barber/memberships/subscriptions", "POST", { clientId, membershipId: planId, paymentMethod: "CASH" })));
  assert.equal(r.status, 403, r.text);

  como("recepcion-legado");
  const l = await call(plansRoute.GET(req("/api/barber/memberships/plans")));
  assert.equal(l.status, 200, l.text);
});

/* ═══════════════ Productos ═══════════════ */

test("Recepción ve productos y existencias SIN costo ni margen; no da de alta ni edita", { skip }, async () => {
  como("recepcion");
  const lista = await call(productsRoute.GET(req("/api/barber/products?includeInactive=1")));
  assert.equal(lista.status, 200, lista.text);
  const p = (lista.json.products as Array<Record<string, unknown>>).find((x) => x.id === productId)!;
  assert.equal(p.stock, 5);
  assert.equal(p.cost, null, "el costo no viaja a Recepción");
  assert.equal(p.marginAmount, null);
  assert.equal(p.marginPct, null);

  const stats = await call(statsRoute.GET(req("/api/barber/products/stats")));
  assert.equal(stats.status, 200, stats.text);
  assert.equal((stats.json.stats as Record<string, unknown> | undefined)?.stockValueCost ?? stats.json.stockValueCost, null);

  assert.equal((await call(productsRoute.POST(req("/api/barber/products", "POST", { name: "Aceite", price: 90 })))).status, 403);
  const editar = await call(productRoute.PATCH(req(`/api/barber/products/${productId}`, "PATCH", { price: 1 }), { params: Promise.resolve({ id: productId }) }));
  assert.equal(editar.status, 403, editar.text);
  assert.equal(Number((await prisma.barberProduct.findUniqueOrThrow({ where: { id: productId } })).price), 120);

  como("dueno");
  const delDueno = await call(productsRoute.GET(req("/api/barber/products")));
  const pd = (delDueno.json.products as Array<Record<string, unknown>>).find((x) => x.id === productId)!;
  assert.equal(pd.cost, 50, "el dueño sí ve el costo");
});

/* ═══════════════ Caja ═══════════════ */

test("🔴 Recepción cobra servicio + producto en el MISMO ticket y aplica el premio de lealtad", { skip }, async () => {
  como("recepcion");
  const venta = await call(
    salesRoute.POST(
      req("/api/barber/sales", "POST", {
        clientId: loyalClientId,
        items: [
          { kind: "service", id: serviceId },
          { kind: "product", id: productId, qty: 1 },
        ],
        paymentMethod: "CASH",
        redeemLoyaltyItemIndex: 0,
      }),
    ),
  );
  assert.equal(venta.status, 201, venta.text);
  const sale = (venta.json.sale ?? venta.json) as { total: number; items: Array<{ description: string }> };
  assert.equal(Number(sale.total), 120, "el corte va de premio ($0); solo se cobra la cera");
  assert.equal(sale.items.length, 2);
  assert.equal((await prisma.barberProduct.findUniqueOrThrow({ where: { id: productId } })).stock, 4, "la venta descuenta existencias");
});

/* ═══════════════ Anticipos ═══════════════ */

test("Recepción registra y devuelve un anticipo", { skip }, async () => {
  como("recepcion");
  const start = new Date(Date.now() + 3 * DAY);
  const cita = await prisma.barberAppointment.create({
    data: {
      barbershopId: shopId, clientId, clientName: "Cliente Membresía", clientPhone: "5530000000", status: "CONFIRMED",
      startAt: start, endAt: new Date(start.getTime() + 30 * MIN),
      services: { create: [{ serviceId, priceAtBooking: new Prisma.Decimal(180) }] },
    },
  });
  const pago = await call(depositsRoute.POST(req("/api/barber/deposits/actions", "POST", { appointmentId: cita.id, action: "mark-paid", amount: 100, paymentMethod: "CASH" })));
  assert.equal(pago.status, 200, pago.text);
  const devuelto = await call(depositsRoute.POST(req("/api/barber/deposits/actions", "POST", { appointmentId: cita.id, action: "refund" })));
  assert.equal(devuelto.status, 200, devuelto.text);
  const a = await prisma.barberAppointment.findUniqueOrThrow({ where: { id: cita.id } });
  assert.equal(a.depositStatus, "REFUNDED");
});
