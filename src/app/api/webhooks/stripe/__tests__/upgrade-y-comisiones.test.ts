/**
 * VOUCHER DE UPGRADE PAGADO TARDE Y COMISIONES TRAS UN REEMBOLSO — el webhook de Stripe DE VERDAD
 * (ws1-t1, ola 2b, leads 6 y 10).
 *
 * Run: npm run test:upgrade-y-comisiones
 *
 * `POST` real de `webhooks/stripe/route.ts` (y el del payout masivo de afiliados), con dobles en memoria
 * de prisma, de Stripe, de la bitácora, del correo y de las sedes. ⛔ Ni una llamada a Stripe, a una base
 * ni a un correo.
 *
 *   · lead 6: el diferencial de un upgrade (OXXO/SPEI, o tarjeta en una sesión abierta) se cotiza sobre
 *     los días que le quedan al periodo pagado. Si llega pagado DESPUÉS de que la clínica compró el
 *     periodo siguiente al plan bajo, NO sube el plan durante el periodo nuevo; y al activar un periodo,
 *     las sesiones del diferencial todavía abiertas se expiran;
 *   · lead 10: una comisión de afiliado cuyo cobro se reembolsó o perdió un contracargo no se paga en el
 *     payout masivo; con el contracargo abierto queda retenida, y si se gana vuelve a pendiente.
 */
import Module from "node:module";
import path from "node:path";
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const HORA = 3_600_000;
const DIA = 24 * HORA;
const RAIZ = path.resolve(__dirname, "../../../../../..");
const CLINIC = "clinic_diff";
const CUS = "cus_diff";

let clinicas: Map<string, any>;
let comisiones: any[];
let bitacora: any[];
let sesionesAbiertas: any[];
let sesionesExpiradas: string[];
let cargos: any[];
let disputas: any[];
let idEvento = 0;
let avisosAdmin: Array<{ clave: string; clinicId: string; aviso: any }>;
let antesDeEscribirElPlan: null | (() => void);
let registrosCorreo: Map<string, any>;

function coincide(fila: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    const valor = fila[k];
    if (v instanceof Date) return valor instanceof Date && valor.getTime() === v.getTime();
    if (v && typeof v === "object") {
      if ("in" in v) return v.in.includes(valor);
      if ("not" in v) return v.not === null ? valor != null : valor !== v.not;
      throw new Error(`operador no soportado en el doble: ${JSON.stringify(v)}`);
    }
    return valor === v;
  });
}

