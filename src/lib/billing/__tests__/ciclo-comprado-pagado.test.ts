/**
 * EL CICLO COMPRADO SALE DE UN PAGO CONFIRMADO (ws1-t1, ola 2b, retenido de la auditoría run-2:
 * `billing/manual-upgrade:inferManualInterval-trusts-unpaid-checkout-billing-row`; v2 tras la revisión t8, M1).
 *
 * Run: npm run test:billing
 *
 * `inferManualInterval` DE VERDAD con prisma y Stripe dobles (⛔ sin red ni base). El prorrateo del upgrade de una
 * clínica que paga SPEI/OXXO depende del ciclo que compró (mensual o anual). Antes se leía de la fila de bitácora
 * que deja /api/billing/checkout AL CREAR la sesión (pagada o no; también la del checkout de un MÓDULO), y la v1
 * solo miraba las últimas 50: 50 checkouts abandonados sacaban de la ventana la compra pagada y, sin dato, se cobra
 * el MENOR de los dos ciclos (el anual). Ahora el ciclo sale solo de pagos CONFIRMADOS: las sesiones de Stripe
 * completas y pagadas del plan de esa clínica (todas las páginas, sin ventana) y las transferencias SPEI directo
 * confirmadas. Los dobles respetan `take`, `limit` y `starting_after`: un doble que los ignora esconde la inundación.
 */
import Module from "node:module";
import path from "node:path";
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { computeManualUpgradeQuote } from "@/lib/billing/proration";

const RAIZ = path.resolve(__dirname, "../../../..");
const CLINIC = "clinic_mensual";
const CUS = "cus_mensual";

type Sesion = { id: string; customer: string; created: number; status: string; payment_status: string; metadata: Record<string, string> };

let filas: Array<{ entityId: string; changes: any }>;
let sesiones: Sesion[];
let spei: Array<{ clinicId: string; billing: string; status: string; resolvedAt: Date | null }>;
let clienteStripe: string | null;
let llamadasStripe: number;
let stripeFalla: boolean;
let reloj: number;
let consultasSpei: number;
let errorSpei: Error | null;

const prismaDoble: any = {
  auditLog: {
    findMany: async ({ where, take }: any) => {
      assert.equal(where.clinicId, CLINIC, "la bitácora se lee SOLO de la clínica");
      const todas = filas.map((f) => ({ ...f }));
      return typeof take === "number" ? todas.slice(0, take) : todas; // respeta `take`, como Postgres
    },
  },
  clinic: {
    findUnique: async ({ where }: any) => (where.id === CLINIC ? { stripeCustomerId: clienteStripe } : null),
  },
  speiTransferRequest: {
    findFirst: async ({ where, orderBy }: any) => {
      consultasSpei++;
      if (errorSpei) throw errorSpei;
      assert.equal(where.clinicId, CLINIC, "las transferencias se leen SOLO de la clínica");
      const f = spei.filter((x) => x.clinicId === where.clinicId && x.status === where.status && x.resolvedAt);
      if (orderBy?.resolvedAt === "desc") f.sort((a, b) => b.resolvedAt!.getTime() - a.resolvedAt!.getTime());
      return f[0] ?? null;
    },
  },
};

