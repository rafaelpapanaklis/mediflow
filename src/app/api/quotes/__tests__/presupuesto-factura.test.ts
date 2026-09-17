/**
 * PRESUPUESTO → FACTURA: CUÁNDO NACE Y EN QUÉ ESTADO (WS1-T2).
 *
 * Run: npm run test:presupuesto-factura
 *
 * Lo que vio Rafael: «cuando se crea un presupuesto se crea como borrador; no
 * debe ser borrador, ya es la factura creada». Había dos defectos pegados:
 *
 *   1. CREAR un presupuesto (POST /api/quotes) creaba además una factura en
 *      BORRADOR y gastaba un folio MF. Un presupuesto es una propuesta que el
 *      paciente todavía no acepta: esa factura inflaba el «Cobrar ahora» y el
 *      filtro «Con deuda» de la ficha, y si el presupuesto se rechazaba se
 *      quedaba viva. Ahora crear un presupuesto no toca Facturación.
 *
 *   2. FACTURAR un presupuesto ACEPTADO (POST /api/quotes/[id]/invoice, botón
 *      «Generar factura») daba otro BORRADOR que había que «confirmar» antes de
 *      poder cobrarlo. Un presupuesto aceptado ya no se edita, y la factura
 *      normal (POST /api/invoices) nace PENDIENTE. Ahora esta también.
 *
 * Por qué NO se arregló pasando la factura del alta a PENDIENTE: una PENDIENTE
 * es deuda exigible en todo el producto (Caja «por cobrar», reportes, portal
 * del paciente con pago en línea, aviso de saldo). Cada presupuesto sin
 * aceptar se habría vuelto dinero que el sistema cree que le deben a la
 * clínica — y además el presupuesto quedaba bloqueado para editar.
 *
 * Cómo prueba: ejercita los HANDLERS REALES con `mock.module` sobre prisma,
 * sesión, auditoría y caché (de ahí `--experimental-test-module-mocks`). El
 * doble de Prisma guarda filas en `db`, respeta `clinicId` y numera folios por
 * máximo emitido, igual que la consulta real.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import { invoiceFieldsFromQuote } from "@/lib/quotes/invoice-from-quote-core";
import { clinicInvoiceTaxDefaults } from "@/lib/invoice-totals";

// ── Estado del doble de Prisma ──────────────────────────────────────────────
type Row = Record<string, any>;
const db = {
  quotes: [] as Row[],
  invoices: [] as Row[],
  payments: [] as Row[],
  /** Clinic.cfdiTaxMode por clínica ("exempt" es el default de la columna). */
  clinics: {} as Record<string, string>,
  /** Usuarios: solo lo que mira el alta de la factura para atribuir doctor. */
  users: [] as Array<{ id: string; clinicId: string; role: string }>,
  seq: 0,
};
const revalidados: string[] = [];
/** Pacientes que el usuario de la sesión NO puede ver (visibilidad por paciente). */
const ocultos = new Set<string>();

beforeEach(() => {
  db.quotes = [];
  db.invoices = [];
  db.payments = [];
  db.clinics = { c1: "exempt", c2: "exempt" };
  // u1 (quien crea los presupuestos sembrados) es ADMIN, como la sesión.
  db.users = [
    { id: "u1", clinicId: "c1", role: "ADMIN" },
    { id: "doc-1", clinicId: "c1", role: "DOCTOR" },
    { id: "doc-de-c2", clinicId: "c2", role: "DOCTOR" },
  ];
  db.seq = 0;
  revalidados.length = 0;
  ocultos.clear();
  authCtx.clinicId = "c1";
});

const nuevoId = (prefijo: string) => `${prefijo}${++db.seq}`;
const copia = <T>(x: T): T => structuredClone(x);

/** Prisma ignora las claves `undefined` de `data`; el doble también. */
function aplicar(destino: Row, data: Row) {
  for (const [k, v] of Object.entries(data ?? {})) {
    if (v !== undefined) destino[k] = v;
  }
}

