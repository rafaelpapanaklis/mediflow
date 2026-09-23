/**
 * El portal del paciente cobra con Mercado Pago (ws1-t2) — el camino del dinero
 * ENTERO, con el código real.
 *
 * Run: npm run test:portal-mercadopago
 *
 * Se cargan de verdad:
 *   · POST /api/paciente/payments/mercadopago (lo que pide el paciente),
 *   · GET  /api/paciente/payments (qué botón ve),
 *   · POST /api/webhooks/mercadopago (lo que acredita el pago, con su firma),
 *   · src/lib/factura-mp/servicio.server.ts con `depsReales`,
 *   · y la pantalla (`PanelMercadoPago`) para el QR.
 * Lo único sustituido, por ruta resuelta: Prisma (la base en memoria con
 * candados de factura-mp), la API de Mercado Pago, la cuenta OAuth de cada
 * clínica, la sesión del portal, Stripe y el rate limit. Ni red ni base.
 */

import Module from "node:module";
import path from "node:path";
import { createHmac } from "node:crypto";
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import { DobleBase } from "../../../../../lib/factura-mp/__tests__/doble-base";
import type { MercadoPagoPayment } from "../../../../../lib/mercadopago";
import type { PatientPortalContext } from "../../../../../lib/patient-portal/types";

const RAIZ = path.resolve(__dirname, "../../../../../..");

let db = new DobleBase();
const pagosMp = new Map<string, MercadoPagoPayment>();
let preferencias: Array<{ token: string; opts: any }> = [];
let urlQueDevuelveMp: ((ref: string) => string) | null = null;
let sesion: PatientPortalContext | null = null;
/** Clínicas con cuenta de Mercado Pago conectada (la credencial OAuth). */
let cuentasMp = new Map<string, { accessToken: string; mpUserId: string }>();
let stripeListo = false;
let usuariosStripe: Array<{ clinicId: string; role: string; createdAt: Date; stripeAccountId: string; isActive: boolean }> = [];
/** Expedientes borrados (Patient.deletedAt). */
let borrados = new Set<string>();
/** Vínculos cuenta ↔ expediente que ve GET /api/paciente/payments. */
let vinculos: Array<{ accountId: string; clinicId: string; patientId: string; patientNumber: string }> = [];

function urlMp(ref: string) {
  return `https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=pref-${encodeURIComponent(ref)}`;
}

// Proxy: cada prueba cambia de base sin recargar módulos. Lo que la base en
// memoria no sabe (el include anidado de los vínculos y los usuarios de Stripe)
// se contesta aquí, filtrando igual que Postgres.
const prismaDoble = new Proxy(
  {},
  {
    get: (_t, k) => {
      if (k === "patientAccountLink") {
        return {
          findMany: async (args: any) => {
            assert.ok(args.where.accountId, "los vínculos se leen por la cuenta de la sesión");
            return vinculos
              .filter((v) => v.accountId === args.where.accountId)
              .map((v) => {
                const c = db.tablas.clinic.find((x) => x.id === v.clinicId);
                return {
                  clinicId: v.clinicId,
                  patient: {
                    id: v.patientId,
                    patientNumber: v.patientNumber,
                    clinic: { id: c.id, name: c.name, slug: c.id, logoUrl: null, city: null, phone: null },
                  },
                };
              });
          },
        };
      }
      if (k === "invoice") {
        // `patient: { deletedAt: null }` es una relación que la base en memoria
        // no conoce: se aplica aquí y el resto del where lo filtra ella.
        const real = db.db().invoice;
        return {
          ...real,
          findFirst: async (args: any) => {
            const { patient, ...where } = args.where ?? {};
            if (patient !== undefined) assert.deepEqual(patient, { deletedAt: null });
            const filas = await real.findMany({ ...args, where, select: undefined });
            const fila = filas.find((f: any) => patient === undefined || !borrados.has(f.patientId));
            return fila ? real.findFirst({ ...args, where: { ...where, id: fila.id } }) : null;
          },
        };
      }
      if (k === "user") {
        return {
          findMany: async (args: any) =>
            usuariosStripe.filter(
              (u) => args.where.clinicId.in.includes(u.clinicId) && u.isActive && u.stripeAccountId,
            ),
        };
      }
      return db.db()[k as string];
    },
  },
);

