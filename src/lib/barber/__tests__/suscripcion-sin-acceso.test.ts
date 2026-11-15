// M16 (ronda 6 de la revisión, 14-nov-2026) — Barbero y Recepción abrían
// /barber/suscripcion escribiendo la dirección y veían los planes con tres
// botones «Contratar». Ahora la PÁGINA exige billing.manage, como su pantalla
// y sus APIs: sin él, «Sin acceso a esta sección».
//
// Excepción a propósito: con la barbería IMPAGA el candado de pago manda aquí
// a todos los roles (es la única página abierta). Ahí se sigue viendo el
// estado en solo lectura para que entiendan por qué todo está cerrado.
//
// Pura: la página de verdad con la sesión y el cobro simulados (sin base).
//   npx tsx --test src/lib/barber/__tests__/suscripcion-sin-acceso.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import Module from "node:module";
import type { BarberContext } from "@/lib/barber-auth";
import { FALLBACK_BARBER_PLAN_CONFIG } from "@/lib/barber/plan-shared";

const ROOT = path.resolve(__dirname, "../../../..");
const abs = (rel: string) => path.join(ROOT, rel);

let session: BarberContext | null = null;
const SCREEN = function BillingScreenDoble() {
  return null;
};

const plan = { id: "PROFESIONAL", name: "Profesional", isActive: true, priceMonthly: 0, priceYearly: null, firstMonthPrice: null, maxBarbers: 5, maxBranches: 1, messageQuota: 0, features: FALLBACK_BARBER_PLAN_CONFIG.PROFESIONAL.features };
const DOUBLES = new Map<string, unknown>([
  [abs("src/lib/barber-auth.ts"), { __esModule: true, getBarberContext: async () => session }],
  [abs("src/lib/barber/plans.ts"), { __esModule: true, getBarberPlans: async () => [plan] }],
  [
    abs("src/lib/barber/gating.ts"),
    {
      __esModule: true,
      getBarberGate: async () => ({
        planId: "PROFESIONAL",
        plan: { name: "Profesional" },
        subscriptionStatus: session?.barbershop.subscriptionStatus ?? "active",
        subscriptionActive: true,
        limits: { barbers: { used: 1, max: 5 }, branches: { used: 1, max: 1 } },
      }),
    },
  ],
  [
    abs("src/lib/barber/billing.ts"),
    {
      __esModule: true,
      getBarberBillingShop: async () => ({}),
      getBarberBillingSummary: async () => ({ configured: false, stripeError: null, subscription: null, invoices: [], failedAttempts: [] }),
      getBarberStripe: () => null,
      isBarberStripeConfigured: () => false,
      toCents: () => 0,
      // Reactivar = pagar el mismo plan (ws6-t6): aquí ninguna está suspendida tras pagar.
      resolverReactivacionBarber: async () => null,
    },
  ],
  // El corte por fecha del candado (ws6-t6) lee el registro de cobros: sin base, nada vencido.
  [abs("src/lib/barber/cobros.ts"), {
      __esModule: true,
      vencerSiTocaBarber: async () => false,
      // Criterio único (cobros.ts): sin base, «al corriente» = solo el estado.
      matrizAlCorriente: async (_id: string, status: string) => ["active", "trialing", "paid"].includes(status),
    },],
  [abs("src/components/barber/billing/billing-screen.tsx"), { __esModule: true, BillingScreen: SCREEN }],
]);

const M = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (request: string, parent: unknown) => string;
};
const originalLoad = M._load;
M._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only" || request === "client-only" || request.endsWith(".css")) return {};
  try {
    const resolved = M._resolveFilename(request, parent);
    if (DOUBLES.has(resolved)) return DOUBLES.get(resolved);
  } catch {
    /* que lo resuelva el cargador original */
  }
  return originalLoad.call(this, request, parent, isMain);
};
after(() => {
  M._load = originalLoad;
});

function ctxDe(role: BarberContext["role"], subscriptionStatus = "active", permissionsOverride: string[] = []): BarberContext {
  const barbershop = { id: "s1", parentId: null, isActive: true, subscriptionStatus, locale: "es", name: "Barbería Prueba" } as unknown as BarberContext["barbershop"];
  const user = { id: "u1", permissionsOverride } as unknown as BarberContext["user"];
  return { barberUserId: "u1", barbershopId: "s1", barbershop, user, barber: null, role };
}

async function abrir(ctx: BarberContext) {
  session = ctx;
  const { default: Page } = await import("@/app/barber/(panel)/suscripcion/page");
  const { BarberDenied } = await import("@/components/barber/cash/denied");
  const el = (await Page({ searchParams: Promise.resolve({}) })) as { type: unknown; props: Record<string, unknown> };
  return { denied: el.type === BarberDenied, screen: el.type === SCREEN, props: el.props };
}

test("Barbero, Recepción y Encargado: «Sin acceso a esta sección», como en las demás", async () => {
  for (const role of ["BARBER", "RECEPTION", "MANAGER"] as const) {
    const r = await abrir(ctxDe(role));
    assert.equal(r.denied, true, role);
    assert.equal(r.props.title, "Sin acceso a esta sección", role);
    assert.match(String(r.props.body), /solo el dueño/, role);
  }
});

test("el Dueño (y quien tenga billing.manage por permiso personal) la abre como siempre", async () => {
  const dueno = await abrir(ctxDe("OWNER"));
  assert.equal(dueno.screen, true);
  assert.equal(dueno.props.canManage, true);
  const conPermiso = await abrir(ctxDe("RECEPTION", "active", ["billing.manage"]));
  assert.equal(conPermiso.screen, true);
});

test("con la barbería impaga, el candado manda aquí a todos: se ve el estado en solo lectura", async () => {
  for (const role of ["BARBER", "RECEPTION"] as const) {
    const r = await abrir(ctxDe(role, "pending_payment"));
    assert.equal(r.screen, true, role);
    assert.equal(r.props.canManage, false, `${role}: no puede contratar`);
  }
});
