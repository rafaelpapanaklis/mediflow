/**
 * HISTORIAL DE FACTURAS — un pago, un renglón; y las recargas de saldo IA sí salen.
 *
 * Run: npm run test:historial-facturas
 *
 * Conduce la RUTA real (`GET /api/billing/invoices`) contra un doble de prisma
 * que aplica el `where` de verdad (clinicId, OR, gt, in) y un doble de Stripe.
 * Así se prueba lo que ve la clínica, no la forma de una función suelta:
 *
 *  A · El cobro de $29 del 19-sep salía DOS veces: la factura de Stripe y su
 *      copia en `subscription_invoices` (reference = invoice.id). Ahora una,
 *      la de Stripe (con PDF). Y si Stripe no contesta, la local sigue ahí.
 *  B · La recarga de $200 de BEVADENT (checkout `mode: "payment"` = un cargo,
 *      no una factura) no aparecía en ningún lado. Ahora sale, con su importe;
 *      el abono a mano sale igual de pagado pero sin comprobante inventado.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

type Fila = Record<string, any>;

// ── Doble de prisma: tablas en memoria + un intérprete de `where` ───────────

let tablas: Record<"clinic" | "subscriptionInvoice" | "aiWalletTransaction" | "aiTopup", Fila[]>;
const consultas: Array<{ modelo: string; where: any }> = [];

function cumple(fila: Fila, where: any): boolean {
  if (!where) return true;
  for (const [clave, cond] of Object.entries(where)) {
    if (clave === "OR") {
      if (!(cond as any[]).some((w) => cumple(fila, w))) return false;
      continue;
    }
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      for (const [op, v] of Object.entries(cond as Record<string, any>)) {
        if (op === "gt") { if (!(fila[clave] > v)) return false; }
        else if (op === "in") { if (!(v as any[]).includes(fila[clave])) return false; }
        else throw new Error(`operador sin doble: ${op}`); // nada de falsos verdes
      }
      continue;
    }
    if (fila[clave] !== cond) return false;
  }
  return true;
}

function modelo(nombre: keyof typeof tablas) {
  const buscar = ({ where, orderBy, take }: any = {}) => {
    consultas.push({ modelo: nombre, where });
    let filas = tablas[nombre].filter((f) => cumple(f, where));
    if (orderBy?.createdAt === "desc") {
      filas = [...filas].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }
    return typeof take === "number" ? filas.slice(0, take) : filas;
  };
  return {
    findMany: async (args: any) => buscar(args),
    findUnique: async (args: any) => buscar(args)[0] ?? null,
  };
}

(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      clinic: modelo("clinic"),
      subscriptionInvoice: modelo("subscriptionInvoice"),
      aiWalletTransaction: modelo("aiWalletTransaction"),
      aiTopup: modelo("aiTopup"),
    },
  },
});

let sesion: { clinicId: string | undefined } = { clinicId: "c1" };
(mock as any).module("@/lib/auth", {
  namedExports: { getCurrentUser: async () => sesion },
});

// ── Doble de Stripe ─────────────────────────────────────────────────────────

let stripe: null | {
  invoices: { list: (p: any) => Promise<{ data: any[] }> };
  charges: { list: (p: any) => Promise<{ data: any[] }> };
};
const llamadasStripe: Array<{ que: string; params: any }> = [];
(mock as any).module("@/lib/stripe", {
  namedExports: { getStripeSafe: () => stripe },
});

function stripeCon(facturas: any[], cargos: any[] = [], fallos: { facturas?: boolean; cargos?: boolean } = {}) {
  return {
    invoices: {
      list: async (params: any) => {
        llamadasStripe.push({ que: "invoices", params });
        if (fallos.facturas) throw new Error("Stripe no contesta");
        return { data: facturas };
      },
    },
    charges: {
      list: async (params: any) => {
        llamadasStripe.push({ que: "charges", params });
        if (fallos.cargos) throw new Error("Stripe no contesta");
        return { data: cargos };
      },
    },
  };
}

async function historial() {
  const { GET } = await import("@/app/api/billing/invoices/route");
  const res = await GET();
  return { status: res.status, body: (await res.json()) as { invoices: any[]; stripeUnavailable: boolean } };
}

// ── Datos: el caso real, con los identificadores del encargo ────────────────

const IN_29 = "in_1UHHOaEgO7AoChdPFt55q3lg";
const PI_200 = "pi_3UIc4uEgO7AoChdP0qSe5KYc";
const s = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

const facturaStripe29 = {
  id: IN_29,
  number: "ANLFCA6H-0001",
  created: s("2026-09-19T18:00:00Z"),
  status: "paid",
  status_transitions: { paid_at: s("2026-09-19T18:00:05Z") },
  amount_due: 2900,
  amount_paid: 2900,
  total: 2900,
  currency: "usd",
  description: null,
  lines: { data: [{ description: "1 × DaleControl Profesional — Suscripción mensual" }] },
  invoice_pdf: "https://pay.stripe.com/invoice/acct_x/test_29/pdf",
  hosted_invoice_url: "https://invoice.stripe.com/i/acct_x/test_29",
};

const filaLocal29 = {
  id: "si_local_29",
  clinicId: "c1",
  amount: 29,
  currency: "USD",
  status: "paid",
  method: "stripe",
  reference: IN_29,
  periodStart: new Date("2026-09-19T18:00:00Z"),
  periodEnd: new Date("2026-10-19T18:00:00Z"),
  paidAt: new Date("2026-09-19T18:00:05Z"),
  notes: "Stripe subscription_create ANLFCA6H-0001",
  createdAt: new Date("2026-09-19T18:00:06Z"),
};

beforeEach(() => {
  consultas.length = 0;
  llamadasStripe.length = 0;
  sesion = { clinicId: "c1" };
  tablas = {
    clinic: [
      { id: "c1", stripeCustomerId: "cus_bevadent" },
      { id: "c2", stripeCustomerId: "cus_otra" },
    ],
    subscriptionInvoice: [filaLocal29],
    aiWalletTransaction: [],
    aiTopup: [],
  };
  stripe = stripeCon([facturaStripe29]);
});

// ═══════════════════════════════════════════════════════════════════════════
// A · Un pago, un renglón
// ═══════════════════════════════════════════════════════════════════════════

test("A · el cobro de $29 sale UNA vez, y es el de Stripe (con su PDF)", async () => {
  const { status, body } = await historial();
  assert.equal(status, 200);
  // En este escenario solo hay ese cobro: se cuentan TODOS los renglones.
  assert.equal(body.invoices.length, 1, `salieron ${body.invoices.length} renglones para un solo cobro`);
  const [fila] = body.invoices;
  assert.equal(fila.kind, "subscription");
  assert.equal(fila.id, `stripe:${IN_29}`, "cuando coinciden, manda la de Stripe");
  assert.equal(fila.description, "1 × DaleControl Profesional — Suscripción mensual");
  assert.equal(fila.amount, 29);
  assert.equal(fila.status, "paid");
  assert.equal(fila.downloadUrl, facturaStripe29.invoice_pdf, "la de Stripe trae el PDF");
  assert.equal(fila.topupVia, null);
});

test("A · si Stripe no contesta, el historial no se cae: queda la fila local, una sola", async () => {
  stripe = stripeCon([], [], { facturas: true });
  const { status, body } = await historial();
  assert.equal(status, 200, "Stripe caído no es un 500");
  assert.equal(body.invoices.length, 1);
  assert.equal(body.invoices[0].id, "local:si_local_29");
  assert.equal(body.invoices[0].description, "Stripe subscription_create ANLFCA6H-0001");
  assert.equal(body.stripeUnavailable, false);
});

test("A · sin Stripe configurado: solo locales y el aviso de siempre", async () => {
  stripe = null;
  const { body } = await historial();
  assert.equal(body.invoices.length, 1);
  assert.equal(body.invoices[0].id, "local:si_local_29");
  assert.equal(body.stripeUnavailable, true);
});

test("A · una fila local que NO es una factura de Stripe se queda (pago manual, adeudo CFDI)", async () => {
  tablas.subscriptionInvoice.push(
    { ...filaLocal29, id: "si_spei", reference: null, method: "transfer", notes: "Pago SPEI de octubre", amount: 599, currency: "MXN", paidAt: new Date("2026-09-10T15:00:00Z"), createdAt: new Date("2026-09-10T15:00:00Z") },
    { ...filaLocal29, id: "si_otra_ref", reference: "in_que_stripe_no_devolvio", notes: "Stripe subscription_cycle viejo", paidAt: new Date("2025-01-19T18:00:00Z"), createdAt: new Date("2025-01-19T18:00:00Z") },
    // Alta manual desde /admin con el número visible de la factura: es la misma.
    { ...filaLocal29, id: "si_por_numero", reference: "ANLFCA6H-0001", method: "stripe", notes: "Registrada a mano", createdAt: new Date("2026-09-19T19:00:00Z") },
  );
  const { body } = await historial();
  const ids = body.invoices.map((f) => f.id);
  assert.deepEqual(
    ids.filter((id) => id.startsWith("local:")).sort(),
    ["local:si_otra_ref", "local:si_spei"],
    "solo se quitan las que Stripe devolvió (por id o por número)",
  );
  assert.ok(ids.includes(`stripe:${IN_29}`));
});

test("A · pagada a mano y abierta en Stripe: un renglón, el PAGADO (sin botón «Pagar»)", async () => {
  // La tarjeta falló, la clínica pagó por SPEI y administración lo registró
  // con el número de la factura; en Stripe sigue abierta.
  const abierta = { ...facturaStripe29, status: "open", status_transitions: { paid_at: null }, amount_paid: 0 };
  stripe = stripeCon([abierta]);
  tablas.subscriptionInvoice = [
    { ...filaLocal29, id: "si_fallida", status: "failed", paidAt: null, notes: "Stripe subscription_create ANLFCA6H-0001 — cobro fallido (intento 1)" },
    { ...filaLocal29, id: "si_spei_manual", reference: "ANLFCA6H-0001", method: "transfer", status: "paid", notes: "Pagado por SPEI", createdAt: new Date("2026-09-20T15:00:00Z") },
  ];
  const { body } = await historial();
  assert.equal(body.invoices.length, 1, `salieron ${body.invoices.length} renglones`);
  assert.equal(body.invoices[0].id, "local:si_spei_manual");
  assert.equal(body.invoices[0].status, "paid");
  assert.equal(body.invoices[0].paymentUrl, null, "no se le ofrece pagar lo que ya pagó");
});

test("A · reembolsada por administración: sale la de Stripe, con la marca del reembolso", async () => {
  tablas.subscriptionInvoice = [{ ...filaLocal29, notes: "[REEMBOLSADO $29] cliente pidió baja" }];
  const { body } = await historial();
  assert.equal(body.invoices.length, 1);
  assert.equal(body.invoices[0].id, `stripe:${IN_29}`);
  assert.equal(body.invoices[0].description, "1 × DaleControl Profesional — Suscripción mensual [REEMBOLSADO $29]");
  assert.equal(body.invoices[0].downloadUrl, facturaStripe29.invoice_pdf);
});

// ═══════════════════════════════════════════════════════════════════════════
// B · Las recargas de saldo IA aparecen
// ═══════════════════════════════════════════════════════════════════════════

const recargaBevadent = {
  id: "tx_topup_200",
  clinicId: "c1",
  type: "TOPUP",
  amountCents: 20000,
  balanceAfterCents: 20000,
  source: "STRIPE",
  reference: PI_200,
  note: null,
  createdAt: new Date("2026-09-22T22:22:00Z"), // 16:22 CST
};

const abonoAMano = {
  id: "tx_ajuste_200",
  clinicId: "c1",
  type: "ADJUSTMENT",
  amountCents: 20000,
  balanceAfterCents: 20000,
  source: "ADMIN",
  reference: null,
  note: "Pago Stripe pi_3UIc4u… no acreditado por el webhook",
  createdAt: new Date("2026-09-22T23:40:00Z"),
};

test("B · una recarga pagada con tarjeta aparece: fecha, concepto, $200 y «Pagada», con su recibo", async () => {
  tablas.aiWalletTransaction.push(recargaBevadent);
  stripe = stripeCon([facturaStripe29], [
    { payment_intent: PI_200, receipt_url: "https://pay.stripe.com/receipts/payment/abc", status: "succeeded" },
    { payment_intent: "pi_de_otra_cosa", receipt_url: "https://pay.stripe.com/receipts/payment/zzz", status: "succeeded" },
  ]);
  const { body } = await historial();
  const recargas = body.invoices.filter((f) => f.kind === "aiTopup");
  assert.equal(recargas.length, 1);
  const [r] = recargas;
  assert.equal(r.amount, 200);
  assert.equal(r.currency, "MXN");
  assert.equal(r.status, "paid");
  assert.equal(r.description, "Recarga de saldo IA");
  assert.equal(r.date, "2026-09-22T22:22:00.000Z");
  assert.equal(r.topupVia, "card");
  assert.equal(r.receiptUrl, "https://pay.stripe.com/receipts/payment/abc", "el recibo es el de ESE pago");
  assert.equal(r.downloadUrl, null, "una recarga no tiene factura PDF");
  assert.equal(r.paymentUrl, null);
  // Los recibos se buscan en el customer de ESTA clínica.
  const cargos = llamadasStripe.find((l) => l.que === "charges");
  assert.equal(cargos?.params.customer, "cus_bevadent");
  // Y la suscripción sigue siendo un renglón aparte: ahora hay dos cosas distintas.
  assert.equal(body.invoices.length, 2);
  assert.equal(body.invoices[0].kind, "aiTopup", "orden por fecha: la recarga del 22 va antes que el cobro del 19");
});

test("B · el abono a mano de administración sale igual de pagado, pero sin comprobante inventado", async () => {
  tablas.aiWalletTransaction.push(abonoAMano);
  const { body } = await historial();
  const [r] = body.invoices.filter((f) => f.kind === "aiTopup");
  assert.equal(r.amount, 200);
  assert.equal(r.status, "paid");
  assert.equal(r.topupVia, "manual", "se distingue de una recarga por pasarela");
  assert.equal(r.receiptUrl, null, "sin botón de recibo: ese asiento no tiene comprobante propio");
  assert.equal(r.downloadUrl, null);
  // Sin recargas con tarjeta no se le pregunta nada a Stripe por cargos.
  assert.ok(!llamadasStripe.some((l) => l.que === "charges"));
});

test("B · consumo, cargos del admin y recargas de otra clínica NO salen", async () => {
  tablas.aiWalletTransaction.push(
    recargaBevadent,
    { ...recargaBevadent, id: "tx_consumo", type: "CHARGE", amountCents: -350, source: "USAGE", reference: "evt_1" },
    { ...abonoAMano, id: "tx_cargo_admin", amountCents: -5000 },
    { ...recargaBevadent, id: "tx_de_otra", clinicId: "c2", reference: "pi_otra" },
  );
  const { body } = await historial();
  assert.deepEqual(
    body.invoices.filter((f) => f.kind === "aiTopup").map((f) => f.id),
    ["wallet:tx_topup_200"],
  );
  for (const c of consultas) {
    const clinicId = c.modelo === "clinic" ? c.where.id : c.where.clinicId;
    assert.equal(clinicId, "c1", `${c.modelo} se consultó sin el tenant de la sesión`);
  }
});

test("B · las tres pasarelas y un SPEI con comprobante en revisión", async () => {
  tablas.aiWalletTransaction.push(
    { ...recargaBevadent, id: "tx_mp", source: "MERCADOPAGO", reference: "123456789", amountCents: 50000, createdAt: new Date("2026-09-01T12:00:00Z") },
    { ...recargaBevadent, id: "tx_spei", source: "SPEI", reference: "topup_spei_ok", amountCents: 100000, createdAt: new Date("2026-09-02T12:00:00Z") },
  );
  tablas.aiTopup.push(
    { id: "topup_revision", clinicId: "c1", amountCents: 150000, method: "SPEI", status: "PENDING", createdAt: new Date("2026-09-21T12:00:00Z") },
    // No son pagos: un checkout de MP abandonado y un comprobante rechazado.
    { id: "topup_mp_abandonado", clinicId: "c1", amountCents: 50000, method: "MERCADOPAGO", status: "PENDING", createdAt: new Date("2026-09-21T13:00:00Z") },
    { id: "topup_rechazado", clinicId: "c1", amountCents: 50000, method: "SPEI", status: "REJECTED", createdAt: new Date("2026-09-21T14:00:00Z") },
  );
  const { body } = await historial();
  const porId = Object.fromEntries(body.invoices.map((f) => [f.id, f]));
  assert.equal(porId["wallet:tx_mp"].topupVia, "mercadopago");
  assert.equal(porId["wallet:tx_spei"].topupVia, "spei");
  assert.equal(porId["wallet:tx_spei"].amount, 1000);
  assert.equal(porId["topup:topup_revision"].status, "pending");
  assert.equal(porId["topup:topup_revision"].amount, 1500);
  assert.ok(!porId["topup:topup_mp_abandonado"] && !porId["topup:topup_rechazado"]);
  // Un pago que no es de Stripe no lleva recibo.
  assert.equal(porId["wallet:tx_mp"].receiptUrl, null);
});

test("B · si Stripe no da los recibos, la recarga sale igual, solo que sin botón", async () => {
  tablas.aiWalletTransaction.push(recargaBevadent);
  stripe = stripeCon([facturaStripe29], [], { cargos: true });
  const { status, body } = await historial();
  assert.equal(status, 200);
  const [r] = body.invoices.filter((f) => f.kind === "aiTopup");
  assert.equal(r.amount, 200);
  assert.equal(r.receiptUrl, null);
  assert.equal(body.invoices.filter((f) => f.kind === "subscription").length, 1, "las facturas siguen saliendo");
});

test("sin clínica en la sesión no se consulta nada (clinicId: undefined no filtra)", async () => {
  sesion = { clinicId: undefined };
  const { status } = await historial();
  assert.equal(status, 401);
  assert.equal(consultas.length, 0);
});