const prismaBase: any = {
  clinic: {
    findUnique: async ({ where, select }: any) => {
      const c = clinicas.get(where.id);
      if (!c) return null;
      return select ? Object.fromEntries(Object.keys(select).map((k) => [k, c[k]])) : { ...c };
    },
    findFirst: async ({ where }: any) => [...clinicas.values()].find((c) => c.stripeCustomerId === where.stripeCustomerId) ?? null,
    update: async ({ where, data }: any) => {
      const c = clinicas.get(where.id);
      if (!c) throw new Error("clínica inexistente");
      Object.entries(data).forEach(([k, v]) => {
        if (v !== undefined) c[k] = v;
      });
      return c;
    },
    // Evalúa el `where` REAL (igualdad, fechas por valor): una escritura condicionada al estado leído se prueba de verdad.
    updateMany: async ({ where, data }: any) => {
      const filas = [...clinicas.values()].filter((c) => coincide(c, where));
      filas.forEach((c) =>
        Object.entries(data).forEach(([k, v]) => {
          if (v !== undefined) c[k] = v;
        }),
      );
      return { count: filas.length };
    },
  },
  // billing_email_logs: `invoiceId` es ÚNICO (el candado de avisos y de la marca «diferencial aplicado»).
  billingEmailLog: {
    create: async ({ data }: any) => {
      if (registrosCorreo.has(data.invoiceId)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      registrosCorreo.set(data.invoiceId, { ...data });
      return data;
    },
    findUnique: async ({ where }: any) => registrosCorreo.get(where.invoiceId) ?? null,
  },
  affiliateCommission: {
    findMany: async ({ where }: any) => comisiones.filter((c) => coincide(c, where)).map((c) => ({ ...c })),
    updateMany: async ({ where, data }: any) => {
      const filas = comisiones.filter((c) => coincide(c, where));
      filas.forEach((f) => Object.assign(f, data));
      return { count: filas.length };
    },
    aggregate: async ({ where }: any) => {
      const filas = comisiones.filter((c) => coincide(c, where));
      return {
        _sum: { commissionMxn: filas.length ? filas.reduce((s, f) => s + f.commissionMxn, 0) : null },
        _count: { _all: filas.length },
      };
    },
  },
};
// Lo que no esté arriba revienta (sobre todo `delete*` y SQL crudo): el webhook no borra nada.
const prismaDoble: any = new Proxy(prismaBase, {
  get(objetivo, prop: string) {
    if (prop in objetivo) return objetivo[prop];
    if (prop === "then") return undefined;
    throw new Error(`prisma.${prop} no está en el doble`);
  },
});

const stripeDoble: any = {
  webhooks: { constructEvent: (raw: string) => JSON.parse(raw) },
  checkout: {
    sessions: {
      list: async ({ customer, status }: any) => ({
        data: sesionesAbiertas.filter((s) => s.customer === customer && (status === undefined || s.status === status)),
        has_more: false,
      }),
      expire: async (id: string) => {
        sesionesExpiradas.push(id);
        const s = sesionesAbiertas.find((x) => x.id === id);
        if (s) s.status = "expired";
        return s;
      },
    },
  },
  charges: {
    list: async ({ payment_intent }: any) => ({ data: cargos.filter((c) => c.payment_intent === payment_intent) }),
  },
  disputes: {
    list: async ({ payment_intent }: any) => ({ data: disputas.filter((d) => d.payment_intent === payment_intent) }),
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
let POSTPayout: (req: any, ctx: any) => Promise<Response>;
let NextRequestCtor: any;

before(async () => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_prueba";
  dobles.set(path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prismaDoble });
  dobles.set(path.join(RAIZ, "src/lib/stripe.ts"), {
    getStripeSafe: () => stripeDoble,
    stripeUnavailableResponse: () => ({ error: "sin stripe" }),
    default: () => stripeDoble,
  });
  dobles.set(path.join(RAIZ, "src/lib/audit.ts"), {
    logAudit: async (a: any) => {
      bitacora.push(a);
    },
    extractAuditMeta: () => ({}),
  });
  dobles.set(path.join(RAIZ, "src/lib/email.ts"), {
    sendEmail: async () => ({ delivered: true }),
    sendPlanActivatedEmail: async () => {},
    sendPlanRenewedEmail: async () => {},
    sendPlanSuspendedEmail: async () => {},
    sendPaymentFailedEmail: async () => {},
  });
  dobles.set(path.join(RAIZ, "src/lib/billing/sedes-incluidas.ts"), {
    sincronizarSedesIncluidas: async () => 0,
    bloqueoDeSedesParaPlan: async () => null,
    leerGrupoDePago: async (id: string) => ({ pagadoraId: id, miembros: [id], esSedeIncluida: false, pagadoraNombre: null }),
  });
  dobles.set(path.join(RAIZ, "src/lib/billing/record-stripe-invoice.ts"), { recordStripeInvoice: async () => {} });
  dobles.set(path.join(RAIZ, "src/lib/billing/factura-fuera-de-stripe.server.ts"), {
    marcarFacturasDeLaClinica: async () => ({ tipo: "sin_tarjeta" }),
  });
  dobles.set(path.join(RAIZ, "src/lib/plans.ts"), {
    getPlanLimits: async (plan: string) => {
      // Entre la lectura de la clínica y la escritura del plan (m2): aquí se cuela, si la prueba lo pide, otra escritura.
      const antes = antesDeEscribirElPlan;
      antesDeEscribirElPlan = null;
      antes?.();
      return { aiTokensDefault: plan === "CLINIC" ? 90000 : 5000, maxClinics: null };
    },
    getResolvedPlan: async (id: string) => ({ id, name: id, priceMxn: 419, priceMxnAnnual: 3264, aiTokensDefault: 5000 }),
    getResolvedPlans: async () => [],
  });
  // La recarga del monedero de IA no es de esta prueba: ningún PaymentIntent de aquí es una recarga.
  dobles.set(path.join(RAIZ, "src/lib/ai-billing/reversion.ts"), {
    revertirRecargaStripe: async () => ({ aplicado: false }),
    paymentIntentDeEvento: (obj: any) => (typeof obj?.payment_intent === "string" ? obj.payment_intent : obj?.payment_intent?.id ?? null),
  });
  dobles.set(path.join(RAIZ, "src/lib/admin-auth.ts"), {
    getAdminSession: async () => ({ user: { id: "adm1", email: "admin@dalecontrol.test" } }),
    isAdminAuthed: async () => true,
  });
  dobles.set(path.join(RAIZ, "src/lib/affiliate-emails.ts"), {
    sendAffiliatePayoutPaidEmail: async () => {},
    sendAffiliateConversionEmail: async () => {},
  });
  dobles.set(path.join(RAIZ, "src/lib/billing/aviso-admin-envio.server.ts"), {
    avisarAdminUnaVez: async (clave: string, clinicId: string, aviso: any) => {
      if (avisosAdmin.some((a) => a.clave === clave)) return false; // el candado real es la fila única de billing_email_logs
      avisosAdmin.push({ clave, clinicId, aviso });
      return true;
    },
    enviarAvisoAlAdmin: async () => true,
  });
  dobles.set(path.join(RAIZ, "src/lib/admin-audit.ts"), { logAdminGlobalEvent: () => {}, logAdminClinicMutation: async () => {} });
  dobles.set(path.join(RAIZ, "src/lib/analytics/meta-capi.server.ts"), { enviarCompraMetaDeSesion: async () => {} });
  dobles.set(path.join(RAIZ, "src/lib/analytics/tiktok-capi.server.ts"), { enviarCompraTiktokDeSesion: async () => {} });
  ({ NextRequest: NextRequestCtor } = await import("next/server"));
  ({ POST } = await import("../route"));
  ({ POST: POSTPayout } = await import("../../../admin/affiliates/[id]/payouts/route"));
});

const ahora = Date.now();
const MANANA = new Date(ahora + DIA);

beforeEach(() => {
  // Clínica que paga SPEI/OXXO (sin suscripción de tarjeta) en BASIC con 1 día de periodo pagado.
  clinicas = new Map([
    [
      CLINIC,
      {
        id: CLINIC,
        name: "Clínica Diff",
        plan: "BASIC",
        aiTokensLimit: 5000,
        subscriptionStatus: "active",
        stripeSubscriptionId: null,
        stripeCustomerId: CUS,
        trialEndsAt: MANANA,
        nextBillingDate: MANANA,
      },
    ],
  ]);
  comisiones = [];
  bitacora = [];
  sesionesAbiertas = [];
  sesionesExpiradas = [];
  cargos = [];
  disputas = [];
  idEvento = 0;
  avisosAdmin = [];
  antesDeEscribirElPlan = null;
  registrosCorreo = new Map();
});

const clinica = () => clinicas.get(CLINIC);
const seg = (ms: number) => Math.floor(ms / 1000);

async function entregar(type: string, object: unknown): Promise<number> {
  const ev = { id: `evt_${++idEvento}`, type, created: seg(Date.now()), data: { object } };
  const req = new NextRequestCtor("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "firma" },
    body: JSON.stringify(ev),
  });
  return (await POST(req)).status;
}

