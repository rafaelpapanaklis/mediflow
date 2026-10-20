/**
 * COBRO RECHAZADO DEL PLAN — el webhook de Stripe DE VERDAD (ws1-t1, 19-oct-2026).
 *
 * Run: npm run test:cobro-rechazado
 *
 * `POST` real de `webhooks/stripe/route.ts`, con dobles en memoria de prisma, de Stripe (firma, suscripción
 * viva y factura viva), de la bitácora, del correo y de la sincronización de sedes. ⛔ No sale ni un correo
 * y no se toca ninguna base ni ninguna cuenta de Stripe.
 *
 * El doble de prisma NO tiene `delete`, `deleteMany`, `$executeRaw`… : si algún evento intentara borrar algo
 * de una clínica, la llamada reventaría y el webhook respondería 500 (punto 7: NUNCA BORRAR).
 *
 * Lo que se vigila (BEVADENT, 19-oct-2026: el banco rechazó $689 y el panel le dejaba 30 días):
 *   · primer rechazo → past_due y acceso hasta (rechazo + 24 h), un solo correo;
 *   · reintento fallido → no alarga ni reinicia; el mismo evento dos veces → no cambia nada;
 *   · orden cambiado de eventos (el `updated` «active» llega antes o después del `payment_failed`);
 *   · aviso retrasado de una factura ya pagada → no suspende;
 *   · pagar (con la suscripción viva, o meses después con checkout) → active y entra con todo.
 */
import Module from "node:module";
import path from "node:path";
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { isPlanExpired } from "@/lib/plan-status";
import { esActivacionManual, rotuloDeFilaSinCobro } from "@/lib/billing/pagos-reales";
import { INICIO_MARCADO_FUERA_DE_STRIPE, fijarInicioDelMarcadoParaPruebas, inicioDelMarcadoFueraDeStripe } from "@/lib/billing/cobro-rechazado";

const HORA = 3_600_000;
const DIA = 24 * HORA;

/* ── Estado del doble ──────────────────────────────────────────────────── */
let clinicas: Map<string, any>;
let logsCorreo: any[];
let correos: any[];
let bitacora: any[];
let sedesSincronizadas: string[];
let facturasRegistradas: any[];
let escrituras: Array<{ id: string; data: any }>;
let suscripcionesVivas: Map<string, any>;
let facturasVivas: Map<string, any>;
let stripeRespondeSuscripciones = true;
let correoFalla = false;
let stripeListaFalla = false;
let stripePagoFalla = false;
let facturasDeLista: any[];
let llamadasCiclo: Array<{ id: string; params: any; opciones: any }>;
let llamadasAnular: Array<{ id: string; opciones: any }>;
let ordenDeLlamadas: string[];
let resetCobraLaTarjeta = false;
let ultimaFacturaDelCambio: any = null;
let cicloLanzaDespuesDeAplicar = false;
let stripeCicloFalla = false;
let stripeAnularFalla = false;
let itemsPendientes: any[] = [];
let anularFallaPara = new Set<string>();
let aparteFalla = false;
let facturasAparte: Array<{ params: any; opciones: any }> = [];
let llamadasPay: Array<{ id: string; params: any; opciones: any }>;
let filasAnuladas: any[];
let bitacoraAdmin: any[];
let correosRenovacion: any[];
let correosSuspendida: any[];
let pagosDeSubscripcion: any[];

function coincideWhere(fila: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (k === "OR") return (v as any[]).some((w) => coincideWhere(fila, w));
    if (k === "AND") return (v as any[]).every((w) => coincideWhere(fila, w));
    const valor = fila[k];
    if (v === null) return valor == null;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("gt" in v) return valor != null && valor > v.gt;
      if ("gte" in v) return valor != null && valor >= v.gte;
      if ("in" in v) return v.in.includes(valor);
      if ("not" in v) return valor != null && valor !== v.not;
      throw new Error(`operador de where no soportado en el doble: ${JSON.stringify(v)}`);
    }
    return valor === v;
  });
}

const prismaBase: any = {
  clinic: {
    findFirst: async ({ where }: any) => [...clinicas.values()].find((c) => c.stripeCustomerId === where.stripeCustomerId) ?? null,
    // El cron de vencimiento (manualLapseWhere) no trae `id.in`: nadie vence. El de facturas de tarjeta sí.
    findMany: async ({ where }: any) =>
      where?.id?.in ? [...clinicas.values()].filter((c) => where.id.in.includes(c.id) && c.stripeSubscriptionId != null) : [],
    findUnique: async ({ where }: any) => clinicas.get(where.id) ?? null,
    update: async ({ where, data }: any) => {
      const c = clinicas.get(where.id);
      if (!c) throw new Error("clínica inexistente");
      escrituras.push({ id: where.id, data });
      Object.entries(data).forEach(([k, v]) => {
        if (v !== undefined) c[k] = v;
      });
      return c;
    },
    updateMany: async () => ({ count: 0 }),
  },
  clinicModule: { findUnique: async () => null },
  subscriptionInvoice: {
    // Evalúa el `where` REAL que manda el código (igualdad, gt, in, not y OR): si alguien rompe la consulta, el test lo ve.
    findFirst: async ({ where, orderBy }: any) => {
      const filas = pagosDeSubscripcion.filter((p) => coincideWhere(p, where));
      if (orderBy?.paidAt === "desc") filas.sort((a, b) => (b.paidAt?.getTime?.() ?? 0) - (a.paidAt?.getTime?.() ?? 0));
      return filas[0] ?? null;
    },
    findMany: async ({ where, orderBy }: any) => {
      const filas = pagosDeSubscripcion.filter((p) => coincideWhere(p, where));
      if (orderBy?.paidAt === "desc") filas.sort((a, b) => (b.paidAt?.getTime?.() ?? 0) - (a.paidAt?.getTime?.() ?? 0));
      return filas;
    },
    findUnique: async ({ where }: any) => {
      const f = pagosDeSubscripcion.find((p) => p.id === where.id);
      return f ? { ...f, clinic: { id: f.clinicId, name: "BEVADENT", plan: "PRO" } } : null;
    },
    update: async ({ where, data }: any) => {
      const f = pagosDeSubscripcion.find((p) => p.id === where.id);
      if (f) Object.assign(f, data);
      return f;
    },
    updateMany: async ({ where, data }: any) => {
      filasAnuladas.push({ where, data });
      const filas = pagosDeSubscripcion.filter((p) => coincideWhere(p, where));
      filas.forEach((f) => Object.assign(f, data));
      return { count: filas.length };
    },
    create: async ({ data }: any) => {
      const fila = { id: `inv${pagosDeSubscripcion.length + 1}`, createdAt: new Date(), ...data };
      pagosDeSubscripcion.push(fila);
      return fila;
    },
  },
  $transaction: async (ops: any[]) => Promise.all(ops),
  billingEmailLog: {
    create: async ({ data }: any) => {
      if (logsCorreo.some((l) => l.invoiceId === data.invoiceId)) throw Object.assign(new Error("dup"), { code: "P2002" });
      logsCorreo.push({ createdAt: new Date(), ...data });
      return data;
    },
    findMany: async ({ where }: any) =>
      logsCorreo.filter((l) => (!where?.kind?.in || where.kind.in.includes(l.kind)) && (!where?.clinicId || l.clinicId === where.clinicId) && (!where?.createdAt?.gte || l.createdAt >= where.createdAt.gte)),
  },
};
// Cualquier método que no esté arriba (sobre todo `delete*` y SQL crudo) revienta: el webhook no borra nada.
const prismaDoble: any = new Proxy(prismaBase, {
  get(objetivo, prop: string) {
    if (prop in objetivo) return objetivo[prop];
    if (prop === "then") return undefined;
    throw new Error(`prisma.${prop} no está en el doble: el webhook intentó algo que este test no permite`);
  },
});

const stripeDoble: any = {
  webhooks: { constructEvent: (raw: string) => JSON.parse(raw) },
  subscriptions: {
    retrieve: async (id: string) => {
      if (!stripeRespondeSuscripciones) throw new Error("Stripe no responde");
      const s = suscripcionesVivas.get(id);
      if (!s) throw Object.assign(new Error("No such subscription"), { code: "resource_missing" });
      return s;
    },
    update: async (id: string, params: any, opciones: any) => {
      if (stripeCicloFalla) throw new Error("Stripe no contesta");
      llamadasCiclo.push({ id, params, opciones });
      ordenDeLlamadas.push("ciclo");
      const s = suscripcionesVivas.get(id);
      // Periodo pagado a mano: `trial_end` mueve el ancla sin cobrar (Stripe lo reporta `trialing`; la marca va en la metadata).
      if (s && params.trial_end) {
        s.status = "trialing";
        s.trial_end = params.trial_end;
        s.metadata = { ...(s.metadata ?? {}), ...(params.metadata ?? {}) };
        s.items.data[0].current_period_end = params.trial_end;
      }
      if (cicloLanzaDespuesDeAplicar) throw Object.assign(new Error("Keys for idempotent requests can only be used for the same endpoint they were first used for"), { type: "StripeIdempotencyError" });
      const ultima = ultimaFacturaDelCambio ?? (resetCobraLaTarjeta ? { id: "in_trial", status: "paid", amount_paid: 68900, amount_due: 68900, created: Math.floor(Date.now() / 1000) } : { id: "in_trial0", status: "paid", amount_paid: 0, amount_due: 0 });
      return params.expand?.includes("latest_invoice") ? { ...s, latest_invoice: ultima } : s;
    },
  },
  invoiceItems: { list: async () => ({ data: itemsPendientes }) },
  invoices: {
    create: async (params: any, opciones: any) => {
      if (aparteFalla) throw new Error("Stripe no contesta");
      ordenDeLlamadas.push("aparte");
      facturasAparte.push({ params, opciones });
      itemsPendientes = []; // los items pendientes pasan a la factura nueva
      return { id: "in_aparte" };
    },
    retrieve: async (id: string) => {
      const f = facturasVivas.get(id);
      if (!f) throw new Error("No such invoice");
      return f;
    },
    // Las facturas de la suscripción que ve el admin al confirmar un pago manual (abiertas / incobrables).
    list: async ({ subscription, status }: any) => {
      if (stripeListaFalla) throw new Error("Stripe no contesta");
      return { data: facturasDeLista.filter((f) => f.subscription === subscription && (status === undefined || f.status === status)) };
    },
    finalizeInvoice: async (id: string) => {
      ordenDeLlamadas.push(`finalizar:${id}`);
      const f = facturasDeLista.find((x) => x.id === id);
      if (f) f.status = "open";
      return f ?? { id, status: "open" };
    },
    voidInvoice: async (id: string, _params: any, opciones: any) => {
      if (stripeAnularFalla || anularFallaPara.has(id)) throw new Error("Stripe no contesta");
      ordenDeLlamadas.push(`anular:${id}`);
      llamadasAnular.push({ id, opciones });
      const f = facturasDeLista.find((x) => x.id === id);
      if (f) f.status = "void";
      return f ?? { id, status: "void" };
    },
    pay: async (id: string, params: any, opciones: any) => {
      if (stripePagoFalla) throw new Error("Stripe no contesta");
      llamadasPay.push({ id, params, opciones });
      const f = facturasDeLista.find((x) => x.id === id);
      if (f) f.status = "paid"; // una segunda pasada ya no la ve abierta
      return f ?? { id, status: "paid" };
    },
  },
};

const RAIZ = path.resolve(__dirname, "../../../../../..");
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
let POSTAdmin: (req: any) => Promise<Response>;
let POSTCfdi: (req: any, ctx: any) => Promise<Response>;
let POSTSubs: (req: any) => Promise<Response>;
let correosAdmin: any[] = [];
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
    sendEmail: async (m: any) => {
      correosAdmin.push(m);
      return { delivered: true };
    },
    sendPlanActivatedEmail: async () => {},
    sendPlanRenewedEmail: async (m: any) => {
      correosRenovacion.push(m);
    },
    sendPlanSuspendedEmail: async (m: any) => {
      correosSuspendida.push(m);
    },
    sendPaymentFailedEmail: async (m: any) => {
      if (correoFalla) throw new Error("Resend caído");
      correos.push(m);
    },
  });
  dobles.set(path.join(RAIZ, "src/lib/billing/sedes-incluidas.ts"), {
    sincronizarSedesIncluidas: async (id: string) => {
      sedesSincronizadas.push(id);
      return 0;
    },
    bloqueoDeSedesParaPlan: async () => null,
    leerGrupoDePago: async (id: string) => ({ pagadoraId: id, miembros: [id], esSedeIncluida: false, pagadoraNombre: null }),
  });
  dobles.set(path.join(RAIZ, "src/lib/billing/record-stripe-invoice.ts"), {
    recordStripeInvoice: async (inv: any, clinicId: string, estado?: string, metodo?: string) => {
      facturasRegistradas.push({ id: inv.id, clinicId, estado: estado ?? "paid", ...(metodo ? { metodo } : {}) });
    },
  });
  dobles.set(path.join(RAIZ, "src/lib/plans.ts"), {
    getPlanLimits: async () => ({ aiTokensDefault: 5000, maxClinics: null }),
    getResolvedPlan: async (id: string) => ({
      id, name: id, priceMxn: 689, priceMxnMonthly: 689, priceMxnAnnual: 5376, aiTokensDefault: 5000,
      maxUsers: 6, maxClinics: 1, features: [], moduleFeatures: {},
    }),
    getResolvedPlans: async () => [],
  });
  dobles.set(path.join(RAIZ, "src/lib/admin-auth.ts"), {
    getAdminSession: async () => ({ user: { id: "adm1", email: "admin@dalecontrol.com" } }),
    isAdminAuthed: async () => true,
  });
  dobles.set(path.join(RAIZ, "src/lib/cfdi/index.ts"), {
    isCFDIConfigured: () => true,
    cfdiNotConfiguredInstructions: () => "",
    getCFDIProvider: () => ({ generateInvoice: async () => { throw new Error("no debería timbrar"); } }),
  });
  dobles.set(path.join(RAIZ, "src/lib/admin-audit.ts"), { logAdminClinicMutation: async (a: any) => { bitacoraAdmin.push(a); } });
  dobles.set(path.join(RAIZ, "src/lib/analytics/meta-capi.server.ts"), { enviarCompraMetaDeSesion: async () => {} });
  dobles.set(path.join(RAIZ, "src/lib/analytics/tiktok-capi.server.ts"), { enviarCompraTiktokDeSesion: async () => {} });
  ({ NextRequest: NextRequestCtor } = await import("next/server"));
  fijarInicioDelMarcadoParaPruebas(new Date(0)); // las pruebas usan la hora real; el corte de producción se prueba aparte
  ({ POST } = await import("../route"));
  ({ POST: POSTAdmin } = await import("../../../admin/billing/route"));
  ({ POST: POSTCfdi } = await import("../../../admin/payments/[id]/cfdi/route"));
  ({ POST: POSTSubs } = await import("../../../admin/subscriptions/route"));
});

/* ── Fábricas ──────────────────────────────────────────────────────────── */
const SUB = "sub_plan_1";
const CUS = "cus_bevadent";
const CLINIC = "clinic_bevadent";
const FACTURA = "in_renovacion_oct";
let idEvento = 0;

function reiniciar(sobre: Record<string, unknown> = {}) {
  clinicas = new Map([
    [
      CLINIC,
      {
        id: CLINIC,
        name: "BEVADENT",
        email: "contacto@bevadent.mx",
        plan: "PRO",
        timezone: "America/Mexico_City",
        stripeCustomerId: CUS,
        stripeSubscriptionId: SUB,
        subscriptionStatus: "active",
        // Stripe ya abrió el periodo nuevo (19-nov) antes del rechazo: el caso real.
        trialEndsAt: new Date(Date.now() + 30 * DIA),
        nextBillingDate: new Date(Date.now() + 30 * DIA),
        users: [{ email: "dueno@bevadent.mx", firstName: "Ana" }],
        ...sobre,
      },
    ],
  ]);
  logsCorreo = [];
  correos = [];
  correosSuspendida = [];
  pagosDeSubscripcion = [];
  bitacora = [];
  sedesSincronizadas = [];
  facturasRegistradas = [];
  escrituras = [];
  suscripcionesVivas = new Map();
  facturasVivas = new Map([[FACTURA, { id: FACTURA, status: "open" }]]);
  stripeRespondeSuscripciones = true;
  correoFalla = false;
  stripeListaFalla = false;
  stripePagoFalla = false;
  facturasDeLista = [];
  llamadasCiclo = [];
  correosAdmin = [];
  llamadasAnular = [];
  ordenDeLlamadas = [];
  resetCobraLaTarjeta = false;
  ultimaFacturaDelCambio = null;
  cicloLanzaDespuesDeAplicar = false;
  stripeCicloFalla = false;
  stripeAnularFalla = false;
  itemsPendientes = [];
  facturasAparte = [];
  anularFallaPara = new Set();
  aparteFalla = false;
  llamadasPay = [];
  filasAnuladas = [];
  bitacoraAdmin = [];
  correosRenovacion = [];
  idEvento = 0;
}
beforeEach(() => reiniciar());

const clinica = () => clinicas.get(CLINIC);
const aSegundos = (ms: number) => Math.floor(ms / 1000);

function facturaFallida(extra: Record<string, unknown> = {}) {
  return {
    id: FACTURA,
    customer: CUS,
    billing_reason: "subscription_cycle",
    status: "open",
    attempt_count: 1,
    lines: { data: [{ metadata: {} }] },
    parent: { subscription_details: { subscription: SUB, metadata: {} } },
    ...extra,
  };
}

function evento(type: string, object: unknown, creadoMs = Date.now()) {
  return { id: `evt_${++idEvento}`, type, created: aSegundos(creadoMs), data: { object } };
}

async function entregar(ev: any): Promise<number> {
  const req = new NextRequestCtor("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "firma" },
    body: JSON.stringify(ev),
  });
  const res = await POST(req);
  return res.status;
}

/** Forma de un `customer.subscription.updated`: el periodo vive en el item (API nueva). */
function suscripcion(status: string, finPeriodoMs: number) {
  return {
    id: SUB,
    customer: CUS,
    status,
    metadata: { clinicId: CLINIC, plan: "PRO" },
    items: { data: [{ current_period_end: aSegundos(finPeriodoMs) }] },
  };
}

const nada = () => new Promise((r) => setImmediate(r));

/* ── 1 · Gracia de 24 h ────────────────────────────────────────────────── */

test("primer rechazo: past_due, acceso hasta (rechazo + 24 h), sedes al día y UN correo con la hora de suspensión", async () => {
  const rechazo = Date.now();
  assert.equal(await entregar(evento("invoice.payment_failed", facturaFallida(), rechazo)), 200);

  assert.equal(clinica().subscriptionStatus, "past_due");
  assert.equal(clinica().trialEndsAt.getTime(), aSegundos(rechazo) * 1000 + 24 * HORA, "24 h exactas desde el rechazo, no 30 días");
  assert.ok(sedesSincronizadas.includes(CLINIC), "las sedes siguen al pagador");
  assert.deepEqual(facturasRegistradas, [{ id: FACTURA, clinicId: CLINIC, estado: "failed" }]);

  await nada();
  assert.equal(correos.length, 1, "un correo");
  assert.equal(correos[0].email, "dueno@bevadent.mx", "al mismo destinatario que «plan activado»: el dueño");
  assert.equal(correos[0].clinicName, "BEVADENT");
  assert.match(correos[0].suspensionLabel, /2026/, "con la fecha y hora de suspensión");
  assert.equal(correos[0].payUrl.endsWith("/dashboard/settings?tab=subscription"), true);
  assert.equal(logsCorreo[0].kind, "payment_failed");
  assert.equal(logsCorreo[0].invoiceId, `${FACTURA}:payment_failed`, "no choca con el recibo de la misma factura");

  // Durante la gracia entra; pasadas las 24 h, no.
  assert.equal(isPlanExpired(clinica(), new Date(rechazo + 23 * HORA)), false);
  assert.equal(isPlanExpired(clinica(), new Date(rechazo + 25 * HORA)), true);
});

test("reintento fallido 8 h después: NO alarga ni reinicia la gracia y NO manda otro correo", async () => {
  const rechazo = Date.now();
  await entregar(evento("invoice.payment_failed", facturaFallida(), rechazo));
  const limite = clinica().trialEndsAt.getTime();

  await entregar(evento("invoice.payment_failed", facturaFallida({ attempt_count: 2 }), rechazo + 8 * HORA));
  await entregar(evento("invoice.payment_failed", facturaFallida({ attempt_count: 3 }), rechazo + 3 * DIA));
  assert.equal(clinica().trialEndsAt.getTime(), limite, "el límite no se mueve");
  assert.equal(clinica().subscriptionStatus, "past_due");
  await nada();
  assert.equal(correos.length, 1, "una sola vez por cobro rechazado");
});

test("el MISMO evento dos veces: idempotente (misma fecha, mismo estado, un correo)", async () => {
  const ev = evento("invoice.payment_failed", facturaFallida());
  await entregar(ev);
  const despuesDelPrimero = { ...clinica() };
  await entregar(ev);
  assert.equal(clinica().trialEndsAt.getTime(), despuesDelPrimero.trialEndsAt.getTime());
  assert.equal(clinica().subscriptionStatus, despuesDelPrimero.subscriptionStatus);
  await nada();
  assert.equal(correos.length, 1);
});

test("rechazo con el periodo AÚN sin abrir (el `payment_failed` llega antes que el `updated`): igual 24 h desde el rechazo", async () => {
  reiniciar({ trialEndsAt: new Date(Date.now() - 2 * HORA), nextBillingDate: new Date(Date.now() - 2 * HORA) });
  const rechazo = Date.now();
  await entregar(evento("invoice.payment_failed", facturaFallida(), rechazo));
  assert.equal(clinica().trialEndsAt.getTime(), aSegundos(rechazo) * 1000 + 24 * HORA);
  assert.equal(isPlanExpired(clinica(), new Date(rechazo + HORA)), false, "no se queda en la calle por llegar el aviso primero");
});

test("la mensualidad de un MÓDULO que se rechaza no toca el plan: ni estado, ni fecha, ni correo", async () => {
  const antes = { ...clinica() };
  await entregar(
    evento("invoice.payment_failed", facturaFallida({ parent: { subscription_details: { subscription: "sub_mod", metadata: { kind: "module-subscription", moduleKey: "orthodontics" } } } })),
  );
  assert.equal(clinica().subscriptionStatus, "active");
  assert.equal(clinica().trialEndsAt.getTime(), antes.trialEndsAt.getTime());
  await nada();
  assert.equal(correos.length, 0);
});

test("un prorrateo rechazado (subscription_update) no suspende ni da correo", async () => {
  await entregar(evento("invoice.payment_failed", facturaFallida({ billing_reason: "subscription_update" })));
  assert.equal(clinica().subscriptionStatus, "active");
  await nada();
  assert.equal(correos.length, 0);
});

test("aviso RETRASADO de una factura que ya se pagó: no vuelve a suspender a nadie", async () => {
  facturasVivas.set(FACTURA, { id: FACTURA, status: "paid" });
  const antes = clinica().trialEndsAt.getTime();
  assert.equal(await entregar(evento("invoice.payment_failed", facturaFallida())), 200);
  assert.equal(clinica().subscriptionStatus, "active");
  assert.equal(clinica().trialEndsAt.getTime(), antes);
  await nada();
  assert.equal(correos.length, 0);
});

test("si el envío del correo REVIENTA, el webhook responde 200 y la suspensión ya quedó escrita", async () => {
  correoFalla = true;
  assert.equal(await entregar(evento("invoice.payment_failed", facturaFallida())), 200);
  assert.equal(clinica().subscriptionStatus, "past_due");
  assert.equal(clinica().trialEndsAt.getTime() < Date.now() + 25 * HORA, true);
  assert.equal(facturasRegistradas.length, 1, "y el cobro fallido quedó registrado");
});

test("sin dueño ni correo de la clínica: no hay a quién avisar y no se rompe nada", async () => {
  reiniciar({ email: null, users: [] });
  assert.equal(await entregar(evento("invoice.payment_failed", facturaFallida())), 200);
  assert.equal(clinica().subscriptionStatus, "past_due");
  assert.equal(correos.length, 0);
});

