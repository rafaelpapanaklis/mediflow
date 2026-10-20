/**
 * «Pagar mi plan» y «Subir de plan y pagar» (ws1-t2) — sin base ni red: Stripe SIMULADO.
 * Run: npm run test:pago-pendiente
 *
 * Fija: pagar cobra la factura abierta tal cual (sin promo); subir ANULA la vieja y cambia la MISMA
 * suscripción cobrando el plan nuevo completo, sin promo, sin prorrateo y con el IVA de siempre; nunca
 * se crea otra suscripción; repetir no cobra dos veces; plan más chico → 400; sin permiso → 403;
 * tarjeta que falla → url; sin pendiente → 409.
 */
import "./_prisma-doble"; // PRIMERO: sustituye @/lib/prisma antes de cargar el código de la regla de suspensión
import { filasFactura } from "./_prisma-doble";
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import {
  MENSAJES,
  PREFIJO_CUPON_PROMO,
  claves,
  descuentosParaSubir,
  idsDeDescuentos,
  parsearCuerpo,
  planesMasGrandes,
} from "../pago-pendiente";
import { readFileSync } from "node:fs";
import path from "node:path";
import { chargeFailureMessage } from "../proration";
import { avisoCuponConFinRepuesto, mesesRestantes } from "../avisos-admin";
import { finDeLoPagado, reanudarCobroTrasRealinear, NOTA_SERVICIO_SUSPENDIDO } from "../cobro-rechazado";
import { aplicarReglaDeSuspension, facturasAbiertasDelPlan } from "../reactivacion-tras-suspension.server";
import { MENSAJES_CHECKOUT } from "../mensajes-pago";
import { ensureFirstMonthCoupon } from "../first-month-promo";
import { FIRST_MONTH_PROMO_MXN } from "@/lib/plan-shared";
import {
  consultarPendiente,
  pagarPendiente,
  subirYPagar,
  type DepsPago,
} from "../pago-pendiente.server";

const TASA = "txr_1PabcdefghijklmnOP";
const PLANES: Record<string, any> = {
  BASIC: { id: "BASIC", name: "Básico", priceMxn: 419, priceMxnAnnual: 3264 },
  PRO: { id: "PRO", name: "Profesional", priceMxn: 689, priceMxnAnnual: 5376 },
  CLINIC: { id: "CLINIC", name: "Clínica", priceMxn: 1719, priceMxnAnnual: 13404 },
};

interface Escenario {
  plan?: string;
  role?: string;
  interval?: "month" | "year";
  subStatus?: string;
  /** Facturas abiertas al inicio. */
  abiertas?: any[];
  /** El cobro (pay o factura nueva) falla con la tarjeta. */
  tarjetaFalla?: boolean;
  descuento?: any;
  /** Varios descuentos en la suscripción (el primero es el principal). */
  descuentos?: any[];
  /** Cuántos `invoices.voidInvoice` fallan de red. */
  voidFalla?: number;
  /** Cupón puesto en el CLIENTE de Stripe (no en la suscripción). */
  descuentoCliente?: any;
  /** `customers.deleteDiscount` falla de red. */
  deleteDiscountFalla?: boolean;
  /** `customers.update` (reponer el cupón) falla de red. */
  reponerFalla?: boolean;
  /** `invoices.update` (marcar) falla de red. */
  marcarFalla?: boolean;
  /** Candado por clínica REAL (en memoria, como failban sin Upstash); por defecto abre siempre. */
  candadoReal?: boolean;
  /**
   * Otra pestaña tiene en curso la MISMA operación: Stripe rechaza esta petición con idempotency_error (409), como
   * hace con una clave que sigue en curso. Mientras tanto la otra pestaña la termina (`otraPestaña`).
   */
  clavePropiaEnCurso?: "anular" | "cambiar";
  /** `subscriptions.retrieve` falla a partir de la N-ésima llamada (para «no se pudo comprobar»). */
  retrieveFallaDesde?: number;
  /** La clínica estaba SUSPENDIDA al pagar (periodo vencido y cobro rechazado); por defecto está en la gracia de 24 h. */
  suspendida?: boolean;
  /** El cobro de la suscripción está EN PAUSA en Stripe (prepago de varios meses, o ciclo re-alineado). */
  pausaCobro?: { behavior: string; resumes_at: number };
  /** La factura del cambio de plan nace ANULADA (cobro en pausa que no se vio). */
  facturaNuevaAnulada?: boolean;
  /** Estado de cobro que `releerEstadoClinica` devuelve (la clínica cambió mientras «Pagar» esperaba el candado). */
  estadoReleido?: { subscriptionStatus?: string | null; trialEndsAt?: Date | string | null };
  /** Qué hace la espera entre intentos del candado (por defecto cede el turno a los demás; así la otra petición avanza). */
  alEsperar?: () => void | Promise<void>;
  /** La suscripción ya trae este plan en su metadata (el cambio llegó a Stripe antes). */
  planEnSuscripcion?: string;
  /** Excedente de CFDI ya sumado «a la próxima mensualidad» (items pendientes del cliente). */
  excedentePendiente?: boolean;
  /** `invoiceItems.list` falla de red. */
  excedenteFalla?: boolean;
  /** El cliente de la suscripción es OTRO cliente de Stripe. */
  clienteAjeno?: boolean;
  stripeCaido?: boolean;
  /** Cuántos `subscriptions.update` fallan de red ANTES de llegar a Stripe (el cambio no se aplica). */
  updateFallaAntes?: number;
  /** Cuántos `subscriptions.update` SÍ se aplican en Stripe pero la respuesta se pierde (error de red). */
  updateRespuestaPerdida?: number;
  sinSub?: boolean;
  sedeIncluida?: boolean;
  sedesBloquean?: string | null;
  env?: Record<string, string | undefined>;
  exencion?: any;
}

const FACTURA_VIEJA = { id: "in_vieja", status: "open", amount_due: 4861, currency: "mxn", hosted_invoice_url: "https://pay.stripe.test/in_vieja", customer: "cus_1", created: 100, attempt_count: 2, billing_reason: "subscription_cycle" };

function montar(e: Escenario = {}) {
  const llamadas: { op: string; args: any[] }[] = [];
  const registra = (op: string, ...args: any[]) => llamadas.push({ op, args });
  const facturas = new Map<string, any>((e.abiertas ?? [FACTURA_VIEJA]).map((f) => [f.id, { ...f }]));
  let planLocal: string | null = null;
  let planSub = e.planEnSuscripcion ?? e.plan ?? "BASIC"; // el plan que Stripe tiene en la metadata de la suscripción
  let fallasAntes = e.updateFallaAntes ?? 0;
  let fallasVoid = e.voidFalla ?? 0;
  let descuentoCliente: any = e.descuentoCliente ?? null; // el que Stripe aplicaría a la factura nueva
  let borrado: any = null; // el último cupón del cliente que se quitó (para poder reponerlo)
  const avisos: Array<{ asunto: string; lineas: string[] }> = [];
  const candados = new Map<string, { hasta: number; dueno: string }>();
  let retrieves = 0;
  let otraPestanaActuo = false;
  let pausa: any = e.pausaCobro ?? null; // pause_collection de la suscripción en Stripe
  let reinicios = 0; // cuántas veces Stripe aplicó DE VERDAD un reinicio de ciclo (las repeticiones con la misma clave no cuentan)
  const reiniciosPorClave = new Map<string, any>();
  const PAGADO_EN = Math.floor(new Date("2026-10-20T15:00:00Z").getTime() / 1000);
  const idemEnCurso = () => Object.assign(new Error("There is currently another in-progress request using this Stripe idempotency key."), { type: "StripeIdempotencyError", code: "idempotency_error", statusCode: 409 });
  /** La otra pestaña termina la subida (anula/cambia el plan y se cobra) mientras esta petición choca con su clave. */
  const otraPestanaTermina = (plan: string) => {
    if (otraPestanaActuo) return;
    otraPestanaActuo = true;
    const f = facturas.get("in_vieja");
    if (f && f.status !== "void") f.status = "void";
    planSub = plan;
    facturas.set("in_nueva", {
      id: "in_nueva", status: "paid", amount_due: descuentoCliente ? 63939 : 79924, total: descuentoCliente ? 63939 : 79924,
      currency: "mxn", hosted_invoice_url: "https://pay.stripe.test/in_nueva", customer: "cus_1", created: 200,
    });
    cobrosAplicados++;
  };
  const parametrosPorClave = new Map<string, string>(); // idempotencia de invoices.update, como Stripe
  let respuestasPerdidas = e.updateRespuestaPerdida ?? 0;
  const auditorias: any[] = [];
  const cobrosPorClave = new Map<string, any>();
  let cobrosDeTarjeta = 0; // cuántas veces se cobró la tarjeta con invoices.pay (cada factura una sola vez)
  let cobrosAplicados = 0; // cuántas veces Stripe aplicó de verdad el cambio (= cuántas facturas nuevas)

  const cuestaCaer = () => {
    if (e.stripeCaido) throw Object.assign(new Error("connection reset"), { type: "StripeConnectionError" });
  };
  const rechazo = () => Object.assign(new Error("Your card was declined."), { type: "StripeCardError", code: "card_declined" });

  const stripe: any = {
    subscriptions: {
      retrieve: async (id: string) => {
        registra("subscriptions.retrieve", id);
        cuestaCaer();
        retrieves++;
        if (e.retrieveFallaDesde && retrieves >= e.retrieveFallaDesde) {
          throw Object.assign(new Error("connection reset"), { type: "StripeConnectionError" });
        }
        return {
          id,
          status: e.subStatus ?? "past_due",
          // `customer` viene EXPANDIDO (con su descuento), como lo pide el servicio.
          customer: { id: e.clienteAjeno ? "cus_otro" : "cus_1", discount: descuentoCliente },
          metadata: { clinicId: "clin_1", plan: planSub, kind: "platform-subscription" },
          pause_collection: pausa,
          items: { data: [{ id: "si_1", price: { unit_amount: 41900, recurring: { interval: e.interval ?? "month" } } }] },
          // `discounts` viene EXPANDIDO (con su cupón), como lo pide el servicio.
          discount: (e.descuentos ?? (e.descuento ? [e.descuento] : []))[0] ?? null,
          discounts: e.descuentos ?? (e.descuento ? [e.descuento] : []),
        };
      },
      update: async (id: string, params: any, opts: any) => {
        registra("subscriptions.update", id, params, opts);
        cuestaCaer();
        // Reinicio de ciclo de la regla de la suspensión (billing_cycle_anchor "now" + pausa con void): la factura que
        // nace durante la pausa se anula. Misma clave → misma respuesta (como Stripe).
        if (params.pause_collection) {
          const previaR = reiniciosPorClave.get(opts.idempotencyKey);
          if (previaR) return previaR;
          reinicios++;
          pausa = params.pause_collection;
          const r = { id, status: "active", pause_collection: pausa, latest_invoice: { id: `in_reinicio_${reinicios}`, status: "void", amount_paid: 0 } };
          reiniciosPorClave.set(opts.idempotencyKey, r);
          return r;
        }
        // Mismo idempotencyKey → misma respuesta (como Stripe): no genera otra factura.
        const previa = cobrosPorClave.get(opts.idempotencyKey);
        if (previa) return previa;
        if (e.clavePropiaEnCurso === "cambiar") {
          otraPestanaTermina(params.metadata.plan);
          throw idemEnCurso();
        }
        if (fallasAntes > 0) {
          fallasAntes--;
          throw Object.assign(new Error("connection reset"), { type: "StripeConnectionError" });
        }
        const nueva = {
          id: "in_nueva",
          status: e.facturaNuevaAnulada ? "void" : e.tarjetaFalla ? "open" : "paid",
          billing_reason: "subscription_update",
          // Lo que Stripe cobraría: lista + IVA de PRO (799.24), con el descuento del cliente si siguiera puesto.
          amount_due: descuentoCliente ? 63939 : 79924,
          total: descuentoCliente ? 63939 : 79924,
          currency: "mxn",
          hosted_invoice_url: "https://pay.stripe.test/in_nueva",
          customer: "cus_1",
          created: 200,
        };
        facturas.set(nueva.id, nueva);
        const r = { id, status: e.tarjetaFalla ? "past_due" : "active", items: { data: [] }, latest_invoice: nueva };
        cobrosPorClave.set(opts.idempotencyKey, r);
        planSub = params.metadata.plan;
        cobrosAplicados++;
        if (respuestasPerdidas > 0) {
          respuestasPerdidas--;
          throw Object.assign(new Error("connection reset"), { type: "StripeConnectionError" });
        }
        return r;
      },
    },
    invoices: {
      update: async (id: string, p: any, opts: any) => {
        registra("invoices.update", id, p, opts);
        cuestaCaer();
        if (e.marcarFalla) throw Object.assign(new Error("connection reset"), { type: "StripeConnectionError" });
        // Stripe: la misma clave con OTROS parámetros se rechaza (idempotency_error) durante 24 h.
        const huella = JSON.stringify([id, p]);
        const previa = parametrosPorClave.get(opts.idempotencyKey);
        if (previa !== undefined && previa !== huella) {
          throw Object.assign(new Error("Keys for idempotent requests can only be used with the same parameters they were first used with."), {
            type: "StripeIdempotencyError", code: "idempotency_error",
          });
        }
        parametrosPorClave.set(opts.idempotencyKey, huella);
        facturas.get(id).metadata = { ...(facturas.get(id).metadata ?? {}), ...p.metadata };
        return facturas.get(id);
      },
      list: async (p: any) => {
        registra("invoices.list", p);
        cuestaCaer();
        return { data: [...facturas.values()].filter((f) => f.status === p.status) };
      },
      retrieve: async (id: string) => {
        registra("invoices.retrieve", id);
        return facturas.get(id);
      },
      pay: async (id: string, params: any, opts: any) => {
        registra("invoices.pay", id, params, opts);
        cuestaCaer();
        const previa = cobrosPorClave.get(opts.idempotencyKey);
        if (previa) return previa;
        const f = facturas.get(id);
        if (e.tarjetaFalla) {
          f.attempt_count = (f.attempt_count ?? 0) + 1;
          throw rechazo();
        }
        f.status = "paid";
        f.status_transitions = { paid_at: PAGADO_EN };
        cobrosPorClave.set(opts.idempotencyKey, { ...f });
        cobrosDeTarjeta++;
        return { ...f };
      },
      create: async (p: any, opts: any) => {
        registra("invoices.create", p, opts);
        cuestaCaer();
        return { id: "in_excedente_aparte" };
      },
      voidInvoice: async (id: string, _p: any, opts: any) => {
        registra("invoices.voidInvoice", id, opts);
        cuestaCaer();
        if (e.clavePropiaEnCurso === "anular") throw idemEnCurso(); // la otra pestaña sigue en curso; termina después (`otraTermina`)
        if (fallasVoid > 0) {
          fallasVoid--;
          throw Object.assign(new Error("connection reset"), { type: "StripeConnectionError" });
        }
        facturas.get(id).status = "void";
        return facturas.get(id);
      },
    },
    // Lo que usa `realinearCiclo` (t1, V3): separar el excedente de CFDI pendiente antes de reiniciar el ciclo.
    invoiceItems: {
      list: async (p: any) => {
        registra("invoiceItems.list", p);
        cuestaCaer();
        if (e.excedenteFalla) throw Object.assign(new Error("connection reset"), { type: "StripeConnectionError" });
        return { data: e.excedentePendiente ? [{ id: "ii_excedente", subscription: null }] : [] };
      },
    },
    customers: {
      deleteDiscount: async (id: string, p: any, opts: any) => {
        registra("customers.deleteDiscount", id, p, opts);
        cuestaCaer();
        if (e.deleteDiscountFalla) throw Object.assign(new Error("connection reset"), { type: "StripeConnectionError" });
        if (!descuentoCliente) {
          throw Object.assign(new Error("No such customer discount"), { type: "StripeInvalidRequestError", code: "resource_missing" });
        }
        borrado = descuentoCliente;
        descuentoCliente = null;
        return { deleted: true };
      },
      update: async (id: string, p: any, opts: any) => {
        registra("customers.update", id, p, opts);
        cuestaCaer();
        if (e.reponerFalla) throw Object.assign(new Error("connection reset"), { type: "StripeConnectionError" });
        const mismo = borrado && (p.coupon === borrado.coupon?.id || p.promotion_code === borrado.promotion_code);
        if (!mismo) throw Object.assign(new Error("No such coupon"), { type: "StripeInvalidRequestError", code: "resource_missing" });
        descuentoCliente = { ...borrado, id: "di_repuesto" }; // Stripe crea un descuento nuevo con el mismo cupón
        return { id };
      },
    },
    prices: {
      create: async (p: any, opts: any) => {
        registra("prices.create", p, opts);
        return { id: "price_nuevo" };
      },
    },
    // Si algo intentara crear OTRA suscripción, un cupón o una sesión, la prueba lo ve.
    checkout: { sessions: { create: async () => registra("checkout.sessions.create") } },
    coupons: { create: async () => registra("coupons.create") },
  };
  const stripeConLaTrampa = new Proxy(stripe, {
    get(t, k) {
      if (k === "subscriptions") {
        return new Proxy(t.subscriptions, { get: (s, m) => (m === "create" ? (() => registra("subscriptions.create")) : (s as any)[m]) });
      }
      return (t as any)[k];
    },
  });

  const deps: DepsPago = {
    stripe: stripeConLaTrampa,
    role: e.role ?? "SUPER_ADMIN",
    clinica: {
      id: "clin_1",
      nombre: "Clínica Prueba",
      // Gracia de 24 h (past_due con acceso por delante) salvo que la prueba pida «suspendida» (periodo vencido).
      subscriptionStatus: "past_due",
      trialEndsAt: e.suspendida ? new Date("2026-09-01T00:00:00Z") : new Date(Date.now() + 20 * 3_600_000),
      plan: e.plan ?? "BASIC",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: e.sinSub ? null : "sub_1",
    },
    env: e.env ?? { STRIPE_IVA_TAX_RATE_ID: TASA },
    plan: async (id) => PLANES[id],
    bloqueoDeSedes: async () => e.sedesBloquean ?? null,
    sedeIncluida: async () => (e.sedeIncluida ? { pagadoraId: "madre", pagadoraNombre: "Madre" } : null),
    exencionIva: async () => e.exencion ?? null,
    aplicarPlanLocal: async (p) => { planLocal = p; },
    auditar: async (ev) => { auditorias.push(ev); },
    avisoSedeIncluida: (n) => `paga ${n}`,
    avisarAlAdmin: async (a) => { avisos.push(a); },
    // Entre intentos del candado cede el turno (macrotarea): la otra petición, que solo espera promesas, avanza.
    esperar: async () => {
      registra("esperar");
      await (e.alEsperar ? e.alEsperar() : new Promise<void>((r) => setImmediate(r)));
    },
    ...(e.estadoReleido ? { releerEstadoClinica: async () => e.estadoReleido! } : {}),
    candado: e.candadoReal
      ? {
          // Como failban: SET NX con caducidad y DUEÑO (aquí en memoria); soltar solo si sigue siendo suyo.
          tomar: async (clave, ttlSec, dueno) => {
            registra("candado.tomar", clave, ttlSec, dueno);
            const actual = candados.get(clave);
            if (actual && actual.hasta > Date.now()) return false;
            candados.set(clave, { hasta: Date.now() + ttlSec * 1000, dueno });
            return true;
          },
          soltar: async (clave, dueno) => {
            registra("candado.soltar", clave, dueno);
            if (candados.get(clave)?.dueno === dueno) candados.delete(clave);
          },
        }
      : { tomar: async () => true, soltar: async () => {} },
  };
  const ops = (op: string) => llamadas.filter((l) => l.op === op);
  return {
    deps, llamadas, ops, auditorias, facturas,
    planLocal: () => planLocal,
    cobros: () => cobrosAplicados,
    reinicios: () => reinicios,
    cobrosDeTarjeta: () => cobrosDeTarjeta,
    pausa: () => pausa,
    stripe,
    PAGADO_EN,
    avisos,
    candados,
    /** La otra pestaña termina su subida (anula, cambia el plan y se cobra). */
    otraTermina: () => otraPestanaTermina("PRO"),
    descuentoDelCliente: () => descuentoCliente,
    planSub: () => planSub,
  };
}

