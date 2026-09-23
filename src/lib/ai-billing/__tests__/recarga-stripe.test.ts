/**
 * Recargas del monedero de IA por Stripe: que un pago se abone UNA sola vez y
 * que la recarga automática no cobre doble ni se quede en bucle.
 *
 * Run: npm run test:recarga-stripe
 *
 * Corren DE VERDAD el handler del webhook (`/api/webhooks/stripe`), el cron
 * (`/api/cron/ai-wallet`) y todo `recharge.ts`. Lo único sustituido: Prisma
 * (un doble en memoria cuyo FOR UPDATE bloquea de verdad, por clínica, como el
 * del monedero), Stripe (un cliente de mentira: la firma del webhook se acepta
 * tal cual y los PaymentIntents los guiona cada prueba) y el envío de WhatsApp.
 * Ni un solo cobro real: no hay clave de Stripe y no se abre red.
 *
 * El origen: el 22-sep-2026 BEVADENT pagó $200 MXN y el saldo nunca se abonó.
 * `payment_intent.succeeded` no estaba suscrito y `checkout.session.completed`,
 * que sí llegó, se descartaba. Ahora los dos acreditan y, como son el mismo
 * pago, tiene que abonarse una vez: en cualquier orden y aunque se repitan.
 */

import Module from "node:module";
import path from "node:path";
import { test, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

/* ── dobles por ruta resuelta (sin flags experimentales) ────────────── */

const RAIZ = path.resolve(__dirname, "../../../..");
type Fila = Record<string, any>;

const base = {
  wallets: [] as Fila[],
  topups: [] as Fila[],
  txs: [] as Fila[],
  clinics: [] as Fila[],
};
let seq = 0;
const nuevoId = (p: string) => `${p}_${++seq}`;

function casa(fila: Fila, where: Fila | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, cond]) => {
    const v = fila[k];
    if (cond === null || typeof cond !== "object" || cond instanceof Date) return v === cond;
    if ("in" in cond) return cond.in.includes(v);
    if ("gte" in cond) return v instanceof Date ? v.getTime() >= cond.gte.getTime() : v >= cond.gte;
    if ("not" in cond) return v !== cond.not;
    throw new Error(`condición no soportada en el doble: ${k}=${JSON.stringify(cond)}`);
  });
}
function proyecta(fila: Fila | undefined, select?: Fila) {
  if (!fila) return null;
  if (!select) return { ...fila };
  return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, fila[k]]));
}
function ordena(filas: Fila[], orderBy?: Fila) {
  if (!orderBy) return filas;
  const [[k, dir]] = Object.entries(orderBy) as [string, string][];
  return [...filas].sort((a, b) => {
    const x = a[k] instanceof Date ? a[k].getTime() : a[k];
    const y = b[k] instanceof Date ? b[k].getTime() : b[k];
    return (x < y ? -1 : x > y ? 1 : 0) * (dir === "desc" ? -1 : 1);
  });
}
function aplica(fila: Fila, data: Fila) {
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (v && typeof v === "object" && !(v instanceof Date) && "increment" in v) fila[k] += v.increment;
    else if (v && typeof v === "object" && !(v instanceof Date) && "decrement" in v) fila[k] -= v.decrement;
    else fila[k] = v;
  }
  return fila;
}
function tabla(filas: Fila[], defaults: () => Fila, idPrefix: string) {
  return {
    findFirst: async ({ where, orderBy, select }: Fila) =>
      proyecta(ordena(filas.filter((f) => casa(f, where)), orderBy)[0], select),
    findUnique: async ({ where, select }: Fila) => proyecta(filas.find((f) => casa(f, where)), select),
    findMany: async ({ where, select }: Fila = {}) =>
      filas.filter((f) => casa(f, where)).map((f) => proyecta(f, select)),
    create: async ({ data, select }: Fila) => {
      const fila = { id: nuevoId(idPrefix), createdAt: new Date(), ...defaults(), ...data };
      filas.push(fila);
      return proyecta(fila, select);
    },
    update: async ({ where, data, select }: Fila) => {
      const fila = filas.find((f) => casa(f, where));
      if (!fila) throw new Error(`update: no existe ${JSON.stringify(where)}`);
      return proyecta(aplica(fila, data), select);
    },
    updateMany: async ({ where, data }: Fila) => {
      const hits = filas.filter((f) => casa(f, where));
      hits.forEach((f) => aplica(f, data));
      return { count: hits.length };
    },
    upsert: async ({ where, create, update, select }: Fila) => {
      const fila = filas.find((f) => casa(f, where));
      if (fila) return proyecta(aplica(fila, update), select);
      const nueva = { id: nuevoId(idPrefix), createdAt: new Date(), ...defaults(), ...create };
      filas.push(nueva);
      return proyecta(nueva, select);
    },
  };
}

