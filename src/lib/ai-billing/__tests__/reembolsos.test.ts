/**
 * UN REEMBOLSO O UN CONTRACARGO QUITA EL SALDO (H3 de la auditoría del 22-sep-2026).
 *
 * Run: npm run test:ai-reembolsos
 *
 * Antes: el webhook de Stripe solo atendía el pago y el de Mercado Pago solo
 * el `approved`. Una clínica recargaba $200, pedía el reembolso (o disputaba el
 * cargo con su banco) y se quedaba con el dinero Y con el saldo.
 *
 * Qué fija, con los webhooks DE VERDAD (`/api/webhooks/stripe` y
 * `/api/webhooks/mercadopago` enteros) contra un monedero en memoria:
 *   · reembolso total, parcial y en dos partes;
 *   · el mismo evento repetido —en serie y a la vez— descuenta UNA vez;
 *   · con el saldo ya gastado, el monedero queda en negativo y a la vista;
 *   · una disputa descuenta al abrirse y devuelve si se gana; perdida, se queda;
 *   · un reembolso que llega antes que el abono se cuadra cuando llega el abono;
 *   · un cobro de Stripe que no es recarga del monedero no toca nada;
 *   · el clinicId sale de nuestra fila `ai_topups`, nunca del evento;
 *   · Mercado Pago: parcial, total, contracargo, reclamación y repetición.
 *
 * Ni un cobro real: Stripe y Mercado Pago son dobles; la firma de Stripe se
 * salta con `constructEvent = JSON.parse`.
 */
import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { crearMonederoDoble, instalarDobles } from "./_monedero-doble";
import { objetivoReversionMp, objetivoReversionStripe, deltaReversion } from "../reversion-core";

const base = crearMonederoDoble();

/* ── Stripe de mentira: lo que HOY dice de cada PaymentIntent ───────────── */
const stripeEstado = {
  reembolsado: new Map<string, number>(),
  disputas: new Map<string, Array<{ amount: number; status: string }>>(),
  llamadasApi: 0,
  /** Si está puesta, cada consulta a Stripe espera aquí: fuerza a que las entregas se crucen. */
  barrera: null as null | (() => Promise<void>),
  /** Si está puesta, decide qué contesta (y cuánto tarda) la consulta n-ésima de cargos. */
  guionCargos: null as null | ((n: number) => { reembolsado: number; tardaMs: number }),
  consultasCargos: 0,
};
const stripeDoble = {
  webhooks: { constructEvent: (raw: string) => JSON.parse(raw) },
  charges: {
    list: async ({ payment_intent }: { payment_intent: string }) => {
      stripeEstado.llamadasApi++;
      if (stripeEstado.barrera) await stripeEstado.barrera();
      const n = ++stripeEstado.consultasCargos;
      if (stripeEstado.guionCargos) {
        const { reembolsado, tardaMs } = stripeEstado.guionCargos(n);
        await new Promise((r) => setTimeout(r, tardaMs));
        return { data: [{ id: `ch_${payment_intent}`, amount_refunded: reembolsado }] };
      }
      return { data: [{ id: `ch_${payment_intent}`, amount_refunded: stripeEstado.reembolsado.get(payment_intent) ?? 0 }] };
    },
  },
  disputes: {
    list: async ({ payment_intent }: { payment_intent: string }) => {
      stripeEstado.llamadasApi++;
      return { data: stripeEstado.disputas.get(payment_intent) ?? [] };
    },
  },
};

/* ── Mercado Pago de mentira: el pago tal como lo devuelve su API ───────── */
const mpPagos = new Map<string, Record<string, unknown>>();

instalarDobles({
  "src/lib/prisma.ts": { prisma: base.prisma },
  "src/lib/stripe.ts": {
    __esModule: true,
    default: () => stripeDoble,
    getStripeSafe: () => stripeDoble,
    stripeUnavailableResponse: () => ({ error: "sin stripe" }),
  },
  "src/lib/whatsapp/send-and-log.ts": { sendWhatsAppLogged: async () => ({ ok: true }) },
  "src/env.ts": { env: { MERCADOPAGO_ACCESS_TOKEN: "APP_USR-prueba-no-es-real" } },
});

let stripePOST: (req: any) => Promise<Response>;
let mpPOST: (req: any) => Promise<Response>;
let NextRequestCtor: any;
let wallet: typeof import("../wallet");

const CLINICA = "clinica_norte";
const OTRA = "clinica_sur";