// ── GET ─────────────────────────────────────────────────────────────────────

test("GET: con una factura abierta → pendiente, monto exacto y opciones más grandes con IVA", async () => {
  const m = montar();
  const r = await consultarPendiente(m.deps);
  assert.equal(r.status, 200);
  assert.equal(r.body.estado, "pendiente");
  assert.equal(r.body.planActual, "BASIC");
  assert.equal(r.body.montoPendiente, 48.61);
  assert.equal(r.body.moneda, "MXN");
  assert.deepEqual(r.body.opcionesSubir, [
    { plan: "PRO", nombre: "Profesional", monto: 799.24, ivaIncluido: true }, // 689 + 16 %
    { plan: "CLINIC", nombre: "Clínica", monto: 1994.04, ivaIncluido: true }, // 1719 + 16 %
  ]);
  // Solo lee: nada se cobra ni se anula.
  assert.equal(m.ops("invoices.pay").length + m.ops("invoices.voidInvoice").length + m.ops("subscriptions.update").length, 0);
});

test("GET: el monto sigue el intervalo de la suscripción (anual sigue anual)", async () => {
  const m = montar({ interval: "year" });
  const r = await consultarPendiente(m.deps);
  assert.equal((r.body.opcionesSubir as any[])[0].monto, 6236.16); // 5376 × 1.16
});

test("GET: sin factura abierta, sin suscripción o suscripción cancelada → sin_pendiente", async () => {
  for (const e of [{ abiertas: [] }, { sinSub: true }, { subStatus: "canceled" }, { sedeIncluida: true }] as Escenario[]) {
    const r = await consultarPendiente(montar(e).deps);
    assert.deepEqual(r, { status: 200, body: { estado: "sin_pendiente" } });
  }
});

test("GET: un plan que las sedes no admiten no se ofrece; en el más grande no hay opciones", async () => {
  assert.deepEqual(((await consultarPendiente(montar({ sedesBloquean: "hay sedes" }).deps)).body.opcionesSubir), []);
  assert.deepEqual(((await consultarPendiente(montar({ plan: "CLINIC" }).deps)).body.opcionesSubir), []);
});

test("GET: sin permiso → 403; Stripe caído → 502", async () => {
  assert.equal((await consultarPendiente(montar({ role: "RECEPTIONIST" }).deps)).status, 403);
  assert.equal((await consultarPendiente(montar({ stripeCaido: true }).deps)).status, 502);
});

// ── pagar ───────────────────────────────────────────────────────────────────

test("pagar: cobra la factura abierta del plan actual con el método guardado — sin promo, sin otra suscripción", async () => {
  const m = montar();
  const r = await pagarPendiente(m.deps);
  assert.deepEqual(r, { status: 200, body: { ok: true, pagado: true } });
  const pagos = m.ops("invoices.pay");
  assert.equal(pagos.length, 1);
  assert.equal(pagos[0].args[0], "in_vieja");
  assert.deepEqual(pagos[0].args[1], {}); // sin forzar otro método ni otro monto
  // Nada que cree promo, suscripciones, precios o sesiones; tampoco cambia el plan.
  for (const op of ["subscriptions.create", "subscriptions.update", "coupons.create", "checkout.sessions.create", "prices.create", "invoices.voidInvoice"]) {
    assert.equal(m.ops(op).length, 0, op);
  }
  assert.equal(m.planLocal(), null);
  assert.equal(m.auditorias.length, 1);
});

test("pagar: repetir el POST no cobra dos veces (misma clave de idempotencia → un solo cobro)", async () => {
  const m = montar();
  const [a, b] = await Promise.all([pagarPendiente(m.deps), pagarPendiente(m.deps)]);
  assert.equal(a.body.pagado, true);
  assert.equal(b.body.pagado, true);
  const claves2 = m.ops("invoices.pay").map((l) => l.args[2].idempotencyKey);
  assert.equal(new Set(claves2).size, 1);
  assert.equal(claves2[0], "pago-pendiente:pagar:clin_1:in_vieja:2");
  // La factura se pagó una sola vez en el "Stripe" simulado.
  assert.equal(m.facturas.get("in_vieja").status, "paid");
});

test("pagar: ya pagada, un tercer POST no encuentra pendiente → 409 y no cobra", async () => {
  const m = montar();
  await pagarPendiente(m.deps);
  const r = await pagarPendiente(m.deps);
  assert.equal(r.status, 409);
  assert.equal(m.ops("invoices.pay").length, 1);
});

test("pagar: la tarjeta vuelve a fallar → url de la factura; el reintento usa clave nueva (no el rechazo cacheado)", async () => {
  const m = montar({ tarjetaFalla: true });
  const r = await pagarPendiente(m.deps);
  assert.deepEqual(r, { status: 200, body: { ok: true, pagado: false, url: "https://pay.stripe.test/in_vieja" } });
  const r2 = await pagarPendiente(m.deps);
  assert.equal(r2.body.pagado, false);
  const ks = m.ops("invoices.pay").map((l) => l.args[2].idempotencyKey);
  assert.equal(ks.length, 2);
  assert.notEqual(ks[0], ks[1]); // attempt_count subió
});

test("pagar: sin permiso → 403 antes de tocar Stripe; sin pendiente → 409; Stripe caído → 502; sin Stripe configurado → 503", async () => {
  const sinPermiso = montar({ role: "DOCTOR" });
  assert.equal((await pagarPendiente(sinPermiso.deps)).status, 403);
  assert.equal(sinPermiso.llamadas.length, 0);
  assert.equal((await pagarPendiente(montar({ abiertas: [] }).deps)).status, 409);
  assert.equal((await pagarPendiente(montar({ sinSub: true }).deps)).status, 409);
  assert.equal((await pagarPendiente(montar({ stripeCaido: true }).deps)).status, 502);
  const sinStripe = montar();
  sinStripe.deps.stripe = null;
  assert.equal((await pagarPendiente(sinStripe.deps)).status, 503);
});

test("pagar: una sede incluida no paga (409 SEDE_INCLUIDA)", async () => {
  const r = await pagarPendiente(montar({ sedeIncluida: true }).deps);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "SEDE_INCLUIDA");
});

// ── subir ───────────────────────────────────────────────────────────────────

test("subir: anula la factura vieja y cambia la MISMA suscripción al plan nuevo, completo y sin prorrateo", async () => {
  const m = montar();
  const r = await subirYPagar(m.deps, "PRO");
  assert.deepEqual(r, { status: 200, body: { ok: true, pagado: true } });

  // 1) la vieja se anula (void), no se borra; 2) un solo update sobre la suscripción de la clínica.
  assert.deepEqual(m.ops("invoices.voidInvoice").map((l) => l.args[0]), ["in_vieja"]);
  assert.equal(m.facturas.get("in_vieja").status, "void");
  const updates = m.ops("subscriptions.update");
  assert.equal(updates.length, 1);
  assert.equal(updates[0].args[0], "sub_1");
  const p = updates[0].args[1];
  assert.equal(p.billing_cycle_anchor, "now");
  assert.equal(p.proration_behavior, "none");
  assert.equal(p.payment_behavior, undefined); // no revierte si la tarjeta falla
  assert.deepEqual(p.items, [{ id: "si_1", price: "price_nuevo", tax_rates: [TASA] }]); // IVA de siempre
  assert.equal(p.metadata.plan, "PRO");
  assert.equal(p.metadata.clinicId, "clin_1");
  assert.equal(p.discounts, undefined);
  // Orden: anular antes de cambiar.
  const orden = m.llamadas.map((l) => l.op);
  assert.ok(orden.indexOf("invoices.voidInvoice") < orden.indexOf("subscriptions.update"));
  // Nunca otra suscripción, cupón ni sesión.
  for (const op of ["subscriptions.create", "coupons.create", "checkout.sessions.create", "invoices.pay"]) {
    assert.equal(m.ops(op).length, 0, op);
  }
  // El plan local se refleja y queda una fila en la bitácora.
  assert.equal(m.planLocal(), "PRO");
  assert.equal(m.auditorias.at(-1).event, "pago-pendiente-subir");
});

test("subir: el price nuevo es el de LISTA del plan (nunca la promo $19/$29/$39), en el intervalo de la suscripción", async () => {
  const mensual = montar();
  await subirYPagar(mensual.deps, "CLINIC");
  const pm = mensual.ops("prices.create")[0].args[0];
  assert.equal(pm.unit_amount, 171900);
  assert.equal(pm.recurring.interval, "month");
  assert.ok(!Object.values(FIRST_MONTH_PROMO_MXN).includes(pm.unit_amount / 100));

  const anual = montar({ interval: "year" });
  await subirYPagar(anual.deps, "PRO");
  const pa = anual.ops("prices.create")[0].args[0];
  assert.equal(pa.unit_amount, 537600);
  assert.equal(pa.recurring.interval, "year");
});