/** Mayor folio numérico emitido (último bloque de dígitos), como lastInvoiceFolio. */
function maxFolio(filas: Row[], campo: string, clinicId: string): number | null {
  const nums = filas
    .filter((f) => f.clinicId === clinicId)
    .map((f) => /([0-9]+)[^0-9]*$/.exec(String(f[campo]))?.[1])
    .filter((d): d is string => !!d)
    .map(Number);
  return nums.length ? Math.max(...nums) : null;
}

// Candados de fila (SELECT … FOR UPDATE). Un Postgres de verdad deja esperando
// a la segunda transacción hasta que la primera termina; el doble hace lo
// mismo con una promesa por fila, que se suelta al acabar el $transaction.
const candados = new Map<string, Promise<void>>();

// `prisma.$queryRaw` es una plantilla etiquetada: se distingue la consulta por
// su texto. Las de folio llevan la tabla entre comillas y MAX(); las de
// candado, FOR UPDATE.
async function queryRawEn(soltar: Array<() => void> | null, strings: TemplateStringsArray, ...values: any[]) {
  const sql = strings.join("?");
  if (/FOR UPDATE/.test(sql)) {
    if (!soltar) throw new Error("FOR UPDATE fuera de una transacción no bloquea nada");
    const fila = `${sql.includes('"quotes"') ? "quote" : "invoice"}:${values[0]}`;
    while (candados.has(fila)) await candados.get(fila);
    let liberar!: () => void;
    candados.set(fila, new Promise<void>((r) => { liberar = () => { candados.delete(fila); r(); }; }));
    soltar.push(liberar);
    return [{ id: values[0] }];
  }
  if (sql.includes('FROM "invoices"')) return [{ max: maxFolio(db.invoices, "invoiceNumber", values[0]) }];
  if (sql.includes('FROM "quotes"')) return [{ max: maxFolio(db.quotes, "folio", values[0]) }];
  return [];
}

function conItems(items: Row[] | undefined): Row[] {
  return (items ?? []).map((it) => ({ id: nuevoId("qi"), ...it }));
}

const quoteDelegate = {
  create: async ({ data }: any) => {
    const { items, ...resto } = data;
    const fila: Row = {
      id: nuevoId("q"), status: "DRAFT", invoiceId: null, treatmentPlanId: null,
      acceptToken: null, presentedAt: null, acceptedAt: null, rejectedAt: null, signatureUrl: null,
      createdAt: new Date(), updatedAt: new Date(),
      ...resto,
      items: conItems(items?.create),
      createdBy: null,
      patient: { firstName: "Ana", lastName: "López" },
    };
    db.quotes.push(fila);
    return copia(fila);
  },
  findFirst: async ({ where }: any = {}) => {
    const q = db.quotes.find((x) =>
      (!where?.id || x.id === where.id) && (!where?.clinicId || x.clinicId === where.clinicId));
    return q ? copia(q) : null;
  },
  update: async ({ where, data }: any) => {
    const q = db.quotes.find((x) => x.id === where.id);
    if (!q) throw new Error("update de un presupuesto que no existe");
    const { items, ...resto } = data;
    aplicar(q, resto);
    if (items?.create) q.items = conItems(items.create);
    q.updatedAt = new Date();
    return copia(q);
  },
  updateMany: async ({ where, data }: any) => {
    const hits = db.quotes.filter((x) =>
      (!where?.id || x.id === where.id) && (!where?.clinicId || x.clinicId === where.clinicId));
    hits.forEach((q) => aplicar(q, data));
    return { count: hits.length };
  },
};

function facturaCoincide(inv: Row, where: any): boolean {
  if (where?.id && inv.id !== where.id) return false;
  if (where?.clinicId && inv.clinicId !== where.clinicId) return false;
  if (typeof where?.status === "string" && inv.status !== where.status) return false;
  if (where?.paid !== undefined && inv.paid !== where.paid) return false;
  if (where?.payments?.none && db.payments.some((p) => p.invoiceId === inv.id)) return false;
  return true;
}

