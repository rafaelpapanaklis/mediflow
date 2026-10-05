/**
 * ENLACES DE CONTRATACIÓN SIN LA PROMO DEL PRIMER MES (pedido de Rafael, 5-oct-2026) — ws1-t5.
 *
 * Run: npm run test:contratar-sin-promo
 *
 * dalecontrol.com/contratar/basico · /profesional · /clinica: el registro de ese plan, mensual,
 * y desde el primer cobro el precio de lista + IVA, SIN el cupón de $19/$29/$39. Se ejecuta el
 * handler REAL de POST /api/billing/checkout con un Stripe SIMULADO (⛔ nada sale contra
 * Stripe) y un doble de prisma; la marca es la fila de la bitácora que deja el alta.
 */
import Module from "node:module";
import path from "node:path";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { desgloseConIva } from "@/lib/billing/iva-cobro";
import {
  aplicaPromoPrimerMes, esSlugReservadoDeContratar, planDeCookieContratar, planDeRuta, planDelEnlaceDeAlta, RUTA_DE_PLAN,
} from "@/lib/billing/contratar";

const RAIZ = path.resolve(__dirname, "../../../../..");
const TASA = "txr_1PabcdefghijklmnOP";

/* ── doble de Stripe ───────────────────────────────────────────────────── */
let sesiones: any[];
let cupones: any[];
let llamadasProhibidas: string[];
let suscripcionViva: any;

const stripeDoble: any = {
  customers: { create: async () => ({ id: "cus_falso" }) },
  checkout: {
    sessions: {
      create: async (p: any) => {
        sesiones.push(p);
        return { id: "cs_falso", url: "https://checkout.stripe.test/cs_falso" };
      },
    },
  },
  subscriptions: {
    retrieve: async () => suscripcionViva,
    update: async () => { llamadasProhibidas.push("subscriptions.update"); return {}; },
    cancel: async () => { llamadasProhibidas.push("subscriptions.cancel"); return {}; },
    create: async () => { llamadasProhibidas.push("subscriptions.create"); return {}; },
  },
  billingPortal: { sessions: { create: async () => ({ url: "https://portal.stripe.test/x" }) } },
  coupons: {
    retrieve: async () => { const e: any = new Error("no existe"); e.statusCode = 404; throw e; },
    create: async (c: any) => { cupones.push(c); return c; },
  },
  taxRates: { create: async () => { llamadasProhibidas.push("taxRates.create"); return {}; } },
};

/* ── doble de prisma y de las dependencias ─────────────────────────────── */
let clinica: any;
let auditorias: any[];
const PLANES: Record<string, any> = {
  BASIC: { id: "BASIC", name: "Básico", priceMxn: 419, priceMxnMonthly: 419, priceMxnAnnual: 3264 },
  PRO: { id: "PRO", name: "Profesional", priceMxn: 689, priceMxnMonthly: 689, priceMxnAnnual: 5376 },
  CLINIC: { id: "CLINIC", name: "Clínica", priceMxn: 1489, priceMxnMonthly: 1489, priceMxnAnnual: 11614 },
};