test("subir: si la suscripción aún arrastra la promo del primer mes, se le quita (junto con cualquier otro descuento: decisión de Rafael #10)", async () => {
  const promo = { id: "di_promo", coupon: { id: `${PREFIJO_CUPON_PROMO}iva-basic-39000` } };
  const m = montar({ descuento: promo });
  await subirYPagar(m.deps, "PRO");
  assert.equal(m.ops("subscriptions.update")[0].args[1].discounts, "");
  assert.equal(descuentosParaSubir({ discount: promo, discounts: ["di_promo", "di_otro"] }), "");
});

test("el prefijo de la promo es el que usa ensureFirstMonthCoupon (si cambia, esto avisa)", async () => {
  const creados: string[] = [];
  const stripe: any = {
    coupons: {
      retrieve: async () => { throw Object.assign(new Error("no"), { code: "resource_missing" }); },
      create: async (p: any) => { creados.push(p.id); },
    },
  };
  await ensureFirstMonthCoupon(stripe, { id: "BASIC", name: "Básico", priceMxnMonthly: 419 }, { conIva: false });
  await ensureFirstMonthCoupon(stripe, { id: "BASIC", name: "Básico", priceMxnMonthly: 419 }, { conIva: true });
  assert.equal(creados.length, 2);
  for (const id of creados) assert.ok(id.startsWith(PREFIJO_CUPON_PROMO), id);
});

test("subir: el IVA sigue la regla del cambio de plan — con IVA aun siendo clínica de las de antes; sin IVA configurado, 503 sin anular nada", async () => {
  const deAntes = montar({ exencion: { plan: "BASIC", tarjeta: true } }); // exenta, pero de SU plan
  const o = await consultarPendiente(deAntes.deps);
  assert.equal((o.body.opcionesSubir as any[])[0].ivaIncluido, true);
  await subirYPagar(deAntes.deps, "PRO");
  assert.deepEqual(deAntes.ops("subscriptions.update")[0].args[1].items[0].tax_rates, [TASA]);

  const sinIva = montar({ env: {} });
  const r = await subirYPagar(sinIva.deps, "PRO");
  assert.equal(r.status, 503);
  assert.equal(sinIva.ops("invoices.voidInvoice").length, 0);
  assert.equal(sinIva.ops("subscriptions.update").length, 0);
  assert.equal(sinIva.facturas.get("in_vieja").status, "open");

  const auto = montar({ env: { STRIPE_AUTOMATIC_TAX: "true" } });
  await subirYPagar(auto.deps, "PRO");
  const pa = auto.ops("subscriptions.update")[0].args[1];
  assert.deepEqual(pa.automatic_tax, { enabled: true });
  assert.equal(pa.items[0].tax_rates, undefined);
});

test("subir: repetir el POST no cobra dos veces (una sola actualización efectiva, misma clave)", async () => {
  const m = montar();
  const [a, b] = await Promise.all([subirYPagar(m.deps, "PRO"), subirYPagar(m.deps, "PRO")]);
  assert.equal(a.body.pagado, true);
  assert.equal(b.body.pagado, true);
  const ks = m.ops("subscriptions.update").map((l) => l.args[2].idempotencyKey);
  assert.equal(new Set(ks).size, 1);
  assert.equal(ks[0], claves.subir("clin_1", "in_vieja", "PRO"));
  // Un tercer intento ya no encuentra la factura vieja abierta: no hay nada que cobrar.
  const c = await subirYPagar(m.deps, "CLINIC");
  assert.equal(c.status, 409);
  assert.equal(m.facturas.get("in_nueva").status, "paid");
});

test("subir: plan igual o más chico → 400, sin tocar Stripe", async () => {
  for (const [plan, destino] of [["PRO", "BASIC"], ["PRO", "PRO"], ["CLINIC", "PRO"], ["BASIC", "BASIC"]] as const) {
    const m = montar({ plan });
    const r = await subirYPagar(m.deps, destino);
    assert.equal(r.status, 400, `${plan}→${destino}`);
    assert.equal(r.body.code, "PLAN_NO_MAS_GRANDE");
    assert.equal(m.llamadas.length, 0);
  }
});

test("subir: sin permiso → 403 sin tocar Stripe", async () => {
  for (const role of ["DOCTOR", "RECEPTIONIST", "ASSISTANT", null]) {
    const m = montar();
    m.deps.role = role;
    assert.equal((await subirYPagar(m.deps, "PRO")).status, 403);
    assert.equal(m.llamadas.length, 0);
  }
  assert.equal((await subirYPagar(montar({ role: "ADMIN" }).deps, "PRO")).status, 200);
});

test("subir: sin pendiente → 409; sedes que bloquean → 409 y no se anula nada", async () => {
  assert.equal((await subirYPagar(montar({ abiertas: [] }).deps, "PRO")).status, 409);
  const bloqueo = montar({ sedesBloquean: "Tienes sedes activas" });
  const r = await subirYPagar(bloqueo.deps, "PRO");
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "SEDES_ACTIVAS");
  assert.equal(bloqueo.ops("invoices.voidInvoice").length, 0);
});

test("subir: la tarjeta falla en el cobro nuevo → url de la factura nueva (el plan ya es el nuevo, la factura vieja queda anulada)", async () => {
  const m = montar({ tarjetaFalla: true });
  const r = await subirYPagar(m.deps, "PRO");
  assert.deepEqual(r, { status: 200, body: { ok: true, pagado: false, url: "https://pay.stripe.test/in_nueva" } });
  assert.equal(m.facturas.get("in_vieja").status, "void");
  assert.equal(m.auditorias.at(-1).pagado, false);
});

test("subir: Stripe no contesta → 502 y, si falla antes de anular, la factura vieja sigue abierta", async () => {
  const m = montar({ stripeCaido: true });
  assert.equal((await subirYPagar(m.deps, "PRO")).status, 502);
  assert.equal(m.facturas.get("in_vieja").status, "open");
  assert.equal(m.ops("subscriptions.update").length, 0);
});

test("subir: la suscripción de OTRO cliente de Stripe no se toma como pendiente", async () => {
  const m = montar({ abiertas: [{ ...FACTURA_VIEJA, customer: "cus_otro" }] });
  assert.equal((await subirYPagar(m.deps, "PRO")).status, 409);
  assert.equal(m.ops("invoices.voidInvoice").length, 0);
});

// ── subir: cambio a medias (void OK + update falla) ────────────────────────

test("subir: void OK + update falla de red → 502, la factura vieja queda marcada y anulada; el reintento termina el cambio y cobra UNA vez", async () => {
  const m = montar({ updateFallaAntes: 1 });
  const r1 = await subirYPagar(m.deps, "PRO");
  assert.equal(r1.status, 502);
  const vieja = m.facturas.get("in_vieja");
  assert.equal(vieja.status, "void");
  assert.equal(vieja.metadata.pago_pendiente_subir, "PRO");
  assert.equal(vieja.metadata.pago_pendiente_subir_desde, "BASIC");
  assert.equal(vieja.metadata.pago_pendiente_subir_clave, claves.subir("clin_1", "in_vieja", "PRO"));
  assert.equal(m.cobros(), 0);

  // El GET lo refleja: pendiente, con la opción de terminar el cambio y SIN factura que «pagar».
  const g = await consultarPendiente(m.deps);
  assert.equal(g.body.estado, "pendiente");
  assert.deepEqual(g.body.cambioEnCurso, { plan: "PRO" });
  assert.equal(g.body.montoPendiente, 48.61);
  assert.ok((g.body.opcionesSubir as any[]).some((o) => o.plan === "PRO"));
  assert.equal((await pagarPendiente(m.deps)).status, 409); // no hay factura abierta que pagar

  // Reintento: no vuelve a anular ni a marcar; hace el update y cobra.
  const r2 = await subirYPagar(m.deps, "PRO");
  assert.deepEqual(r2, { status: 200, body: { ok: true, pagado: true } });
  assert.equal(m.ops("invoices.voidInvoice").length, 1);
  assert.equal(m.ops("invoices.update").length, 1);
  assert.equal(m.ops("subscriptions.update").length, 2);
  assert.equal(m.cobros(), 1);
  assert.equal(m.planSub(), "PRO");
  assert.equal(m.planLocal(), "PRO");
  assert.equal(m.auditorias.at(-1).reintento, true);
  assert.equal(m.ops("subscriptions.create").length, 0);
});

test("subir: el reintento puede elegir otro plan más grande mientras la suscripción no se haya movido", async () => {
  const m = montar({ updateFallaAntes: 1 });
  await subirYPagar(m.deps, "PRO");
  const r = await subirYPagar(m.deps, "CLINIC");
  assert.equal(r.body.pagado, true);
  assert.equal(m.planSub(), "CLINIC");
  assert.equal(m.cobros(), 1);
});

test("subir: el update SÍ llegó a Stripe pero la respuesta se perdió → el reintento NO cobra de nuevo", async () => {
  const m = montar({ updateRespuestaPerdida: 1 });
  const r1 = await subirYPagar(m.deps, "PRO");
  assert.equal(r1.status, 502); // la factura nueva (pagada) ya existe en Stripe; la clínica aún no lo sabe
  assert.equal(m.cobros(), 1);
  assert.equal(m.planSub(), "PRO");

  // La suscripción ya está en PRO: ni la anulada se recupera (GET → sin_pendiente) ni subir vuelve a cobrar.
  assert.deepEqual(await consultarPendiente(m.deps), { status: 200, body: { estado: "sin_pendiente" } });
  const r2 = await subirYPagar(m.deps, "PRO");
  assert.equal(r2.status, 409);
  assert.equal(m.cobros(), 1);
  assert.equal(m.ops("subscriptions.update").length, 1);
});

test("subir: ya quedó hecho (pagado y plan local al día) → un reintento no cobra de nuevo ni reabre nada", async () => {
  const m = montar();
  await subirYPagar(m.deps, "PRO");
  assert.equal(m.cobros(), 1);
  m.deps.clinica.plan = "PRO"; // la ruta lee el plan local ya actualizado
  for (const destino of ["PRO", "CLINIC"] as const) {
    const r = await subirYPagar(m.deps, destino);
    assert.notEqual(r.status, 200, destino);
  }
  assert.equal(m.cobros(), 1);
  assert.equal(m.ops("subscriptions.update").length, 1);
  assert.deepEqual(await consultarPendiente(m.deps), { status: 200, body: { estado: "sin_pendiente" } });
});

test("subir: el update llegó a Stripe, la tarjeta falló y no se escribió el plan local → el reintento no anula la factura nueva ni cobra otra vez", async () => {
  const m = montar({ tarjetaFalla: true });
  await subirYPagar(m.deps, "PRO");
  m.deps.clinica.plan = "BASIC"; // el plan local no se alcanzó a escribir
  const r = await subirYPagar(m.deps, "PRO");
  assert.deepEqual(r, { status: 200, body: { ok: true, pagado: false, url: "https://pay.stripe.test/in_nueva" } });
  assert.equal(m.ops("invoices.voidInvoice").length, 1); // solo la vieja
  assert.equal(m.ops("subscriptions.update").length, 1);
  assert.equal(m.facturas.get("in_nueva").status, "open");
  assert.equal(m.planLocal(), "PRO");
});

test("subir: una anulada de hace más de 24 h, de otro flujo o de otro cliente NO se recupera", async () => {
  // Más de 24 h
  const vieja = montar({ updateFallaAntes: 1 });
  await subirYPagar(vieja.deps, "PRO");
  vieja.facturas.get("in_vieja").metadata.pago_pendiente_subir_ts = String(Math.floor(Date.now() / 1000) - 25 * 3600);
  assert.equal((await subirYPagar(vieja.deps, "PRO")).status, 409);
  assert.equal(vieja.ops("subscriptions.update").length, 1);
  assert.deepEqual(await consultarPendiente(vieja.deps), { status: 200, body: { estado: "sin_pendiente" } });

  // Anulada que no es de este flujo (sin marca): p. ej. la anuló un admin a mano.
  const ajena = montar({ abiertas: [{ ...FACTURA_VIEJA, status: "void" }] });
  assert.equal((await subirYPagar(ajena.deps, "PRO")).status, 409);
  assert.equal(ajena.ops("subscriptions.update").length, 0);

  // Marca de otro cliente de Stripe.
  const otroCliente = montar({ updateFallaAntes: 1 });
  await subirYPagar(otroCliente.deps, "PRO");
  otroCliente.facturas.get("in_vieja").customer = "cus_otro";
  assert.equal((await subirYPagar(otroCliente.deps, "PRO")).status, 409);

  // Sin permiso: el GET y subir siguen cerrados aunque haya cambio a medias.
  const sinPermiso = montar({ updateFallaAntes: 1 });
  await subirYPagar(sinPermiso.deps, "PRO");
  sinPermiso.deps.role = "RECEPTIONIST";
  assert.equal((await subirYPagar(sinPermiso.deps, "PRO")).status, 403);
  assert.equal((await consultarPendiente(sinPermiso.deps)).status, 403);
});

test("subir: si marcar la factura falla, NO se anula nada (la vieja sigue abierta y pagable)", async () => {
  const m = montar();
  (m.deps.stripe as any).invoices.update = async () => { throw new Error("red"); };
  const r = await subirYPagar(m.deps, "PRO");
  assert.equal(r.status, 502);
  assert.equal(m.facturas.get("in_vieja").status, "open");
  assert.equal(m.ops("invoices.voidInvoice").length, 0);
  assert.equal((await pagarPendiente(m.deps)).body.pagado, true);
});

test("subir: el reintento que vuelve a fallar sigue siendo recuperable (nunca queda atorada)", async () => {
  const m = montar({ updateFallaAntes: 2 });
  assert.equal((await subirYPagar(m.deps, "PRO")).status, 502);
  assert.equal((await subirYPagar(m.deps, "PRO")).status, 502);
  assert.equal((await consultarPendiente(m.deps)).body.cambioEnCurso !== undefined, true);
  const r = await subirYPagar(m.deps, "PRO");
  assert.equal(r.body.pagado, true);
  assert.equal(m.cobros(), 1);
});

// ── Revisión t4 ─────────────────────────────────────────────────────────────

// #4 — una factura «uncollectible» (Stripe la deja así al agotar los reintentos) también se cobra.
const INCOBRABLE = { ...FACTURA_VIEJA, status: "uncollectible" };