const dobles = new Map<string, unknown>([
  [path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prismaDoble }],
  [
    path.join(RAIZ, "src/lib/mercadopago.ts"),
    {
      getPayment: async (_token: string, id: string) => pagosMp.get(id) ?? null,
      createPreference: async (token: string, opts: { externalReference: string }) => {
        preferencias.push({ token, opts });
        return {
          id: `pref-${opts.externalReference}`,
          initPoint: (urlQueDevuelveMp ?? urlMp)(opts.externalReference),
        };
      },
      expirePreference: async () => {},
    },
  ],
  [
    path.join(RAIZ, "src/lib/anticipos/cuenta.server.ts"),
    {
      credencialDeCobro: async (clinicId: string) => cuentasMp.get(clinicId) ?? null,
      plataformaAnticipos: () => ({ lista: true, falta: [] }),
      urlBaseApp: () => "https://app.dalecontrol.test",
    },
  ],
  [
    path.join(RAIZ, "src/lib/patient-portal/guard.ts"),
    {
      getPatientPortalContext: async () => sesion,
      pacienteUnauthorized: () => new Response(JSON.stringify({ error: "No autenticado" }), { status: 401 }),
    },
  ],
  [path.join(RAIZ, "src/lib/rate-limit.ts"), { rateLimit: () => null }],
  [path.join(RAIZ, "src/lib/stripe.ts"), { getStripeSafe: () => (stripeListo ? {} : null) }],
  [path.join(RAIZ, "src/lib/anticipos/servicio.server.ts"), { aplicarPagoDeAnticipo: async () => {} }],
  [path.join(RAIZ, "src/lib/ai-wallet/mercadopago.ts"), { verifyAndCreditMpTopup: async () => { throw new Error("rama equivocada"); } }],
  [path.join(RAIZ, "src/lib/cache/revalidate.ts"), { revalidateAfter: () => {} }],
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

const SECRETO = "secreto-del-webhook";
process.env.MERCADOPAGO_WEBHOOK_SECRET = SECRETO;

let NextRequest: typeof import("next/server").NextRequest;
let pedirLink: typeof import("../mercadopago/route").POST;
let listaDePagos: typeof import("../route").GET;
let webhook: typeof import("@/app/api/webhooks/mercadopago/route").POST;
let servicio: typeof import("@/lib/factura-mp/servicio.server");
let pantalla: typeof import("@/components/paciente/pago-mercadopago");
let reglas: typeof import("@/lib/patient-portal/pago-mercadopago");

before(async () => {
  ({ NextRequest } = await import("next/server"));
  ({ POST: pedirLink } = await import("../mercadopago/route"));
  ({ GET: listaDePagos } = await import("../route"));
  ({ POST: webhook } = await import("@/app/api/webhooks/mercadopago/route"));
  servicio = await import("@/lib/factura-mp/servicio.server");
  pantalla = await import("@/components/paciente/pago-mercadopago");
  reglas = await import("@/lib/patient-portal/pago-mercadopago");
});

function factura(id: string, clinicId: string, patientId: string, extra: Record<string, unknown> = {}) {
  return {
    id, clinicId, patientId, invoiceNumber: `F-${id}`, status: "PENDING",
    total: 2400, paid: 0, balance: 2400, paymentMethod: null, paidAt: null,
    createdAt: new Date("2026-09-20T12:00:00Z"), dueDate: null,
    ...extra,
  };
}

beforeEach(() => {
  db = new DobleBase();
  (db.tablas as any).user = [];
  db.tablas.clinic.push({ id: "c1", name: "Clínica Sonrisa" }, { id: "c2", name: "Otra Clínica" });
  db.tablas.clinicMercadoPago.push({ clinicId: "c1", mpUserId: "999", accessToken: "v1:cifrado" });
  // Ana (p1, c1) — la dueña de la sesión. Beto (p2, c1) — otro paciente de la
  // MISMA clínica. p9 en c2 — otra clínica, sin Mercado Pago.
  db.tablas.invoice.push(
    factura("f1", "c1", "p1"),
    factura("f2", "c1", "p2"),
    factura("f3", "c2", "p9"),
    // Una factura de c2 a nombre de p1 (no debería existir): la pareja
    // (patientId, clinicId) no es la de ningún vínculo.
    factura("f4", "c2", "p1"),
  );
  pagosMp.clear();
  preferencias = [];
  urlQueDevuelveMp = null;
  cuentasMp = new Map([["c1", { accessToken: "tok-c1", mpUserId: "999" }]]);
  stripeListo = false;
  borrados = new Set();
  usuariosStripe = [];
  vinculos = [{ accountId: "acc-ana", clinicId: "c1", patientId: "p1", patientNumber: "P-0001" }];
  sesion = {
    account: { id: "acc-ana", name: "Ana", email: "ana@test.mx", phone: null },
    links: [{ patientId: "p1", clinicId: "c1" }],
  };
});

function pedido(body: unknown) {
  return new NextRequest("https://app.dalecontrol.test/api/paciente/payments/mercadopago", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function firmar(paymentId: string) {
  const ts = "1758643200";
  const manifiesto = `id:${paymentId};request-id:req-1;ts:${ts};`;
  return `ts=${ts},v1=${createHmac("sha256", SECRETO).update(manifiesto).digest("hex")}`;
}

function notificacion(ref: string, paymentId: string) {
  return new NextRequest(
    `https://app.dalecontrol.test/api/webhooks/mercadopago?ref=${encodeURIComponent(ref)}&data.id=${paymentId}&type=payment`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "req-1", "x-signature": firmar(paymentId) },
      body: JSON.stringify({ type: "payment", data: { id: paymentId } }),
    },
  );
}

function aprobado(id: string, linkId: string, monto = 2400): MercadoPagoPayment {
  return {
    id, status: "approved", statusDetail: "accredited", externalReference: `factura:${linkId}`,
    transactionAmount: monto, currencyId: "MXN", transactionAmountRefunded: 0,
    dateApproved: "2026-09-23T09:00:00.000-06:00", collectorId: "999",
    payerEmail: null, paymentMethodId: "visa",
  };
}

// ── 1. El paciente pide el link de SU factura ──────────────────────────────

test("el paciente pide el link de su factura → el link de factura-mp por el saldo, cobrado por SU clínica", async () => {
  const res = await pedirLink(pedido({ invoiceId: "f1" }));
  assert.equal(res.status, 200);
  const cuerpo = await res.json();
  const fila = db.tablas.invoicePaymentLink[0];
  assert.equal(db.tablas.invoicePaymentLink.length, 1);
  assert.equal(fila.clinicId, "c1");
  assert.equal(fila.invoiceId, "f1");
  assert.equal(fila.amount, 2400);
  assert.equal(fila.createdById, null, "no lo creó un usuario del panel");
  assert.deepEqual(cuerpo, { url: fila.checkoutUrl, monto: 2400, venceA: fila.expiresAt.toISOString() });
  // Nace IGUAL que el del panel: el webhook de siempre lo reconoce.
  assert.equal(preferencias.length, 1);
  assert.equal(preferencias[0].token, "tok-c1", "cobra la cuenta de la clínica de la factura");
  assert.equal(preferencias[0].opts.externalReference, `factura:${fila.id}`);
  assert.equal(
    preferencias[0].opts.notificationUrl,
    `https://app.dalecontrol.test/api/webhooks/mercadopago?ref=${encodeURIComponent(`factura:${fila.id}`)}`,
  );
  assert.equal(preferencias[0].opts.items[0].unit_price, 2400);
  assert.equal(preferencias[0].opts.marketplaceFee, 0);
});

test("el paciente NO manda montos ni clínica: lo que venga en el body además del id se ignora", async () => {
  const res = await pedirLink(pedido({ invoiceId: "f1", monto: 1, amount: 1, clinicId: "c2", patientId: "p2" }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).monto, 2400);
  assert.equal(db.tablas.invoicePaymentLink[0].amount, 2400);
  assert.equal(db.tablas.invoicePaymentLink[0].clinicId, "c1");
  assert.equal(preferencias[0].opts.items[0].unit_price, 2400);
});

test("el link del portal ES el mismo que manda la recepción: pedirlo otra vez no crea otro", async () => {
  // La recepción ya lo mandó por WhatsApp desde el panel.
  const panel = await servicio.obtenerLinkDeFactura({ clinicId: "c1", invoiceId: "f1", userId: "u-recepcion" });
  assert.ok(panel.link);
  const a = await (await pedirLink(pedido({ invoiceId: "f1" }))).json();
  const b = await (await pedirLink(pedido({ invoiceId: "f1" }))).json();
  assert.equal(a.url, panel.link.url);
  assert.equal(b.url, panel.link.url);
  assert.equal(preferencias.length, 1, "una sola preferencia en Mercado Pago");
  assert.equal(db.tablas.invoicePaymentLink.length, 1);
});

test("dos toques a la vez (doble clic, dos pestañas) → UN link", async () => {
  const [a, b] = await Promise.all([pedirLink(pedido({ invoiceId: "f1" })), pedirLink(pedido({ invoiceId: "f1" }))]);
  assert.deepEqual([a.status, b.status], [200, 200]);
  assert.equal((await a.json()).url, (await b.json()).url);
  assert.equal(db.tablas.invoicePaymentLink.length, 1);
  assert.equal(preferencias.length, 1);
});

// ── 2. Lo que debe fallar ──────────────────────────────────────────────────

test("factura de OTRO paciente de la misma clínica → 404, sin link y sin tocar Mercado Pago", async () => {
  const res = await pedirLink(pedido({ invoiceId: "f2" }));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).code, "no_encontrada");
  assert.equal(db.tablas.invoicePaymentLink.length, 0);
  assert.equal(preferencias.length, 0);
});