before(async () => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_prueba";
  globalThis.fetch = (async (url: unknown) => {
    const m = /^https:\/\/api\.mercadopago\.com\/v1\/payments\/(\d+)$/.exec(String(url));
    assert.ok(m, `fetch inesperado: ${String(url)}`);
    const pago = mpPagos.get(m![1]);
    if (!pago) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(pago), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  ({ NextRequest: NextRequestCtor } = await import("next/server"));
  ({ POST: stripePOST } = await import("@/app/api/webhooks/stripe/route"));
  ({ POST: mpPOST } = await import("@/app/api/webhooks/mercadopago/route"));
  wallet = await import("../wallet");
});

beforeEach(() => {
  base.reiniciar();
  stripeEstado.reembolsado.clear();
  stripeEstado.disputas.clear();
  stripeEstado.llamadasApi = 0;
  stripeEstado.barrera = null;
  stripeEstado.guionCargos = null;
  stripeEstado.consultasCargos = 0;
  mpPagos.clear();
});

/** Nadie sigue hasta que lleguen `n`, o hasta 50 ms (con candado, la que espera no llega nunca). */
function barrera(n: number) {
  let llegadas = 0;
  let abrir!: () => void;
  const abierta = new Promise<void>((r) => (abrir = r));
  return async () => {
    if (++llegadas >= n) abrir();
    await Promise.race([abierta, new Promise((r) => setTimeout(r, 50))]);
  };
}

let eventos = 0;
async function stripe(type: string, object: Record<string, unknown>) {
  const res = await stripePOST(
    new NextRequestCtor("http://localhost/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=prueba" },
      body: JSON.stringify({ id: `evt_${++eventos}`, type, data: { object } }),
    }),
  );
  assert.equal(res.status, 200, `el webhook respondió ${res.status}: ${await res.clone().text()}`);
}

/** Una recarga con tarjeta que ya se abonó por el webhook de siempre. */
async function recargaStripe(clinicId: string, pi: string, cents: number) {
  await stripe("payment_intent.succeeded", {
    id: pi, amount: cents, amount_received: cents, metadata: { kind: "ai-topup", clinicId, amountCents: String(cents) },
  });
}

const saldo = (clinicId = CLINICA) => base.monedero(clinicId)!.balanceCents;
const reembolsos = (clinicId = CLINICA) => base.movimientos(clinicId).filter((m) => m.type === "REFUND");

/* ── La regla, sin base ─────────────────────────────────────────────────── */

test("objetivo de Stripe: reembolsos acumulados + disputas con fondos retirados, nunca más que la recarga", () => {
  const o = (reembolsadoCents: number, disputas: Array<{ amount: number; status: string }> = []) =>
    objetivoReversionStripe({ recargaCents: 20_000, reembolsadoCents, disputas }).objetivoCents;
  assert.equal(o(0), 0);
  assert.equal(o(5_000), 5_000);
  assert.equal(o(20_000), 20_000);
  assert.equal(o(25_000), 20_000, "nunca más que lo abonado");
  assert.equal(o(0, [{ amount: 20_000, status: "needs_response" }]), 20_000, "al abrirse, ya se retiró el dinero");
  assert.equal(o(0, [{ amount: 20_000, status: "under_review" }]), 20_000);
  assert.equal(o(0, [{ amount: 20_000, status: "lost" }]), 20_000);
  assert.equal(o(0, [{ amount: 20_000, status: "won" }]), 0, "ganada, el dinero volvió");
  assert.equal(o(0, [{ amount: 20_000, status: "warning_needs_response" }]), 0, "un aviso no retira dinero");
  assert.equal(o(0, [{ amount: 20_000, status: "prevented" }]), 0);
  assert.equal(o(5_000, [{ amount: 15_000, status: "lost" }]), 20_000);
});

test("objetivo de Mercado Pago según el estado del pago", () => {
  const o = (status: string, reembolsadoPesos: number | null = null, statusDetail: string | null = null) =>
    objetivoReversionMp({ recargaCents: 20_000, status, statusDetail, reembolsadoPesos }).objetivoCents;
  assert.equal(o("approved"), 0);
  assert.equal(o("approved", 50.5), 5_050, "parcial: sigue approved con lo devuelto");
  assert.equal(o("refunded", 200), 20_000);
  assert.equal(o("charged_back"), 20_000);
  assert.equal(o("charged_back", null, "reimbursed"), 0, "MP nos cubrió: el dinero se quedó");
  assert.equal(o("in_mediation"), 20_000, "reclamación abierta: MP retiene el dinero");
  assert.equal(deltaReversion(20_000, 20_000), 0, "ya cuadra: el evento repetido no hace nada");
  assert.equal(deltaReversion(0, 20_000), -20_000, "disputa ganada: se devuelve");
});