test("t4 #4: sin facturas abiertas pero con una INCOBRABLE → pendiente (no sin_pendiente), y se puede pagar", async () => {
  const m = montar({ abiertas: [INCOBRABLE] });
  const g = await consultarPendiente(m.deps);
  assert.equal(g.body.estado, "pendiente");
  assert.equal(g.body.montoPendiente, 48.61);
  assert.equal(g.body.cambioEnCurso, undefined);
  const r = await pagarPendiente(m.deps);
  assert.deepEqual(r, { status: 200, body: { ok: true, pagado: true } });
  assert.equal(m.ops("invoices.pay")[0].args[0], "in_vieja");
  assert.equal(m.facturas.get("in_vieja").status, "paid");
});

test("t4 #4: con una abierta y una incobrable gana la ABIERTA (aunque la incobrable sea más nueva); sube sobre la incobrable si es la única", async () => {
  const abierta = { ...FACTURA_VIEJA, id: "in_abierta", created: 100 };
  const incobrable = { ...INCOBRABLE, id: "in_incobrable", created: 900 };
  const m = montar({ abiertas: [abierta, incobrable] });
  await pagarPendiente(m.deps);
  assert.equal(m.ops("invoices.pay")[0].args[0], "in_abierta");

  const solo = montar({ abiertas: [INCOBRABLE] });
  const r = await subirYPagar(solo.deps, "PRO");
  assert.deepEqual(r, { status: 200, body: { ok: true, pagado: true } });
  assert.deepEqual(solo.ops("invoices.voidInvoice").map((l) => l.args[0]), ["in_vieja"]);
  assert.equal(solo.ops("subscriptions.update").length, 1);
});

test("t4 #4: «sin_pendiente» solo sale cuando de verdad no hay nada que cobrar (ni abierta, ni incobrable, ni saldo 0, ni de otro cliente)", async () => {
  for (const abiertas of [
    [],
    [{ ...INCOBRABLE, amount_due: 0 }],
    [{ ...INCOBRABLE, customer: "cus_otro" }],
    [{ ...FACTURA_VIEJA, status: "paid" }],
    [{ ...FACTURA_VIEJA, status: "void" }],
    [{ ...FACTURA_VIEJA, status: "draft" }],
  ]) {
    assert.deepEqual(await consultarPendiente(montar({ abiertas }).deps), { status: 200, body: { estado: "sin_pendiente" } });
  }
});

// #7 — la clave de «marcar» no puede chocar con una anterior de otros parámetros.
test("t4 #7: la clave de marcar lleva la hora de la marca (un parámetro); un reintento posterior marca con clave nueva y no choca", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-20T12:00:00Z") });
  const m = montar({ voidFalla: 1 });
  assert.equal((await subirYPagar(m.deps, "PRO")).status, 502); // marcó, y anular falló: la vieja sigue abierta
  assert.equal(m.facturas.get("in_vieja").status, "open");
  const k1 = m.ops("invoices.update")[0].args[2].idempotencyKey;
  const ts1 = m.ops("invoices.update")[0].args[1].metadata.pago_pendiente_subir_ts;
  assert.equal(k1, claves.marcar("clin_1", "in_vieja", "PRO", Number(ts1)));

  // Más tarde: el reintento manda OTRA hora → otra clave. Antes: misma clave + otros parámetros → idempotency_error.
  t.mock.timers.setTime(new Date("2026-10-20T12:00:07Z").getTime());
  const r = await subirYPagar(m.deps, "PRO");
  assert.deepEqual(r, { status: 200, body: { ok: true, pagado: true } });
  const marcas = m.ops("invoices.update");
  assert.equal(marcas.length, 2);
  assert.notEqual(marcas[1].args[2].idempotencyKey, k1);
  assert.equal(m.cobros(), 1);
});

test("t4 #7: si Stripe aun así responde idempotency_error y la factura ya está marcada para ese plan, se sigue; si no, 502 sin anular nada", async () => {
  const marcada = montar();
  (marcada.deps.stripe as any).invoices.update = async (id: string) => {
    marcada.facturas.get(id).metadata = { pago_pendiente_subir: "PRO" };
    throw Object.assign(new Error("Keys for idempotent requests can only be used with the same parameters"), { type: "StripeIdempotencyError", code: "idempotency_error" });
  };
  assert.equal((await subirYPagar(marcada.deps, "PRO")).status, 200);
  assert.equal(marcada.cobros(), 1);

  const sinMarca = montar();
  (sinMarca.deps.stripe as any).invoices.update = async () => {
    throw Object.assign(new Error("Keys for idempotent requests"), { type: "StripeIdempotencyError", code: "idempotency_error" });
  };
  const r = await subirYPagar(sinMarca.deps, "PRO");
  assert.equal(r.status, 502);
  assert.equal(sinMarca.facturas.get("in_vieja").status, "open");
  assert.equal(sinMarca.ops("invoices.voidInvoice").length, 0);
  assert.equal(sinMarca.cobros(), 0);
});

// #8 — la clínica nunca ve el texto de Stripe.
test("t4 #8: ningún error de Stripe llega a la clínica en inglés; el mensaje de Stripe va solo a la bitácora", async () => {
  const INGLES = /connection reset|Keys for idempotent|can no longer be paid|No such|declined/i;
  const casos: Array<[string, (m: ReturnType<typeof montar>) => Promise<{ status: number; body: any }>]> = [
    ["GET", (m) => consultarPendiente(m.deps)],
    ["pagar", (m) => pagarPendiente(m.deps)],
    ["subir", (m) => subirYPagar(m.deps, "PRO")],
  ];
  for (const [nombre, llama] of casos) {
    const m = montar({ stripeCaido: true });
    const r = await llama(m);
    assert.equal(r.status, 502, nombre);
    assert.equal(r.body.error, MENSAJES.stripeNoContesto, nombre);
    assert.doesNotMatch(JSON.stringify(r.body), INGLES, nombre);
    assert.match(r.body.error, /Intenta de nuevo/);
    // El texto de Stripe sí queda en la bitácora.
    assert.ok(m.auditorias.some((a) => a.event === "pago-pendiente-error-stripe" && /connection reset/.test(a.mensajeStripe)), nombre);
  }
  // Un error que no es de red (invoices.pay falla con texto en inglés) tampoco se filtra.
  const m = montar();
  (m.deps.stripe as any).invoices.pay = async () => { throw Object.assign(new Error("This invoice can no longer be paid."), { type: "StripeInvalidRequestError", code: "invoice_not_payable" }); };
  const r = await pagarPendiente(m.deps);
  assert.equal(r.status, 502);
  assert.doesNotMatch(JSON.stringify(r.body), INGLES);
  assert.ok(m.auditorias.some((a) => /no longer be paid/.test(a.mensajeStripe ?? "")));
  // Y en los pasos de «subir»: marcar y cambiar de plan.
  const mm = montar();
  (mm.deps.stripe as any).invoices.update = async () => { throw new Error("Invalid request: something in English"); };
  const rm = await subirYPagar(mm.deps, "PRO");
  assert.equal(rm.body.error, MENSAJES.stripeNoContesto);
});

// #10 — DECISIÓN DE RAFAEL: al subir de plan se paga el precio normal, sin NINGÚN cupón.
test("#10 (Rafael): suscripción con cupón del 20 % que sube → se quita el cupón, se cobra la lista completa + IVA y el monto mostrado coincide", async () => {
  const cupon = { id: "di_pct", coupon: { id: "REGALO20", percent_off: 20 } };
  const m = montar({ descuento: cupon });

  // El «Vas a pagar» NO resta el cupón: lista + IVA (PRO 689 → 799.24; CLINIC 1719 → 1994.04).
  const g = await consultarPendiente(m.deps);
  assert.deepEqual((g.body.opcionesSubir as any[]).map((o) => [o.plan, o.monto]), [["PRO", 799.24], ["CLINIC", 1994.04]]);

  const r = await subirYPagar(m.deps, "PRO");
  assert.deepEqual(r, { status: 200, body: { ok: true, pagado: true } });
  const p = m.ops("subscriptions.update")[0].args[1];
  assert.equal(p.discounts, ""); // el cupón ya no queda en la suscripción
  assert.equal(m.ops("prices.create")[0].args[0].unit_amount, 68900); // precio de lista, sin descuento
  // Lo mostrado es lo esperado y queda en la bitácora junto con lo que se quitó.
  const a = m.auditorias.at(-1);
  assert.equal(a.montoEsperadoMxn, 799.24);
  assert.equal(a.montoEsperadoMxn, (g.body.opcionesSubir as any[])[0].monto);
  assert.deepEqual(a.descuentosQuitados, ["di_pct"]);
  assert.deepEqual(a.promoQuitada, []);
});

test("#10 (Rafael): se quitan TODOS — la promo del primer mes, un cupón fijo y uno en porcentaje juntos; sin descuentos no se manda nada", async () => {
  const promo = { id: "di_promo", coupon: { id: `${PREFIJO_CUPON_PROMO}iva-basic-39000`, amount_off: 36000 } };
  const fijo = { id: "di_fijo", coupon: { id: "MENOS100", amount_off: 10000 } };
  const pct = { id: "di_pct", coupon: { id: "REGALO10", percent_off: 10 } };
  const m = montar({ descuentos: [promo, fijo, pct] });
  assert.equal(((await consultarPendiente(m.deps)).body.opcionesSubir as any[])[0].monto, 799.24);
  await subirYPagar(m.deps, "PRO");
  assert.equal(m.ops("subscriptions.update")[0].args[1].discounts, "");
  assert.deepEqual(m.auditorias.at(-1).descuentosQuitados.sort(), ["di_fijo", "di_pct", "di_promo"]);
  assert.deepEqual(m.auditorias.at(-1).promoQuitada, ["di_promo"]);

  const limpia = montar();
  await subirYPagar(limpia.deps, "PRO");
  assert.equal(limpia.ops("subscriptions.update")[0].args[1].discounts, undefined);
  assert.equal(limpia.auditorias.at(-1).montoEsperadoMxn, 799.24);

  // Cupón sin datos (id suelto) también se quita; funciones puras:
  assert.equal(descuentosParaSubir({ discount: null, discounts: ["di_x"] }), "");
  assert.equal(descuentosParaSubir({ discount: pct, discounts: [] }), "");
  assert.equal(descuentosParaSubir({ discount: null, discounts: [] }), undefined);
  assert.deepEqual(idsDeDescuentos({ discount: pct, discounts: ["di_pct", "di_otro"] }), ["di_pct", "di_otro"]);
});

test("#10 (Rafael): «Pagar mi plan» NO cambia — cobra la factura abierta tal cual, sin tocar los descuentos", async () => {
  const m = montar({ descuento: { id: "di_pct", coupon: { id: "REGALO20", percent_off: 20 } } });
  const r = await pagarPendiente(m.deps);
  assert.deepEqual(r, { status: 200, body: { ok: true, pagado: true } });
  assert.equal(m.ops("invoices.pay").length, 1);
  assert.equal(m.ops("subscriptions.update").length, 0);
  assert.equal(m.ops("prices.create").length, 0);
  assert.equal((await consultarPendiente(montar({ descuento: { id: "d", coupon: { id: "X", percent_off: 50 } } }).deps)).body.montoPendiente, 48.61);
});

// Q7 / S1 / R2 (t4): el cupón del CLIENTE de Stripe también se quita al subir, ANTES del cambio (así la factura
// nueva sale a precio de lista = lo mostrado) y, si algo falla antes de que el cambio quede hecho, se REPONE.
const CUPON_CLIENTE = { id: "di_cliente", coupon: { id: "REGALO20", percent_off: 20 }, promotion_code: null };
const PROMO_CLIENTE = { id: "di_cliente", coupon: { id: "REGALO20", percent_off: 20 }, promotion_code: "promo_ABC" };

test("S1: cupón en el CLIENTE + update OK → se quita ANTES del cambio y se cobra la lista sin cupón (lo cobrado = lo mostrado)", async () => {
  const m = montar({ descuentoCliente: CUPON_CLIENTE });
  const mostrado = ((await consultarPendiente(m.deps)).body.opcionesSubir as any[])[0].monto;
  const r = await subirYPagar(m.deps, "PRO");
  assert.deepEqual(r, { status: 200, body: { ok: true, pagado: true } });
  const orden = m.llamadas.map((l) => l.op);
  assert.ok(orden.indexOf("customers.deleteDiscount") < orden.indexOf("invoices.update"), "antes de marcar");
  assert.ok(orden.indexOf("customers.deleteDiscount") < orden.indexOf("invoices.voidInvoice"), "antes de anular");
  assert.ok(orden.indexOf("customers.deleteDiscount") < orden.indexOf("subscriptions.update"), "antes del cambio");
  assert.equal(m.ops("customers.deleteDiscount")[0].args[0], "cus_1"); // el cliente de la clínica de la sesión
  // La factura nueva salió a lista + IVA, igual que lo mostrado; el cupón no se repone.
  const a = m.auditorias.at(-1);
  assert.equal(a.montoCobradoMxn, mostrado);
  assert.equal(a.montoCobradoMxn, 799.24);
  assert.equal(a.descuentoDelClienteQuitado, "di_cliente");
  assert.equal(m.ops("customers.update").length, 0);
  assert.equal(m.descuentoDelCliente(), null);
  assert.deepEqual(m.avisos, []);
  const ev = m.auditorias.find((x) => x.event === "pago-pendiente-descuento-cliente-quitado");
  assert.deepEqual([ev.descuentoId, ev.cupon, ev.planDestino], ["di_cliente", "REGALO20", "PRO"]);
});

test("R2: FALLA el update → el cupón del cliente VUELVE (el mismo, con idempotencia y bitácora); el reintento termina el cambio", async () => {
  const m = montar({ descuentoCliente: CUPON_CLIENTE, updateFallaAntes: 1 });
  const r1 = await subirYPagar(m.deps, "PRO");
  assert.equal(r1.status, 502);
  assert.equal(m.ops("customers.deleteDiscount").length, 1);
  const rep = m.ops("customers.update");
  assert.equal(rep.length, 1);
  assert.deepEqual(rep[0].args[1], { coupon: "REGALO20" }); // el MISMO cupón
  assert.equal(rep[0].args[2].idempotencyKey, claves.reponerDescuentoCliente("clin_1", "di_cliente"));
  assert.equal(m.descuentoDelCliente().coupon.id, "REGALO20"); // otra vez puesto
  assert.equal(m.planSub(), "BASIC");
  const ev = m.auditorias.find((x) => x.event === "pago-pendiente-descuento-cliente-repuesto");
  assert.deepEqual([ev.cupon, ev.motivo], ["REGALO20", "cambiar-plan"]);
  assert.deepEqual(m.avisos, []);

  // El reintento: lo vuelve a quitar, cambia el plan y cobra la lista una sola vez.
  const r2 = await subirYPagar(m.deps, "PRO");
  assert.equal(r2.body.pagado, true);
  assert.equal(m.planSub(), "PRO");
  assert.equal(m.cobros(), 1);
  assert.equal(m.auditorias.at(-1).montoCobradoMxn, 799.24);
  assert.equal(m.descuentoDelCliente(), null);
});