test("factura de otra clínica (aunque diga el mismo patientId) o que no existe → 404", async () => {
  for (const invoiceId of ["f3", "f4", "no-existe"]) {
    const res = await pedirLink(pedido({ invoiceId }));
    assert.equal(res.status, 404, invoiceId);
  }
  assert.equal(db.tablas.invoicePaymentLink.length, 0);
  assert.equal(preferencias.length, 0);
});

test("expediente BORRADO por la clínica → 404 aunque la factura siga pendiente", async () => {
  borrados.add("p1");
  assert.equal((await pedirLink(pedido({ invoiceId: "f1" }))).status, 404);
  assert.equal(preferencias.length, 0);
  borrados.clear();
  assert.equal((await pedirLink(pedido({ invoiceId: "f1" }))).status, 200, "control: sin borrar sí sale");
});

test("sin sesión → 401; sin vínculos → 404; sin invoiceId → 400. Nada llega a Mercado Pago", async () => {
  sesion = null;
  assert.equal((await pedirLink(pedido({ invoiceId: "f1" }))).status, 401);
  sesion = { account: { id: "acc-x", name: "X", email: "x@test.mx", phone: null }, links: [] };
  assert.equal((await pedirLink(pedido({ invoiceId: "f1" }))).status, 404);
  sesion = { account: { id: "acc-ana", name: "Ana", email: "ana@test.mx", phone: null }, links: [{ patientId: "p1", clinicId: "c1" }] };
  for (const body of [{}, { invoiceId: 7 }, { invoiceId: "" }, null]) {
    assert.equal((await pedirLink(pedido(body))).status, 400);
  }
  assert.equal(preferencias.length, 0);
});