/* ── Stripe, con el webhook entero ──────────────────────────────────────── */

test("reembolso TOTAL: el saldo de esa recarga se descuenta con un movimiento REFUND y se apaga la auto-recarga", async () => {
  await base.prisma.aiWallet.create({ data: { clinicId: CLINICA, autoRecharge: true, stripePaymentMethodId: "pm_1" } });
  await recargaStripe(CLINICA, "pi_200", 20_000);
  assert.equal(saldo(), 20_000);

  stripeEstado.reembolsado.set("pi_200", 20_000);
  await stripe("charge.refunded", { id: "ch_pi_200", payment_intent: "pi_200", amount_refunded: 20_000 });

  assert.equal(saldo(), 0);
  const [r] = reembolsos();
  assert.equal(r.amountCents, -20_000);
  assert.equal(r.balanceAfterCents, 0);
  assert.equal(r.source, "STRIPE");
  assert.equal(r.reference, "pi_200");
  assert.match(r.note, /Reembolso de la recarga con tarjeta/);
  assert.equal(base.monedero(CLINICA)!.autoRecharge, false, "la auto-recarga volvería a cobrar la tarjeta reembolsada");
});

test("reembolso PARCIAL, y luego otro: se descuenta lo devuelto, acumulado, no la recarga entera", async () => {
  await recargaStripe(CLINICA, "pi_200", 20_000);

  stripeEstado.reembolsado.set("pi_200", 5_000);
  await stripe("charge.refunded", { id: "ch_pi_200", payment_intent: "pi_200", amount_refunded: 5_000 });
  assert.equal(saldo(), 15_000);

  stripeEstado.reembolsado.set("pi_200", 8_000); // segundo parcial de 3 000
  await stripe("refund.created", { id: "re_2", payment_intent: "pi_200", amount: 3_000 });
  assert.equal(saldo(), 12_000);
  assert.deepEqual(reembolsos().map((m) => m.amountCents), [-5_000, -3_000]);
});

test("el MISMO reembolso repetido (en serie y a la vez) descuenta una sola vez", async () => {
  await recargaStripe(CLINICA, "pi_200", 20_000);
  stripeEstado.reembolsado.set("pi_200", 20_000);
  const reembolso = { id: "ch_pi_200", payment_intent: "pi_200", amount_refunded: 20_000 };

  await stripe("charge.refunded", reembolso);
  await stripe("charge.refunded", reembolso);
  // Y los eventos hermanos del mismo reembolso, que Stripe manda aparte.
  await stripe("refund.created", { id: "re_1", payment_intent: "pi_200" });
  await stripe("charge.refund.updated", { id: "re_1", payment_intent: "pi_200" });
  assert.equal(reembolsos().length, 1);

  // Otro reembolso de otra recarga, entregado cinco veces A LA VEZ: las cinco
  // consultan Stripe juntas y llegan juntas al monedero; la segunda espera al
  // candado y ve el REFUND de la primera.
  await recargaStripe(CLINICA, "pi_300", 30_000);
  stripeEstado.reembolsado.set("pi_300", 30_000);
  stripeEstado.barrera = barrera(5);
  await Promise.all(
    Array.from({ length: 5 }, () => stripe("charge.refunded", { id: "ch_pi_300", payment_intent: "pi_300", amount_refunded: 30_000 })),
  );

  assert.equal(saldo(), 0);
  assert.equal(reembolsos().length, 2);
});

test("un aviso VIEJO que entra tarde al candado no deshace el descuento de uno nuevo", async () => {
  await recargaStripe(CLINICA, "pi_200", 20_000);
  stripeEstado.consultasCargos = 0;
  // Dos parciales de $50 casi seguidos. El aviso A pregunta primero y lee «$50»,
  // pero tarda en llegar al monedero; el B lee «$100» y descuenta $100 antes.
  // Cualquier consulta posterior ya ve los $100.
  stripeEstado.guionCargos = (n) => (n === 1 ? { reembolsado: 5_000, tardaMs: 40 } : { reembolsado: 10_000, tardaMs: 0 });
  const a = stripe("charge.refunded", { id: "ch_pi_200", payment_intent: "pi_200", amount_refunded: 5_000 });
  await new Promise((r) => setTimeout(r, 5));
  const b = stripe("charge.refunded", { id: "ch_pi_200", payment_intent: "pi_200", amount_refunded: 10_000 });
  await Promise.all([a, b]);

  // A devolvió $50 con su dato viejo, volvió a preguntar y lo corrigió.
  assert.equal(saldo(), 10_000, "el aviso viejo dejó descontado de menos");
  assert.equal(-reembolsos().reduce((n, m) => n + m.amountCents, 0), 10_000);
});