test("R2: con código promocional se repone el código promocional (no solo el cupón)", async () => {
  const m = montar({ descuentoCliente: PROMO_CLIENTE, updateFallaAntes: 1 });
  await subirYPagar(m.deps, "PRO");
  assert.deepEqual(m.ops("customers.update")[0].args[1], { promotion_code: "promo_ABC" });
  assert.equal(m.descuentoDelCliente().promotion_code, "promo_ABC");
});

test("R2: si falla marcar o anular la factura (antes del cambio) el cupón también vuelve", async () => {
  const marcar = montar({ descuentoCliente: CUPON_CLIENTE, marcarFalla: true });
  assert.equal((await subirYPagar(marcar.deps, "PRO")).status, 502);
  assert.equal(marcar.ops("customers.update").length, 1);
  assert.equal(marcar.descuentoDelCliente().coupon.id, "REGALO20");
  assert.equal(marcar.facturas.get("in_vieja").status, "open");

  const anular = montar({ descuentoCliente: CUPON_CLIENTE, voidFalla: 1 });
  assert.equal((await subirYPagar(anular.deps, "PRO")).status, 502);
  assert.equal(anular.ops("customers.update").length, 1);
  assert.equal(anular.descuentoDelCliente().coupon.id, "REGALO20");
  assert.equal(anular.ops("subscriptions.update").length, 0);
});

test("R2: reponer el cupón TAMBIÉN falla → bitácora con todo para hacerlo a mano y aviso al admin; el error al usuario sigue en español", async () => {
  const m = montar({ descuentoCliente: PROMO_CLIENTE, updateFallaAntes: 1, reponerFalla: true });
  const r = await subirYPagar(m.deps, "PRO");
  assert.equal(r.status, 502);
  assert.equal(r.body.error, MENSAJES.stripeNoContesto);
  assert.equal(m.descuentoDelCliente(), null); // el cupón sigue sin estar: hay que reponerlo a mano
  const ev = m.auditorias.find((x) => x.event === "pago-pendiente-descuento-cliente-NO-repuesto");
  assert.deepEqual([ev.clienteStripe, ev.descuentoQuitado, ev.cupon, ev.codigoPromocional], ["cus_1", "di_cliente", "REGALO20", "promo_ABC"]);
  assert.match(ev.mensajeStripe, /connection reset/); // el texto de Stripe, solo en la bitácora
  assert.equal(m.avisos.length, 1);
  const aviso = m.avisos[0];
  assert.match(aviso.asunto, /reponer a mano/);
  assert.match(aviso.asunto, /Clínica Prueba/);
  const texto = aviso.lineas.join("\n");
  for (const dato of ["clin_1", "cus_1", "REGALO20", "promo_ABC"]) assert.match(texto, new RegExp(dato));
  assert.doesNotMatch(JSON.stringify(r.body), /REGALO20|cus_1|promo_ABC/); // nada de esto llega a la clínica
});

test("R2: si la tarjeta falla en la factura nueva (el cambio SÍ quedó hecho) el cupón NO se repone: se paga la lista por el enlace", async () => {
  const m = montar({ descuentoCliente: CUPON_CLIENTE, tarjetaFalla: true });
  const r = await subirYPagar(m.deps, "PRO");
  assert.deepEqual(r, { status: 200, body: { ok: true, pagado: false, url: "https://pay.stripe.test/in_nueva" } });
  assert.equal(m.ops("customers.update").length, 0);
  assert.equal(m.descuentoDelCliente(), null);
  assert.equal(m.facturas.get("in_nueva").amount_due, 79924);
});

test("S1: quitar el cupón falla de red → 502 en español y NO se toca nada más (no hay nada que reponer)", async () => {
  const m = montar({ descuentoCliente: CUPON_CLIENTE, deleteDiscountFalla: true });
  const r = await subirYPagar(m.deps, "PRO");
  assert.equal(r.status, 502);
  assert.equal(r.body.error, MENSAJES.stripeNoContesto);
  assert.equal(m.ops("invoices.update").length + m.ops("invoices.voidInvoice").length + m.ops("subscriptions.update").length, 0);
  assert.equal(m.ops("customers.update").length, 0);
  assert.equal(m.facturas.get("in_vieja").status, "open");
  assert.equal((await pagarPendiente(m.deps)).body.pagado, true);
});

test("S1: cupón en la suscripción Y en el cliente → se quitan los dos, y un POST doble cobra una sola vez", async () => {
  const m = montar({ descuento: { id: "di_sub", coupon: { id: "REGALO10", percent_off: 10 } }, descuentoCliente: CUPON_CLIENTE });
  await subirYPagar(m.deps, "PRO");
  assert.equal(m.ops("subscriptions.update")[0].args[1].discounts, "");
  assert.equal(m.ops("customers.deleteDiscount").length, 1);
  const doble = montar({ descuentoCliente: CUPON_CLIENTE });
  const [a, b] = await Promise.all([subirYPagar(doble.deps, "PRO"), subirYPagar(doble.deps, "PRO")]);
  assert.equal(a.body.pagado, true);
  assert.equal(b.body.pagado, true);
  assert.equal(doble.cobros(), 1);
});

test("S1: nunca se toca el descuento de un cliente de Stripe que no es el de la clínica de la sesión (502 antes de empezar nada)", async () => {
  const m = montar({ descuentoCliente: CUPON_CLIENTE, clienteAjeno: true });
  const r = await subirYPagar(m.deps, "PRO");
  assert.equal(r.status, 502);
  assert.equal(m.ops("customers.deleteDiscount").length, 0);
  assert.equal(m.ops("customers.update").length, 0);
  assert.equal(m.ops("invoices.voidInvoice").length, 0);
  assert.ok(m.auditorias.some((x) => x.event === "pago-pendiente-descuento-cliente-ajeno"));
});

test("S1: sin cupón en el cliente no se llama a deleteDiscount ni a customers.update; «Pagar mi plan» nunca lo toca", async () => {
  const sin = montar();
  await subirYPagar(sin.deps, "PRO");
  assert.equal(sin.ops("customers.deleteDiscount").length + sin.ops("customers.update").length, 0);
  const pagar = montar({ descuentoCliente: CUPON_CLIENTE });
  assert.equal((await pagarPendiente(pagar.deps)).body.pagado, true);
  assert.equal(pagar.ops("customers.deleteDiscount").length + pagar.ops("customers.update").length, 0);
});

// ── Octava vuelta t4: T1 (dos pestañas), T2 (respuesta perdida), T3 (cupón con fin) ──────────────────

test("T1 (b): dos pestañas a la vez → la segunda recibe «ya hay un cambio en curso» ANTES de quitar o anular nada; un solo cobro; el candado se suelta", async () => {
  const m = montar({ descuentoCliente: CUPON_CLIENTE, candadoReal: true });
  const [a, b] = await Promise.all([subirYPagar(m.deps, "PRO"), subirYPagar(m.deps, "PRO")]);
  const [ok, rechazada] = a.status === 200 ? [a, b] : [b, a];
  assert.deepEqual(ok, { status: 200, body: { ok: true, pagado: true } });
  assert.equal(rechazada.status, 409);
  assert.equal(rechazada.body.code, "CAMBIO_EN_CURSO");
  assert.equal(rechazada.body.error, "Ya hay un cambio de plan en curso, espera unos segundos.");
  // La segunda no tocó nada: una sola vez cada operación de Stripe.
  assert.equal(m.ops("customers.deleteDiscount").length, 1);
  assert.equal(m.ops("invoices.voidInvoice").length, 1);
  assert.equal(m.ops("subscriptions.update").length, 1);
  assert.equal(m.ops("customers.update").length, 0); // y nadie repuso el cupón
  assert.equal(m.cobros(), 1);
  assert.equal(m.auditorias.find((x) => x.event === "pago-pendiente-subir").montoCobradoMxn, 799.24);
  // El candado quedó libre (y tiene caducidad, por si el proceso muere con él tomado).
  assert.equal(m.candados.size, 0);
  const tomar = m.ops("candado.tomar")[0];
  assert.equal(tomar.args[0], claves.candadoSubir("clin_1"));
  assert.ok(tomar.args[1] >= 60 && tomar.args[1] <= 300);
});

test("T1 (b): el candado se suelta también si la subida falla, y uno vencido no bloquea; otra clínica no se ve afectada; sin permiso ni plan válido ni se toma", async () => {
  const falla = montar({ candadoReal: true, updateFallaAntes: 1 });
  assert.equal((await subirYPagar(falla.deps, "PRO")).status, 502);
  assert.equal(falla.candados.size, 0);
  assert.equal((await subirYPagar(falla.deps, "PRO")).status, 200); // el reintento no se queda esperando

  const pegado = montar({ candadoReal: true });
  pegado.candados.set(claves.candadoSubir("clin_1"), { hasta: Date.now() - 1000, dueno: "proceso-muerto" }); // proceso muerto: el candado ya caducó
  assert.equal((await subirYPagar(pegado.deps, "PRO")).status, 200);

  const tomado = montar({ candadoReal: true });
  tomado.candados.set(claves.candadoSubir("otra_clinica"), { hasta: Date.now() + 60_000, dueno: "otra" });
  assert.equal((await subirYPagar(tomado.deps, "PRO")).status, 200);

  const sinPermiso = montar({ candadoReal: true, role: "DOCTOR" });
  assert.equal((await subirYPagar(sinPermiso.deps, "PRO")).status, 403);
  assert.equal(sinPermiso.ops("candado.tomar").length, 0);
  const chico = montar({ candadoReal: true, plan: "PRO" });
  assert.equal((await subirYPagar(chico.deps, "BASIC")).status, 400);
  assert.equal(chico.ops("candado.tomar").length, 0);
});

test("T1 (a): SIN candado, si Stripe rechaza por una clave en curso (la otra pestaña lo está terminando) NO se repone el cupón: bitácora + aviso al admin", async () => {
  for (const donde of ["anular", "cambiar"] as const) {
    const m = montar({ descuentoCliente: CUPON_CLIENTE, clavePropiaEnCurso: donde });
    const r = await subirYPagar(m.deps, "PRO");
    assert.equal(r.status, 502, donde);
    assert.equal(r.body.error, MENSAJES.stripeNoContesto);
    assert.equal(m.ops("customers.update").length, 0, `${donde}: no se repone`);
    assert.equal(m.descuentoDelCliente(), null, donde); // el cupón no vuelve sobre el plan ya subido
    if (donde === "cambiar") assert.equal(m.planSub(), "PRO"); else m.otraTermina(); // la otra pestaña lo termina
    assert.equal(m.planSub(), "PRO");
    assert.equal(m.cobros(), 1);
    assert.equal(m.facturas.get("in_nueva").amount_due, 79924, `${donde}: la factura sale a lista, sin cupón`);
    const ev = m.auditorias.find((x) => x.event === "pago-pendiente-descuento-cliente-no-repuesto-otro-cambio");
    assert.deepEqual([ev.razon, ev.cupon, ev.clienteStripe], ["idempotencia", "REGALO20", "cus_1"], donde);
    assert.equal(m.avisos.length, 1, donde);
    assert.match(m.avisos[0].asunto, /cambio de plan en paralelo/);
    assert.match(m.avisos[0].lineas.join("\n"), /REGALO20/);
    assert.ok(!m.auditorias.some((x) => x.event === "pago-pendiente-descuento-cliente-repuesto"), donde);
  }
});

test("T1 (c): si lo cobrado queda por debajo de lo mostrado, queda en la bitácora y se avisa al admin", async () => {
  // El cupón del cliente SIGUE puesto al cobrar (otra pestaña lo repuso): esta petición lo ve como «sin cupón».
  const m = montar({ descuentoCliente: CUPON_CLIENTE });
  const retrieve = (m.deps.stripe as any).subscriptions.retrieve;
  (m.deps.stripe as any).subscriptions.retrieve = async (...a: any[]) => ({ ...(await retrieve(...a)), customer: { id: "cus_1", discount: null } });
  const r = await subirYPagar(m.deps, "PRO");
  assert.equal(r.body.pagado, true);
  const ev = m.auditorias.find((x) => x.event === "pago-pendiente-subir-cobro-menor");
  assert.deepEqual([ev.cobradoMxn, ev.esperadoMxn], [639.39, 799.24]);
  assert.equal(m.avisos.length, 1);
  assert.match(m.avisos[0].asunto, /por debajo del precio de lista/);
  // Cobro correcto → ni evento ni aviso.
  const bien = montar({ descuentoCliente: CUPON_CLIENTE });
  await subirYPagar(bien.deps, "PRO");
  assert.ok(!bien.auditorias.some((x) => x.event === "pago-pendiente-subir-cobro-menor"));
  assert.deepEqual(bien.avisos, []);
});

test("T2: el cambio SÍ llegó a Stripe pero la respuesta se perdió → se relee la suscripción y NO se repone el cupón; bitácora + aviso al admin", async () => {
  const m = montar({ descuentoCliente: CUPON_CLIENTE, updateRespuestaPerdida: 1 });
  const r = await subirYPagar(m.deps, "PRO");
  assert.equal(r.status, 502);
  assert.equal(m.planSub(), "PRO");
  assert.equal(m.cobros(), 1);
  assert.equal(m.ops("customers.update").length, 0);
  assert.equal(m.descuentoDelCliente(), null);
  const ev = m.auditorias.find((x) => x.event === "pago-pendiente-descuento-cliente-no-repuesto-otro-cambio");
  assert.deepEqual([ev.razon, ev.motivo], ["plan-ya-en-destino", "cambiar-plan"]);
  assert.equal(m.avisos.length, 1);
  assert.match(m.avisos[0].lineas.join("\n"), /ya está en PRO/);
  // Y la factura nueva salió a lista (el cupón se quitó antes del cambio).
  assert.equal(m.facturas.get("in_nueva").amount_due, 79924);
});