let facturasStripe: any[];
let consultasFacturas: any[];
/** El plan del enlace que dejó el alta en la bitácora; false = sin marca; "falla" = la base no responde. */
let marcaSinPromo: "BASIC" | "PRO" | "CLINIC" | false | "falla";
let consultasMarca: any[];
const prismaDoble: any = {
  auditLog: {
    findFirst: async ({ where }: any) => {
      consultasMarca.push(where);
      if (marcaSinPromo === "falla") throw new Error("base caída");
      const coincide = where.clinicId === "cA" && where.entityType === "clinic" && where.entityId === "cA" && where.action === "update"
        && JSON.stringify(where.changes) === JSON.stringify({ path: ["promoPrimerMes", "after"], equals: "no" });
      return marcaSinPromo && coincide
        ? { changes: { promoPrimerMes: { before: "sí", after: "no" }, planDelEnlace: { before: null, after: marcaSinPromo } } }
        : null;
    },
  },
  clinic: {
    findUnique: async () => clinica,
    update: async ({ data }: any) => Object.assign(clinica, data),
  },
  subscriptionInvoice: {
    findFirst: async ({ where }: any) => {
      consultasFacturas.push(where);
      return facturasStripe.find((f) => f.clinicId === where.clinicId && f.method === where.method && f.status === where.status) ?? null;
    },
  },
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

before(async () => {
  dobles.set(path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prismaDoble });
  dobles.set(path.join(RAIZ, "src/lib/auth.ts"), {
    getCurrentUser: async () => ({ id: "u1", email: "u@ejemplo.mx", clinicId: "cA" }),
  });
  dobles.set(path.join(RAIZ, "src/lib/stripe.ts"), {
    getStripeSafe: () => stripeDoble,
    stripeUnavailableResponse: () => ({ error: "Stripe no configurado" }),
  });
  dobles.set(path.join(RAIZ, "src/lib/plans.ts"), { getResolvedPlan: async (id: string) => PLANES[id] });
  dobles.set(path.join(RAIZ, "src/lib/audit.ts"), {
    logAudit: async (a: any) => { auditorias.push(a); },
    extractAuditMeta: () => ({ ipAddress: "10.0.0.1", userAgent: "prueba" }),
  });
  ({ POST } = await import("@/app/api/billing/checkout/route"));
});

const ENV_ANTES = { ...process.env };
beforeEach(() => {
  sesiones = [];
  cupones = [];
  marcaSinPromo = false;
  consultasMarca = [];
  auditorias = [];
  llamadasProhibidas = [];
  suscripcionViva = null;
  facturasStripe = [];
  consultasFacturas = [];
  // Clínica NUEVA (registrada después del corte de IVA, 26-sep-2026): todo lleva IVA.
  clinica = {
    id: "cA", name: "Clínica A", email: "a@ejemplo.mx", stripeCustomerId: "cus_a", stripeSubscriptionId: null,
    subscriptionId: null, nextBillingDate: null, plan: "CLINIC", createdAt: new Date("2026-10-05"),
  };
  delete process.env.STRIPE_AUTOMATIC_TAX;
  process.env.STRIPE_IVA_TAX_RATE_ID = TASA;
  process.env.NEXT_PUBLIC_APP_URL = "https://app.test";
});
test.after?.(() => { process.env = ENV_ANTES; });

async function pagar(body: object) {
  const req: any = { json: async () => body, url: "https://app.test/api/billing/checkout", headers: new Headers() };
  const res = await POST(req);
  return { res, json: (await res.json().catch(() => ({}))) as any };
}


const leer = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");
void readdirSync; void statSync;

/* ── el checkout de verdad ─────────────────────────────────────────────── */

test("SIN la marca: el plan Clínica mensual con tarjeta lleva el cupón del primer mes, como siempre", async () => {
  const { res } = await pagar({ plan: "CLINIC", method: "card", billing: "monthly" });
  assert.equal(res.status, 200);
  assert.equal(cupones.length, 1);
  assert.deepEqual(sesiones[0].discounts, [{ coupon: cupones[0].id }]);
  assert.equal(sesiones[0].metadata.firstMonthPromo, "1");
});

test("CON la marca de /contratar/clinica: Clínica $1,489 + IVA desde el primer mes — ni cupón, ni `discounts`, mensual, tarjeta y la tasa de IVA de siempre", async () => {
  marcaSinPromo = "CLINIC";
  const { res } = await pagar({ plan: "CLINIC", method: "card", billing: "monthly" });
  assert.equal(res.status, 200);
  const s = sesiones[0];
  assert.equal(cupones.length, 0, "no se crea ni se pide ningún cupón");
  assert.equal(s.discounts, undefined, "la sesión va SIN descuento");
  assert.equal(s.mode, "subscription");
  assert.equal(s.line_items[0].price_data.unit_amount, 148900);
  assert.equal(s.line_items[0].price_data.recurring.interval, "month");
  assert.deepEqual(s.line_items[0].tax_rates, [TASA], "IVA 16 % aparte, como hoy");
  const d = desgloseConIva(148900);
  assert.deepEqual([d.subtotalCents, d.ivaCents, d.totalCents], [148900, 23824, 172724], "primer cobro: $1,489.00 + $238.24 = $1,727.24");
  assert.equal(s.metadata.firstMonthPromo, "0");
  assert.equal(s.metadata.sinPromo, "1");
  assert.equal(s.metadata.plan, "CLINIC");
});

