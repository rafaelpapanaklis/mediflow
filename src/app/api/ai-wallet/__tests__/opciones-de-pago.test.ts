/**
 * SALDO IA — las opciones de pago que se ofrecen tienen que existir.
 *
 * Run: npm run test:saldo-opciones-de-pago
 *
 *  C · Mercado Pago: DaleControl no tiene cuenta. La opción depende de que
 *      exista `MERCADOPAGO_ACCESS_TOKEN` (decisión del servidor), y la ruta de
 *      checkout contesta «no disponible» sin tocar nada en vez de un 500. El
 *      código de MP (lib, ruta, rama del webhook) se queda.
 *  D · SPEI: el punto de entrada es un ticket de soporte con el mensaje ya
 *      escrito (clínica + monto), por `createTicket()`. El comprobante se queda
 *      como segundo paso.
 *
 * Conduce las rutas reales con dobles de sesión, prisma, env y soporte.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..", ".."); // src/
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

// ── Dobles ──────────────────────────────────────────────────────────────────

let ctx: any;
(mock as any).module("@/lib/auth-context", {
  namedExports: { getAuthContext: async () => ctx },
});

const envDoble: { MERCADOPAGO_ACCESS_TOKEN?: string } = {};
(mock as any).module("@/env", { namedExports: { env: envDoble } });

const escrituras: Array<{ que: string; data: any }> = [];
(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      aiTopup: {
        create: async ({ data }: any) => {
          escrituras.push({ que: "aiTopup.create", data });
          return { id: "topup_mp_1", ...data };
        },
        update: async ({ data }: any) => {
          escrituras.push({ que: "aiTopup.update", data });
          return {};
        },
      },
    },
  },
});

const preferencias: any[] = [];
(mock as any).module("@/lib/mercadopago", {
  namedExports: {
    createPreference: async (token: string, p: any) => {
      preferencias.push({ token, p });
      return { id: "pref_1", initPoint: "https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=pref_1" };
    },
  },
});
(mock as any).module("@/lib/ai-wallet/mercadopago", {
  namedExports: { buildMpTopupRef: (id: string) => `aitopup:${id}` },
});

const tickets: any[] = [];
(mock as any).module("@/lib/support/service", {
  namedExports: {
    createTicket: async (input: any) => {
      tickets.push(input);
      return { id: "tk_1", folio: 42, folioLabel: "#DC-0042", subject: input.subject };
    },
  },
});

const req = (body: unknown) => ({ json: async () => body }) as any;

async function checkoutMp(body: unknown) {
  const { POST } = await import("@/app/api/ai-wallet/mercadopago/checkout/route");
  const res = await POST(req(body));
  return { status: res.status, body: await res.json() };
}

async function ticketSpei(body: unknown) {
  const { POST } = await import("@/app/api/ai-wallet/spei/ticket/route");
  const res = await POST(req(body));
  return { status: res.status, body: await res.json() };
}

const ADMIN = {
  userId: "u1",
  clinicId: "c1",
  isAdmin: true,
  user: { firstName: "Ana", lastName: "Pérez" },
  clinic: { name: "BEVADENT", locale: "es" },
};

beforeEach(() => {
  ctx = { ...ADMIN };
  delete envDoble.MERCADOPAGO_ACCESS_TOKEN;
  escrituras.length = 0;
  preferencias.length = 0;
  tickets.length = 0;
  process.env.NEXT_PUBLIC_APP_URL = "https://app.dalecontrol.test";
});

// ═══════════════════════════════════════════════════════════════════════════
// C · Mercado Pago
// ═══════════════════════════════════════════════════════════════════════════

test("C · sin token de Mercado Pago la opción no se ofrece", async () => {
  const { mercadoPagoConfigurado } = await import("@/lib/ai-wallet/metodos-recarga");
  assert.equal(mercadoPagoConfigurado(), false);
  envDoble.MERCADOPAGO_ACCESS_TOKEN = "   ";
  assert.equal(mercadoPagoConfigurado(), false, "un token en blanco no cuenta");
  envDoble.MERCADOPAGO_ACCESS_TOKEN = "APP_USR-123";
  assert.equal(mercadoPagoConfigurado(), true, "el día que aparezca el token, la opción vuelve sola");
});

test("C · la ruta de checkout contesta «no disponible» (503) sin crear nada", async () => {
  const { status, body } = await checkoutMp({ amountCents: 50000 });
  assert.equal(status, 503);
  assert.equal(body.code, "MP_NO_DISPONIBLE");
  assert.deepEqual(escrituras, [], "no se crea ninguna recarga PENDING");
  assert.deepEqual(preferencias, [], "no se llama a Mercado Pago");
});

test("C · con token, el camino de Mercado Pago sigue intacto", async () => {
  envDoble.MERCADOPAGO_ACCESS_TOKEN = "APP_USR-123";
  const { status, body } = await checkoutMp({ amountCents: 50000 });
  assert.equal(status, 200);
  assert.match(body.initPoint, /mercadopago/);
  assert.equal(preferencias[0].token, "APP_USR-123");
  assert.equal(escrituras[0].que, "aiTopup.create");
  assert.equal(escrituras[0].data.clinicId, "c1");
});

test("C · la decisión es del servidor y el código de Mercado Pago se queda", () => {
  const page = leer("app/dashboard/whatsapp/bot/saldo/page.tsx");
  assert.match(page, /mercadoPago=\{mercadoPagoConfigurado\(\)\}/, "la página no pasa la decisión del servidor");
  const cliente = leer("app/dashboard/whatsapp/bot/saldo/saldo-client.tsx");
  assert.match(cliente, /mercadoPago = false/, "sin la prop, Mercado Pago no se ofrece");
  for (const rel of ["app/dashboard/whatsapp/bot/saldo/saldo-client.tsx", "components/dashboard/whatsapp-rediseno/saldo.tsx"]) {
    const src = leer(rel);
    assert.match(src, /\{mercadoPago && \(\s*<[A-Za-z]+[\s\S]{0,200}?\/api\/ai-wallet\/mercadopago\/checkout/, `${rel}: el botón de MP no depende de la decisión`);
  }
  // No se borra: la lib, la ruta y la rama del webhook siguen.
  assert.ok(existsSync(join(SRC, "lib/ai-wallet/mercadopago.ts")));
  assert.ok(existsSync(join(SRC, "app/api/ai-wallet/mercadopago/checkout/route.ts")));
  assert.match(leer("app/api/webhooks/mercadopago/route.ts"), /verifyAndCreditMpTopup/);
});

// ═══════════════════════════════════════════════════════════════════════════
// D · SPEI abre un ticket
// ═══════════════════════════════════════════════════════════════════════════

test("D · SPEI abre un ticket con el mensaje ya escrito: clínica, monto y quién lo pide", async () => {
  const { status, body } = await ticketSpei({ amountCents: 150000, clinicId: "OTRA-CLINICA" });
  assert.equal(status, 201);
  assert.deepEqual(body.ticket, { id: "tk_1", folioLabel: "#DC-0042" });
  assert.equal(tickets.length, 1);
  const [t] = tickets;
  assert.equal(t.clinicId, "c1", "la clínica sale de la sesión, nunca del body");
  assert.equal(t.userId, "u1");
  assert.equal(t.category, "FACTURACION");
  assert.equal(t.subject, "Recarga de saldo IA por SPEI — $1,500.00 MXN");
  assert.match(t.body, /Clínica: BEVADENT/);
  assert.match(t.body, /Monto a recargar: \$1,500\.00 MXN/);
  assert.match(t.body, /Lo solicita: Ana Pérez/);
  assert.match(t.body, /datos para transferir \(banco, CLABE y beneficiario\)/);
});

test("D · en inglés si la clínica usa el panel en inglés", async () => {
  ctx = { ...ADMIN, clinic: { name: "Smile Co", locale: "en" } };
  await ticketSpei({ amountCents: 20000 });
  const [t] = tickets;
  assert.equal(t.subject, "AI balance top-up via SPEI — $200.00 MXN");
  assert.match(t.body, /Clinic: Smile Co/);
  assert.match(t.body, /Amount to top up: \$200\.00 MXN/);
});

test("D · sin monto válido no se abre ticket (soporte tendría que volver a preguntar)", async () => {
  for (const amountCents of [undefined, "abc", 4_999, 12_345.5, 50_000_001]) {
    const { status, body } = await ticketSpei({ amountCents });
    assert.equal(status, 400, `monto ${String(amountCents)}`);
    assert.equal(body.code, "MONTO_INVALIDO");
  }
  assert.equal(tickets.length, 0);
});

test("D · solo administradores, y con sesión", async () => {
  ctx = { ...ADMIN, isAdmin: false };
  assert.equal((await ticketSpei({ amountCents: 50000 })).status, 403);
  ctx = null;
  assert.equal((await ticketSpei({ amountCents: 50000 })).status, 401);
  assert.equal(tickets.length, 0);
});

test("D · el comprobante no se borra: sigue siendo el segundo paso", () => {
  assert.ok(existsSync(join(SRC, "app/api/ai-wallet/spei/topup/route.ts")));
  const cliente = leer("app/dashboard/whatsapp/bot/saldo/saldo-client.tsx");
  assert.match(cliente, /fetch\("\/api\/ai-wallet\/spei\/ticket"/, "el primer paso es el ticket");
  assert.match(cliente, /fetch\("\/api\/ai-wallet\/spei\/topup"/, "el comprobante sigue");
  for (const rel of ["app/dashboard/whatsapp/bot/saldo/saldo-client.tsx", "components/dashboard/whatsapp-rediseno/saldo.tsx"]) {
    const src = leer(rel);
    // Tras crearlo, la pantalla dice qué pasó y qué sigue, y enlaza el ticket.
    for (const clave of ["saldoIa.spei.doneTitle", "saldoIa.spei.doneStep1", "saldoIa.spei.doneStep3", "saldoIa.spei.alreadyPaid"]) {
      assert.ok(src.includes(`"${clave}"`), `${rel} no pinta ${clave}`);
    }
    assert.ok(src.includes("/dashboard/soporte/${speiTicket.id}"), `${rel} no enlaza el ticket`);
  }
});

test("i18n · las claves nuevas existen en es y en", () => {
  const es = JSON.parse(leer("i18n/dictionaries/es.json"));
  const en = JSON.parse(leer("i18n/dictionaries/en.json"));
  const hojas = (o: any, p = ""): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? hojas(v, `${p}${k}.`) : [`${p}${k}`]));
  assert.deepEqual(hojas(es.saldoIa).sort(), hojas(en.saldoIa).sort());
  for (const k of ["kindSubscription", "kindAiTopup", "aiTopupConcept", "topupViaCard", "topupViaMercadopago", "topupViaSpei", "topupViaManual", "receipt", "viewReceipt"]) {
    assert.equal(typeof es.shell.subscriptionTab[k], "string", `es: falta ${k}`);
    assert.equal(typeof en.shell.subscriptionTab[k], "string", `en: falta ${k}`);
  }
});
