/**
 * POST / PATCH /api/payment-plans con los HANDLERS REALES.
 *
 * Run: npm run test:payment-plans
 *
 * Lo que fija, contra un doble de Prisma que guarda lo que la ruta escribe:
 *   · las letras guardadas suman total − enganche al centavo, y ninguna es ≤ 0;
 *   · un plan imposible (enganche ≥ total) se rechaza SIN escribir nada;
 *   · el vencimiento es 00:00 de ese día en México (06:00Z), el mismo día de
 *     cada mes;
 *   · una letra ya pagada no se vuelve a «cobrar» (antes se le pisaba la fecha).
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const db = {
  plans: [] as any[],
  letras: [] as any[],
};

function reset() {
  db.plans = [];
  db.letras = [];
}

/** Aplica solo los filtros que la ruta usa; cualquier otro revienta (sin falsos verdes). */
function coincide(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === null) {
      if (row[k] !== null && row[k] !== undefined) return false;
    } else if (typeof v === "object") {
      throw new Error(`operador sin doble en where.${k}: ${JSON.stringify(v)}`);
    } else if (row[k] !== v) {
      return false;
    }
  }
  return true;
}

const conLetras = (p: any) => ({ ...p, payments: db.letras.filter((l) => l.planId === p.id).sort((a, b) => a.installment - b.installment) });

const prismaStub: any = {
  patient: { findFirst: async ({ where }: any) => (where.clinicId === "c1" ? { id: where.id } : null) },
  invoice: { findFirst: async () => null },
  paymentPlan: {
    create: async ({ data }: any) => {
      const row = { id: `plan${db.plans.length + 1}`, ...data };
      db.plans.push(row);
      return row;
    },
    findFirst: async ({ where, include }: any) => {
      const p = db.plans.find((x) => coincide(x, where));
      return p ? (include?.payments ? conLetras(p) : { ...p }) : null;
    },
    findUnique: async ({ where }: any) => {
      const p = db.plans.find((x) => x.id === where.id);
      return p ? conLetras(p) : null;
    },
    update: async ({ where, data }: any) => {
      const p = db.plans.find((x) => x.id === where.id);
      Object.assign(p, data);
      return p;
    },
    updateMany: async ({ where, data }: any) => {
      const ps = db.plans.filter((x) => coincide(x, where));
      ps.forEach((p) => Object.assign(p, data));
      return { count: ps.length };
    },
  },
  planPayment: {
    createMany: async ({ data }: any) => {
      data.forEach((d: any, i: number) => db.letras.push({ id: `l${db.letras.length + 1}`, paidAt: null, method: null, ...d }));
      return { count: data.length };
    },
    updateMany: async ({ where, data }: any) => {
      const ls = db.letras.filter((l) => coincide(l, where));
      ls.forEach((l) => Object.assign(l, data));
      return { count: ls.length };
    },
    findMany: async ({ where }: any) => db.letras.filter((l) => coincide(l, where)),
  },
  $transaction: async (fn: any) => fn(prismaStub),
};

const authCtx: any = { clinicId: "c1", userId: "u1", role: "ADMIN", permissionsOverride: null, clinic: { timezone: "America/Mexico_City" } };

