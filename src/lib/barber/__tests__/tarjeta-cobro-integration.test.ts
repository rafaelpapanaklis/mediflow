// ═══════════════════════════════════════════════════════════════════════
// La tarjeta de estrellas llega sola por WhatsApp tras el cobro (ws6-t1,
// 16-nov, punto 2).
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/tarjeta-cobro-integration.test.ts
//
// REAL: Postgres local, la ruta de cobro (POST /api/barber/sales), la caja,
// las estrellas, la cola y el emisor de WhatsApp. SIMULADO: la sesión
// (getBarberContext) y Meta (fetch interceptado: NADA sale a la red, una
// llamada no prevista revienta la prueba). Solo contra una base LOCAL.
//
// Fija: con WhatsApp conectado sale sola (texto con la ventana abierta,
// plantilla fuera de ella); sin plantilla aprobada, sin WhatsApp, con el
// interruptor apagado o con el cliente dado de baja NO sale y Caja recibe el
// wa.me para mandarla a mano; una venta solo de productos no manda nada; un
// ticket manda UNA vez aunque se pida dos veces a la vez.
// ═══════════════════════════════════════════════════════════════════════
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import type { BarberContext } from "@/lib/barber-auth";
import { BarberForbiddenError, hasBarberPermission } from "@/lib/barber/permissions";
import { FALLBACK_BARBER_PLAN_CONFIG } from "@/lib/barber/plan-shared";
import { BASE_LOCAL as HAS_DB, skip } from "./_base-local";

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
    /* que lo resuelva el cargador original */
  }
  return originalLoad.call(this, request, parent, isMain);
};

// ── Meta simulado ──
interface GraphCall { url: string; body: any }
let graph: GraphCall[] = [];
/** null = Meta acepta; si no, la respuesta de error que da. */
let metaRechaza: { status: number; json: unknown } | null = null;
const realFetch = globalThis.fetch;
function instalarFetch() {
  globalThis.fetch = (async (url: unknown, init: { body?: unknown; method?: string } | undefined) => {
    const href = String(url);
    if (!href.includes("graph.facebook.com")) throw new Error(`fetch no previsto (nada sale a la red): ${href}`);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    graph.push({ url: href.split("?")[0], body });
    const res = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status, headers: { "content-type": "application/json" } });
    if (metaRechaza && href.endsWith("/messages")) return res(metaRechaza.json, metaRechaza.status);
    if (href.endsWith("/messages")) return res({ messages: [{ id: `wamid.${RUN}.${graph.length}` }] });
    return res({});
  }) as typeof fetch;
}
const mensajes = () => graph.filter((c) => c.url.endsWith("/messages"));

let prisma: typeof import("@/lib/prisma")["prisma"];
let cash: typeof import("@/lib/barber/cash");
let ruta: typeof import("@/app/api/barber/sales/route");
let lib: typeof import("@/lib/barber/tarjeta-cobro");

const RUN = `tc${Date.now().toString(36)}`;
let seq = 0;

interface Shop { id: string; slug: string; ctx: BarberContext; serviceId: string; productId: string }
let CON: Shop; // con WhatsApp conectado
let SIN: Shop; // sin WhatsApp

async function makeShop(tag: string, conectada: boolean): Promise<Shop> {
  const shop = await prisma.barbershop.create({
    data: {
      name: `Barbería ${tag}`, slug: `${RUN}-${tag.toLowerCase()}`, plan: "PROFESIONAL", subscriptionStatus: "active",
      timezone: "America/Mexico_City", loyaltyThreshold: 6,
      ...(conectada
        ? { whatsappSenderMode: "OWN_WABA" as never, phoneNumberId: `pn-${RUN}-${tag}`, wabaId: `waba-${RUN}-${tag}`, whatsappToken: `token-${tag}` }
        : {}),
    },
  });
  const user = await prisma.barberUser.create({
    data: { barbershopId: shop.id, supabaseId: `${RUN}-${tag}-o`, email: `${RUN}-${tag}@test.local`, firstName: "Dueña", lastName: tag, role: "OWNER" },
  });
  const service = await prisma.barberService.create({
    data: { barbershopId: shop.id, name: "Corte", durationMin: 30, price: new Prisma.Decimal(200) },
  });
  const product = await prisma.barberProduct.create({
    data: { barbershopId: shop.id, name: "Cera", price: new Prisma.Decimal(150), stock: 50 },
  });
  return {
    id: shop.id, slug: shop.slug, serviceId: service.id, productId: product.id,
    ctx: { barberUserId: user.id, barbershopId: shop.id, barbershop: shop, user, barber: null, role: "OWNER" },
  };
}

async function cliente(shop: Shop, extra: Record<string, unknown> = {}) {
  const phone = `55${String(30000000 + ((Date.now() + ++seq * 7919) % 69999999)).padStart(8, "0")}`;
  return prisma.barberClient.create({ data: { barbershopId: shop.id, name: `Luis ${RUN}`, phone, ...extra } });
}