test("saldo 0: pagada → 404; PENDING con saldo 0 → 400 sin_saldo; saldo bajo el mínimo → 400. Sin link", async () => {
  db.tablas.invoice[0] = factura("f1", "c1", "p1", { status: "PAID", paid: 2400, balance: 0 });
  assert.equal((await pedirLink(pedido({ invoiceId: "f1" }))).status, 404);

  db.tablas.invoice[0] = factura("f1", "c1", "p1", { status: "PENDING", paid: 2400, balance: 0 });
  let res = await pedirLink(pedido({ invoiceId: "f1" }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, "sin_saldo");

  db.tablas.invoice[0] = factura("f1", "c1", "p1", { status: "PARTIAL", paid: 2395, balance: 5 });
  res = await pedirLink(pedido({ invoiceId: "f1" }));
  assert.equal(res.status, 400);
  const cuerpo = await res.json();
  assert.equal(cuerpo.code, "bajo_minimo");
  assert.match(cuerpo.error, /\$10\.00/);

  for (const status of ["CANCELLED", "DRAFT"]) {
    db.tablas.invoice[0] = factura("f1", "c1", "p1", { status });
    assert.equal((await pedirLink(pedido({ invoiceId: "f1" }))).status, 404, status);
  }
  assert.equal(db.tablas.invoicePaymentLink.length, 0);
  assert.equal(preferencias.length, 0);
});

test("balance > 0 pero total − pagado = 0 (columna desfasada) → no se cobra nada", async () => {
  db.tablas.invoice[0] = factura("f1", "c1", "p1", { status: "PARTIAL", paid: 2400, balance: 300 });
  const res = await pedirLink(pedido({ invoiceId: "f1" }));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, "sin_saldo");
  assert.equal(preferencias.length, 0);
});