/** Sesión del diferencial tal como la arma change-plan (BASIC → CLINIC), cotizada hace un minuto. */
function sesionDiff(extra: Record<string, unknown> = {}, meta: Record<string, string> = {}) {
  const cotizada = ahora - 60_000;
  // Igual que daysRemainingUntil: redondeo hacia arriba (1 día y 1 minuto → 2).
  const daysRemaining = String(Math.ceil((MANANA.getTime() - cotizada) / DIA));
  return {
    id: "cs_diff",
    object: "checkout.session",
    mode: "payment",
    customer: CUS,
    created: seg(cotizada),
    payment_status: "paid",
    status: "complete",
    metadata: { kind: "plan-upgrade-diff", clinicId: CLINIC, plan: "CLINIC", fromPlan: "BASIC", daysRemaining, interval: "month", ...meta },
    ...extra,
  };
}

function renovacionAnual() {
  return {
    id: "cs_renov",
    object: "checkout.session",
    mode: "payment",
    customer: CUS,
    created: seg(Date.now()),
    payment_status: "paid",
    status: "complete",
    metadata: { kind: "platform-subscription", clinicId: CLINIC, plan: "BASIC", billing: "annual" },
  };
}

// ── lead 6 ────────────────────────────────────────────────────────────────

test("lead 6: el voucher del diferencial pagado DESPUÉS de comprar el año siguiente en BASIC no sube a CLINIC (sesión de antes, sin fecha cotizada)", async () => {
  assert.equal(await entregar("checkout.session.async_payment_succeeded", renovacionAnual()), 200);
  const finAnual = clinica().trialEndsAt.getTime();
  assert.ok(finAnual > ahora + 300 * DIA, "la renovación anual extendió el periodo");
  assert.equal(await entregar("checkout.session.async_payment_succeeded", sesionDiff()), 200);
  assert.equal(clinica().plan, "BASIC", "el diferencial de 1 día no compra un año de CLINIC");
  assert.equal(clinica().aiTokensLimit, 5000);
  assert.equal(clinica().trialEndsAt.getTime(), finAnual);
  const descarte = bitacora.find((b) => b.changes?._source?.after?.result === "not_applied");
  assert.ok(descarte, "el pago acreditado que no se aplica deja rastro para devolverlo");
  assert.equal(descarte.changes._source.after.reason, "period-changed");
});

