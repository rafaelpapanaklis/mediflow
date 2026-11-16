// MERCADO PAGO DE LA TIENDA DE BARBER (ws6-t5), de punta a punta, con las
// rutas REALES y Postgres local.
//
// 🔴 Crea y borra barberías: solo corre con DATABASE_URL local.
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/mercadopago-integration.test.ts
//
// La base necesita sql/barber_mercadopago.sql y la tabla de pedidos de la
// tienda (sql/barber_tienda.sql de ws6-t1, o la del contrato).
//
// Qué es real y qué no:
//   · REAL → las rutas (OAuth, desconectar, estado, link del pedido, webhook
//     de barber y webhook del DENTAL), la firma, el cifrado de tokens, el SQL.
//   · DOBLE → la sesión de Supabase (quién está logueado) y Mercado Pago
//     (un fetch falso que guarda preferencias y pagos POR CUENTA: con el token
//     de una barbería no se ven los pagos de otra, como en el de verdad).
import "./_sin-server-only";
import Module from "node:module";
import path from "node:path";
import { createHmac, randomUUID } from "node:crypto";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const URL_DB = process.env.DATABASE_URL ?? "";
const BASE_LOCAL = /@(127\.0\.0\.1|localhost)[:/]/.test(URL_DB);
const skip = BASE_LOCAL ? false : "DATABASE_URL no es local (o no está): se salta la integración";

/* ═══════════════ Entorno de la plataforma ═══════════════ */

const BASE = "https://app.dalecontrol.test";
const SECRETO = "secreto-webhook-de-prueba";
const LLAVE = "ab".repeat(32);
process.env.NEXT_PUBLIC_APP_URL = BASE;
process.env.MERCADOPAGO_CLIENT_ID = "cliente-de-prueba";
process.env.MERCADOPAGO_CLIENT_SECRET = "secreto-cliente-de-prueba";
process.env.MERCADOPAGO_WEBHOOK_SECRET = SECRETO;
process.env.DATA_ENCRYPTION_KEY = LLAVE;
delete process.env.MERCADOPAGO_OAUTH_REDIRECT_URI;

/* ═══════════════ Doble de la sesión ═══════════════ */

let sesion: string | null = null; // supabaseId del usuario "logueado"
const supabaseServerDoble = {
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: sesion ? { id: sesion, app_metadata: {} } : null } }) },
  }),
};
const SRC = path.resolve(__dirname, "../../..");
const dobles = new Map<string, unknown>([[path.join(SRC, "lib/supabase/server.ts"), supabaseServerDoble]]);
const M = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (request: string, parent: unknown, isMain: boolean) => string;
};
const cargaOriginal = M._load;
M._load = function (request: string, parent: unknown, isMain: boolean) {
  try {
    const resuelto = M._resolveFilename(request, parent, isMain);
    if (dobles.has(resuelto)) return dobles.get(resuelto);
  } catch {
    // no resoluble aquí: que lo intente el cargador normal
  }
  return cargaOriginal.call(this, request, parent, isMain);
};

/* ═══════════════ Mercado Pago falso ═══════════════ */

interface Llamada {
  method: string;
  url: string;
  auth: string | null;
  body: any;
}
let llamadas: Llamada[] = [];
let prefSeq = 0;
/** Pagos por TOKEN de cuenta: con el token de A no se ven los de B. */
const pagosPorToken = new Map<string, Map<string, Record<string, unknown>>>();
let canje: Record<string, unknown> = {};
const fetchOriginal = globalThis.fetch;

function pagoEn(token: string, p: Record<string, unknown>): void {
  if (!pagosPorToken.has(token)) pagosPorToken.set(token, new Map());
  pagosPorToken.get(token)!.set(String(p.id), p);
}

function instalarMp(): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const auth = headers.get("authorization");
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    llamadas.push({ method, url, auth, body });
    const json = (status: number, data: unknown) =>
      new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    const u = new URL(url);
    if (u.host !== "api.mercadopago.com") throw new Error(`fetch inesperado: ${url}`);
    if (method === "POST" && u.pathname === "/checkout/preferences") {
      prefSeq += 1;
      return json(201, { id: `pref-${prefSeq}`, init_point: `https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=pref-${prefSeq}` });
    }
    if (method === "PUT" && u.pathname.startsWith("/checkout/preferences/")) return json(200, {});
    const mPago = u.pathname.match(/^\/v1\/payments\/(\d+)$/);
    if (method === "GET" && mPago) {
      const token = (auth ?? "").replace(/^Bearer /, "");
      const p = pagosPorToken.get(token)?.get(mPago[1]);
      return p ? json(200, p) : json(404, { message: "Payment not found" });
    }
    if (method === "POST" && u.pathname === "/oauth/token") return json(200, canje);
    if (method === "GET" && u.pathname === "/users/me") {
      return json(200, { id: 4242, nickname: "BARBERIA.NUEVA", email: "dueno@barberia.test" });
    }
    throw new Error(`ruta de MP no simulada: ${method} ${url}`);
  }) as typeof fetch;
}