test("clínica SIN Mercado Pago → 409 sin_mp y el portal dice «Paga en tu clínica»", async () => {
  cuentasMp = new Map();
  db.tablas.clinicMercadoPago = [];
  const res = await pedirLink(pedido({ invoiceId: "f1" }));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, "sin_mp");
  assert.equal(preferencias.length, 0);

  const lista = await (await listaDePagos()).json();
  assert.equal(lista.clinics[0].onlinePaymentMethod, null);
  assert.equal(lista.clinics[0].onlinePaymentEnabled, false);
});

test("SQL de invoice_payment_links sin aplicar → la clínica cuenta como sin Mercado Pago (ni botón ni error)", async () => {
  db.sinTabla.add("invoicePaymentLink");
  const lista = await (await listaDePagos()).json();
  assert.equal(lista.clinics[0].onlinePaymentMethod, null);
  assert.equal((await pedirLink(pedido({ invoiceId: "f1" }))).status, 409);
});

test("Mercado Pago contesta con una URL que no es suya → 502 y no se entrega nada", async () => {
  for (const mala of ["https://mercadopago.com.mx.evil.test/x", "javascript:alert(1)", "http://www.mercadopago.com.mx/x"]) {
    db = new DobleBase();
    db.tablas.clinic.push({ id: "c1", name: "Clínica Sonrisa" });
    db.tablas.clinicMercadoPago.push({ clinicId: "c1", mpUserId: "999", accessToken: "v1:cifrado" });
    db.tablas.invoice.push(factura("f1", "c1", "p1"));
    urlQueDevuelveMp = () => mala;
    const res = await pedirLink(pedido({ invoiceId: "f1" }));
    assert.equal(res.status, 502, mala);
    const cuerpo = await res.json();
    assert.equal(cuerpo.url, undefined);
  }
});

// ── 3. Qué botón ve el paciente ────────────────────────────────────────────

test("con Mercado Pago y Stripe Connect a la vez, el portal ofrece Mercado Pago; solo Stripe → Stripe", async () => {
  stripeListo = true;
  usuariosStripe = [{ clinicId: "c1", role: "ADMIN", createdAt: new Date(0), stripeAccountId: "acct_1", isActive: true }];
  let lista = await (await listaDePagos()).json();
  assert.equal(lista.clinics[0].onlinePaymentMethod, "mercadopago");
  assert.equal(lista.clinics[0].onlinePaymentEnabled, true);

  cuentasMp = new Map();
  db.tablas.clinicMercadoPago = [];
  lista = await (await listaDePagos()).json();
  assert.equal(lista.clinics[0].onlinePaymentMethod, "stripe", "Stripe se queda como segunda vía");
  assert.equal(lista.clinics[0].onlinePaymentEnabled, true);
});