test("lead 6: igual con la fecha cotizada en la metadata (sesiones nuevas)", async () => {
  await entregar("checkout.session.async_payment_succeeded", renovacionAnual());
  await entregar("checkout.session.async_payment_succeeded", sesionDiff({}, { paidUntil: MANANA.toISOString() }));
  assert.equal(clinica().plan, "BASIC");
});

test("lead 6: con TARJETA, una sesión abierta del diferencial pagada tras la renovación tampoco sube el plan", async () => {
  await entregar("checkout.session.async_payment_succeeded", renovacionAnual());
  await entregar("checkout.session.completed", sesionDiff({}, { paidUntil: MANANA.toISOString() }));
  assert.equal(clinica().plan, "BASIC");
});

test("lead 6: si la clínica ya no está en el plan desde el que se cotizó (bajó de PRO a BASIC), no se aplica", async () => {
  clinica().plan = "BASIC";
  await entregar("checkout.session.async_payment_succeeded", sesionDiff({}, { fromPlan: "PRO", paidUntil: MANANA.toISOString() }));
  assert.equal(clinica().plan, "BASIC");
  assert.equal(bitacora.at(-1).changes._source.after.reason, "from-plan-changed");
});

test("lead 6: el voucher pagado cuando el periodo cotizado YA VENCIÓ (sin renovar) no sube el plan", async () => {
  const ayer = new Date(ahora - DIA);
  clinica().trialEndsAt = ayer;
  clinica().nextBillingDate = ayer;
  const sesion = sesionDiff({ created: seg(ahora - 3 * DIA) }, { daysRemaining: "2", paidUntil: ayer.toISOString() });
  await entregar("checkout.session.async_payment_succeeded", sesion);
  assert.equal(clinica().plan, "BASIC");
  assert.equal(bitacora.at(-1).changes._source.after.reason, "period-expired");
});

// ── v2 (revisión t8) ──────────────────────────────────────────────────────