test("T2: el cambio realmente NO se hizo (la suscripción sigue en el plan viejo) → sí se repone; y si no se puede comprobar, se repone y queda anotado", async () => {
  const falla = montar({ descuentoCliente: CUPON_CLIENTE, updateFallaAntes: 1 });
  await subirYPagar(falla.deps, "PRO");
  assert.equal(falla.ops("customers.update").length, 1);
  assert.equal(falla.descuentoDelCliente().coupon.id, "REGALO20");
  assert.deepEqual(falla.avisos, []);
  // Se releyó la suscripción antes de reponer.
  assert.ok(falla.ops("subscriptions.retrieve").length >= 2);

  // La relectura falla (Stripe no contesta): lo reversible es reponer; queda anotado que no se pudo verificar.
  const sinVerificar = montar({ descuentoCliente: CUPON_CLIENTE, updateFallaAntes: 1, retrieveFallaDesde: 2 });
  await subirYPagar(sinVerificar.deps, "PRO");
  assert.equal(sinVerificar.ops("customers.update").length, 1);
  assert.ok(sinVerificar.auditorias.some((x) => x.event === "pago-pendiente-descuento-cliente-reposicion-sin-verificar"));
  // U1: además de la bitácora, aviso al admin para que revise el plan y el cupón de esa clínica.
  assert.equal(sinVerificar.avisos.length, 1);
  assert.match(sinVerificar.avisos[0].asunto, /no se pudo confirmar un cambio de plan/);
  const textoU1 = sinVerificar.avisos[0].lineas.join("\n");
  for (const dato of ["clin_1", "cus_1", "REGALO20", "PRO"]) assert.match(textoU1, new RegExp(dato));
});

test("T3: reponer un cupón CON fecha de fin lo repone igual (no se le quita nada a la clínica) pero avisa al admin con la fecha original", async () => {
  const fin = Math.floor(new Date("2027-01-15T18:00:00Z").getTime() / 1000);
  const m = montar({ descuentoCliente: { ...CUPON_CLIENTE, start: 1_700_000_000, end: fin }, updateFallaAntes: 1 });
  await subirYPagar(m.deps, "PRO");
  assert.equal(m.ops("customers.update").length, 1); // se repone igual
  assert.equal(m.descuentoDelCliente().coupon.id, "REGALO20");
  const quitado = m.auditorias.find((x) => x.event === "pago-pendiente-descuento-cliente-quitado");
  assert.equal(quitado.finOriginal, "2027-01-15T18:00:00.000Z");
  const rep = m.auditorias.find((x) => x.event === "pago-pendiente-descuento-cliente-repuesto");
  assert.deepEqual([rep.finOriginal, rep.finPorAjustar], ["2027-01-15T18:00:00.000Z", true]);
  assert.equal(m.avisos.length, 1);
  assert.match(m.avisos[0].asunto, /Ajusta la duración/);
  assert.match(m.avisos[0].lineas.join("\n"), /enero de 2027/);
  assert.match(m.avisos[0].lineas.join("\n"), /REGALO20/);

  // Sin fecha de fin (cupón «forever» u «once»): se repone sin aviso.
  const sinFin = montar({ descuentoCliente: CUPON_CLIENTE, updateFallaAntes: 1 });
  await subirYPagar(sinFin.deps, "PRO");
  assert.equal(sinFin.ops("customers.update").length, 1);
  assert.deepEqual(sinFin.avisos, []);
});

// ── Novena vuelta t4: U1, U2 y candado con dueño ──────────────────────────────────────────────────

test("U1: el cambio llegó a Stripe, la respuesta se perdió Y la relectura también falla → se repone por prudencia pero se avisa al admin (sonda9c)", async () => {
  const m = montar({ descuentoCliente: CUPON_CLIENTE, updateRespuestaPerdida: 1, retrieveFallaDesde: 2 });
  const r = await subirYPagar(m.deps, "PRO");
  assert.equal(r.status, 502);
  assert.equal(m.planSub(), "PRO"); // el cambio sí quedó hecho en Stripe
  assert.equal(m.ops("customers.update").length, 1); // sin poder verificar, se repone
  assert.ok(m.auditorias.some((x) => x.event === "pago-pendiente-descuento-cliente-reposicion-sin-verificar"));
  assert.equal(m.avisos.length, 1, "y el admin se entera");
  assert.match(m.avisos[0].lineas.join("\n"), /quítale el cupón al cliente/);
  assert.doesNotMatch(JSON.stringify(r.body), /REGALO20|cus_1/); // nada de esto llega a la clínica
  // Si SÍ se pudo verificar y el cambio no se hizo, no hay aviso extra (solo se repone).
  const normal = montar({ descuentoCliente: CUPON_CLIENTE, updateFallaAntes: 1 });
  await subirYPagar(normal.deps, "PRO");
  assert.deepEqual(normal.avisos, []);
});