test("la lista de pagos no manda nada del link ni de la cuenta de MP", async () => {
  await pedirLink(pedido({ invoiceId: "f1" }));
  const texto = JSON.stringify(await (await listaDePagos()).json());
  assert.doesNotMatch(texto, /mercadopago\.com|pref-|tok-c1|999/);
});

test("metodoDePagoEnLinea: Mercado Pago primero", () => {
  assert.equal(reglas.metodoDePagoEnLinea({ mercadoPago: true, stripe: true }), "mercadopago");
  assert.equal(reglas.metodoDePagoEnLinea({ mercadoPago: true, stripe: false }), "mercadopago");
  assert.equal(reglas.metodoDePagoEnLinea({ mercadoPago: false, stripe: true }), "stripe");
  assert.equal(reglas.metodoDePagoEnLinea({ mercadoPago: false, stripe: false }), null);
});

// ── 4. Al acreditarse, la factura queda pagada sola (el webhook de siempre) ─

test("pago aprobado del link del portal → Payment «mercadopago» y factura PAGADA; MP repite la notificación → un solo Payment", async () => {
  await pedirLink(pedido({ invoiceId: "f1" }));
  const link = db.tablas.invoicePaymentLink[0];
  pagosMp.set("7001", aprobado("7001", link.id));

  const primera = await webhook(notificacion(`factura:${link.id}`, "7001"));
  assert.equal(primera.status, 200);
  const repetidas = await Promise.all([1, 2, 3].map(() => webhook(notificacion(`factura:${link.id}`, "7001"))));
  assert.deepEqual(repetidas.map((r) => r.status), [200, 200, 200]);
  assert.equal((await webhook(notificacion(`factura:${link.id}`, "7001"))).status, 200);

  assert.equal(db.tablas.payment.length, 1, "el pago se aplica UNA vez");
  assert.equal(db.tablas.payment[0].invoiceId, "f1");
  assert.equal(db.tablas.payment[0].method, "mercadopago");
  assert.equal(db.tablas.payment[0].amount, 2400);
  const inv = db.tablas.invoice[0];
  assert.equal(inv.status, "PAID");
  assert.equal(inv.paid, 2400);
  assert.equal(inv.balance, 0);
  assert.equal(link.status, "PAID");

  // Y el portal ya no ofrece pagarla.
  const res = await pedirLink(pedido({ invoiceId: "f1" }));
  assert.equal(res.status, 404);
  // f4 (la factura imposible de c2 a nombre de p1) no es de este caso.
  db.tablas.invoice = db.tablas.invoice.filter((f) => f.id !== "f4");
  const lista = await (await listaDePagos()).json();
  assert.equal(lista.invoices.find((f: any) => f.id === "f1").status, "PAID");
  assert.equal(lista.totals.pendingTotal, 0);
});

test("un pago del link de la factura de Ana no toca la de Beto (misma clínica)", async () => {
  await pedirLink(pedido({ invoiceId: "f1" }));
  const link = db.tablas.invoicePaymentLink[0];
  pagosMp.set("7002", aprobado("7002", link.id));
  await webhook(notificacion(`factura:${link.id}`, "7002"));
  assert.equal(db.tablas.invoice.find((f) => f.id === "f2")!.paid, 0);
  assert.equal(db.tablas.invoice.find((f) => f.id === "f2")!.status, "PENDING");
});

// ── 5. El QR apunta al link correcto ───────────────────────────────────────

function pathDelQr(html: string): string {
  const paths = Array.from(html.matchAll(/<path[^>]* d="([^"]+)"/g)).map((m) => m[1]);
  assert.ok(paths.length > 0, "hay un QR pintado");
  // El de los módulos oscuros es el más largo (el otro es el fondo).
  return paths.sort((a, b) => b.length - a.length)[0];
}