const invoiceDelegate = {
  create: async ({ data }: any) => {
    if (db.invoices.some((i) => i.clinicId === data.clinicId && i.invoiceNumber === data.invoiceNumber)) {
      throw Object.assign(new Error("Unique constraint"), { code: "P2002", meta: { target: ["clinicId", "invoiceNumber"] } });
    }
    // Defaults de la columna (schema.prisma, model Invoice).
    const fila: Row = {
      id: nuevoId("inv"), status: "PENDING", discount: 0, paid: 0, taxRate: 16, taxIncluded: true,
      dueDate: null, paidAt: null, paymentMethod: null, cfdiUuid: null, doctorId: null, appointmentId: null,
      createdAt: new Date(), updatedAt: new Date(),
      ...data,
    };
    db.invoices.push(fila);
    return copia(fila);
  },
  findFirst: async ({ where }: any = {}) => {
    const inv = db.invoices.find((i) => facturaCoincide(i, where));
    if (!inv) return null;
    const pagos = db.payments.filter((p) => p.invoiceId === inv.id);
    return { ...copia(inv), payments: copia(pagos), _count: { payments: pagos.length } };
  },
  updateMany: async ({ where, data }: any) => {
    const hits = db.invoices.filter((i) => facturaCoincide(i, where));
    hits.forEach((i) => aplicar(i, data));
    return { count: hits.length };
  },
};

const prismaStub: any = {
  $queryRaw: (strings: TemplateStringsArray, ...values: any[]) => queryRawEn(null, strings, ...values),
  $transaction: async (arg: any) => {
    if (typeof arg !== "function") return Promise.all(arg);
    const soltar: Array<() => void> = [];
    const tx = {
      ...prismaStub,
      $queryRaw: (strings: TemplateStringsArray, ...values: any[]) => queryRawEn(soltar, strings, ...values),
    };
    try { return await arg(tx); } finally { soltar.forEach((f) => f()); }
  },
  quote: quoteDelegate,
  quoteItem: {
    deleteMany: async ({ where }: any) => {
      const q = db.quotes.find((x) => x.id === where.quoteId);
      if (q) q.items = [];
      return { count: 0 };
    },
  },
  invoice: invoiceDelegate,
  clinic: {
    findUnique: async ({ where }: any = {}) =>
      where?.id in db.clinics ? { id: where.id, cfdiTaxMode: db.clinics[where.id] } : null,
    findFirst: async ({ where }: any = {}) =>
      where?.id in db.clinics ? { id: where.id, cfdiTaxMode: db.clinics[where.id] } : null,
  },
  user: {
    findFirst: async ({ where }: any = {}) => {
      // Como Prisma: una clave `undefined` no filtra. Así, si el alta olvidara
      // cortar antes de consultar, el doble devolvería a CUALQUIER doctor.
      const u = db.users.find((x) =>
        (where?.id === undefined || x.id === where.id) &&
        (where?.clinicId === undefined || x.clinicId === where.clinicId) &&
        (where?.role === undefined || x.role === where.role));
      return u ? { id: u.id } : null;
    },
  },
  payment: {
    create: async ({ data }: any) => {
      const fila = { id: nuevoId("pay"), paidAt: new Date(), ...data };
      db.payments.push(fila);
      return fila;
    },
  },
  patient: {
    findFirst: async ({ where }: any = {}) =>
      where?.id === "p1" && where?.clinicId === "c1" ? { id: "p1" } : null,
  },
  procedureCatalog: { findMany: async () => [] },
  cashRegister: { findFirst: async () => null },
};

// Sesión mutable: el test de aislamiento la cambia de clínica.
const authCtx: any = { clinicId: "c1", userId: "u1", role: "ADMIN", permissionsOverride: null };