(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
(mock as any).module("@/lib/auth-context", { namedExports: { getAuthContext: async () => authCtx } });
(mock as any).module("@/lib/patient-visibility", {
  namedExports: { assertPatientVisible: async () => null, relatedPatientVisibilityAnd: () => [] },
});

function req(body: any): any {
  return { json: async () => body, headers: new Headers(), url: "http://localhost/api/payment-plans" };
}
async function leer(res: any) {
  return { status: res.status, body: await res.json() };
}

const base = { patientId: "p1", name: "Implante" };

test("POST: las letras guardadas suman total − enganche al centavo", async () => {
  reset();
  const { POST } = await import("@/app/api/payment-plans/route");
  const res = await leer(await POST(req({ ...base, totalAmount: 25000, downPayment: 5000, installments: 24, frequency: "MONTHLY", startDate: "2026-10-15" })));
  assert.equal(res.status, 201, res.body?.error);
  const letras = db.letras.filter((l) => l.planId === res.body.id);
  assert.equal(letras.length, 24);
  assert.equal(letras.reduce((s, l) => s + Math.round(l.amount * 100), 0), 2_000_000);
  assert.ok(letras.every((l) => l.amount > 0));
  assert.equal(db.plans[0].totalAmount, 25000);
  assert.equal(db.plans[0].downPayment, 5000);
});

test("POST: el vencimiento es el mismo día de cada mes, a las 00:00 de México", async () => {
  reset();
  const { POST } = await import("@/app/api/payment-plans/route");
  const res = await leer(await POST(req({ ...base, totalAmount: 1200, installments: 12, frequency: "MONTHLY", startDate: "2026-01-15" })));
  assert.equal(res.status, 201, res.body?.error);
  const fechas = db.letras.map((l) => (l.dueDate as Date).toISOString());
  assert.equal(fechas[0], "2026-02-15T06:00:00.000Z", "México es UTC-6 todo el año");
  assert.equal(fechas[11], "2027-01-15T06:00:00.000Z", "a los 12 meses sigue siendo el 15 (antes: el 10)");
  assert.equal((db.plans[0].startDate as Date).toISOString(), "2026-01-15T06:00:00.000Z");
});

test("POST: $1 en 60 letras ya no guarda una letra negativa", async () => {
  reset();
  const { POST } = await import("@/app/api/payment-plans/route");
  const res = await leer(await POST(req({ ...base, totalAmount: 1, installments: 60 })));
  assert.equal(res.status, 201, res.body?.error);
  assert.ok(db.letras.every((l) => l.amount > 0), `letras: ${db.letras.map((l) => l.amount).join(", ")}`);
  assert.equal(db.letras.reduce((s, l) => s + Math.round(l.amount * 100), 0), 100);
});

test("POST: enganche mayor que el total → 400 y nada escrito", async () => {
  reset();
  const { POST } = await import("@/app/api/payment-plans/route");
  const res = await leer(await POST(req({ ...base, totalAmount: 1000, downPayment: 1500, installments: 3 })));
  assert.equal(res.status, 400);
  assert.match(res.body.error, /enganche/i);
  assert.equal(db.plans.length, 0);
  assert.equal(db.letras.length, 0);
});

test("POST: 2.5 letras → 400 (antes: Array.from con length fraccionario)", async () => {
  reset();
  const { POST } = await import("@/app/api/payment-plans/route");
  const res = await leer(await POST(req({ ...base, totalAmount: 1000, installments: 2.5 })));
  assert.equal(res.status, 400);
  assert.equal(db.plans.length, 0);
});

test("PATCH: una letra ya pagada no se vuelve a cobrar", async () => {
  reset();
  const { POST } = await import("@/app/api/payment-plans/route");
  const { PATCH } = await import("@/app/api/payment-plans/[id]/route");
  const creado = await leer(await POST(req({ ...base, totalAmount: 300, installments: 3 })));
  const planId = creado.body.id;
  const primera = db.letras[0];
  const P = { params: { id: planId } };

  const uno = await leer(await PATCH(req({ installmentId: primera.id, method: "cash" }), P));
  assert.equal(uno.status, 200, uno.body?.error);
  const cobradaEl = primera.paidAt;
  assert.ok(cobradaEl instanceof Date);

  const dos = await leer(await PATCH(req({ installmentId: primera.id, method: "transfer" }), P));
  assert.equal(dos.status, 409);
  assert.equal(primera.paidAt, cobradaEl, "la fecha del cobro real no se pisa");
  assert.equal(primera.method, "cash", "ni el método");

  const nada = await leer(await PATCH(req({ installmentId: "no-existe" }), P));
  assert.equal(nada.status, 404);
});

test("PATCH: al pagar la última letra el plan queda COMPLETED; uno cancelado no cobra", async () => {
  reset();
  const { POST } = await import("@/app/api/payment-plans/route");
  const { PATCH, DELETE } = await import("@/app/api/payment-plans/[id]/route");
  const creado = await leer(await POST(req({ ...base, totalAmount: 200, installments: 2 })));
  const P = { params: { id: creado.body.id } };
  for (const l of [...db.letras]) {
    const r = await leer(await PATCH(req({ installmentId: l.id }), P));
    assert.equal(r.status, 200, r.body?.error);
  }
  assert.equal(db.plans[0].status, "COMPLETED");

  const otro = await leer(await POST(req({ ...base, totalAmount: 200, installments: 2 })));
  const P2 = { params: { id: otro.body.id } };
  await DELETE(req({}), P2);
  const letra = db.letras.find((l) => l.planId === otro.body.id);
  const r = await leer(await PATCH(req({ installmentId: letra.id }), P2));
  assert.equal(r.status, 400);
  assert.equal(letra.paidAt, null);
});
