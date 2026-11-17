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
// Fija los TRES modos (Rafael, 16-nov: «que a ninguna barbería le llegue un
// cobro de Meta inesperado»):
//   · «Solo cuando sea gratis» (de fábrica): con la ventana de 24 h abierta
//     sale como texto; cerrada, NO sale (ni plantilla) y queda el botón; una
//     fila «gratis» cuya ventana se cerró en el camino caduca sin plantilla;
//   · «Siempre»: texto dentro de la ventana, plantilla fuera;
//   · «No mandar».
// Y: sin plantilla aprobada, sin WhatsApp o con el cliente dado de baja NO
// sale y Caja recibe el wa.me para mandarla a mano; una venta solo de productos no manda nada; un
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
  prisma.barberMessage.findMany({
    where: { barbershopId: shop.id, templateName: { in: [`auto:tarjeta:${saleId}`, `auto:tarjeta-gratis:${saleId}`] } },
  });

/** El cliente escribió hace `horasAtras` (ventana de 24 h abierta si < 24). */
const escribio = (shop: Shop, phone: string, horasAtras = 1) =>
  prisma.barberMessage.create({
    data: { barbershopId: shop.id, direction: "INBOUND", phone, body: "hola", status: "DELIVERED" as never, createdAt: new Date(Date.now() - horasAtras * 3600_000) },
  });

/** Corre `fn` con el interruptor en `modo` y lo deja como estaba (de fábrica: «free»). */
async function conModo<T>(modo: "free" | "always" | "off", fn: () => Promise<T>): Promise<T> {
  const r = await lib.saveStarsCardSetting(CON.id, modo);
  assert.equal(r.ok, true, JSON.stringify(r));
  try {
    return await fn();
  } finally {
    await lib.saveStarsCardSetting(CON.id, "free");
  }
}

