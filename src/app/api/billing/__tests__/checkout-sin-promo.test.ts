/**
 * ENLACES DE CONTRATACIÓN SIN LA PROMO DEL PRIMER MES (pedido de Rafael, 5-oct-2026) — ws1-t5.
 * Encargo 7: el enlace arranca en ANUAL (35 %) y se puede pasar a MENSUAL; ninguno lleva la promo.
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
  aplicaPromoPrimerMes, cuentasDelEnlace, esSlugReservadoDeContratar, lineasDelEnlace, PERIODO_INICIAL_DEL_ENLACE,
  planDeCookieContratar, planDeRuta, planDelEnlaceDeAlta, RUTA_DE_PLAN,
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

test("encargo 7 · CON la marca y ANUAL (lo de entrada): Clínica $11,614 + IVA al año = $13,472.24, tarjeta, sin cupón", async () => {
  marcaSinPromo = "CLINIC";
  const { res } = await pagar({ plan: "CLINIC", method: "card", billing: "annual" });
  assert.equal(res.status, 200);
  const s = sesiones[0];
  assert.equal(cupones.length, 0);
  assert.equal(s.discounts, undefined);
  assert.equal(s.mode, "subscription");
  assert.deepEqual(s.payment_method_types, ["card"]);
  assert.equal(s.line_items[0].price_data.unit_amount, 1161400, "el precio anual de plan_configs");
  assert.equal(s.line_items[0].price_data.recurring.interval, "year");
  assert.deepEqual(s.line_items[0].tax_rates, [TASA], "IVA 16 % aparte");
  const d = desgloseConIva(1161400);
  assert.deepEqual([d.subtotalCents, d.ivaCents, d.totalCents], [1161400, 185824, 1347224]);
  assert.equal(s.metadata.billing, "annual");
  assert.equal(s.metadata.sinPromo, "1");
});

test("CON la marca y MENSUAL: Clínica $1,489 + IVA = $1,727.24 al mes, sin cupón ni `discounts` (la promo no vuelve)", async () => {
  marcaSinPromo = "CLINIC";
  const { res } = await pagar({ plan: "CLINIC", method: "card", billing: "monthly" });
  assert.equal(res.status, 200);
  const s = sesiones[0];
  assert.equal(cupones.length, 0);
  assert.equal(s.discounts, undefined);
  assert.equal(s.line_items[0].price_data.unit_amount, 148900);
  assert.equal(s.line_items[0].price_data.recurring.interval, "month");
  assert.deepEqual(s.line_items[0].tax_rates, [TASA]);
  const d = desgloseConIva(148900);
  assert.deepEqual([d.subtotalCents, d.ivaCents, d.totalCents], [148900, 23824, 172724]);
  assert.equal(s.metadata.firstMonthPromo, "0");
  assert.equal(s.metadata.sinPromo, "1");
});

test("petición manipulada (otro plan, OXXO, otra clínica, un importe inventado): el plan del enlace, con tarjeta, al precio de plan_configs del periodo elegido", async () => {
  marcaSinPromo = "CLINIC";
  const { res } = await pagar({ plan: "BASIC", method: "oxxo", billing: "annual", clinicId: "otra", sinPromo: false, amount: 1, unitAmount: 100, priceMxnAnnual: 1 });
  assert.equal(res.status, 200);
  const s = sesiones[0];
  assert.equal(consultasMarca[0].clinicId, "cA", "la marca se lee con la clínica de la SESIÓN");
  assert.equal(s.mode, "subscription");
  assert.deepEqual(s.payment_method_types, ["card"]);
  assert.equal(s.line_items[0].price_data.unit_amount, 1161400, "Clínica anual, no Básico ni el importe del body");
  assert.equal(s.line_items[0].price_data.recurring.interval, "year");
  assert.equal(cupones.length, 0);
  assert.equal(s.metadata.plan, "CLINIC");
  assert.equal(s.metadata.method, "card");
});

test("un periodo que no existe no se cuela: 400 y sin sesión", async () => {
  marcaSinPromo = "CLINIC";
  const { res } = await pagar({ plan: "CLINIC", method: "card", billing: "weekly" });
  assert.equal(res.status, 400);
  assert.equal(sesiones.length, 0);
});

test("los TRES enlaces, en los dos periodos: precio de lista de plan_configs + IVA y sin cupón, pida el body el plan que pida", async () => {
  const esperado = { BASIC: [41900, 326400], PRO: [68900, 537600], CLINIC: [148900, 1161400] } as const;
  for (const plan of ["BASIC", "PRO", "CLINIC"] as const) {
    for (const [i, billing] of (["monthly", "annual"] as const).entries()) {
      sesiones = []; cupones = []; consultasMarca = []; marcaSinPromo = plan;
      await pagar({ plan: plan === "PRO" ? "CLINIC" : "PRO", method: "card", billing });
      const s = sesiones[0];
      assert.equal(cupones.length, 0, `${plan} ${billing}`);
      assert.equal(s.line_items[0].price_data.unit_amount, esperado[plan][i], `${plan} ${billing}`);
      assert.equal(s.line_items[0].price_data.recurring.interval, billing === "annual" ? "year" : "month");
      assert.deepEqual(s.line_items[0].tax_rates, [TASA]);
      assert.equal(s.metadata.plan, plan);
    }
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

/* ── las cuentas que enseñan las pantallas (con números) ───────────────── */

