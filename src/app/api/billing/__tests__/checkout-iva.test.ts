/**
 * COBRO NUEVO CON IVA 16 % — la ruta de checkout DE VERDAD (ws1-t3, ajuste 1).
 *
 * Run: npm run test:iva-cobro
 *
 * Se ejecuta el handler real de POST /api/billing/checkout con un Stripe
 * SIMULADO (⛔ nada sale contra Stripe: el doble apunta lo que habría mandado) y
 * un doble de prisma. Se prueba:
 *   · tarjeta mensual y anual, OXXO y el «spei» de Stripe: la línea del plan lleva
 *     la tasa manual de IVA (`tax_rates`) y el precio sigue siendo el de siempre;
 *   · la promo del primer mes y el IVA sobre ella;
 *   · sin IVA configurado NO se crea ninguna sesión (503) y NO se crea nada más;
 *   · con Stripe Tax (env) se usa `automatic_tax` y NUNCA la tasa manual;
 *   · quien YA tiene suscripción de tarjeta viva va al portal como siempre, sin
 *     sesión nueva y sin depender del env de IVA;
 *   · las suscripciones existentes NO se tocan: ni renovaciones, ni webhook, ni
 *     `subscriptions.update` con tasas.
 */
import Module from "node:module";
import path from "node:path";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { desgloseConIva } from "@/lib/billing/iva-cobro";

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
  CLINIC: { id: "CLINIC", name: "Clínica", priceMxn: 1719, priceMxnMonthly: 1719, priceMxnAnnual: 13404 },
};