test("sin dueño activo, el correo va al de la clínica", async () => {
  reiniciar({ users: [] });
  await entregar(evento("invoice.payment_failed", facturaFallida()));
  await nada();
  assert.equal(correos[0]?.email, "contacto@bevadent.mx");
});

/* ── 2 · Orden no garantizado de eventos ───────────────────────────────── */

test("un `updated` «active» que llega DESPUÉS del `payment_failed` (Stripe ya está en past_due) no regala el mes", async () => {
  const rechazo = Date.now();
  await entregar(evento("invoice.payment_failed", facturaFallida(), rechazo));
  const limite = clinica().trialEndsAt.getTime();

  const finNuevo = Date.now() + 30 * DIA;
  // El evento trae «active» (fotografía del instante de la renovación); Stripe, vivo, ya dice past_due.
  suscripcionesVivas.set(SUB, suscripcion("past_due", finNuevo));
  await entregar(evento("customer.subscription.updated", suscripcion("active", finNuevo)));

  assert.equal(clinica().subscriptionStatus, "past_due", "manda el estado VIVO");
  assert.equal(clinica().trialEndsAt.getTime(), limite, "el acceso se queda en la gracia de 24 h");
  assert.equal(clinica().nextBillingDate.getTime(), aSegundos(finNuevo) * 1000, "la fecha informativa sí avanza");
});

test("un `updated` que ya viene en past_due ANTES del `payment_failed` no fija la gracia ni baja el estado: eso es del `payment_failed`", async () => {
  reiniciar({ trialEndsAt: new Date(Date.now() - HORA), nextBillingDate: new Date(Date.now() - HORA) });
  const finNuevo = Date.now() + 30 * DIA;
  suscripcionesVivas.set(SUB, suscripcion("past_due", finNuevo));
  await entregar(evento("customer.subscription.updated", suscripcion("past_due", finNuevo)));
  assert.equal(clinica().subscriptionStatus, "active", "se espera al `payment_failed`");

  const rechazo = Date.now();
  await entregar(evento("invoice.payment_failed", facturaFallida(), rechazo));
  assert.equal(clinica().subscriptionStatus, "past_due");
  assert.equal(clinica().trialEndsAt.getTime(), aSegundos(rechazo) * 1000 + 24 * HORA, "y ahí sí queda la gracia completa");
});

test("`updated` past_due / unpaid con la clínica ya rechazada: no mueve trialEndsAt", async () => {
  const rechazo = Date.now();
  await entregar(evento("invoice.payment_failed", facturaFallida(), rechazo));
  const limite = clinica().trialEndsAt.getTime();
  for (const estado of ["past_due", "unpaid"]) {
    suscripcionesVivas.set(SUB, suscripcion(estado, Date.now() + 60 * DIA));
    await entregar(evento("customer.subscription.updated", suscripcion(estado, Date.now() + 60 * DIA)));
    assert.equal(clinica().trialEndsAt.getTime(), limite, estado);
  }
  assert.equal(clinica().subscriptionStatus, "unpaid");
});

test("rechazada y sin poder leer el estado vivo de Stripe: 500 para que Stripe reintente, sin tocar nada", async () => {
  await entregar(evento("invoice.payment_failed", facturaFallida()));
  const limite = clinica().trialEndsAt.getTime();
  stripeRespondeSuscripciones = false;
  const escriturasAntes = escrituras.length;
  const codigo = await entregar(evento("customer.subscription.updated", suscripcion("active", Date.now() + 30 * DIA)));
  assert.equal(codigo, 500);
  assert.equal(escrituras.length, escriturasAntes);
  assert.equal(clinica().trialEndsAt.getTime(), limite);
});

/* ── 3 · Pagar: reactivación ───────────────────────────────────────────── */

test("paga durante la gracia (tarjeta nueva en el portal): active y el acceso llega al fin del periodo PAGADO", async () => {
  await entregar(evento("invoice.payment_failed", facturaFallida()));
  const finPagado = Date.now() + 30 * DIA;
  suscripcionesVivas.set(SUB, suscripcion("active", finPagado));
  await entregar(evento("customer.subscription.updated", suscripcion("active", finPagado)));
  assert.equal(clinica().subscriptionStatus, "active");
  assert.equal(clinica().trialEndsAt.getTime(), aSegundos(finPagado) * 1000);
  assert.equal(isPlanExpired(clinica(), new Date()), false);
});

function facturaPagada(extra: Record<string, unknown> = {}) {
  return { ...facturaFallida(), status: "paid", amount_paid: 68900, currency: "mxn", ...extra };
}

test("`invoice.paid` reactiva por sí solo (aunque el `updated` se pierda), con el estado VIVO de Stripe", async () => {
  const rechazo = Date.now();
  await entregar(evento("invoice.payment_failed", facturaFallida(), rechazo));
  assert.equal(clinica().subscriptionStatus, "past_due");
  const finPagado = Date.now() + 30 * DIA;
  suscripcionesVivas.set(SUB, suscripcion("active", finPagado));
  facturasVivas.set(FACTURA, { id: FACTURA, status: "paid" });
  assert.equal(await entregar(evento("invoice.paid", facturaPagada())), 200);
  assert.equal(clinica().subscriptionStatus, "active");
  assert.equal(clinica().trialEndsAt.getTime(), aSegundos(finPagado) * 1000, "al fin del periodo pagado");
  // `invoice.payment_succeeded` llega para la misma factura: no cambia nada más.
  const escrituras1 = escrituras.length;
  await entregar(evento("invoice.payment_succeeded", facturaPagada()));
  assert.equal(escrituras.length, escrituras1, "idempotente");
  assert.equal(clinica().subscriptionStatus, "active");
});

test("`invoice.paid` con la suscripción viva todavía en past_due (aviso viejo) NO reactiva", async () => {
  await entregar(evento("invoice.payment_failed", facturaFallida()));
  const limite = clinica().trialEndsAt.getTime();
  suscripcionesVivas.set(SUB, suscripcion("past_due", Date.now() + 30 * DIA));
  await entregar(evento("invoice.paid", facturaPagada()));
  assert.equal(clinica().subscriptionStatus, "past_due");
  assert.equal(clinica().trialEndsAt.getTime(), limite);
  // Y si Stripe no responde, tampoco: queda el `customer.subscription.updated`.
  stripeRespondeSuscripciones = false;
  assert.equal(await entregar(evento("invoice.paid", facturaPagada())), 200);
  assert.equal(clinica().subscriptionStatus, "past_due");
});

test("`invoice.paid` de OTRA suscripción (un módulo) no reactiva el plan", async () => {
  await entregar(evento("invoice.payment_failed", facturaFallida()));
  suscripcionesVivas.set(SUB, suscripcion("active", Date.now() + 30 * DIA));
  await entregar(
    evento("invoice.paid", facturaPagada({ id: "in_modulo", parent: { subscription_details: { subscription: "sub_mod", metadata: { kind: "module-subscription", moduleKey: "orthodontics" } } } })),
  );
  assert.equal(clinica().subscriptionStatus, "past_due");
});

test("SUSPENDIDA (pasó la gracia) con la suscripción de Stripe viva: paga y entra con todo", async () => {
  const rechazo = Date.now() - 3 * DIA;
  reiniciar({ subscriptionStatus: "past_due", trialEndsAt: new Date(rechazo + 24 * HORA) });
  assert.equal(isPlanExpired(clinica(), new Date()), true, "suspendida de verdad");
  const finPagado = Date.now() + 30 * DIA;
  suscripcionesVivas.set(SUB, suscripcion("active", finPagado));
  await entregar(evento("customer.subscription.updated", suscripcion("active", finPagado)));
  assert.equal(clinica().subscriptionStatus, "active");
  assert.equal(isPlanExpired(clinica(), new Date()), false, "entra");
  assert.ok(sedesSincronizadas.includes(CLINIC), "y sus sedes con ella");
});

test("SUSPENDIDA meses después, con la suscripción ya CANCELADA: el checkout nuevo la deja active con UN periodo, no dos", async () => {
  const hoy = Date.now();
  // Estado real de BEVADENT al cancelarse tras los reintentos: nextBillingDate = el periodo que nunca se pagó.
  reiniciar({
    subscriptionStatus: "cancelled",
    trialEndsAt: new Date(hoy - 180 * DIA + 24 * HORA),
    nextBillingDate: new Date(hoy - 150 * DIA),
  });
  assert.equal(isPlanExpired(clinica(), new Date()), true);
  await entregar(
    evento("checkout.session.completed", {
      id: "cs_1",
      mode: "subscription",
      payment_status: "paid",
      subscription: "sub_nueva",
      metadata: { kind: "platform-subscription", clinicId: CLINIC, plan: "PRO", billing: "monthly" },
    }),
  );
  assert.equal(clinica().subscriptionStatus, "active");
  const dias = (clinica().trialEndsAt.getTime() - hoy) / DIA;
  assert.ok(dias > 27 && dias < 32, `un mes desde hoy (salió ${dias.toFixed(1)} días)`);
  assert.equal(isPlanExpired(clinica(), new Date()), false);
});

test("reactivar desde una clínica con el cobro rechazado y el siguiente cobro SIN pagar: no regala el mes abierto", async () => {
  const hoy = Date.now();
  reiniciar({ subscriptionStatus: "past_due", trialEndsAt: new Date(hoy - 2 * DIA), nextBillingDate: new Date(hoy + 28 * DIA) });
  await entregar(
    evento("checkout.session.completed", {
      id: "cs_2",
      mode: "subscription",
      payment_status: "paid",
      subscription: "sub_nueva",
      metadata: { kind: "platform-subscription", clinicId: CLINIC, plan: "PRO" },
    }),
  );
  const dias = (clinica().trialEndsAt.getTime() - hoy) / DIA;
  assert.ok(dias > 27 && dias < 32, `un mes desde hoy y no dos (salió ${dias.toFixed(1)} días)`);
});

/* ── 4 · Nunca borrar ──────────────────────────────────────────────────── */

test("customer.subscription.deleted: la clínica queda «cancelled» y NO se borra nada (el doble revienta si lo intenta)", async () => {
  const antes = { name: clinica().name, plan: clinica().plan, email: clinica().email };
  const codigo = await entregar(evento("customer.subscription.deleted", suscripcion("canceled", Date.now())));
  assert.equal(codigo, 200);
  assert.equal(clinica().subscriptionStatus, "cancelled");
  assert.equal(clinica().name, antes.name);
  assert.equal(clinica().plan, antes.plan);
  assert.equal(clinica().email, antes.email);
  assert.ok(sedesSincronizadas.includes(CLINIC));
});

/* ── Arreglos de la revisión (ws1-t4) ──────────────────────────────────── */

const sinSuspender = () => bitacora.find((b) => b.changes?._source?.after?.sinSuspender)?.changes._source.after.sinSuspender;
const conPeriodo = (finMs: number, creadaMs = Date.now() - DIA) => ({
  created: aSegundos(creadaMs),
  lines: { data: [{ metadata: {}, period: { end: aSegundos(finMs) } }] },
});

test("#1 pago manual POSTERIOR a la factura que falla (SPEI confirmado): el reintento viejo NO la suspende ni manda correo", async () => {
  const hoy = Date.now();
  reiniciar({ trialEndsAt: new Date(hoy + 30 * DIA), nextBillingDate: new Date(hoy + 30 * DIA) });
  pagosDeSubscripcion = [{ clinicId: CLINIC, status: "paid", method: "transfer", paidAt: new Date(hoy - HORA) }];
  const antes = clinica().trialEndsAt.getTime();
  assert.equal(await entregar(evento("invoice.payment_failed", facturaFallida({ created: aSegundos(hoy - 2 * DIA) }))), 200);
  assert.equal(clinica().subscriptionStatus, "active", "sigue al corriente");
  assert.equal(clinica().trialEndsAt.getTime(), antes, "sin recorte a 24 h");
  assert.equal(escrituras.length, 0, "no se escribió nada en la clínica");
  await nada();
  assert.equal(correos.length + correosSuspendida.length, 0, "ni correo");
  assert.equal(sinSuspender(), "pago_manual", "solo bitácora");
  assert.equal(facturasRegistradas.length, 1, "el cobro fallido sí queda registrado");
});

test("#1 activación del admin (sin fila de pago) que ya pasa del periodo de la factura: tampoco suspende", async () => {
  const hoy = Date.now();
  // La factura vieja cubría hasta dentro de 5 días; el admin dejó a la clínica pagada 2 meses.
  reiniciar({ trialEndsAt: new Date(hoy + 60 * DIA), nextBillingDate: new Date(hoy + 60 * DIA) });
  await entregar(evento("invoice.payment_failed", facturaFallida(conPeriodo(hoy + 5 * DIA))));
  assert.equal(clinica().subscriptionStatus, "active");
  assert.equal(escrituras.length, 0);
  assert.equal(sinSuspender(), "pago_manual");
  await nada();
  assert.equal(correos.length, 0);
});

test("#1 contraste: renovación NORMAL de tarjeta (acceso = fin del periodo facturado) y pago manual ANTERIOR / de Stripe sí suspenden", async () => {
  const hoy = Date.now();
  const fin = hoy + 30 * DIA;
  reiniciar({ trialEndsAt: new Date(fin), nextBillingDate: new Date(fin) });
  await entregar(evento("invoice.payment_failed", facturaFallida(conPeriodo(fin)), hoy));
  assert.equal(clinica().subscriptionStatus, "past_due", "renovación normal: gracia de 24 h como siempre");
  // Un pago manual de ANTES de crearse la factura no la cubre; uno de Stripe tampoco cuenta como manual.
  reiniciar({ trialEndsAt: new Date(fin), nextBillingDate: new Date(fin) });
  pagosDeSubscripcion = [
    { clinicId: CLINIC, status: "paid", method: "transfer", paidAt: new Date(hoy - 10 * DIA) },
    { clinicId: CLINIC, status: "paid", method: "stripe", paidAt: new Date(hoy) },
  ];
  await entregar(evento("invoice.payment_failed", facturaFallida(conPeriodo(fin, hoy - DIA)), hoy));
  assert.equal(clinica().subscriptionStatus, "past_due");
});

test("#2 Stripe caído al preguntar por la factura: 5xx (Stripe reintenta) y la clínica NO se toca", async () => {
  facturasVivas.delete(FACTURA); // retrieve lanza «No such invoice», como un Stripe que no contesta
  const antes = clinica().trialEndsAt.getTime();
  assert.equal(await entregar(evento("invoice.payment_failed", facturaFallida())), 500);
  assert.equal(clinica().subscriptionStatus, "active");
  assert.equal(clinica().trialEndsAt.getTime(), antes);
  assert.equal(escrituras.length, 0);
  await nada();
  assert.equal(correos.length, 0);
});

test("#2 / N1 la factura viva «paid» o «void» no suspende; «open» e «uncollectible» sí", async () => {
  for (const estado of ["paid", "void"]) {
    reiniciar();
    facturasVivas.set(FACTURA, { id: FACTURA, status: estado });
    assert.equal(await entregar(evento("invoice.payment_failed", facturaFallida())), 200, estado);
    assert.equal(clinica().subscriptionStatus, "active", estado);
    assert.equal(escrituras.length, 0, estado);
    assert.equal(sinSuspender(), "factura_no_abierta", estado);
  }
  reiniciar();
  facturasVivas.set(FACTURA, { id: FACTURA, status: "open" });
  await entregar(evento("invoice.payment_failed", facturaFallida()));
  assert.equal(clinica().subscriptionStatus, "past_due", "open sí");
});

test("N1 el PRIMER payment_failed que se procesa ya ve la factura «uncollectible» (webhook caído hasta agotar reintentos): past_due + 24 h + correo", async () => {
  facturasVivas.set(FACTURA, { id: FACTURA, status: "uncollectible" });
  const rechazo = Date.now();
  assert.equal(await entregar(evento("invoice.payment_failed", facturaFallida(), rechazo)), 200);
  assert.equal(clinica().subscriptionStatus, "past_due", "incobrable ≠ pagada");
  assert.equal(clinica().trialEndsAt.getTime(), aSegundos(rechazo) * 1000 + 24 * HORA);
  assert.equal(sinSuspender(), undefined);
  await nada();
  assert.equal(correos.length, 1, "y el correo de «no pudimos cobrar tu plan» sale");
});

test("#3 factura de OTRA suscripción de la misma cuenta de Stripe: solo bitácora, el plan no se recorta", async () => {
  const antes = clinica().trialEndsAt.getTime();
  await entregar(evento("invoice.payment_failed", facturaFallida({ parent: { subscription_details: { subscription: "sub_duplicada", metadata: {} } } })));
  assert.equal(clinica().subscriptionStatus, "active");
  assert.equal(clinica().trialEndsAt.getTime(), antes);
  assert.equal(sinSuspender(), "otra_suscripcion");
  await nada();
  assert.equal(correos.length, 0);
  assert.equal(facturasRegistradas.length, 1, "el rechazo igual queda registrado como cobro fallido");
});

test("#9 el aviso llega con la gracia VENCIDA: un correo distinto («suspendido por falta de pago»), con el mismo candado, una sola vez", async () => {
  const rechazo = Date.now() - 30 * HORA; // el webhook estuvo caído
  await entregar(evento("invoice.payment_failed", facturaFallida(), rechazo));
  assert.equal(clinica().subscriptionStatus, "past_due");
  assert.equal(isPlanExpired(clinica(), new Date()), true, "ya suspendida");
  await nada();
  assert.equal(correos.length, 0, "no el de «no pudimos cobrar»");
  assert.equal(correosSuspendida.length, 1);
  assert.equal(correosSuspendida[0].email, "dueno@bevadent.mx");
  assert.ok(correosSuspendida[0].payUrl.endsWith("/dashboard/suspended"));
  assert.equal(logsCorreo[0].invoiceId, `${FACTURA}:payment_failed`, "el MISMO candado");
  // El reintento siguiente (o el mismo evento) no manda ni uno ni otro.
  await entregar(evento("invoice.payment_failed", facturaFallida({ attempt_count: 2 }), Date.now()));
  await nada();
  assert.equal(correosSuspendida.length + correos.length, 1);
});

test("#9 una cuenta NUEVA cuyo primer pago falló no recibe el de «suspendido por falta de pago»", async () => {
  reiniciar({ subscriptionStatus: "pending_payment", trialEndsAt: new Date(Date.now() - DIA), nextBillingDate: null });
  await entregar(evento("invoice.payment_failed", facturaFallida({ billing_reason: "subscription_create" })));
  await nada();
  assert.equal(correosSuspendida.length + correos.length, 0);
});

test("N2 el doble evalúa el where real: el filtro de métodos es la lista explícita (cfdi_overage, stripe y desconocidos no cuentan)", async () => {
  const hoy = Date.now();
  const cubre = async (method: string | null) => {
    reiniciar({ trialEndsAt: new Date(hoy + 30 * DIA), nextBillingDate: new Date(hoy + 30 * DIA) });
    pagosDeSubscripcion = [{ clinicId: CLINIC, status: "paid", method, paidAt: new Date(hoy) }];
    await entregar(evento("invoice.payment_failed", facturaFallida({ ...conPeriodo(hoy + 30 * DIA, hoy - DIA) }), hoy));
    return clinica().subscriptionStatus === "active";
  };
  for (const m of ["transfer", "deposit", "oxxo", "paypal", "cash", "admin", null]) assert.equal(await cubre(m), true, `${m} es un pago manual del plan`);
  for (const m of ["stripe", "cfdi_overage", "otra_cosa"]) assert.equal(await cubre(m), false, `${m} NO cubre`);
  // Si se rompe la consulta (p. ej. sin el OR), el doble lo notaría: lanza ante operadores que no conoce.
  assert.throws(() => coincideWhere({ method: "x" }, { method: { raro: 1 } }), /no soportado/);
});

test("#1 residual: activación del admin (activate_clinic) a las +2 h de la gracia → el reintento de las +12 h NO suspende ni manda correo", async () => {
  const t0 = Date.now();
  // Factura creada justo antes del primer rechazo, con un periodo que termina DESPUÉS de lo que da la activación
  // (+45 d contra ~+31 d): así solo el rastro de la fila de pago manual puede cubrir a la clínica, no las fechas.
  const fin = t0 + 45 * DIA;
  const factura = (extra: Record<string, unknown> = {}) => facturaFallida({ ...conPeriodo(fin, t0 - HORA), ...extra });
  await entregar(evento("invoice.payment_failed", factura(), t0));
  assert.equal(clinica().subscriptionStatus, "past_due");
  await nada();
  assert.equal(correos.length, 1, "el aviso de la gracia salió");

  // +2 h: el admin activa a mano (recibió la transferencia). Deja el rastro que el webhook lee.
  const req = new NextRequestCtor("http://localhost/api/admin/billing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "activate_clinic", clinicId: CLINIC, plan: "PRO", months: 1, sumarAlCorriente: true }),
  });
  assert.equal((await POSTAdmin(req)).status, 200);
  assert.equal(clinica().subscriptionStatus, "active");
  const fila = pagosDeSubscripcion.find((p) => p.clinicId === CLINIC);
  assert.ok(fila, "la activación dejó su fila de pago manual");
  assert.deepEqual([fila.status, fila.method, fila.amount], ["paid", "admin", 0], "pagada, método «admin», $0 (no inventa ingreso)");
  assert.match(fila.notes, /Activación manual desde \/admin/);
  const accesoAdmin = clinica().trialEndsAt.getTime();

  // +12 h: Stripe reintenta la factura vieja y vuelve a fallar. NO se la vuelve a suspender.
  assert.equal(await entregar(evento("invoice.payment_failed", factura({ attempt_count: 2 }), t0 + 12 * HORA)), 200);
  assert.equal(clinica().subscriptionStatus, "active");
  assert.equal(clinica().trialEndsAt.getTime(), accesoAdmin, "el acceso que dejó el admin no se recorta");
  assert.equal(isPlanExpired(clinica(), new Date(t0 + 30 * HORA)), false, "ni a las 30 h");
  assert.equal(sinSuspender(), "pago_manual");
  await nada();
  assert.equal(correos.length + correosSuspendida.length, 1, "ningún correo nuevo");
});

test("N6 la activación se graba SIEMPRE con method «admin» y $0; el método que indique el admin va solo en las notas", async () => {
  for (const [enviado, enNotas] of [["cash", "Pago indicado: cash"], ["paypal", "Pago indicado: paypal"], ["transfer", "Pago indicado: transfer"], ["stripe", null], ["loquesea", null], [undefined, null]] as const) {
    reiniciar();
    const req = new NextRequestCtor("http://localhost/api/admin/billing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "activate_clinic", clinicId: CLINIC, plan: "PRO", months: 1, sumarAlCorriente: true, ...(enviado ? { method: enviado } : {}) }),
    });
    assert.equal((await POSTAdmin(req)).status, 200);
    const fila = pagosDeSubscripcion[0];
    assert.deepEqual([fila.method, fila.amount, fila.status], ["admin", 0, "paid"], `${enviado}: el filtro de pagos reales la reconoce siempre`);
    if (enNotas) assert.match(fila.notes, new RegExp(enNotas), `${enviado}: va en las notas`);
    else assert.doesNotMatch(fila.notes, /Pago indicado/, `${enviado}: método inválido, sin nota`);
    // Y el webhook la sigue leyendo como rastro (método «admin» está en su lista).
    assert.equal(esActivacionManual(fila), true);
  }
});

test("N8 /api/admin/payments/[id]/cfdi: una activación manual responde 400 «no tiene cobro que timbrar»; un cobro real sigue su camino", async () => {
  reiniciar();
  pagosDeSubscripcion = [
    { id: "inv_activacion", clinicId: CLINIC, status: "paid", method: "admin", amount: 0, currency: "MXN", periodStart: new Date(), periodEnd: new Date(), paidAt: new Date() },
    { id: "inv_real", clinicId: CLINIC, status: "paid", method: "transfer", amount: 689, currency: "MXN", periodStart: new Date(), periodEnd: new Date(), paidAt: new Date() },
  ];
  const llamar = (id: string) => POSTCfdi(new NextRequestCtor("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ id }) });
  const r = await llamar("inv_activacion");
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: "Una activación manual no tiene cobro que timbrar" });
  assert.equal((await llamar("no_existe")).status, 404);
  // Un cobro real NO recibe el 400 (llega al proveedor, que aquí es un doble que falla → 503 del propio flujo).
  assert.equal((await llamar("inv_real")).status, 503);
});

