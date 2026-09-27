/**
 * ENLACES DE SUSCRIPCIÓN DEL ADMIN × EXENCIÓN DE IVA (ajuste 1 de la integración, decisión de Rafael:
 * «que siga la misma regla»).
 *
 * Run: npm run test:iva-cobro
 *
 * Los dos creadores de enlaces de /admin —`createCheckoutForSubscription` («Generar enlace» de
 * /admin/payments, vía /api/admin/billing/stripe) y POST /api/admin/stripe/create-subscription— siguen la
 * MISMA regla que el checkout de la clínica y el SPEI directo (`ivaParaPagoDeClinica` + `exencionIvaDeClinica`):
 *   · clínica creada ANTES del 26-sep-2026 y su MISMO plan → sin IVA, sin exigir STRIPE_IVA_TAX_RATE_ID;
 *   · clínica nueva, OTRO plan, o de antes que ya tuvo tarjeta y la canceló (reactivar) → con IVA;
 *   · con IVA y sin env → no se genera el enlace (nunca se cobra sin IVA en silencio).
 * Stripe y prisma simulados: ⛔ nada sale contra Stripe.
 */
import Module from "node:module";
import path from "node:path";
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const RAIZ = path.resolve(__dirname, "../../../../..");
const TASA = "txr_1PabcdefghijklmnOP";

let sesiones: any[];
let facturasStripe: any[];
let clinicaEnBase: any;

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
};

const PLANES: Record<string, any> = {
  PRO: { id: "PRO", name: "Profesional", priceMxn: 689, priceMxnMonthly: 689, priceMxnAnnual: 5376 },
  CLINIC: { id: "CLINIC", name: "Clínica", priceMxn: 1489, priceMxnMonthly: 1489, priceMxnAnnual: 11614 },
};