(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
(mock as any).module("@/lib/auth-context", { namedExports: { getAuthContext: async () => authCtx } });
(mock as any).module("@/lib/audit", {
  namedExports: { logAudit: async () => {}, logMutation: async () => {} },
});
(mock as any).module("next/cache", {
  namedExports: { revalidatePath: (p: string) => { revalidados.push(p); }, revalidateTag: () => {} },
});
(mock as any).module("@/lib/cache/revalidate", {
  namedExports: { revalidateAfter: (grupo: string) => { revalidados.push(`grupo:${grupo}`); } },
});
(mock as any).module("@/lib/patient-visibility", {
  namedExports: {
    assertPatientVisible: async (patientId: string) =>
      ocultos.has(patientId) ? NextResponse.json({ error: "patient_not_found" }, { status: 404 }) : null,
    relatedPatientVisibilityAnd: () => [],
  },
});

/** Request mínimo: los handlers solo usan `req.json()` (y lo pasan al audit). */
function req(body?: any): any {
  return { json: async () => body ?? {}, headers: new Headers(), url: "http://localhost/api/quotes" };
}

async function leer(res: any) {
  return { status: res.status as number, body: await res.json() };
}

/** Silencia el console.error de las rutas. */
async function quieto<T>(fn: () => Promise<T>): Promise<T> {
  const orig = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = orig; }
}

// Un presupuesto a plazos: brackets + 6 mensualidades, con descuento de línea y
// global, para que el total de la factura no sea una suma trivial.
const CUERPO_PRESUPUESTO = {
  patientId: "p1",
  title: "Ortodoncia 6 meses",
  items: [
    { name: "Colocación de brackets", quantity: 1, unitPrice: 18000 },
    { name: "Ajuste mensual", quantity: 6, unitPrice: 1500, discount: 500 },
  ],
  discountAmount: 1000,
};

