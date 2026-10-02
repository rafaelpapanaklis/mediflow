/**
 * PRESUPUESTO ACEPTADO EN PARTE → CARGOS SIN COBRO DOBLE (ws1-t6, 7c y 7d).
 *
 * Run: npm run test:presupuesto-aceptacion
 *
 * El caso del cliente (ticket 3 de BEVADENT, precisión 2): «Cotización por
 * $10,000 con aceptación solo de una resina de $1,500 no debe producir deuda
 * por $10,000». Con el código de antes, POST /status ignoraba `itemIds` y
 * «Generar factura» creaba una factura por los $10,000.
 *
 * Ejercita los HANDLERS REALES (status, invoice, cargos) con `mock.module`
 * sobre prisma, sesión, auditoría y caché. El doble de Prisma entiende el SQL
 * crudo de quote_item_acceptance / quote_charges, respeta clinicId y bloquea
 * la fila del presupuesto (FOR UPDATE) como Postgres.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";

type Row = Record<string, any>;
const db = {
  tablas: true,
  quotes: [] as Row[],
  invoices: [] as Row[],
  aceptacion: [] as Row[],
  cargos: [] as Row[],
  seq: 0,
  folio: 0,
};
const sondas = { regclass: 0 };

const nuevoId = (p: string) => `${p}${++db.seq}`;
const copia = <T>(x: T): T => structuredClone(x);

beforeEach(async () => {
  db.tablas = true;
  db.quotes = [];
  db.invoices = [];
  db.aceptacion = [];
  db.cargos = [];
  db.seq = 0;
  db.folio = 0;
  sondas.regclass = 0;
  authCtx.clinicId = "c1";
  authCtx.role = "ADMIN";
  (await import("@/lib/quotes/aceptacion-db"))._olvidarTablas();
});

/** Los valores de `Prisma.join(...)` llegan como un Sql con `.values`. */
function planos(values: any[]): any[] {
  return values.flatMap((v) => (v && typeof v === "object" && Array.isArray(v.values) ? v.values : [v]));
}

const candados = new Map<string, Promise<void>>();

async function queryRawEn(soltar: Array<() => void> | null, strings: TemplateStringsArray, ...raw: any[]) {
  const sql = strings.join("?");
  const v = planos(raw);
  if (sql.includes("to_regclass")) {
    sondas.regclass++;
    return [{ existe: db.tablas }];
  }
  if (/FOR UPDATE/.test(sql)) {
    if (!soltar) throw new Error("FOR UPDATE fuera de una transacción");
    const fila = `quote:${v[0]}`;
    while (candados.has(fila)) await candados.get(fila);
    let liberar!: () => void;
    candados.set(fila, new Promise<void>((r) => { liberar = () => { candados.delete(fila); r(); }; }));
    soltar.push(liberar);
    return [{ id: v[0] }];
  }
  if (sql.includes('FROM "quote_item_acceptance"')) {
    if (!db.tablas) throw new Error('relation "quote_item_acceptance" does not exist');
    const [clinicId, ...ids] = v;
    return copia(db.aceptacion.filter((a) => a.clinicId === clinicId && ids.includes(a.quoteId)))
      .map((a) => ({ ...a, sortOrder: 0 }));
  }
  if (sql.includes('FROM "quote_charges"')) {
    if (!db.tablas) throw new Error('relation "quote_charges" does not exist');
    const [clinicIdInv, clinicId, ...ids] = v;
    return db.cargos
      .filter((c) => c.clinicId === clinicId && ids.includes(c.quoteId))
      .map((c) => ({ c, i: db.invoices.find((i) => i.id === c.invoiceId && i.clinicId === clinicIdInv) }))
      .filter(({ i }) => i && i.status !== "CANCELLED")
      .map(({ c, i }) => ({ ...copia(c), invoiceNumber: i.invoiceNumber, status: i.status }));
  }
  return [];
}

async function executeRaw(strings: TemplateStringsArray, ...raw: any[]) {
  const sql = strings.join("?");
  const v = planos(raw);
  if (sql.includes('DELETE FROM "quote_item_acceptance"')) {
    db.aceptacion = db.aceptacion.filter((a) => !(a.quoteId === v[0] && a.clinicId === v[1]));
    return 1;
  }
  if (sql.includes('INSERT INTO "quote_item_acceptance"')) {
    const [quoteItemId, quoteId, clinicId, aceptado, nombre, toothFdi, cantidad, precio, descuento, importe, descuentoGlobal, via] = v;
    db.aceptacion.push({ quoteItemId, quoteId, clinicId, aceptado, nombre, toothFdi, cantidad, precio, descuento, importe, descuentoGlobal, via, createdAt: new Date() });
    return 1;
  }
  if (sql.includes('INSERT INTO "quote_charges"')) {
    const [id, clinicId, quoteId, quoteItemId, invoiceId, tipo, monto] = v;
    db.cargos.push({ id, clinicId, quoteId, quoteItemId, invoiceId, tipo, monto, createdAt: new Date() });
    return 1;
  }
  throw new Error(`SQL no esperado: ${sql}`);
}