const stripeDoble: any = {
  checkout: {
    sessions: {
      retrieve: async (id: string) => {
        llamadasStripe++;
        if (stripeFalla) throw new Error("Stripe no contesta");
        const s = sesiones.find((x) => x.id === id);
        if (!s) throw Object.assign(new Error("No such checkout.session"), { code: "resource_missing" });
        return s;
      },
      // Como Stripe: de la más reciente a la más antigua, `limit` por página, `starting_after` para la siguiente.
      list: async ({ customer, status, limit = 10, starting_after }: any) => {
        llamadasStripe++;
        if (stripeFalla) throw new Error("Stripe no contesta");
        const todas = sesiones
          .filter((s) => s.customer === customer && (status === undefined || s.status === status))
          .sort((a, b) => b.created - a.created);
        const desde = starting_after ? todas.findIndex((s) => s.id === starting_after) + 1 : 0;
        const pagina = todas.slice(desde, desde + Math.min(limit, 100));
        return { data: pagina, has_more: desde + pagina.length < todas.length };
      },
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

let inferManualInterval: (clinicId: string) => Promise<"month" | "year" | null>;

before(async () => {
  dobles.set(path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prismaDoble });
  dobles.set(path.join(RAIZ, "src/lib/stripe.ts"), { getStripeSafe: () => stripeDoble, default: () => stripeDoble });
  ({ inferManualInterval } = await import("@/lib/billing/manual-upgrade"));
});

beforeEach(() => {
  filas = [];
  sesiones = [];
  spei = [];
  clienteStripe = CUS;
  llamadasStripe = 0;
  stripeFalla = false;
  reloj = Math.floor(Date.UTC(2026, 9, 1) / 1000);
  consultasSpei = 0;
  errorSpei = null;
  // La ausencia de la tabla de SPEI directo se recuerda en globalThis: cada prueba empieza sin ese recuerdo.
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("dalecontrol.spei-directo.sin-tabla")];
});

/** El error que da Prisma cuando `sql/spei-transferencia-directa.sql` no está pegado. */
const sinTablaSpei = () =>
  Object.assign(new Error("The table `public.spei_transfer_requests` does not exist in the current database."), { code: "P2021" });

/**
 * Un checkout del plan: la sesión en Stripe y la fila que /api/billing/checkout deja en la bitácora al crearla.
 * Se llaman en orden cronológico (cada una, más reciente que la anterior); las filas quedan de la más reciente a la
 * más antigua, como las lee el código.
 */
function checkout(id: string, billing: "monthly" | "annual", estado: "pagada" | "abandonada" | "voucher-sin-pagar", extra: Partial<Sesion> = {}) {
  reloj += 60;
  sesiones.push({
    id,
    customer: CUS,
    created: reloj,
    status: estado === "abandonada" ? "expired" : "complete",
    payment_status: estado === "pagada" ? "paid" : "unpaid",
    metadata: { kind: "platform-subscription", clinicId: CLINIC, plan: "BASIC", billing },
    ...extra,
  });
  filas.unshift({ entityId: id, changes: { _created: { before: null, after: { plan: "BASIC", priceMxn: 419, billing, sessionId: id } } } });
}

test("retenido: un checkout ANUAL abandonado (más reciente) no cambia el ciclo de quien pagó MENSUAL", async () => {
  checkout("cs_pagada", "monthly", "pagada");
  checkout("cs_abandonada", "annual", "abandonada");
  assert.equal(await inferManualInterval(CLINIC), "month");
});

test("M1 (t8): 60 checkouts anuales abandonados NO sacan de la ventana la compra mensual pagada", async () => {
  checkout("cs_pagada", "monthly", "pagada");
  for (let i = 0; i < 60; i++) checkout(`cs_abandonada_${i}`, "annual", "abandonada");
  assert.equal(await inferManualInterval(CLINIC), "month");
  assert.ok(llamadasStripe <= 2, `una consulta a Stripe, no una por fila: ${llamadasStripe}`);
});

test("M1: tampoco 150 vouchers OXXO generados y sin pagar (sesiones «complete» sin pago): se pagina hasta la pagada", async () => {
  checkout("cs_pagada", "monthly", "pagada");
  for (let i = 0; i < 150; i++) checkout(`cs_voucher_${i}`, "annual", "voucher-sin-pagar");
  assert.equal(await inferManualInterval(CLINIC), "month");
});

test("retenido: el dinero en juego — cotizar al ciclo correcto (30 días, BASIC → CLINIC a precios de lista)", () => {
  const precios = { currentPlan: { priceMxn: 419, priceMxnAnnual: 3264 }, targetPlan: { priceMxn: 1489, priceMxnAnnual: 11614 } };
  const now = new Date("2026-11-02T12:00:00Z");
  const paidUntil = new Date(now.getTime() + 30 * 86_400_000);
  const mensual = computeManualUpgradeQuote({ interval: "month", paidUntil, now, ...precios });
  const anual = computeManualUpgradeQuote({ interval: "year", paidUntil, now, ...precios });
  assert.equal(mensual.diffCents, 107000);
  assert.ok(anual.diffCents < 70000, `al ciclo anual sale ${anual.diffCents} (~36 % menos)`);
});

test("retenido (fase 5): un MÓDULO anual pagado no es el ciclo del plan", async () => {
  checkout("cs_pagada", "monthly", "pagada");
  checkout("cs_modulo", "annual", "pagada", { metadata: { kind: "module-subscription", clinicId: CLINIC, moduleKey: "ortodoncia", billing: "annual" } });
  filas[0] = { entityId: "cs_modulo", changes: { _created: { before: null, after: { moduleKey: "ortodoncia", billing: "annual", method: "spei", sessionId: "cs_modulo" } } } };
  assert.equal(await inferManualInterval(CLINIC), "month");
});

test("legítimo: quien PAGÓ el anual cotiza anual", async () => {
  checkout("cs_mensual_vieja", "monthly", "pagada");
  checkout("cs_anual", "annual", "pagada");
  assert.equal(await inferManualInterval(CLINIC), "year");
});

test("una sesión pagada de OTRA clínica bajo el mismo cliente de Stripe no cuenta", async () => {
  checkout("cs_pagada", "monthly", "pagada");
  checkout("cs_ajena", "annual", "pagada", { metadata: { kind: "platform-subscription", clinicId: "otra_clinica", billing: "annual" } });
  assert.equal(await inferManualInterval(CLINIC), "month");
});

test("SPEI directo confirmado DESPUÉS de la última compra por Stripe: manda su ciclo (la renovación más reciente)", async () => {
  checkout("cs_anual_vieja", "annual", "pagada");
  spei = [{ clinicId: CLINIC, billing: "monthly", status: "confirmed", resolvedAt: new Date((reloj + 3600) * 1000) }];
  assert.equal(await inferManualInterval(CLINIC), "month");
});

test("SPEI directo confirmado ANTES de la última compra por Stripe: manda Stripe; una transferencia sin confirmar no cuenta", async () => {
  spei = [
    { clinicId: CLINIC, billing: "monthly", status: "confirmed", resolvedAt: new Date((reloj - 3600) * 1000) },
    { clinicId: CLINIC, billing: "monthly", status: "pending", resolvedAt: null },
  ];
  checkout("cs_anual", "annual", "pagada");
  assert.equal(await inferManualInterval(CLINIC), "year");
});

test("clínica sin cliente de Stripe que pagó por SPEI directo: su ciclo", async () => {
  clienteStripe = null;
  spei = [{ clinicId: CLINIC, billing: "annual", status: "confirmed", resolvedAt: new Date() }];
  assert.equal(await inferManualInterval(CLINIC), "year");
});

test("sin ningún pago confirmado: null (cotiza por el criterio conservador de siempre)", async () => {
  checkout("cs_abandonada", "annual", "abandonada");
  assert.equal(await inferManualInterval(CLINIC), null);
});

test("si Stripe no contesta: null, no se adivina", async () => {
  checkout("cs_pagada", "monthly", "pagada");
  stripeFalla = true;
  assert.equal(await inferManualInterval(CLINIC), null);
});

test("sin clinicId no se lee nada (Prisma descartaría el filtro)", async () => {
  assert.equal(await inferManualInterval(""), null);
});

// ── v3 (delta t8, M3): la tabla de SPEI directo es OPCIONAL ──

test("M3 (caso 3 de t8): sin la tabla de SPEI directo, la compra mensual pagada en Stripe sigue mandando", async () => {
  checkout("cs_pagada_mensual", "monthly", "pagada");
  errorSpei = sinTablaSpei();
  assert.equal(await inferManualInterval(CLINIC), "month");
  const precios = { currentPlan: { priceMxn: 419, priceMxnAnnual: 3264 }, targetPlan: { priceMxn: 1489, priceMxnAnnual: 11614 } };
  const now = new Date("2026-11-02T12:00:00Z");
  const q = computeManualUpgradeQuote({ interval: await inferManualInterval(CLINIC), paidUntil: new Date(now.getTime() + 30 * 86_400_000), now, ...precios });
  assert.equal(q.diffCents, 107000);
});

test("M3: también con el 42P01 crudo de Postgres", async () => {
  checkout("cs_pagada_anual", "annual", "pagada");
  errorSpei = Object.assign(new Error('relation "spei_transfer_requests" does not exist'), { code: "P2010", meta: { code: "42P01" } });
  assert.equal(await inferManualInterval(CLINIC), "year");
});

test("M3: la ausencia se recuerda: la siguiente cotización no vuelve a consultar la tabla (no llena los logs de Postgres)", async () => {
  checkout("cs_pagada_mensual", "monthly", "pagada");
  errorSpei = sinTablaSpei();
  await inferManualInterval(CLINIC);
  await inferManualInterval(CLINIC);
  await inferManualInterval(CLINIC);
  assert.equal(consultasSpei, 1);
});

test("M3: otro error al leer SPEI directo (no «tabla inexistente») → null, como antes: no se adivina", async () => {
  checkout("cs_pagada_mensual", "monthly", "pagada");
  errorSpei = Object.assign(new Error("Timed out fetching a new connection from the connection pool"), { code: "P2024" });
  assert.equal(await inferManualInterval(CLINIC), null);
});