/** Un presupuesto ya guardado, directo en la «base» (sin pasar por el alta). */
function sembrarPresupuesto(extra: Row = {}): Row {
  const fila: Row = {
    id: "q-sembrado", clinicId: "c1", patientId: "p1", createdById: "u1",
    folio: "P-0003", title: "Rehabilitación", status: "ACCEPTED",
    // Columnas a propósito DISTINTAS de lo que dan los conceptos (7,000 − 200
    // = 6,800): si la factura copiara la columna saldría 1.00 y se notaría.
    subtotal: 1, discountPct: null, discountAmount: 200, total: 1,
    validUntil: null, notes: null, acceptToken: null, presentedAt: null,
    acceptedAt: new Date(), rejectedAt: null, signatureUrl: null,
    invoiceId: null, treatmentPlanId: null, createdAt: new Date(), updatedAt: new Date(),
    items: [
      { id: "qi-a", name: "Corona", toothFdi: "16", quantity: 1, unitPrice: 4500, discount: 0, lineTotal: 4500, sortOrder: 0 },
      { id: "qi-b", name: "Resina", toothFdi: null, quantity: 2, unitPrice: 1250, discount: 0, lineTotal: 2500, sortOrder: 1 },
    ],
    createdBy: null,
    patient: { firstName: "Ana", lastName: "López" },
    ...extra,
  };
  db.quotes.push(fila);
  return fila;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 · CREAR un presupuesto no es facturar
// ═══════════════════════════════════════════════════════════════════════════
test("crear un presupuesto NO crea factura ni gasta folio MF", async () => {
  const { POST } = await import("@/app/api/quotes/route");

  const res = await leer(await quieto(() => POST(req(CUERPO_PRESUPUESTO))));

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.folio, "P-0001");
  assert.equal(res.body.status, "DRAFT", "el presupuesto sí nace en borrador: todavía no se le presenta al paciente");
  assert.equal(
    db.invoices.length, 0,
    `no debe nacer ninguna factura al crear el presupuesto; nacieron ${db.invoices.length} ` +
      `(${db.invoices.map((i) => `${i.invoiceNumber} ${i.status}`).join(", ")})`,
  );
  assert.equal(res.body.invoiceId, null, "el presupuesto no queda ligado a ninguna factura");
  assert.equal(db.quotes[0].invoiceId, null);
  assert.equal(res.body.invoice, null, "la respuesta conserva el campo, vacío: la pantalla no inserta nada en Facturación");
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · FACTURAR un presupuesto aceptado da una factura de verdad
// ═══════════════════════════════════════════════════════════════════════════
test("facturar un presupuesto ACEPTADO: nace PENDIENTE, con el total de sus conceptos y un solo folio", async () => {
  const { POST } = await import("@/app/api/quotes/[id]/invoice/route");
  const q = sembrarPresupuesto();

  const res = await leer(await POST(req(), { params: { id: q.id } }));

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(db.invoices.length, 1);
  const inv = db.invoices[0];
  assert.equal(inv.status, "PENDING", "igual que la factura del botón normal (POST /api/invoices): no un borrador por confirmar");
  const esperado = invoiceFieldsFromQuote(q as any);
  assert.equal(inv.total, esperado.total, "el total sale de invoiceFieldsFromQuote, no de la columna del presupuesto");
  assert.equal(inv.total, 6800, "4,500 + 2 × 1,250 − 200; la columna total del presupuesto dice 1");
  assert.equal(inv.balance, inv.total, "todo el total queda por cobrar");
  assert.equal(inv.paid, 0);
  assert.equal(inv.subtotal, esperado.subtotal);
  assert.equal(inv.discount, esperado.discount);
  assert.deepEqual(inv.items, esperado.items);
  assert.equal(inv.clinicId, "c1", "clinicId de la sesión");
  assert.equal(inv.invoiceNumber, "MF-0001", "gasta exactamente un folio");
  assert.equal(db.quotes[0].invoiceId, inv.id, "el presupuesto queda ligado a su factura");

  assert.equal(res.body.invoiceId, inv.id);
  assert.equal(res.body.invoiceNumber, "MF-0001");
  assert.equal(res.body.already, false);
  assert.equal(res.body.invoice?.status, "PENDING", "la respuesta trae la factura para pintarla en Facturación sin recargar");
  assert.equal(res.body.invoice?.balance, 6800);

  // Nace cobrable → las pantallas que leen facturas emitidas se refrescan,
  // igual que tras POST /api/invoices.
  assert.ok(revalidados.includes("grupo:invoices"), `revalidó: ${revalidados.join(", ")}`);
  assert.ok(revalidados.includes("/dashboard/patients/p1"), `revalidó: ${revalidados.join(", ")}`);
});

test("del alta al cobro: crear → aceptar → facturar → abonar, sin «confirmar» de por medio", async () => {
  const alta = await import("@/app/api/quotes/route");
  const estado = await import("@/app/api/quotes/[id]/status/route");
  const facturar = await import("@/app/api/quotes/[id]/invoice/route");
  const cobrar = await import("@/app/api/invoices/[id]/route");

  const creado = await leer(await quieto(() => alta.POST(req(CUERPO_PRESUPUESTO))));
  assert.equal(creado.status, 201);
  const P = { params: { id: creado.body.id } };

  const aceptado = await leer(await estado.POST(req({ action: "accept" }), P));
  assert.equal(aceptado.status, 200, JSON.stringify(aceptado.body));
  assert.equal(aceptado.body.status, "ACCEPTED");

  const factura = await leer(await facturar.POST(req(), P));
  assert.equal(factura.status, 201, `«Generar factura» debe crearla ahora, no devolver una del alta (${JSON.stringify(factura.body)})`);
  assert.equal(db.invoices.length, 1, "una sola factura en todo el recorrido");
  const inv = db.invoices[0];
  const esperado = invoiceFieldsFromQuote(db.quotes[0] as any);
  // 18,000 + (6 × 1,500 − 500) − 1,000 de descuento global = 25,500
  assert.equal(inv.total, esperado.total);
  assert.equal(inv.total, 25500);

  // El primer abono del plan entra directo: antes respondía 400
  // «Confirma la factura antes de registrar pagos».
  const abono = await leer(await cobrar.POST(
    req({ amount: 4250, method: "transfer" }),
    { params: { id: inv.id } },
  ));
  assert.equal(abono.status, 200, JSON.stringify(abono.body));
  assert.equal(db.invoices[0].status, "PARTIAL");
  assert.equal(db.invoices[0].paid, 4250);
  assert.equal(db.invoices[0].balance, 21250);
});

test("facturar dos veces el mismo presupuesto no crea otra factura ni gasta otro folio", async () => {
  const { POST } = await import("@/app/api/quotes/[id]/invoice/route");
  const q = sembrarPresupuesto();

  const primera = await leer(await POST(req(), { params: { id: q.id } }));
  const segunda = await leer(await POST(req(), { params: { id: q.id } }));

  assert.equal(primera.status, 201);
  assert.equal(segunda.status, 200);
  assert.equal(segunda.body.already, true);
  assert.equal(segunda.body.invoiceId, primera.body.invoiceId);
  assert.equal(db.invoices.length, 1);
});

test("🔴 dos «Generar factura» A LA VEZ (Sabina y la pantalla): una sola factura PENDIENTE", async () => {
  const { POST } = await import("@/app/api/quotes/[id]/invoice/route");
  const q = sembrarPresupuesto();

  const [a, b] = await Promise.all([
    POST(req(), { params: { id: q.id } }).then(leer),
    POST(req(), { params: { id: q.id } }).then(leer),
  ]);

  assert.equal(
    db.invoices.length, 1,
    `nacieron ${db.invoices.length} facturas para un presupuesto: ${db.invoices.map((i) => i.invoiceNumber).join(", ")}`,
  );
  assert.deepEqual([a.status, b.status].sort(), [200, 201], "una la crea y la otra recibe la misma");
  assert.equal(a.body.invoiceId, b.body.invoiceId);
  assert.equal(db.quotes[0].invoiceId, db.invoices[0].id);
});

test("sin ver al paciente no se le genera la factura", async () => {
  const { POST } = await import("@/app/api/quotes/[id]/invoice/route");
  const q = sembrarPresupuesto();
  ocultos.add("p1");

  const res = await leer(await POST(req(), { params: { id: q.id } }));

  assert.equal(res.status, 404, JSON.stringify(res.body));
  assert.equal(res.body.invoice, undefined, "no devuelve conceptos ni importes");
  assert.equal(db.invoices.length, 0);
});

test("un presupuesto que el paciente no ha aceptado no se factura", async () => {
  const { POST } = await import("@/app/api/quotes/[id]/invoice/route");
  for (const status of ["DRAFT", "PRESENTED", "REJECTED", "EXPIRED"]) {
    db.quotes = [];
    const q = sembrarPresupuesto({ status });
    const res = await leer(await POST(req(), { params: { id: q.id } }));
    assert.equal(res.status, 409, `${status}: ${JSON.stringify(res.body)}`);
  }
  assert.equal(db.invoices.length, 0);
});

test("el presupuesto de otra clínica: 404 y ninguna factura", async () => {
  const { POST } = await import("@/app/api/quotes/[id]/invoice/route");
  const q = sembrarPresupuesto();
  authCtx.clinicId = "c2";

  const res = await leer(await POST(req(), { params: { id: q.id } }));

  assert.equal(res.status, 404);
  assert.equal(db.invoices.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · Las facturas BORRADOR que ya existen no se tocan
// ═══════════════════════════════════════════════════════════════════════════
test("presupuestos viejos: su factura BORRADOR sigue igual, se re-sincroniza al editar y no se convierte sola", async () => {
  const patch = await import("@/app/api/quotes/[id]/route");
  const estado = await import("@/app/api/quotes/[id]/status/route");
  const facturar = await import("@/app/api/quotes/[id]/invoice/route");

  // Así quedaron los presupuestos creados antes de este arreglo.
  db.invoices.push({
    id: "inv-viejo", clinicId: "c1", patientId: "p1", invoiceNumber: "MF-0007",
    items: [], subtotal: 6800, discount: 200, total: 6800, paid: 0, balance: 6800,
    status: "DRAFT", notes: "Generada desde presupuesto P-0003",
    createdAt: new Date(), updatedAt: new Date(),
  });
  const q = sembrarPresupuesto({ status: "DRAFT", invoiceId: "inv-viejo" });
  const P = { params: { id: q.id } };

  // Editar el presupuesto sigue arrastrando a su borrador (FIN-05).
  const editado = await leer(await patch.PATCH(req({
    title: "Rehabilitación",
    items: [{ name: "Corona", toothFdi: "16", quantity: 1, unitPrice: 5000 }],
  }), P));
  assert.equal(editado.status, 200, JSON.stringify(editado.body));
  assert.equal(db.invoices[0].status, "DRAFT");
  assert.equal(db.invoices[0].total, 5000, "el borrador viejo se re-sincroniza con el presupuesto editado");

  // Aceptarlo y pulsar «Ver/Generar factura» devuelve ESE borrador: no se
  // crea otra ni se confirma por su cuenta.
  const aceptado = await leer(await estado.POST(req({ action: "accept" }), P));
  assert.equal(aceptado.status, 200);
  const res = await leer(await facturar.POST(req(), P));
  assert.equal(res.status, 200);
  assert.equal(res.body.already, true);
  assert.equal(res.body.invoiceNumber, "MF-0007");
  assert.equal(db.invoices.length, 1);
  assert.equal(db.invoices[0].status, "DRAFT", "no se migra nada en silencio");
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · El IVA con el que nace: el de la clínica, como la factura normal
// ═══════════════════════════════════════════════════════════════════════════
// La factura normal (editor de Facturación, POST /api/invoices) y la de una
// cita (from-appointment) nacen con clinicInvoiceTaxDefaults(Clinic.cfdiTaxMode).
// La del presupuesto no mandaba nada y caía al default de la COLUMNA: 16 %
// incluido, también en una clínica exenta. Con IVA incluido el total cobrado es
// el mismo en los dos modos; lo que cambia es el desglose que guarda la factura.

test("🔴 clínica EXENTA: la factura del presupuesto nace SIN IVA y con el mismo total", async () => {
  const { POST } = await import("@/app/api/quotes/[id]/invoice/route");
  db.clinics.c1 = "exempt";
  const q = sembrarPresupuesto();

  const res = await leer(await POST(req(), { params: { id: q.id } }));

  assert.equal(res.status, 201, JSON.stringify(res.body));
  const inv = db.invoices[0];
  assert.equal(inv.taxRate, 0, `una clínica exenta no factura IVA; nació con taxRate ${inv.taxRate}`);
  assert.equal(inv.taxIncluded, true);
  assert.deepEqual(
    { taxRate: inv.taxRate, taxIncluded: inv.taxIncluded },
    clinicInvoiceTaxDefaults("exempt"),
    "lo mismo con lo que nace una factura normal en esa clínica",
  );
  assert.equal(inv.total, 6800, "el total que se le cobra al paciente no cambia");
  assert.equal(inv.balance, 6800);
});

test("🔴 clínica CON IVA (iva16): igual que hoy, 16 % incluido y el mismo total", async () => {
  const { POST } = await import("@/app/api/quotes/[id]/invoice/route");
  db.clinics.c1 = "iva16";
  const q = sembrarPresupuesto();

  const res = await leer(await POST(req(), { params: { id: q.id } }));

  assert.equal(res.status, 201, JSON.stringify(res.body));
  const inv = db.invoices[0];
  assert.equal(inv.taxRate, 16, `a una clínica que causa IVA no se le quita; nació con taxRate ${inv.taxRate}`);
  assert.equal(inv.taxIncluded, true, "incluido en el precio, no agregado encima");
  assert.deepEqual(
    { taxRate: inv.taxRate, taxIncluded: inv.taxIncluded },
    clinicInvoiceTaxDefaults("iva16"),
    "lo mismo con lo que nace una factura normal en esa clínica",
  );
  assert.equal(inv.total, 6800, "el total no sube ni baja: el IVA ya va dentro del precio");
  assert.equal(inv.balance, 6800);
});

test("el IVA sale de la clínica de la SESIÓN, no de otra", async () => {
  const { POST } = await import("@/app/api/quotes/[id]/invoice/route");
  db.clinics = { c1: "exempt", c2: "iva16" };
  sembrarPresupuesto({ id: "q-c1", clinicId: "c1", folio: "P-0001" });
  sembrarPresupuesto({ id: "q-c2", clinicId: "c2", folio: "P-0001" });

  authCtx.clinicId = "c2";
  const enC2 = await leer(await POST(req(), { params: { id: "q-c2" } }));
  authCtx.clinicId = "c1";
  const enC1 = await leer(await POST(req(), { params: { id: "q-c1" } }));

  assert.equal(enC2.status, 201, JSON.stringify(enC2.body));
  assert.equal(enC1.status, 201, JSON.stringify(enC1.body));
  const deC2 = db.invoices.find((i) => i.clinicId === "c2")!;
  const deC1 = db.invoices.find((i) => i.clinicId === "c1")!;
  assert.equal(deC2.taxRate, 16, "c2 causa IVA");
  assert.equal(deC1.taxRate, 0, "c1 es exenta");
});

test("una factura YA CREADA con 16 % en una clínica exenta no se toca al volver a pulsar «Generar factura»", async () => {
  const { POST } = await import("@/app/api/quotes/[id]/invoice/route");
  db.clinics.c1 = "exempt";
  db.invoices.push({
    id: "inv-de-antes", clinicId: "c1", patientId: "p1", invoiceNumber: "MF-0009",
    items: [], subtotal: 7000, discount: 200, total: 6800, paid: 0, balance: 6800,
    status: "PENDING", taxRate: 16, taxIncluded: true, notes: "Generada desde presupuesto P-0003",
    createdAt: new Date(), updatedAt: new Date(),
  });
  const q = sembrarPresupuesto({ invoiceId: "inv-de-antes" });

  const res = await leer(await POST(req(), { params: { id: q.id } }));

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.already, true);
  assert.equal(db.invoices.length, 1);
  assert.equal(db.invoices[0].taxRate, 16, "no se migra nada: la factura vieja conserva su desglose");
  assert.equal(db.invoices[0].total, 6800);
});

// ── Doctor de la factura (ws1-t3) ───────────────────────────────────────────

test("la factura nace a nombre de quien creó el presupuesto, si es DOCTOR de la clínica", async () => {
  const { POST } = await import("@/app/api/quotes/[id]/invoice/route");
  const q = sembrarPresupuesto({ createdById: "doc-1" });

  const res = await leer(await POST(req(), { params: { id: q.id } }));

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(db.invoices[0].doctorId, "doc-1");
  assert.ok(db.invoices[0].dueDate == null, "el vencimiento sigue naciendo vacío");
});

test("si lo creó recepción o un administrador, nace sin doctor — y nunca a nombre de quien factura", async () => {
  const { POST } = await import("@/app/api/quotes/[id]/invoice/route");
  const q = sembrarPresupuesto(); // createdById u1 = ADMIN, que además es la sesión

  const res = await leer(await POST(req(), { params: { id: q.id } }));

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(db.invoices[0].doctorId, null);
});

test("🔴 un doctor de OTRA clínica, un creador borrado o ninguno: sin doctor", async () => {
  const { POST } = await import("@/app/api/quotes/[id]/invoice/route");
  for (const createdById of ["doc-de-c2", "ya-no-existe", null]) {
    db.quotes = []; db.invoices = [];
    const q = sembrarPresupuesto({ createdById });
    const res = await leer(await POST(req(), { params: { id: q.id } }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(db.invoices[0].doctorId, null, `createdById=${createdById}`);
  }
});

test("⛔ una factura que YA existe no recibe doctor al volver a pulsar «Generar factura»", async () => {
  const { POST } = await import("@/app/api/quotes/[id]/invoice/route");
  db.invoices.push({
    id: "inv-sin-doctor", clinicId: "c1", patientId: "p1", invoiceNumber: "MF-0009",
    items: [], subtotal: 7000, discount: 200, total: 6800, paid: 0, balance: 6800,
    status: "DRAFT", doctorId: null, notes: "Generada desde presupuesto P-0003",
    createdAt: new Date(), updatedAt: new Date(),
  });
  const q = sembrarPresupuesto({ createdById: "doc-1", invoiceId: "inv-sin-doctor" });

  const res = await leer(await POST(req(), { params: { id: q.id } }));

  assert.equal(res.body.already, true);
  assert.equal(db.invoices.length, 1);
  assert.equal(db.invoices[0].doctorId, null, "no se toca");
  assert.equal(db.invoices[0].status, "DRAFT", "y sigue siendo borrador");
});