async function cobrar(shop: Shop, clientId: string, items = [{ kind: "service", id: shop.serviceId, qty: 1 }]) {
  session = shop.ctx;
  const req = new NextRequest("https://panel.test/api/barber/sales", {
    method: "POST",
    body: JSON.stringify({ clientId, items, paymentMethod: "CASH" }),
    headers: { "content-type": "application/json", host: "panel.test" },
  });
  const res = await ruta.POST(req);
  const body = await res.json();
  assert.equal(res.status, 201, JSON.stringify(body));
  return body as { id: string; stars: any; starsCard: any };
}

const filasDe = (shop: Shop, saleId: string) =>
  prisma.barberMessage.findMany({ where: { barbershopId: shop.id, templateName: `auto:tarjeta:${saleId}` } });

async function aplicarSql() {
  const sql = fs.readFileSync(path.join(ROOT, "sql/barber_tarjeta_cobro.sql"), "utf8").replace(/^\s*--.*$/gm, "");
  for (const stmt of sql.split(/;\s*\n/).map((x) => x.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(stmt);
}
async function hayColumna(): Promise<boolean> {
  const r = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS "n" FROM information_schema.columns
    WHERE table_name = 'barber_shops' AND column_name = 'starsCardAfterCharge'`;
  return (r[0]?.n ?? 0) > 0;
}

before(async () => {
  if (!HAS_DB) return;
  ({ prisma } = await import("@/lib/prisma"));
  cash = await import("@/lib/barber/cash");
  ruta = await import("@/app/api/barber/sales/route");
  lib = await import("@/lib/barber/tarjeta-cobro");
  instalarFetch();
  CON = await makeShop("Con", true);
  SIN = await makeShop("Sin", false);
  await cash.openCashSession(CON.ctx, { openingAmount: 0 });
  await cash.openCashSession(SIN.ctx, { openingAmount: 0 });
});

beforeEach(() => {
  graph = [];
  metaRechaza = null;
});

after(async () => {
  globalThis.fetch = realFetch;
  if (!HAS_DB) return;
  const shops = await prisma.barbershop.findMany({ where: { slug: { startsWith: `${RUN}-` } }, select: { id: true } });
  const ids = shops.map((s) => s.id);
  await prisma.barberMessage.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberCommissionEntry.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberSaleItem.deleteMany({ where: { sale: { barbershopId: { in: ids } } } });
  await prisma.barberStockMovement.deleteMany({ where: { barbershopId: { in: ids } } }).catch(() => {});
  await prisma.barberSale.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.$executeRawUnsafe(`DELETE FROM "barber_cash_movements" WHERE "barbershopId" = ANY($1)`, ids).catch(() => {});
  await prisma.barberCashSession.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberClient.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberProduct.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberService.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barberUser.deleteMany({ where: { barbershopId: { in: ids } } });
  await prisma.barbershop.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test("sin el SQL: el envío está ENCENDIDO (por defecto) y apagarlo dice «falta el SQL»", { skip }, async (t) => {
  if (await hayColumna()) return t.skip("la columna ya existe en esta base (corrida anterior): se prueba con el SQL pegado");
  lib._reiniciarTarjetaCobro();
  assert.deepEqual(await lib.readStarsCardSetting(CON.id), { enabled: true, persisted: false });
  const r = await lib.saveStarsCardSetting(CON.id, false);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "sql_pendiente");
});

test("el SQL se pega dos veces sin error y el interruptor queda encendido", { skip }, async () => {
  await aplicarSql();
  await aplicarSql();
  lib._reiniciarTarjetaCobro();
  assert.deepEqual(await lib.readStarsCardSetting(CON.id), { enabled: true, persisted: true });
});

test("fuera de la ventana de 24 h: sale con la plantilla y sus 4 variables (nombre, estrellas, total, enlace)", { skip }, async () => {
  const c = await cliente(CON);
  const sale = await cobrar(CON, c.id);
  assert.equal(sale.starsCard.status, "sent", JSON.stringify(sale.starsCard));
  const [m] = mensajes();
  assert.equal(m.body.type, "template");
  assert.equal(m.body.template.name, "dc_barber_tarjeta_estrellas");
  const params = m.body.template.components[0].parameters.map((p: { text: string }) => p.text);
  assert.equal(params.length, 4);
  assert.equal(params[0], "Luis");
  assert.equal(params[1], "1");
  assert.equal(params[2], "6", "de cuántas = las del siguiente bono");
  assert.match(params[3], new RegExp(`^https://panel\\.test/b/${CON.slug}/tarjeta/`));
  assert.equal(m.body.to.replace(/\D/g, "").slice(-10), c.phone);
  const filas = await filasDe(CON, sale.id);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].status, "SENT");
  assert.equal(filas[0].clientId, c.id);
});

