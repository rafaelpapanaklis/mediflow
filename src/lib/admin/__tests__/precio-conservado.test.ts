/**
 * PRECIO CONSERVADO en las superficies que valúan clínicas (integración de #425).
 *
 * Run: npm run test:planes-nuevos
 *
 * Los planes nuevos bajan la lista de Clínica a $1,489, pero las clínicas de antes conservan lo que
 * pagan ($1,719; `Clinic.planOverrideFor` + `priceMxnMonthlyOverride`). Cada sitio que suma dinero de
 * clínicas tiene que valuarlas con ESE precio, no con el de lista:
 *   · MRR de /admin y de la cartera (`computeMrr`; sus pruebas viven en mrr-core.test.ts y cartera.test.ts);
 *   · «clientes» (`getClientesList` / `planPriceMxn`, con la etiqueta «vip»);
 *   · MRR de afiliados (`clinicMonthlyMxn`).
 * Aquí se prueban las dos últimas, y que el precio conservado NO viaja a otro plan.
 */
import Module from "node:module";
import path from "node:path";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { clinicMonthlyMxn } from "@/lib/affiliates/stats";

const RAIZ = path.resolve(__dirname, "../../../..");

/* ── clinicMonthlyMxn (afiliados) ──────────────────────────────────────── */

test("afiliados: negociado > conservado > respaldo del plan (ya el vigente: Clínica $1,489)", () => {
  assert.equal(clinicMonthlyMxn("CLINIC", 1200, { planOverrideFor: "CLINIC", priceMxnMonthlyOverride: 1719 }), 1200);
  assert.equal(clinicMonthlyMxn("CLINIC", 0, { planOverrideFor: "CLINIC", priceMxnMonthlyOverride: 1719 }), 1719);
  assert.equal(clinicMonthlyMxn("CLINIC", null, null), 1489, "una Clínica nueva vale la lista nueva, no $1,719 escrito a mano");
  assert.equal(clinicMonthlyMxn("CLINIC", 0), 1489);
  assert.equal(clinicMonthlyMxn("PRO", 0, { planOverrideFor: "PRO", priceMxnMonthlyOverride: 600 }), 600);
  assert.equal(clinicMonthlyMxn("LEGACY", 0), 0, "un plan que no existe vale 0");
});

test("afiliados: el precio conservado de OTRO plan no viaja (la clínica ya cambió)", () => {
  assert.equal(clinicMonthlyMxn("PRO", 0, { planOverrideFor: "CLINIC", priceMxnMonthlyOverride: 1719 }), 689);
  assert.equal(clinicMonthlyMxn("PRO", 0, { planOverrideFor: null, priceMxnMonthlyOverride: 1719 }), 689, "sin guarda no vale");
});

/* ── clientes (getClientesList) con prisma simulado ────────────────────── */

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

const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000);
let filas: any[] = [];
let selectVisto: any = null;
let lib: typeof import("@/lib/admin/clientes");

function dueno(id: string, clinic: Record<string, unknown>) {
  return {
    supabaseId: id, firstName: "Dra.", lastName: id, email: `${id}@ejemplo.mx`, phone: null, role: "SUPER_ADMIN",
    // Sin acceso reciente: la salud queda <80 y «vip» solo puede venir del MRR (no del health score).
    lastLogin: null,
    clinic: {
      id: `c-${id}`, name: `Clínica ${id}`, slug: id, plan: "CLINIC", monthlyPrice: 0, subscriptionStatus: "active",
      trialEndsAt: null, createdAt: hace(400), aiTokensUsed: 0, aiTokensLimit: 0, nextBillingDate: null,
      stripeCustomerId: null, stripeSubscriptionId: null, paymentMethodType: null, paymentMethodLast4: null,
      paymentMethodCollected: false, preferredPaymentMethod: null, affiliate: null, _count: { appointments: 0 },
      planOverrideFor: null, priceMxnMonthlyOverride: null,
      ...clinic,
    },
  };
}

before(async () => {
  dobles.set(path.join(RAIZ, "src/lib/prisma.ts"), {
    prisma: { user: { findMany: async ({ select }: any) => { selectVisto = select; return filas; } } },
  });
  dobles.set(path.join(RAIZ, "src/lib/patient-quota.ts"), { getPatientQuotaMany: async () => ({}) });
  lib = await import("@/lib/admin/clientes");
});

test("clientes: la consulta pide las dos columnas del precio conservado", async () => {
  filas = [];
  await lib.getClientesList();
  assert.equal(selectVisto.clinic.select.planOverrideFor, true);
  assert.equal(selectVisto.clinic.select.priceMxnMonthlyOverride, true);
});

test("clientes: el MRR y la etiqueta «vip» de una Clínica de antes usan su precio conservado", async () => {
  filas = [
    dueno("vieja", { planOverrideFor: "CLINIC", priceMxnMonthlyOverride: 1719 }),
    dueno("nueva", {}),
    dueno("propio", { monthlyPrice: 1200, planOverrideFor: "CLINIC", priceMxnMonthlyOverride: 1719 }),
  ];
  const l = await lib.getClientesList();
  const por = Object.fromEntries(l.map((c) => [c.supabaseId, c]));
  assert.equal(por.vieja.mrr, 1719, "conservado, no la lista ($1,489)");
  assert.ok(por.vieja.tags.includes("vip"), "sigue siendo «vip» (mrr ≥ $1,719) como antes de los planes nuevos");
  assert.equal(por.nueva.mrr, 1489, "una nueva vale la lista vigente");
  assert.equal(por.propio.mrr, 1200, "el precio negociado manda");
});

test("planPriceMxn: negociado > conservado > respaldo; sin la clínica vale como antes", () => {
  const { planPriceMxn } = lib;
  assert.equal(planPriceMxn("CLINIC", 0, { planOverrideFor: "CLINIC", priceMxnMonthlyOverride: 1719 }), 1719);
  assert.equal(planPriceMxn("CLINIC", 900, { planOverrideFor: "CLINIC", priceMxnMonthlyOverride: 1719 }), 900);
  assert.equal(planPriceMxn("CLINIC", 0), 1489);
  assert.equal(planPriceMxn("BASIC", 0, { planOverrideFor: "PRO", priceMxnMonthlyOverride: 999 }), 419);
});