test("U2: el aviso del cupón con fin pide algo que Stripe sí permite (quitarlo y poner uno de N meses, o quitarlo en la fecha), con N calculado", async () => {
  const ahora = new Date("2026-10-20T12:00:00Z");
  const base = { clinicaId: "clin_1", clinicaNombre: "Clínica Prueba", clienteStripe: "cus_1", cupon: "REGALO20", codigoPromocional: null };
  const aviso = (fin: string) => avisoCuponConFinRepuesto({ ...base, finOriginal: Math.floor(new Date(fin).getTime() / 1000), ahora });
  const t = (fin: string) => aviso(fin).lineas.join("\n");
  assert.match(t("2027-01-15T18:00:00Z"), /ponle un cupón con duración de 3 meses/); // 87 días → 3 meses
  assert.match(t("2027-01-15T18:00:00Z"), /quítale el cupón el 15 de enero de 2027/);
  assert.match(t("2026-11-10T12:00:00Z"), /duración de 1 mes \(/); // 21 días → 1 mes
  assert.match(t("2027-10-20T12:00:00Z"), /duración de 13 meses/);
  assert.match(t("2026-10-01T12:00:00Z"), /ya pasó.*Quítaselo/);
  for (const fin of ["2027-01-15T18:00:00Z", "2026-11-10T12:00:00Z"]) {
    assert.doesNotMatch(t(fin), /ajusta el descuento nuevo|termine ese día/i); // la instrucción vieja, imposible en Stripe
  }
  assert.equal(mesesRestantes(Math.floor(new Date("2026-10-20T12:00:00Z").getTime() / 1000) - 5, ahora), null);
  // De punta a punta: se repone y el aviso trae la instrucción nueva.
  const fin = Math.floor(new Date("2027-01-15T18:00:00Z").getTime() / 1000);
  const m = montar({ descuentoCliente: { ...CUPON_CLIENTE, end: fin }, updateFallaAntes: 1 });
  await subirYPagar(m.deps, "PRO");
  assert.match(m.avisos[0].lineas.join("\n"), /ponle un cupón con duración de \d+ mes/);
});

test("candado con dueño: una petición lenta cuyo candado ya caducó y tomó otra NO suelta el candado de la otra", async () => {
  const m = montar({ candadoReal: true });
  const clave = claves.candadoSubir("clin_1");
  const update = (m.deps.stripe as any).subscriptions.update;
  (m.deps.stripe as any).subscriptions.update = async (...a: any[]) => {
    // Mientras esta petición sigue en curso, su candado caduca y otra petición toma el suyo.
    m.candados.set(clave, { hasta: Date.now() + 60_000, dueno: "otra-peticion" });
    return update(...a);
  };
  const r = await subirYPagar(m.deps, "PRO");
  assert.equal(r.body.pagado, true);
  assert.equal(m.candados.get(clave)?.dueno, "otra-peticion", "el candado de la otra petición sigue puesto");
  const tomar = m.ops("candado.tomar")[0];
  const soltar = m.ops("candado.soltar")[0];
  assert.equal(soltar.args[1], tomar.args[2]); // soltó con SU dueño
  assert.match(tomar.args[2], /^[0-9a-f-]{36}$/); // un dueño único por petición
  // Cada petición usa un dueño distinto.
  const dos = montar({ candadoReal: true });
  await subirYPagar(dos.deps, "PRO");
  dos.deps.clinica.plan = "BASIC";
  await subirYPagar(dos.deps, "PRO").catch(() => {});
  const duenos = dos.ops("candado.tomar").map((l) => l.args[2]);
  assert.equal(new Set(duenos).size, duenos.length);
});

test("failban.acquireLock/releaseLock con dueño (memoria): solo suelta el dueño; sin dueño se comporta como siempre", async () => {
  const { acquireLock, releaseLock } = await import("@/lib/failban");
  const k = `prueba-dueno-${Date.now()}`;
  assert.equal(await acquireLock(k, 30, "a"), true);
  assert.equal(await acquireLock(k, 30, "b"), false); // ocupado
  await releaseLock(k, "b"); // no es suyo: no lo suelta
  assert.equal(await acquireLock(k, 30, "b"), false);
  await releaseLock(k, "a"); // el dueño sí
  assert.equal(await acquireLock(k, 30, "b"), true);
  await releaseLock(k, "b");
  // Sin dueño: igual que antes (acquire/release a secas).
  const k2 = `prueba-sin-dueno-${Date.now()}`;
  assert.equal(await acquireLock(k2, 30), true);
  assert.equal(await acquireLock(k2, 30), false);
  await releaseLock(k2);
  assert.equal(await acquireLock(k2, 30), true);
  await releaseLock(k2);
  // Un candado con dueño se puede soltar a secas (compatibilidad con quien no pasa dueño).
  const k3 = `prueba-mixto-${Date.now()}`;
  assert.equal(await acquireLock(k3, 30, "x"), true);
  await releaseLock(k3);
  assert.equal(await acquireLock(k3, 30, "y"), true);
  await releaseLock(k3, "y");
});

// ── Regla de la suspensión (ws1-t1 af1a76cc) y V2(a) ──────────────────────────────────────────────────

/** Cuatro meses de renovación sin pagar (jul, ago, sep, oct), la más reciente es oct. */
const MESES = ["jul", "ago", "sep", "oct"].map((m, i) => ({
  ...FACTURA_VIEJA,
  id: `in_${m}`,
  created: 1_000 + i * 100,
  amount_due: 48_610,
  hosted_invoice_url: `https://pay.stripe.test/in_${m}`,
}));
const OCT = "in_oct";

test("REGLA — suspendida 4 meses y pulsa «Pagar mi plan»: UN cobro (el mes más reciente), 4-1 = 3 anuladas, y el ciclo pasa a «30 días desde el pago»", async () => {
  filasFactura.length = 0;
  const m = montar({ suspendida: true, abiertas: MESES });
  const r = await pagarPendiente(m.deps);
  assert.deepEqual(r, { status: 200, body: { ok: true, pagado: true } });
  // 1 cobro: nunca se paga por separado un mes suspendido.
  assert.deepEqual(m.ops("invoices.pay").map((l) => l.args[0]), [OCT]);
  assert.equal(m.cobrosDeTarjeta(), 1);
  // Las otras tres se ANULAN (void), con la clave de la regla, y en la base quedan «No cobrada: servicio suspendido».
  const anuladas = m.ops("invoices.voidInvoice").map((l) => l.args[0]).sort();
  assert.deepEqual(anuladas, ["in_ago", "in_jul", "in_sep"]);
  for (const id of anuladas) {
    assert.equal(m.ops("invoices.voidInvoice").find((l) => l.args[0] === id)!.args[1].idempotencyKey, `anular-suspendida:${id}`);
    assert.equal(m.facturas.get(id).status, "void");
  }
  assert.equal(m.facturas.get(OCT).status, "paid"); // la pagada no se anula
  assert.deepEqual(
    filasFactura.map((f) => [f.reference, f.status, f.notes]).sort(),
    ["in_ago", "in_jul", "in_sep"].map((id) => [id, "void", NOTA_SERVICIO_SUSPENDIDO]),
  );
  // El ciclo: UN `subscriptions.update` con ancla «now» y pausa hasta (pago + 30 días − margen), sin tocar el plan.
  const reinicio = m.ops("subscriptions.update");
  assert.equal(reinicio.length, 1);
  const p = reinicio[0].args[1];
  const pagadoEn = new Date(m.PAGADO_EN * 1000);
  assert.equal(p.billing_cycle_anchor, "now");
  assert.equal(p.proration_behavior, "none");
  assert.equal(p.pause_collection.behavior, "void");
  assert.equal(p.pause_collection.resumes_at, Math.floor(reanudarCobroTrasRealinear(finDeLoPagado(pagadoEn, 1)).getTime() / 1000));
  const dias = (p.pause_collection.resumes_at - m.PAGADO_EN) / 86_400;
  assert.ok(dias >= 24 && dias <= 28, `reanuda ~un mes después del pago (${dias} días)`);
  assert.equal(p.metadata, undefined); // no es un cambio de plan
  assert.equal(m.planLocal(), null);
  // Orden: primero se mueve el ciclo y después se anulan los meses (si el ciclo falla no se anula nada).
  const orden = m.llamadas.map((l) => l.op);
  assert.ok(orden.indexOf("invoices.pay") < orden.indexOf("subscriptions.update"));
  assert.ok(orden.indexOf("subscriptions.update") < orden.indexOf("invoices.voidInvoice"));
  const a = m.auditorias.find((x) => x.event === "pago-pendiente-regla-suspension");
  assert.deepEqual([a.accion, a.realineo, [...a.anuladas].sort(), a.fallos], ["pagar", "hecho", ["in_ago", "in_jul", "in_sep"], []]);
  assert.equal(m.auditorias.find((x) => x.event === "pago-pendiente-pagar").estabaSuspendida, true);
  // Nunca escribe el estado de cobro de la clínica (lo hace el webhook invoice.paid).
  assert.deepEqual(m.avisos, []);
});

test("REGLA — dentro de las 24 h de gracia (aún con acceso): «Pagar» paga la factura del ciclo y el ciclo NO cambia (sin anular, sin reiniciar)", async () => {
  filasFactura.length = 0;
  const m = montar({ abiertas: [FACTURA_VIEJA] }); // past_due con acceso por delante
  const r = await pagarPendiente(m.deps);
  assert.deepEqual(r, { status: 200, body: { ok: true, pagado: true } });
  assert.equal(m.ops("subscriptions.update").length, 0);
  assert.equal(m.ops("invoices.voidInvoice").length, 0);
  assert.equal(m.pausa(), null);
  assert.deepEqual(filasFactura, []);
  assert.equal(m.auditorias.find((x) => x.event === "pago-pendiente-pagar").estabaSuspendida, false);
  assert.ok(!m.auditorias.some((x) => x.event === "pago-pendiente-regla-suspension"));
  // Ni siquiera se relee la suscripción: no hay nada que aplicar.
  assert.equal(m.ops("subscriptions.retrieve").length, 1); // solo la de cargar el pendiente
});

test("REGLA — suspendida pero la tarjeta vuelve a fallar: no se aplica nada (no hay pago); el cobro por el enlace lo completa el webhook", async () => {
  filasFactura.length = 0;
  const m = montar({ suspendida: true, abiertas: MESES, tarjetaFalla: true });
  const r = await pagarPendiente(m.deps);
  assert.equal(r.body.pagado, false);
  assert.equal(m.ops("subscriptions.update").length + m.ops("invoices.voidInvoice").length, 0);
  assert.deepEqual(filasFactura, []);
  for (const f of MESES) assert.equal(m.facturas.get(f.id).status, "open");
});

test("REGLA — suspendida 4 meses y pulsa «Subir de plan y pagar»: plan nuevo a lista sin cupones, las demás facturas abiertas se anulan y el ciclo NO se re-alinea (ya es «hoy»)", async () => {
  filasFactura.length = 0;
  const m = montar({
    suspendida: true,
    abiertas: MESES,
    descuento: { id: "di_sub", coupon: { id: "REGALO10", percent_off: 10 } },
    descuentoCliente: { id: "di_cliente", coupon: { id: "REGALO20", percent_off: 20 }, promotion_code: null },
  });
  const r = await subirYPagar(m.deps, "PRO");
  assert.deepEqual(r, { status: 200, body: { ok: true, pagado: true } });
  // Plan nuevo, cobrado completo en ciclo nuevo desde hoy, sin cupones (ni de la suscripción ni del cliente).
  const cambios = m.ops("subscriptions.update");
  assert.equal(cambios.length, 1, "un solo update: el cambio de plan (nada de re-alinear)");
  assert.equal(cambios[0].args[1].billing_cycle_anchor, "now");
  assert.equal(cambios[0].args[1].metadata.plan, "PRO");
  assert.equal(cambios[0].args[1].pause_collection, undefined);
  assert.equal(cambios[0].args[1].discounts, "");
  assert.equal(m.ops("customers.deleteDiscount").length, 1);
  assert.equal(m.planLocal(), "PRO");
  assert.equal(m.planSub(), "PRO");
  assert.equal(m.cobros(), 1);
  assert.equal(m.auditorias.find((x) => x.event === "pago-pendiente-subir").montoCobradoMxn, 799.24);
  assert.equal(m.reinicios(), 0);
  // Las 4 facturas abiertas de los meses sin servicio quedan anuladas (la más reciente por el flujo de «subir», las otras 3 por la regla).
  for (const f of MESES) assert.equal(m.facturas.get(f.id).status, "void", f.id);
  assert.deepEqual(
    filasFactura.map((f) => f.reference).sort(),
    ["in_ago", "in_jul", "in_sep"],
    "las 3 de la regla quedan registradas como no cobradas",
  );
  assert.equal(m.ops("invoices.pay").length, 0, "nunca se paga por separado un mes suspendido");
  // La factura del cambio (subscription_update) NO se anula: es lo que se cobró.
  assert.equal(m.facturas.get("in_nueva").status, "paid");
  // Las demás se anulan DESPUÉS del cambio de plan.
  const orden = m.llamadas.map((l) => l.op);
  assert.ok(orden.indexOf("subscriptions.update") < orden.lastIndexOf("invoices.voidInvoice"));
  const a = m.auditorias.find((x) => x.event === "pago-pendiente-regla-suspension");
  assert.deepEqual([a.accion, [...a.anuladas].sort(), a.fallos], ["subir", ["in_ago", "in_jul", "in_sep"], []]);
});

test("REGLA — «Subir» con la tarjeta que falla en la factura nueva: igual se anulan los meses sin servicio (no se deben) y se da el enlace", async () => {
  const m = montar({ suspendida: true, abiertas: MESES, tarjetaFalla: true });
  const r = await subirYPagar(m.deps, "PRO");
  assert.equal(r.body.pagado, false);
  for (const f of MESES) assert.equal(m.facturas.get(f.id).status, "void", f.id);
  assert.equal(m.facturas.get("in_nueva").status, "open"); // la factura del cambio sigue abierta para pagarla
});

test("REGLA — «Subir» dentro de las 24 h de gracia: ciclo nuevo por el propio cambio, y no se anula ninguna otra factura", async () => {
  const otra = { ...FACTURA_VIEJA, id: "in_otra", created: 50 }; // otra abierta que NO es del mes suspendido
  const m = montar({ abiertas: [otra, FACTURA_VIEJA] });
  const r = await subirYPagar(m.deps, "PRO");
  assert.equal(r.body.pagado, true);
  assert.deepEqual(m.ops("invoices.voidInvoice").map((l) => l.args[0]), ["in_vieja"]); // solo la que «subir» anula siempre
  assert.equal(m.facturas.get("in_otra").status, "open");
  assert.ok(!m.auditorias.some((x) => x.event === "pago-pendiente-regla-suspension"));
  assert.equal(m.auditorias.find((x) => x.event === "pago-pendiente-subir").estabaSuspendida, false);
});

test("REGLA — carrera con el webhook invoice.paid: si corre a la vez o después con el mismo instante de pago, no se duplica ni se salta nada", async () => {
  filasFactura.length = 0;
  const m = montar({ suspendida: true, abiertas: MESES });
  const real = m.stripe as any;
  const viva = async () => real.subscriptions.retrieve("sub_1");
  // El webhook (t1) aplica la MISMA regla con el instante `status_transitions.paid_at` de la factura pagada.
  const webhook = async () => {
    const otras = (await facturasAbiertasDelPlan(real, "sub_1")).filter((f) => f.id !== OCT);
    const pagadoEn = new Date(m.PAGADO_EN * 1000);
    return aplicarReglaDeSuspension({ stripe: real, clinicId: "clin_1", sub: await viva(), pagadoEn, finDeLoPagado: finDeLoPagado(pagadoEn, 1), facturas: otras });
  };
  // 1) A la vez: pagar y el webhook arrancan juntos.
  const [r] = await Promise.all([pagarPendiente(m.deps), webhook()]);
  assert.equal(r.body.pagado, true);
  assert.equal(m.reinicios(), 1, "un solo reinicio de ciclo (misma clave de idempotencia)");
  for (const id of ["in_jul", "in_ago", "in_sep"]) assert.equal(m.facturas.get(id).status, "void");
  assert.equal(m.cobrosDeTarjeta(), 1);
  // 2) Después: el webhook llega tarde y repite → no vuelve a mover el ciclo ni anula nada nuevo (ya no hay abiertas).
  const antes = m.ops("subscriptions.update").length;
  const despues = await webhook();
  assert.equal(m.reinicios(), 1);
  assert.deepEqual(despues.anuladas, []);
  assert.equal(despues.realineo.tipo, "ya_estaba");
  assert.equal(m.ops("subscriptions.update").length, antes);
  assert.equal(m.facturas.get(OCT).status, "paid");
  // Y una sola fila «no cobrada» por factura, sin duplicados.
  assert.deepEqual(filasFactura.map((f) => f.reference).sort(), ["in_ago", "in_jul", "in_sep"]);
});

test("REGLA — excedente de CFDI pendiente (t1, V3): se separa en su propia factura ANTES de reiniciar el ciclo, y si no se puede separar no se reinicia ni se anula nada", async () => {
  filasFactura.length = 0;
  const m = montar({ suspendida: true, abiertas: MESES, excedentePendiente: true });
  assert.equal((await pagarPendiente(m.deps)).body.pagado, true);
  const orden = m.llamadas.map((l) => l.op);
  assert.equal(m.ops("invoices.create").length, 1);
  assert.equal(m.ops("invoices.create")[0].args[0].metadata.kind, "cfdi-overage-aparte");
  assert.ok(orden.indexOf("invoices.create") < orden.indexOf("subscriptions.update"), "el excedente se aparta antes del reinicio");
  assert.equal(m.reinicios(), 1);
  assert.equal(m.ops("invoices.voidInvoice").length, 3);

  const falla = montar({ suspendida: true, abiertas: MESES, excedentePendiente: true, excedenteFalla: true });
  assert.equal((await pagarPendiente(falla.deps)).body.pagado, true); // ya cobró: la respuesta sigue siendo «pagado»
  assert.equal(falla.reinicios(), 0);
  assert.equal(falla.ops("invoices.voidInvoice").length, 0);
  assert.equal(falla.avisos.length, 1);
});

test("REGLA — si el reinicio del ciclo falla, no se anula nada (el reintento del webhook lo completa) y se avisa al admin", async () => {
  filasFactura.length = 0;
  const m = montar({ suspendida: true, abiertas: MESES });
  (m.deps.stripe as any).subscriptions.update = async () => { throw Object.assign(new Error("connection reset"), { type: "StripeConnectionError" }); };
  const r = await pagarPendiente(m.deps); // la clínica ya pagó: la respuesta sigue siendo «pagado»
  assert.deepEqual(r, { status: 200, body: { ok: true, pagado: true } });
  assert.equal(m.ops("invoices.voidInvoice").length, 0);
  for (const f of MESES.filter((f) => f.id !== OCT)) assert.equal(m.facturas.get(f.id).status, "open");
  assert.equal(m.avisos.length, 1);
  assert.match(m.avisos[0].asunto, /reactivada tras suspensión/);
  assert.ok(m.auditorias.some((x) => x.event === "pago-pendiente-regla-suspension" && x.realineo === "fallo"));
});

test("V2(a) — «Subir» con el cobro EN PAUSA: bloqueado con mensaje claro (sin «Stripe»), sin tocar nada; no sale gratis", async () => {
  const resumes = Math.floor(new Date("2027-01-01T00:00:00Z").getTime() / 1000);
  const m = montar({ descuentoCliente: CUPON_CLIENTE, pausaCobro: { behavior: "void", resumes_at: resumes }, candadoReal: true });
  const r = await subirYPagar(m.deps, "PRO");
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "COBRO_EN_PAUSA");
  assert.equal(r.body.error, MENSAJES.cobroEnPausa);
  assert.doesNotMatch(r.body.error as string, /stripe/i);
  assert.match(r.body.error as string, /soporte/);
  for (const op of ["customers.deleteDiscount", "customers.update", "prices.create", "invoices.update", "invoices.voidInvoice", "subscriptions.update"]) {
    assert.equal(m.ops(op).length, 0, op);
  }
  assert.equal(m.facturas.get("in_vieja").status, "open"); // la factura vieja sigue ahí
  assert.equal(m.planLocal(), null);
  assert.equal(m.candados.size, 0); // y el candado se soltó
  assert.equal(m.auditorias.find((x) => x.event === "pago-pendiente-subir-bloqueado-por-pausa").reanudaEn, resumes);
  // El GET no ofrece planes para subir, y lo explica.
  const g = await consultarPendiente(m.deps);
  assert.deepEqual(g.body.opcionesSubir, []);
  assert.equal(g.body.subirNoDisponible, MENSAJES.cobroEnPausa);
  // «Pagar mi plan» no se bloquea: paga la factura abierta tal cual.
  assert.equal((await pagarPendiente(m.deps)).body.pagado, true);
});

test("V2(a) — red de seguridad: si la factura del cambio NACE ANULADA (pausa no vista), no se da por cobrada, no se refleja el plan, se avisa al admin", async () => {
  const m = montar({ facturaNuevaAnulada: true });
  const r = await subirYPagar(m.deps, "PRO");
  assert.equal(r.status, 502);
  assert.equal(r.body.code, "SUBIDA_SIN_COBRO");
  assert.equal(r.body.error, MENSAJES.subidaSinCobro);
  assert.doesNotMatch(r.body.error as string, /stripe/i);
  assert.equal(m.planLocal(), null, "el plan no se refleja como pagado");
  assert.ok(m.auditorias.some((x) => x.event === "pago-pendiente-subir-sin-cobro"));
  assert.equal(m.avisos.length, 1);
  assert.match(m.avisos[0].asunto, /SIN cobro/);
});

// ── Undécima vuelta t4: X2 (candado también en «Pagar»), B2, B1 y M7 ───────────────────────────────────

test("X2 — «Subir» en una pestaña y «Pagar» en otra a la vez: UN solo cobro (nunca los dos), y «Pagar» espera y ve «Tu pago ya se registró»", async () => {
  filasFactura.length = 0;
  const m = montar({ suspendida: true, abiertas: MESES, candadoReal: true });
  const [subir, pagar] = await Promise.all([subirYPagar(m.deps, "PRO"), pagarPendiente(m.deps)]);
  assert.deepEqual(subir, { status: 200, body: { ok: true, pagado: true } });
  assert.equal(pagar.status, 409);
  assert.equal(pagar.body.code, "PAGO_YA_REGISTRADO");
  assert.equal(pagar.body.error, "Tu pago ya se registró.");
  // Un solo cobro en total: el del cambio de plan (799.24). «Pagar» no cobró nada.
  assert.equal(m.cobros(), 1);
  assert.equal(m.cobrosDeTarjeta(), 0);
  assert.equal(m.ops("invoices.pay").length, 0);
  assert.ok(m.ops("esperar").length >= 1, "«Pagar» esperó el candado");
  for (const f of MESES) assert.equal(m.facturas.get(f.id).status, "void", f.id);
  assert.equal(m.candados.size, 0);
});

test("X2 — «Pagar» en una pestaña y «Subir» en otra: «Subir» recibe «ya hay un cambio en curso» sin tocar nada; un solo cobro y el plan no sube gratis", async () => {
  filasFactura.length = 0;
  const m = montar({ suspendida: true, abiertas: MESES, candadoReal: true });
  const [pagar, subir] = await Promise.all([pagarPendiente(m.deps), subirYPagar(m.deps, "PRO")]);
  assert.deepEqual(pagar, { status: 200, body: { ok: true, pagado: true } });
  assert.equal(subir.status, 409);
  assert.equal(subir.body.code, "CAMBIO_EN_CURSO");
  assert.equal(m.cobrosDeTarjeta(), 1); // el de «Pagar»
  assert.equal(m.cobros(), 0); // «Subir» no cambió el plan ni cobró el plan nuevo
  assert.equal(m.planSub(), "BASIC");
  assert.equal(m.planLocal(), null);
  assert.equal(m.ops("subscriptions.update").filter((l) => l.args[1].metadata).length, 0);
  assert.equal(m.ops("customers.deleteDiscount").length, 0);
  assert.equal(m.candados.size, 0);
});

