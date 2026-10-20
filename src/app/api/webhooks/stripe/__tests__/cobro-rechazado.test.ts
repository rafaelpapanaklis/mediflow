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
    findFirst: async ({ where }: any) => pagosDeSubscripcion.find((p) => coincideWhere(p, where)) ?? null,
    create: async ({ data }: any) => {
      const fila = { id: `inv${pagosDeSubscripcion.length + 1}`, ...data };
      pagosDeSubscripcion.push(fila);
      return fila;
    },
  },
  $transaction: async (ops: any[]) => Promise.all(ops),
  billingEmailLog: {
    create: async ({ data }: any) => {
      if (logsCorreo.some((l) => l.invoiceId === data.invoiceId)) throw Object.assign(new Error("dup"), { code: "P2002" });
      logsCorreo.push(data);
      return data;
    },
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
      if (!s) throw new Error("No such subscription");
      return s;
    },
  },
  invoices: {
    retrieve: async (id: string) => {
      const f = facturasVivas.get(id);
      if (!f) throw new Error("No such invoice");
      return f;
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
    recordStripeInvoice: async (inv: any, clinicId: string, estado?: string) => {
      facturasRegistradas.push({ id: inv.id, clinicId, estado: estado ?? "paid" });
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
  dobles.set(path.join(RAIZ, "src/lib/admin-audit.ts"), { logAdminClinicMutation: async () => {} });
  dobles.set(path.join(RAIZ, "src/lib/analytics/meta-capi.server.ts"), { enviarCompraMetaDeSesion: async () => {} });
  dobles.set(path.join(RAIZ, "src/lib/analytics/tiktok-capi.server.ts"), { enviarCompraTiktokDeSesion: async () => {} });
  ({ NextRequest: NextRequestCtor } = await import("next/server"));
  ({ POST } = await import("../route"));
  ({ POST: POSTAdmin } = await import("../../../admin/billing/route"));
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
    body: JSON.stringify({ action: "activate_clinic", clinicId: CLINIC, plan: "PRO", months: 1 }),
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

test("#1 residual: la activación del admin con el método que él indique lo guarda; uno inválido cae a «admin»", async () => {
  for (const [enviado, guardado] of [["cash", "cash"], ["paypal", "paypal"], ["stripe", "admin"], ["loquesea", "admin"]] as const) {
    reiniciar();
    const req = new NextRequestCtor("http://localhost/api/admin/billing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "activate_clinic", clinicId: CLINIC, plan: "PRO", months: 1, method: enviado }),
    });
    assert.equal((await POSTAdmin(req)).status, 200);
    assert.equal(pagosDeSubscripcion[0].method, guardado, enviado);
  }
});