test("encargo 7 · las cuentas del enlace con los precios de plan_configs: anual con su 35 %, lo que equivale al mes y el ahorro contra 12 meses; IVA desglosado", () => {
  const CL = { priceMxn: 1489, priceMxnAnnual: 11614 };
  const a = cuentasDelEnlace(CL, "annual");
  assert.deepEqual(
    [a.subtotalCents, a.ivaCents, a.totalCents, a.equivaleMesCents, a.equivaleMesConIvaCents, a.doceMesesCents, a.ahorroCents, a.pctAhorro],
    [1161400, 185824, 1347224, 96783, 112269, 1786800, 625400, 35],
  );
  assert.deepEqual(lineasDelEnlace(a, CL), {
    titulo: "Pago anual: $11,614.00 + IVA $1,858.24 = $13,472.24 al año",
    detalle: [
      "Equivale a $967.83 al mes + IVA ($1,122.69 con IVA)",
      "Ahorras $6,254.00 (35%) contra 12 meses de $1,489.00 ($17,868.00)",
    ],
  });
  const m = cuentasDelEnlace(CL, "monthly");
  assert.deepEqual([m.subtotalCents, m.ivaCents, m.totalCents, m.ahorroCents], [148900, 23824, 172724, null]);
  assert.equal(lineasDelEnlace(m, CL).titulo, "Pago mensual: $1,489.00 + IVA $238.24 = $1,727.24 al mes");
  // Básico y Profesional.
  assert.equal(lineasDelEnlace(cuentasDelEnlace({ priceMxn: 419, priceMxnAnnual: 3264 }, "annual"), { priceMxn: 419 }).titulo, "Pago anual: $3,264.00 + IVA $522.24 = $3,786.24 al año");
  assert.equal(lineasDelEnlace(cuentasDelEnlace({ priceMxn: 689, priceMxnAnnual: 5376 }, "annual"), { priceMxn: 689 }).detalle[1], "Ahorras $2,892.00 (35%) contra 12 meses de $689.00 ($8,268.00)");
  assert.equal(PERIODO_INICIAL_DEL_ENLACE, "annual");
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

test("alta: el plan del enlace se impone (el periodo es el elegido) y la marca queda en el servidor; «contratar» no choca con [slug]", () => {
  assert.ok(leer("src/app/contratar/[plan]/page.tsx").includes("<SignupForm planDeEnlace={plan} />"));
  assert.equal(esSlugReservadoDeContratar("contratar"), true);
  for (const f of ["src/app/api/auth/register/route.ts", "src/app/api/auth/register-oauth/route.ts"]) {
    const r = leer(f);
    assert.match(r, /esSlugReservadoDeContratar\(base\) \? `\$\{base\}-1` : base/, f);
    assert.match(r, /const planDelEnlace = planDelEnlaceDeAlta\(data, req\.cookies\.get\(COOKIE_CONTRATAR\)\?\.value\);\s*if \(planDelEnlace\) \{\s*data\.plan = planDelEnlace;\s*\}/, f);
    assert.doesNotMatch(r, /data\.billing = "monthly"/, `${f}: ya no fuerza mensual`);
    assert.match(r, /await marcarEnlaceDeContratacion\(\{ clinicId: clinic\.id, userId: duenio\.id, plan: planDelEnlace/, f);
    assert.match(r, /if \(planDelEnlace\) respuesta\.cookies\.delete\(COOKIE_CONTRATAR\);/, f);
  }
  assert.match(leer("src/app/api/check-slug/route.ts"), /"contratar"\]/);
  assert.match(leer("src/app/api/billing/checkout/route.ts"), /const method = enlace \? "card" : parsed\.data\.method;\s*const billing = parsed\.data\.billing;/);
});

test("encargo 7 · pantallas: el registro y la de pago arrancan en ANUAL, dejan pasar a MENSUAL y enseñan el desglose; solo el plan del enlace, con tarjeta y sin la promo", () => {
  const f = leer("src/components/public/auth/signup/signup-form.tsx");
  assert.match(f, /const initialBilling: Billing = planDeEnlace\s*\? PERIODO_INICIAL_DEL_ENLACE/);
  assert.match(f, /setForm\(\(prev\) => \(\{ \.\.\.prev, plan, billing: PERIODO_INICIAL_DEL_ENLACE \}\)\)/);
  assert.match(f, /\.\.\.\(sinPromo \? \{ sinPromo: true \} : \{\}\)/);
  assert.match(f, /soloEstePlan=\{planDelEnlace !== null\}/);
  const p3 = leer("src/components/public/auth/signup/step-3-plan-payment.tsx");
  assert.match(p3, /\{!soloEstePlan && \(\s*<button type="button" className="dca-resumen__cambiar"/);
  assert.match(p3, /className="dca-periodo" role="radiogroup" aria-label="Periodo de pago"/);
  assert.match(p3, /onClick=\{\(\) => onChange\(\{ billing: b \}\)\}/);
  assert.match(p3, /data-desglose-enlace/);
  const pag = leer("src/app/dashboard/suspended/page.tsx");
  assert.match(pag, /const firstMonthEligible = isFirstContract\(clinic\) && enlace === null;/);
  assert.match(pag, /const planesAMostrar = enlace \? planCards\.filter\(\(p\) => p\.id === enlace\.plan\) : planCards;/);
  assert.equal((pag.match(/soloTarjeta=\{enlace !== null\}/g) ?? []).length, 2, "las dos vistas");
  const cli = leer("src/app/dashboard/suspended/suspended-client.tsx");
  assert.match(cli, /useState<Billing>\(soloTarjeta \? PERIODO_INICIAL_DEL_ENLACE : "monthly"\)/, "arranca en anual");
  assert.match(cli, /\{\/\* === Toggle Mensual \/ Anual === \*\/\}\s*<div className="mb-7 flex flex-wrap/, "el conmutador se ve");
  assert.match(cli, /const methods: Array<\{ id: PayMethod; label: string \}> = soloTarjeta \? \[\{ id: "card"/, "solo tarjeta");
  assert.match(cli, /const recommendedPlan: PlanId \| null = soloTarjeta \? null/, "sin upsell");
  assert.match(cli, /data-desglose-enlace/);
  const red = leer("src/components/dashboard/cuenta-rediseno/planes-suspendida.tsx");
  assert.match(red, /\{!v\.soloTarjeta && \(\s*<button type="button" className=\{s\.cambiarPlan\}/, "sin «Cambiar plan»");
  assert.match(red, /\{\/\* === Ciclo: mensual \/ anual === \*\/\}\s*<div className=\{s\.cicloFila\}>/, "el conmutador se ve");
  assert.match(red, /v\.soloTarjeta\s*\? lineasDelEnlace\(cuentasDelEnlace\(plan, anual \? "annual" : "monthly"\), plan\)\.detalle\.join/);
});