/* ── Decisión #1(a) de Rafael: pago manual confirmado ⇒ la factura de tarjeta queda pagada FUERA de Stripe ── */

// Creada hace una hora: dentro de las 24 h de gracia (la clínica aún NO estaba suspendida).
const FACTURA_ABIERTA = () => ({ id: FACTURA, status: "open", subscription: SUB, billing_reason: "subscription_cycle", created: Math.floor((Date.now() - HORA) / 1000) });
const llamarAdmin = (cuerpo: Record<string, unknown>) =>
  POSTAdmin(new NextRequestCtor("http://localhost/api/admin/billing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) }));
// `sumarAlCorriente`: «Activar» rechaza (409) a una clínica ya al corriente (Z5); las pruebas de una clínica en gracia o al corriente lo usan a propósito.
const activar = () => llamarAdmin({ action: "activate_clinic", clinicId: CLINIC, plan: "PRO", months: 1, sumarAlCorriente: true });
/** «Activar» tiene un candado de 2 minutos contra el doble clic (Y5): para repetirlo a propósito se envejece el rastro. */
const envejecerActivaciones = () => pagosDeSubscripcion.forEach((p) => { if (p.method === "admin" && p.paidAt) p.paidAt = new Date(p.paidAt.getTime() - 10 * 60_000); });

function conTarjetaRechazada() {
  reiniciar({ subscriptionStatus: "past_due", trialEndsAt: new Date(Date.now() + 20 * HORA), nextBillingDate: new Date(Date.now() + 30 * DIA) });
  suscripcionesVivas.set(SUB, suscripcion("past_due", Date.now() + 30 * DIA));
  facturasDeLista = [FACTURA_ABIERTA()];
}

test("#1(a) confirmar un pago manual con la factura de tarjeta ABIERTA: se marca pagada fuera de Stripe UNA sola vez, sin cancelar nada", async () => {
  conTarjetaRechazada();
  const r = await activar();
  assert.equal(r.status, 200);
  const cuerpo = await r.json();
  assert.deepEqual(cuerpo.facturaTarjeta, { tipo: "marcadas", facturas: [FACTURA] });
  assert.equal(llamadasPay.length, 1);
  assert.deepEqual(llamadasPay[0].params, { paid_out_of_band: true });
  assert.equal(llamadasPay[0].opciones.idempotencyKey, `fuera-de-stripe:${FACTURA}`, "con clave de idempotencia");
  assert.equal(clinica().subscriptionStatus, "active");
  assert.equal(clinica().stripeSubscriptionId, SUB, "la suscripción de tarjeta NO se toca");
  // Una segunda confirmación (doble clic, reintento) ya no la ve abierta: no vuelve a marcar nada.
  envejecerActivaciones();
  const otra = await (await activar()).json();
  // (Una segunda confirmación es otro pago de un mes: se suma al acceso y el cobro se mueve a donde termina; la factura no se toca.)
  assert.equal(otra.facturaTarjeta.tipo, "nada");
  assert.equal(otra.facturaTarjeta.facturas, undefined);
  assert.equal(llamadasPay.length, 1, "UNA sola vez");
  assert.equal(bitacoraAdmin.some((b) => b.after?.op === "activate_clinic" && b.after.facturaTarjeta?.tipo === "marcadas"), true, "queda en bitácora");
});

test("#1(a) también una factura INCOBRABLE del plan; los prorrateos de un cambio de plan no se tocan", async () => {
  conTarjetaRechazada();
  facturasDeLista = [
    { id: "in_incobrable", status: "uncollectible", subscription: SUB, billing_reason: "subscription_cycle", created: Math.floor((Date.now() - HORA) / 1000) },
    { id: "in_prorrateo", status: "open", subscription: SUB, billing_reason: "subscription_update" },
    { id: "in_de_otra_sub", status: "open", subscription: "sub_otra", billing_reason: "subscription_cycle" },
  ];
  const cuerpo = await (await activar()).json();
  assert.deepEqual(cuerpo.facturaTarjeta, { tipo: "marcadas", facturas: ["in_incobrable"] });
  assert.deepEqual(llamadasPay.map((l) => l.id), ["in_incobrable"]);
});

test("#1(a) sin factura abierta, sin suscripción de tarjeta viva o con la suscripción cancelada: no hace nada", async () => {
  conTarjetaRechazada();
  facturasDeLista = [];
  assert.deepEqual((await (await activar()).json()).facturaTarjeta, { tipo: "nada" });
  // Sin suscripción de tarjeta (pagador a mano de siempre).
  reiniciar({ stripeSubscriptionId: null });
  assert.deepEqual((await (await activar()).json()).facturaTarjeta, { tipo: "sin_tarjeta" });
  // La suscripción ya no existe en Stripe (resource_missing) o está cancelada.
  reiniciar();
  facturasDeLista = [FACTURA_ABIERTA()];
  assert.deepEqual((await (await activar()).json()).facturaTarjeta, { tipo: "sin_tarjeta" });
  suscripcionesVivas.set(SUB, suscripcion("canceled", Date.now()));
  envejecerActivaciones();
  assert.deepEqual((await (await activar()).json()).facturaTarjeta, { tipo: "sin_tarjeta" });
  assert.equal(llamadasPay.length, 0);
});

test("#1(a) Stripe falla al marcar: la activación NO se deshace, queda en bitácora, el admin ve el aviso y puede reintentar", async () => {
  conTarjetaRechazada();
  stripePagoFalla = true;
  const r = await activar();
  assert.equal(r.status, 200, "la activación sigue en pie");
  const cuerpo = await r.json();
  assert.equal(cuerpo.success, true);
  assert.equal(cuerpo.facturaTarjeta.tipo, "fallo");
  assert.equal(cuerpo.facturaTarjeta.mensaje, "No pudimos marcar la factura de tarjeta como pagada; Stripe podría reintentar el cobro. Reintenta o márcala a mano en Stripe.");
  assert.equal(clinica().subscriptionStatus, "active", "la clínica sigue activa");
  assert.equal(pagosDeSubscripcion.some((p) => p.method === "admin"), true, "y su rastro de pago manual quedó");
  assert.equal(bitacoraAdmin.some((b) => b.after?.op === "activate_clinic" && b.after.facturaTarjeta?.tipo === "fallo"), true);
  // Stripe tampoco lista las facturas: igual no se cae nada.
  stripePagoFalla = false;
  stripeListaFalla = true;
  envejecerActivaciones();
  const sinLista = await (await activar()).json();
  assert.equal(sinLista.facturaTarjeta.tipo, "fallo");
  assert.equal(clinica().subscriptionStatus, "active");
  stripeListaFalla = false;
  // «Reintentar» (botón del aviso): vuelve a marcar, sin tocar el estado de la clínica.
  const antes = { ...clinica() };
  const re = await llamarAdmin({ action: "marcar_factura_fuera_de_stripe", clinicId: CLINIC });
  const cuerpoRe = await re.json();
  assert.equal(cuerpoRe.success, true);
  assert.equal(cuerpoRe.facturaTarjeta.tipo, "marcadas");
  assert.deepEqual(cuerpoRe.facturaTarjeta.facturas, [FACTURA]);
  assert.equal(llamadasPay.length, 1);
  assert.equal(clinica().trialEndsAt.getTime(), antes.trialEndsAt.getTime());
  // Y si sigue caído, el reintento lo dice (success false) sin lanzar.
  facturasDeLista = [FACTURA_ABIERTA()];
  stripePagoFalla = true;
  const otra = await (await llamarAdmin({ action: "marcar_factura_fuera_de_stripe", clinicId: CLINIC })).json();
  assert.equal(otra.success, false);
  assert.equal((await llamarAdmin({ action: "marcar_factura_fuera_de_stripe" })).status, 400);
});

test("#1(a) «verificar pago» y registrar un pago pagado en /admin/subscriptions también la marcan (salvo un pago hecho en Stripe)", async () => {
  conTarjetaRechazada();
  pagosDeSubscripcion = [{ id: "inv_pendiente", clinicId: CLINIC, status: "pending", method: "transfer", amount: 689, currency: "MXN", periodStart: new Date(), periodEnd: new Date() }];
  const v = await (await llamarAdmin({ action: "verify_payment", invoiceId: "inv_pendiente" })).json();
  assert.equal(v.success, true);
  assert.deepEqual(v.facturaTarjeta, { tipo: "marcadas", facturas: [FACTURA] });
  assert.equal(llamadasPay.length, 1);

  const { POST: POSTSubs } = await import("../../../admin/subscriptions/route");
  const registrar = (method: string) =>
    POSTSubs(new NextRequestCtor("http://localhost/api/admin/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clinicId: CLINIC, amount: 689, method, periodStart: new Date().toISOString(), periodEnd: new Date(Date.now() + 30 * DIA).toISOString(), status: "paid" }),
    }));
  conTarjetaRechazada();
  const s = await (await registrar("transfer")).json();
  assert.deepEqual(s.facturaTarjeta, { tipo: "marcadas", facturas: [FACTURA] });
  conTarjetaRechazada();
  const enStripe = await (await registrar("stripe")).json();
  assert.equal(enStripe.facturaTarjeta, null, "un pago registrado como hecho en Stripe no se marca fuera de Stripe");
  assert.equal(llamadasPay.length, 0);
});

test("#1(a) invoice.paid de esa factura pagada fuera de Stripe: NO crea otro cobro, ni correo de renovación, ni duplica ingresos; limpia su «cobro fallido» y deja la suscripción al corriente", async () => {
  conTarjetaRechazada();
  await entregar(evento("invoice.payment_failed", facturaFallida(), Date.now()));
  assert.equal(facturasRegistradas.length, 1, "el rechazo quedó registrado como cobro fallido");
  const fallidoAntes = facturasRegistradas.length;
  facturasVivas.set(FACTURA, { id: FACTURA, status: "paid", paid_out_of_band: true });
  facturasRegistradas = [];
  // (a) el evento trae paid_out_of_band; (b) no lo trae y se lee la factura viva.
  for (const payload of [{ paid_out_of_band: true }, {}]) {
    facturasRegistradas = [];
    filasAnuladas = [];
    correosRenovacion = [];
    const codigo = await entregar(evento("invoice.paid", facturaPagada({ ...payload, billing_reason: "subscription_cycle" })));
    assert.equal(codigo, 200);
    assert.deepEqual(facturasRegistradas, [], "no se registra otro cobro (el cobro real es el manual)");
    assert.equal(correosRenovacion.length, 0, "ni «plan renovado»");
    assert.equal(filasAnuladas.length, 1, "la fila de cobro fallido de esa factura sale de «por cobrar»");
    assert.deepEqual(filasAnuladas[0].where, { clinicId: CLINIC, reference: FACTURA, status: { in: ["failed", "pending"] } }, "con el tenant en el filtro");
    assert.equal(filasAnuladas[0].data.status, "void");
  }
  assert.ok(fallidoAntes >= 1);
  // Contraste: un invoice.paid NORMAL sí se registra como cobro.
  facturasVivas.set(FACTURA, { id: FACTURA, status: "paid", paid_out_of_band: false });
  facturasRegistradas = [];
  await entregar(evento("invoice.paid", facturaPagada({ paid_out_of_band: false })));
  assert.equal(facturasRegistradas.length, 1, "un cobro real de tarjeta sigue registrándose");
});

test("#1(a) con la tarjeta VIVA el mes siguiente: un payment_failed NUEVO sí aplica la gracia de 24 h", async () => {
  conTarjetaRechazada();
  assert.equal((await activar()).status, 200);
  assert.equal(clinica().subscriptionStatus, "active");
  facturasVivas.set(FACTURA, { id: FACTURA, status: "paid", paid_out_of_band: true });
  await entregar(evento("invoice.paid", facturaPagada({ paid_out_of_band: true })));
  // Un mes después Stripe cobra la renovación siguiente y la tarjeta vuelve a fallar: otra factura, otro ciclo.
  const siguiente = "in_renovacion_nov";
  const inicioMes = Date.now() + 31 * DIA;
  facturasVivas.set(siguiente, { id: siguiente, status: "open" });
  const rechazo = inicioMes;
  const r = await entregar(
    evento("invoice.payment_failed", facturaFallida({ id: siguiente, ...conPeriodo(inicioMes + 31 * DIA, inicioMes - HORA) }), rechazo),
  );
  assert.equal(r, 200);
  assert.equal(clinica().subscriptionStatus, "past_due", "la gracia vuelve a aplicar");
  assert.equal(clinica().trialEndsAt.getTime(), aSegundos(rechazo) * 1000 + 24 * HORA, "24 h desde ESE rechazo");
  await nada();
  assert.equal(correos.length >= 1, true, "y el aviso de «no pudimos cobrar tu plan» sale");
});

/* ── Quinta vuelta (t4): Q2, Q3, Q5, Q6 ────────────────────────────────── */

test("Q2 activar 3 meses → marcar → `updated` active → `payment_failed` del mes siguiente: NO suspende (el `updated` no recorta el pago manual)", async () => {
  conTarjetaRechazada();
  // Stripe: el ciclo que abrió la renovación termina en ~1 mes; el pago manual da 3 meses.
  const finCiclo = Date.now() + 30 * DIA;
  const req = new NextRequestCtor("http://localhost/api/admin/billing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "activate_clinic", clinicId: CLINIC, plan: "PRO", months: 3, sumarAlCorriente: true }),
  });
  assert.equal((await POSTAdmin(req)).status, 200);
  assert.equal(llamadasPay.length, 1, "la factura se marcó pagada fuera de Stripe");
  const accesoManual = clinica().trialEndsAt.getTime();
  assert.ok(accesoManual > Date.now() + 80 * DIA, "tres meses de acceso");

  // Stripe pasa la suscripción a active y manda el `updated`: el fin de SU ciclo (1 mes) no puede bajar el acceso.
  suscripcionesVivas.set(SUB, suscripcion("active", finCiclo));
  assert.equal(await entregar(evento("customer.subscription.updated", suscripcion("active", finCiclo))), 200);
  assert.equal(clinica().trialEndsAt.getTime(), accesoManual, "el acceso del pago manual NO se recorta al ciclo de Stripe");
  assert.equal(clinica().nextBillingDate.getTime(), aSegundos(finCiclo) * 1000, "la fecha informativa sí sigue a Stripe");
  facturasVivas.set(FACTURA, { id: FACTURA, status: "paid", paid_out_of_band: true });
  await entregar(evento("invoice.paid", facturaPagada({ paid_out_of_band: true })));

  // Al mes siguiente la tarjeta falla en la renovación: sigue cubierta por el prepago.
  const siguiente = "in_renovacion_mes2";
  facturasVivas.set(siguiente, { id: siguiente, status: "open" });
  const inicio = finCiclo;
  const r = await entregar(evento("invoice.payment_failed", facturaFallida({ id: siguiente, ...conPeriodo(inicio + 30 * DIA, inicio - HORA) }), inicio));
  assert.equal(r, 200);
  assert.equal(clinica().subscriptionStatus, "active", "NO se suspende: prepagó tres meses");
  assert.equal(clinica().trialEndsAt.getTime(), accesoManual);
  assert.equal(sinSuspender(), "pago_manual");
  await nada();
  assert.equal(correos.length, 0);
});

test("Q2 contraste: el `updated` sigue concediendo el periodo de Stripe cuando es MAYOR (recuperación normal con tarjeta)", async () => {
  await entregar(evento("invoice.payment_failed", facturaFallida()));
  const finPagado = Date.now() + 30 * DIA;
  suscripcionesVivas.set(SUB, suscripcion("active", finPagado));
  await entregar(evento("customer.subscription.updated", suscripcion("active", finPagado)));
  assert.equal(clinica().trialEndsAt.getTime(), aSegundos(finPagado) * 1000);
});

test("Q3 «verificar» un adeudo de excedente de CFDI NO activa la clínica, no toca monthlyPrice ni marca la factura de tarjeta del plan", async () => {
  conTarjetaRechazada();
  clinica().monthlyPrice = 689;
  const antes = { estado: clinica().subscriptionStatus, acceso: clinica().trialEndsAt.getTime() };
  pagosDeSubscripcion = [{ id: "inv_cfdi", clinicId: CLINIC, status: "pending", method: "cfdi_overage", amount: 45, currency: "MXN", periodStart: new Date(), periodEnd: new Date() }];
  const r = await llamarAdmin({ action: "verify_payment", invoiceId: "inv_cfdi" });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).facturaTarjeta, null);
  assert.equal(pagosDeSubscripcion[0].status, "paid", "el adeudo sí queda pagado");
  assert.equal(clinica().subscriptionStatus, antes.estado, "la clínica NO se activa");
  assert.equal(clinica().trialEndsAt.getTime(), antes.acceso);
  assert.equal(clinica().monthlyPrice, 689, "ni su precio mensual");
  assert.equal(llamadasPay.length, 0, "ni se marca la factura del plan");
});

test("Q3 solo un pago MANUAL DEL PLAN marca la factura: método nulo o de la lista sí; stripe, cfdi_overage y desconocidos no", async () => {
  const { POST: POSTSubs } = await import("../../../admin/subscriptions/route");
  const registrar = (method?: string) =>
    POSTSubs(new NextRequestCtor("http://localhost/api/admin/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clinicId: CLINIC, amount: 689, ...(method ? { method } : {}), periodStart: new Date().toISOString(), periodEnd: new Date(Date.now() + 30 * DIA).toISOString(), status: "paid" }),
    }));
  for (const [metodo, marca] of [[undefined, true], ["transfer", true], ["oxxo", true], ["cash", true], ["stripe", false], ["cfdi_overage", false], ["mercadopago", false]] as const) {
    conTarjetaRechazada();
    const j = await (await registrar(metodo)).json();
    assert.equal(j.facturaTarjeta !== null, marca, String(metodo));
    assert.equal(llamadasPay.length, marca ? 1 : 0, String(metodo));
  }
  conTarjetaRechazada();
  pagosDeSubscripcion = [{ id: "inv_n", clinicId: CLINIC, status: "pending", method: null, amount: 689, currency: "MXN", periodStart: new Date(), periodEnd: new Date() }];
  assert.deepEqual((await (await llamarAdmin({ action: "verify_payment", invoiceId: "inv_n" })).json()).facturaTarjeta, { tipo: "marcadas", facturas: [FACTURA] }, "verificar un pago sin método (null) es del plan");
});

test("Q5 `invoice.paid` sin `paid_out_of_band` en el evento y sin poder leer la factura: 5xx (Stripe reintenta); nada se registra", async () => {
  facturasVivas.delete(FACTURA);
  assert.equal(await entregar(evento("invoice.paid", facturaPagada())), 500);
  assert.deepEqual(facturasRegistradas, [], "no se registra un cobro de tarjeta que quizá fue manual");
  assert.equal(correosRenovacion.length, 0);
  // Con el campo en el evento no hace falta leer nada.
  assert.equal(await entregar(evento("invoice.paid", facturaPagada({ paid_out_of_band: false }))), 200);
});

test("Q6 el pago único de Stripe (SPEI/OXXO) con tarjeta viva deja su rastro aunque el marcado falle; sin tarjeta, ningún rastro", async () => {
  const sesion = (id: string) =>
    evento("checkout.session.async_payment_succeeded", { id, mode: "payment", payment_status: "paid", subscription: null, metadata: { kind: "platform-subscription", clinicId: CLINIC, plan: "PRO" } });
  conTarjetaRechazada();
  stripePagoFalla = true;
  assert.equal(await entregar(sesion("cs_oxxo_1")), 200);
  assert.equal(clinica().subscriptionStatus, "active", "la activación sigue en pie");
  const rastro = pagosDeSubscripcion.find((p) => p.reference === "pago-unico:cs_oxxo_1");
  assert.ok(rastro, "quedó el rastro de pago manual");
  assert.deepEqual([rastro.method, rastro.amount, rastro.status], ["admin", 0, "paid"]);
  assert.equal(esActivacionManual(rastro), true, "no cuenta como cobro");
  // Sin suscripción de tarjeta: nada que dejar.
  reiniciar({ stripeSubscriptionId: null });
  await entregar(sesion("cs_oxxo_2"));
  assert.equal(pagosDeSubscripcion.length, 0);
});

test("Q6 el aviso persistente se DERIVA de Stripe: clínicas con la tarjeta viva y una factura del plan abierta después de un pago manual", async () => {
  const { clinicasConFacturaPendienteTrasPagoManual } = await import("@/lib/billing/facturas-tarjeta-pendientes.server");
  conTarjetaRechazada();
  const hoy = Date.now();
  // Pago manual de hace 2 días; la factura (creada antes) sigue abierta porque el marcado falló.
  pagosDeSubscripcion = [{ id: "inv_m", clinicId: CLINIC, status: "paid", method: "transfer", amount: 689, paidAt: new Date(hoy - 2 * DIA) }];
  facturasDeLista = [{ ...FACTURA_ABIERTA(), created: aSegundos(hoy - 5 * DIA) }];
  const lista = await clinicasConFacturaPendienteTrasPagoManual({ stripe: stripeDoble, ahora: new Date(hoy) });
  assert.deepEqual(lista.map((c) => [c.clinicId, c.clinicName, c.facturas]), [[CLINIC, "BEVADENT", [FACTURA]]]);
  // La renovación del mes siguiente (creada DESPUÉS del pago manual) no cuenta: es otra deuda.
  facturasDeLista = [{ ...FACTURA_ABIERTA(), created: aSegundos(hoy - DIA) }];
  assert.deepEqual(await clinicasConFacturaPendienteTrasPagoManual({ stripe: stripeDoble, ahora: new Date(hoy) }), []);
  // Ya marcada → no aparece; sin pagos manuales → no aparece; sin Stripe → vacío; pago de hace más de 60 días → no.
  facturasDeLista = [{ ...FACTURA_ABIERTA(), created: aSegundos(hoy - 5 * DIA), status: "paid" }];
  assert.deepEqual(await clinicasConFacturaPendienteTrasPagoManual({ stripe: stripeDoble, ahora: new Date(hoy) }), []);
  facturasDeLista = [{ ...FACTURA_ABIERTA(), created: aSegundos(hoy - 5 * DIA) }];
  assert.deepEqual(await clinicasConFacturaPendienteTrasPagoManual({ stripe: null }), []);
  pagosDeSubscripcion = [{ id: "inv_viejo", clinicId: CLINIC, status: "paid", method: "transfer", amount: 689, paidAt: new Date(hoy - 90 * DIA) }];
  assert.deepEqual(await clinicasConFacturaPendienteTrasPagoManual({ stripe: stripeDoble, ahora: new Date(hoy) }), []);
  // Un pago de Stripe o un adeudo de CFDI no es un pago manual del plan.
  pagosDeSubscripcion = [{ id: "inv_s", clinicId: CLINIC, status: "paid", method: "stripe", amount: 689, paidAt: new Date(hoy - DIA) }, { id: "inv_c", clinicId: CLINIC, status: "paid", method: "cfdi_overage", amount: 45, paidAt: new Date(hoy - DIA) }];
  assert.deepEqual(await clinicasConFacturaPendienteTrasPagoManual({ stripe: stripeDoble, ahora: new Date(hoy) }), []);
});

test("Q6 reintento automático: el cron diario marca SOLO las facturas que ya existían al pago manual (no la renovación siguiente)", async () => {
  process.env.CRON_SECRET = "secreto-de-prueba";
  const { GET: cron } = await import("../../../cron/subscription-lapse/route");
  const llamar = () => cron(new NextRequestCtor("http://localhost/api/cron/subscription-lapse", { headers: { authorization: "Bearer secreto-de-prueba" } }));
  conTarjetaRechazada();
  const hoy = Date.now();
  pagosDeSubscripcion = [{ id: "inv_m", clinicId: CLINIC, status: "paid", method: "admin", amount: 0, paidAt: new Date(hoy - 2 * DIA) }];
  facturasDeLista = [
    { id: "in_vieja", status: "open", subscription: SUB, billing_reason: "subscription_cycle", created: aSegundos(hoy - 2 * DIA - 2 * HORA) },
    { id: "in_nueva", status: "open", subscription: SUB, billing_reason: "subscription_cycle", created: aSegundos(hoy - DIA) },
  ];
  const r = await llamar();
  assert.equal(r.status, 200);
  const cuerpo = await r.json();
  assert.deepEqual(cuerpo.facturasTarjeta, { revisadas: 1, marcadas: ["in_vieja"], anuladas: [], fallos: [] });
  assert.deepEqual(llamadasPay.map((l) => l.id), ["in_vieja"], "la renovación nueva no se perdona");
  // Segunda pasada: nada que hacer. Con Stripe caído: no se cae el cron y queda el fallo para mañana.
  assert.deepEqual((await (await llamar()).json()).facturasTarjeta, { revisadas: 0, marcadas: [], anuladas: [], fallos: [] });
  facturasDeLista = [{ id: "in_otra", status: "open", subscription: SUB, billing_reason: "subscription_cycle", created: aSegundos(hoy - 2 * DIA - 2 * HORA) }];
  stripePagoFalla = true;
  const caido = await llamar();
  assert.equal(caido.status, 200);
  assert.deepEqual((await caido.json()).facturasTarjeta, { revisadas: 1, marcadas: [], anuladas: [], fallos: [CLINIC] });
  delete process.env.CRON_SECRET;
});