const prismaDoble: any = {
  clinic: {
    findUnique: async () => clinicaEnBase,
    update: async ({ data }: any) => Object.assign(clinicaEnBase, data),
  },
  subscriptionInvoice: {
    findFirst: async ({ where }: any) =>
      facturasStripe.find((f) => f.clinicId === where.clinicId && f.method === where.method && f.status === where.status) ?? null,
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

let crearEnlace: typeof import("@/lib/stripe-subscriptions").createCheckoutForSubscription;
let POST: (req: any) => Promise<Response>;

before(async () => {
  dobles.set(path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prismaDoble });
  dobles.set(path.join(RAIZ, "src/lib/stripe.ts"), {
    __esModule: true,
    default: () => stripeDoble,
    getStripeSafe: () => stripeDoble,
    getPriceIdForPlan: (p: string) => (PLANES[p] ? `price_${p}` : null),
    stripeUnavailableResponse: () => ({ error: "Stripe no configurado" }),
  });
  dobles.set(path.join(RAIZ, "src/lib/plans.ts"), { getResolvedPlan: async (id: string) => PLANES[id] });
  dobles.set(path.join(RAIZ, "src/lib/admin-auth.ts"), { getAdminSession: async () => ({ user: { id: "admin1" } }) });
  dobles.set(path.join(RAIZ, "src/lib/admin-audit.ts"), { logAdminClinicMutation: async () => undefined });
  ({ createCheckoutForSubscription: crearEnlace } = await import("@/lib/stripe-subscriptions"));
  ({ POST } = await import("@/app/api/admin/stripe/create-subscription/route"));
});

const ENV_ANTES = { ...process.env };
beforeEach(() => {
  sesiones = [];
  facturasStripe = [];
  // Clínica de ANTES (creada antes del corte), en PRO, sin tarjeta previa.
  clinicaEnBase = {
    id: "cA", name: "Clínica A", email: "a@ejemplo.mx", plan: "PRO", createdAt: new Date("2025-11-03"),
    stripeCustomerId: "cus_a", stripeSubscriptionId: null, subscriptionId: null,
    planOverrideFor: "PRO", priceMxnMonthlyOverride: 600, priceMxnAnnualOverride: 5000,
  };
  delete process.env.STRIPE_AUTOMATIC_TAX;
  process.env.STRIPE_IVA_TAX_RATE_ID = TASA;
  process.env.NEXT_PUBLIC_APP_URL = "https://app.test";
});
test.after?.(() => { process.env = ENV_ANTES; });

const enlace = (plan: string, clinic: any = clinicaEnBase) =>
  crearEnlace({ customerId: "cus_a", plan, clinicId: "cA", clinic, successUrl: "https://app.test/ok", cancelUrl: "https://app.test/no" });

const post = (body: object) => POST({ json: async () => body, url: "https://app.test/api/admin/stripe/create-subscription", headers: new Headers() } as any);

/* ── «Generar enlace» (createCheckoutForSubscription) ──────────────────── */

test("enlace de admin: clínica de antes, SU mismo plan → precio conservado SIN IVA, y sin exigir el env", async () => {
  delete process.env.STRIPE_IVA_TAX_RATE_ID;
  const url = await enlace("PRO");
  assert.ok(url);
  const linea = sesiones[0].line_items[0];
  assert.equal(linea.price_data.unit_amount, 60000, "su precio conservado");
  assert.equal(linea.tax_rates, undefined, "exenta");
  assert.equal(sesiones[0].automatic_tax, undefined);
});

test("enlace de admin: clínica NUEVA → con IVA, y sin env no se genera el enlace", async () => {
  Object.assign(clinicaEnBase, { createdAt: new Date("2026-10-05"), planOverrideFor: null, priceMxnMonthlyOverride: null });
  await enlace("PRO");
  assert.deepEqual(sesiones[0].line_items[0].tax_rates, [TASA]);
  assert.equal(sesiones[0].line_items[0].price_data.unit_amount, 68900);
  sesiones = [];
  delete process.env.STRIPE_IVA_TAX_RATE_ID;
  await assert.rejects(() => enlace("PRO"), /IVA/);
  assert.equal(sesiones.length, 0, "jamás se cobra sin IVA en silencio");
});

test("enlace de admin: clínica de antes pero OTRO plan → precio vigente de ese plan con IVA", async () => {
  await enlace("CLINIC");
  const linea = sesiones[0].line_items[0];
  assert.equal(linea.price_data.unit_amount, 148900, "no viaja el override de PRO");
  assert.deepEqual(linea.tax_rates, [TASA]);
});

test("enlace de admin: clínica de antes que YA tuvo tarjeta y la canceló (reactivar) → con IVA", async () => {
  clinicaEnBase.stripeSubscriptionId = "sub_cancelada";
  await enlace("PRO");
  assert.deepEqual(sesiones[0].line_items[0].tax_rates, [TASA]);
  // Sin señal en la fila pero con una factura de Stripe pagada: también.
  sesiones = [];
  Object.assign(clinicaEnBase, { stripeSubscriptionId: null });
  facturasStripe = [{ clinicId: "cA", method: "stripe", status: "paid" }];
  await enlace("PRO", { ...clinicaEnBase });
  assert.deepEqual(sesiones[0].line_items[0].tax_rates, [TASA]);
});

test("enlace de admin: sin la clínica (o sin createdAt) cuenta como nueva: con IVA", async () => {
  await crearEnlace({ customerId: "cus_a", plan: "PRO", clinicId: "cA", successUrl: "u", cancelUrl: "u" });
  assert.deepEqual(sesiones[0].line_items[0].tax_rates, [TASA]);
  sesiones = [];
  await enlace("PRO", { plan: "PRO", planOverrideFor: "PRO", priceMxnMonthlyOverride: 600 });
  assert.deepEqual(sesiones[0].line_items[0].tax_rates, [TASA], "dato ausente → nunca se regala el IVA");
});

/* ── create-subscription (con price de Stripe) ─────────────────────────── */

test("create-subscription: clínica de antes, su mismo plan → sin IVA y sin exigir el env", async () => {
  delete process.env.STRIPE_IVA_TAX_RATE_ID;
  const res = await post({ clinicId: "cA", plan: "PRO" });
  assert.equal(res.status, 200);
  assert.equal(sesiones[0].line_items[0].price, "price_PRO");
  assert.equal(sesiones[0].line_items[0].tax_rates, undefined);
});

test("create-subscription: clínica nueva u otro plan → con IVA; sin env, 503 y ninguna sesión", async () => {
  await post({ clinicId: "cA", plan: "CLINIC" });
  assert.deepEqual(sesiones[0].line_items[0].tax_rates, [TASA], "otro plan");
  sesiones = [];
  Object.assign(clinicaEnBase, { createdAt: new Date("2026-10-05") });
  await post({ clinicId: "cA", plan: "PRO" });
  assert.deepEqual(sesiones[0].line_items[0].tax_rates, [TASA], "clínica nueva");
  sesiones = [];
  delete process.env.STRIPE_IVA_TAX_RATE_ID;
  const res = await post({ clinicId: "cA", plan: "PRO" });
  assert.equal(res.status, 503);
  assert.equal(((await res.json()) as any).code, "IVA_NO_CONFIGURADO");
  assert.equal(sesiones.length, 0);
});

test("create-subscription: de antes que ya tuvo tarjeta → con IVA (reactivar); clínica inexistente → 404", async () => {
  clinicaEnBase.subscriptionId = "sub_legacy";
  await post({ clinicId: "cA", plan: "PRO" });
  assert.deepEqual(sesiones[0].line_items[0].tax_rates, [TASA]);
  clinicaEnBase = null;
  assert.equal((await post({ clinicId: "nope", plan: "PRO" })).status, 404);
});
