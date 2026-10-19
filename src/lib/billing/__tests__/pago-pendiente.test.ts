/**
 * «Pagar mi plan» y «Subir de plan y pagar» (ws1-t2) — sin base ni red: Stripe SIMULADO.
 * Run: npm run test:pago-pendiente
 *
 * Fija: pagar cobra la factura abierta tal cual (sin promo); subir ANULA la vieja y cambia la MISMA
 * suscripción cobrando el plan nuevo completo, sin promo, sin prorrateo y con el IVA de siempre; nunca
 * se crea otra suscripción; repetir no cobra dos veces; plan más chico → 400; sin permiso → 403;
 * tarjeta que falla → url; sin pendiente → 409.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import {
  MENSAJES,
  PREFIJO_CUPON_PROMO,
  aplicarDescuentos,
  claves,
  descuentoSinValorar,
  descuentosConservados,
  descuentosParaSubir,
  parsearCuerpo,
  planesMasGrandes,
} from "../pago-pendiente";
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

const FACTURA_VIEJA = { id: "in_vieja", status: "open", amount_due: 4861, currency: "mxn", hosted_invoice_url: "https://pay.stripe.test/in_vieja", customer: "cus_1", created: 100, attempt_count: 2 };

function montar(e: Escenario = {}) {
  const llamadas: { op: string; args: any[] }[] = [];
  const registra = (op: string, ...args: any[]) => llamadas.push({ op, args });
  const facturas = new Map<string, any>((e.abiertas ?? [FACTURA_VIEJA]).map((f) => [f.id, { ...f }]));
  let planLocal: string | null = null;
  let planSub = e.plan ?? "BASIC"; // el plan que Stripe tiene en la metadata de la suscripción
  let fallasAntes = e.updateFallaAntes ?? 0;
  let fallasVoid = e.voidFalla ?? 0;
  const parametrosPorClave = new Map<string, string>(); // idempotencia de invoices.update, como Stripe
  let respuestasPerdidas = e.updateRespuestaPerdida ?? 0;
  const auditorias: any[] = [];
  const cobrosPorClave = new Map<string, any>();
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
        return {
          id,
          status: e.subStatus ?? "past_due",
          customer: "cus_1",
          metadata: { clinicId: "clin_1", plan: planSub, kind: "platform-subscription" },
          items: { data: [{ id: "si_1", price: { unit_amount: 41900, recurring: { interval: e.interval ?? "month" } } }] },
          // `discounts` viene EXPANDIDO (con su cupón), como lo pide el servicio.
          discount: (e.descuentos ?? (e.descuento ? [e.descuento] : []))[0] ?? null,
          discounts: e.descuentos ?? (e.descuento ? [e.descuento] : []),
        };
      },
      update: async (id: string, params: any, opts: any) => {
        registra("subscriptions.update", id, params, opts);
        cuestaCaer();
        // Mismo idempotencyKey → misma respuesta (como Stripe): no genera otra factura.
        const previa = cobrosPorClave.get(opts.idempotencyKey);
        if (previa) return previa;
        if (fallasAntes > 0) {
          fallasAntes--;
          throw Object.assign(new Error("connection reset"), { type: "StripeConnectionError" });
        }
        const nueva = {
          id: "in_nueva",
          status: e.tarjetaFalla ? "open" : "paid",
          amount_due: 79904,
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
        cobrosPorClave.set(opts.idempotencyKey, { ...f });
        return { ...f };
      },
      voidInvoice: async (id: string, _p: any, opts: any) => {
        registra("invoices.voidInvoice", id, opts);
        cuestaCaer();
        if (fallasVoid > 0) {
          fallasVoid--;
          throw Object.assign(new Error("connection reset"), { type: "StripeConnectionError" });
        }
        facturas.get(id).status = "void";
        return facturas.get(id);
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
  };
  const ops = (op: string) => llamadas.filter((l) => l.op === op);
  return {
    deps, llamadas, ops, auditorias, facturas,
    planLocal: () => planLocal,
    cobros: () => cobrosAplicados,
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

test("subir: si la suscripción aún arrastra la promo del primer mes, se le quita SOLO esa", async () => {
  const promo = { id: "di_promo", coupon: { id: `${PREFIJO_CUPON_PROMO}iva-basic-39000` } };
  const m = montar({ descuento: promo });
  await subirYPagar(m.deps, "PRO");
  assert.equal(m.ops("subscriptions.update")[0].args[1].discounts, "");

  // Un descuento que NO es la promo (otro cupón) se conserva.
  assert.deepEqual(
    descuentosParaSubir({ discount: promo, discounts: ["di_promo", "di_otro"] }),
    [{ discount: "di_otro" }],
  );
  assert.equal(descuentosParaSubir({ discount: { id: "di_otro", coupon: { id: "REGALO" } }, discounts: ["di_otro"] }), undefined);
  assert.equal(descuentosParaSubir({ discount: null, discounts: [] }), undefined);
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

// #10 — el «Vas a pagar $X» es lo que Stripe cobra.
test("t4 #10: con un cupón conservado, el monto mostrado lo descuenta antes del IVA (porcentaje y monto fijo)", async () => {
  const pct = montar({ descuento: { id: "di_pct", coupon: { id: "REGALO20", percent_off: 20 } } });
  const g = await consultarPendiente(pct.deps);
  // PRO: 689 − 20 % = 551.20 → +16 % = 639.39 (IVA sobre el subtotal ya descontado)
  assert.equal((g.body.opcionesSubir as any[])[0].monto, 639.39);
  // CLINIC: 1719 − 20 % = 1375.20 → 1595.23
  assert.equal((g.body.opcionesSubir as any[])[1].monto, 1595.23);

  const fijo = montar({ descuento: { id: "di_fijo", coupon: { id: "MENOS100", amount_off: 10000 } } });
  const gf = await consultarPendiente(fijo.deps);
  assert.equal((gf.body.opcionesSubir as any[])[0].monto, 683.24); // (689 − 100) × 1.16
  assert.equal(descuentosParaSubir({ discount: { id: "di_fijo", coupon: { id: "MENOS100", amount_off: 10000 } }, discounts: ["di_fijo"] }), undefined);
});

test("t4 #10: la promo del primer mes NO se resta (se quita al subir); lo demás sí; un cupón vencido tampoco", async () => {
  const promo = { id: "di_promo", coupon: { id: `${PREFIJO_CUPON_PROMO}iva-basic-39000`, amount_off: 36000 } };
  const otro = { id: "di_otro", coupon: { id: "REGALO10", percent_off: 10 } };
  const m = montar({ descuentos: [promo, otro] });
  const g = await consultarPendiente(m.deps);
  assert.equal((g.body.opcionesSubir as any[])[0].monto, 719.32); // 689 − 10 % = 620.10 → ×1.16
  await subirYPagar(m.deps, "PRO");
  assert.deepEqual(m.ops("subscriptions.update")[0].args[1].discounts, [{ discount: "di_otro" }]); // se conserva solo ese
  // Lo que se mostró es lo que se registra como esperado en la bitácora.
  assert.equal(m.auditorias.at(-1).montoEsperadoMxn, 719.32);
  assert.deepEqual(m.auditorias.at(-1).descuentosConservados, ["di_otro"]);

  const vencido = montar({ descuento: { id: "di_viejo", end: Math.floor(Date.now() / 1000) - 3600, coupon: { id: "X", percent_off: 50 } } });
  assert.equal(((await consultarPendiente(vencido.deps)).body.opcionesSubir as any[])[0].monto, 799.24); // sin descuento
});

test("t4 #10: sin descuentos el monto sigue siendo lista + IVA; y un cupón sin datos se avisa en la bitácora", async () => {
  assert.equal(((await consultarPendiente(montar().deps)).body.opcionesSubir as any[])[0].monto, 799.24);
  const m = montar({ descuentos: [{ id: "di_raro" }] });
  await subirYPagar(m.deps, "PRO");
  assert.equal(m.auditorias.at(-1).descuentoSinValorar, true);
  assert.equal(descuentoSinValorar(descuentosConservados({ discount: null, discounts: ["di_x"] })), true);
  assert.equal(aplicarDescuentos(68900, descuentosConservados({ discount: { id: "d", coupon: { id: "c", percent_off: 100 } }, discounts: [] })), 0);
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