// El candado SOLO existe si el código lo pide: `SELECT … FOR UPDATE` sobre
// ai_wallets toma una cola por clínica que se suelta al terminar la
// transacción, como en Postgres. Y dentro de una transacción cada lectura de
// ai_topups tarda un poco (barrera): sin el candado, dos transacciones a la vez
// leen las dos «no hay nada» y se cruzan siempre. Así las pruebas de «a la
// vez» fallan si alguien quita el FOR UPDATE (comprobado quitándolo).
const candados = new Map<string, Promise<void>>();
async function tomaCandado(clave: string): Promise<() => void> {
  while (candados.has(clave)) await candados.get(clave);
  let suelta!: () => void;
  candados.set(clave, new Promise<void>((r) => { suelta = r; }));
  return () => { candados.delete(clave); suelta(); };
}
const BARRERA_MS = 15;
const prismaDoble: any = {
  aiWallet: tabla(
    base.wallets,
    () => ({
      balanceCents: 0, autoRecharge: false, autoRechargeThresholdCents: 0, autoRechargeAmountCents: 0,
      stripePaymentMethodId: null, status: "ACTIVE", lowBalanceNotifiedAt: null,
    }),
    "w",
  ),
  aiTopup: tabla(base.topups, () => ({ status: "PENDING", gatewayRef: null, paidAt: null }), "t"),
  aiWalletTransaction: tabla(base.txs, () => ({}), "tx"),
  clinic: tabla(base.clinics, () => ({}), "c"),
  // La sesión de suscripción (prueba 8) pasa por logAudit; que no ensucie la salida.
  auditLog: { create: async () => ({}) },
  $queryRaw: async () => [],
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const sueltas: Array<() => void> = [];
    const leeYEspera = async (args: Fila) => {
      const fila = await prismaDoble.aiTopup.findFirst(args);
      await new Promise((r) => setTimeout(r, BARRERA_MS));
      return fila;
    };
    const tx = {
      ...prismaDoble,
      aiTopup: { ...prismaDoble.aiTopup, findFirst: leeYEspera },
      $queryRaw: async (partes: TemplateStringsArray, ...valores: unknown[]) => {
        if (partes.join("?").includes("FOR UPDATE")) sueltas.push(await tomaCandado(String(valores[0])));
        return [];
      },
    };
    try {
      return await fn(tx);
    } finally {
      sueltas.forEach((s) => s());
    }
  },
};

/** Stripe de mentira: cada prueba guiona `crear` y `leer`. */
const stripeDoble = {
  llamadas: [] as Fila[],
  crear: (async (_p: Fila) => { throw new Error("prueba sin guion para paymentIntents.create"); }) as (p: Fila) => Promise<Fila>,
  leer: (async (id: string) => ({ id, metadata: {}, setup_future_usage: null, payment_method: null })) as (id: string) => Promise<Fila>,
};
const stripeCliente = {
  webhooks: { constructEvent: (raw: string) => JSON.parse(raw) },
  paymentIntents: {
    create: async (params: Fila, opts: Fila) => {
      stripeDoble.llamadas.push({ params, opts });
      return stripeDoble.crear(params);
    },
    retrieve: async (id: string) => stripeDoble.leer(id),
  },
};
const whatsapps: Array<{ to: string; body: string }> = [];