test("con la ventana abierta: sale como TEXTO con las mismas palabras", { skip }, async () => {
  const c = await cliente(CON);
  await prisma.barberMessage.create({ data: { barbershopId: CON.id, direction: "INBOUND", phone: c.phone, body: "hola", status: "DELIVERED" as never } });
  const sale = await cobrar(CON, c.id);
  assert.equal(sale.starsCard.status, "sent");
  const [m] = mensajes();
  assert.equal(m.body.type, "text");
  assert.match(m.body.text.body, /^Hola Luis, gracias por tu visita\. ⭐ Llevas 1 de 6 estrellas en tu tarjeta\./);
  assert.match(m.body.text.body, /Ve tu tarjeta aquí: https:\/\/panel\.test\/b\//);
});

test("sin plantilla aprobada (132001): no sale nada y Caja recibe el botón manual (wa.me con el texto)", { skip }, async () => {
  metaRechaza = { status: 404, json: { error: { code: 132001, message: "Template name does not exist in the translation" } } };
  const c = await cliente(CON);
  const sale = await cobrar(CON, c.id);
  assert.equal(sale.starsCard.status, "manual");
  assert.equal(sale.starsCard.reason, "templatePending");
  assert.match(sale.starsCard.manualHref, new RegExp(`^https://wa\\.me/52${c.phone}\\?text=`));
  assert.match(decodeURIComponent(sale.starsCard.manualHref.split("?text=")[1]), /Llevas 1 de 6 estrellas/);
  const [fila] = await filasDe(CON, sale.id);
  assert.equal(fila.status, "FAILED", "no se queda en la cola para salir días después");
});

test("sin WhatsApp conectado: no se encola nada; botón manual", { skip }, async () => {
  const c = await cliente(SIN);
  const sale = await cobrar(SIN, c.id);
  assert.equal(sale.starsCard.status, "manual");
  assert.equal(sale.starsCard.reason, "notConnected");
  assert.equal(mensajes().length, 0);
  assert.equal((await filasDe(SIN, sale.id)).length, 0);
});

test("con el interruptor APAGADO: no se manda; botón manual", { skip }, async () => {
  const r = await lib.saveStarsCardSetting(CON.id, false);
  assert.equal(r.ok, true);
  try {
    const c = await cliente(CON);
    const sale = await cobrar(CON, c.id);
    assert.equal(sale.starsCard.status, "manual");
    assert.equal(sale.starsCard.reason, "off");
    assert.equal(mensajes().length, 0);
  } finally {
    await lib.saveStarsCardSetting(CON.id, true);
  }
});

test("cliente que pidió la baja: no se le escribe solo", { skip }, async () => {
  const c = await cliente(CON, { preferences: { __optout: { at: new Date().toISOString() } } });
  const sale = await cobrar(CON, c.id);
  assert.equal(sale.starsCard.status, "manual");
  assert.equal(sale.starsCard.reason, "optedOut");
  assert.equal(mensajes().length, 0);
});

test("una venta solo de productos no mueve la tarjeta: no se manda nada", { skip }, async () => {
  const c = await cliente(CON);
  const sale = await cobrar(CON, c.id, [{ kind: "product", id: CON.productId, qty: 1 }]);
  assert.equal(sale.starsCard.status, "none");
  assert.equal(mensajes().length, 0);
});

test("una vez por ticket: dos envíos a la vez del mismo ticket = un solo mensaje", { skip }, async () => {
  const c = await cliente(CON);
  const sale = await cobrar(CON, c.id);
  assert.equal(mensajes().length, 1);
  const starsCore = await import("../stars-core");
  const outcome = await starsCore.saleStarsOutcome(prisma, { barbershopId: CON.id, slug: CON.slug, saleId: sale.id });
  const otra = () => lib.sendStarsCardAfterCharge({ barbershopId: CON.id, saleId: sale.id, origin: "https://panel.test", outcome });
  const [a, b] = await Promise.all([otra(), otra()]);
  assert.deepEqual([a.status, b.status], ["queued", "queued"]);
  assert.equal(a.reason, "already");
  assert.equal(mensajes().length, 1, "no salió un segundo mensaje");
  assert.equal((await filasDe(CON, sale.id)).length, 1);
});

test("un ticket de OTRA barbería no se puede usar para mandar (filtro por barbershopId)", { skip }, async () => {
  const c = await cliente(CON);
  const sale = await cobrar(CON, c.id);
  graph = [];
  const starsCore = await import("../stars-core");
  const outcome = await starsCore.saleStarsOutcome(prisma, { barbershopId: CON.id, slug: CON.slug, saleId: sale.id });
  const r = await lib.sendStarsCardAfterCharge({ barbershopId: SIN.id, saleId: sale.id, origin: "https://panel.test", outcome });
  assert.equal(r.status, "none");
  assert.equal(mensajes().length, 0);
});
