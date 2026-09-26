/**
 * CAMBIO DE PLAN CON IVA — change-plan y su vista previa DE VERDAD (ws1-t3, ajuste 1b).
 *
 * Run: npm run test:iva-cobro
 *
 * Handlers reales de POST /api/billing/change-plan y POST /api/billing/change-plan/preview con un
 * Stripe SIMULADO (⛔ nada contra Stripe real) y un doble de prisma:
 *   · el diferencial de una clínica SIN tarjeta lleva IVA 16 % (misma tasa manual, desglosado), para
 *     TODAS — también las registradas antes del corte —, y la vista previa enseña el mismo total;
 *   · sin IVA configurado NO se cobra el diferencial sin IVA (503, cero sesiones);
 *   · la clave de idempotencia cambia (las sesiones viejas sin IVA no chocan);
 *   · una clínica CON suscripción de tarjeta viva NO se toca: mismos parámetros de siempre en
 *     `prices.create` y `subscriptions.update`, sin tasas ni sesión nueva.
 */
import Module from "node:module";
import path from "node:path";
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { desgloseConIva } from "@/lib/billing/iva-cobro";

const RAIZ = path.resolve(__dirname, "../../../../..");
const TASA = "txr_1PabcdefghijklmnOP";

let sesiones: any[];
let opcionesSesion: any[];
let clientesCreados: number;
let llamadasTarjeta: { prices: any[]; updates: any[] };
let auditorias: any[];
let clinica: any;

const PLANES: Record<string, any> = {
  BASIC: { id: "BASIC", name: "Básico", priceMxn: 419, priceMxnAnnual: 3264 },
  PRO: { id: "PRO", name: "Profesional", priceMxn: 689, priceMxnAnnual: 5376 },
  CLINIC: { id: "CLINIC", name: "Clínica", priceMxn: 1719, priceMxnAnnual: 13404 },
};

const stripeDoble: any = {
  customers: { create: async () => { clientesCreados++; return { id: "cus_falso" }; } },
  checkout: {
    sessions: {
      create: async (p: any, o: any) => {
        sesiones.push(p);
        opcionesSesion.push(o);
        return { id: "cs_falso", url: "https://checkout.stripe.test/cs_falso" };
      },
    },
  },
  subscriptions: {
    retrieve: async () => ({
      status: "active",
      metadata: {},
      items: { data: [{ id: "si_1", price: { unit_amount: 41900, currency: "mxn", recurring: { interval: "month" } } }] },
    }),
    update: async (id: string, p: any) => { llamadasTarjeta.updates.push({ id, p }); return { status: "active" }; },
  },
  prices: { create: async (p: any) => { llamadasTarjeta.prices.push(p); return { id: "price_nuevo" }; } },
};

const prismaDoble: any = {
  clinic: {
    findUnique: async () => clinica,
    update: async ({ data }: any) => Object.assign(clinica, data),
  },
  auditLog: { findMany: async () => [] },
};

const dobles = new Map<string, unknown>();
type M = typeof Module & {
  _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (req: string, parent: unknown, isMain: boolean) => string;
};
const Mod = Module as M;
const cargaOriginal = Mod._load;
Mod._load = function (req, parent, isMain) {
  if (req === "server-only" || req === "client-only") return {};
  let resuelto: string | null = null;
  try {
    resuelto = Mod._resolveFilename(req, parent, isMain);
  } catch {
    resuelto = null;
  }
  if (resuelto && dobles.has(resuelto)) return dobles.get(resuelto);
  return cargaOriginal.call(this, req, parent, isMain);
};

let POST: (req: any) => Promise<Response>;
let PREVIEW: (req: any) => Promise<Response>;

before(async () => {
  dobles.set(path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prismaDoble });
  dobles.set(path.join(RAIZ, "src/lib/auth.ts"), {
    getCurrentUser: async () => ({ id: "u1", role: "SUPER_ADMIN", email: "u@ejemplo.mx", clinicId: "cA" }),
  });
  dobles.set(path.join(RAIZ, "src/lib/stripe.ts"), {
    getStripeSafe: () => stripeDoble,
    stripeUnavailableResponse: () => ({ error: "Stripe no configurado" }),
  });
  dobles.set(path.join(RAIZ, "src/lib/plans.ts"), {
    getResolvedPlan: async (id: string) => PLANES[id] ?? PLANES.PRO,
    getPlanLimits: async () => ({ aiTokensDefault: 1000 }),
  });
  dobles.set(path.join(RAIZ, "src/lib/audit.ts"), {
    logAudit: async (a: any) => { auditorias.push(a); },
    extractAuditMeta: () => ({ ipAddress: "10.0.0.1", userAgent: "prueba" }),
  });
  ({ POST } = await import("@/app/api/billing/change-plan/route"));
  ({ POST: PREVIEW } = await import("@/app/api/billing/change-plan/preview/route"));
});

const ENV_ANTES = { ...process.env };
beforeEach(() => {
  sesiones = [];
  opcionesSesion = [];
  clientesCreados = 0;
  llamadasTarjeta = { prices: [], updates: [] };
  auditorias = [];
  const enQuinceDias = new Date(Date.now() + 15 * 86_400_000);
  // Clínica que pagó a mano (OXXO/SPEI), sin suscripción de tarjeta, con 15 días de periodo por delante.
  clinica = {
    id: "cA", name: "Clínica A", email: "a@ejemplo.mx", plan: "BASIC", subscriptionStatus: "active",
    trialEndsAt: enQuinceDias, nextBillingDate: enQuinceDias, stripeCustomerId: "cus_a", stripeSubscriptionId: null,
    createdAt: new Date("2026-10-05"),
  };
  delete process.env.STRIPE_AUTOMATIC_TAX;
  process.env.STRIPE_IVA_TAX_RATE_ID = TASA;
  process.env.NEXT_PUBLIC_APP_URL = "https://app.test";
});
test.after?.(() => { process.env = ENV_ANTES; });