let facturasStripe: any[];
let consultasFacturas: any[];
const prismaDoble: any = {
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
  auditorias = [];
  llamadasProhibidas = [];
  suscripcionViva = null;
  facturasStripe = [];
  consultasFacturas = [];
  // Clínica NUEVA (registrada después del corte de IVA, 26-sep-2026): todo lleva IVA.
  clinica = {
    id: "cA", name: "Clínica A", email: "a@ejemplo.mx", stripeCustomerId: "cus_a", stripeSubscriptionId: null,
    subscriptionId: null, nextBillingDate: new Date("2026-01-01"), plan: "PRO", createdAt: new Date("2026-10-05"),
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

/* ── tarjeta, OXXO y el «spei» de Stripe ───────────────────────────────── */

for (const plan of ["BASIC", "PRO", "CLINIC"] as const) {
  for (const billing of ["monthly", "annual"] as const) {
    test(`tarjeta ${plan} ${billing}: suscripción NUEVA con la tasa de IVA en la línea y el precio de siempre`, async () => {
      const { res, json } = await pagar({ plan, method: "card", billing });
      assert.equal(res.status, 200);
      assert.ok(json.url);
      assert.equal(sesiones.length, 1);
      const s = sesiones[0];
      assert.equal(s.mode, "subscription");
      assert.equal(s.line_items.length, 1);
      const linea = s.line_items[0];
      assert.deepEqual(linea.tax_rates, [TASA], "el IVA 16 % va desglosado por Stripe");
      const precio = billing === "annual" ? PLANES[plan].priceMxnAnnual : PLANES[plan].priceMxn;
      assert.equal(linea.price_data.unit_amount, precio * 100, "el subtotal es el de siempre: el IVA va APARTE");
      assert.equal(linea.price_data.recurring.interval, billing === "annual" ? "year" : "month");
      assert.equal(s.automatic_tax, undefined, "no Stripe Tax");
      // Y el desglose que la pantalla enseña coincide con lo que Stripe calculará (16 % del subtotal).
      const d = desgloseConIva(precio * 100);
      assert.equal(d.totalCents, precio * 100 + Math.round(precio * 16));
    });
  }
}

test("OXXO: pago único con la tasa de IVA en la línea", async () => {
  const { res } = await pagar({ plan: "PRO", method: "oxxo", billing: "monthly" });
  assert.equal(res.status, 200);
  const s = sesiones[0];
  assert.equal(s.mode, "payment");
  assert.deepEqual(s.payment_method_types, ["oxxo"]);
  assert.deepEqual(s.line_items[0].tax_rates, [TASA]);
  assert.equal(s.line_items[0].price_data.unit_amount, 68900);
});

test("OXXO anual: el total del año, con IVA aparte", async () => {
  await pagar({ plan: "CLINIC", method: "oxxo", billing: "annual" });
  assert.equal(sesiones[0].line_items[0].price_data.unit_amount, 1340400);
  assert.deepEqual(sesiones[0].line_items[0].tax_rates, [TASA]);
});

test("el «spei» de Stripe (por API, en curso o antiguo) también lleva IVA: todo cobro nuevo por plan", async () => {
  await pagar({ plan: "BASIC", method: "spei", billing: "monthly" });
  const s = sesiones[0];
  assert.deepEqual(s.payment_method_types, ["customer_balance"]);
  assert.deepEqual(s.line_items[0].tax_rates, [TASA]);
});

/* ── promo del primer mes ──────────────────────────────────────────────── */

/** Lo que Stripe cobrará en la 1.ª factura: (línea − cupón) + IVA exclusivo 16 % sobre ESE subtotal. */
function primeraFactura(sesion: any, cupon: any): { subtotal: number; iva: number; total: number } {
  const subtotal = sesion.line_items[0].price_data.unit_amount - (cupon?.amount_off ?? 0);
  const iva = sesion.line_items[0].tax_rates ? desgloseConIva(subtotal).ivaCents : 0;
  return { subtotal, iva, total: subtotal + iva };
}

test("promo del primer mes: el TOTAL cobrado es EXACTAMENTE $29 con el IVA dentro ($25.00 + $4.00), no $33.64", async () => {
  clinica.nextBillingDate = null; // primera contratación
  await pagar({ plan: "PRO", method: "card", billing: "monthly" });
  const s = sesiones[0];
  assert.equal(cupones.length, 1);
  assert.equal(cupones[0].amount_off, 68900 - 2500, "el cupón deja el SUBTOTAL en $25.00 (= 29 / 1.16)");
  assert.match(cupones[0].id, /^dc-first-month-iva-pro-/, "cupón propio de «con IVA»: no reusa el de sin IVA");
  assert.deepEqual(s.discounts, [{ coupon: cupones[0].id }]);
  assert.deepEqual(s.line_items[0].tax_rates, [TASA], "la tasa exclusiva de siempre: las renovaciones siguen siendo precio + IVA");
  assert.equal(s.line_items[0].price_data.unit_amount, 68900, "la línea sigue al precio de lista (la renovación)");
  assert.deepEqual(primeraFactura(s, cupones[0]), { subtotal: 2500, iva: 400, total: 2900 });
});

test("promo del primer mes: los tres planes cobran EXACTAMENTE 19 / 29 / 39 de total, IVA desglosado dentro", async () => {
  const esperado: Record<string, { subtotal: number; iva: number; total: number }> = {
    BASIC: { subtotal: 1638, iva: 262, total: 1900 },
    PRO: { subtotal: 2500, iva: 400, total: 2900 },
    CLINIC: { subtotal: 3362, iva: 538, total: 3900 },
  };
  for (const plan of ["BASIC", "PRO", "CLINIC"] as const) {
    sesiones = [];
    cupones = [];
    Object.assign(clinica, { plan, nextBillingDate: null });
    await pagar({ plan, method: "card", billing: "monthly" });
    assert.deepEqual(primeraFactura(sesiones[0], cupones[0]), esperado[plan], plan);
    // La 2.ª factura ya no lleva el cupón (duration once): precio de lista + IVA.
    assert.equal(cupones[0].duration, "once", plan);
    const lista = sesiones[0].line_items[0].price_data.unit_amount;
    assert.equal(desgloseConIva(lista).totalCents, lista + Math.floor((lista * 16 + 50) / 100), plan);
  }
});

test("promo del primer mes SIN IVA (clínica exenta): total exactamente la promo, sin tasa", async () => {
  Object.assign(clinica, { createdAt: new Date("2025-11-03"), plan: "PRO", nextBillingDate: null });
  delete process.env.STRIPE_IVA_TAX_RATE_ID;
  await pagar({ plan: "PRO", method: "card", billing: "monthly" });
  assert.equal(sesiones[0].line_items[0].tax_rates, undefined);
  assert.equal(cupones[0].amount_off, 68900 - 2900);
  assert.doesNotMatch(cupones[0].id, /-iva-/);
  assert.deepEqual(primeraFactura(sesiones[0], cupones[0]), { subtotal: 2900, iva: 0, total: 2900 });
});

/* ── sin IVA configurado ───────────────────────────────────────────────── */

test("sin STRIPE_IVA_TAX_RATE_ID ni Stripe Tax: 503 claro y NO se crea ninguna sesión", async () => {
  delete process.env.STRIPE_IVA_TAX_RATE_ID;
  for (const method of ["card", "oxxo", "spei"]) {
    const { res, json } = await pagar({ plan: "PRO", method, billing: "monthly" });
    assert.equal(res.status, 503, method);
    assert.equal(json.code, "IVA_NO_CONFIGURADO");
    assert.match(json.error, /no está disponible por ahora/);
  }
  assert.equal(sesiones.length, 0, "jamás se cobra sin IVA en silencio");
  assert.equal(cupones.length, 0, "ni siquiera se crea el cupón");
  assert.equal(auditorias.length, 0);
});

test("con un id que no es una tasa (p. ej. un price_…) tampoco se cobra", async () => {
  process.env.STRIPE_IVA_TAX_RATE_ID = "price_1Pabcdefghijk";
  const { res } = await pagar({ plan: "PRO", method: "card", billing: "monthly" });
  assert.equal(res.status, 503);
  assert.equal(sesiones.length, 0);
});

/* ── Stripe Tax en el futuro ───────────────────────────────────────────── */

test("con STRIPE_AUTOMATIC_TAX=true: Stripe Tax y NUNCA las dos cosas (no se suma doble)", async () => {
  process.env.STRIPE_AUTOMATIC_TAX = "true";
  for (const method of ["card", "oxxo"]) {
    sesiones = [];
    await pagar({ plan: "PRO", method, billing: "monthly" });
    const s = sesiones[0];
    assert.deepEqual(s.automatic_tax, { enabled: true }, method);
    assert.equal(s.line_items[0].tax_rates, undefined, method);
  }
});

/* ── los que ya pagan ─────────────────────────────────────────────────── */

test("quien YA tiene suscripción de tarjeta viva va al portal como siempre: sin sesión nueva y sin depender del env de IVA", async () => {
  delete process.env.STRIPE_IVA_TAX_RATE_ID;
  clinica.stripeSubscriptionId = "sub_viva";
  suscripcionViva = { status: "active" };
  const { res, json } = await pagar({ plan: "PRO", method: "card", billing: "monthly" });
  assert.equal(res.status, 200);
  assert.equal(json.portal, true);
  assert.equal(sesiones.length, 0, "no se crea una segunda suscripción ni se toca la existente");
  assert.deepEqual(llamadasProhibidas, []);
});

test("el checkout nunca modifica, cancela ni crea suscripciones ni tasas por API", async () => {
  await pagar({ plan: "PRO", method: "card", billing: "annual" });
  await pagar({ plan: "PRO", method: "oxxo", billing: "monthly" });
  assert.deepEqual(llamadasProhibidas, [], "ni subscriptions.update/cancel/create ni taxRates.create");
});

/* ── Ajuste 1c: las clínicas YA CREADAS no cambian; las nuevas pagan IVA en todo ── */

/** Clínica creada ANTES del corte. Haya pagado o no: ya está creada. */
function deLasDeAntes(extra: object = {}) {
  clinica = { ...clinica, createdAt: new Date("2025-11-03"), plan: "PRO", nextBillingDate: null, stripeSubscriptionId: null, subscriptionId: null, ...extra };
}
const sinTasa = (s: any) => s.line_items[0].tax_rates === undefined && s.automatic_tax === undefined;

test("(b) clínica de antes que NUNCA pagó: OXXO de su plan sin IVA, aunque falte el env de IVA", async () => {
  deLasDeAntes();
  delete process.env.STRIPE_IVA_TAX_RATE_ID;
  const { res } = await pagar({ plan: "PRO", method: "oxxo", billing: "monthly" });
  assert.equal(res.status, 200, "no se bloquea: esas clínicas no necesitan el env");
  assert.ok(sinTasa(sesiones[0]));
  assert.equal(sesiones[0].line_items[0].price_data.unit_amount, 68900, "el precio de hoy, sin IVA");
  assert.equal(auditorias[0].changes._created.after.ivaModo, "exento");
});

test("(b) clínica de antes que ya pagaba a mano: OXXO mensual/anual y «spei» de Stripe del mismo plan, sin IVA", async () => {
  deLasDeAntes({ nextBillingDate: new Date("2026-09-30") });
  await pagar({ plan: "PRO", method: "oxxo", billing: "monthly" });
  await pagar({ plan: "PRO", method: "oxxo", billing: "annual" });
  await pagar({ plan: "PRO", method: "spei", billing: "monthly" });
  assert.equal(sesiones.length, 3);
  for (const s of sesiones) assert.ok(sinTasa(s));
});

test("(b) su PRIMERA contratación con TARJETA, mismo plan: sin IVA (aunque nunca haya pagado) y con la promo tal cual", async () => {
  deLasDeAntes();
  delete process.env.STRIPE_IVA_TAX_RATE_ID;
  const { res } = await pagar({ plan: "PRO", method: "card", billing: "monthly" });
  assert.equal(res.status, 200);
  const s = sesiones[0];
  assert.equal(s.mode, "subscription");
  assert.ok(sinTasa(s), "la suscripción nace sin IVA y sus renovaciones también");
  assert.equal(cupones.length, 1, "la promo del primer mes sigue aplicando (la clínica nunca pagó)");
  assert.equal(consultasFacturas.length, 1, "se comprobó que no tuvo tarjeta");
});

test("con TARJETA anual del mismo plan, sin IVA también", async () => {
  deLasDeAntes();
  await pagar({ plan: "PRO", method: "card", billing: "annual" });
  assert.ok(sinTasa(sesiones[0]));
});

test("cambio de plan (OTRO plan) de una clínica de antes: con IVA, en los tres métodos", async () => {
  deLasDeAntes();
  for (const method of ["card", "oxxo", "spei"]) {
    sesiones = [];
    await pagar({ plan: "CLINIC", method, billing: "monthly" });
    assert.deepEqual(sesiones[0].line_items[0].tax_rates, [TASA], method);
  }
});

test("REACTIVAR con tarjeta tras haber tenido y cancelado una suscripción: con IVA (señal en la fila: stripeSubscriptionId)", async () => {
  deLasDeAntes({ stripeSubscriptionId: "sub_cancelada", subscriptionStatus: "cancelled" });
  suscripcionViva = { status: "canceled" }; // Stripe la devuelve, pero ya no está viva
  await pagar({ plan: "PRO", method: "card", billing: "monthly" });
  assert.deepEqual(sesiones[0].line_items[0].tax_rates, [TASA]);
  assert.equal(consultasFacturas.length, 0, "con señal en la fila no hace falta consultar facturas");
});

test("REACTIVAR con tarjeta cuando el admin canceló (stripeSubscriptionId en null): se detecta por una factura de Stripe pagada", async () => {
  deLasDeAntes({ id: "cA", subscriptionStatus: "cancelled" });
  facturasStripe = [{ clinicId: "cA", method: "stripe", status: "paid" }];
  await pagar({ plan: "PRO", method: "card", billing: "monthly" });
  assert.deepEqual(sesiones[0].line_items[0].tax_rates, [TASA]);
  assert.deepEqual(consultasFacturas[0], { clinicId: "cA", method: "stripe", status: "paid" }, "filtra por la clínica de la sesión");
});

test("suscripción legacy (subscriptionId) también cuenta como «tuvo tarjeta»", async () => {
  deLasDeAntes({ subscriptionId: "legacy_9" });
  await pagar({ plan: "PRO", method: "card", billing: "monthly" });
  assert.deepEqual(sesiones[0].line_items[0].tax_rates, [TASA]);
});

test("una clínica de antes que pagó a mano y suspendida por un admin (status cancelled) NO cuenta como «tuvo tarjeta»", async () => {
  deLasDeAntes({ subscriptionStatus: "cancelled", nextBillingDate: new Date("2026-08-01") });
  await pagar({ plan: "PRO", method: "card", billing: "monthly" });
  assert.ok(sinTasa(sesiones[0]), "sin suscripción de tarjeta previa: su tarjeta sigue exenta");
});

test("tuvo tarjeta y la canceló: pero OXXO/SPEI de su plan siguen SIN IVA", async () => {
  deLasDeAntes({ stripeSubscriptionId: "sub_cancelada" });
  await pagar({ plan: "PRO", method: "oxxo", billing: "monthly" });
  await pagar({ plan: "PRO", method: "spei", billing: "monthly" });
  for (const s of sesiones) assert.ok(sinTasa(s));
});

test("(a) clínica creada DESPUÉS del corte: IVA en todo, todos los métodos, aunque ya haya pagado y sea su mismo plan", async () => {
  clinica.createdAt = new Date("2026-09-26T06:00:00.000Z"); // justo en el corte = nueva
  clinica.nextBillingDate = new Date("2026-10-30");
  for (const method of ["card", "oxxo", "spei"]) {
    sesiones = [];
    await pagar({ plan: "PRO", method, billing: "monthly" });
    assert.deepEqual(sesiones[0].line_items[0].tax_rates, [TASA], method);
  }
  assert.equal(consultasFacturas.length, 0, "a una clínica nueva no se le consulta nada más");
});

test("un segundo antes del corte es «de antes»; sin `createdAt` (dato ausente) es con IVA", async () => {
  deLasDeAntes({ createdAt: new Date("2026-09-26T05:59:59.000Z") });
  await pagar({ plan: "PRO", method: "oxxo", billing: "monthly" });
  deLasDeAntes({ createdAt: null });
  await pagar({ plan: "PRO", method: "oxxo", billing: "monthly" });
  assert.ok(sinTasa(sesiones[0]));
  assert.deepEqual(sesiones[1].line_items[0].tax_rates, [TASA]);
});

test("la exención la decide el servidor con la clínica de la sesión: el body no puede pedirla", async () => {
  await pagar({ plan: "PRO", method: "oxxo", billing: "monthly", sinIva: true, createdAt: "2020-01-01", exencion: { plan: "PRO", tarjeta: true } });
  assert.deepEqual(sesiones[0].line_items[0].tax_rates, [TASA]);
});

test("si no se puede saber si tuvo tarjeta (falla la consulta de facturas), NO se regala el IVA de la tarjeta", async () => {
  deLasDeAntes();
  const original = prismaDoble.subscriptionInvoice.findFirst;
  prismaDoble.subscriptionInvoice.findFirst = async () => { throw new Error("pooler saturado"); };
  try {
    await pagar({ plan: "PRO", method: "card", billing: "monthly" });
    await pagar({ plan: "PRO", method: "oxxo", billing: "monthly" });
  } finally {
    prismaDoble.subscriptionInvoice.findFirst = original;
  }
  assert.deepEqual(sesiones[0].line_items[0].tax_rates, [TASA], "tarjeta: con IVA por prudencia");
  assert.ok(sinTasa(sesiones[1]), "OXXO de su plan no depende de esa consulta");
});

test("una clínica de antes con suscripción de tarjeta VIVA va al portal, como siempre (sin sesión y sin consultar IVA)", async () => {
  deLasDeAntes({ stripeSubscriptionId: "sub_viva" });
  suscripcionViva = { status: "active" };
  delete process.env.STRIPE_IVA_TAX_RATE_ID;
  const { json } = await pagar({ plan: "PRO", method: "card", billing: "monthly" });
  assert.equal(json.portal, true);
  assert.equal(sesiones.length, 0);
  assert.deepEqual(llamadasProhibidas, []);
});

/* ── contratos de código: ninguna renovación ni suscripción existente pasa por lo nuevo ── */

const leer = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

function archivosSrc(dir: string, acc: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (n === "node_modules" || n === "__tests__") continue;
      archivosSrc(p, acc);
    } else if (/\.(ts|tsx)$/.test(n) && !/\.test\./.test(n)) acc.push(p);
  }
  return acc;
}