/* ── Sexta vuelta (t4): R1 (corte y mismo ciclo) y R3 (rótulo del rastro de Stripe) ── */

async function llamarCron() {
  process.env.CRON_SECRET = "secreto-de-prueba";
  const { GET: cron } = await import("../../../cron/subscription-lapse/route");
  try {
    const r = await cron(new NextRequestCtor("http://localhost/api/cron/subscription-lapse", { headers: { authorization: "Bearer secreto-de-prueba" } }));
    return (await r.json()).facturasTarjeta;
  } finally {
    delete process.env.CRON_SECRET;
  }
}

test("R1 la fecha de corte de producción: 20-oct-2026 00:00 (Ciudad de México), y las pruebas la pueden mover y devolver", () => {
  assert.equal(INICIO_MARCADO_FUERA_DE_STRIPE.toISOString(), "2026-10-20T06:00:00.000Z");
  fijarInicioDelMarcadoParaPruebas();
  assert.equal(inicioDelMarcadoFueraDeStripe().getTime(), INICIO_MARCADO_FUERA_DE_STRIPE.getTime());
  fijarInicioDelMarcadoParaPruebas(new Date(0));
});

test("R1 el cron NO aplica la regla hacia atrás: un pago manual ANTERIOR al corte con la factura abierta no se marca; uno POSTERIOR sí", async () => {
  const hoy = Date.now();
  fijarInicioDelMarcadoParaPruebas(new Date(hoy - DIA)); // el despliegue fue ayer
  try {
    // Pago manual de hace 3 días (como el «1-oct»): antes del corte → ni el cron ni la lista lo tocan.
    conTarjetaRechazada();
    pagosDeSubscripcion = [{ id: "inv_antes", clinicId: CLINIC, status: "paid", method: "transfer", amount: 689, paidAt: new Date(hoy - 3 * DIA) }];
    facturasDeLista = [{ id: "in_vieja", status: "open", subscription: SUB, billing_reason: "subscription_cycle", created: aSegundos(hoy - 13 * HORA) }];
    assert.deepEqual(await llamarCron(), { revisadas: 0, marcadas: [], anuladas: [], fallos: [] });
    assert.equal(llamadasPay.length, 0, "nada de lo anterior al corte se marca solo");
    const { clinicasConFacturaPendienteTrasPagoManual } = await import("@/lib/billing/facturas-tarjeta-pendientes.server");
    assert.deepEqual(await clinicasConFacturaPendienteTrasPagoManual({ stripe: stripeDoble }), [], "ni sale en la lista de /admin");
    // «Reintentar» tampoco lo toma: no hay pago manual desde el corte.
    const re = await (await llamarAdmin({ action: "marcar_factura_fuera_de_stripe", clinicId: CLINIC })).json();
    assert.deepEqual(re.facturaTarjeta, { tipo: "nada" });
    assert.equal(llamadasPay.length, 0);

    // Pago manual de hace 12 h (después del corte) → sí.
    pagosDeSubscripcion = [{ id: "inv_despues", clinicId: CLINIC, status: "paid", method: "transfer", amount: 689, paidAt: new Date(hoy - 12 * HORA) }];
    assert.deepEqual(await llamarCron(), { revisadas: 1, marcadas: ["in_vieja"], anuladas: [], fallos: [] });
    assert.deepEqual(llamadasPay.map((l) => l.id), ["in_vieja"]);
  } finally {
    fijarInicioDelMarcadoParaPruebas(new Date(0));
  }
});

test("R1 sin el estado de antes (reintento): la factura del ciclo del pago se paga; las de meses SUSPENDIDOS se anulan; una renovación posterior al pago no se toca", async () => {
  const hoy = Date.now();
  const base = (extra: any[]) => {
    conTarjetaRechazada();
    pagosDeSubscripcion = [{ id: "inv_m", clinicId: CLINIC, status: "paid", method: "transfer", amount: 689, paidAt: new Date(hoy - 12 * HORA) }];
    facturasDeLista = extra;
  };
  const f = (id: string, status: string, horasAtras: number) => ({ id, status, subscription: SUB, billing_reason: "subscription_cycle", created: aSegundos(hoy - horasAtras * HORA) });
  // (a) Una factura vieja abierta (hace 40 d) y el ciclo siguiente ya pagado: el pago manual no la paga; era un mes sin servicio → se anula.
  base([f("in_ciclo1", "open", 40 * 24), f("in_ciclo2", "paid", 10 * 24)]);
  assert.deepEqual(await llamarCron(), { revisadas: 1, marcadas: [], anuladas: ["in_ciclo1"], fallos: [] });
  assert.equal(llamadasPay.length, 0);
  // (b) Ciclo 1 y 2 abiertos, ambos de hace más que la gracia: los dos son meses sin servicio; ninguno se paga fuera de Stripe.
  base([f("in_ciclo1", "open", 40 * 24), f("in_ciclo2", "open", 10 * 24)]);
  assert.deepEqual(await llamarCron(), { revisadas: 1, marcadas: [], anuladas: ["in_ciclo1", "in_ciclo2"], fallos: [] });
  assert.equal(llamadasPay.length, 0, "no existe «pagar» un mes suspendido");
  // (c) La factura del ciclo (creada 1 h antes del pago) se paga; una renovación creada DESPUÉS del pago es otra cosa.
  base([f("in_ciclo2", "open", 13), f("in_ciclo3", "open", 1)]);
  assert.deepEqual(await llamarCron(), { revisadas: 1, marcadas: ["in_ciclo2"], anuladas: [], fallos: [] });
  assert.equal(facturasDeLista.find((x) => x.id === "in_ciclo3")!.status, "open");
});

test("R3 el rastro del SPEI/OXXO de Stripe se rotula distinto de la activación manual, y se dice que su cobro real NO queda en su propia fila", async () => {
  conTarjetaRechazada();
  const sesion = evento("checkout.session.async_payment_succeeded", { id: "cs_oxxo_9", mode: "payment", payment_status: "paid", subscription: null, amount_total: 68900, metadata: { kind: "platform-subscription", clinicId: CLINIC, plan: "PRO" } });
  assert.equal(await entregar(sesion), 200);
  const rastro = pagosDeSubscripcion.find((p) => p.reference === "pago-unico:cs_oxxo_9");
  assert.ok(rastro);
  assert.equal(rotuloDeFilaSinCobro(rastro), "Pago SPEI/OXXO por Stripe (rastro)");
  assert.equal(rotuloDeFilaSinCobro({ method: "admin", amount: 0, reference: null }), "Activación manual (sin cobro)");
  assert.equal(rotuloDeFilaSinCobro({ method: "stripe", amount: 689, reference: "in_1" }), null);
  // El cobro real de ese pago NO queda en subscription_invoices: la sesión es de modo «payment» sin factura, así que ni
  // `invoice.paid` ni `recordStripeInvoice` lo ven. La única fila es el rastro de $0 (hueco que ya existía).
  assert.equal(pagosDeSubscripcion.filter((p) => (p.amount ?? 0) > 0).length, 0);
  assert.deepEqual(facturasRegistradas, []);
});

/* ── Periodo pagado a mano (octava a undécima vuelta) ─────────────────────────────────────────────────────────────────────
 * Mecanismo del ciclo: `trial_end` = fin de lo pagado (+ marca `periodo_pagado_hasta` en la metadata). Stripe lo reporta
 * `trialing`; NUESTRA app guarda `active` y la clínica nunca sale «En prueba».
 */

const unMinuto = 60_000;
const facturaDeMes = (id: string, hace: number, extra: Record<string, unknown> = {}) => ({
  id,
  status: "open",
  subscription: SUB,
  billing_reason: "subscription_cycle",
  created: aSegundos(Date.now() - hace),
  status_transitions: { finalized_at: aSegundos(Date.now() - hace) },
  ...extra,
});
const activarMeses = (months: number) => llamarAdmin({ action: "activate_clinic", clinicId: CLINIC, plan: "PRO", months, sumarAlCorriente: true });
const MESES_SUSPENDIDOS = ["in_s1", "in_s2", "in_s3", "in_s4"];
/** Suspendida 4 meses: la gracia venció hace 100 días y Stripe fue abriendo una factura por mes (hace 100, 70, 40 y 10 días). */
function suspendidaCuatroMeses() {
  const hoy = Date.now();
  reiniciar({ subscriptionStatus: "past_due", trialEndsAt: new Date(hoy - 100 * DIA), nextBillingDate: new Date(hoy + 10 * DIA) });
  suscripcionesVivas.set(SUB, suscripcion("past_due", hoy + 10 * DIA));
  facturasDeLista = [100, 70, 40, 10].map((d, i) => facturaDeMes(MESES_SUSPENDIDOS[i], d * DIA));
}
const mesesDesde = (desde: number, n: number) => {
  const f = new Date(desde);
  f.setMonth(f.getMonth() + n);
  return f;
};
/** El `trial_end` de la llamada que movió el ciclo, en ms. */
const trialEndMs = (i = 0) => llamadasCiclo[i].params.trial_end * 1000;

test("1 mes dentro de la gracia: la factura del ciclo se paga fuera de Stripe y el ciclo NO se mueve (ya coincide con lo pagado)", async () => {
  conTarjetaRechazada();
  const cuerpo = await (await activarMeses(1)).json();
  assert.deepEqual(cuerpo.facturaTarjeta, { tipo: "marcadas", facturas: [FACTURA] });
  assert.equal(llamadasCiclo.length, 0, "sin llamadas a la suscripción");
  assert.equal(suscripcionesVivas.get(SUB).trial_end, undefined);
});

test("Q1 3 meses prepagados al corriente: el cobro se mueve EXACTO al fin de lo pagado con trial_end (sin pausa, sin cancelar) y la clínica queda activa", async () => {
  conTarjetaRechazada();
  const finCiclo = Date.now() + 30 * DIA;
  suscripcionesVivas.set(SUB, suscripcion("past_due", finCiclo));
  const cuerpo = await (await activarMeses(3)).json();
  assert.equal(cuerpo.facturaTarjeta.tipo, "marcadas");
  assert.equal(cuerpo.facturaTarjeta.ciclo.tipo, "movido");
  assert.equal(llamadasCiclo.length, 1);
  const { id, params, opciones } = llamadasCiclo[0];
  assert.equal(id, SUB);
  assert.deepEqual(Object.keys(params).sort(), ["expand", "metadata", "proration_behavior", "trial_end"], "solo trial_end + marca: sin pause_collection ni anclas ni cancelación");
  assert.equal(params.proration_behavior, "none");
  // El cobro cae EXACTAMENTE cuando termina el acceso (la misma fecha, al segundo).
  assert.ok(Math.abs(trialEndMs() - clinica().trialEndsAt.getTime()) < 1500, "el cobro y el fin del acceso coinciden");
  assert.equal(params.metadata.periodo_pagado_hasta, new Date(trialEndMs()).toISOString());
  assert.equal(opciones.idempotencyKey, `periodo-pagado:${SUB}:${params.trial_end}`);
  assert.equal(clinica().subscriptionStatus, "active", "nunca «En prueba»");
  assert.equal(clinica().stripeSubscriptionId, SUB);
  // Q1 con el estado de Stripe `trialing`: el `updated` que sigue deja a la clínica `active` y con el acceso exacto.
  assert.equal(await entregar(evento("customer.subscription.updated", suscripcionesVivas.get(SUB))), 200);
  assert.equal(clinica().subscriptionStatus, "active", "trialing + marca = periodo pagado, no prueba");
  assert.ok(Math.abs(clinica().trialEndsAt.getTime() - trialEndMs()) < 1500);
  assert.ok(Math.abs(clinica().nextBillingDate.getTime() - trialEndMs()) < 1500, "el próximo cobro que ve el panel es el fin de lo pagado");
});

test("un `trialing` SIN nuestra marca (una prueba de verdad) se guarda tal cual: el mapeo solo aplica al periodo pagado", async () => {
  conTarjetaRechazada();
  const viva = suscripcion("trialing", Date.now() + 20 * DIA);
  suscripcionesVivas.set(SUB, viva);
  clinica().subscriptionStatus = "active";
  assert.equal(await entregar(evento("customer.subscription.updated", viva)), 200);
  assert.equal(clinica().subscriptionStatus, "trialing");
});

test("Q1 si Stripe falla al mover el ciclo: la activación NO se deshace, el admin ve el aviso con su texto y recibe el correo «revisa en Stripe»; «Reintentar» ya NO mueve el ciclo", async () => {
  conTarjetaRechazada();
  suscripcionesVivas.set(SUB, suscripcion("past_due", Date.now() + 30 * DIA));
  stripeCicloFalla = true;
  const r = await activarMeses(3);
  assert.equal(r.status, 200);
  const cuerpo = await r.json();
  assert.equal(cuerpo.facturaTarjeta.tipo, "fallo");
  assert.match(cuerpo.facturaTarjeta.mensaje, /mover el siguiente cobro de la tarjeta/);
  assert.deepEqual(cuerpo.facturaTarjeta.marcadas, [FACTURA], "lo que sí se marcó se informa");
  assert.equal(clinica().subscriptionStatus, "active");
  assert.equal(correosAdmin.length, 1, "el admin recibe el aviso de revisar la suscripción a mano");
  assert.match(correosAdmin[0].text, /La regla no se aplicó al momento del pago\. Revisa en Stripe la suscripción de BEVADENT/);
  stripeCicloFalla = false;
  const retry = await (await llamarAdmin({ action: "marcar_factura_fuera_de_stripe", clinicId: CLINIC })).json();
  assert.equal(llamadasCiclo.length, 0, "el reintento tardío NO mueve el ciclo");
  assert.match(retry.facturaTarjeta.revisar, /Revisa en Stripe la suscripción de BEVADENT/);
  assert.match(retry.facturaTarjeta.revisar, /El acceso de la clínica está protegido hasta/);
});

test("octava · suspendida 4 meses y paga 1: acceso un mes desde el pago, 4 facturas anuladas y no cobradas, el siguiente cobro es EXACTAMENTE al terminar, sin «En prueba»", async () => {
  suspendidaCuatroMeses();
  const antes = Date.now();
  const r = await activarMeses(1);
  assert.equal(r.status, 200);
  const cuerpo = await r.json();
  assert.equal(cuerpo.facturaTarjeta.tipo, "marcadas");
  assert.deepEqual(cuerpo.facturaTarjeta.facturas, []);
  assert.deepEqual([...cuerpo.facturaTarjeta.anuladas].sort(), MESES_SUSPENDIDOS);
  assert.equal(llamadasPay.length, 0, "no existe «pagar» un mes suspendido");
  assert.deepEqual(llamadasAnular.map((l) => l.id).sort(), MESES_SUSPENDIDOS);
  for (const l of llamadasAnular) assert.equal(l.opciones.idempotencyKey, `anular-suspendida:${l.id}`);
  assert.equal(facturasDeLista.filter((f) => f.status === "open").length, 0, "no queda ninguna abierta: Stripe nunca las cobra ni las reintenta");
  const fin = mesesDesde(antes, 1);
  assert.ok(Math.abs(clinica().trialEndsAt.getTime() - fin.getTime()) < unMinuto, "acceso = pago + 1 mes de calendario");
  assert.equal(clinica().subscriptionStatus, "active");
  assert.equal(llamadasCiclo.length, 1);
  assert.ok(Math.abs(trialEndMs() - clinica().trialEndsAt.getTime()) < 1500, "B3: el cobro de la tarjeta cae EXACTAMENTE cuando termina el acceso (sin días pagados dos veces ni huecos)");
  assert.equal(llamadasCiclo[0].params.billing_cycle_anchor, undefined);
  assert.equal(llamadasCiclo[0].params.pause_collection, undefined);
  assert.equal(cuerpo.facturaTarjeta.ciclo.tipo, "movido");
  assert.equal(ordenDeLlamadas[0], "ciclo", "primero el ciclo, luego las anulaciones");
  assert.equal(ordenDeLlamadas.filter((o) => o.startsWith("anular:")).length, 4);
  const filas = pagosDeSubscripcion.filter((p) => MESES_SUSPENDIDOS.includes(p.reference));
  assert.equal(filas.length, 4);
  for (const f of filas) {
    assert.equal(f.status, "void");
    assert.equal(f.notes, "No cobrada: servicio suspendido");
    assert.equal(f.clinicId, CLINIC, "con el tenant");
  }
  assert.equal(pagosDeSubscripcion.filter((p) => p.status === "paid" && (p.amount ?? 0) > 0).length, 0, "ningún ingreso");
  assert.equal(pagosDeSubscripcion.filter((p) => p.status === "failed" || p.status === "pending").length, 0, "ningún adeudo");
  // La fila del pago guarda el periodo REAL (de él sale el fin de lo pagado de cualquier reintento).
  const filaPago = pagosDeSubscripcion.find((p) => p.method === "admin");
  assert.ok(Math.abs(filaPago.periodEnd.getTime() - fin.getTime()) < unMinuto);
});

test("octava · suspendida y paga 3 meses: acceso y cobro a los 3 meses, facturas anuladas", async () => {
  suspendidaCuatroMeses();
  const antes = Date.now();
  await activarMeses(3);
  const fin = mesesDesde(antes, 3);
  assert.ok(Math.abs(clinica().trialEndsAt.getTime() - fin.getTime()) < unMinuto);
  assert.equal(llamadasAnular.length, 4);
  assert.equal(llamadasPay.length, 0);
  assert.equal(llamadasCiclo.length, 1, "UNA sola llamada");
  assert.ok(Math.abs(trialEndMs() - fin.getTime()) < unMinuto, "la tarjeta vuelve a cobrar al terminar los 3 meses");
  assert.equal(suscripcionesVivas.get(SUB).metadata.clinicId, CLINIC, "la metadata existente se conserva");
});

test("octava · idempotente: repetir la confirmación o pulsar «Reintentar» no anula ni mueve nada otra vez", async () => {
  suspendidaCuatroMeses();
  await activarMeses(1);
  const anuladas = llamadasAnular.length;
  const ciclos = llamadasCiclo.length;
  const re = await (await llamarAdmin({ action: "marcar_factura_fuera_de_stripe", clinicId: CLINIC })).json();
  assert.equal(re.success, true);
  assert.equal(llamadasAnular.length, anuladas);
  assert.equal(llamadasCiclo.length, ciclos, "no se mueve el ciclo otra vez");
  assert.equal(llamadasPay.length, 0);
  assert.equal(pagosDeSubscripcion.filter((p) => MESES_SUSPENDIDOS.includes(p.reference)).length, 4, "ninguna fila duplicada");
});

test("octava/Y6 · si Stripe no puede mover el ciclo, las facturas de los meses sin servicio SE ANULAN igual (nunca se deben); el reintento TARDÍO no mueve el ciclo: avisa qué revisar en Stripe", async () => {
  suspendidaCuatroMeses();
  stripeCicloFalla = true;
  const r = await activarMeses(1);
  assert.equal(r.status, 200, "la activación no se deshace");
  const cuerpo = await r.json();
  assert.equal(cuerpo.facturaTarjeta.tipo, "fallo");
  assert.match(cuerpo.facturaTarjeta.mensaje, /mover el siguiente cobro de la tarjeta/);
  assert.match(cuerpo.facturaTarjeta.mensaje, /Reintentar/);
  assert.match(cuerpo.facturaTarjeta.mensaje, /ya NO vuelve a mover el ciclo/);
  assert.doesNotMatch(cuerpo.facturaTarjeta.mensaje, /trial_end|ponle|pon a la suscripción/i, "Y2: nunca le pide poner la prueba a mano");
  assert.match(cuerpo.facturaTarjeta.mensaje, /No pongas una prueba a mano en Stripe/);
  assert.equal(llamadasAnular.length, 4, "Y6: Stripe no las reintenta ni las cobra aunque el ciclo falle");
  assert.equal(facturasDeLista.filter((f) => f.status === "open").length, 0);
  const finPagado = clinica().trialEndsAt.getTime();
  assert.equal(isPlanExpired(clinica()), false, "tiene acceso");
  const { clinicasConFacturaPendienteTrasPagoManual } = await import("@/lib/billing/facturas-tarjeta-pendientes.server");
  assert.deepEqual(await clinicasConFacturaPendienteTrasPagoManual({ stripe: stripeDoble }), [], "la lista ya no inventa un «ciclo pendiente» que ningún camino puede resolver");
  stripeCicloFalla = false;
  const re = await (await llamarAdmin({ action: "marcar_factura_fuera_de_stripe", clinicId: CLINIC })).json();
  assert.equal(re.success, true);
  assert.equal(llamadasAnular.length, 4, "no se anula dos veces");
  assert.equal(llamadasCiclo.length, 0, "RECORTE: el reintento tardío no calcula ni mueve el ciclo (aunque Stripe ya conteste)");
  assert.match(re.facturaTarjeta.revisar, /La regla no se aplicó al momento del pago\. Revisa en Stripe la suscripción de BEVADENT: factura\(s\) abiertas \(ninguna\) y fin de periodo/);
  assert.match(re.facturaTarjeta.revisar, /El acceso de la clínica está protegido hasta/);
  assert.equal(clinica().trialEndsAt.getTime(), finPagado, "el acceso no se toca");
  assert.equal(correosAdmin.length, 1, "un solo correo aunque se pulse otra vez");
  await llamarAdmin({ action: "marcar_factura_fuera_de_stripe", clinicId: CLINIC });
  assert.equal(correosAdmin.length, 1);
  assert.equal(llamadasPay.length, 0);
});

test("octava · si Stripe no puede anular una factura: aviso con su texto, la activación sigue y la factura queda abierta para el reintento", async () => {
  suspendidaCuatroMeses();
  stripeAnularFalla = true;
  const cuerpo = await (await activarMeses(1)).json();
  assert.equal(cuerpo.facturaTarjeta.tipo, "fallo");
  assert.match(cuerpo.facturaTarjeta.mensaje, /No pudimos anular en Stripe las facturas de los meses sin servicio/);
  assert.equal(facturasDeLista.filter((f) => f.status === "open").length, 4);
  assert.equal(pagosDeSubscripcion.filter((p) => p.status === "void").length, 0, "lo que no se anuló no se rotula");
  stripeAnularFalla = false;
  const re = await (await llamarAdmin({ action: "marcar_factura_fuera_de_stripe", clinicId: CLINIC })).json();
  assert.equal(re.success, true);
  assert.equal(llamadasAnular.length, 4);
  assert.equal(llamadasCiclo.length, 1, "el ciclo ya estaba movido: no se repite");
});

test("M5 si el cambio de ciclo devolviera un cobro: se avisa con el id para reembolsar; si devuelve una factura ABIERTA con importe, se anula en el momento", async () => {
  suspendidaCuatroMeses();
  resetCobraLaTarjeta = true;
  const cuerpo = await (await activarMeses(1)).json();
  assert.equal(cuerpo.facturaTarjeta.tipo, "fallo");
  assert.match(cuerpo.facturaTarjeta.mensaje, /Stripe cobró la tarjeta al mover el ciclo \(factura in_trial\): reembolsa ese cobro en Stripe\./);
  assert.equal(llamadasAnular.length, 4, "lo demás se completa");
  assert.equal(clinica().subscriptionStatus, "active");
  // Abierta con importe: se anula antes de que Stripe la cobre.
  suspendidaCuatroMeses();
  ultimaFacturaDelCambio = { id: "in_abierta_x", status: "open", amount_paid: 0, amount_due: 68900, created: Math.floor(Date.now() / 1000) };
  const c2 = await (await activarMeses(1)).json();
  assert.equal(c2.facturaTarjeta.tipo, "marcadas");
  assert.ok(llamadasAnular.some((l) => l.id === "in_abierta_x"), "la factura del cambio se anula");
  // Abierta con importe y NO se puede anular: cobro inesperado reportado.
  suspendidaCuatroMeses();
  ultimaFacturaDelCambio = { id: "in_abierta_y", status: "open", amount_paid: 0, amount_due: 68900, created: Math.floor(Date.now() / 1000) };
  anularFallaPara = new Set(["in_abierta_y"]);
  const c3 = await (await activarMeses(1)).json();
  assert.equal(c3.facturaTarjeta.tipo, "fallo");
  assert.match(c3.facturaTarjeta.mensaje, /in_abierta_y/);
});