const dobles = new Map<string, unknown>([
  [path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prismaDoble }],
  [
    path.join(RAIZ, "src/lib/stripe.ts"),
    { default: () => stripeCliente, getStripeSafe: () => stripeCliente, stripeUnavailableResponse: () => ({}) },
  ],
  [
    path.join(RAIZ, "src/lib/whatsapp/send-and-log.ts"),
    { sendWhatsAppLogged: async (a: { to: string; body: string }) => { whatsapps.push(a); } },
  ],
]);
const M = Module as unknown as {
  _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (req: string, parent: unknown, isMain: boolean) => string;
};
const cargaOriginal = M._load;
M._load = function (req, parent, isMain) {
  if (req === "server-only" || req === "client-only") return {};
  let resuelto: string | null = null;
  try { resuelto = M._resolveFilename(req, parent, isMain); } catch { resuelto = null; }
  if (resuelto && dobles.has(resuelto)) return dobles.get(resuelto);
  return cargaOriginal.call(this, req, parent, isMain);
};

process.env.STRIPE_WEBHOOK_SECRET = "whsec_de_prueba";
process.env.CRON_SECRET = "cron_de_prueba";

// Los `import` estáticos se izan por encima del parche de Module._load, así
// que las rutas y recharge.ts se cargan aquí, ya con los dobles puestos.
type Recarga = typeof import("@/lib/ai-billing/recharge");
let NextRequest: typeof import("next/server").NextRequest;
let webhook: typeof import("@/app/api/webhooks/stripe/route").POST;
let cron: typeof import("@/app/api/cron/ai-wallet/route").GET;
let AUTO_RECHARGE_COOLDOWN_MS: Recarga["AUTO_RECHARGE_COOLDOWN_MS"];
let AUTO_RECHARGE_FAILED_BACKOFF_MS: Recarga["AUTO_RECHARGE_FAILED_BACKOFF_MS"];
let topupFromCheckoutSession: Recarga["topupFromCheckoutSession"];
let triggerAutoRechargeIfNeeded: Recarga["triggerAutoRechargeIfNeeded"];
before(async () => {
  ({ NextRequest } = await import("next/server"));
  ({ POST: webhook } = await import("@/app/api/webhooks/stripe/route"));
  ({ GET: cron } = await import("@/app/api/cron/ai-wallet/route"));
  ({ AUTO_RECHARGE_COOLDOWN_MS, AUTO_RECHARGE_FAILED_BACKOFF_MS, topupFromCheckoutSession, triggerAutoRechargeIfNeeded } =
    await import("@/lib/ai-billing/recharge"));
});

/* ── el mundo ───────────────────────────────────────────────────────── */

const CLINICA = "cl_bevadent";
const OTRA = "cl_otra";
const PI = "pi_3UIc4uEgO7AoChdP0qSe5KYc";
const SESION = "cs_test_a1b2c3";
const MONTO = 20_000; // $200 MXN

function sesionCompletada(over: Fila = {}) {
  return {
    id: "evt_cs", type: "checkout.session.completed",
    data: { object: {
      id: SESION, object: "checkout.session", mode: "payment", payment_status: "paid",
      payment_intent: PI, amount_total: MONTO, currency: "mxn",
      metadata: { kind: "ai-topup", clinicId: CLINICA, amountCents: String(MONTO) },
      ...over,
    } },
  };
}
function intentoCobrado(over: Fila = {}) {
  return {
    id: "evt_pi", type: "payment_intent.succeeded",
    data: { object: {
      id: PI, object: "payment_intent", amount: MONTO, amount_received: MONTO, status: "succeeded",
      payment_method: "pm_visa_4242", setup_future_usage: "off_session",
      metadata: { kind: "ai-topup", clinicId: CLINICA, amountCents: String(MONTO) },
      ...over,
    } },
  };
}
function intentoFallido(over: Fila = {}) {
  return {
    id: "evt_pf", type: "payment_intent.payment_failed",
    data: { object: {
      id: "pi_fallido", object: "payment_intent", amount: MONTO, status: "requires_payment_method",
      metadata: { kind: "ai-topup", clinicId: CLINICA, amountCents: String(MONTO) },
      ...over,
    } },
  };
}