test("el IVA nuevo solo lo usan los sitios que crean cobros nuevos por plan (checkout, admin×2) y el diferencial de change-plan (+ su vista previa)", () => {
  const usan = archivosSrc(path.join(RAIZ, "src"))
    .filter((f) => /iva-cobro/.test(sinComentarios(readFileSync(f, "utf8"))))
    .map((f) => path.relative(RAIZ, f).replace(/\\/g, "/"))
    .filter((f) => !f.startsWith("src/lib/billing/iva-cobro") && !f.startsWith("src/lib/billing/spei-directo") && !f.startsWith("src/components/") && !f.startsWith("src/app/dashboard/suspended/"))
    .sort();
  assert.deepEqual(usan, [
    "src/app/api/admin/stripe/create-subscription/route.ts",
    "src/app/api/billing/change-plan/preview/route.ts",
    "src/app/api/billing/change-plan/route.ts",
    "src/app/api/billing/checkout/route.ts",
    // ws1-t2: compra de UN módulo del marketplace (Ortodoncia). Usa
    // `ivaParaCobro` directo, NUNCA `ivaParaPagoDeClinica`/`exencionDeIva`:
    // un módulo no es "el mismo plan" de la clínica, así que la excepción de
    // las clínicas de antes del 26-sep-2026 no aplica — siempre lleva IVA.
    "src/app/api/marketplace/module-checkout/route.ts",
    "src/app/dashboard/settings/page.tsx", // solo LEE si el IVA está configurado, para el texto de «Activa tu plan»
    "src/lib/billing/first-month-promo.ts", // el cupón del primer mes deja el total exacto con el IVA dentro
    "src/lib/billing/iva-clinica.ts",
    "src/lib/stripe-subscriptions.ts",
  ]);
});