const pedir = (fn: (r: any) => Promise<Response>, body: object) =>
  fn({ json: async () => body, url: "https://app.test/api/billing/change-plan", headers: new Headers() });

async function subir(body: object = { plan: "PRO", method: "oxxo" }) {
  const res = await pedir(POST, body);
  return { res, json: (await res.json().catch(() => ({}))) as any };
}

test("subir de plan SIN tarjeta: el diferencial lleva la tasa de IVA y el desglose cuadra", async () => {
  const { res, json } = await subir();
  assert.equal(res.status, 200);
  assert.equal(json.mode, "checkout");
  assert.equal(sesiones.length, 1);
  const s = sesiones[0];
  assert.equal(s.mode, "payment");
  assert.deepEqual(s.line_items[0].tax_rates, [TASA]);
  const subtotal = s.line_items[0].price_data.unit_amount;
  assert.ok(subtotal >= 1000, "el diferencial (subtotal) es el de siempre");
  const d = desgloseConIva(subtotal);
  assert.equal(json.amountMxn, d.subtotalCents / 100);
  assert.equal(json.ivaMxn, d.ivaCents / 100);
  assert.equal(json.totalMxn, d.totalCents / 100);
  assert.ok(d.ivaCents > 0);
  const a = auditorias.find((x) => x.entityType === "subscription" && x.action === "create");
  assert.equal(a.changes._created.after.ivaModo, "tasa");
  assert.equal(a.changes._created.after.billing, undefined, "no se graba `billing`: no es una compra (ver el comentario de la ruta)");
});

test("TODAS llevan IVA en el diferencial, también una clínica registrada antes del corte", async () => {
  clinica.createdAt = new Date("2025-11-03");
  await subir();
  assert.deepEqual(sesiones[0].line_items[0].tax_rates, [TASA]);
});

test("la clave de idempotencia lleva `:iva16` (las sesiones viejas sin IVA no chocan)", async () => {
  await subir();
  assert.match(opcionesSesion[0].idempotencyKey, /:oxxo:iva16$/);
});

test("sin IVA configurado: 503, cero sesiones y ni siquiera se crea el cliente de Stripe", async () => {
  delete process.env.STRIPE_IVA_TAX_RATE_ID;
  clinica.stripeCustomerId = null;
  const { res, json } = await subir();
  assert.equal(res.status, 503);
  assert.equal(json.code, "IVA_NO_CONFIGURADO");
  assert.equal(sesiones.length, 0);
  assert.equal(clientesCreados, 0);
});

test("con Stripe Tax en el futuro: `automatic_tax` y no la tasa manual", async () => {
  process.env.STRIPE_AUTOMATIC_TAX = "true";
  await subir();
  assert.deepEqual(sesiones[0].automatic_tax, { enabled: true });
  assert.equal(sesiones[0].line_items[0].tax_rates, undefined);
});

test("la vista previa enseña lo mismo que se va a cobrar: subtotal + «IVA 16 %» = total", async () => {
  const res = await pedir(PREVIEW, { plan: "PRO" });
  const p = (await res.json()) as any;
  assert.equal(p.mode, "manual");
  assert.equal(p.lines.length, 2);
  assert.match(p.lines[0].description, /Diferencia al plan Profesional/);
  assert.equal(p.lines[1].description, "IVA 16 %");
  const sub = Math.round(p.lines[0].amount * 100);
  const d = desgloseConIva(sub);
  assert.equal(Math.round(p.lines[1].amount * 100), d.ivaCents);
  assert.equal(Math.round(p.amountDueNow * 100), d.totalCents, "amountDueNow es el TOTAL con IVA");
  // …y es exactamente lo que cobra el POST.
  await subir();
  assert.equal(sesiones[0].line_items[0].price_data.unit_amount, sub);
});

test("vista previa sin cobro (bajar de plan, o aún sin pagar): sin líneas ni IVA", async () => {
  clinica.plan = "PRO";
  const res = await pedir(PREVIEW, { plan: "BASIC" });
  const p = (await res.json()) as any;
  assert.equal(p.amountDueNow, 0);
  assert.deepEqual(p.lines, []);
  clinica.subscriptionStatus = "pending_payment";
  clinica.plan = "BASIC";
  const sinPagar = (await (await pedir(PREVIEW, { plan: "PRO" })).json()) as any;
  assert.equal(sinPagar.mode, "in-place");
  assert.equal(sinPagar.amountDueNow, 0);
});

test("clínica con suscripción de TARJETA viva: change-plan NO se toca (mismos parámetros, sin tasas, sin sesión)", async () => {
  clinica.stripeSubscriptionId = "sub_viva";
  delete process.env.STRIPE_IVA_TAX_RATE_ID; // ni siquiera necesita el env
  const { res } = await subir({ plan: "PRO" });
  assert.equal(res.status, 200);
  assert.equal(sesiones.length, 0, "ninguna sesión nueva de cobro");
  assert.equal(llamadasTarjeta.prices.length, 1);
  assert.deepEqual(Object.keys(llamadasTarjeta.prices[0]).sort(), ["currency", "product_data", "recurring", "unit_amount"]);
  assert.equal(llamadasTarjeta.updates.length, 1);
  const u = llamadasTarjeta.updates[0];
  assert.equal(u.id, "sub_viva");
  assert.deepEqual(u.p.items, [{ id: "si_1", price: "price_nuevo" }], "solo cambia el price del item; nada de tax_rates");
  assert.equal(u.p.proration_behavior, "always_invoice");
  assert.equal(JSON.stringify(u.p).includes("tax"), false);
});