const dondeQuote = (where: any) => (x: Row) =>
  (!where?.id || x.id === where.id) && (!where?.clinicId || x.clinicId === where.clinicId) &&
  (!where?.patientId || x.patientId === where.patientId) &&
  (typeof where?.status !== "string" || x.status === where.status) &&
  (!where?.validUntil?.lt || (x.validUntil && x.validUntil < where.validUntil.lt));

function facturaCoincide(inv: Row, where: any): boolean {
  if (where?.id && inv.id !== where.id) return false;
  if (where?.clinicId && inv.clinicId !== where.clinicId) return false;
  if (where?.id?.in && !where.id.in.includes(inv.id)) return false;
  if (typeof where?.status === "string" && inv.status !== where.status) return false;
  if (where?.status?.not && inv.status === where.status.not) return false;
  return true;
}

const prismaStub: any = {
  $queryRaw: (s: TemplateStringsArray, ...v: any[]) => queryRawEn(null, s, ...v),
  $executeRaw: executeRaw,
  $transaction: async (arg: any) => {
    const soltar: Array<() => void> = [];
    const tx = { ...prismaStub, $queryRaw: (s: TemplateStringsArray, ...v: any[]) => queryRawEn(soltar, s, ...v) };
    try { return await arg(tx); } finally { soltar.forEach((f) => f()); }
  },
  quote: {
    findFirst: async ({ where }: any = {}) => {
      const q = db.quotes.find(dondeQuote(where));
      return q ? copia(q) : null;
    },
    findMany: async ({ where }: any = {}) => copia(db.quotes.filter(dondeQuote(where))),
    update: async ({ where, data }: any) => {
      const q = db.quotes.find((x) => x.id === where.id)!;
      Object.assign(q, data);
      return copia(q);
    },
    updateMany: async ({ where, data }: any) => {
      const hits = db.quotes.filter(dondeQuote(where));
      hits.forEach((q) => Object.assign(q, data));
      return { count: hits.length };
    },
  },
  invoice: {
    create: async ({ data }: any) => {
      const fila = { id: nuevoId("inv"), status: "PENDING", createdAt: new Date(), ...data };
      db.invoices.push(fila);
      return copia(fila);
    },
    findFirst: async ({ where }: any = {}) => {
      const inv = db.invoices.find((i) => facturaCoincide(i, where));
      return inv ? { ...copia(inv), payments: [] } : null;
    },
    findMany: async ({ where }: any = {}) => copia(db.invoices.filter((i) => facturaCoincide(i, where))),
  },
  clinic: { findUnique: async () => ({ cfdiTaxMode: "exempt" }) },
  user: { findFirst: async () => null },
  patient: { findFirst: async ({ where }: any) => (where?.clinicId === "c1" ? { id: "p1" } : null) },
};

const authCtx: any = { clinicId: "c1", userId: "u1", role: "ADMIN", permissionsOverride: null };
const auditorias: any[] = [];

(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
(mock as any).module("@/lib/auth-context", { namedExports: { getAuthContext: async () => authCtx } });
(mock as any).module("@/lib/audit", {
  namedExports: { logAudit: async (a: any) => { auditorias.push(a); }, logMutation: async () => {} },
});
(mock as any).module("next/cache", { namedExports: { revalidatePath: () => {}, revalidateTag: () => {} } });
(mock as any).module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => {} } });
(mock as any).module("@/lib/patient-visibility", {
  namedExports: { assertPatientVisible: async () => null, relatedPatientVisibilityAnd: () => [] },
});
(mock as any).module("@/lib/patient-credit-aplicar", {
  namedExports: { aplicarSaldoAFavor: async () => ({ aplicado: 0 }) },
});
class InvoiceNumberExhaustedError extends Error {}
(mock as any).module("@/lib/invoices/next-invoice-number", {
  namedExports: {
    nextInvoiceNumber: async () => `MF-${String(++db.folio).padStart(4, "0")}`,
    withInvoiceNumberRetry: (f: () => Promise<unknown>) => f(),
    InvoiceNumberExhaustedError,
  },
});

function req(body?: any): any {
  return { json: async () => body ?? {}, headers: new Headers(), url: "http://localhost/api/quotes?patientId=p1", nextUrl: new URL("http://localhost/x") };
}
async function leer(res: any) {
  return { status: res.status as number, body: await res.json() };
}