async function entrega(evento: Fila) {
  const req = new NextRequest("http://localhost/api/webhooks/stripe", {
    method: "POST",
    body: JSON.stringify(evento),
    headers: { "stripe-signature": "firma", "content-type": "application/json" },
  });
  const res = await webhook(req);
  assert.equal(res.status, 200, `el webhook respondió ${res.status}: ${await res.text()}`);
}
async function corridaDelCron() {
  const req = new NextRequest("http://localhost/api/cron/ai-wallet", {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  const res = await cron(req);
  assert.equal(res.status, 200);
  return (await res.json()) as Fila;
}

const monedero = (clinicId = CLINICA) => base.wallets.find((w) => w.clinicId === clinicId);
const recargas = (clinicId = CLINICA) => base.topups.filter((t) => t.clinicId === clinicId);
const abonos = (clinicId = CLINICA) => base.txs.filter((t) => t.clinicId === clinicId && t.type === "TOPUP");

function reinicia() {
  base.wallets.length = 0; base.topups.length = 0; base.txs.length = 0; base.clinics.length = 0;
  stripeDoble.llamadas.length = 0;
  stripeDoble.crear = async () => { throw new Error("prueba sin guion para paymentIntents.create"); };
  stripeDoble.leer = async (id) => ({ id, metadata: {}, setup_future_usage: null, payment_method: null });
  whatsapps.length = 0;
  base.clinics.push({ id: CLINICA, name: "BEVADENT", stripeCustomerId: "cus_bevadent", email: null, phone: "+5215512345678", waConnected: true, waPhoneNumberId: "pn", waAccessToken: "tok" });
  base.clinics.push({ id: OTRA, name: "Otra", stripeCustomerId: "cus_otra", email: null, phone: null, waConnected: false, waPhoneNumberId: null, waAccessToken: null });
  base.wallets.push({ id: "w_bev", clinicId: CLINICA, createdAt: new Date(), balanceCents: 1_500, autoRecharge: false, autoRechargeThresholdCents: 0, autoRechargeAmountCents: 0, stripePaymentMethodId: null, status: "ACTIVE", lowBalanceNotifiedAt: null });
  base.wallets.push({ id: "w_otra", clinicId: OTRA, createdAt: new Date(), balanceCents: 9_000, autoRecharge: false, autoRechargeThresholdCents: 0, autoRechargeAmountCents: 0, stripePaymentMethodId: null, status: "ACTIVE", lowBalanceNotifiedAt: null });
}
beforeEach(reinicia);

function seAbonoUnaVez() {
  assert.equal(monedero()!.balanceCents, 1_500 + MONTO, "el saldo tiene que subir exactamente una vez");
  assert.equal(abonos().length, 1, "un solo movimiento TOPUP");
  const pagadas = recargas().filter((t) => t.status === "PAID");
  assert.equal(pagadas.length, 1, "una sola recarga PAID");
  assert.equal(pagadas[0].gatewayRef, PI, "el candado es el PaymentIntent, no la sesión");
  assert.equal(recargas().length, 1, "sin filas sobrantes");
  assert.equal(monedero(OTRA)!.balanceCents, 9_000, "la otra clínica ni se entera");
}

/* ── 1 · la red de seguridad ────────────────────────────────────────── */

test("el caso BEVADENT: solo llega checkout.session.completed y el saldo SE ABONA", async () => {
  await entrega(sesionCompletada());
  seAbonoUnaVez();
});

test("sesión y luego PaymentIntent del mismo pago: el saldo sube UNA vez", async () => {
  await entrega(sesionCompletada());
  await entrega(intentoCobrado());
  seAbonoUnaVez();
});

test("PaymentIntent y luego sesión del mismo pago: el saldo sube UNA vez", async () => {
  await entrega(intentoCobrado());
  await entrega(sesionCompletada());
  seAbonoUnaVez();
});

test("los dos eventos a la vez (Stripe los manda en paralelo): UNA vez", async () => {
  await Promise.all([entrega(sesionCompletada()), entrega(intentoCobrado())]);
  seAbonoUnaVez();
});

test("Stripe reintenta el mismo evento: la repetición no abona de nuevo", async () => {
  await entrega(sesionCompletada());
  await entrega(sesionCompletada());
  await entrega(intentoCobrado());
  await entrega(intentoCobrado());
  seAbonoUnaVez();
});

test("la sesión con el pago PENDIENTE no abona; cuando el PaymentIntent confirma, sí (una vez)", async () => {
  await entrega(sesionCompletada({ payment_status: "unpaid" }));
  assert.equal(monedero()!.balanceCents, 1_500, "sin pago hecho no hay abono");
  assert.equal(recargas().length, 0);
  await entrega(intentoCobrado());
  seAbonoUnaVez();
});

test("una sesión de recarga sin PaymentIntent no abona (no habría candado)", async () => {
  await entrega(sesionCompletada({ payment_intent: null }));
  assert.equal(monedero()!.balanceCents, 1_500);
  assert.equal(recargas().length, 0);
});

test("la sesión de una suscripción o de una factura de paciente sigue sin tocar el monedero", async () => {
  await entrega(sesionCompletada({ metadata: { kind: "platform-subscription", clinicId: CLINICA }, payment_status: "unpaid" }));
  await entrega(sesionCompletada({ metadata: { kind: "platform-subscription", clinicId: CLINICA, plan: "PRO" }, payment_status: "paid", payment_intent: null }));
  assert.equal(monedero()!.balanceCents, 1_500);
  assert.equal(recargas().length, 0);
});

test("por la sesión también se guarda la tarjeta (leyendo el PaymentIntent, sin cobrar)", async () => {
  stripeDoble.leer = async (id) => ({ id, metadata: { clinicId: CLINICA }, setup_future_usage: "off_session", payment_method: "pm_visa_4242" });
  await entrega(sesionCompletada());
  assert.equal(monedero()!.stripePaymentMethodId, "pm_visa_4242");
  assert.equal(stripeDoble.llamadas.length, 0, "leer no es cobrar");
});

test("topupFromCheckoutSession: el ref es el PaymentIntent y nunca el id de la sesión", () => {
  const t = topupFromCheckoutSession(sesionCompletada().data.object as any);
  assert.deepEqual(t, { clinicId: CLINICA, amountCents: MONTO, paymentIntentId: PI });
  assert.equal(topupFromCheckoutSession(sesionCompletada({ payment_status: "unpaid" }).data.object as any), null);
  assert.equal(topupFromCheckoutSession(sesionCompletada({ payment_status: "no_payment_required" }).data.object as any), null);
  assert.equal(topupFromCheckoutSession(sesionCompletada({ metadata: { kind: "ai-topup" } }).data.object as any), null, "sin clínica no hay a quién abonar");
  assert.equal(topupFromCheckoutSession(sesionCompletada({ amount_total: 0, metadata: { kind: "ai-topup", clinicId: CLINICA } }).data.object as any), null);
  // PaymentIntent expandido (objeto) → mismo id.
  assert.equal(topupFromCheckoutSession(sesionCompletada({ payment_intent: { id: PI } }).data.object as any)?.paymentIntentId, PI);
});

/* ── 2 · la recarga automática ──────────────────────────────────────── */

function conAutoRecarga(over: Fila = {}) {
  Object.assign(monedero()!, {
    balanceCents: 500, autoRecharge: true, autoRechargeThresholdCents: 5_000, autoRechargeAmountCents: 10_000,
    stripePaymentMethodId: "pm_guardada", ...over,
  });
}
const intentoOk = async (p: Fila) => ({ id: "pi_auto_1", status: "succeeded", amount: p.amount, amount_received: p.amount, metadata: p.metadata });
const tarjetaMuerta = async (p: Fila) => {
  const err: any = new Error("Your card has expired.");
  err.type = "StripeCardError";
  err.code = "expired_card";
  err.raw = { code: "expired_card", payment_intent: { id: `pi_rechazado_${stripeDoble.llamadas.length}`, status: "requires_payment_method", metadata: p.metadata } };
  throw err;
};

test("auto-recarga: cobra la tarjeta guardada y acredita una vez, con la reserva como llave", async () => {
  conAutoRecarga();
  stripeDoble.crear = intentoOk;
  await triggerAutoRechargeIfNeeded(CLINICA);
  assert.equal(stripeDoble.llamadas.length, 1);
  const { params, opts } = stripeDoble.llamadas[0];
  assert.equal(params.off_session, true);
  assert.equal(params.confirm, true);
  assert.equal(params.payment_method, "pm_guardada");
  assert.equal(params.metadata.trigger, "auto");
  assert.ok(params.metadata.topupId, "el PaymentIntent lleva la reserva");
  assert.equal(opts.idempotencyKey, `autorecharge:${params.metadata.topupId}`);
  assert.equal(monedero()!.balanceCents, 10_500);
  assert.equal(recargas().length, 1, "la reserva PENDING se convirtió en la PAID: no hay dos filas");
  assert.equal(recargas()[0].status, "PAID");
  assert.equal(recargas()[0].gatewayRef, "pi_auto_1");
});

test("dos disparos a la vez (dos mensajes del bot, o bot + cron): UN solo cobro", async () => {
  conAutoRecarga();
  stripeDoble.crear = intentoOk;
  await Promise.all([triggerAutoRechargeIfNeeded(CLINICA), triggerAutoRechargeIfNeeded(CLINICA), corridaDelCron()]);
  assert.equal(stripeDoble.llamadas.length, 1, "Stripe recibe UN PaymentIntent");
  assert.equal(monedero()!.balanceCents, 10_500);
  assert.equal(recargas().length, 1);
});

test("el webhook llega ANTES de que el camino inline acredite: una sola fila PAID y un solo abono", async () => {
  conAutoRecarga();
  stripeDoble.crear = async (p) => {
    // Stripe cobró y su webhook nos gana la carrera.
    await entrega(intentoCobrado({ id: "pi_auto_1", payment_method: null, setup_future_usage: null, metadata: p.metadata, amount: p.amount, amount_received: p.amount }));
    return intentoOk(p);
  };
  await triggerAutoRechargeIfNeeded(CLINICA);
  assert.equal(monedero()!.balanceCents, 10_500, "un abono");
  assert.equal(abonos().length, 1);
  assert.equal(recargas().length, 1, "el webhook transicionó la reserva; el inline no creó otra");
  assert.equal(recargas()[0].status, "PAID");
});

test("cobro rechazado: NO acredita, deja la marca FAILED y no vuelve a intentar en 24 h", async () => {
  conAutoRecarga();
  stripeDoble.crear = tarjetaMuerta;
  await triggerAutoRechargeIfNeeded(CLINICA);
  assert.equal(monedero()!.balanceCents, 500, "nada que abonar");
  assert.equal(recargas().length, 1);
  assert.equal(recargas()[0].status, "FAILED");
  assert.equal(recargas()[0].gatewayRef, "pi_rechazado_1");

  // El bot sigue mandando mensajes y el cron corre cada hora: ni un intento más.
  await triggerAutoRechargeIfNeeded(CLINICA);
  await corridaDelCron();
  await triggerAutoRechargeIfNeeded(CLINICA);
  assert.equal(stripeDoble.llamadas.length, 1, "un solo golpe a la tarjeta muerta");
  assert.equal(recargas().length, 1, "una sola fila FAILED, no una por intento");

  // El webhook de Stripe del mismo fallo tampoco duplica la marca.
  await entrega(intentoFallido({ id: "pi_rechazado_1", metadata: { kind: "ai-topup", clinicId: CLINICA, amountCents: "10000", topupId: recargas()[0].id } }));
  assert.equal(recargas().length, 1);
});

test("pasado el backoff se reintenta una vez; una recarga manual PAID lo rearma antes", async () => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-22T16:22:00Z") });
  try {
    conAutoRecarga();
    stripeDoble.crear = tarjetaMuerta;
    await triggerAutoRechargeIfNeeded(CLINICA);
    assert.equal(stripeDoble.llamadas.length, 1);

    mock.timers.setTime(Date.now() + AUTO_RECHARGE_FAILED_BACKOFF_MS - 60_000);
    await triggerAutoRechargeIfNeeded(CLINICA);
    assert.equal(stripeDoble.llamadas.length, 1, "a las 23 h 59 min todavía no");

    mock.timers.setTime(Date.now() + 2 * 60_000);
    await triggerAutoRechargeIfNeeded(CLINICA);
    assert.equal(stripeDoble.llamadas.length, 2, "pasadas las 24 h, un intento más (y solo uno)");
    await triggerAutoRechargeIfNeeded(CLINICA);
    assert.equal(stripeDoble.llamadas.length, 2);

    // La clínica cambia la tarjeta y recarga a mano: el pago manual llega por webhook…
    mock.timers.setTime(Date.now() + 1_000);
    await entrega(intentoCobrado({ id: "pi_manual", metadata: { kind: "ai-topup", clinicId: CLINICA, amountCents: String(MONTO) } }));
    assert.equal(monedero()!.balanceCents, 500 + MONTO);
    // …y como ya no está bajo el umbral, no hay auto-recarga. Si vuelve a bajar,
    // el último cobro Stripe es PAID: se intenta de nuevo sin esperar 24 h.
    mock.timers.setTime(Date.now() + AUTO_RECHARGE_COOLDOWN_MS + 1_000);
    monedero()!.balanceCents = 100;
    stripeDoble.crear = intentoOk;
    await triggerAutoRechargeIfNeeded(CLINICA);
    assert.equal(stripeDoble.llamadas.length, 3);
    assert.equal(monedero()!.balanceCents, 10_100);
  } finally {
    mock.timers.reset();
  }
});

test("el banco pide 3D Secure (authentication_required): no se cobra, FAILED y sin bucle", async () => {
  conAutoRecarga();
  stripeDoble.crear = async (p) => {
    const err: any = new Error("This transaction requires authentication.");
    err.type = "StripeCardError";
    err.code = "authentication_required";
    err.raw = { code: "authentication_required", payment_intent: { id: "pi_3ds", status: "requires_action", metadata: p.metadata } };
    throw err;
  };
  await triggerAutoRechargeIfNeeded(CLINICA);
  await triggerAutoRechargeIfNeeded(CLINICA);
  assert.equal(stripeDoble.llamadas.length, 1);
  assert.equal(monedero()!.balanceCents, 500);
  assert.deepEqual(recargas().map((t) => [t.status, t.gatewayRef]), [["FAILED", "pi_3ds"]]);
});

test("Stripe caído (sin código de error): la reserva queda PENDING, sin FAILED ni backoff de 24 h", async () => {
  conAutoRecarga();
  stripeDoble.crear = async () => { const e: any = new Error("ETIMEDOUT"); e.type = "StripeConnectionError"; throw e; };
  await triggerAutoRechargeIfNeeded(CLINICA);
  assert.equal(recargas().length, 1);
  assert.equal(recargas()[0].status, "PENDING");
  // Dentro del cooldown no se insiste…
  await triggerAutoRechargeIfNeeded(CLINICA);
  assert.equal(stripeDoble.llamadas.length, 1);
  // …y si el PaymentIntent sí se creó y cobró, su webhook acredita SOBRE la reserva.
  await entrega(intentoCobrado({ id: "pi_tarde", amount: 10_000, amount_received: 10_000, payment_method: null, setup_future_usage: null, metadata: { kind: "ai-topup", clinicId: CLINICA, amountCents: "10000", topupId: recargas()[0].id } }));
  assert.equal(monedero()!.balanceCents, 10_500);
  assert.deepEqual(recargas().map((t) => [t.status, t.gatewayRef]), [["PAID", "pi_tarde"]]);
});

test("cron: cuando la tarjeta falló, el aviso a la clínica lo dice (y no solo 'saldo bajo')", async () => {
  conAutoRecarga();
  stripeDoble.crear = tarjetaMuerta;
  const r = await corridaDelCron();
  assert.equal(r.rechargeFailed, 1);
  assert.equal(r.recharged, 0);
  assert.equal(whatsapps.length, 1);
  assert.equal(whatsapps[0].to, "+5215512345678");
  assert.match(whatsapps[0].body, /tarjeta/);
  assert.match(whatsapps[0].body, /BEVADENT/);
  assert.ok(monedero()!.lowBalanceNotifiedAt, "aviso durable para el panel");
  // La corrida siguiente, una hora después, ni cobra ni repite el aviso.
  const r2 = await corridaDelCron();
  assert.equal(stripeDoble.llamadas.length, 1);
  assert.equal(r2.alerted, 0);
  assert.equal(whatsapps.length, 1);
});

test("cron: sin auto-recarga el aviso sigue siendo el de saldo bajo de siempre", async () => {
  monedero()!.balanceCents = 200;
  const r = await corridaDelCron();
  assert.equal(r.rechargeFailed, 0);
  assert.equal(stripeDoble.llamadas.length, 0, "sin tarjeta no se cobra nada");
  assert.equal(whatsapps.length, 1);
  assert.doesNotMatch(whatsapps[0].body, /tarjeta/);
  assert.match(whatsapps[0].body, /saldo de tu asistente de IA está bajo/);
});