test("con el saldo YA GASTADO: recargó $200, gastó $150, le devuelven $200 → queda en −$150, a la vista, y no puede gastar", async () => {
  await recargaStripe(CLINICA, "pi_200", 20_000);
  await wallet.chargeUsage({ clinicId: CLINICA, feature: "sabina", model: "claude-sonnet-4-6", inputTokens: 0, outputTokens: 0 });
  base.monedero(CLINICA)!.balanceCents = 5_000; // gastó $150

  stripeEstado.reembolsado.set("pi_200", 20_000);
  await stripe("charge.refunded", { id: "ch_pi_200", payment_intent: "pi_200", amount_refunded: 20_000 });

  assert.equal(saldo(), -15_000);
  const [r] = reembolsos();
  assert.equal(r.balanceAfterCents, -15_000);
  assert.match(r.note, /queda en negativo/);
  assert.equal(await wallet.canSpend(CLINICA), false);
  assert.equal(await wallet.reservarSaldo(CLINICA, "whatsapp_bot", 1), null);

  // La siguiente recarga cubre primero el negativo.
  await recargaStripe(CLINICA, "pi_otra", 20_000);
  assert.equal(saldo(), 5_000);
});

test("DISPUTA: se descuenta al abrirse; si se gana, el saldo vuelve", async () => {
  await recargaStripe(CLINICA, "pi_200", 20_000);

  stripeEstado.disputas.set("pi_200", [{ amount: 20_000, status: "needs_response" }]);
  await stripe("charge.dispute.created", { id: "dp_1", payment_intent: "pi_200", amount: 20_000, status: "needs_response" });
  assert.equal(saldo(), 0);
  assert.match(reembolsos()[0].note, /Contracargo/);
  // Un funds_withdrawn del mismo dinero no descuenta otra vez.
  await stripe("charge.dispute.funds_withdrawn", { id: "dp_1", payment_intent: "pi_200" });
  assert.equal(saldo(), 0);

  stripeEstado.disputas.set("pi_200", [{ amount: 20_000, status: "won" }]);
  await stripe("charge.dispute.closed", { id: "dp_1", payment_intent: "pi_200", status: "won" });
  assert.equal(saldo(), 20_000);
  assert.deepEqual(reembolsos().map((m) => m.amountCents), [-20_000, 20_000]);
  assert.match(reembolsos()[1].note, /Se devuelve/);
});

test("DISPUTA perdida: el descuento se queda; y un aviso previo (warning) no descuenta nada", async () => {
  await recargaStripe(CLINICA, "pi_200", 20_000);
  stripeEstado.disputas.set("pi_200", [{ amount: 20_000, status: "warning_needs_response" }]);
  await stripe("charge.dispute.created", { id: "dp_1", payment_intent: "pi_200" });
  assert.equal(saldo(), 20_000, "un aviso de disputa no retira dinero");

  stripeEstado.disputas.set("pi_200", [{ amount: 20_000, status: "lost" }]);
  await stripe("charge.dispute.closed", { id: "dp_1", payment_intent: "pi_200", status: "lost" });
  assert.equal(saldo(), 0);
  assert.equal(reembolsos().length, 1);
});

test("el reembolso que llega ANTES que el abono se cuadra cuando llega el abono", async () => {
  // El aviso del pago falló y Stripe lo reintenta días después; entretanto, se reembolsó.
  stripeEstado.reembolsado.set("pi_200", 20_000);
  await stripe("charge.refunded", { id: "ch_pi_200", payment_intent: "pi_200", amount_refunded: 20_000 });
  assert.equal(base.monedero(CLINICA), undefined, "sin recarga abonada no hay nada que descontar");

  await recargaStripe(CLINICA, "pi_200", 20_000);
  assert.equal(saldo(), 0, "se abonó un pago que ya estaba reembolsado");
  assert.deepEqual(base.movimientos(CLINICA).map((m) => [m.type, m.amountCents]), [["TOPUP", 20_000], ["REFUND", -20_000]]);
});