/* ═══════════════ Firma como la manda Mercado Pago ═══════════════ */

function firmar(dataId: string, requestId: string, secreto = SECRETO): string {
  const ts = String(Date.now());
  const v1 = createHmac("sha256", secreto).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest("hex");
  return `ts=${ts},v1=${v1}`;
}

let reqSeq = 0;
function aviso(ruta: string, query: Record<string, string>, dataId: string, opts: { firma?: string | null } = {}) {
  const q = new URLSearchParams({ ...query, "data.id": dataId, type: "payment" });
  const requestId = `req-${++reqSeq}`;
  const headers: Record<string, string> = { "content-type": "application/json", "x-request-id": requestId };
  const firma = opts.firma === undefined ? firmar(dataId, requestId) : opts.firma;
  if (firma) headers["x-signature"] = firma;
  return new NextRequest(`${BASE}${ruta}?${q.toString()}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ id: 123456, type: "payment", action: "payment.created", data: { id: dataId } }),
  });
}

/* ═══════════════ Semilla ═══════════════ */

const RUN = `mp${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
const creadas: string[] = [];
let A: { id: string; slug: string };
let A2: { id: string; slug: string }; // sucursal de A
let B: { id: string; slug: string }; // otra cadena
let C: { id: string; slug: string }; // sin Mercado Pago
const DUENO_A = `${RUN}-dueno-a`;
const RECEPCION_A = `${RUN}-recepcion-a`;
const DUENO_B = `${RUN}-dueno-b`;
let duenoAUserId = "";

async function tienda(n: string, parentId: string | null = null) {
  const s = await prisma.barbershop.create({
    data: {
      name: `Barbería ${n}`,
      slug: `${RUN}-${n}`,
      subscriptionStatus: "active",
      parentId,
      isMainBranch: parentId == null,
      branchName: parentId ? "Norte" : null,
    } as never,
    select: { id: true, slug: true },
  });
  creadas.push(s.id);
  return s;
}

async function usuario(barbershopId: string, supabaseId: string, role: string) {
  const u = await prisma.barberUser.create({
    data: { barbershopId, supabaseId, email: `${supabaseId}@x.test`, firstName: "Ana", lastName: "Prueba", role } as never,
    select: { id: true },
  });
  return u.id;
}

const ITEMS = [
  { productId: "p1", name: "Cera mate", unitPrice: 189.5, qty: 2 },
  { productId: "p2", name: "Shampoo de menta", unitPrice: 120, qty: 1 },
];

/**
 * Un pedido como lo deja la tienda (sql/barber_tienda.sql de ws6-t1):
 *   · `id` TEXT NOT NULL SIN valor por defecto (lo pone el código de la
 *     tienda con gen_random_uuid()), así que aquí también se da;
 *   · CHECK «pagado en línea ⇒ con paid_at» y «entregado ⇔ con venta de Caja»:
 *     un PAID_ONLINE nace con paid_at y un PICKED_UP con su venta.
 */
async function pedido(barbershopId: string, o: { status?: string; total?: number; creado?: Date; items?: unknown } = {}) {
  const status = o.status ?? "PENDING";
  const total = o.total ?? 499;
  const paidAt = status === "PAID_ONLINE" ? new Date() : null;
  let saleId: string | null = null;
  if (status === "PICKED_UP") {
    const venta = await prisma.barberSale.create({
      data: { barbershopId, soldByUserId: duenoAUserId, subtotal: total, total, notes: "pedido de la tienda (prueba MP)" } as never,
      select: { id: true },
    });
    saleId = venta.id;
  }
  const filas = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    INSERT INTO barber_product_orders (id, barbershop_id, branch_id, folio, client_name, client_phone, items, total, status, pay_method,
                                       paid_at, sale_id, created_at, updated_at)
    VALUES (${randomUUID()}, ${barbershopId}, ${barbershopId}, ${`F-${++reqSeq}`}, 'Luis Pérez', '5512345678',
            ${JSON.stringify(o.items ?? ITEMS)}::jsonb, ${total}, ${status}, 'MERCADOPAGO',
            ${paidAt}, ${saleId}, ${o.creado ?? new Date()}, ${new Date("2026-01-01T00:00:00Z")})
    RETURNING id
  `);
  return filas[0].id;
}

async function filaPedido(id: string) {
  const f = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT id, barbershop_id, branch_id, folio, client_id, client_name, client_phone, items, total::float8 AS total,
           status, pay_method, mp_preference_id, mp_payment_id, paid_at, picked_up_at, sale_id, created_at, updated_at
      FROM barber_product_orders WHERE id = ${id}
  `);
  return f[0];
}

function pagoAprobado(id: string, ref: string, monto = 499, extra: Record<string, unknown> = {}) {
  return {
    id: Number(id),
    status: "approved",
    status_detail: "accredited",
    external_reference: ref,
    transaction_amount: monto,
    currency_id: "MXN",
    collector_id: 777,
    ...extra,
  };
}

/* ═══════════════ Módulos bajo prueba (después de los dobles) ═══════════════ */

let mp: typeof import("@/lib/barber/mercadopago");
let rutaConectar: typeof import("@/app/api/barber/mercadopago/oauth/conectar/route");
let rutaCallback: typeof import("@/app/api/barber/mercadopago/oauth/callback/route");
let rutaDesconectar: typeof import("@/app/api/barber/mercadopago/disconnect/route");
let rutaEstado: typeof import("@/app/api/barber/mercadopago/status/route");
let rutaWebhook: typeof import("@/app/api/barber/mercadopago/webhook/route");
let rutaLink: typeof import("@/app/api/barber/public/orders/[id]/mercadopago/route");
let webhookDental: typeof import("@/app/api/webhooks/mercadopago/route");

const TOKENS_A = { accessToken: "tok-A", refreshToken: "ref-A", expiresIn: 180 * 86400, userId: "777", liveMode: true };
const TOKENS_B = { accessToken: "tok-B", refreshToken: "ref-B", expiresIn: 180 * 86400, userId: "888", liveMode: true };

before(async () => {
  if (skip) return;
  mp = await import("@/lib/barber/mercadopago");
  rutaConectar = await import("@/app/api/barber/mercadopago/oauth/conectar/route");
  rutaCallback = await import("@/app/api/barber/mercadopago/oauth/callback/route");
  rutaDesconectar = await import("@/app/api/barber/mercadopago/disconnect/route");
  rutaEstado = await import("@/app/api/barber/mercadopago/status/route");
  rutaWebhook = await import("@/app/api/barber/mercadopago/webhook/route");
  rutaLink = await import("@/app/api/barber/public/orders/[id]/mercadopago/route");
  webhookDental = await import("@/app/api/webhooks/mercadopago/route");

  A = await tienda("a");
  A2 = await tienda("a-norte", A.id);
  B = await tienda("b");
  C = await tienda("c");
  duenoAUserId = await usuario(A.id, DUENO_A, "OWNER");
  await usuario(A.id, RECEPCION_A, "RECEPTION");
  await usuario(B.id, DUENO_B, "OWNER");
  await mp.guardarConexion({ rootId: A.id, barberUserId: duenoAUserId, tokens: TOKENS_A, cuenta: { id: "777", nickname: "NAVAJA.MX", email: "pagos@navaja.test" } });
  await mp.guardarConexion({ rootId: B.id, barberUserId: "x", tokens: TOKENS_B, cuenta: { id: "888", nickname: "OTRA", email: null } });
  instalarMp();
});

beforeEach(() => {
  llamadas = [];
  sesion = null;
});

after(async () => {
  globalThis.fetch = fetchOriginal;
  if (skip) return;
  await prisma.$executeRaw(Prisma.sql`DELETE FROM barber_product_orders WHERE barbershop_id = ANY(${creadas})`);
  await prisma.$executeRaw(Prisma.sql`DELETE FROM barber_mercadopago_accounts WHERE barbershop_id = ANY(${creadas})`);
  // Las ventas de los pedidos entregados apuntan al usuario (sin cascada): van antes.
  await prisma.barberSale.deleteMany({ where: { barbershopId: { in: creadas } } });
  await prisma.barberUser.deleteMany({ where: { barbershopId: { in: creadas } } });
  await prisma.barbershop.deleteMany({ where: { id: { in: creadas }, parentId: { not: null } } });
  await prisma.barbershop.deleteMany({ where: { id: { in: creadas } } });
  await prisma.$disconnect();
});

const linkDe = (id: string, body: unknown = {}) =>
  rutaLink.POST(
    new NextRequest(`${BASE}/api/barber/public/orders/${id}/mercadopago`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `10.0.${reqSeq % 250}.${++reqSeq % 250}` },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

/* ═══════════════ 1. La conexión ═══════════════ */

test("el token se guarda CIFRADO y el estado no lo enseña", { skip }, async () => {
  const fila = await prisma.$queryRaw<any[]>(Prisma.sql`SELECT access_token, refresh_token FROM barber_mercadopago_accounts WHERE barbershop_id = ${A.id}`);
  assert.match(fila[0].access_token, /^v1:/);
  assert.ok(!fila[0].access_token.includes("tok-A"));
  assert.match(fila[0].refresh_token, /^v1:/);
  const e = await mp.estadoCuentaMp(A.id);
  assert.equal(e.connected, true);
  assert.equal(e.needsReconnect, false);
  assert.deepEqual(e.account, { nickname: "NAVAJA.MX", email: "pagos@navaja.test", id: "••••777", testMode: false });
  assert.ok(!JSON.stringify(e).includes("tok-A"));
});

test("sin la llave de cifrado (panel.108) o con otra llave: «vuelve a conectar», nunca un error", { skip }, async () => {
  try {
    process.env.DATA_ENCRYPTION_KEY = "cd".repeat(32); // otra llave: el token no abre
    let e = await mp.estadoCuentaMp(A.id);
    assert.equal(e.connected, false);
    assert.equal(e.needsReconnect, true);
    assert.equal(e.account?.nickname, "NAVAJA.MX", "la cuenta se sigue viendo");
    delete process.env.DATA_ENCRYPTION_KEY; // sin llave
    e = await mp.estadoCuentaMp(A.id);
    assert.equal(e.connected, false);
    assert.equal(e.needsReconnect, true);
    assert.equal(e.platformReady, false);
    assert.equal(await mp.tiendaAceptaMercadoPago(A2.id), false, "la tienda no ofrece pagar en línea");
    const id = await pedido(A2.id);
    const r = await linkDe(id);
    assert.equal(r.status, 404);
    assert.equal((await r.json()).code, "mpUnavailable");
    assert.equal(llamadas.length, 0, "ni se intenta hablar con Mercado Pago");
  } finally {
    process.env.DATA_ENCRYPTION_KEY = LLAVE;
  }
});

test("OAuth: el dueño sale a MP con la redirect URI de BARBER y vuelve conectado", { skip }, async () => {
  sesion = DUENO_B;
  const ida = await rutaConectar.GET(new NextRequest(`${BASE}/api/barber/mercadopago/oauth/conectar`));
  assert.equal(ida.status, 307);
  const destino = new URL(ida.headers.get("location")!);
  assert.equal(destino.origin + destino.pathname, "https://auth.mercadopago.com/authorization");
  assert.equal(destino.searchParams.get("redirect_uri"), `${BASE}/api/barber/mercadopago/oauth/callback`);
  assert.equal(destino.searchParams.get("client_id"), "cliente-de-prueba");
  const cookie = ida.cookies.get("dcb_mp_oauth");
  assert.ok(cookie?.value);
  assert.equal(cookie?.path, "/api/barber/mercadopago/oauth");
  assert.equal(cookie?.httpOnly, true);

  canje = { access_token: "tok-B2", refresh_token: "ref-B2", expires_in: 15552000, user_id: 4242, live_mode: false };
  const vuelta = await rutaCallback.GET(
    new NextRequest(`${BASE}/api/barber/mercadopago/oauth/callback?code=abc&state=${destino.searchParams.get("state")}`, {
      headers: { cookie: `dcb_mp_oauth=${cookie!.value}` },
    }),
  );
  assert.equal(vuelta.headers.get("location"), `${BASE}/barber/configuracion?mp=conectada#pagos-en-linea`);
  const tokenPost = llamadas.find((l) => l.url.endsWith("/oauth/token"));
  assert.equal(tokenPost?.body.redirect_uri, `${BASE}/api/barber/mercadopago/oauth/callback`);
  assert.equal(tokenPost?.body.code_verifier?.length > 40, true, "PKCE");
  const e = await mp.estadoCuentaMp(B.id);
  assert.equal(e.connected, true);
  assert.equal(e.account?.nickname, "BARBERIA.NUEVA");
  assert.equal(e.account?.testMode, true);
  // Se deja B como estaba para lo que sigue.
  await mp.guardarConexion({ rootId: B.id, barberUserId: "x", tokens: TOKENS_B, cuenta: { id: "888", nickname: "OTRA", email: null } });
});

test("OAuth: recepción no conecta; un state ajeno o la sesión de otra persona no conectan", { skip }, async () => {
  sesion = RECEPCION_A;
  const r = await rutaConectar.GET(new NextRequest(`${BASE}/api/barber/mercadopago/oauth/conectar`));
  assert.equal(r.headers.get("location"), `${BASE}/barber/configuracion?mp=error&motivo=permiso#pagos-en-linea`);
  assert.equal(r.cookies.get("dcb_mp_oauth"), undefined);

  sesion = DUENO_A;
  const ida = await rutaConectar.GET(new NextRequest(`${BASE}/api/barber/mercadopago/oauth/conectar`));
  const cookie = ida.cookies.get("dcb_mp_oauth")!.value;
  const state = new URL(ida.headers.get("location")!).searchParams.get("state");
  const malo = await rutaCallback.GET(
    new NextRequest(`${BASE}/api/barber/mercadopago/oauth/callback?code=abc&state=otro`, { headers: { cookie: `dcb_mp_oauth=${cookie}` } }),
  );
  assert.match(malo.headers.get("location")!, /motivo=estado/);
  sesion = DUENO_B; // otra persona con la cookie de A
  const ajena = await rutaCallback.GET(
    new NextRequest(`${BASE}/api/barber/mercadopago/oauth/callback?code=abc&state=${state}`, { headers: { cookie: `dcb_mp_oauth=${cookie}` } }),
  );
  assert.match(ajena.headers.get("location")!, /motivo=sesion/);
  assert.equal(llamadas.filter((l) => l.url.endsWith("/oauth/token")).length, 0, "nunca se canjeó el código");
  assert.equal((await mp.estadoCuentaMp(A.id)).account?.nickname, "NAVAJA.MX", "A sigue con su cuenta");
});

test("desconectar: solo el dueño; la tienda deja de ofrecer pagar en línea", { skip }, async () => {
  sesion = RECEPCION_A;
  assert.equal((await rutaDesconectar.POST()).status, 403);
  assert.equal((await mp.estadoCuentaMp(A.id)).connected, true);

  sesion = DUENO_A;
  const r = await rutaDesconectar.POST();
  assert.equal(r.status, 200);
  const cuerpo = await r.json();
  assert.equal(cuerpo.status.connected, false);
  assert.equal(cuerpo.status.account, null);
  assert.equal(await mp.tiendaAceptaMercadoPago(A2.id), false);
  const fila = await prisma.$queryRaw<any[]>(Prisma.sql`SELECT access_token, refresh_token, disconnected_at, mp_user_id FROM barber_mercadopago_accounts WHERE barbershop_id = ${A.id}`);
  assert.equal(fila[0].access_token, null);
  assert.equal(fila[0].refresh_token, null);
  assert.ok(fila[0].disconnected_at);
  assert.equal(fila[0].mp_user_id, "777", "la fila recuerda con qué cuenta estuvo");
  await mp.guardarConexion({ rootId: A.id, barberUserId: duenoAUserId, tokens: TOKENS_A, cuenta: { id: "777", nickname: "NAVAJA.MX", email: "pagos@navaja.test" } });
});

/* ═══════════════ 4. El estado (panel y tienda) ═══════════════ */

test("GET status: la cuenta solo la ven el Dueño y quien tiene Configuración; la tienda (sin sesión, por slug) solo si cobra", { skip }, async () => {
  // D3 (auditoría de permisos, 16-nov): antes TODO el panel recibía el apodo,
  // el correo y el número enmascarado de la cuenta del dueño.
  sesion = RECEPCION_A;
  let r = await rutaEstado.GET(new NextRequest(`${BASE}/api/barber/mercadopago/status`));
  let j = await r.json();
  assert.equal(j.connected, true, "Recepción sí sabe que se cobra en línea");
  assert.equal(j.account, null, "pero no ve la cuenta");
  assert.equal(j.canManage, false);
  sesion = DUENO_A;
  j = await (await rutaEstado.GET(new NextRequest(`${BASE}/api/barber/mercadopago/status`))).json();
  assert.equal(j.canManage, true);
  assert.equal(j.account.nickname, "NAVAJA.MX");
  assert.equal(j.account.email, "pagos@navaja.test");
  // Encargado (trae «Configuración» de fábrica): la ve sin poder conectar/desconectar.
  const gerenteA = `${RUN}-gerente-a`;
  const barberoA = `${RUN}-barbero-a`;
  await usuario(A.id, gerenteA, "MANAGER");
  await usuario(A.id, barberoA, "BARBER");
  sesion = gerenteA;
  j = await (await rutaEstado.GET(new NextRequest(`${BASE}/api/barber/mercadopago/status`))).json();
  assert.equal(j.account.nickname, "NAVAJA.MX");
  assert.equal(j.canManage, false);
  sesion = barberoA;
  j = await (await rutaEstado.GET(new NextRequest(`${BASE}/api/barber/mercadopago/status`))).json();
  assert.equal(j.account, null, "el Barbero no ve la cuenta");
  assert.ok(!JSON.stringify(j).includes("pagos@navaja.test"), "ni el correo en ninguna parte");

  sesion = null;
  const pub = async (slug: string) =>
    (await rutaEstado.GET(new NextRequest(`${BASE}/api/barber/mercadopago/status?slug=${slug}`, { headers: { "x-forwarded-for": "10.9.9.9" } }))).json();
  assert.deepEqual(await pub(A2.slug), { connected: true, account: null }, "la sucursal cobra con la cuenta de su matriz");
  assert.deepEqual(await pub(C.slug), { connected: false, account: null }, "sin conexión → la tienda no ofrece pagar en línea");
  assert.deepEqual(await pub("no-existe-esta"), { connected: false, account: null });
  assert.deepEqual(await (await rutaEstado.GET(new NextRequest(`${BASE}/api/barber/mercadopago/status`))).json(), { connected: false, account: null });
});

/* ═══════════════ 2. La preferencia ═══════════════ */

test("POST link: preferencia con la cuenta de la barbería, renglones congelados, 72 h y vuelta al folio", { skip }, async () => {
  const creado = new Date(Date.now() - 60 * 60 * 1000);
  const id = await pedido(A2.id, { creado });
  const r = await linkDe(id);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.match(j.initPoint, /^https:\/\/www\.mercadopago\.com\.mx\/checkout/);
  assert.deepEqual(Object.keys(j), ["initPoint"], "solo el link: nada del pedido ni de la cuenta");

  const pref = llamadas.find((l) => l.method === "POST" && l.url.endsWith("/checkout/preferences"))!;
  assert.equal(pref.auth, "Bearer tok-A", "cobra la cuenta de la MATRIZ de la sucursal");
  assert.deepEqual(pref.body.items, [
    { title: "Cera mate", quantity: 2, unit_price: 189.5, currency_id: "MXN" },
    { title: "Shampoo de menta", quantity: 1, unit_price: 120, currency_id: "MXN" },
  ]);
  assert.equal(pref.body.external_reference, id);
  assert.equal(pref.body.notification_url, `${BASE}/api/barber/mercadopago/webhook?pedido=${id}&cta=777`);
  const folio = `${BASE}/b/${A2.slug}/tienda/pedido/${id}`;
  assert.deepEqual(pref.body.back_urls, { success: folio, failure: folio, pending: folio });
  assert.equal(pref.body.expires, true);
  assert.equal(pref.body.expiration_date_to, new Date(creado.getTime() + 72 * 3600 * 1000).toISOString());
  assert.equal(pref.body.binary_mode, true);
  assert.deepEqual(pref.body.payment_methods, { excluded_payment_types: [{ id: "ticket" }, { id: "atm" }] });
  assert.equal("marketplace_fee" in pref.body, false, "comisión en 0: no se manda");

  const fila = await filaPedido(id);
  assert.equal(fila.mp_preference_id, "pref-" + prefSeq);
  assert.equal(fila.status, "PENDING");

  // Segundo clic: link nuevo, y el anterior se cierra en MP.
  llamadas = [];
  const otra = await linkDe(id, { returnPath: `/b/${A2.slug}/tienda/pedido/${id}?volvi=1` });
  assert.equal(otra.status, 200);
  const pref2 = llamadas.find((l) => l.method === "POST")!;
  assert.equal(pref2.body.back_urls.success, `${folio}?volvi=1`);
  const cierre = llamadas.find((l) => l.method === "PUT")!;
  assert.match(cierre.url, new RegExp(`/checkout/preferences/${fila.mp_preference_id}$`));
});

test("comisión construida: con 3 % configurado viaja como marketplace_fee en pesos", { skip }, async () => {
  try {
    await prisma.$executeRaw(Prisma.sql`UPDATE barber_mercadopago_accounts SET marketplace_fee_mode = 'percent', marketplace_fee_value = 3 WHERE barbershop_id = ${A.id}`);
    const id = await pedido(A.id);
    assert.equal((await linkDe(id)).status, 200);
    assert.equal(llamadas.find((l) => l.method === "POST")!.body.marketplace_fee, 14.97);
  } finally {
    await prisma.$executeRaw(Prisma.sql`UPDATE barber_mercadopago_accounts SET marketplace_fee_mode = 'fixed', marketplace_fee_value = 0 WHERE barbershop_id = ${A.id}`);
  }
});

test("POST link: no se cobra lo que no está esperando pago, ni lo vencido, ni sin conexión", { skip }, async () => {
  const casos: Array<[string, Promise<string> | string, number, string]> = [
    ["pagado", pedido(A.id, { status: "PAID_ONLINE" }), 409, "notPending"],
    ["cancelado", pedido(A.id, { status: "CANCELLED" }), 409, "notPending"],
    ["vencido", pedido(A.id, { creado: new Date(Date.now() - 73 * 3600 * 1000) }), 409, "expired"],
    ["total que no cuadra", pedido(A.id, { total: 500 }), 409, "badOrder"],
    ["barbería sin MP", pedido(C.id), 404, "mpUnavailable"],
    ["no existe", "no-existe-este-pedido", 404, "notFound"],
  ];
  for (const [nombre, idP, status, code] of casos) {
    const r = await linkDe(await idP);
    assert.equal(r.status, status, nombre);
    assert.equal((await r.json()).code, code, nombre);
  }
  assert.equal(llamadas.length, 0, "ninguno llegó a Mercado Pago");
});

/* ═══════════════ 3. El webhook ═══════════════ */

const WH = "/api/barber/mercadopago/webhook";

test("webhook con importe distinto (o moneda distinta) → 200 y el pedido NO se marca", { skip }, async () => {
  const id = await pedido(A.id);
  pagoEn("tok-A", pagoAprobado("5001", id, 498.99));
  let r = await rutaWebhook.POST(aviso(WH, { pedido: id, cta: "777" }, "5001"));
  assert.equal(r.status, 200);
  assert.equal((await filaPedido(id)).status, "PENDING");
  pagoEn("tok-A", pagoAprobado("5002", id, 499, { currency_id: "USD" }));
  r = await rutaWebhook.POST(aviso(WH, { pedido: id, cta: "777" }, "5002"));
  assert.equal(r.status, 200);
  const f = await filaPedido(id);
  assert.equal(f.status, "PENDING");
  assert.equal(f.mp_payment_id, null);
  assert.equal(f.paid_at, null);
});

test("webhook correcto marca PAID_ONLINE con paid_at y mp_payment_id, y NO toca otra columna", { skip }, async () => {
  const id = await pedido(A2.id);
  const antes = await filaPedido(id);
  pagoEn("tok-A", pagoAprobado("5100", id));
  const r = await rutaWebhook.POST(aviso(WH, { pedido: id, cta: "777" }, "5100"));
  assert.equal(r.status, 200);
  const despues = await filaPedido(id);
  assert.equal(despues.status, "PAID_ONLINE");
  assert.equal(despues.mp_payment_id, "5100");
  assert.ok(despues.paid_at instanceof Date);
  for (const col of Object.keys(antes)) {
    if (["status", "mp_payment_id", "paid_at"].includes(col)) continue;
    assert.deepEqual(despues[col], antes[col], `columna ${col} intacta`);
  }
  const consulta = llamadas.find((l) => l.url.includes("/v1/payments/5100"))!;
  assert.equal(consulta.auth, "Bearer tok-A", "el pago se relee con el token de la barbería");
});

test("el mismo aviso repetido (y 8 a la vez) marca UNA sola vez", { skip }, async () => {
  const id = await pedido(A.id);
  pagoEn("tok-A", pagoAprobado("5200", id));
  await rutaWebhook.POST(aviso(WH, { pedido: id, cta: "777" }, "5200"));
  const primero = await filaPedido(id);
  const r = await rutaWebhook.POST(aviso(WH, { pedido: id, cta: "777" }, "5200"));
  assert.equal(r.status, 200);
  const segundo = await filaPedido(id);
  assert.equal(segundo.paid_at.getTime(), primero.paid_at.getTime(), "paid_at no se reescribe");

  const id2 = await pedido(A.id);
  pagoEn("tok-A", pagoAprobado("5201", id2));
  const res = await Promise.all(Array.from({ length: 8 }, () => mp.aplicarPagoDePedido({ orderId: id2, paymentId: "5201", cuentaDelLink: "777" })));
  assert.equal(res.filter((x) => x.aplicado).length, 1, JSON.stringify(res));

  // Otro pago aprobado sobre un pedido ya pagado: no lo pisa.
  pagoEn("tok-A", pagoAprobado("5202", id2));
  await rutaWebhook.POST(aviso(WH, { pedido: id2, cta: "777" }, "5202"));
  assert.equal((await filaPedido(id2)).mp_payment_id, "5201");
});

test("barbería ajena → nada: un pago de OTRA cuenta no marca un pedido de A", { skip }, async () => {
  const idA = await pedido(A.id);
  // B cobra en SU cuenta con la referencia del pedido de A (lo que haría un abusón).
  pagoEn("tok-B", pagoAprobado("5300", idA, 499, { collector_id: 888 }));
  let r = await rutaWebhook.POST(aviso(WH, { pedido: idA, cta: "777" }, "5300"));
  assert.equal(r.status, 200);
  assert.equal((await filaPedido(idA)).status, "PENDING", "con el token de A ese pago no existe");

  // Un pago real del pedido de B mandado con ?pedido= de A.
  const idB = await pedido(B.id);
  pagoEn("tok-A", pagoAprobado("5301", idB));
  r = await rutaWebhook.POST(aviso(WH, { pedido: idA, cta: "777" }, "5301"));
  assert.equal(r.status, 200);
  assert.equal((await filaPedido(idA)).status, "PENDING", "la referencia no es la del pedido");
  assert.equal((await filaPedido(idB)).status, "PENDING", "y el de B tampoco se toca desde aquí");
});

test("pedido vencido, cancelado o entregado: el pago no lo revive ni lo toca", { skip }, async () => {
  for (const status of ["EXPIRED", "CANCELLED", "PICKED_UP"]) {
    const id = await pedido(A.id, { status });
    const pid = String(5400 + status.length);
    pagoEn("tok-A", pagoAprobado(pid, id));
    const r = await rutaWebhook.POST(aviso(WH, { pedido: id, cta: "777" }, pid));
    assert.equal(r.status, 200);
    const f = await filaPedido(id);
    assert.equal(f.status, status);
    assert.equal(f.mp_payment_id, null);
  }
});

test("firma: sin firma o mal firmada → 401; sin secreto → 503; nada se consulta", { skip }, async () => {
  const id = await pedido(A.id);
  pagoEn("tok-A", pagoAprobado("5500", id));
  assert.equal((await rutaWebhook.POST(aviso(WH, { pedido: id }, "5500", { firma: null }))).status, 401);
  assert.equal((await rutaWebhook.POST(aviso(WH, { pedido: id }, "5500", { firma: firmar("5500", "otro", "secreto-falso") }))).status, 401);
  try {
    delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
    assert.equal((await rutaWebhook.POST(aviso(WH, { pedido: id }, "5500"))).status, 503);
  } finally {
    process.env.MERCADOPAGO_WEBHOOK_SECRET = SECRETO;
  }
  assert.equal(llamadas.length, 0);
  assert.equal((await filaPedido(id)).status, "PENDING");
});

test("lo que no es de barber → 200 sin hacer nada (sin ?pedido=, otro tipo, pedido inexistente)", { skip }, async () => {
  assert.equal((await rutaWebhook.POST(aviso(WH, { ref: "factura:abc" }, "5600"))).status, 200);
  const otroTipo = aviso(WH, { pedido: "x" }, "5601");
  const u = new URL(otroTipo.url);
  u.searchParams.set("type", "merchant_order");
  const req = new NextRequest(u, { method: "POST", headers: otroTipo.headers, body: JSON.stringify({ data: { id: "5601" } }) });
  assert.equal((await rutaWebhook.POST(req)).status, 200);
  assert.equal((await rutaWebhook.POST(aviso(WH, { pedido: "no-existe" }, "5602"))).status, 200);
  assert.equal(llamadas.length, 0, "ni siquiera se consultó a Mercado Pago");
});

test("la barbería conectó OTRA cuenta después de mandar el link → 500 (MP reintenta), no se pierde", { skip }, async () => {
  const id = await pedido(A.id);
  pagoEn("tok-A", pagoAprobado("5700", id));
  const r = await rutaWebhook.POST(aviso(WH, { pedido: id, cta: "999" }, "5700"));
  assert.equal(r.status, 500);
  assert.equal((await filaPedido(id)).status, "PENDING");
  // MP reintenta con la cuenta correcta: entra.
  assert.equal((await rutaWebhook.POST(aviso(WH, { pedido: id, cta: "777" }, "5700"))).status, 200);
  assert.equal((await filaPedido(id)).status, "PAID_ONLINE");
});

test("un pedido LISTO sin pagar que se paga en línea queda pagado y sigue LISTO", { skip }, async () => {
  const id = await pedido(A.id, { status: "READY" });
  pagoEn("tok-A", pagoAprobado("5800", id));
  await rutaWebhook.POST(aviso(WH, { pedido: id, cta: "777" }, "5800"));
  const f = await filaPedido(id);
  assert.equal(f.status, "READY");
  assert.equal(f.mp_payment_id, "5800");
  assert.ok(f.paid_at);
});

/* ═══════════════ El webhook del DENTAL no cambia ═══════════════ */

test("webhook del DENTAL: un aviso de un pago de barber → 200 y no hace nada", { skip }, async () => {
  const id = await pedido(A.id);
  pagoEn("tok-A", pagoAprobado("5900", id));
  // Como llegaría por la URL de «Tus integraciones» (sin ref) y con la query de barber.
  for (const query of [{}, { pedido: id, cta: "777" }]) {
    const r = await webhookDental.POST(aviso("/api/webhooks/mercadopago", query as Record<string, string>, "5900"));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { received: true });
  }
  assert.equal(llamadas.length, 0, "el dental no consulta nada");
  assert.equal((await filaPedido(id)).status, "PENDING", "ni marca el pedido");
});

/* ═══════════════ El SQL todavía sin pegar ═══════════════ */

test("sin sql/barber_mercadopago.sql: estado «falta SQL», la tienda no ofrece pagar, nada truena", { skip }, async () => {
  const id = await pedido(A.id);
  await prisma.$executeRawUnsafe(`ALTER TABLE barber_mercadopago_accounts RENAME TO barber_mercadopago_accounts_${RUN}`);
  try {
    const e = await mp.estadoCuentaMp(A.id);
    assert.equal(e.storageReady, false);
    assert.equal(e.connected, false);
    assert.equal(await mp.tiendaAceptaMercadoPago(A.id), false);
    const r = await linkDe(id);
    assert.equal(r.status, 404);
    assert.equal((await r.json()).code, "mpUnavailable");
    sesion = DUENO_A;
    assert.equal((await rutaDesconectar.POST()).status, 200);
  } finally {
    await prisma.$executeRawUnsafe(`ALTER TABLE barber_mercadopago_accounts_${RUN} RENAME TO barber_mercadopago_accounts`);
  }
  assert.equal((await mp.estadoCuentaMp(A.id)).connected, true, "la conexión sigue ahí al volver la tabla");
});

test("sin la tabla de pedidos de la tienda: el link responde 404 y el webhook 200", { skip }, async () => {
  await prisma.$executeRawUnsafe(`ALTER TABLE barber_product_orders RENAME TO barber_product_orders_${RUN}`);
  try {
    const r = await linkDe("cualquiera");
    assert.equal(r.status, 404);
    assert.equal((await r.json()).code, "notFound");
    assert.equal((await rutaWebhook.POST(aviso(WH, { pedido: "cualquiera" }, "6000"))).status, 200);
  } finally {
    await prisma.$executeRawUnsafe(`ALTER TABLE barber_product_orders_${RUN} RENAME TO barber_product_orders`);
  }
});