test("B2 — dos «Pagar» a la vez: un solo cobro y la segunda pestaña ve «Tu pago ya se registró» (no un 502 falso)", async () => {
  const m = montar({ suspendida: true, abiertas: MESES, candadoReal: true });
  const [a, b] = await Promise.all([pagarPendiente(m.deps), pagarPendiente(m.deps)]);
  assert.deepEqual(a, { status: 200, body: { ok: true, pagado: true } });
  assert.equal(b.status, 409);
  assert.equal(b.body.code, "PAGO_YA_REGISTRADO");
  assert.equal(b.body.error, MENSAJES.pagoYaRegistrado);
  assert.doesNotMatch(JSON.stringify(b.body), /No pudimos completar/);
  assert.equal(m.cobrosDeTarjeta(), 1);
  assert.equal(m.reinicios(), 1);
  assert.equal(m.ops("invoices.pay").length, 1);
  // Y sin pestañas dobles, «sin pendiente» sigue diciendo lo de siempre.
  const solo = montar({ abiertas: [], candadoReal: true });
  const r = await pagarPendiente(solo.deps);
  assert.deepEqual([r.status, r.body.code], [409, "SIN_PENDIENTE"]);
});

test("X2 — el candado de «Pagar»: se suelta siempre, no deja pasar a un rol sin permiso, y si sigue tomado tras esperar responde «cambio en curso» sin tocar nada", async () => {
  const falla = montar({ candadoReal: true, tarjetaFalla: true });
  assert.equal((await pagarPendiente(falla.deps)).body.pagado, false);
  assert.equal(falla.candados.size, 0);

  const sinPermiso = montar({ candadoReal: true, role: "DOCTOR" });
  assert.equal((await pagarPendiente(sinPermiso.deps)).status, 403);
  assert.equal(sinPermiso.ops("candado.tomar").length, 0);

  const ocupado = montar({ candadoReal: true });
  ocupado.candados.set(claves.candadoSubir("clin_1"), { hasta: Date.now() + 60_000, dueno: "otro-proceso" });
  const r = await pagarPendiente(ocupado.deps);
  assert.deepEqual([r.status, r.body.code], [409, "CAMBIO_EN_CURSO"]);
  assert.ok(ocupado.ops("esperar").length >= 10, "esperó varios intentos antes de rendirse");
  assert.equal(ocupado.ops("invoices.pay").length + ocupado.ops("subscriptions.retrieve").length, 0);
  assert.equal(ocupado.candados.get(claves.candadoSubir("clin_1"))?.dueno, "otro-proceso"); // no soltó el del otro
  // «Pagar» y «Subir» comparten la MISMA clave.
  assert.equal(ocupado.ops("candado.tomar")[0].args[0], claves.candadoSubir("clin_1"));
});

test("X2 — si «Pagar» tuvo que esperar y aún hay una factura abierta, relee el estado de la clínica: si ya no está suspendida no aplica la regla de la suspensión", async () => {
  filasFactura.length = 0;
  const clave = claves.candadoSubir("clin_1");
  const m = montar({
    suspendida: true,
    abiertas: MESES,
    candadoReal: true,
    estadoReleido: { subscriptionStatus: "active", trialEndsAt: new Date(Date.now() + 20 * 86_400_000) },
    alEsperar: () => { m.candados.delete(clave); }, // la otra operación termina mientras «Pagar» espera
  });
  m.candados.set(clave, { hasta: Date.now() + 60_000, dueno: "otra" });
  const r = await pagarPendiente(m.deps);
  assert.equal(r.body.pagado, true);
  assert.equal(m.cobrosDeTarjeta(), 1);
  assert.equal(m.auditorias.find((x) => x.event === "pago-pendiente-pagar").estabaSuspendida, false);
  assert.equal(m.ops("subscriptions.update").length, 0);
  assert.equal(m.ops("invoices.voidInvoice").length, 0);
});

test("B1 — «Subir» con el cobro en pausa: el bloqueo va ANTES del atajo «ya está en el plan destino» (no aplica el plan ni quita cupones)", async () => {
  const resumes = Math.floor(Date.now() / 1000) + 26 * 86_400;
  const m = montar({
    planEnSuscripcion: "PRO", // el cambio ya llegó a Stripe (p. ej. tras una subida sin cobro)
    pausaCobro: { behavior: "void", resumes_at: resumes },
    descuentoCliente: CUPON_CLIENTE,
    abiertas: [{ ...FACTURA_VIEJA, id: "in_cambio", billing_reason: "subscription_update" }],
  });
  const r = await subirYPagar(m.deps, "PRO");
  assert.deepEqual([r.status, r.body.code], [409, "COBRO_EN_PAUSA"]);
  assert.equal(m.planLocal(), null, "el atajo no aplicó el plan");
  assert.equal(m.ops("customers.deleteDiscount").length, 0, "ni quitó cupones");
  assert.equal(m.ops("invoices.voidInvoice").length + m.ops("subscriptions.update").length, 0);
  // Sin pausa, el atajo sigue funcionando como antes.
  const sinPausa = montar({ planEnSuscripcion: "PRO", abiertas: [{ ...FACTURA_VIEJA, id: "in_cambio" }] });
  const ok = await subirYPagar(sinPausa.deps, "PRO");
  assert.equal(ok.status, 200);
  assert.equal(sinPausa.planLocal(), "PRO");
});

test("M7 — la pausa que deja reactivar con UN mes (no es un prepago) no se explica con «meses pagados por adelantado»: el texto es verdadero en los dos casos", async () => {
  // La pausa de un solo mes tras una suspensión: ~26 días, la deja la propia regla de la suspensión.
  const m = montar({ suspendida: true, abiertas: MESES });
  assert.equal((await pagarPendiente(m.deps)).body.pagado, true);
  const pausaReal = m.pausa();
  assert.equal(pausaReal.behavior, "void");
  // Un cobro rechazado posterior con esa pausa puesta: «Subir» se bloquea y lo dice sin falsedades.
  const despues = montar({ pausaCobro: pausaReal });
  const r = await subirYPagar(despues.deps, "PRO");
  assert.equal(r.status, 409);
  const texto = r.body.error as string;
  assert.doesNotMatch(texto, /adelantado|prepag/i);
  assert.match(texto, /ya está pagado/);
  assert.match(texto, /soporte/);
  assert.doesNotMatch(texto, /stripe/i);
  // El GET no ofrece planes y da el mismo texto.
  const g = await consultarPendiente(despues.deps);
  assert.deepEqual(g.body.opcionesSubir, []);
  assert.equal(g.body.subirNoDisponible, texto);
  assert.doesNotMatch(MENSAJES.cobroEnPausa, /adelantado|prepag/i);
});

// ── N4 (segunda vuelta t4): nada de «Stripe», inglés ni jerga en lo que lee la clínica ──

/** Todos los textos (string) de una respuesta, a cualquier profundidad. */
const textosDe = (v: unknown): string[] =>
  typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(textosDe) : v && typeof v === "object" ? Object.values(v).flatMap(textosDe) : [];

const INGLES = /\b(the|and|invoice|declined|please|try again|failed|error|payment|subscription|customer|keys?|request|cannot|can no longer)\b/i;
const VOSEO = /\b(tenés|podés|hacé|pagá|elegí|escribinos|vos)\b/i;

function revisaTextoParaClinica(texto: string, donde: string) {
  assert.doesNotMatch(texto, /stripe/i, `${donde} nombra al proveedor: «${texto}»`);
  assert.doesNotMatch(texto, INGLES, `${donde} trae inglés: «${texto}»`);
  assert.doesNotMatch(texto, VOSEO, `${donde} usa voseo: «${texto}»`);
}

test("N4: ningún MENSAJES.* ni MENSAJES_CHECKOUT.* que lee la clínica nombra a Stripe, trae inglés o voseo", () => {
  for (const [k, v] of Object.entries(MENSAJES)) revisaTextoParaClinica(v, `MENSAJES.${k}`);
  for (const [k, v] of Object.entries(MENSAJES_CHECKOUT)) revisaTextoParaClinica(v, `MENSAJES_CHECKOUT.${k}`);
  assert.equal(MENSAJES.noHayUrl, "No pudimos abrir el pago. Inténtalo de nuevo o escribe a soporte.");
});

test("N4: TODAS las respuestas de error reales de GET / pagar / subir son texto nuestro, sin «Stripe»", async () => {
  const escenarios: Array<[string, Escenario, ((m: ReturnType<typeof montar>) => void)?]> = [
    ["sin permiso", { role: "DOCTOR" }],
    ["Stripe caído", { stripeCaido: true }],
    ["sin pendiente", { abiertas: [] }],
    ["sin suscripción", { sinSub: true }],
    ["sede incluida", { sedeIncluida: true }],
    ["sin IVA configurado", { env: {} }],
    ["Stripe sin configurar", {}, (m) => { m.deps.stripe = null; }],
    ["suscripción sin items", {}, (m) => {
      const r = (m.deps.stripe as any).subscriptions.retrieve;
      (m.deps.stripe as any).subscriptions.retrieve = async (...a: any[]) => ({ ...(await r(...a)), items: { data: [] } });
    }],
    ["pagar sin enlace de pago", { tarjetaFalla: true }, (m) => {
      m.facturas.get("in_vieja").hosted_invoice_url = null;
    }],
    ["pagar con error de Stripe en inglés", {}, (m) => {
      (m.deps.stripe as any).invoices.pay = async () => { throw Object.assign(new Error("This invoice can no longer be paid."), { type: "StripeInvalidRequestError" }); };
    }],
    ["marcar con error en inglés", {}, (m) => {
      (m.deps.stripe as any).invoices.update = async () => { throw new Error("Stripe says: invalid request"); };
    }],
  ];
  let respuestas = 0;
  for (const [nombre, esc, ajusta] of escenarios) {
    for (const op of ["GET", "pagar", "subir"] as const) {
      const m = montar(esc);
      ajusta?.(m);
      const r = op === "GET" ? await consultarPendiente(m.deps) : op === "pagar" ? await pagarPendiente(m.deps) : await subirYPagar(m.deps, "PRO");
      if (r.status < 400) continue;
      respuestas++;
      for (const t of textosDe(r.body.error)) revisaTextoParaClinica(t, `${op} / ${nombre} (${r.status})`);
    }
  }
  assert.ok(respuestas >= 20, `se revisaron ${respuestas} respuestas de error`);
  // El cuerpo inválido del POST también.
  for (const mal of [{}, { accion: "subir", plan: "ORO" }]) {
    const r = parsearCuerpo(mal) as any;
    for (const t of textosDe(r.respuesta.body.error)) revisaTextoParaClinica(t, "cuerpo inválido");
  }
});

test("N4 (change-plan): los mensajes de fallo de cobro (`chargeFailureMessage`, todas sus ramas) tampoco nombran a Stripe ni traen inglés", () => {
  const errores = [
    {},
    { code: "insufficient_funds" },
    { code: "card_declined", decline_code: "insufficient_funds" },
    { code: "expired_card" },
    { code: "incorrect_cvc" },
    { code: "authentication_required" },
    { code: "payment_intent_authentication_failure" },
    { code: "subscription_payment_intent_requires_action" },
    { code: "invoice_payment_intent_requires_action" },
  ];
  for (const e of errores) revisaTextoParaClinica(chargeFailureMessage(e), `chargeFailureMessage(${JSON.stringify(e)})`);
});

test("N4 (contrato de código): en las rutas de pago ningún `error:` para la clínica lleva `err.message` y ningún texto con espacios nombra a Stripe", () => {
  const raiz = path.resolve(__dirname, "../../../..");
  // Mini analizador: devuelve el código sin comentarios y las cadenas de texto reales (no confunde comillas de comentarios).
  const analiza = (t: string) => {
    let codigo = "";
    const cadenas: string[] = [];
    for (let i = 0; i < t.length; ) {
      const c = t[i];
      if (c === "/" && t[i + 1] === "/") { while (i < t.length && t[i] !== "\n") i++; continue; }
      if (c === "/" && t[i + 1] === "*") { const f = t.indexOf("*/", i + 2); i = f < 0 ? t.length : f + 2; continue; }
      if (c === '"' || c === "'" || c === "`") {
        let j = i + 1, txt = "";
        while (j < t.length && t[j] !== c) { if (t[j] === "\\") { txt += t[j + 1] ?? ""; j += 2; } else { txt += t[j]; j++; } }
        cadenas.push(txt);
        codigo += c + txt + c;
        i = j + 1;
        continue;
      }
      codigo += c;
      i++;
    }
    return { codigo, cadenas };
  };
  for (const rel of [
    "src/app/api/billing/change-plan/route.ts",
    "src/app/api/billing/checkout/route.ts",
    "src/app/api/billing/pago-pendiente/route.ts",
    "src/lib/billing/pago-pendiente.server.ts",
    "src/lib/billing/pago-pendiente.ts",
    "src/lib/billing/mensajes-pago.ts",
  ]) {
    const { codigo, cadenas } = analiza(readFileSync(path.join(raiz, rel), "utf8"));
    // `error: <expresión hasta el fin de línea>`: lo que viaja en la respuesta.
    for (const m of codigo.matchAll(/\berror:\s*([^\n]*)/g)) {
      assert.doesNotMatch(m[1], /err\??\.message|\bmessage\b\s*\?\?/, `${rel}: «error: ${m[1].trim()}»`);
    }
    for (const texto of cadenas) {
      // Una cadena que nombra a Stripe solo puede ser un identificador interno (import, código, evento, clave), nunca prosa.
      if (/stripe/i.test(texto)) assert.ok(!/\s/.test(texto.trim()), `${rel}: texto con «Stripe»: «${texto}»`);
    }
  }
});

// ── cuerpo y utilidades ─────────────────────────────────────────────────────

test("parsearCuerpo: solo pagar o subir con un plan que existe", () => {
  assert.deepEqual(parsearCuerpo({ accion: "pagar" }), { ok: true, cuerpo: { accion: "pagar" } });
  assert.deepEqual(parsearCuerpo({ accion: "subir", plan: "PRO" }), { ok: true, cuerpo: { accion: "subir", plan: "PRO" } });
  for (const mal of [{}, null, { accion: "subir" }, { accion: "subir", plan: "ORO" }, { accion: "borrar" }, "pagar"]) {
    const r = parsearCuerpo(mal) as any;
    assert.equal(r.ok, false);
    assert.equal(r.respuesta.status, 400);
  }
  // El clinicId del body se ignora: el esquema no lo conoce.
  assert.deepEqual(parsearCuerpo({ accion: "pagar", clinicId: "otra" }), { ok: true, cuerpo: { accion: "pagar" } });
});

test("planesMasGrandes: sigue el orden BASIC → PRO → CLINIC", () => {
  assert.deepEqual(planesMasGrandes("BASIC"), ["PRO", "CLINIC"]);
  assert.deepEqual(planesMasGrandes("PRO"), ["CLINIC"]);
  assert.deepEqual(planesMasGrandes("CLINIC"), []);
});