test("un reembolso de un cobro que NO es recarga del monedero (suscripción) no toca nada ni llama a Stripe", async () => {
  await recargaStripe(CLINICA, "pi_200", 20_000);
  stripeEstado.llamadasApi = 0;
  await stripe("charge.refunded", { id: "ch_sub", payment_intent: "pi_suscripcion", amount_refunded: 99_900 });
  await stripe("charge.dispute.created", { id: "dp_x", payment_intent: "pi_suscripcion" });
  await stripe("charge.refunded", { id: "ch_sin_pi", payment_intent: null });
  assert.equal(saldo(), 20_000);
  assert.equal(stripeEstado.llamadasApi, 0);
});

test("el clinicId sale de nuestra recarga, nunca del evento", async () => {
  await recargaStripe(CLINICA, "pi_200", 20_000);
  await base.prisma.aiWallet.create({ data: { clinicId: OTRA, balanceCents: 7_000 } });
  stripeEstado.reembolsado.set("pi_200", 20_000);
  await stripe("charge.refunded", {
    id: "ch_pi_200", payment_intent: "pi_200", amount_refunded: 20_000, metadata: { clinicId: OTRA },
  });
  assert.equal(saldo(CLINICA), 0);
  assert.equal(saldo(OTRA), 7_000);
  assert.equal(reembolsos(OTRA).length, 0);
});

/* ── Mercado Pago, con el webhook entero ────────────────────────────────── */

async function mp(topupId: string, paymentId: string) {
  const res = await mpPOST(
    new NextRequestCtor(`http://localhost/api/webhooks/mercadopago?ref=aitopup:${topupId}`, {
      method: "POST",
      body: JSON.stringify({ data: { id: paymentId } }),
    }),
  );
  assert.equal(res.status, 200, `el webhook respondió ${res.status}`);
}

function pagoMp(topupId: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    id: 555, status, external_reference: `aitopup:${topupId}`, transaction_amount: 200, currency_id: "MXN", ...extra,
  };
}

test("Mercado Pago: abono, reembolso parcial, total y avisos repetidos", async () => {
  const topup = await base.prisma.aiTopup.create({ data: { clinicId: CLINICA, amountCents: 20_000, method: "MERCADOPAGO" } });
  mpPagos.set("555", pagoMp(topup.id, "approved"));
  await mp(topup.id, "555");
  await mp(topup.id, "555");
  assert.equal(saldo(), 20_000);

  mpPagos.set("555", pagoMp(topup.id, "approved", { transaction_amount_refunded: 50 }));
  await mp(topup.id, "555");
  assert.equal(saldo(), 15_000);

  mpPagos.set("555", pagoMp(topup.id, "refunded", { transaction_amount_refunded: 200 }));
  await Promise.all([mp(topup.id, "555"), mp(topup.id, "555"), mp(topup.id, "555")]);
  assert.equal(saldo(), 0);
  assert.deepEqual(reembolsos().map((m) => [m.amountCents, m.source, m.reference]), [
    [-5_000, "MERCADOPAGO", "555"],
    [-15_000, "MERCADOPAGO", "555"],
  ]);
});

test("Mercado Pago: reclamación abierta descuenta, resuelta a favor devuelve; contracargo cubierto por MP no descuenta", async () => {
  const topup = await base.prisma.aiTopup.create({ data: { clinicId: CLINICA, amountCents: 20_000, method: "MERCADOPAGO" } });
  mpPagos.set("555", pagoMp(topup.id, "approved"));
  await mp(topup.id, "555");

  mpPagos.set("555", pagoMp(topup.id, "in_mediation"));
  await mp(topup.id, "555");
  assert.equal(saldo(), 0);
  assert.match(reembolsos()[0].note, /Reclamación/);

  mpPagos.set("555", pagoMp(topup.id, "approved"));
  await mp(topup.id, "555");
  assert.equal(saldo(), 20_000);

  mpPagos.set("555", pagoMp(topup.id, "charged_back", { status_detail: "reimbursed" }));
  await mp(topup.id, "555");
  assert.equal(saldo(), 20_000);

  mpPagos.set("555", pagoMp(topup.id, "charged_back", { status_detail: "settled" }));
  await mp(topup.id, "555");
  assert.equal(saldo(), 0);
});

test("Mercado Pago: un pago reembolsado que nunca se abonó no abona ni descuenta", async () => {
  const topup = await base.prisma.aiTopup.create({ data: { clinicId: CLINICA, amountCents: 20_000, method: "MERCADOPAGO" } });
  mpPagos.set("555", pagoMp(topup.id, "refunded", { transaction_amount_refunded: 200 }));
  await mp(topup.id, "555");
  assert.equal(base.monedero(CLINICA), undefined);
  assert.equal(base.tablas.aiWalletTransaction.filas.length, 0);
});