async function aplicarSql() {
  const sql = fs.readFileSync(path.join(ROOT, "sql/barber_tarjeta_cobro.sql"), "utf8").replace(/^\s*--.*$/gm, "");
  for (const stmt of sql.split(/;\s*\n/).map((x) => x.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(stmt);
}
async function hayColumna(): Promise<boolean> {
  const r = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS "n" FROM information_schema.columns
    WHERE table_name = 'barber_shops' AND column_name = 'starsCardMode'`;
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

test("sin el SQL: vale «Solo cuando sea gratis» y cambiarlo dice «falta el SQL»", { skip }, async (t) => {
  if (await hayColumna()) return t.skip("la columna ya existe en esta base (corrida anterior): se prueba con el SQL pegado");
  lib._reiniciarTarjetaCobro();
  assert.deepEqual(await lib.readStarsCardSetting(CON.id), { mode: "free", persisted: false });
  const r = await lib.saveStarsCardSetting(CON.id, "always");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "sql_pendiente");
});

test("el SQL se pega dos veces sin error; queda «Solo cuando sea gratis» y no admite otro valor", { skip }, async () => {
  await aplicarSql();
  await aplicarSql();
  lib._reiniciarTarjetaCobro();
  assert.deepEqual(await lib.readStarsCardSetting(CON.id), { mode: "free", persisted: true });
  await assert.rejects(() => prisma.$executeRawUnsafe(`UPDATE "barber_shops" SET "starsCardMode" = 'gratis' WHERE "id" = $1`, CON.id));
  await assert.rejects(() => lib.saveStarsCardSetting(CON.id, "gratis"));
});

test("DE FÁBRICA, ventana cerrada (nunca escribió): no sale NADA —ni plantilla— y queda el botón manual", { skip }, async () => {
  const c = await cliente(CON);
  const sale = await cobrar(CON, c.id);
  assert.equal(sale.starsCard.status, "manual");
  assert.equal(sale.starsCard.reason, "outsideWindow");
  assert.match(sale.starsCard.manualHref, new RegExp(`^https://wa\\.me/52${c.phone}\\?text=`));
  assert.equal(mensajes().length, 0, "ninguna llamada a Meta");
  assert.equal((await filasDe(CON, sale.id)).length, 0, "ni siquiera se encola");
});

test("DE FÁBRICA, la ventana se cerró hace poco (escribió hace 25 h): tampoco sale", { skip }, async () => {
  const c = await cliente(CON);
  await escribio(CON, c.phone, 25);
  const sale = await cobrar(CON, c.id);
  assert.equal(sale.starsCard.reason, "outsideWindow");
  assert.equal(mensajes().length, 0);
});

test("DE FÁBRICA, ventana abierta (escribió hace 23 h): sale como TEXTO, gratis, con la marca «gratis»", { skip }, async () => {
  const c = await cliente(CON);
  await escribio(CON, c.phone, 23);
  const sale = await cobrar(CON, c.id);
  assert.equal(sale.starsCard.status, "sent");
  const [m] = mensajes();
  assert.equal(m.body.type, "text");
  const [fila] = await filasDe(CON, sale.id);
  assert.equal(fila.templateName, `auto:tarjeta-gratis:${sale.id}`);
});

test("una fila «gratis» cuya ventana se cerró antes de salir CADUCA: nunca sale con plantilla de pago", { skip }, async () => {
  const c = await cliente(CON);
  const sale = await cobrar(CON, c.id); // ventana cerrada: no se encoló nada
  // Como si se hubiera encolado con la ventana abierta y ésta se cerrara en el camino.
  const fila = await prisma.barberMessage.create({
    data: { barbershopId: CON.id, direction: "OUTBOUND", phone: c.phone, body: "Ve tu tarjeta aquí: https://panel.test/b/x", templateName: `auto:tarjeta-gratis:${sale.id}`, status: "PENDING", clientId: c.id },
  });
  const wa = await import("@/lib/barber/whatsapp");
  const r = await wa.deliverBarberMessageNow(CON.id, fila.id);
  assert.equal(r.status, "FAILED");
  assert.equal(r.code, "STALE");
  assert.equal(mensajes().length, 0, "no se llamó a Meta: ni texto (fuera de ventana) ni plantilla");
  // Y el drenado del cron tampoco la manda.
  const d = await wa.drainBarberOutbox(CON.id);
  assert.equal(d.sent, 0);
  assert.equal(mensajes().length, 0);
});

test("«SIEMPRE», fuera de la ventana de 24 h: sale con la plantilla y sus 4 variables (nombre, estrellas, total, enlace)", { skip }, async () => {
  const c = await cliente(CON);
  const sale = await conModo("always", () => cobrar(CON, c.id));
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

test("«SIEMPRE», con la ventana abierta: sale como TEXTO (gratis) con las mismas palabras", { skip }, async () => {
  const c = await cliente(CON);
  await escribio(CON, c.phone);
  const sale = await conModo("always", () => cobrar(CON, c.id));
  assert.equal(sale.starsCard.status, "sent");
  const [m] = mensajes();
  assert.equal(m.body.type, "text");
  assert.match(m.body.text.body, /^Hola Luis, gracias por tu visita\. ⭐ Llevas 1 de 6 estrellas en tu tarjeta\./);
  assert.match(m.body.text.body, /Ve tu tarjeta aquí: https:\/\/panel\.test\/b\//);
});

test("«SIEMPRE», sin plantilla aprobada (132001): no sale nada y Caja recibe el botón manual (wa.me con el texto)", { skip }, async () => {
  metaRechaza = { status: 404, json: { error: { code: 132001, message: "Template name does not exist in the translation" } } };
  const c = await cliente(CON);
  const sale = await conModo("always", () => cobrar(CON, c.id));
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

test("«NO MANDAR»: no se manda ni con la ventana abierta; botón manual", { skip }, async () => {
  const c = await cliente(CON);
  await escribio(CON, c.phone);
  const sale = await conModo("off", () => cobrar(CON, c.id));
  assert.equal(sale.starsCard.status, "manual");
  assert.equal(sale.starsCard.reason, "off");
  assert.equal(mensajes().length, 0);
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
  await escribio(CON, c.phone);
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

// ── Punto 3: el QR de su tarjeta en el ticket impreso ──

test("ticket con cliente y estrellas encendidas: da la ruta de SU tarjeta (la misma del mensaje)", { skip }, async () => {
  const starsCore = await import("../stars-core");
  const c = await cliente(CON);
  const sale = await cobrar(CON, c.id);
  const ruta = await starsCore.ticketStarsCardPath(prisma, { barbershopId: CON.id, slug: CON.slug, saleId: sale.id });
  assert.ok(ruta);
  assert.match(ruta!, new RegExp(`^/b/${CON.slug}/tarjeta/`));
  assert.equal(ruta, sale.stars.cardPath, "el QR del ticket abre la misma tarjeta que el enlace");
});

test("ticket sin cliente: sin QR", { skip }, async () => {
  const starsCore = await import("../stars-core");
  session = CON.ctx;
  const sale = await cash.createSale(CON.ctx, { items: [{ kind: "service", id: CON.serviceId }], paymentMethod: "CASH" } as never, FEATURES);
  assert.equal(await starsCore.ticketStarsCardPath(prisma, { barbershopId: CON.id, slug: CON.slug, saleId: sale.id }), null);
});

test("estrellas apagadas en la barbería: sin QR (y tampoco mensaje)", { skip }, async () => {
  const starsCore = await import("../stars-core");
  const c = await cliente(CON);
  await prisma.barbershop.update({ where: { id: CON.id }, data: { loyaltyEnabled: false } });
  try {
    const sale = await cobrar(CON, c.id);
    assert.equal(sale.starsCard.status, "none");
    assert.equal(await starsCore.ticketStarsCardPath(prisma, { barbershopId: CON.id, slug: CON.slug, saleId: sale.id }), null);
  } finally {
    await prisma.barbershop.update({ where: { id: CON.id }, data: { loyaltyEnabled: true } });
  }
});

test("ticket de otra barbería: sin QR (filtro por barbershopId)", { skip }, async () => {
  const starsCore = await import("../stars-core");
  const c = await cliente(CON);
  const sale = await cobrar(CON, c.id);
  assert.equal(await starsCore.ticketStarsCardPath(prisma, { barbershopId: SIN.id, slug: SIN.slug, saleId: sale.id }), null);
});

test("cableado del ticket impreso: QR solo con ruta y sin cancelar; texto es/en; reusa print-* (carta, 80, 58)", () => {
  const pagina = fs.readFileSync(path.join(ROOT, "src/app/barber/(panel)/caja/ticket/[saleId]/page.tsx"), "utf8");
  assert.match(pagina, /sale\.cancelled\s*\?\s*null\s*:\s*await ticketStarsCardPath\(/);
  const comp = fs.readFileSync(path.join(ROOT, "src/components/barber/cash/ticket-print.tsx"), "utf8");
  assert.match(comp, /!sale\.cancelled && starsCardUrl && \(/);
  assert.match(comp, /t\("print\.starsCardQr"\)/);
  assert.match(comp, /usePrintSetup\(\)/, "mismo ancho de impresión que el resto del ticket");
  const css = fs.readFileSync(path.join(ROOT, "src/components/barber/cash/money.css"), "utf8");
  assert.match(css, /\.bcaja-print--t58 \.bcaja-print__qr-code \{ width: 30mm; height: 30mm; \}/, "en 58 mm el QR mide 30 mm (área útil ~48 mm)");
  const bloque = css.slice(css.indexOf("/* QR de la tarjeta de estrellas"), css.indexOf(".bcaja-print-actions"));
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(bloque), "sin colores fijos");
  for (const l of ["es", "en"]) {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, `src/i18n/dictionaries/barber/caja.${l}.json`), "utf8"));
    assert.ok(d.print.starsCardQr, l);
  }
});