test("el QR y el botón del panel son la URL que devolvió el servidor, y no otra", async () => {
  const cuerpo = await (await pedirLink(pedido({ invoiceId: "f1" }))).json();
  const pago = { link: cuerpo, pidiendo: false, error: null, pedir: () => {}, ocultar: () => {} };
  const html = renderToStaticMarkup(createElement(pantalla.PanelMercadoPago, { pago, invoiceNumber: "F-f1" }));

  const esperado = renderToStaticMarkup(createElement(QRCodeSVG, { value: cuerpo.url, size: 168, level: "M", marginSize: 0 }));
  assert.equal(pathDelQr(html), pathDelQr(esperado), "el QR codifica exactamente esa URL");

  // Control: el QR de OTRO link (otra factura) es distinto — la comparación de arriba sí discrimina.
  const otro = renderToStaticMarkup(createElement(QRCodeSVG, { value: urlMp("factura:otro"), size: 168, level: "M", marginSize: 0 }));
  assert.notEqual(pathDelQr(html), pathDelQr(otro));

  const hrefs = Array.from(html.matchAll(/href="([^"]+)"/g)).map((m) => m[1].replace(/&amp;/g, "&"));
  assert.deepEqual(hrefs, [cuerpo.url], "el botón lleva al mismo link");
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /Paga \$2,400\.00 con Mercado Pago/);
});

test("el panel no pinta NADA con una URL que no es de Mercado Pago", () => {
  for (const url of ["javascript:alert(1)", "https://evil.test/pago", "http://www.mercadopago.com.mx/x", "https://mercadopago.com.mx.evil.test/"]) {
    const pago = { link: { url, monto: 2400, venceA: "" }, pidiendo: false, error: null, pedir: () => {}, ocultar: () => {} };
    assert.equal(renderToStaticMarkup(createElement(pantalla.PanelMercadoPago, { pago, invoiceNumber: "F-1" })), "", url);
  }
});

test("esUrlDeMercadoPago", () => {
  assert.ok(reglas.esUrlDeMercadoPago("https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=1"));
  assert.ok(reglas.esUrlDeMercadoPago("https://sandbox.mercadopago.com.mx/checkout/v1/redirect?pref_id=1"));
  assert.ok(reglas.esUrlDeMercadoPago("https://mercadopago.com/x"));
  for (const mala of [
    "http://www.mercadopago.com.mx/x", "https://mercadopago.com.mx.evil.test/", "https://evilmercadopago.com.mx/",
    "https://user:pw@www.mercadopago.com.mx/", "https://www.mercadopago.com.mx:8443/", "javascript:alert(1)", "", null, 5,
  ]) {
    assert.equal(reglas.esUrlDeMercadoPago(mala), false, String(mala));
  }
});

// ── 6. Textos es / en ──────────────────────────────────────────────────────

test("los textos del portal: el respaldo en español es EXACTAMENTE es.json, y en.json tiene las mismas llaves", async () => {
  const es = (await import("@/i18n/dictionaries/es.json")).default as any;
  const en = (await import("@/i18n/dictionaries/en.json")).default as any;
  assert.deepEqual(es.portalPagoMp, reglas.TEXTOS_PAGO_MP_ES);
  const llaves = (o: any, p = ""): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [p + k] : llaves(v, `${p}${k}.`)));
  assert.deepEqual(llaves(en.portalPagoMp).sort(), llaves(es.portalPagoMp).sort());
  for (const k of llaves(en.portalPagoMp)) {
    const valor = k.split(".").reduce((o: any, p) => o[p], en.portalPagoMp);
    const enEs = k.split(".").reduce((o: any, p) => o[p], es.portalPagoMp);
    assert.notEqual(valor, enEs, `«${k}» sin traducir`);
    assert.deepEqual(valor.match(/\{\w+\}/g), enEs.match(/\{\w+\}/g), `«${k}»: mismas variables`);
  }
});
