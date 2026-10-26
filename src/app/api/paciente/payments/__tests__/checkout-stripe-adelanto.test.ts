/**
 * POST /api/paciente/payments/checkout (Stripe, portal del paciente) con la regla de lo debido (26-oct,
 * Rafael; revisión t5, v5 sospecha 2): con algo debido se cobra lo debido; sin nada debido, solo «por
 * adelantado» (el saldo de la nota) si se pide; si no, 409 `nada_debido`. El monto NUNCA viene del
 * cliente. Con la ruta REAL y dobles por `Module._load`: ni red, ni base, ni Stripe.
 *
 * Run: npm run test:plan-por-cobrar
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { NextRequest, NextResponse } from "next/server";

type Factura = { id: string; invoiceNumber: string; balance: number; clinicId: string; patientId: string; status: string };

let facturas: Factura[] = [];
let noSeDebe: Record<string, number> = {};
let sesiones: Array<{ amountMxn: number; invoiceId: string; clinicId: string }> = [];
let sesion: { links: Array<{ patientId: string; clinicId: string }>; account: { email: string } } | null = null;

const dobles: Record<string, unknown> = {
  "server-only": {},
  "@/lib/rate-limit": { rateLimit: () => null },
  "@/lib/patient-portal/guard": {
    getPatientPortalContext: async () => sesion,
    pacienteUnauthorized: () => NextResponse.json({ error: "No autenticado" }, { status: 401 }),
  },
  "@/lib/patient-portal/online-payment": {
    PAYABLE_STATUSES: ["PENDING", "PARTIAL", "OVERDUE"],
    MIN_ONLINE_AMOUNT_MXN: 10,
    getClinicConnectAccount: async () => "acct_clinica",
    createInvoiceCheckoutSession: async (p: { amountMxn: number; invoiceId: string; clinicId: string }) => {
      sesiones.push({ amountMxn: p.amountMxn, invoiceId: p.invoiceId, clinicId: p.clinicId });
      return { url: "https://checkout.stripe.test/s1" };
    },
  },
  "@/lib/dinero/lo-que-se-debe.server": {
    loQueAunNoSeDebe: async (clinicId: string, o: { ids?: string[] }) => {
      const porFactura: Record<string, number> = {};
      for (const id of o.ids ?? []) {
        const f = facturas.find((x) => x.id === id && x.clinicId === clinicId);
        if (f && (noSeDebe[id] ?? 0) > 0) porFactura[id] = noSeDebe[id];
      }
      const total = Object.values(porFactura).reduce((a, b) => a + b, 0);
      return { porFactura, porHacer: total, porVencer: 0, total };
    },
  },
  "@/lib/prisma": {
    prisma: {
      invoice: {
        findFirst: async (args: any) => {
          const pacientes: string[] = args.where.patientId.in;
          const estados: string[] = args.where.status.in;
          const f = facturas.find((x) => x.id === args.where.id && pacientes.includes(x.patientId) && estados.includes(x.status));
          return f ? { id: f.id, invoiceNumber: f.invoiceNumber, balance: f.balance, clinicId: f.clinicId, clinic: { name: "Clínica" } } : null;
        },
      },
    },
  },
};
const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  return req in dobles ? dobles[req] : cargaOriginal.call(this, req, ...r);
};

const pedir = (body: unknown) =>
  new NextRequest("http://x/api/paciente/payments/checkout", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

async function pagar(body: unknown) {
  const { POST } = await import("@/app/api/paciente/payments/checkout/route");
  const r = await POST(pedir(body));
  return { status: r.status, body: await r.json() };
}

beforeEach(() => {
  facturas = [{ id: "nota", invoiceNumber: "F-1", balance: 2050.5, clinicId: "c1", patientId: "pac-1", status: "PENDING" }];
  noSeDebe = {};
  sesiones = [];
  sesion = { links: [{ patientId: "pac-1", clinicId: "c1" }], account: { email: "ana@correo.test" } };
});

test("una factura normal (nada que no se deba): el saldo de siempre", async () => {
  const r = await pagar({ invoiceId: "nota" });
  assert.equal(r.status, 200);
  assert.deepEqual(sesiones.map((s) => s.amountMxn), [2050.5]);
});

test("debe algo (resina hecha): se cobra LO DEBIDO, y `adelanto` no lo cambia", async () => {
  noSeDebe = { nota: 800 };
  assert.equal((await pagar({ invoiceId: "nota" })).status, 200);
  assert.equal((await pagar({ invoiceId: "nota", adelanto: true })).status, 200);
  assert.deepEqual(sesiones.map((s) => s.amountMxn), [1250.5, 1250.5]);
});

test("no debe nada todavía: sin `adelanto`, 409 nada_debido; con `adelanto`, el saldo de la nota (queda como abono)", async () => {
  noSeDebe = { nota: 2050.5 };
  const sin = await pagar({ invoiceId: "nota" });
  assert.equal(sin.status, 409);
  assert.equal(sin.body.code, "nada_debido");
  assert.match(sin.body.error, /por adelantado/);
  assert.equal(sesiones.length, 0, "no se abre ningún checkout");
  const con = await pagar({ invoiceId: "nota", adelanto: true });
  assert.equal(con.status, 200);
  assert.deepEqual(sesiones.map((s) => s.amountMxn), [2050.5]);
});

test("el cliente no pone el monto: un `amount` en el cuerpo se ignora", async () => {
  noSeDebe = { nota: 800 };
  await pagar({ invoiceId: "nota", amount: 1, adelanto: true });
  assert.deepEqual(sesiones.map((s) => s.amountMxn), [1250.5]);
});

test("lo debido por debajo del mínimo en línea: 400 «paga en tu clínica», sin checkout", async () => {
  noSeDebe = { nota: 2045 };
  const r = await pagar({ invoiceId: "nota" });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /mínimo/);
  assert.equal(sesiones.length, 0);
});

test("la factura de otro paciente (o sin sesión) no se cobra", async () => {
  facturas.push({ id: "ajena", invoiceNumber: "F-9", balance: 900, clinicId: "c2", patientId: "pac-9", status: "PENDING" });
  assert.equal((await pagar({ invoiceId: "ajena", adelanto: true })).status, 404);
  sesion = null;
  assert.equal((await pagar({ invoiceId: "nota" })).status, 401);
  assert.equal(sesiones.length, 0);
});