test("`tax_rates` solo se escribe en el helper: ni webhooks, ni change-plan, ni pagos manuales lo tocan", () => {
  const con = archivosSrc(path.join(RAIZ, "src"))
    .filter((f) => /tax_rates|taxRates|default_tax_rates/.test(sinComentarios(readFileSync(f, "utf8"))))
    .map((f) => path.relative(RAIZ, f).replace(/\\/g, "/"))
    .sort();
  assert.deepEqual(con, ["src/lib/billing/iva-cobro.ts"]);
});

test("el webhook de Stripe y los pagos manuales del admin NO importan el IVA nuevo; y change-plan lo usa SOLO en la rama sin tarjeta", () => {
  const cp = sinComentarios(leer("src/app/api/billing/change-plan/route.ts"));
  // Todo lo que va DESPUÉS de la rama manual (la suscripción de tarjeta viva) no sabe de IVA.
  const iCard = cp.lastIndexOf("const stripe = getStripeSafe();");
  assert.ok(iCard > cp.indexOf("desgloseConIva("), "la rama de tarjeta viene después de la manual");
  assert.ok(!/ivaParaCobro|desgloseConIva|tax_rates|automatic_tax|\biva\b/i.test(cp.slice(iCard)), "la rama de suscripción de tarjeta viva no toca IVA ni tasas");
  for (const rel of [
    "src/app/api/webhooks/stripe/route.ts",
    "src/app/api/admin/billing/route.ts",
    "src/app/api/admin/subscriptions/route.ts",
    "src/lib/billing/proration.ts",
    "src/lib/billing/record-stripe-invoice.ts",
  ]) {
    const t = sinComentarios(leer(rel));
    assert.ok(!/iva-cobro|IVA_TASA|STRIPE_IVA_TAX_RATE_ID/.test(t), `${rel} no debe conocer el IVA nuevo`);
  }
});