/** Presupuesto de $10,000: resina $1,500 + ortodoncia $8,500. */
function sembrar(extra: Row = {}): Row {
  const q: Row = {
    id: "q1", clinicId: "c1", patientId: "p1", createdById: "u1", folio: "P-0001", title: "Plan",
    status: "PRESENTED", subtotal: 10000, discountPct: null, discountAmount: 0, total: 10000,
    validUntil: null, notes: null, acceptToken: "tok", presentedAt: new Date(), acceptedAt: null,
    rejectedAt: null, signatureUrl: null, invoiceId: null, treatmentPlanId: null,
    createdAt: new Date(), updatedAt: new Date(), createdBy: null, patient: { firstName: "Ana", lastName: "P" },
    items: [
      { id: "resina", name: "Resina", toothFdi: "16", quantity: 1, unitPrice: 1500, discount: 0, lineTotal: 1500, phase: null, notes: null, sortOrder: 0, procedureId: null },
      { id: "orto", name: "Ortodoncia", toothFdi: null, quantity: 1, unitPrice: 8500, discount: 0, lineTotal: 8500, phase: null, notes: null, sortOrder: 1, procedureId: null },
    ],
    ...extra,
  };
  db.quotes.push(q);
  return q;
}

const P = { params: { id: "q1" } };

test("precisión 2: aceptar solo la resina de un presupuesto de $10,000 y «Generar factura» → deuda de $1,500", async () => {
  sembrar();
  const estado = await import("@/app/api/quotes/[id]/status/route");
  const facturar = await import("@/app/api/quotes/[id]/invoice/route");

  const a = await leer(await estado.POST(req({ action: "accept", itemIds: ["resina"] }), P));
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(db.quotes[0].status, "ACCEPTED");
  assert.deepEqual(
    db.aceptacion.map((r) => [r.quoteItemId, r.aceptado, r.importe]),
    [["resina", true, 1500], ["orto", false, 8500]],
    "queda guardado qué aceptó y a qué precio, y qué no",
  );
  assert.match(auditorias.at(-1).texto, /en parte: 1 de 2/);

  const f = await leer(await facturar.POST(req(), P));
  assert.equal(f.status, 201, JSON.stringify(f.body));
  assert.equal(db.invoices.length, 1);
  assert.equal(db.invoices[0].total, 1500, "la deuda es lo aceptado, no los $10,000");
  assert.equal(db.invoices[0].status, "PENDING");
  assert.equal(db.quotes[0].invoiceId, db.invoices[0].id);

  // Otro «Generar factura»: no hay nada pendiente → devuelve la misma, no crea otra.
  const otra = await leer(await facturar.POST(req(), P));
  assert.equal(otra.status, 200);
  assert.equal(otra.body.already, true);
  assert.equal(db.invoices.length, 1);
});

test("«Se cobrará hoy»: un concepto por cargo, nunca dos veces, y la suma = lo aceptado", async () => {
  sembrar({ discountAmount: 1000, total: 9000 });
  const estado = await import("@/app/api/quotes/[id]/status/route");
  const cargos = await import("@/app/api/quotes/[id]/cargos/route");
  await estado.POST(req({ action: "accept" }), P);

  const vista = await leer(await cargos.GET(req(), P));
  assert.equal(vista.status, 200);
  assert.equal(vista.body.cobro.totalAceptado, 9000);
  assert.equal(vista.body.cobro.porCargar, 9000);

  const hoy = await leer(await cargos.POST(req({ itemIds: ["resina"] }), P));
  assert.equal(hoy.status, 201, JSON.stringify(hoy.body));
  assert.equal(hoy.body.total, 1350, "resina con su 10 % del descuento global");
  assert.equal(hoy.body.quedaPorCargar, 7650);

  const doble = await leer(await cargos.POST(req({ itemIds: ["resina"] }), P));
  assert.equal(doble.status, 409);
  assert.match(doble.body.error, /ya está cargado/);

  const resto = await leer(await cargos.POST(req({ itemIds: ["orto"] }), P));
  assert.equal(resto.status, 201);
  assert.equal(db.invoices.reduce((s, i) => s + i.total, 0), 9000);
  assert.equal(db.cargos.length, 2);
});