test("m1: un diferencial PAGADO y descartado avisa una vez al admin de la plataforma (para devolverlo)", async () => {
  await entregar("checkout.session.async_payment_succeeded", renovacionAnual());
  await entregar("checkout.session.async_payment_succeeded", sesionDiff({}, { paidUntil: MANANA.toISOString() }));
  // Stripe reenvía el mismo evento: no sale un segundo correo.
  await entregar("checkout.session.async_payment_succeeded", sesionDiff({}, { paidUntil: MANANA.toISOString() }));
  assert.equal(avisosAdmin.length, 1);
  assert.equal(avisosAdmin[0].clave, "cs_diff:diferencial_descartado");
  assert.equal(avisosAdmin[0].clinicId, CLINIC);
  const texto = [avisosAdmin[0].aviso.asunto, ...avisosAdmin[0].aviso.lineas].join("\n");
  assert.match(texto, /cs_diff/);
  assert.match(texto, /period-changed/);
});

test("m1: un diferencial aplicado NO avisa a nadie", async () => {
  await entregar("checkout.session.async_payment_succeeded", sesionDiff({}, { paidUntil: MANANA.toISOString() }));
  assert.equal(clinica().plan, "CLINIC");
  assert.equal(avisosAdmin.length, 0);
});

test("m1: Stripe reenvía un diferencial YA aplicado: no hay aviso falso de «pagado y no aplicado»", async () => {
  await entregar("checkout.session.async_payment_succeeded", sesionDiff({}, { paidUntil: MANANA.toISOString() }));
  await entregar("checkout.session.async_payment_succeeded", sesionDiff({}, { paidUntil: MANANA.toISOString() }));
  assert.equal(clinica().plan, "CLINIC");
  assert.equal(avisosAdmin.length, 0);
});

// ── v3 (delta t8, m3) ─────────────────────────────────────────────────────

test("m3: un SEGUNDO voucher pagado del mismo upgrade (otra sesión) avisa: es dinero cobrado dos veces", async () => {
  await entregar("checkout.session.async_payment_succeeded", sesionDiff({}, { paidUntil: MANANA.toISOString() }));
  assert.equal(clinica().plan, "CLINIC");
  await entregar("checkout.session.async_payment_succeeded", sesionDiff({ id: "cs_diff_2" }, { paidUntil: MANANA.toISOString() }));
  assert.equal(avisosAdmin.length, 1);
  assert.equal(avisosAdmin[0].clave, "cs_diff_2:diferencial_descartado");
});

test("m3: al aplicar queda la marca «<sesión>:diferencial_aplicado» en billing_email_logs", async () => {
  await entregar("checkout.session.async_payment_succeeded", sesionDiff({}, { paidUntil: MANANA.toISOString() }));
  assert.ok(registrosCorreo.has("cs_diff:diferencial_aplicado"));
  assert.equal(registrosCorreo.get("cs_diff:diferencial_aplicado").clinicId, CLINIC);
});

test("m3: dos entregas SIMULTÁNEAS de la misma sesión: la que pierde la escritura no manda un «pagado y no aplicado» falso", async () => {
  // Mientras esta entrega va entre su lectura y su escritura, la otra entrega del MISMO evento aplica el plan.
  antesDeEscribirElPlan = () => {
    clinica().plan = "CLINIC";
    clinica().aiTokensLimit = 90000;
    registrosCorreo.set("cs_diff:diferencial_aplicado", { invoiceId: "cs_diff:diferencial_aplicado", clinicId: CLINIC });
  };
  assert.equal(await entregar("checkout.session.async_payment_succeeded", sesionDiff({}, { paidUntil: MANANA.toISOString() })), 200);
  assert.equal(clinica().plan, "CLINIC");
  assert.equal(avisosAdmin.length, 0);
  assert.equal(bitacora.filter((b) => b.changes?._source?.after?.result === "not_applied").length, 0);
});

test("m2: si la renovación se escribe ENTRE la lectura y la escritura del diferencial, el plan alto no cae sobre el periodo nuevo", async () => {
  antesDeEscribirElPlan = () => {
    const unAnio = new Date(MANANA.getTime() + 365 * DIA);
    Object.assign(clinica(), { trialEndsAt: unAnio, nextBillingDate: unAnio, plan: "BASIC" });
  };
  assert.equal(await entregar("checkout.session.async_payment_succeeded", sesionDiff({}, { paidUntil: MANANA.toISOString() })), 200);
  assert.equal(clinica().plan, "BASIC");
  assert.equal(clinica().aiTokensLimit, 5000);
  assert.equal(bitacora.at(-1).changes._source.after.reason, "period-changed");
  assert.equal(avisosAdmin.length, 1);
});

