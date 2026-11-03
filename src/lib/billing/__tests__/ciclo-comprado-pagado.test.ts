/**
 * EL CICLO COMPRADO SALE DE UN CHECKOUT PAGADO (ws1-t1, ola 2b, retenido de la auditoría run-2:
 * `billing/manual-upgrade:inferManualInterval-trusts-unpaid-checkout-billing-row`).
 *
 * Run: npm run test:billing
 *
 * `inferManualInterval` DE VERDAD con prisma y Stripe dobles (⛔ sin red ni base). El prorrateo del upgrade
 * de una clínica que paga SPEI/OXXO depende del ciclo que compró (mensual o anual). Ese ciclo se leía de la
 * fila de bitácora que deja /api/billing/checkout AL CREAR la sesión, pagada o no, y también de la que deja
 * el checkout de un MÓDULO (misma forma). Un pagador mensual que abría y abandonaba un checkout anual
 * pasaba a cotizar sus upgrades al precio por día anual (~36 % menos).
 */
import Module from "node:module";
import path from "node:path";
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { computeManualUpgradeQuote } from "@/lib/billing/proration";

const RAIZ = path.resolve(__dirname, "../../../..");
const CLINIC = "clinic_mensual";

let filas: Array<{ entityId: string; changes: any }>;
let sesiones: Map<string, any>;
let consultadas: string[];
let stripeFalla: boolean;

const prismaDoble: any = {
  auditLog: {
    findMany: async ({ where }: any) => {
      assert.equal(where.clinicId, CLINIC, "la bitácora se lee SOLO de la clínica");
      return filas.map((f) => ({ ...f }));
    },
  },
};

const stripeDoble: any = {
  checkout: {
    sessions: {
      retrieve: async (id: string) => {
        consultadas.push(id);
        if (stripeFalla) throw new Error("Stripe no contesta");
        const s = sesiones.get(id);
        if (!s) throw Object.assign(new Error("No such checkout.session"), { code: "resource_missing" });
        return s;
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
  sesiones = new Map();
  consultadas = [];
  stripeFalla = false;
});

/** La fila que deja /api/billing/checkout al crear la sesión (route.ts, logAudit tras crearla). */
function filaPlan(sessionId: string, billing: "monthly" | "annual") {
  return { entityId: sessionId, changes: { _created: { before: null, after: { plan: "BASIC", priceMxn: 419, billing, sessionId } } } };
}
/** La que deja /api/marketplace/module-checkout: misma forma, otro producto. */
function filaModulo(sessionId: string, billing: "monthly" | "annual") {
  return { entityId: sessionId, changes: { _created: { before: null, after: { moduleKey: "ortodoncia", billing, method: "spei", sessionId } } } };
}
/** La del diferencial de change-plan: sin `billing` (no es una compra). */
function filaDiferencial(sessionId: string) {
  return { entityId: sessionId, changes: { _created: { before: null, after: { event: "self-service-change-plan-manual-diff", interval: "year" } } } };
}
function sesion(id: string, pagada: boolean, billing: "monthly" | "annual", clinicId = CLINIC) {
  sesiones.set(id, { id, payment_status: pagada ? "paid" : "unpaid", metadata: { kind: "platform-subscription", clinicId, plan: "BASIC", billing } });
}

test("retenido: un checkout ANUAL abandonado (más reciente) no cambia el ciclo de quien pagó MENSUAL", async () => {
  filas = [filaPlan("cs_abandonada", "annual"), filaPlan("cs_pagada", "monthly")];
  sesion("cs_abandonada", false, "annual");
  sesion("cs_pagada", true, "monthly");
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

test("retenido (fase 5): la fila de un checkout de MÓDULO no es el ciclo del plan, ni pagada", async () => {
  filas = [filaModulo("cs_modulo", "annual"), filaPlan("cs_pagada", "monthly")];
  sesiones.set("cs_modulo", { id: "cs_modulo", payment_status: "paid", metadata: { kind: "module-subscription", clinicId: CLINIC, billing: "annual" } });
  sesion("cs_pagada", true, "monthly");
  assert.equal(await inferManualInterval(CLINIC), "month");
});

test("legítimo: quien PAGÓ el anual cotiza anual; las filas del diferencial se saltan", async () => {
  filas = [filaDiferencial("cs_diff1"), filaPlan("cs_anual", "annual"), filaPlan("cs_mensual_vieja", "monthly")];
  sesion("cs_anual", true, "annual");
  sesion("cs_mensual_vieja", true, "monthly");
  assert.equal(await inferManualInterval(CLINIC), "year");
  assert.deepEqual(consultadas, ["cs_anual"], "solo se pregunta a Stripe por filas de compra del plan, y se para en la primera pagada");
});

test("una sesión de OTRA clínica (fila manipulada o mal atribuida) no cuenta", async () => {
  filas = [filaPlan("cs_ajena", "annual"), filaPlan("cs_pagada", "monthly")];
  sesion("cs_ajena", true, "annual", "otra_clinica");
  sesion("cs_pagada", true, "monthly");
  assert.equal(await inferManualInterval(CLINIC), "month");
});

test("sin ninguna compra pagada confirmada: null (cotiza por el criterio conservador de siempre)", async () => {
  filas = [filaPlan("cs_abandonada", "annual")];
  sesion("cs_abandonada", false, "annual");
  assert.equal(await inferManualInterval(CLINIC), null);
});

test("si Stripe no contesta: null, no se adivina con una fila sin confirmar", async () => {
  filas = [filaPlan("cs_abandonada", "annual"), filaPlan("cs_pagada", "monthly")];
  stripeFalla = true;
  assert.equal(await inferManualInterval(CLINIC), null);
});

test("una sesión que Stripe ya no encuentra se salta y se sigue con la anterior", async () => {
  filas = [filaPlan("cs_borrada", "annual"), filaPlan("cs_pagada", "monthly")];
  sesion("cs_pagada", true, "monthly");
  assert.equal(await inferManualInterval(CLINIC), "month");
});

test("sin clinicId no se lee nada (Prisma descartaría el filtro)", async () => {
  assert.equal(await inferManualInterval(""), null);
});