test("M3 si otra llamada idéntica (el webhook y «Pagar» a la vez) ya hizo el cambio y Stripe responde con un error de idempotencia: se relee y cuenta como hecho", async () => {
  suspendidaCuatroMeses();
  cicloLanzaDespuesDeAplicar = true;
  const cuerpo = await (await activarMeses(1)).json();
  assert.equal(cuerpo.facturaTarjeta.tipo, "marcadas", "sin aviso falso");
  assert.equal(llamadasAnular.length, 4, "y se siguió anulando");
});

test("octava · interruptor COBRO_REALINEAR_CICLO=0: las facturas suspendidas se anulan igual pero el ciclo no se toca (el ciclo viejo sigue)", async () => {
  process.env.COBRO_REALINEAR_CICLO = "0";
  try {
    suspendidaCuatroMeses();
    const cuerpo = await (await activarMeses(1)).json();
    assert.equal(cuerpo.facturaTarjeta.tipo, "marcadas");
    assert.equal(llamadasAnular.length, 4);
    assert.equal(llamadasCiclo.length, 0, "nunca se mueve el ciclo");
  } finally {
    delete process.env.COBRO_REALINEAR_CICLO;
  }
});

test("octava · cobro de TARJETA que entra solo tras la suspensión: acceso y siguiente cobro a un mes de ese pago, las otras facturas anuladas, y el correo dice la fecha buena (B4)", async () => {
  suspendidaCuatroMeses();
  facturasDeLista = [70, 40, 10].map((d, i) => facturaDeMes(MESES_SUSPENDIDOS[i + 1], d * DIA));
  facturasVivas.set(FACTURA, { id: FACTURA, status: "paid" });
  suscripcionesVivas.set(SUB, suscripcion("past_due", Date.now() + 10 * DIA));
  const pago = Date.now();
  const pagada = facturaPagada({ billing_reason: "subscription_cycle", status_transitions: { finalized_at: aSegundos(pago - 100 * DIA), paid_at: aSegundos(pago) }, lines: { data: [{ metadata: {}, period: { start: aSegundos(pago - 100 * DIA), end: aSegundos(pago - 70 * DIA) } }] } });
  assert.equal(await entregar(evento("invoice.paid", pagada, pago)), 200);
  const fin = mesesDesde(aSegundos(pago) * 1000, 1);
  assert.deepEqual(llamadasAnular.map((l) => l.id).sort(), ["in_s2", "in_s3", "in_s4"], "las otras se anulan; la cobrada no se toca");
  assert.equal(llamadasCiclo.length, 1);
  assert.ok(Math.abs(trialEndMs() - fin.getTime()) < 2000);
  assert.equal(clinica().subscriptionStatus, "active");
  assert.ok(Math.abs(clinica().trialEndsAt.getTime() - fin.getTime()) < 2000, "acceso = el momento del pago + 1 mes");
  assert.ok(Math.abs(correosRenovacion[0].nextBillingDate.getTime() - fin.getTime()) < 2000, "B4: el correo no promete una fecha ya pasada");
  // El otro evento de la misma factura no repite nada.
  assert.equal(await entregar(evento("invoice.payment_succeeded", pagada, pago)), 200);
  assert.equal(llamadasCiclo.length, 1);
  assert.equal(llamadasAnular.length, 3);
});

test("octava · cobro de tarjeta DENTRO de la gracia (reintento a las pocas horas): no hay meses suspendidos, el ciclo no se toca", async () => {
  const rechazo = Date.now() - 3 * HORA;
  await entregar(evento("invoice.payment_failed", facturaFallida(), rechazo));
  suscripcionesVivas.set(SUB, suscripcion("active", Date.now() + 30 * DIA));
  facturasVivas.set(FACTURA, { id: FACTURA, status: "paid" });
  assert.equal(await entregar(evento("invoice.paid", facturaPagada({ attempt_count: 2, status_transitions: { finalized_at: aSegundos(rechazo), paid_at: aSegundos(Date.now()) } }))), 200);
  assert.equal(llamadasCiclo.length, 0);
  assert.equal(llamadasAnular.length, 0);
  assert.equal(clinica().subscriptionStatus, "active");
});

test("octava · un aviso de cobro rechazado que llega tarde de una factura YA ANULADA no crea un adeudo: queda «No cobrada: servicio suspendido»", async () => {
  conTarjetaRechazada();
  facturasVivas.set(FACTURA, { id: FACTURA, status: "void" });
  assert.equal(await entregar(evento("invoice.payment_failed", facturaFallida())), 200);
  assert.equal(facturasRegistradas.length, 0, "no se registra como cobro fallido");
  const fila = pagosDeSubscripcion.find((p) => p.reference === FACTURA);
  assert.ok(fila);
  assert.equal(fila.status, "void");
  assert.equal(fila.notes, "No cobrada: servicio suspendido");
});

test("V1 un pago nunca se cuenta hacia atrás y hacia adelante: deuda de 3 meses + pago de 3 → ninguna factura se «paga», 3 meses de acceso y de cobro (no 6)", async () => {
  const hoy = Date.now();
  reiniciar({ subscriptionStatus: "past_due", trialEndsAt: new Date(hoy - 70 * DIA), nextBillingDate: new Date(hoy + 10 * DIA) });
  suscripcionesVivas.set(SUB, suscripcion("past_due", hoy + 10 * DIA));
  facturasDeLista = [facturaDeMes("in_a", 70 * DIA), facturaDeMes("in_b", 40 * DIA), facturaDeMes("in_c", 10 * DIA)];
  const antes = Date.now();
  await activarMeses(3);
  const fin = mesesDesde(antes, 3);
  assert.equal(llamadasPay.length, 0, "hacia atrás: ninguna factura vieja se paga con este pago");
  assert.deepEqual(llamadasAnular.map((l) => l.id).sort(), ["in_a", "in_b", "in_c"]);
  assert.ok(Math.abs(clinica().trialEndsAt.getTime() - fin.getTime()) < unMinuto, "hacia adelante: 3 meses de acceso");
  assert.ok(Math.abs(trialEndMs() - fin.getTime()) < unMinuto, "y la tarjeta vuelve a cobrar a los 3 meses, no a los 6");
  assert.equal(facturasDeLista.filter((f) => f.status === "open").length, 0);
});

test("V4 un fallo a medias nunca deja un mes PAGADO abierto: lo que no se anuló sigue como mes sin servicio, se ve en el aviso y el reintento lo termina", async () => {
  suspendidaCuatroMeses();
  anularFallaPara = new Set(["in_s3", "in_s4"]);
  const cuerpo = await (await activarMeses(1)).json();
  assert.equal(cuerpo.facturaTarjeta.tipo, "fallo");
  assert.deepEqual([...cuerpo.facturaTarjeta.anuladas].sort(), ["in_s1", "in_s2"], "lo que sí se pudo");
  assert.equal(llamadasPay.length, 0, "ninguna se «pagó» por SPEI: no hay meses pagados que Stripe pueda volver a cobrar");
  assert.deepEqual(facturasDeLista.filter((f) => f.status === "open").map((f) => f.id).sort(), ["in_s3", "in_s4"]);
  const { clinicasConFacturaPendienteTrasPagoManual } = await import("@/lib/billing/facturas-tarjeta-pendientes.server");
  const lista = await clinicasConFacturaPendienteTrasPagoManual({ stripe: stripeDoble });
  assert.deepEqual([...lista[0].suspendidas].sort(), ["in_s3", "in_s4"], "el aviso de /admin las muestra como «por anular», no como adeudo");
  anularFallaPara = new Set();
  const resumen = (await (await llamarAdmin({ action: "marcar_factura_fuera_de_stripe", clinicId: CLINIC })).json()).facturaTarjeta;
  assert.deepEqual([...resumen.anuladas].sort(), ["in_s3", "in_s4"]);
  assert.equal(facturasDeLista.filter((f) => f.status === "open").length, 0);
  assert.equal(llamadasPay.length, 0);
  assert.equal(llamadasCiclo.length, 1, "el ciclo ya estaba movido");
});

test("V7 ninguna factura vieja queda viva para que Stripe la reintente: ni con estado vencido ni con una cortesía que ya le había dado acceso", async () => {
  suspendidaCuatroMeses();
  await activarMeses(1);
  assert.equal(facturasDeLista.filter((f) => f.status === "open" || f.status === "uncollectible").length, 0);
  reiniciar({ subscriptionStatus: "past_due", trialEndsAt: new Date(Date.now() + 5 * DIA), nextBillingDate: new Date(Date.now() + 30 * DIA) });
  suscripcionesVivas.set(SUB, suscripcion("past_due", Date.now() + 30 * DIA));
  facturasDeLista = [facturaDeMes("in_v1", 70 * DIA), facturaDeMes("in_v2", 40 * DIA), facturaDeMes("in_reciente", HORA)];
  const cuerpo = await (await activarMeses(1)).json();
  assert.deepEqual([...cuerpo.facturaTarjeta.anuladas].sort(), ["in_v1", "in_v2"]);
  assert.deepEqual(cuerpo.facturaTarjeta.facturas, ["in_reciente"]);
  assert.equal(facturasDeLista.filter((f) => f.status === "open").length, 0, "no queda ninguna viva");
});

test("M8 las facturas en BORRADOR de meses sin servicio también se dejan sin cobro (se finalizan sin cobrar y se anulan; nada se borra) y la lista se pagina", async () => {
  suspendidaCuatroMeses();
  facturasDeLista.push(facturaDeMes("in_borrador", 5 * DIA, { status: "draft" }));
  const cuerpo = await (await activarMeses(1)).json();
  assert.equal(cuerpo.facturaTarjeta.tipo, "marcadas");
  assert.ok(llamadasAnular.some((l) => l.id === "in_borrador"));
  assert.ok(ordenDeLlamadas.indexOf("finalizar:in_borrador") < ordenDeLlamadas.indexOf("anular:in_borrador"), "primero se finaliza, luego se anula");
  assert.equal(facturasDeLista.filter((f) => f.status !== "void").length, 0);
  // Paginación: más de una página de facturas abiertas.
  const { facturasAbiertasDelPlan } = await import("@/lib/billing/reactivacion-tras-suspension.server");
  const paginas: Record<string, any[][]> = {
    open: [[facturaDeMes("p1", DIA), facturaDeMes("p2", DIA)], [facturaDeMes("p3", DIA)]],
    uncollectible: [[]],
    draft: [[]],
  };
  const vistas: string[] = [];
  const falso: any = {
    invoices: {
      list: async ({ status, starting_after }: any) => {
        const idx = starting_after ? 1 : 0;
        vistas.push(`${status}:${starting_after ?? "-"}`);
        const pagina = paginas[status][idx] ?? [];
        return { data: pagina, has_more: idx === 0 && paginas[status].length > 1 };
      },
    },
  };
  assert.deepEqual((await facturasAbiertasDelPlan(falso, SUB)).map((f) => f.id), ["p1", "p2", "p3"]);
  assert.ok(vistas.includes("open:p2"), "pidió la página siguiente desde la última factura");
});

test("M10 una factura de la gracia que Stripe tardó horas en finalizar (creada hace 40 h, finalizada hace 1 h) NO es un mes sin servicio: se paga, no se anula", async () => {
  conTarjetaRechazada();
  facturasDeLista = [{ ...FACTURA_ABIERTA(), created: aSegundos(Date.now() - 40 * HORA), status_transitions: { finalized_at: aSegundos(Date.now() - HORA) } }];
  const cuerpo = await (await activarMeses(1)).json();
  assert.deepEqual(cuerpo.facturaTarjeta.facturas, [FACTURA]);
  assert.equal(llamadasAnular.length, 0);
});

test("X1 «Subir de plan» con la tarjeta rechazada y pagado DÍAS después por el enlace: la factura subscription_update también aplica la regla; la de $0 del cambio de ciclo no es un pago", async () => {
  suspendidaCuatroMeses();
  facturasDeLista = [70, 40, 10].map((d, i) => facturaDeMes(MESES_SUSPENDIDOS[i + 1], d * DIA));
  facturasVivas.set("in_subida", { id: "in_subida", status: "paid" });
  suscripcionesVivas.set(SUB, suscripcion("active", Date.now() + 27 * DIA));
  const pago = Date.now();
  const subida = facturaPagada({ id: "in_subida", billing_reason: "subscription_update", amount_paid: 79924, status_transitions: { finalized_at: aSegundos(pago - 3 * DIA), paid_at: aSegundos(pago) }, lines: { data: [{ metadata: {}, period: { start: aSegundos(pago - 3 * DIA), end: aSegundos(pago + 27 * DIA) } }] } });
  assert.equal(await entregar(evento("invoice.paid", subida, pago)), 200);
  assert.deepEqual(llamadasAnular.map((l) => l.id).sort(), ["in_s2", "in_s3", "in_s4"]);
  assert.equal(llamadasCiclo.length, 1);
  assert.ok(Math.abs(trialEndMs() - mesesDesde(aSegundos(pago) * 1000, 1).getTime()) < 2000, "un mes desde ESTE pago, no 27 días desde el clic");
  assert.equal(clinica().subscriptionStatus, "active");
  // La factura de $0 que genera mover el ciclo: ni regla, ni fila de cobro, ni ingreso.
  const antes = { ciclos: llamadasCiclo.length, registradas: facturasRegistradas.length };
  const cero = facturaPagada({ id: "in_cero", billing_reason: "subscription_update", amount_paid: 0 });
  facturasVivas.set("in_cero", { id: "in_cero", status: "paid" });
  assert.equal(await entregar(evento("invoice.paid", cero)), 200);
  assert.equal(llamadasCiclo.length, antes.ciclos);
  assert.equal(facturasRegistradas.length, antes.registradas, "no se registra como cobro");
});

test("X3 orden invertido: el `customer.subscription.updated` (active, con el ciclo viejo) llega ANTES que el `invoice.paid` → la regla se aplica igual", async () => {
  suspendidaCuatroMeses();
  facturasDeLista = [70, 40, 10].map((d, i) => facturaDeMes(MESES_SUSPENDIDOS[i + 1], d * DIA));
  facturasVivas.set(FACTURA, { id: FACTURA, status: "paid" });
  suscripcionesVivas.set(SUB, suscripcion("active", Date.now() + 25 * DIA));
  // 1) llega el `updated`: deja a la clínica active con el ciclo viejo (+25 d).
  assert.equal(await entregar(evento("customer.subscription.updated", suscripcionesVivas.get(SUB))), 200);
  assert.equal(clinica().subscriptionStatus, "active");
  assert.equal(isPlanExpired(clinica()), false);
  // 2) llega el `invoice.paid` de «Pagar mi plan» (la factura más reciente, finalizada hace 1 h, que no entró a la primera).
  const pago = Date.now();
  const pagada = facturaPagada({ attempt_count: 2, billing_reason: "subscription_cycle", status_transitions: { finalized_at: aSegundos(pago - HORA), paid_at: aSegundos(pago) } });
  assert.equal(await entregar(evento("invoice.paid", pagada, pago)), 200);
  const fin = mesesDesde(aSegundos(pago) * 1000, 1);
  assert.deepEqual(llamadasAnular.map((l) => l.id).sort(), ["in_s2", "in_s3", "in_s4"], "las otras facturas se anularon");
  assert.equal(llamadasCiclo.length, 1, "el ciclo se movió");
  assert.ok(Math.abs(clinica().trialEndsAt.getTime() - fin.getTime()) < 2000, "acceso = pago + 1 mes (no los 25 días del ciclo viejo)");
});

test("X4/Z2 si mover el ciclo falla DENTRO del webhook: 5xx (Stripe reenvía), la clínica que PAGÓ queda activa con el acceso de lo pagado, el admin recibe UN aviso, y el reenvío lo completa", async () => {
  suspendidaCuatroMeses();
  facturasDeLista = [70, 40, 10].map((d, i) => facturaDeMes(MESES_SUSPENDIDOS[i + 1], d * DIA));
  facturasVivas.set(FACTURA, { id: FACTURA, status: "paid" });
  suscripcionesVivas.set(SUB, suscripcion("past_due", Date.now() + 10 * DIA));
  const pago = Date.now();
  const pagada = facturaPagada({ billing_reason: "subscription_cycle", status_transitions: { finalized_at: aSegundos(pago - 100 * DIA), paid_at: aSegundos(pago) } });
  stripeCicloFalla = true;
  assert.equal(await entregar(evento("invoice.paid", pagada, pago)), 500, "5xx: Stripe reenvía el evento");
  // Z2: pagó → se reactiva igual con el acceso de lo pagado (un mes desde el pago); lo pendiente queda para el reintento.
  assert.equal(clinica().subscriptionStatus, "active", "Z2: la clínica que pagó no se queda sin servicio");
  assert.equal(isPlanExpired(clinica()), false);
  assert.ok(Math.abs(clinica().trialEndsAt.getTime() - mesesDesde(aSegundos(pago) * 1000, 1).getTime()) < 2000, "con el acceso de lo pagado");
  assert.ok(logsCorreo.some((l) => l.invoiceId === `${FACTURA}:regla_fallo`), "y el pendiente queda visible para el reintento");
  assert.equal(llamadasAnular.length, 3, "Y6: los meses sin servicio se anulan aunque el ciclo falle");
  assert.equal(facturasDeLista.filter((f) => f.status === "open").length, 0, "ninguna queda cobrable");
  assert.match(correosAdmin[0].text, /No pongas una prueba \(trial_end\) a mano en Stripe/, "Y2");
  assert.equal(correosAdmin.length, 1, "el admin se entera");
  assert.match(correosAdmin[0].subject, /Revisa una clínica reactivada tras suspensión/);
  assert.equal(await entregar(evento("invoice.paid", pagada, pago)), 500, "el rastro de la regla a medias hace que el reenvío la repita aunque ya no queden facturas abiertas");
  assert.equal(correosAdmin.length, 1, "pero no un correo por cada reenvío");
  // Stripe se recupera: el reenvío completa todo.
  stripeCicloFalla = false;
  assert.equal(await entregar(evento("invoice.paid", pagada, pago)), 200);
  assert.equal(clinica().subscriptionStatus, "active");
  assert.equal(llamadasCiclo.length, 1);
  assert.deepEqual(llamadasAnular.map((l) => l.id).sort(), ["in_s2", "in_s3", "in_s4"], "no se anuló dos veces");
  assert.ok(logsCorreo.some((l) => l.invoiceId === `${FACTURA}:regla_ok`), "queda el rastro de que se completó");
  // Un último reenvío ya no hace nada.
  assert.equal(await entregar(evento("invoice.payment_succeeded", pagada, pago)), 200);
  assert.equal(llamadasCiclo.length, 1);
  assert.equal(llamadasAnular.length, 3);
});

test("X4 también si falla a medias al anular: 5xx y el reenvío anula lo que falta", async () => {
  suspendidaCuatroMeses();
  facturasDeLista = [70, 40, 10].map((d, i) => facturaDeMes(MESES_SUSPENDIDOS[i + 1], d * DIA));
  facturasVivas.set(FACTURA, { id: FACTURA, status: "paid" });
  suscripcionesVivas.set(SUB, suscripcion("past_due", Date.now() + 10 * DIA));
  const pago = Date.now();
  const pagada = facturaPagada({ billing_reason: "subscription_cycle", status_transitions: { finalized_at: aSegundos(pago - 100 * DIA), paid_at: aSegundos(pago) } });
  anularFallaPara = new Set(["in_s4"]);
  assert.equal(await entregar(evento("invoice.paid", pagada, pago)), 500);
  assert.equal(clinica().subscriptionStatus, "active", "Z2: pagó, tiene acceso mientras se completa lo que falta");
  anularFallaPara = new Set();
  assert.equal(await entregar(evento("invoice.paid", pagada, pago)), 200);
  assert.equal(facturasDeLista.filter((f) => f.status === "open").length, 0);
  assert.equal(llamadasCiclo.length, 1, "el ciclo ya estaba movido");
  assert.equal(clinica().subscriptionStatus, "active");
});

test("X5 pagó con tarjeta y Stripe deja la suscripción en past_due/unpaid: la clínica queda ACTIVA con su acceso, y el admin recibe el aviso", async () => {
  for (const estadoStripe of ["past_due", "unpaid"]) {
    process.env.COBRO_REALINEAR_CICLO = "0"; // el ciclo no cambia: Stripe sigue reportando lo que tenía
    try {
      suspendidaCuatroMeses();
      facturasDeLista = [70, 40, 10].map((d, i) => facturaDeMes(MESES_SUSPENDIDOS[i + 1], d * DIA));
      facturasVivas.set(FACTURA, { id: FACTURA, status: "paid" });
      suscripcionesVivas.set(SUB, suscripcion(estadoStripe, Date.now() + 10 * DIA));
      const pago = Date.now();
      const pagada = facturaPagada({ billing_reason: "subscription_cycle", status_transitions: { finalized_at: aSegundos(pago - 100 * DIA), paid_at: aSegundos(pago) } });
      assert.equal(await entregar(evento("invoice.paid", pagada, pago)), 200);
      assert.equal(clinica().subscriptionStatus, "active", `${estadoStripe}: el pago firmado basta`);
      assert.ok(Math.abs(clinica().trialEndsAt.getTime() - mesesDesde(aSegundos(pago) * 1000, 1).getTime()) < 2000, "con el acceso del pago + 1 mes");
      assert.equal(isPlanExpired(clinica()), false);
      assert.ok(correosAdmin.some((c) => /sigue en cobro rechazado en Stripe/.test(c.subject)), "el admin se entera de que Stripe no la pasó a activa");
    } finally {
      delete process.env.COBRO_REALINEAR_CICLO;
    }
  }
});

test("X6 «Registrar pago»: el acceso es pago + N meses desde el registro, NO el mes de calendario que escriba el admin; la fila guarda el periodo real; y un doble clic no lo duplica (B7)", async () => {
  suspendidaCuatroMeses();
  const hoy = new Date();
  const mesPasado = { ini: new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1), fin: new Date(hoy.getFullYear(), hoy.getMonth(), 0, 23, 59, 59) };
  const registrar = () =>
    POSTSubs(new NextRequestCtor("http://localhost/api/admin/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clinicId: CLINIC, amount: 689, method: "transfer", reference: "SPEI-77", periodStart: mesPasado.ini.toISOString(), periodEnd: mesPasado.fin.toISOString(), status: "paid" }),
    }));
  const antes = Date.now();
  const r = await registrar();
  assert.equal(r.status, 201);
  const cuerpo = await r.json();
  const fin = mesesDesde(antes, 1);
  assert.ok(Math.abs(clinica().trialEndsAt.getTime() - fin.getTime()) < unMinuto, "acceso = registro + 1 mes (no el fin del mes pasado, que ya venció)");
  assert.equal(isPlanExpired(clinica()), false);
  assert.ok(Math.abs(new Date(cuerpo.periodEnd).getTime() - fin.getTime()) < unMinuto, "la fila guarda el periodo REAL");
  assert.equal(llamadasAnular.length, 4);
  assert.equal(llamadasCiclo.length, 1);
  assert.ok(Math.abs(trialEndMs() - clinica().trialEndsAt.getTime()) < 1500);
  // Doble clic: la misma referencia en menos de 2 minutos no crea otra fila pagada (el ingreso no se cuenta dos veces).
  const otra = await registrar();
  assert.equal(otra.status, 200);
  assert.equal((await otra.json()).duplicado, true);
  assert.equal(pagosDeSubscripcion.filter((p) => p.reference === "SPEI-77").length, 1);
  assert.equal(llamadasCiclo.length, 1);
});