test("ningún camino de renovación crea sesiones: `subscriptions.update` solo está en change-plan y en pausar/reanudar", () => {
  const con = archivosSrc(path.join(RAIZ, "src"))
    .filter((f) => /\.subscriptions\s*\.update\(/.test(sinComentarios(readFileSync(f, "utf8"))))
    .map((f) => path.relative(RAIZ, f).replace(/\\/g, "/"))
    .filter((f) => !f.startsWith("src/lib/realty/") && !f.startsWith("src/lib/barber/"))
    .sort();
  // Ninguno de esos toca precios/tasas con este ajuste (el test anterior lo garantiza para tax_rates).
  // ws1-t2: module-cancel/route.ts SOLO pide `cancel_at_period_end: true`
  // (agenda la baja al fin del periodo YA pagado) — no cambia precio, no
  // cambia tasa, no crea sesión nueva.
  // ws1-t5: toggle-clinic-module.ts (el interruptor de /admin) hace lo mismo
  // sobre la suscripción de un módulo: `cancel_at_period_end: true` al
  // apagarlo y `false` al deshacer la baja. Tampoco toca precio ni tasa.
  assert.deepEqual(con, [
    "src/app/actions/admin/toggle-clinic-module.ts",
    "src/app/api/billing/change-plan/route.ts",
    "src/app/api/marketplace/module-cancel/route.ts",
    "src/lib/stripe-subscriptions.ts",
  ]);
});

/* ── Integración #425 (condiciones conservadas) × #424/IVA ─────────────────────────────────────── */

test("(d) clínica de antes con Clínica $1,719 conservado: OXXO/tarjeta de su mismo plan cobran SU precio, sin IVA", async () => {
  // La lista ya es la nueva ($1,489); ella conserva $1,719 / $13,404 (SQL 1 de planes-nuevos).
  PLANES.CLINIC = { ...PLANES.CLINIC, priceMxn: 1489, priceMxnMonthly: 1489, priceMxnAnnual: 11614 };
  try {
    Object.assign(clinica, {
      plan: "CLINIC", createdAt: new Date("2025-11-03"), planOverrideFor: "CLINIC",
      priceMxnMonthlyOverride: 1719, priceMxnAnnualOverride: 13404, maxUsersOverride: -1, maxClinicsOverride: 4,
    });
    await pagar({ plan: "CLINIC", method: "oxxo", billing: "monthly" });
    assert.equal(sesiones[0].line_items[0].price_data.unit_amount, 171900, "su precio conservado");
    assert.equal(sesiones[0].line_items[0].tax_rates, undefined, "sin IVA (exenta)");
    await pagar({ plan: "CLINIC", method: "oxxo", billing: "annual" });
    assert.equal(sesiones[1].line_items[0].price_data.unit_amount, 1340400);
    assert.equal(sesiones[1].line_items[0].tax_rates, undefined);
    await pagar({ plan: "CLINIC", method: "card", billing: "monthly" });
    assert.equal(sesiones[2].line_items[0].price_data.unit_amount, 171900);
    assert.equal(sesiones[2].line_items[0].tax_rates, undefined);
    // Y el nombre del producto no miente: es el plan de la clínica.
    assert.match(sesiones[0].line_items[0].price_data.product_data.name, /Clínica/);
  } finally {
    PLANES.CLINIC = { id: "CLINIC", name: "Clínica", priceMxn: 1719, priceMxnMonthly: 1719, priceMxnAnnual: 13404 };
  }
});

test("(d) esa misma clínica de antes que elige OTRO plan paga el precio VIGENTE de ese plan + IVA (el override no viaja)", async () => {
  PLANES.CLINIC = { ...PLANES.CLINIC, priceMxn: 1489, priceMxnMonthly: 1489, priceMxnAnnual: 11614 };
  try {
    Object.assign(clinica, {
      plan: "PRO", createdAt: new Date("2025-11-03"), planOverrideFor: "PRO",
      priceMxnMonthlyOverride: 600, priceMxnAnnualOverride: 5000,
    });
    await pagar({ plan: "CLINIC", method: "oxxo", billing: "monthly" });
    assert.equal(sesiones[0].line_items[0].price_data.unit_amount, 148900, "lista vigente de Clínica, no $600");
    assert.deepEqual(sesiones[0].line_items[0].tax_rates, [TASA], "cambio de plan: con IVA");
  } finally {
    PLANES.CLINIC = { id: "CLINIC", name: "Clínica", priceMxn: 1719, priceMxnMonthly: 1719, priceMxnAnnual: 13404 };
  }
});

test("(d) clínica NUEVA (después del corte): precio de lista + IVA en los tres métodos, sin overrides", async () => {
  PLANES.CLINIC = { ...PLANES.CLINIC, priceMxn: 1489, priceMxnMonthly: 1489, priceMxnAnnual: 11614 };
  try {
    Object.assign(clinica, { plan: "CLINIC", createdAt: new Date("2026-10-05") });
    for (const method of ["oxxo", "card"] as const) {
      sesiones = [];
      await pagar({ plan: "CLINIC", method, billing: "annual" });
      assert.equal(sesiones[0].line_items[0].price_data.unit_amount, 1161400, method);
      assert.deepEqual(sesiones[0].line_items[0].tax_rates, [TASA], method);
    }
  } finally {
    PLANES.CLINIC = { id: "CLINIC", name: "Clínica", priceMxn: 1719, priceMxnMonthly: 1719, priceMxnAnnual: 13404 };
  }
});

test("(d) la promo del primer mes de una clínica de antes usa su precio conservado como base del cupón", async () => {
  Object.assign(clinica, {
    plan: "PRO", createdAt: new Date("2025-11-03"), nextBillingDate: null, planOverrideFor: "PRO", priceMxnMonthlyOverride: 600,
  });
  await pagar({ plan: "PRO", method: "card", billing: "monthly" });
  assert.equal(sesiones[0].line_items[0].price_data.unit_amount, 60000);
  assert.equal(cupones[0].amount_off, 60000 - 2900, "el cupón deja el primer mes en $29 (sin IVA, exenta) sobre SU precio");
});