test("lead 6 (legítimo): el voucher pagado dentro del MISMO periodo sube el plan y no mueve el periodo", async () => {
  await entregar("checkout.session.async_payment_succeeded", sesionDiff({}, { paidUntil: MANANA.toISOString() }));
  assert.equal(clinica().plan, "CLINIC");
  assert.equal(clinica().aiTokensLimit, 90000);
  assert.equal(clinica().trialEndsAt.getTime(), MANANA.getTime());
  // Y una sesión de antes del cambio (sin la fecha cotizada) también.
  clinica().plan = "BASIC";
  await entregar("checkout.session.async_payment_succeeded", sesionDiff());
  assert.equal(clinica().plan, "CLINIC");
});

test("lead 6 (legítimo): quien pagó de MÁS (cotizó desde BASIC y ya está en PRO) recibe el plan", async () => {
  clinica().plan = "PRO";
  await entregar("checkout.session.async_payment_succeeded", sesionDiff({}, { paidUntil: MANANA.toISOString() }));
  assert.equal(clinica().plan, "CLINIC");
});

test("lead 6: al activar un periodo nuevo se expiran las sesiones ABIERTAS del diferencial de ESA clínica (y nada más)", async () => {
  sesionesAbiertas = [
    { id: "cs_diff_abierta", customer: CUS, status: "open", metadata: { kind: "plan-upgrade-diff", clinicId: CLINIC } },
    { id: "cs_plan_abierta", customer: CUS, status: "open", metadata: { kind: "platform-subscription", clinicId: CLINIC } },
    { id: "cs_diff_otra", customer: CUS, status: "open", metadata: { kind: "plan-upgrade-diff", clinicId: "otra" } },
    { id: "cs_diff_ajena", customer: "cus_otro", status: "open", metadata: { kind: "plan-upgrade-diff", clinicId: CLINIC } },
  ];
  assert.equal(await entregar("checkout.session.async_payment_succeeded", renovacionAnual()), 200);
  assert.deepEqual(sesionesExpiradas, ["cs_diff_abierta"]);
});

test("lead 6: si Stripe no deja expirar, la activación igual se completa (200)", async () => {
  sesionesAbiertas = [{ id: "cs_diff_abierta", customer: CUS, status: "open", metadata: { kind: "plan-upgrade-diff", clinicId: CLINIC } }];
  const original = stripeDoble.checkout.sessions.expire;
  stripeDoble.checkout.sessions.expire = async () => {
    throw new Error("Stripe no contesta");
  };
  try {
    assert.equal(await entregar("checkout.session.async_payment_succeeded", renovacionAnual()), 200);
    assert.ok(clinica().trialEndsAt.getTime() > ahora + 300 * DIA);
  } finally {
    stripeDoble.checkout.sessions.expire = original;
  }
});

// ── lead 10 ───────────────────────────────────────────────────────────────

const AFILIADO = "aff_1";

function comision(extra: Record<string, unknown> = {}) {
  // La fila que deja invoice.paid de una clínica referida (route.ts, rama de afiliados).
  return { id: `com_${comisiones.length + 1}`, affiliateId: AFILIADO, clinicId: CLINIC, stripeInvoiceId: "in_1", amountMxn: 689, commissionMxn: 300, kind: "recurring", status: "pending", ...extra };
}

function cargo(extra: Record<string, unknown> = {}) {
  return { id: "ch_1", object: "charge", payment_intent: "pi_1", invoice: "in_1", status: "succeeded", amount: 68900, amount_captured: 68900, amount_refunded: 0, refunded: false, ...extra };
}

async function payout() {
  const res = await POSTPayout(new NextRequestCtor("http://localhost/api/admin/affiliates/x/payouts", { method: "POST" }), {
    params: Promise.resolve({ id: AFILIADO }),
  });
  return (await res.json()) as { paid: number; totalMxn: number };
}