test("X7 suscripción ANUAL suspendida que paga el año: el ciclo se mueve igual (trial_end no depende del intervalo) y las facturas se anulan", async () => {
  suspendidaCuatroMeses();
  const anual: any = suscripcion("past_due", Date.now() + 8 * 30 * DIA);
  anual.items.data[0].price = { recurring: { interval: "year" } };
  suscripcionesVivas.set(SUB, anual);
  const antes = Date.now();
  await activarMeses(12);
  const fin = mesesDesde(antes, 12);
  assert.equal(llamadasCiclo.length, 1, "antes: no_aplica con un intervalo anual");
  assert.ok(Math.abs(trialEndMs() - fin.getTime()) < unMinuto, "el aniversario nuevo = fin de lo pagado");
  assert.equal(llamadasAnular.length, 4);
  assert.equal(llamadasPay.length, 0);
});

test("M1 clínica AL CORRIENTE que prepaga 3 meses: se cuenta desde el fin de lo que ya tenía pagado (se suman, no se pierden ni se cobran dos veces)", async () => {
  reiniciar({ subscriptionStatus: "active", trialEndsAt: new Date(Date.now() + 20 * DIA), nextBillingDate: new Date(Date.now() + 20 * DIA) });
  suscripcionesVivas.set(SUB, suscripcion("active", Date.now() + 20 * DIA));
  facturasDeLista = [];
  const base = Date.now() + 20 * DIA;
  await activarMeses(3);
  const fin = mesesDesde(base, 3);
  assert.ok(Math.abs(clinica().trialEndsAt.getTime() - fin.getTime()) < unMinuto, "20 días que ya tenía + 3 meses");
  assert.equal(llamadasCiclo.length, 1);
  assert.ok(Math.abs(trialEndMs() - fin.getTime()) < unMinuto, "y el cobro cae justo ahí");
});

test("V6 un pago de 1 mes hecho TARDE (14, 20 y 25 días después de la factura rechazada): un mes exacto desde el pago, sin regalar un mes ni cobrar días dos veces", async () => {
  for (const dias of [14, 20, 25]) {
    const hoy = Date.now();
    const creada = hoy - dias * DIA;
    reiniciar({ subscriptionStatus: "past_due", trialEndsAt: new Date(creada + DIA), nextBillingDate: new Date(creada + 30 * DIA) });
    suscripcionesVivas.set(SUB, suscripcion("past_due", creada + 30 * DIA));
    facturasDeLista = [{ id: `in_tarde${dias}`, status: "open", subscription: SUB, billing_reason: "subscription_cycle", created: aSegundos(creada), status_transitions: { finalized_at: aSegundos(creada) } }];
    const antes = Date.now();
    await activarMeses(1);
    const fin = mesesDesde(antes, 1);
    assert.equal(llamadasPay.length, 0, `${dias} d: la factura de un mes sin servicio no se cobra`);
    assert.equal(llamadasAnular.length, 1);
    assert.ok(Math.abs(clinica().trialEndsAt.getTime() - fin.getTime()) < unMinuto, `${dias} d: acceso = pago + 1 mes`);
    assert.equal(llamadasCiclo.length, 1);
    assert.ok(Math.abs(trialEndMs() - fin.getTime()) < unMinuto, `${dias} d: el siguiente cobro cae justo al terminar, no 14–25 días después de la factura vieja`);
  }
  conTarjetaRechazada();
  await activarMeses(1);
  assert.equal(llamadasCiclo.length, 0, "al corriente, 1 mes: el ciclo sigue igual");
});

test("V3 el excedente de CFDI: con una pausa VIGENTE en Stripe va como adeudo manual; con una pausa vencida (B5) o en un periodo pagado a mano va a la próxima factura", async () => {
  const { resolveOverageBilling } = await import("@/lib/cfdi-overage");
  const fila = { stripeSubscriptionId: SUB, stripeCustomerId: CUS, stripePaymentMethodId: "pm_1" };
  const conItem = (extra: Record<string, unknown>) => ({
    ...suscripcion("active", Date.now() + 30 * DIA),
    items: { data: [{ current_period_end: aSegundos(Date.now() + 30 * DIA), price: { recurring: { interval: "month" } } }] },
    ...extra,
  });
  suscripcionesVivas.set(SUB, conItem({}));
  assert.equal((await resolveOverageBilling(fila)).mode, "monthly_sub", "sin pausa: como siempre, a la próxima mensualidad");
  suscripcionesVivas.set(SUB, conItem({ pause_collection: { behavior: "void", resumes_at: aSegundos(Date.now() + 60 * DIA) } }));
  assert.equal((await resolveOverageBilling(fila)).mode, "manual", "pausa vigente: adeudo manual cfdi_overage");
  suscripcionesVivas.set(SUB, conItem({ pause_collection: { behavior: "void", resumes_at: aSegundos(Date.now() - DIA) } }));
  assert.equal((await resolveOverageBilling(fila)).mode, "monthly_sub", "B5: una pausa vencida no cuenta");
  suscripcionesVivas.set(SUB, conItem({ status: "trialing", trial_end: aSegundos(Date.now() + 60 * DIA), metadata: { periodo_pagado_hasta: new Date(Date.now() + 60 * DIA).toISOString() } }));
  assert.equal((await resolveOverageBilling(fila)).mode, "monthly_sub", "periodo pagado a mano: el item se suma a la factura que Stripe emite al terminar");
});

test("V3/M6 el excedente que ya estaba sumado a «la próxima mensualidad» pasa a su propia factura ANTES de mover el ciclo, con la tarjeta de la suscripción; si hay items de otra suscripción se falla cerrado", async () => {
  suspendidaCuatroMeses();
  suscripcionesVivas.get(SUB).default_payment_method = "pm_de_la_suscripcion";
  itemsPendientes = [{ id: "ii_excedente", subscription: null, metadata: { kind: "cfdi-overage" } }];
  await activarMeses(1);
  assert.equal(facturasAparte.length, 1);
  assert.equal(facturasAparte[0].params.pending_invoice_items_behavior, "include");
  assert.equal(facturasAparte[0].params.collection_method, "charge_automatically");
  assert.equal(facturasAparte[0].params.default_payment_method, "pm_de_la_suscripcion", "M6: se cobra sola con la tarjeta de la suscripción");
  assert.equal(facturasAparte[0].params.metadata.kind, "cfdi-overage-aparte");
  assert.equal(facturasAparte[0].opciones.idempotencyKey, `excedente-aparte:${CUS}:ii_excedente`);
  assert.ok(ordenDeLlamadas.indexOf("aparte") < ordenDeLlamadas.indexOf("ciclo"), "primero se separa, luego se mueve el ciclo");
  suspendidaCuatroMeses();
  await activarMeses(1);
  assert.equal(facturasAparte.length, 0, "sin items pendientes no se crea ninguna factura aparte");
  // M6: un item de OTRA suscripción (un módulo) haría que `include` lo cobrara también: se falla cerrado, sin tocar nada.
  suspendidaCuatroMeses();
  itemsPendientes = [{ id: "ii_excedente", subscription: null }, { id: "ii_de_un_modulo", subscription: "sub_modulo" }];
  const mixto = await (await activarMeses(1)).json();
  assert.equal(mixto.facturaTarjeta.tipo, "fallo");
  assert.match(mixto.facturaTarjeta.mensaje, /otra suscripción del cliente \(un módulo\)/, "Z14: dice por qué y que reintentar no sirve");
  assert.match(mixto.facturaTarjeta.mensaje, /Reintentar no sirve/);
  assert.equal(facturasAparte.length, 0);
  assert.equal(llamadasCiclo.length, 0);
  suspendidaCuatroMeses();
  itemsPendientes = [{ id: "ii_x", subscription: null }];
  aparteFalla = true;
  const cuerpo = await (await activarMeses(1)).json();
  assert.equal(cuerpo.facturaTarjeta.tipo, "fallo");
  assert.match(cuerpo.facturaTarjeta.mensaje, /separar el excedente de facturas CFDI/);
  assert.equal(llamadasCiclo.length, 0, "si no se puede separar, NO se mueve el ciclo");
  assert.equal(llamadasAnular.length, 4, "pero las facturas sin servicio se anulan igual (Y6)");
});

test("V5 «Verificar pago» da el acceso del PERIODO de la fila (3 meses, o su duración si se verifica tarde) y aplica Q1; un doble clic no reescribe nada (B7)", async () => {
  const verificar = (id: string) => llamarAdmin({ action: "verify_payment", invoiceId: id });
  conTarjetaRechazada();
  const hoy = Date.now();
  const tresMeses = new Date(hoy);
  tresMeses.setMonth(tresMeses.getMonth() + 3);
  pagosDeSubscripcion = [{ id: "inv_p3", clinicId: CLINIC, status: "pending", method: "transfer", amount: 2067, periodStart: new Date(hoy), periodEnd: tresMeses }];
  suscripcionesVivas.set(SUB, suscripcion("past_due", hoy + 30 * DIA));
  const cuerpo = await (await verificar("inv_p3")).json();
  assert.equal(cuerpo.success, true);
  // En gracia: el acceso cuenta desde el fin de la gracia (trialEndsAt = hoy + 20 h) sobre lo ya cubierto.
  // En gracia (Y14) el periodo pagado empieza en el rechazo (acceso − 24 h): 3 meses desde ahí, no 3 meses y 26 horas.
  assert.ok(Math.abs(clinica().trialEndsAt.getTime() - mesesDesde(hoy - 4 * HORA, 3).getTime()) < 2 * unMinuto, "acceso = 3 meses");
  assert.deepEqual(cuerpo.facturaTarjeta.facturas, [FACTURA]);
  assert.equal(llamadasCiclo.length, 1, "Q1: el siguiente cobro se mueve al fin de lo pagado");
  assert.ok(Math.abs(trialEndMs() - clinica().trialEndsAt.getTime()) < 1500);
  assert.ok(Math.abs(pagosDeSubscripcion[0].periodEnd.getTime() - clinica().trialEndsAt.getTime()) < 1500, "la fila guarda el periodo real");
  const paidAt = pagosDeSubscripcion[0].paidAt;
  const segundo = await verificar("inv_p3");
  assert.equal(segundo.status, 409, "B7: ya estaba verificado");
  assert.equal(pagosDeSubscripcion[0].paidAt, paidAt, "no reescribe paidAt (movería el corte del reintento)");
  assert.equal(llamadasCiclo.length, 1);
  // Fila de 1 mes con periodo ya pasado (se verifica tarde): 1 mes desde hoy, nunca una fecha vencida.
  conTarjetaRechazada();
  pagosDeSubscripcion = [{ id: "inv_p1", clinicId: CLINIC, status: "pending", method: "transfer", amount: 689, periodStart: new Date(hoy - 200 * DIA), periodEnd: new Date(hoy - 170 * DIA) }];
  await verificar("inv_p1");
  assert.ok(clinica().trialEndsAt.getTime() > hoy + 25 * DIA);
  assert.equal(llamadasCiclo.length, 0, "1 mes: el ciclo ya coincide");
});

/* ── Undécima vuelta (duodécima de t4): Y1–Y16 ─────────────────────────────────────────────────────────────────────────── */

test("Y1 plan ANUAL suspendido que paga el año con tarjeta: acceso y cobro a UN AÑO del pago (nunca doble anualidad) y el correo dice la fecha verdadera; igual con un plan trimestral", async () => {
  for (const [intervalo, cuenta, meses] of [["year", 1, 12], ["month", 3, 3]] as const) {
    suspendidaCuatroMeses();
    facturasDeLista = [70, 40, 10].map((d, i) => facturaDeMes(MESES_SUSPENDIDOS[i + 1], d * DIA));
    facturasVivas.set(FACTURA, { id: FACTURA, status: "paid" });
    const viva: any = suscripcion("past_due", Date.now() + (meses > 3 ? 8 * 30 : 20) * DIA);
    viva.items.data[0].price = { recurring: { interval: intervalo, interval_count: cuenta } };
    suscripcionesVivas.set(SUB, viva);
    const pago = Date.now();
    const pagada = facturaPagada({ billing_reason: "subscription_cycle", amount_paid: 537600, status_transitions: { finalized_at: aSegundos(pago - 100 * DIA), paid_at: aSegundos(pago) } });
    assert.equal(await entregar(evento("invoice.paid", pagada, pago)), 200);
    const fin = mesesDesde(aSegundos(pago) * 1000, meses);
    assert.equal(llamadasCiclo.length, 1, `${intervalo}/${cuenta}`);
    assert.ok(Math.abs(trialEndMs() - fin.getTime()) < 2000, `${intervalo}/${cuenta}: el siguiente cobro es ${meses} meses después del pago, no 1`);
    assert.ok(Math.abs(clinica().trialEndsAt.getTime() - fin.getTime()) < 2000);
    assert.ok(Math.abs(correosRenovacion[0].nextBillingDate.getTime() - fin.getTime()) < 2000, "el correo promete la fecha verdadera");
  }
});

test("Y1 «Pagar mi plan» (t2) llama a aplicarReglaDeSuspension con UN mes: en una suscripción anual el helper lo sube a un periodo completo del plan", async () => {
  const { aplicarReglaDeSuspension } = await import("@/lib/billing/reactivacion-tras-suspension.server");
  const viva: any = suscripcion("past_due", Date.now() + 8 * 30 * DIA);
  viva.items.data[0].price = { recurring: { interval: "year" } };
  suscripcionesVivas.set(SUB, viva);
  const pagadoEn = new Date();
  const r = await aplicarReglaDeSuspension({ stripe: stripeDoble, clinicId: CLINIC, sub: viva, pagadoEn, finDeLoPagado: mesesDesde(pagadoEn.getTime(), 1), facturas: [] });
  assert.equal(r.realineo.tipo, "hecho");
  assert.ok(Math.abs(trialEndMs() - mesesDesde(pagadoEn.getTime(), 12).getTime()) < 2000);
  assert.ok(Math.abs(r.finDeLoPagado.getTime() - mesesDesde(pagadoEn.getTime(), 12).getTime()) < 2000);
});

test("Y3 la `latest_invoice` que devuelve el cambio es la MISMA de antes (el mes recién pagado): no es un cobro inesperado ni pide reembolsar nada", async () => {
  suspendidaCuatroMeses();
  suscripcionesVivas.get(SUB).latest_invoice = "in_recien_pagada";
  ultimaFacturaDelCambio = { id: "in_recien_pagada", status: "paid", amount_paid: 68900, amount_due: 68900, created: Math.floor(Date.now() / 1000) };
  const cuerpo = await (await activarMeses(1)).json();
  assert.equal(cuerpo.facturaTarjeta.tipo, "marcadas", "sin aviso falso de «reembolsa»");
  assert.equal(llamadasAnular.length, 4);
  // En cambio, una factura NUEVA con cobro sí se reporta.
  suspendidaCuatroMeses();
  suscripcionesVivas.get(SUB).latest_invoice = "in_recien_pagada";
  ultimaFacturaDelCambio = { id: "in_otra_nueva", status: "paid", amount_paid: 68900, amount_due: 68900, created: Math.floor(Date.now() / 1000) };
  const c2 = await (await activarMeses(1)).json();
  assert.equal(c2.facturaTarjeta.tipo, "fallo");
  assert.match(c2.facturaTarjeta.mensaje, /in_otra_nueva/);
});

test("Y4 suspendida que paga a 1 día del inicio del ciclo de Stripe: el ciclo se mueve igual (sin tolerancia), no se cobran días dos veces", async () => {
  const hoy = Date.now();
  reiniciar({ subscriptionStatus: "past_due", trialEndsAt: new Date(hoy - HORA), nextBillingDate: new Date(hoy + 29 * DIA) });
  suscripcionesVivas.set(SUB, suscripcion("past_due", hoy + 29 * DIA));
  facturasDeLista = [facturaDeMes("in_reciente", 25 * HORA)];
  await activarMeses(1);
  assert.equal(llamadasCiclo.length, 1, "antes: no_aplica por la tolerancia de 3 días");
  assert.ok(Math.abs(trialEndMs() - clinica().trialEndsAt.getTime()) < 1500);
  assert.deepEqual(llamadasAnular.map((l) => l.id), ["in_reciente"]);
});

test("Y5 «Activar clínica» es idempotente: un segundo clic en menos de 2 minutos responde 409 y no suma otro periodo; una activación a propósito después sí", async () => {
  suspendidaCuatroMeses();
  const r1 = await activarMeses(1);
  assert.equal(r1.status, 200);
  const acceso = clinica().trialEndsAt.getTime();
  const r2 = await activarMeses(1);
  assert.equal(r2.status, 409);
  assert.equal(clinica().trialEndsAt.getTime(), acceso, "no se sumó otro mes");
  assert.equal(pagosDeSubscripcion.filter((p) => p.method === "admin").length, 1, "una sola fila");
  envejecerActivaciones();
  assert.equal((await activarMeses(1)).status, 200);
  assert.ok(clinica().trialEndsAt.getTime() > acceso + 20 * DIA, "ahora sí suma");
});

test("Y7 la factura APARTE del excedente de CFDI cuenta como dinero (se registra) pero no como cobro del plan: sin correo de renovación, sin comisión de afiliado ni numeración de plan", async () => {
  conTarjetaRechazada();
  Object.assign(clinica(), { subscriptionStatus: "active", affiliateId: "aff_1", affiliate: { commissionPct: 10, status: "APPROVED", payoutMode: "percent" } });
  facturasVivas.set("in_aparte", { id: "in_aparte", status: "paid" });
  const aparte = facturaPagada({ id: "in_aparte", billing_reason: "manual", amount_paid: 3000, metadata: { kind: "cfdi-overage-aparte" }, parent: null, subscription: null });
  assert.equal(await entregar(evento("invoice.paid", aparte)), 200, "corta antes del bloque de afiliados (que reventaría con este doble)");
  assert.equal(facturasRegistradas.length, 1, "el dinero queda registrado");
  assert.equal(correosRenovacion.length, 0);
});

test("Y8 un `customer.subscription.updated` en `unpaid` DESPUÉS de pagar no baja a la clínica; si ya estaba en cobro rechazado, sí pasa", async () => {
  conTarjetaRechazada();
  clinica().subscriptionStatus = "active";
  clinica().trialEndsAt = new Date(Date.now() + 30 * DIA);
  const unpaid = suscripcion("unpaid", Date.now() + 30 * DIA);
  suscripcionesVivas.set(SUB, unpaid);
  assert.equal(await entregar(evento("customer.subscription.updated", unpaid)), 200);
  assert.equal(clinica().subscriptionStatus, "active", "acaba de pagar: Stripe todavía la ve unpaid por facturas anuladas");
  clinica().subscriptionStatus = "past_due";
  assert.equal(await entregar(evento("customer.subscription.updated", unpaid)), 200);
  assert.equal(clinica().subscriptionStatus, "unpaid", "retries agotados estando ya en cobro rechazado: sí");
});

test("Y10 una clínica AL CORRIENTE que paga tarde una factura de cambio de plan (subscription_update finalizada hace 3 días) NO dispara la regla de la suspensión (no se le regalan días)", async () => {
  reiniciar({ subscriptionStatus: "active", trialEndsAt: new Date(Date.now() + 20 * DIA), nextBillingDate: new Date(Date.now() + 20 * DIA) });
  suscripcionesVivas.set(SUB, suscripcion("active", Date.now() + 20 * DIA));
  facturasDeLista = [];
  facturasVivas.set("in_cambio", { id: "in_cambio", status: "paid" });
  const pago = Date.now();
  const cambio = facturaPagada({ id: "in_cambio", billing_reason: "subscription_update", amount_paid: 40000, status_transitions: { finalized_at: aSegundos(pago - 3 * DIA), paid_at: aSegundos(pago) } });
  assert.equal(await entregar(evento("invoice.paid", cambio, pago)), 200);
  assert.equal(llamadasCiclo.length, 0);
  assert.equal(llamadasAnular.length, 0);
  assert.ok(Math.abs(clinica().trialEndsAt.getTime() - (Date.now() + 20 * DIA)) < 2 * unMinuto, "su acceso no se tocó");
});

test("Y13 una factura de $0 que Stripe etiqueta `subscription_cycle` mientras la suscripción está en un periodo pagado a mano NO se registra ni manda correo; una de $0 de un cupón al 100% sin periodo pagado sí", async () => {
  conTarjetaRechazada();
  clinica().subscriptionStatus = "active";
  const viva: any = suscripcion("trialing", Date.now() + 30 * DIA);
  viva.trial_end = aSegundos(Date.now() + 30 * DIA);
  viva.metadata.periodo_pagado_hasta = new Date(viva.trial_end * 1000).toISOString();
  suscripcionesVivas.set(SUB, viva);
  facturasVivas.set("in_cero2", { id: "in_cero2", status: "paid" });
  const cero = facturaPagada({ id: "in_cero2", billing_reason: "subscription_cycle", amount_paid: 0 });
  assert.equal(await entregar(evento("invoice.paid", cero)), 200);
  assert.equal(facturasRegistradas.length, 0);
  assert.equal(correosRenovacion.length, 0);
  // Control: sin periodo pagado, un $0 de cupón sí se registra como siempre.
  suscripcionesVivas.set(SUB, suscripcion("active", Date.now() + 30 * DIA));
  facturasVivas.set("in_cero3", { id: "in_cero3", status: "paid" });
  assert.equal(await entregar(evento("invoice.paid", facturaPagada({ id: "in_cero3", billing_reason: "subscription_cycle", amount_paid: 0 }))), 200);
  assert.equal(facturasRegistradas.length, 1);
});

test("Y14 pagar DENTRO de la gracia: el periodo cuenta desde el rechazo (no 24 h después); 1 mes = el fin de la factura rechazada y el ciclo no se mueve; 2 meses = un periodo más", async () => {
  conTarjetaRechazada(); // acceso = hoy + 20 h → el rechazo fue hace 4 h
  const rechazo = Date.now() - 4 * HORA;
  await activarMeses(1);
  assert.ok(Math.abs(clinica().trialEndsAt.getTime() - mesesDesde(rechazo, 1).getTime()) < 2 * unMinuto, "sin ~26 h de regalo");
  assert.equal(llamadasCiclo.length, 0, "el ciclo coincide con lo pagado: no se mueve");
  conTarjetaRechazada();
  await activarMeses(2);
  assert.ok(Math.abs(clinica().trialEndsAt.getTime() - mesesDesde(rechazo, 2).getTime()) < 2 * unMinuto);
  assert.equal(llamadasCiclo.length, 1);
  assert.ok(Math.abs(trialEndMs() - clinica().trialEndsAt.getTime()) < 1500);
});

test("Y15 con COBRO_REALINEAR_CICLO=0 el pago lo dice (ciclo «apagado»), «Reintentar» no canta victoria y la lista no lo da por pendiente para siempre", async () => {
  process.env.COBRO_REALINEAR_CICLO = "0";
  try {
    suspendidaCuatroMeses();
    const cuerpo = await (await activarMeses(1)).json();
    assert.deepEqual(cuerpo.facturaTarjeta.ciclo, { tipo: "apagado" });
    const re = await (await llamarAdmin({ action: "marcar_factura_fuera_de_stripe", clinicId: CLINIC })).json();
    assert.equal(re.facturaTarjeta.ciclo, undefined, "el reintento tardío no toca el ciclo, esté o no apagado el ajuste");
    const { clinicasConFacturaPendienteTrasPagoManual } = await import("@/lib/billing/facturas-tarjeta-pendientes.server");
    assert.deepEqual(await clinicasConFacturaPendienteTrasPagoManual({ stripe: stripeDoble }), []);
  } finally {
    delete process.env.COBRO_REALINEAR_CICLO;
  }
});