test("petición manipulada (otro plan, OXXO, anual, otra clínica): el servidor cobra el plan del enlace, mensual, con tarjeta y sin promo", async () => {
  marcaSinPromo = "CLINIC";
  const { res } = await pagar({ plan: "BASIC", method: "oxxo", billing: "annual", clinicId: "otra", sinPromo: false });
  assert.equal(res.status, 200);
  const s = sesiones[0];
  assert.equal(consultasMarca[0].clinicId, "cA", "la marca se lee con la clínica de la SESIÓN");
  assert.equal(s.mode, "subscription");
  assert.deepEqual(s.payment_method_types, ["card"]);
  assert.equal(s.line_items[0].price_data.unit_amount, 148900, "Clínica, no Básico");
  assert.equal(s.line_items[0].price_data.recurring.interval, "month", "mensual, no anual");
  assert.equal(cupones.length, 0);
  assert.equal(s.metadata.plan, "CLINIC");
  assert.equal(s.metadata.billing, "monthly");
  assert.equal(s.metadata.method, "card");
});

test("los TRES enlaces: /contratar/basico $419, /profesional $689, /clinica $1,489 — + IVA y sin cupón, pida el body lo que pida", async () => {
  for (const [plan, centavos] of [["BASIC", 41900], ["PRO", 68900], ["CLINIC", 148900]] as const) {
    sesiones = []; cupones = []; consultasMarca = []; marcaSinPromo = plan;
    await pagar({ plan: plan === "PRO" ? "CLINIC" : "PRO", method: "card", billing: "monthly" });
    assert.equal(cupones.length, 0, plan);
    assert.equal(sesiones[0].line_items[0].price_data.unit_amount, centavos, plan);
    assert.deepEqual(sesiones[0].line_items[0].tax_rates, [TASA], plan);
    assert.equal(sesiones[0].metadata.plan, plan);
  }
});

test("la marca solo vale en la PRIMERA contratación: una reactivación sale como siempre (y ni se consulta)", async () => {
  marcaSinPromo = "CLINIC";
  clinica.nextBillingDate = new Date("2026-09-01");
  await pagar({ plan: "PRO", method: "oxxo", billing: "annual" });
  assert.equal(consultasMarca.length, 0);
  assert.deepEqual(sesiones[0].payment_method_types, ["oxxo"]);
  assert.equal(sesiones[0].line_items[0].price_data.unit_amount, 537600, "Profesional anual, lo que pidió");
});

test("si la bitácora no responde, el cobro sigue como siempre (no se cae el checkout de todas las altas)", async () => {
  marcaSinPromo = "falla";
  const { res } = await pagar({ plan: "CLINIC", method: "card", billing: "monthly" });
  assert.equal(res.status, 200);
  assert.equal(cupones.length, 1);
});

/* ── las piezas puras ──────────────────────────────────────────────────── */

test("rutas: los nombres de la portada (Básico, Profesional, Clínica), con o sin acento; «pro» también", () => {
  assert.equal(planDeRuta("basico"), "BASIC");
  assert.equal(planDeRuta("Básico"), "BASIC");
  assert.equal(planDeRuta("profesional"), "PRO");
  assert.equal(planDeRuta("pro"), "PRO");
  assert.equal(planDeRuta("clinica"), "CLINIC");
  assert.equal(planDeRuta("clínica"), "CLINIC");
  assert.equal(planDeRuta("gratis"), null);
  assert.equal(planDeRuta("constructor"), null, "nada del prototipo de Object");
  assert.deepEqual(RUTA_DE_PLAN, { BASIC: "/contratar/basico", PRO: "/contratar/profesional", CLINIC: "/contratar/clinica" });
});

