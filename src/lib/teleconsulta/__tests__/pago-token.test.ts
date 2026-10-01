/**
 * M7 (auditoría 30-sep-2026) — la liga de pago de una teleconsulta.
 *
 * Run: npm run test:seguridad-rapidos
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { esTokenDePagoValido, firmarPagoTeleconsulta, rutaDePago } from "../pago-token";

process.env.COOKIE_SECRET = "secreto-de-prueba";

// ── Dobles ───────────────────────────────────────────────────────────────────
let cita: any;
let consultas = 0;
let sesion: any = null;
let checkouts: any[] = [];

beforeEach(() => {
  consultas = 0;
  sesion = null;
  checkouts = [];
  cita = {
    id: "cita1", clinicId: "clinA", mode: "TELECONSULTATION", type: "Consulta",
    startsAt: new Date("2026-10-05T16:00:00Z"), endsAt: new Date("2026-10-05T16:30:00Z"),
    paymentAmount: 500, paymentStatus: "pending",
    // Estos dos son los que NUNCA deben llegar a quien solo tiene la liga.
    teleRoomUrl: "https://daily.example/sala-secreta", telePatientToken: "TOKEN-DE-SALA",
    patient: { firstName: "Ana", lastName: "Pérez", email: "ana@example.com" },
    doctor: { firstName: "Luis", lastName: "Mora", stripeAccountId: "acct_1" },
    clinic: { id: "clinA", name: "Clínica A", timezone: "America/Mexico_City", teleCommissionPct: 10 },
  };
});

(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      appointment: {
        findUnique: async ({ where }: any) => { consultas++; return where.id === cita.id ? cita : null; },
        findFirst: async ({ where }: any) =>
          where.id === cita.id && where.clinicId === cita.clinicId ? cita : null,
        update: async () => cita,
      },
    },
  },
});
(mock as any).module("next/navigation", { namedExports: { notFound: () => { throw new Error("NEXT_NOT_FOUND"); } } });
(mock as any).module("@/lib/auth-context", { namedExports: { getAuthContext: async () => sesion } });
(mock as any).module("@/lib/stripe-connect", {
  namedExports: { createCheckoutSession: async (a: any) => { checkouts.push(a); return { sessionId: "cs_1", url: "https://stripe.example/pay" }; } },
});
(mock as any).module("@/lib/patient-visibility", { namedExports: { assertPatientVisible: async () => null } });

// ── El token ─────────────────────────────────────────────────────────────────
test("el token es de ESA cita y no se puede reutilizar en otra ni inventar", () => {
  const t = firmarPagoTeleconsulta("cita1");
  assert.equal(esTokenDePagoValido("cita1", t), true);
  assert.equal(esTokenDePagoValido("cita2", t), false, "no sirve para otra cita");
  for (const malo of [undefined, null, "", "abc", t + "x", t.slice(0, -1), "cita1"]) {
    assert.equal(esTokenDePagoValido("cita1", malo as any), false, String(malo));
  }
});

test("otro secreto da otro token (no se calcula sin el secreto del servidor)", () => {
  const t = firmarPagoTeleconsulta("cita1", "secreto-A");
  assert.equal(esTokenDePagoValido("cita1", t, "secreto-A"), true);
  assert.equal(esTokenDePagoValido("cita1", t, "secreto-B"), false);
});

test("rutaDePago lleva ?t= con el token", () => {
  const r = rutaDePago("cita1");
  assert.match(r, /^\/pago\/cita1\?t=[A-Za-z0-9_-]{43}$/);
  assert.equal(esTokenDePagoValido("cita1", r.split("?t=")[1]), true);
});

// ── La página ────────────────────────────────────────────────────────────────
async function abrirPagina(t?: string) {
  const { default: Pagina } = await import("@/app/pago/[appointmentId]/page");
  return Pagina({ params: { appointmentId: "cita1" }, searchParams: { t } });
}

test("sin token, o con uno falso, /pago/<id> es 404 y ni siquiera consulta la cita", async () => {
  await assert.rejects(() => abrirPagina(undefined), /NEXT_NOT_FOUND/);
  await assert.rejects(() => abrirPagina("inventado"), /NEXT_NOT_FOUND/);
  assert.equal(consultas, 0);
});

test("con el token, pendiente de pago: la página sale y NO lleva la sala ni el token del paciente", async () => {
  const el: any = await abrirPagina(firmarPagoTeleconsulta("cita1"));
  assert.equal(el.props.appointmentId, "cita1");
  assert.equal(el.props.paymentStatus, "pending");
  assert.ok(!("teleRoomUrl" in el.props), "no pasa teleRoomUrl");
  assert.ok(!("telePatientToken" in el.props), "no pasa telePatientToken");
  assert.ok(!JSON.stringify(el.props).includes("sala-secreta"));
  assert.ok(!JSON.stringify(el.props).includes("TOKEN-DE-SALA"));
});

test("con el token y YA pagada: tampoco entrega la sala ni el token", async () => {
  cita.paymentStatus = "paid";
  const el: any = await abrirPagina(firmarPagoTeleconsulta("cita1"));
  assert.equal(el.props.paymentStatus, "paid");
  assert.ok(!JSON.stringify(el.props).includes("sala-secreta"));
  assert.ok(!JSON.stringify(el.props).includes("TOKEN-DE-SALA"));
});

// ── El checkout ──────────────────────────────────────────────────────────────
const post = (body: unknown) => ({ json: async () => body }) as any;

test("checkout: sin token y sin sesión es 404 y no crea ninguna sesión de pago", async () => {
  const { POST } = await import("@/app/api/stripe/checkout/route");
  const res = await POST(post({ appointmentId: "cita1" }));
  assert.equal(res.status, 404);
  assert.equal(checkouts.length, 0);
});

test("checkout: con el token del paciente crea la sesión de pago", async () => {
  const { POST } = await import("@/app/api/stripe/checkout/route");
  const res = await POST(post({ appointmentId: "cita1", t: firmarPagoTeleconsulta("cita1") }));
  assert.equal(res.status, 200);
  assert.equal(checkouts.length, 1);
});

test("checkout: el token de OTRA cita no vale", async () => {
  const { POST } = await import("@/app/api/stripe/checkout/route");
  const res = await POST(post({ appointmentId: "cita1", t: firmarPagoTeleconsulta("cita2") }));
  assert.equal(res.status, 404);
});

test("checkout: sesión de OTRA clínica sin token es 404; la de la misma clínica pasa", async () => {
  const { POST } = await import("@/app/api/stripe/checkout/route");
  sesion = { clinicId: "clinB", userId: "u" };
  assert.equal((await POST(post({ appointmentId: "cita1" }))).status, 404);
  sesion = { clinicId: "clinA", userId: "u" };
  assert.equal((await POST(post({ appointmentId: "cita1" }))).status, 200);
});

// ── La liga que copia la clínica ─────────────────────────────────────────────
test("pago-link: sin sesión 401; con la clínica propia devuelve la ruta con token; de otra clínica 404", async () => {
  const { GET } = await import("@/app/api/teleconsulta/pago-link/route");
  const req = { nextUrl: { searchParams: new URLSearchParams("appointmentId=cita1") } } as any;
  assert.equal((await GET(req)).status, 401);
  sesion = { clinicId: "clinB", userId: "u", role: "ADMIN" };
  assert.equal((await GET(req)).status, 404);
  sesion = { clinicId: "clinA", userId: "u", role: "ADMIN" };
  const ok = await GET(req);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).path, rutaDePago("cita1"));
});