test("lead 10: un cobro REEMBOLSADO anula la comisión y el payout masivo no la paga", async () => {
  comisiones = [comision(), comision({ stripeInvoiceId: "in_2" })];
  cargos = [cargo({ amount_refunded: 68900, refunded: true })];
  assert.equal(await entregar("charge.refunded", cargos[0]), 200);
  assert.equal(comisiones[0].status, "reversed");
  assert.equal(comisiones[1].status, "pending", "las demás comisiones no se tocan");
  const r = await payout();
  assert.deepEqual(r, { paid: 1, totalMxn: 300 });
  assert.equal(comisiones[0].status, "reversed");
});

test("lead 10: un contracargo abierto RETIENE la comisión (fuera del payout); ganado, vuelve a pendiente", async () => {
  comisiones = [comision()];
  cargos = [cargo()];
  disputas = [{ id: "dp_1", object: "dispute", charge: "ch_1", payment_intent: "pi_1", status: "needs_response", amount: 68900 }];
  await entregar("charge.dispute.created", disputas[0]);
  assert.equal(comisiones[0].status, "disputed");
  assert.deepEqual(await payout(), { paid: 0, totalMxn: 0 });
  disputas[0].status = "won";
  await entregar("charge.dispute.closed", disputas[0]);
  assert.equal(comisiones[0].status, "pending");
});

test("lead 10: un contracargo PERDIDO anula la comisión", async () => {
  comisiones = [comision()];
  cargos = [cargo()];
  disputas = [{ id: "dp_1", object: "dispute", charge: "ch_1", payment_intent: "pi_1", status: "lost", amount: 68900 }];
  await entregar("charge.dispute.closed", disputas[0]);
  assert.equal(comisiones[0].status, "reversed");
});

test("lead 10: el orden de los eventos no importa (Stripe manda el estado de HOY, no el del evento)", async () => {
  comisiones = [comision()];
  cargos = [cargo()];
  disputas = [{ id: "dp_1", object: "dispute", charge: "ch_1", payment_intent: "pi_1", status: "lost", amount: 68900 }];
  // Llega tarde el «created» de un contracargo que ya se perdió: sigue anulada, no vuelve a «retenida».
  await entregar("charge.dispute.closed", disputas[0]);
  await entregar("charge.dispute.created", { ...disputas[0], status: "needs_response" });
  assert.equal(comisiones[0].status, "reversed");
});

test("lead 10: un reembolso PARCIAL no anula la comisión (decisión pendiente de Rafael)", async () => {
  comisiones = [comision()];
  cargos = [cargo({ amount_refunded: 20000 })];
  await entregar("charge.refunded", cargos[0]);
  assert.equal(comisiones[0].status, "pending");
});

test("lead 10: una comisión YA PAGADA no se reescribe (el dinero ya salió; queda el aviso para recuperarlo a mano)", async () => {
  comisiones = [comision({ status: "paid", paidAt: new Date() })];
  cargos = [cargo({ amount_refunded: 68900, refunded: true })];
  assert.equal(await entregar("charge.refunded", cargos[0]), 200);
  assert.equal(comisiones[0].status, "paid");
});

test("lead 10: un reembolso de algo que no es una factura (teleconsulta, portal) no toca comisiones", async () => {
  comisiones = [comision()];
  cargos = [cargo({ invoice: null, amount_refunded: 68900, refunded: true })];
  assert.equal(await entregar("charge.refunded", cargos[0]), 200);
  assert.equal(comisiones[0].status, "pending");
});

test("lead 10: si Stripe no contesta al leer los cargos, el webhook responde 500 para que Stripe reintente", async () => {
  comisiones = [comision()];
  const original = stripeDoble.charges.list;
  stripeDoble.charges.list = async () => {
    throw new Error("Stripe no contesta");
  };
  try {
    assert.equal(await entregar("charge.refunded", cargo({ amount_refunded: 68900, refunded: true })), 500);
    assert.equal(comisiones[0].status, "pending");
  } finally {
    stripeDoble.charges.list = original;
  }
});