test("el plan del enlace en el alta: manda la cookie (vuelta de Google incluida); sin cookie, el formulario del enlace; sin nada, alta normal", () => {
  assert.equal(planDelEnlaceDeAlta({ plan: "BASIC", sinPromo: true }, "CLINIC"), "CLINIC", "el body no cambia el plan de la cookie");
  assert.equal(planDelEnlaceDeAlta({ plan: "PRO" }, "CLINIC"), "CLINIC");
  assert.equal(planDelEnlaceDeAlta({ plan: "PRO", sinPromo: true }, undefined), "PRO");
  assert.equal(planDelEnlaceDeAlta({ plan: "PRO" }, undefined), null);
  assert.equal(planDelEnlaceDeAlta({ plan: "PRO", sinPromo: "true" }, "basura"), null, "solo un true de verdad o un plan válido");
  assert.equal(planDeCookieContratar("clinic"), "CLINIC");
  assert.equal(aplicaPromoPrimerMes({ method: "card", billing: "monthly", firstContract: true, sinPromo: false }), true);
  assert.equal(aplicaPromoPrimerMes({ method: "card", billing: "monthly", firstContract: true, sinPromo: true }), false);
});

test("alta: el plan del enlace se impone y la marca (con el plan) queda en el servidor; «contratar» no choca con [slug]", () => {
  assert.ok(leer("src/app/contratar/[plan]/page.tsx").includes("<SignupForm planDeEnlace={plan} />"));
  assert.equal(esSlugReservadoDeContratar("contratar"), true);
  for (const f of ["src/app/api/auth/register/route.ts", "src/app/api/auth/register-oauth/route.ts"]) {
    const r = leer(f);
    assert.match(r, /esSlugReservadoDeContratar\(base\) \? `\$\{base\}-1` : base/, f);
    assert.match(r, /const planDelEnlace = planDelEnlaceDeAlta\(data, req\.cookies\.get\(COOKIE_CONTRATAR\)\?\.value\);\s*if \(planDelEnlace\) \{\s*data\.plan = planDelEnlace;\s*data\.billing = "monthly";/, f);
    assert.match(r, /await marcarEnlaceDeContratacion\(\{ clinicId: clinic\.id, userId: duenio\.id, plan: planDelEnlace/, f);
    assert.match(r, /if \(planDelEnlace\) respuesta\.cookies\.delete\(COOKIE_CONTRATAR\);/, f);
  }
  assert.match(leer("src/app/api/check-slug/route.ts"), /"contratar"\]/);
});

test("pantallas: el registro y la de pago enseñan SOLO el plan del enlace, mensual y con tarjeta, sin la promo", () => {
  const pag = leer("src/app/dashboard/suspended/page.tsx");
  assert.match(pag, /const firstMonthEligible = isFirstContract\(clinic\) && enlace === null;/);
  assert.match(pag, /const planesAMostrar = enlace \? planCards\.filter\(\(p\) => p\.id === enlace\.plan\) : planCards;/);
  assert.equal((pag.match(/soloTarjetaMensual=\{enlace !== null\}/g) ?? []).length, 2, "las dos vistas");
  const cli = leer("src/app/dashboard/suspended/suspended-client.tsx");
  assert.match(cli, /\{!soloTarjetaMensual && \(\s*<div className="mb-7 flex flex-wrap/, "sin Mensual/Anual");
  assert.match(cli, /const methods: Array<\{ id: PayMethod; label: string \}> = soloTarjetaMensual \? \[\{ id: "card"/, "solo tarjeta");
  assert.match(cli, /const recommendedPlan: PlanId \| null = soloTarjetaMensual \? null/, "sin upsell");
  const red = leer("src/components/dashboard/cuenta-rediseno/planes-suspendida.tsx");
  assert.match(red, /\{!v\.soloTarjetaMensual && \(\s*<button type="button" className=\{s\.cambiarPlan\}/, "sin «Cambiar plan»");
  assert.match(red, /\{!v\.soloTarjetaMensual && \(\s*<div className=\{s\.cicloFila\}>/);
  const f = leer("src/components/public/auth/signup/signup-form.tsx");
  assert.match(f, /\.\.\.\(sinPromo \? \{ sinPromo: true \} : \{\}\)/);
  assert.match(f, /soloEstePlan=\{planDelEnlace !== null\}/);
  assert.match(leer("src/components/public/auth/signup/step-3-plan-payment.tsx"), /\{!soloEstePlan && \(\s*<button type="button" className="dca-resumen__cambiar"/);
});