test("dos «Cargar» a la vez del mismo concepto: solo uno crea factura", async () => {
  sembrar();
  const estado = await import("@/app/api/quotes/[id]/status/route");
  const cargos = await import("@/app/api/quotes/[id]/cargos/route");
  await estado.POST(req({ action: "accept" }), P);
  const [a, b] = await Promise.all([
    cargos.POST(req({ itemIds: ["resina"] }), P),
    cargos.POST(req({ itemIds: ["resina"] }), P),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  assert.equal(db.invoices.length, 1);
});

test("abono pactado hoy y conceptos después: se descuenta lo abonado", async () => {
  sembrar();
  const estado = await import("@/app/api/quotes/[id]/status/route");
  const cargos = await import("@/app/api/quotes/[id]/cargos/route");
  await estado.POST(req({ action: "accept" }), P);

  const inicial = await leer(await cargos.POST(req({ abono: 3000 }), P));
  assert.equal(inicial.status, 201);
  assert.equal(db.invoices[0].total, 3000);

  const todo = await leer(await cargos.POST(req({ itemIds: ["resina", "orto"] }), P));
  assert.equal(todo.status, 201);
  assert.equal(todo.body.total, 7000);
  assert.equal(db.invoices.reduce((s, i) => s + i.total, 0), 10000);

  const mas = await leer(await cargos.POST(req({ abono: 1 }), P));
  assert.equal(mas.status, 409);
});

test("lo no aceptado no se carga; con la factura cancelada el concepto vuelve a estar disponible", async () => {
  sembrar();
  const estado = await import("@/app/api/quotes/[id]/status/route");
  const cargos = await import("@/app/api/quotes/[id]/cargos/route");
  await estado.POST(req({ action: "accept", itemIds: ["resina"] }), P);

  const orto = await leer(await cargos.POST(req({ itemIds: ["orto"] }), P));
  assert.equal(orto.status, 409);
  assert.match(orto.body.error, /no lo aceptó/);

  await cargos.POST(req({ itemIds: ["resina"] }), P);
  db.invoices[0].status = "CANCELLED";
  const otraVez = await leer(await cargos.POST(req({ itemIds: ["resina"] }), P));
  assert.equal(otraVez.status, 201);
});

test("otra clínica no ve ni carga el presupuesto; sin billing.create no se carga", async () => {
  sembrar();
  const estado = await import("@/app/api/quotes/[id]/status/route");
  const cargos = await import("@/app/api/quotes/[id]/cargos/route");
  await estado.POST(req({ action: "accept" }), P);

  authCtx.clinicId = "c2";
  assert.equal((await cargos.POST(req({ itemIds: ["resina"] }), P)).status, 404);
  assert.equal((await cargos.GET(req(), P)).status, 404);

  authCtx.clinicId = "c1";
  authCtx.role = "READONLY";
  assert.equal((await cargos.POST(req({ itemIds: ["resina"] }), P)).status, 403);
  assert.equal(db.invoices.length, 0);
});

test("SIN el SQL: aceptar todo y facturar el total como siempre; una selección parcial se rechaza sin aceptar de más", async () => {
  db.tablas = false;
  sembrar();
  const estado = await import("@/app/api/quotes/[id]/status/route");
  const facturar = await import("@/app/api/quotes/[id]/invoice/route");
  const cargos = await import("@/app/api/quotes/[id]/cargos/route");

  const parcial = await leer(await estado.POST(req({ action: "accept", itemIds: ["resina"] }), P));
  assert.equal(parcial.status, 409);
  assert.equal(db.quotes[0].status, "PRESENTED", "no queda aceptado por $10,000 a escondidas");

  assert.equal((await estado.POST(req({ action: "accept" }), P)).status, 200);
  const f = await leer(await facturar.POST(req(), P));
  assert.equal(f.status, 201);
  assert.equal(db.invoices[0].total, 10000);
  assert.equal((await cargos.POST(req({ itemIds: ["resina"] }), P)).status, 404);
  assert.equal(db.aceptacion.length + db.cargos.length, 0);
});

test("sin el SQL, la sonda no repite la pregunta en cada petición", async () => {
  db.tablas = false;
  sembrar({ status: "ACCEPTED" });
  const lista = await import("@/app/api/quotes/route");
  for (let i = 0; i < 5; i++) {
    const r = await leer(await lista.GET(req()));
    assert.equal(r.status, 200);
    assert.equal(r.body[0].porConcepto, undefined);
  }
  assert.equal(sondas.regclass, 1);
});

test("GET /api/quotes: el aceptado en parte trae su resumen de cobro y los permisos", async () => {
  sembrar();
  const estado = await import("@/app/api/quotes/[id]/status/route");
  const lista = await import("@/app/api/quotes/route");
  await estado.POST(req({ action: "accept", itemIds: ["resina"] }), P);
  const r = await leer(await lista.GET(req()));
  assert.equal(r.status, 200);
  const q = r.body[0];
  assert.equal(q.porConcepto, true);
  assert.deepEqual(q.permisos, { aceptar: true, cargar: true });
  assert.equal(q.cobro.alcance, "parcial");
  assert.equal(q.cobro.totalAceptado, 1500);
  assert.equal(q.cobro.porCargar, 1500);
  assert.equal(q.cobro.noAceptado, 8500);
});