test("Y16/Z4 «Registrar pago» SIN referencia: un doble clic pide CONFIRMACIÓN explícita (no se descarta a ciegas); con referencias distintas son dos pagos; con la misma es el mismo. «Verificar pago» cuyo alta falla deja la fila como estaba", async () => {
  suspendidaCuatroMeses();
  const hoy = new Date();
  const registrar = (extra: Record<string, unknown> = {}) =>
    POSTSubs(new NextRequestCtor("http://localhost/api/admin/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clinicId: CLINIC, amount: 689, method: "cash", periodStart: hoy.toISOString(), periodEnd: mesesDesde(hoy.getTime(), 1).toISOString(), status: "paid", ...extra }),
    }));
  assert.equal((await registrar()).status, 201);
  const segundo = await registrar();
  assert.equal(segundo.status, 409, "sin referencia: no se registra ni se descarta a ciegas");
  const cuerpo409 = (await segundo.json()) as any;
  assert.equal(cuerpo409.code, "POSIBLE_DUPLICADO");
  assert.equal(pagosDeSubscripcion.filter((p) => p.method === "cash").length, 1);
  // Confirmado a propósito (es otro pago real): se registra.
  assert.equal((await registrar({ confirmarDuplicado: true })).status, 201);
  assert.equal(pagosDeSubscripcion.filter((p) => p.method === "cash").length, 2);
  // Verificar: la activación falla → la fila vuelve a «pending» y el siguiente intento funciona.
  conTarjetaRechazada();
  pagosDeSubscripcion = [{ id: "inv_v", clinicId: CLINIC, status: "pending", method: "transfer", amount: 689, periodStart: new Date(), periodEnd: mesesDesde(Date.now(), 1) }];
  const original = (prismaBase as any).clinic.update;
  (prismaBase as any).clinic.update = async () => { throw new Error("la base se cayó"); };
  try {
    const caido = await llamarAdmin({ action: "verify_payment", invoiceId: "inv_v" });
    assert.equal(caido.status, 500);
  } finally {
    (prismaBase as any).clinic.update = original;
  }
  assert.equal(pagosDeSubscripcion[0].status, "pending", "la fila volvió a como estaba");
  assert.equal((await llamarAdmin({ action: "verify_payment", invoiceId: "inv_v" })).status, 200);
});

test("Y9 la pestaña Suscripción deshabilita el cambio de plan con el texto verdadero DESDE el principio, y el diálogo de usuarios muestra el texto del servidor", async () => {
  const { readFileSync } = await import("node:fs");
  const tab = readFileSync(path.join(RAIZ, "src/components/dashboard/subscription-tab.tsx"), "utf8");
  assert.match(tab, /cobroPausado\?: boolean/);
  assert.match(tab, /\{billingCtx\?\.cobroPausado && \(\s*<p role="status" data-cambio-plan-bloqueado/);
  assert.match(tab, /disabled=\{isCurrent \|\| changingPlan !== null \|\| !!billingCtx\?\.cobroPausado \|\| !billingCtxListo\}/, "Z20: los planes esperan a saber si hay un periodo pagado");
  assert.match(tab, /if \(billingCtx\?\.cobroPausado\) return;/);
  const dlg = readFileSync(path.join(RAIZ, "src/components/dashboard/team/upgrade-usuarios-dialog.tsx"), "utf8");
  assert.match(dlg, /code === "PLAN_PREPAGADO"/);
  assert.match(dlg, /bloqueo \?\? x\.sinVista/);
});

/* ── Duodécima vuelta (t2): Y17 en el webhook y la falsa alarma de «cobro inesperado» ──────────────────────────────────── */

test("Y17 `customer.subscription.updated` NO aplica Clinic.plan desde metadata.plan mientras la suscripción esté past_due / unpaid / incomplete; lo aplica cuando pasa a active", async () => {
  for (const estado of ["past_due", "unpaid", "incomplete", "incomplete_expired"]) {
    conTarjetaRechazada();
    clinica().plan = "BASIC";
    const sub = suscripcion(estado, Date.now() + 30 * DIA); // metadata.plan = PRO («Subir» dejó el plan nuevo en la metadata)
    suscripcionesVivas.set(SUB, sub);
    assert.equal(await entregar(evento("customer.subscription.updated", sub)), 200, estado);
    assert.equal(clinica().plan, "BASIC", `${estado}: el plan nuevo no se aplica sin pagar`);
  }
  // Ya pagada (active): se aplica.
  conTarjetaRechazada();
  clinica().plan = "BASIC";
  const pagada = suscripcion("active", Date.now() + 30 * DIA);
  suscripcionesVivas.set(SUB, pagada);
  assert.equal(await entregar(evento("customer.subscription.updated", pagada)), 200);
  assert.equal(clinica().plan, "PRO", "active: ahora sí");
  // Un periodo pagado a mano (trialing + marca) también cuenta como pagado.
  conTarjetaRechazada();
  clinica().plan = "BASIC";
  const periodo: any = suscripcion("trialing", Date.now() + 30 * DIA);
  periodo.trial_end = aSegundos(Date.now() + 30 * DIA);
  periodo.metadata.periodo_pagado_hasta = new Date(periodo.trial_end * 1000).toISOString();
  suscripcionesVivas.set(SUB, periodo);
  assert.equal(await entregar(evento("customer.subscription.updated", periodo)), 200);
  assert.equal(clinica().plan, "PRO");
});

test("falsa alarma: con tarjeta, la `latest_invoice` que devuelve el cambio de ciclo es el mes RECIÉN COBRADO; no es un «cobro inesperado» ni pide reembolsar un pago bueno", async () => {
  suspendidaCuatroMeses();
  facturasDeLista = [70, 40, 10].map((d, i) => facturaDeMes(MESES_SUSPENDIDOS[i + 1], d * DIA));
  facturasVivas.set(FACTURA, { id: FACTURA, status: "paid" });
  const viva: any = suscripcion("past_due", Date.now() + 10 * DIA);
  delete viva.latest_invoice; // ni siquiera sabemos cuál era la última antes del cambio
  suscripcionesVivas.set(SUB, viva);
  // Stripe no crea factura de $0 con trial_end: devuelve la última, que es la que acaba de cobrarse (creada hace segundos).
  ultimaFacturaDelCambio = { id: FACTURA, status: "paid", amount_paid: 68900, amount_due: 68900, created: Math.floor(Date.now() / 1000) };
  const pago = Date.now();
  const pagada = facturaPagada({ billing_reason: "subscription_cycle", status_transitions: { finalized_at: aSegundos(pago - 100 * DIA), paid_at: aSegundos(pago) } });
  assert.equal(await entregar(evento("invoice.paid", pagada, pago)), 200, "sin 5xx");
  assert.equal(correosAdmin.length, 0, "sin aviso de «reembolsa»");
  assert.equal(clinica().subscriptionStatus, "active");
  assert.equal(llamadasCiclo.length, 1);
  // Y una factura DISTINTA con cobro sí se reporta (control).
  suspendidaCuatroMeses();
  facturasDeLista = [70, 40, 10].map((d, i) => facturaDeMes(MESES_SUSPENDIDOS[i + 1], d * DIA));
  ultimaFacturaDelCambio = { id: "in_otra_cobrada", status: "paid", amount_paid: 68900, amount_due: 68900, created: Math.floor(Date.now() / 1000) };
  suscripcionesVivas.set(SUB, suscripcion("past_due", Date.now() + 10 * DIA));
  assert.equal(await entregar(evento("invoice.paid", pagada, pago)), 500);
  assert.match(correosAdmin[0].text, /in_otra_cobrada/);
});


/* ── Decimotercera vuelta de t4 (Z1–Z21): regla de oro — ante la duda no se calcula más ──────────────────────────────────── */

test("Z1 un PRORRATEO (subscription_update parcial) nunca da un periodo completo ni anula otras facturas: dentro de la gracia no toca la renovación de hoy, y suspendida con plan anual no recibe 365 días", async () => {
  // (a) En la gracia: la renovación de hoy sigue abierta y un prorrateo viejo se paga.
  conTarjetaRechazada();
  facturasDeLista = [facturaDeMes("in_renov", HORA)];
  facturasVivas.set("in_prorrateo", { id: "in_prorrateo", status: "paid" });
  suscripcionesVivas.set(SUB, suscripcion("past_due", Date.now() + 29 * DIA));
  const pago = Date.now();
  const parcial = (dias: number) => ({ data: [{ metadata: {}, period: { start: aSegundos(pago - 2 * DIA), end: aSegundos(pago + dias * DIA) } }] });
  const prorrateo = facturaPagada({ id: "in_prorrateo", billing_reason: "subscription_update", amount_paid: 9000, status_transitions: { finalized_at: aSegundos(pago - 30 * HORA), paid_at: aSegundos(pago) }, lines: parcial(5) });
  assert.equal(await entregar(evento("invoice.paid", prorrateo, pago)), 200);
  assert.equal(llamadasAnular.length, 0, "la renovación de hoy ($689) NO se anula");
  assert.equal(llamadasCiclo.length, 0, "no se da un periodo completo por unos días de prorrateo");
  assert.equal(facturasDeLista.find((f) => f.id === "in_renov")!.status, "open");
  // (b) Suspendida con plan ANUAL: un prorrateo de $400 no le da 365 días.
  suspendidaCuatroMeses();
  const anual: any = suscripcion("past_due", Date.now() + 200 * DIA);
  anual.items.data[0].price = { recurring: { interval: "year" } };
  suscripcionesVivas.set(SUB, anual);
  facturasVivas.set("in_prorrateo2", { id: "in_prorrateo2", status: "paid" });
  const p2 = facturaPagada({ id: "in_prorrateo2", billing_reason: "subscription_update", amount_paid: 40000, status_transitions: { finalized_at: aSegundos(pago - 3 * DIA), paid_at: aSegundos(pago) }, lines: parcial(20) });
  assert.equal(await entregar(evento("invoice.paid", p2, pago)), 200);
  assert.equal(llamadasCiclo.length, 0);
  assert.equal(llamadasAnular.length, 0, "tampoco anula las demás");
  assert.equal(facturasDeLista.filter((f) => f.status === "open").length, 4, "los meses suspendidos siguen visibles");
  assert.ok(clinica().trialEndsAt.getTime() < Date.now() + 250 * DIA, "no recibió 365 días");
});

test("Z2 si la regla falla, la clínica que PAGÓ se reactiva igual (también con el caso M6) y el pendiente queda visible para reintentar", async () => {
  suspendidaCuatroMeses();
  facturasDeLista = [70, 40, 10].map((d, i) => facturaDeMes(MESES_SUSPENDIDOS[i + 1], d * DIA));
  facturasVivas.set(FACTURA, { id: FACTURA, status: "paid" });
  suscripcionesVivas.set(SUB, suscripcion("past_due", Date.now() + 10 * DIA));
  itemsPendientes = [{ id: "ii_a", subscription: null }, { id: "ii_modulo", subscription: "sub_modulo" }];
  const pago = Date.now();
  const pagada = facturaPagada({ billing_reason: "subscription_cycle", status_transitions: { finalized_at: aSegundos(pago - 100 * DIA), paid_at: aSegundos(pago) } });
  assert.equal(await entregar(evento("invoice.paid", pagada, pago)), 500, "Stripe reenvía");
  assert.equal(isPlanExpired(clinica()), false, "tiene acceso: pagó");
  assert.equal(clinica().subscriptionStatus, "active");
  assert.match(correosAdmin[0].text, /otra suscripción del cliente/, "Z14: el aviso dice por qué");
  const { reglasPendientes } = await import("@/lib/billing/regla-cobro-tarjeta.server");
  const pendientes = await reglasPendientes(CLINIC);
  assert.deepEqual(pendientes.map((p) => [p.clinicId, p.invoiceId]), [[CLINIC, FACTURA]]);
  assert.ok(pendientes[0].fin && Math.abs(pendientes[0].fin.getTime() - clinica().trialEndsAt.getTime()) < 2000, "el rastro guarda el fin de lo pagado");
  const { clinicasConFacturaPendienteTrasPagoManual } = await import("@/lib/billing/facturas-tarjeta-pendientes.server");
  const lista = await clinicasConFacturaPendienteTrasPagoManual({ stripe: stripeDoble });
  assert.deepEqual(lista[0].tarjetaPendiente, [FACTURA]);
  assert.equal(lista[0].pagoManualEn, null, "Z13: sin pago manual, no se inventa una fecha");
});

test("Z3 si el reintento funciona DESPUÉS de que Stripe ya cobró la renovación con el ciclo viejo, NO retrocede nada: ni trial_end antes del periodo ya cobrado ni el acceso", async () => {
  suspendidaCuatroMeses();
  facturasDeLista = [70, 40, 10].map((d, i) => facturaDeMes(MESES_SUSPENDIDOS[i + 1], d * DIA));
  facturasVivas.set(FACTURA, { id: FACTURA, status: "paid" });
  suscripcionesVivas.set(SUB, suscripcion("past_due", Date.now() + 10 * DIA));
  const pago = Date.now();
  const pagada = facturaPagada({ billing_reason: "subscription_cycle", status_transitions: { finalized_at: aSegundos(pago - 100 * DIA), paid_at: aSegundos(pago) } });
  stripeCicloFalla = true;
  assert.equal(await entregar(evento("invoice.paid", pagada, pago)), 500);
  facturasVivas.set(FACTURA, pagada); // el reintento relee la factura completa en Stripe
  // La renovación vieja se cobra: Stripe ya cubre hasta +45 días.
  stripeCicloFalla = false;
  suscripcionesVivas.set(SUB, suscripcion("active", Date.now() + 45 * DIA));
  const antes = clinica().trialEndsAt.getTime();
  const re = await (await llamarAdmin({ action: "marcar_factura_fuera_de_stripe", clinicId: CLINIC })).json();
  assert.equal(re.success, true);
  assert.equal(llamadasCiclo.length, 0, "no se pone un trial_end ANTES del fin del periodo ya cobrado");
  assert.ok(clinica().trialEndsAt.getTime() >= antes, "el acceso no se acorta");
  assert.ok(clinica().trialEndsAt.getTime() >= Date.now() + 44 * DIA, "y refleja el periodo ya cobrado");
});

test("Z4 «Registrar pago»: referencias DISTINTAS son dos pagos (nunca se descarta uno real); la misma referencia es el mismo pago; si falta una se pide confirmación", async () => {
  suspendidaCuatroMeses();
  const hoy = new Date();
  const registrar = (extra: Record<string, unknown>) =>
    POSTSubs(new NextRequestCtor("http://localhost/api/admin/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clinicId: CLINIC, amount: 689, method: "transfer", periodStart: hoy.toISOString(), periodEnd: mesesDesde(hoy.getTime(), 1).toISOString(), status: "paid", ...extra }),
    }));
  assert.equal((await registrar({ reference: "SPEI-AAA" })).status, 201);
  assert.equal((await registrar({ reference: "SPEI-BBB" })).status, 201, "otra referencia = otro pago real");
  const mismo = await registrar({ reference: "SPEI-AAA" });
  assert.equal(mismo.status, 200);
  assert.equal(((await mismo.json()) as any).duplicado, true);
  const sinRef = await registrar({});
  assert.equal(sinRef.status, 409, "una fila previa con referencia y ésta sin ella: no se sabe → confirmación");
  assert.equal(((await sinRef.json()) as any).code, "POSIBLE_DUPLICADO");
  assert.equal(pagosDeSubscripcion.filter((p) => p.method === "transfer").length, 2);
  // La pantalla: pregunta, avisa del duplicado con claridad (no lo da por éxito) y saca a la clínica de la lista de vencidas.
  const { readFileSync } = await import("node:fs");
  const ui = readFileSync(path.join(RAIZ, "src/app/admin/payments/payments-client.tsx"), "utf8");
  assert.match(ui, /d\.code === "POSIBLE_DUPLICADO"/);
  assert.match(ui, /window\.confirm\(/);
  assert.match(ui, /confirmarDuplicado: true/);
  assert.match(ui, /Ese pago ya estaba registrado hace un momento/);
  assert.match(ui, /setOverdue\(prev => prev\.filter\(\(c: any\) => c\.id !== form\.clinicId\)\)/);
});

test("Z5 «Activar clínica» solo con la clínica suspendida o vencida: al corriente → 409 con texto claro (y no suma nada); la suspendida sí se activa", async () => {
  reiniciar({ subscriptionStatus: "active", trialEndsAt: new Date(Date.now() + 20 * DIA), nextBillingDate: new Date(Date.now() + 20 * DIA) });
  const antes = clinica().trialEndsAt.getTime();
  const r = await llamarAdmin({ action: "activate_clinic", clinicId: CLINIC, plan: "PRO", months: 1 });
  assert.equal(r.status, 409);
  const d = (await r.json()) as any;
  assert.equal(d.code, "YA_AL_CORRIENTE");
  assert.match(d.error, /ya está al corriente hasta el/);
  assert.match(d.error, /Registrar pago/);
  assert.equal(clinica().trialEndsAt.getTime(), antes);
  assert.equal(pagosDeSubscripcion.length, 0, "ninguna fila");
  // Un segundo admin a los 3 minutos tampoco suma.
  suspendidaCuatroMeses();
  assert.equal((await llamarAdmin({ action: "activate_clinic", clinicId: CLINIC, plan: "PRO", months: 1 })).status, 200);
  envejecerActivaciones();
  assert.equal((await llamarAdmin({ action: "activate_clinic", clinicId: CLINIC, plan: "PRO", months: 1 })).status, 409, "ya está al corriente: no suma otro mes");
});

test("Z6 (recortado) el reintento tardío NUNCA mueve el ciclo, ni a 1,5 días del inicio del ciclo ni con past_due: anula lo seguro y avisa qué revisar", async () => {
  const hoy = Date.now();
  reiniciar({ subscriptionStatus: "past_due", trialEndsAt: new Date(hoy - HORA), nextBillingDate: new Date(hoy + 29 * DIA) });
  suscripcionesVivas.set(SUB, suscripcion("past_due", hoy + 29 * DIA));
  facturasDeLista = [facturaDeMes("in_reciente", 25 * HORA)];
  stripeCicloFalla = true;
  const primero = await (await activarMeses(1)).json();
  assert.equal(primero.facturaTarjeta.tipo, "fallo");
  assert.equal(llamadasCiclo.length, 0);
  assert.equal(llamadasAnular.length, 1, "la factura ya se anuló");
  stripeCicloFalla = false;
  const re = await (await llamarAdmin({ action: "marcar_factura_fuera_de_stripe", clinicId: CLINIC })).json();
  assert.equal(re.success, true);
  assert.equal(llamadasCiclo.length, 0, "no calcula el ciclo en el camino tardío");
  assert.match(re.facturaTarjeta.revisar, /Revisa en Stripe la suscripción/);
});

test("Z8 un cobro de tarjeta a medias NO caduca por viejo: a los 40 días sigue pendiente en la lista, «Reintentar» y el cron", async () => {
  suspendidaCuatroMeses();
  facturasVivas.set(FACTURA, { id: FACTURA, status: "paid" });
  const { registrarReglaFallida, reglasPendientes } = await import("@/lib/billing/regla-cobro-tarjeta.server");
  await registrarReglaFallida(FACTURA, CLINIC);
  logsCorreo.forEach((l) => { l.createdAt = new Date(Date.now() - 40 * DIA); });
  assert.deepEqual(await reglasPendientes(), [{ clinicId: CLINIC, invoiceId: FACTURA }]);
  const { clinicasConFacturaPendienteTrasPagoManual } = await import("@/lib/billing/facturas-tarjeta-pendientes.server");
  assert.equal((await clinicasConFacturaPendienteTrasPagoManual({ stripe: stripeDoble })).length, 1);
});

test("Z10 con 150 clínicas que pagaron a mano, la de cobro de tarjeta a medias NO se queda fuera del tope de la lista", async () => {
  suspendidaCuatroMeses();
  facturasVivas.set(FACTURA, { id: FACTURA, status: "paid" });
  const { registrarReglaFallida } = await import("@/lib/billing/regla-cobro-tarjeta.server");
  await registrarReglaFallida(FACTURA, CLINIC);
  for (let i = 0; i < 150; i++) {
    clinicas.set(`otra_${i}`, { id: `otra_${i}`, name: `Otra ${i}`, stripeSubscriptionId: `sub_otra_${i}`, trialEndsAt: new Date(), subscriptionStatus: "active", users: [] });
    pagosDeSubscripcion.push({ id: `pm_${i}`, clinicId: `otra_${i}`, status: "paid", method: "transfer", amount: 689, paidAt: new Date(Date.now() - HORA), periodEnd: new Date(Date.now() + 30 * DIA) });
  }
  const { clinicasConFacturaPendienteTrasPagoManual } = await import("@/lib/billing/facturas-tarjeta-pendientes.server");
  const lista = await clinicasConFacturaPendienteTrasPagoManual({ stripe: stripeDoble });
  assert.ok(lista.some((l) => l.clinicId === CLINIC && l.tarjetaPendiente.includes(FACTURA)), "la clínica con la regla a medias sí sale");
});

test("Z11 la factura aparte del excedente se registra con el método del excedente (no «stripe») y el afiliado no la cuenta como cobro del plan en su numeración", async () => {
  conTarjetaRechazada();
  clinica().subscriptionStatus = "active";
  facturasVivas.set("in_aparte2", { id: "in_aparte2", status: "paid" });
  const aparte = facturaPagada({ id: "in_aparte2", billing_reason: "manual", amount_paid: 3000, metadata: { kind: "cfdi-overage-aparte" }, parent: null, subscription: null });
  assert.equal(await entregar(evento("invoice.paid", aparte)), 200);
  assert.equal(facturasRegistradas[0].metodo, "cfdi_overage");
  const { readFileSync } = await import("node:fs");
  const payout = readFileSync(path.join(RAIZ, "src/lib/affiliates/payout.ts"), "utf8");
  assert.match(payout, /\{ OR: \[\{ method: null \}, \{ method: \{ not: "cfdi_overage" \} \}\] \}/);
});

test("Z12 si en el reintento la regla ya no aplica (suscripción cancelada), el pendiente se CIERRA y no reaparece", async () => {
  conTarjetaRechazada();
  facturasVivas.set(FACTURA, { id: FACTURA, status: "paid", billing_reason: "subscription_cycle", amount_paid: 68900, parent: { subscription_details: { subscription: SUB } } });
  suscripcionesVivas.set(SUB, suscripcion("canceled", Date.now()));
  const { registrarReglaFallida, reglasPendientes, reintentarReglasPendientes } = await import("@/lib/billing/regla-cobro-tarjeta.server");
  await registrarReglaFallida(FACTURA, CLINIC);
  const r = await reintentarReglasPendientes(stripeDoble, CLINIC);
  assert.deepEqual(r.completadas, [FACTURA]);
  assert.deepEqual(await reglasPendientes(CLINIC), [], "cerrado con regla_ok");
  assert.deepEqual((await reintentarReglasPendientes(stripeDoble, CLINIC)).completadas, []);
});

test("Z15 `activate_clinic` sin clinicId (o que no es texto) responde 400 antes de consultar nada", async () => {
  for (const clinicId of [undefined, null, 123, ""]) {
    const r = await llamarAdmin({ action: "activate_clinic", clinicId: clinicId as any, plan: "PRO", months: 1 });
    assert.equal(r.status, 400, String(clinicId));
  }
  assert.equal(pagosDeSubscripcion.length, 0);
});

test("Z17 con COBRO_REALINEAR_CICLO=0 la advertencia «la tarjeta cobrará en su fecha anterior» solo sale si HABÍA algo que mover", async () => {
  process.env.COBRO_REALINEAR_CICLO = "0";
  try {
    conTarjetaRechazada(); // en la gracia con 1 mes: el ciclo ya coincide con lo pagado
    const gracia = await (await activarMeses(1)).json();
    assert.equal(gracia.facturaTarjeta.ciclo, undefined, "sin advertencia falsa");
    suspendidaCuatroMeses();
    const susp = await (await activarMeses(1)).json();
    assert.deepEqual(susp.facturaTarjeta.ciclo, { tipo: "apagado" });
  } finally {
    delete process.env.COBRO_REALINEAR_CICLO;
  }
});

test("Z13/Z16/Z20 pantallas: «cobro de tarjeta» en vez de una fecha de 1969, el reintento que solo movió el ciclo lo dice, y los planes esperan a saber si hay un periodo pagado", async () => {
  const { readFileSync } = await import("node:fs");
  const lista = readFileSync(path.join(RAIZ, "src/app/admin/payments/facturas-tarjeta-pendientes.tsx"), "utf8");
  assert.match(lista, /f\.pagoManualEn \? `pagó a mano \$\{fechaHoraAdmin\(f\.pagoManualEn\) \?\? ""\}` : "cobro de tarjeta"/);
  assert.match(lista, /ciclo\?\.tipo === "movido" && data\.facturaTarjeta\?\.tipo === "nada"/);
  const aviso = readFileSync(path.join(RAIZ, "src/app/admin/payments/aviso-factura-tarjeta.tsx"), "utf8");
  assert.match(aviso, /el siguiente cobro de la tarjeta ya cae donde termina lo pagado/);
  assert.doesNotMatch(aviso, /No hay factura de tarjeta abierta que marcar/);
  assert.match(aviso, /data\?\.facturaTarjeta\?\.mensaje \?\? "Stripe sigue sin contestar/, "Z14: muestra el texto verdadero del fallo");
  const tab = readFileSync(path.join(RAIZ, "src/components/dashboard/subscription-tab.tsx"), "utf8");
  assert.match(tab, /billingCtxListo/);
});

test("Z21 si no se pudo leer la suscripción para decidir una factura de $0, se registra pero NO se manda el correo de «plan renovado» por $0", async () => {
  conTarjetaRechazada();
  clinica().subscriptionStatus = "active";
  stripeRespondeSuscripciones = false; // la lectura de Stripe falla
  facturasVivas.set("in_cero9", { id: "in_cero9", status: "paid" });
  const r = await entregar(evento("invoice.paid", facturaPagada({ id: "in_cero9", billing_reason: "subscription_cycle", amount_paid: 0 })));
  assert.ok(r === 200 || r === 500);
  assert.equal(correosRenovacion.length, 0, "sin correo por $0");
});


test("factura pagada de un MÓDULO: se registra el cobro, y NO manda correo de plan ni comisión de afiliado ni reactiva el plan (comportamiento que fija webhook-facturas-de-modulo)", async () => {
  conTarjetaRechazada();
  Object.assign(clinica(), { affiliateId: "aff_1", affiliate: { commissionPct: 10, status: "APPROVED", payoutMode: "percent" } });
  facturasVivas.set("in_modulo_pagada", { id: "in_modulo_pagada", status: "paid" });
  const modulo = facturaPagada({
    id: "in_modulo_pagada",
    billing_reason: "subscription_cycle",
    amount_paid: 49900,
    parent: { subscription_details: { subscription: "sub_mod", metadata: { kind: "module-subscription", moduleKey: "orthodontics" } } },
  });
  assert.equal(await entregar(evento("invoice.paid", modulo)), 200, "corta antes del bloque de afiliados (que reventaría con este doble)");
  assert.deepEqual(facturasRegistradas.map((f) => f.id), ["in_modulo_pagada"], "el cobro del módulo SÍ queda registrado");
  assert.equal(correosRenovacion.length, 0, "sin correo de plan");
  assert.equal(clinica().subscriptionStatus, "past_due", "y no reactiva el plan");
  assert.equal(llamadasCiclo.length + llamadasAnular.length, 0);
});


/* ── Decimocuarta vuelta de t4 (AA1–AA13) ───────────────────────────────────────────────────────────────────────────────── */

test("AA1 esPeriodoCompleto: una línea de PRORRATEO nunca cuenta (aunque dure 30 o 335 días) ni un periodo que no empieza cuando se creó la factura; el ciclo nuevo de «Subir» sí", async () => {
  const { esPeriodoCompleto } = await import("@/lib/billing/regla-cobro-tarjeta.server");
  const ahora = aSegundos(Date.now());
  const mensual: any = suscripcion("past_due", Date.now() + 10 * DIA);
  const anual: any = suscripcion("past_due", Date.now() + 10 * DIA);
  anual.items.data[0].price = { recurring: { interval: "year" } };
  const factura = (lineas: any[]): any => ({ created: ahora, lines: { data: lineas } });
  assert.equal(esPeriodoCompleto(factura([{ proration: true, period: { start: ahora, end: ahora + 30 * 86_400 } }]), mensual), false, "prorrateo mensual de 30 días");
  assert.equal(esPeriodoCompleto(factura([{ parent: { subscription_item_details: { proration: true } }, period: { start: ahora, end: ahora + 335 * 86_400 } }]), anual), false, "prorrateo anual de 335 días (API nueva)");
  assert.equal(esPeriodoCompleto(factura([{ period: { start: ahora - 5 * 86_400, end: ahora + 26 * 86_400 } }]), mensual), false, "empieza 5 días antes de la factura");
  assert.equal(esPeriodoCompleto(factura([{ proration: true, period: { start: ahora, end: ahora + 30 * 86_400 } }, { period: { start: ahora, end: ahora + 31 * 86_400 } }]), mensual), true, "el cobro del ciclo nuevo sí, aunque venga acompañado de un crédito");
  assert.equal(esPeriodoCompleto(factura([{ period: { start: ahora, end: ahora + 365 * 86_400 } }]), anual), true);
});

test("AA1 una suspendida con un prorrateo LARGO (28 días) pagado con tarjeta no recibe un periodo completo ni se anula nada; se reactiva con el periodo de Stripe", async () => {
  suspendidaCuatroMeses();
  facturasVivas.set("in_prorrateo_largo", { id: "in_prorrateo_largo", status: "paid" });
  suscripcionesVivas.set(SUB, suscripcion("past_due", Date.now() + 28 * DIA));
  const pago = Date.now();
  const largo = facturaPagada({
    id: "in_prorrateo_largo",
    billing_reason: "subscription_update",
    amount_paid: 40000,
    created: aSegundos(pago - 2 * DIA),
    status_transitions: { finalized_at: aSegundos(pago - 2 * DIA), paid_at: aSegundos(pago) },
    lines: { data: [{ metadata: {}, proration: true, period: { start: aSegundos(pago - 2 * DIA), end: aSegundos(pago + 28 * DIA) } }] },
  });
  assert.equal(await entregar(evento("invoice.paid", largo, pago)), 200);
  assert.equal(llamadasCiclo.length, 0);
  assert.equal(llamadasAnular.length, 0);
  assert.equal(facturasDeLista.filter((f) => f.status === "open").length, 4, "los meses suspendidos siguen visibles");
});

test("AA2 el reintento de una regla fallida solo anula facturas creadas HASTA el pago: una renovación posterior (otra deuda) NO se anula", async () => {
  suspendidaCuatroMeses();
  facturasDeLista = [70, 40, 10].map((d, i) => facturaDeMes(MESES_SUSPENDIDOS[i + 1], d * DIA));
  suscripcionesVivas.set(SUB, suscripcion("past_due", Date.now() + 10 * DIA));
  const pago = Date.now();
  const pagada = facturaPagada({ billing_reason: "subscription_cycle", status_transitions: { finalized_at: aSegundos(pago - 100 * DIA), paid_at: aSegundos(pago) } });
  facturasVivas.set(FACTURA, pagada);
  stripeCicloFalla = true;
  assert.equal(await entregar(evento("invoice.paid", pagada, pago)), 500);
  stripeCicloFalla = false;
  // Stripe renueva con el ciclo viejo DESPUÉS del pago y esa renovación se rechaza (queda abierta).
  facturasDeLista.push(facturaDeMes("in_renov_tras_pago", 0, { created: aSegundos(pago + 2 * DIA), status_transitions: { finalized_at: aSegundos(pago + 2 * DIA) } }));
  suscripcionesVivas.set(SUB, suscripcion("past_due", Date.now() + 2 * DIA));
  const re = await (await llamarAdmin({ action: "marcar_factura_fuera_de_stripe", clinicId: CLINIC })).json();
  assert.equal(re.success, true);
  assert.equal(facturasDeLista.find((f) => f.id === "in_renov_tras_pago")!.status, "open", "la renovación posterior al pago NO se anula (no se regala ese mes)");
  assert.ok(!llamadasAnular.some((l) => l.id === "in_renov_tras_pago"));
});

test("AA4 contra un periodo ya cobrado (active) nunca se recorta, ni 1 hora: el modo exacto no pone un trial_end antes de su fin; con past_due (periodo sin cobrar) sí se mueve", async () => {
  const { realinearCiclo } = await import("@/lib/billing/reactivacion-tras-suspension.server");
  const fin = new Date(Date.now() + 30 * DIA);
  for (const delta of [-3 * 86_400_000, -2 * 86_400_000, -3_600_000]) {
    // El periodo que Stripe ya cobró termina `-delta` DESPUÉS de lo pagado a mano.
    const cobrado = suscripcion("active", fin.getTime() - delta);
    suscripcionesVivas.set(SUB, cobrado);
    llamadasCiclo.length = 0;
    const r = await realinearCiclo(stripeDoble, cobrado as any, { pagadoEn: new Date(), finDeLoPagado: fin, exacto: true });
    assert.equal(r.tipo, "no_aplica", `active, ${-delta / 3_600_000} h de diferencia`);
    assert.equal(llamadasCiclo.length, 0);
  }
  // Un periodo SIN cobrar (past_due) que termina después: sí se mueve.
  const sinCobrar = suscripcion("past_due", fin.getTime() + 2 * DIA);
  suscripcionesVivas.set(SUB, sinCobrar);
  const r2 = await realinearCiclo(stripeDoble, sinCobrar as any, { pagadoEn: new Date(), finDeLoPagado: fin, exacto: true });
  assert.equal(r2.tipo, "hecho");
  // Y el periodo cobrado que termina ANTES de lo pagado a mano (hay que mover) sigue moviéndose.
  const corto = suscripcion("active", fin.getTime() - 5 * DIA);
  suscripcionesVivas.set(SUB, corto);
  llamadasCiclo.length = 0;
  assert.equal((await realinearCiclo(stripeDoble, corto as any, { pagadoEn: new Date(), finDeLoPagado: fin, exacto: true })).tipo, "hecho");
});

test("AA3 «Registrar pago» guarda NULL cuando la referencia viene vacía o solo con espacios (nunca \"\", que choca con el índice único)", async () => {
  suspendidaCuatroMeses();
  const hoy = new Date();
  const registrar = (reference: unknown, extra: Record<string, unknown> = {}) =>
    POSTSubs(new NextRequestCtor("http://localhost/api/admin/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clinicId: CLINIC, amount: 689, method: "deposit", reference, periodStart: hoy.toISOString(), periodEnd: mesesDesde(hoy.getTime(), 1).toISOString(), status: "paid", ...extra }),
    }));
  assert.equal((await registrar("   ")).status, 201);
  assert.equal((await registrar("", { confirmarDuplicado: true })).status, 201);
  assert.equal((await registrar(undefined, { confirmarDuplicado: true })).status, 201);
  const filas = pagosDeSubscripcion.filter((p) => p.method === "deposit");
  assert.equal(filas.length, 3);
  for (const f of filas) assert.strictEqual(f.reference, null, "null, no \"\" ni \"   \"");
  // Con referencia real se guarda recortada.
  assert.equal((await registrar("  SPEI-1  ", { confirmarDuplicado: true })).status, 201);
  assert.equal(pagosDeSubscripcion.at(-1)!.reference, "SPEI-1");
});

test("AA13 la factura aparte del excedente conserva el método del excedente también si primero se rechazó; AA12 «Activar» dentro de la gracia no dice «al corriente»", async () => {
  conTarjetaRechazada();
  facturasVivas.set("in_aparte_f", { id: "in_aparte_f", status: "open" });
  const fallida = facturaFallida({ id: "in_aparte_f", billing_reason: "manual", metadata: { kind: "cfdi-overage-aparte" }, parent: null, subscription: null });
  assert.equal(await entregar(evento("invoice.payment_failed", fallida)), 200);
  assert.ok(facturasRegistradas.some((f) => f.id === "in_aparte_f" && f.metodo === "cfdi_overage"), "método del excedente desde el primer registro");
  // AA12
  conTarjetaRechazada(); // past_due con acceso por unas horas
  const r = await llamarAdmin({ action: "activate_clinic", clinicId: CLINIC, plan: "PRO", months: 1 });
  assert.equal(r.status, 409);
  const d = (await r.json()) as any;
  assert.match(d.error, /cobro rechazado y todavía está dentro de sus 24 horas de gracia/);
  assert.doesNotMatch(d.error, /ya está al corriente/);
});

/* ── Recorte del camino tardío + invariante «nunca sin acceso antes del fin de lo ya pagado» (verificación de la decimocuarta) ── */

/** Suspendida que paga con tarjeta y la regla FALLA al momento del pago (el ciclo no se pudo mover): queda activa con acceso hasta `fin`. */
async function pagoConReglaFallida() {
  suspendidaCuatroMeses();
  facturasDeLista = [70, 40, 10].map((d, i) => facturaDeMes(MESES_SUSPENDIDOS[i + 1], d * DIA));
  suscripcionesVivas.set(SUB, suscripcion("past_due", Date.now() + 10 * DIA));
  const pago = Date.now();
  const pagada = facturaPagada({ billing_reason: "subscription_cycle", status_transitions: { finalized_at: aSegundos(pago - 100 * DIA), paid_at: aSegundos(pago) } });
  facturasVivas.set(FACTURA, pagada);
  stripeCicloFalla = true;
  assert.equal(await entregar(evento("invoice.paid", pagada, pago)), 500);
  stripeCicloFalla = false;
  return { pago, pagada, fin: mesesDesde(aSegundos(pago) * 1000, 1) };
}

test("RECORTE camino tardío (tarjeta): «Reintentar» / el cron NO mueven el ciclo (ni con past_due) ni anulan renovaciones creadas después del pago; solo anulan lo seguro y avisan qué revisar en Stripe", async () => {
  const { pago, fin } = await pagoConReglaFallida();
  // Stripe renueva con el ciclo viejo DESPUÉS del pago (queda abierta) y la suscripción sigue past_due.
  facturasDeLista.push(facturaDeMes("in_renov_tras_pago", 0, { created: aSegundos(pago + 2 * DIA), status_transitions: { finalized_at: aSegundos(pago + 2 * DIA) } }));
  suscripcionesVivas.set(SUB, suscripcion("past_due", Date.now() + 2 * DIA));
  const antes = { anuladas: llamadasAnular.length, acceso: clinica().trialEndsAt.getTime() };
  const re = await (await llamarAdmin({ action: "marcar_factura_fuera_de_stripe", clinicId: CLINIC })).json();
  assert.equal(re.success, true);
  assert.equal(llamadasCiclo.length, 0, "AB4: con past_due el camino tardío tampoco recorta ni mueve");
  assert.equal(facturasDeLista.find((f) => f.id === "in_renov_tras_pago")!.status, "open", "AB1: la renovación posterior al pago no se toca");
  assert.equal(llamadasAnular.length, antes.anuladas, "y no se anuló nada más");
  assert.ok(clinica().trialEndsAt.getTime() >= antes.acceso, "el acceso no se acorta");
  assert.ok(Math.abs(clinica().trialEndsAt.getTime() - fin.getTime()) < 2000, "protegido hasta el fin de lo pagado");
  assert.match(re.facturaTarjeta.revisar, /^La regla no se aplicó al momento del pago\. Revisa en Stripe la suscripción de BEVADENT: factura\(s\) abiertas in_renov_tras_pago y fin de periodo /);
  assert.match(re.facturaTarjeta.revisar, /El acceso de la clínica está protegido hasta /);
  assert.ok(correosAdmin.some((c) => /Revisa en Stripe la suscripción de BEVADENT/.test(c.subject)), "y el admin recibe el correo");
  // El rastro se cierra: no reaparece en la lista ni en el cron.
  const { reglasPendientes } = await import("@/lib/billing/regla-cobro-tarjeta.server");
  assert.deepEqual(await reglasPendientes(CLINIC), []);
  const { reintentarMarcadoPendiente } = await import("@/lib/billing/facturas-tarjeta-pendientes.server");
  const cron = await reintentarMarcadoPendiente({ stripe: stripeDoble });
  assert.deepEqual(cron, { revisadas: 0, marcadas: [], anuladas: [], fallos: [] });
  assert.equal(llamadasCiclo.length, 0);
});

test("RECORTE: un reenvío del webhook con el pago de hace MÁS de 6 horas también es camino tardío (sin calcular el ciclo); uno reciente sigue siendo el camino normal", async () => {
  suspendidaCuatroMeses();
  facturasDeLista = [70, 40, 10].map((d, i) => facturaDeMes(MESES_SUSPENDIDOS[i + 1], d * DIA));
  facturasVivas.set(FACTURA, { id: FACTURA, status: "paid" });
  suscripcionesVivas.set(SUB, suscripcion("past_due", Date.now() + 10 * DIA));
  const pago = Date.now() - 10 * HORA;
  const pagada = facturaPagada({ billing_reason: "subscription_cycle", status_transitions: { finalized_at: aSegundos(pago - 100 * DIA), paid_at: aSegundos(pago) } });
  assert.equal(await entregar(evento("invoice.paid", pagada, Date.now())), 200);
  assert.equal(llamadasCiclo.length, 0, "tarde: sin calcular el ciclo");
  assert.deepEqual(llamadasAnular.map((l) => l.id).sort(), ["in_s2", "in_s3", "in_s4"], "pero sí se anulan los meses sin servicio creados hasta el pago");
  assert.equal(clinica().subscriptionStatus, "active");
  assert.ok(Math.abs(clinica().trialEndsAt.getTime() - mesesDesde(aSegundos(pago) * 1000, 1).getTime()) < 2000);
  assert.ok(correosAdmin.some((c) => /Revisa en Stripe/.test(c.subject)));
  // Control: reciente (hace 1 h) → normal, mueve el ciclo.
  suspendidaCuatroMeses();
  facturasDeLista = [70, 40, 10].map((d, i) => facturaDeMes(MESES_SUSPENDIDOS[i + 1], d * DIA));
  suscripcionesVivas.set(SUB, suscripcion("past_due", Date.now() + 10 * DIA));
  llamadasCiclo.length = 0;
  const reciente = Date.now() - HORA;
  const p2 = facturaPagada({ id: "in_reciente_pagada", billing_reason: "subscription_cycle", status_transitions: { finalized_at: aSegundos(reciente - 100 * DIA), paid_at: aSegundos(reciente) } });
  facturasVivas.set("in_reciente_pagada", { id: "in_reciente_pagada", status: "paid" });
  assert.equal(await entregar(evento("invoice.paid", p2, Date.now())), 200);
  assert.equal(llamadasCiclo.length, 1, "camino normal intacto");
});

test("INVARIANTE (AB1): un cobro rechazado NO recorta el acceso por debajo del fin de lo ya pagado: max(fin de lo pagado, rechazo + 24 h) — rastro de la regla, pago manual vigente o periodo pagado en Stripe", async () => {
  const rechazar = async (id: string) => {
    facturasVivas.set(id, { id, status: "open" });
    const rechazo = Date.now();
    assert.equal(await entregar(evento("invoice.payment_failed", facturaFallida({ id, created: aSegundos(rechazo), status_transitions: { finalized_at: aSegundos(rechazo) } }), rechazo)), 200);
    return rechazo;
  };
  // (a) La regla de un cobro de tarjeta falló (rastro con el fin de lo pagado); Stripe renovó con el ciclo viejo y esa renovación se rechaza.
  const { fin } = await pagoConReglaFallida();
  const r1 = await rechazar("in_I2");
  assert.equal(clinica().subscriptionStatus, "past_due", "el estado sí pasa a cobro rechazado (aviso de pago)");
  assert.equal(isPlanExpired(clinica(), new Date(r1 + 25 * HORA)), false, "pero sigue con acceso a las 25 h: pagó hasta más tarde");
  assert.ok(clinica().trialEndsAt.getTime() >= fin.getTime() - 2000, "acceso = max(fin de lo pagado, rechazo + 24 h)");
  // (b) Pago MANUAL vigente (3 meses).
  conTarjetaRechazada();
  clinica().subscriptionStatus = "active";
  clinica().trialEndsAt = new Date(Date.now() + 10 * DIA);
  const tresMeses = mesesDesde(Date.now(), 3);
  pagosDeSubscripcion = [{ id: "inv_m3", clinicId: CLINIC, status: "paid", method: "transfer", amount: 2067, paidAt: new Date(Date.now() - 2 * DIA), periodStart: new Date(Date.now() - 2 * DIA), periodEnd: tresMeses }];
  await rechazar("in_I3");
  assert.ok(clinica().trialEndsAt.getTime() >= tresMeses.getTime() - 2000, "el pago manual de 3 meses protege el acceso");
  // (c) Periodo pagado a mano en Stripe (trialing + marca).
  conTarjetaRechazada();
  clinica().subscriptionStatus = "active";
  const periodo: any = suscripcion("trialing", Date.now() + 40 * DIA);
  periodo.trial_end = aSegundos(Date.now() + 40 * DIA);
  periodo.metadata.periodo_pagado_hasta = new Date(periodo.trial_end * 1000).toISOString();
  suscripcionesVivas.set(SUB, periodo);
  await rechazar("in_I4");
  assert.ok(clinica().trialEndsAt.getTime() >= periodo.trial_end * 1000 - 2000, "el periodo pagado de Stripe protege el acceso");
  // (d) NEGATIVO — el caso BEVADENT: sin ninguna evidencia de pago, el acceso baja a rechazo + 24 h aunque la base ya tuviera el periodo nuevo; y una fila de cobro de
  // Stripe con periodo futuro (p. ej. la mensualidad de un MÓDULO) NO protege al plan.
  conTarjetaRechazada();
  clinica().subscriptionStatus = "active";
  clinica().trialEndsAt = new Date(Date.now() + 30 * DIA);
  pagosDeSubscripcion = [{ id: "inv_mod", clinicId: CLINIC, status: "paid", method: "stripe", amount: 499, paidAt: new Date(), periodStart: new Date(), periodEnd: mesesDesde(Date.now(), 1) }];
  const r4 = await rechazar("in_I5");
  assert.ok(clinica().trialEndsAt.getTime() <= r4 + 25 * HORA, "BEVADENT intacto: sin evidencia de pago no se conserva el periodo que Stripe abrió");
});

test("RECORTE: el camino NORMAL (la regla se aplica al momento del pago) no cambia: suspendida 3 meses → los meses no se deben y recibe 1 mes desde el día y la hora del pago", async () => {
  const hoy = Date.now();
  reiniciar({ subscriptionStatus: "past_due", trialEndsAt: new Date(hoy - 100 * DIA), nextBillingDate: new Date(hoy + 10 * DIA) });
  suscripcionesVivas.set(SUB, suscripcion("past_due", hoy + 10 * DIA));
  facturasDeLista = [70, 40, 10].map((d, i) => facturaDeMes(`in_mes_${i + 1}`, d * DIA));
  facturasVivas.set(FACTURA, { id: FACTURA, status: "paid" });
  const pago = Date.now();
  const pagada = facturaPagada({ billing_reason: "subscription_cycle", status_transitions: { finalized_at: aSegundos(pago - 100 * DIA), paid_at: aSegundos(pago) } });
  assert.equal(await entregar(evento("invoice.paid", pagada, pago)), 200);
  const fin = mesesDesde(aSegundos(pago) * 1000, 1);
  assert.equal(llamadasAnular.length, 3);
  assert.equal(llamadasCiclo.length, 1);
  assert.ok(Math.abs(trialEndMs() - fin.getTime()) < 2000, "trial_end = pago + 1 mes");
  assert.ok(Math.abs(clinica().trialEndsAt.getTime() - fin.getTime()) < 2000);
  assert.equal(correosAdmin.length, 0, "sin avisos: todo se aplicó al momento del pago");
});

test("AB6/AB7 «Activar» a una clínica past_due SIN fecha de acceso no afirma nada de las 24 h de gracia; el aviso del botón «Reintentar» con el ajuste apagado cierra el aviso", async () => {
  reiniciar({ subscriptionStatus: "past_due", trialEndsAt: null });
  const r = await llamarAdmin({ action: "activate_clinic", clinicId: CLINIC, plan: "PRO", months: 1 });
  // Sin fecha de acceso no hay "gracia" que afirmar: el texto es neutro (nada de «24 horas de gracia», nada de una fecha inventada).
  assert.equal(r.status, 409);
  const sinFecha = ((await r.json()) as any).error as string;
  assert.doesNotMatch(sinFecha, /24 horas|gracia|hasta el/);
  assert.match(sinFecha, /Registrar pago/);
  reiniciar({ subscriptionStatus: "past_due", trialEndsAt: new Date(Date.now() + 10 * HORA) });
  const gracia = (await (await llamarAdmin({ action: "activate_clinic", clinicId: CLINIC, plan: "PRO", months: 1 })).json()) as any;
  assert.match(gracia.error, /dentro de sus 24 horas de gracia \(acceso hasta el /);
  const { readFileSync } = await import("node:fs");
  const aviso = readFileSync(path.join(RAIZ, "src/app/admin/payments/aviso-factura-tarjeta.tsx"), "utf8");
  assert.match(aviso, /AB6: lo marcado y anulado ya quedó hecho; el aviso se cierra/);
});
