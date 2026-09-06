/**
 * ARITMÉTICA DEL DINERO DE FACTURAS — hallazgos 10, 11, 14, 16 y 17 (WS1-T5).
 *
 * Run: npm run test:invoice-money
 *
 * Por qué existe: la auditoría encontró CERO pruebas sobre la aritmética que
 * escribe dinero en la base, y por eso nada de esto saltó antes:
 *   · H10 — "Aplicar descuento" borraba la línea "Ajuste de precio" y regalaba
 *           la diferencia (3,500 − 200 salía 2,800 en vez de 3,300).
 *   · H11 — paid/balance sin round2: saldo fantasma (1.1e-13) y último abono
 *           rechazado en 17.76 % de los planes de pago.
 *   · H14 — el PATCH fijaba `status` sin validar, puenteando /cancel y /refund.
 *   · H16 — el pago en línea derivaba el saldo de `balance − amount` en vez de
 *           `total − paid`, y un sobrepago no dejaba rastro.
 *   · H17 — efectivo cobrado sin caja abierta no aparecía en ningún arqueo.
 *
 * Cómo prueba: ejercita los HANDLERS REALES (no una copia de su aritmética)
 * con `mock.module` sobre prisma/auth/caché — de ahí el flag
 * `--experimental-test-module-mocks` del script. El doble de Prisma guarda el
 * estado en `db` y cada test lo reinicia con `setInvoice`.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { round2 } from "@/lib/invoice-totals";

// ── Estado del doble de Prisma ──────────────────────────────────────────────
const db: { invoice: any; payments: any[]; register: { openedAt: Date } | null } = {
  invoice: null,
  payments: [],
  register: null,
};

/** Reinicia la "base" con UNA factura y sin pagos. */
function setInvoice(inv: Record<string, any>): any {
  db.invoice = {
    id: "inv1", clinicId: "c1", patientId: "p1",
    status: "PENDING", items: [], subtotal: 0, discount: 0,
    total: 0, paid: 0, balance: 0,
    taxRate: 0, taxIncluded: true, notes: null, paidAt: null, paymentMethod: null,
    ...inv,
  };
  db.payments = [];
  db.register = null;
  return db.invoice;
}

/** Prisma ignora las claves `undefined` de `data`; el doble también. */
function applyData(target: any, data: any) {
  for (const [k, v] of Object.entries(data ?? {})) {
    if (v !== undefined) target[k] = v;
  }
}

/**
 * ¿Alcanza el `where` a la factura guardada? El doble respeta `id` y —lo que
 * importa en un SaaS multi-tenant— `clinicId`: si alguien quitara el filtro de
 * clínica de una consulta, estos tests lo cantan en vez de seguir verdes.
 */
function matches(where: any): boolean {
  if (!db.invoice) return false;
  if (where?.id && where.id !== db.invoice.id) return false;
  if (where?.clinicId && where.clinicId !== db.invoice.clinicId) return false;
  return true;
}

// Prisma devuelve una fila NUEVA en cada lectura: el doble copia, para que el
// handler no se quede aliaseado a la fila que él mismo acaba de escribir.
const invoiceDelegate = {
  findFirst:  async ({ where }: any = {}) => (matches(where) ? { ...db.invoice } : null),
  findUnique: async ({ where }: any = {}) => (matches(where) ? { ...db.invoice } : null),
  updateMany: async ({ where, data }: any) => {
    if (!matches(where)) return { count: 0 };
    applyData(db.invoice, data);
    return { count: 1 };
  },
  update:     async ({ where, data }: any) => {
    if (!matches(where)) throw new Error("update sobre una fila que el where no alcanza");
    applyData(db.invoice, data);
    return { ...db.invoice };
  },
};

const paymentDelegate = {
  create: async ({ data }: any) => {
    const row = { id: `pay${db.payments.length + 1}`, paidAt: data.paidAt ?? new Date(), ...data };
    db.payments.push(row);
    return row;
  },
  findFirst: async ({ where }: any) =>
    db.payments.find((p) => p.reference && p.reference === where?.reference) ?? null,
};

const txStub: any = {
  $queryRaw: async () => [],
  invoice: invoiceDelegate,
  payment: paymentDelegate,
};

const prismaStub: any = {
  // Forma callback (POST de pago, mark-paid, online-payment) y forma arreglo
  // (refund) — Prisma acepta las dos.
  $transaction: async (arg: any) =>
    typeof arg === "function" ? arg(txStub) : Promise.all(arg),
  $queryRaw: async () => [],
  invoice: invoiceDelegate,
  payment: paymentDelegate,
  cashRegister: {
    findFirst: async ({ where }: any = {}) => {
      if (where?.clinicId && where.clinicId !== "c1") return null;
      if (where?.status && where.status !== "OPEN") return null;
      return db.register;
    },
  },
};

// Contexto de sesión mutable: los tests de permisos lo cambian.
const authCtx: any = { clinicId: "c1", userId: "u1", role: "ADMIN", permissionsOverride: null };

(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
(mock as any).module("@/lib/auth-context", {
  namedExports: { getAuthContext: async () => authCtx },
});
(mock as any).module("next/cache", {
  namedExports: { revalidatePath: () => {}, revalidateTag: () => {} },
});
(mock as any).module("@/lib/audit", { namedExports: { logMutation: async () => {} } });
(mock as any).module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => {} } });
(mock as any).module("@/lib/patient-visibility", {
  namedExports: {
    assertPatientVisible: async () => null,
    relatedPatientVisibilityAnd: () => [],
  },
});
(mock as any).module("@/lib/stripe", { namedExports: { getStripeSafe: () => null } });

/** Request mínimo: los handlers solo usan `req.json()` (y pasan `req` al audit). */
function req(body?: any): any {
  return { json: async () => (body ?? {}), headers: new Headers(), url: "http://localhost/api/invoices/inv1" };
}
const P = { params: { id: "inv1" } };

/** Silencia el console.error de las rutas (los avisos son parte del arreglo). */
function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const orig = console.error;
  console.error = () => {};
  return fn().finally(() => { console.error = orig; });
}

async function readJson(res: any) {
  return { status: res.status, body: await res.json() };
}

// ═══════════════════════════════════════════════════════════════════════════
// HALLAZGO 10 — "Aplicar descuento" NO puede borrar la línea "Ajuste de precio"
// ═══════════════════════════════════════════════════════════════════════════
test("H10 · descuento después de subir el precio conserva el ajuste", async () => {
  const { POST } = await import("@/app/api/invoices/[id]/edit-price/route");

  setInvoice({
    items: [{ description: "Corona", quantity: 1, unitPrice: 3000, total: 3000 }],
    subtotal: 3000, total: 3000, balance: 3000,
  });

  // 1) Editar precio 3,000 → 3,500: nace la línea "Ajuste de precio $500".
  const subida = await readJson(await POST(req({ total: 3500 }), P));
  assert.equal(subida.status, 200);
  assert.equal(db.invoice.subtotal, 3500);
  assert.equal(db.invoice.total, 3500);
  assert.equal(db.invoice.items.length, 2, "debe existir la línea de ajuste");

  // 2) Aplicar un descuento de $200 sobre esa factura de $3,500.
  const desc = await readJson(await POST(req({ discount: 200 }), P));
  assert.equal(desc.status, 200);

  // 3,500 − 200 = 3,300. Antes salía 2,800: la rama de `discount` reescribía
  // los conceptos SIN la línea de ajuste y recalculaba sobre los 3,000 base.
  assert.equal(db.invoice.total, 3300, "total = subtotal con ajuste − descuento");
  assert.equal(db.invoice.subtotal, 3500, "el ajuste sigue en el subtotal");
  assert.equal(db.invoice.discount, 200);
  assert.equal(db.invoice.items.length, 2, "la línea de ajuste NO se borra");
  assert.equal(
    db.invoice.items.reduce((s: number, it: any) => s + it.total, 0),
    3500,
    "los conceptos siguen sumando el precio pactado (guarda del timbrado)",
  );
});

test("H10 · el descuento se compara contra el subtotal que muestra el modal", async () => {
  const { POST } = await import("@/app/api/invoices/[id]/edit-price/route");

  setInvoice({
    items: [{ description: "Corona", quantity: 1, unitPrice: 3000, total: 3000 }],
    subtotal: 3000, total: 3000, balance: 3000,
  });
  await POST(req({ total: 3500 }), P);

  // El modal enseña "Subtotal actual: $3,500"; teclear 3,200 daba un 400 porque
  // el servidor comparaba contra la suma SIN el ajuste (3,000).
  const res = await readJson(await POST(req({ discount: 3200 }), P));
  assert.equal(res.status, 200, `un descuento ≤ subtotal no se rechaza (${res.body?.error})`);
  assert.equal(db.invoice.total, 300);
});

test("H10 · un descuento mayor al subtotal real sigue rechazándose", async () => {
  const { POST } = await import("@/app/api/invoices/[id]/edit-price/route");
  setInvoice({
    items: [{ description: "Corona", quantity: 1, unitPrice: 3000, total: 3000 }],
    subtotal: 3000, total: 3000, balance: 3000,
  });
  await POST(req({ total: 3500 }), P);
  const res = await readJson(await POST(req({ discount: 3500.01 }), P));
  assert.equal(res.status, 400);
  assert.equal(db.invoice.total, 3500, "la factura no se toca en el rechazo");
});

test("H10 · con IVA agregado (taxIncluded:false) el descuento también conserva el ajuste", async () => {
  const { POST } = await import("@/app/api/invoices/[id]/edit-price/route");

  setInvoice({
    items: [{ description: "Corona", quantity: 1, unitPrice: 3000, total: 3000 }],
    subtotal: 3000, total: 3480, balance: 3480,
    taxRate: 16, taxIncluded: false,
  });

  // Precio final $4,060 = base 3,500 + 16 %. Nace la línea de ajuste de $500.
  await POST(req({ total: 4060 }), P);
  assert.equal(db.invoice.subtotal, 3500);
  assert.equal(db.invoice.total, 4060);

  // Descuento de $200 sobre la base: (3,500 − 200) × 1.16 = 3,828.
  const res = await readJson(await POST(req({ discount: 200 }), P));
  assert.equal(res.status, 200);
  assert.equal(db.invoice.subtotal, 3500, "el ajuste sigue en la base gravada");
  assert.equal(db.invoice.total, 3828, "sin el ajuste habría salido 3,248");
});

// ═══════════════════════════════════════════════════════════════════════════
// HALLAZGO 11 — paid/balance SIEMPRE redondeados a centavos
// ═══════════════════════════════════════════════════════════════════════════
test("H11 · $1,000.01 en 6 abonos termina en PAID con saldo 0", async () => {
  const { POST } = await import("@/app/api/invoices/[id]/route");

  setInvoice({ total: 1000.01, balance: 1000.01, subtotal: 1000.01 });

  const cuotas = [166.67, 166.67, 166.67, 166.67, 166.67, 166.66];
  for (const [i, amount] of cuotas.entries()) {
    const res = await readJson(await quiet(() => POST(req({ amount, method: "cash" }), P)));
    assert.equal(res.status, 200, `abono ${i + 1} de $${amount} rechazado: ${res.body?.error}`);
  }

  assert.equal(db.invoice.paid, 1000.01, "paid exacto, sin 1000.0099999999999");
  assert.equal(db.invoice.balance, 0, "sin saldo fantasma de 1.1e-13");
  assert.equal(db.invoice.status, "PAID", "no puede quedarse en PARTIAL");
  assert.equal(db.payments.length, 6);
});

test("H11 · $500 en 12 abonos: el duodécimo de $41.63 no se rechaza", async () => {
  const { POST } = await import("@/app/api/invoices/[id]/route");

  setInvoice({ total: 500, balance: 500, subtotal: 500 });

  for (let i = 0; i < 11; i++) {
    const res = await readJson(await quiet(() => POST(req({ amount: 41.67, method: "cash" }), P)));
    assert.equal(res.status, 200, `abono ${i + 1} rechazado: ${res.body?.error}`);
  }
  const ultimo = await readJson(await quiet(() => POST(req({ amount: 41.63, method: "cash" }), P)));
  assert.equal(ultimo.status, 200, `el último abono se rechazó: ${ultimo.body?.error}`);
  assert.equal(db.invoice.paid, 500);
  assert.equal(db.invoice.balance, 0);
  assert.equal(db.invoice.status, "PAID");
});

test("H11 · barrido de planes de pago: ni un abono rechazado, ni un saldo fantasma", async () => {
  const { POST } = await import("@/app/api/invoices/[id]/route");

  // El MISMO universo que midió la auditoría: facturas de $500 a $50,000 en 3,
  // 4, 6 y 12 abonos iguales (el residuo de centavos va en el último). Con el
  // código de antes, el último abono se RECHAZABA en el 17.76 % de los casos y
  // otro 6.65 % terminaba PARTIAL con saldo fantasma.
  //
  // Por defecto corre una muestra (paso de $250, 796 casos) para que el test
  // dure segundos. El barrido completo de 198,004 casos:
  //     BARRIDO_FACTURAS=completo npm run test:invoice-money
  const paso = process.env.BARRIDO_FACTURAS === "completo" ? 1 : 250;
  const rechazados: string[] = [];
  const fantasmas: string[] = [];
  let casos = 0;

  for (let total = 500; total <= 50_000; total += paso) {
    for (const n of [3, 4, 6, 12]) {
      casos++;
      setInvoice({ total, balance: total, subtotal: total });
      const cuota = round2(total / n);
      for (let i = 0; i < n; i++) {
        const amount = i < n - 1 ? cuota : round2(total - cuota * (n - 1));
        const res: any = await POST(req({ amount, method: "transfer" }), P);
        if (res.status !== 200) rechazados.push(`$${total} en ${n} abonos (abono ${i + 1} de $${amount})`);
      }
      if (db.invoice.paid !== total || db.invoice.balance !== 0 || db.invoice.status !== "PAID") {
        fantasmas.push(`$${total} en ${n}: paid=${db.invoice.paid} balance=${db.invoice.balance} ${db.invoice.status}`);
      }
    }
  }

  assert.equal(rechazados.length, 0, `abonos rechazados (${rechazados.length}/${casos}): ${rechazados.slice(0, 3).join(" · ")}`);
  assert.equal(fantasmas.length, 0, `saldos fantasma (${fantasmas.length}/${casos}): ${fantasmas.slice(0, 3).join(" · ")}`);
});

test("H11 · un abono mayor al saldo real sigue rechazándose", async () => {
  const { POST } = await import("@/app/api/invoices/[id]/route");
  setInvoice({ total: 500, balance: 500, subtotal: 500 });
  const res = await readJson(await quiet(() => POST(req({ amount: 500.5, method: "cash" }), P)));
  assert.equal(res.status, 400);
  assert.equal(db.invoice.paid, 0, "nada se escribió");
});

test("H11 · mark-paid no crea un Payment de $0.0000000000001", async () => {
  const { POST } = await import("@/app/api/invoices/[id]/mark-paid/route");

  // Factura legada con el saldo fantasma que dejaba el código de antes.
  setInvoice({
    total: 1000.01,
    paid: 1000.0099999999999,
    balance: 1.1368683772161603e-13,
    status: "PARTIAL",
  });

  const res = await readJson(await quiet(() => POST(req({}), P)));
  assert.equal(res.status, 200, `mark-paid falló: ${res.body?.error}`);
  assert.equal(db.payments.length, 0, "no hay dinero nuevo: no se registra Payment");
  assert.equal(db.invoice.paid, 1000.01);
  assert.equal(db.invoice.balance, 0);
  assert.equal(db.invoice.status, "PAID");
});

test("H11 · mark-paid normal cobra el saldo exacto", async () => {
  const { POST } = await import("@/app/api/invoices/[id]/mark-paid/route");
  setInvoice({ total: 1000.01, paid: 333.34, balance: 666.67, status: "PARTIAL" });

  const res = await readJson(await quiet(() => POST(req({}), P)));
  assert.equal(res.status, 200);
  assert.equal(db.payments.length, 1);
  assert.equal(db.payments[0].amount, 666.67);
  assert.equal(db.invoice.paid, 1000.01);
  assert.equal(db.invoice.balance, 0);
  assert.equal(db.invoice.status, "PAID");
});

test("H11 · el reembolso deja paid y balance en centavos exactos", async () => {
  const { POST } = await import("@/app/api/invoices/[id]/refund/route");
  setInvoice({ total: 1000.01, paid: 1000.01, balance: 0, status: "PAID", paidAt: new Date() });

  const res = await readJson(await POST(req({ amount: 333.34, reason: "cancelación" }), P));
  assert.equal(res.status, 200);
  assert.equal(db.invoice.paid, 666.67, "sin 666.6700000000001");
  assert.equal(db.invoice.balance, 333.34, "sin 333.33999999999992");
  assert.equal(db.invoice.status, "PARTIAL");
});

test("H11 · el reembolso total de una factura con paid fantasma no se rechaza", async () => {
  const { POST } = await import("@/app/api/invoices/[id]/refund/route");
  // Factura legada cobrada en 6 abonos con el código de antes.
  setInvoice({
    total: 1000.01, paid: 1000.0099999999999, balance: 1.1368683772161603e-13,
    status: "PARTIAL",
  });

  const res = await readJson(await POST(req({ amount: 1000.01, reason: "devolución" }), P));
  assert.equal(res.status, 200, `el reembolso completo se rechazó: ${res.body?.error}`);
  assert.equal(db.invoice.paid, 0, "paid en 0 exacto, sin −0 ni 1e-13");
  assert.ok(!Object.is(db.invoice.paid, -0), "nada de −$0.00 en pantalla");
  assert.equal(db.invoice.balance, 1000.01);
  assert.equal(db.invoice.status, "PENDING");
});

test("H11 · la factura de otra clínica no se cobra (aislamiento por clinicId)", async () => {
  const { POST } = await import("@/app/api/invoices/[id]/route");
  setInvoice({ clinicId: "c2", total: 1000, balance: 1000, subtotal: 1000 });

  const res = await readJson(await POST(req({ amount: 100, method: "cash" }), P));
  assert.equal(res.status, 404, "la sesión es de c1: esa factura no existe para ella");
  assert.equal(db.payments.length, 0);
  assert.equal(db.invoice.paid, 0);
});

test("H11 · mark-paid sobre una factura en $0 sigue dando 400", async () => {
  const { POST } = await import("@/app/api/invoices/[id]/mark-paid/route");
  setInvoice({ total: 0, paid: 0, balance: 0, status: "PENDING" });

  const res = await readJson(await POST(req({}), P));
  assert.equal(res.status, 400);
  assert.equal(db.invoice.status, "PENDING", "no se salda lo que nunca se cobró");
  assert.equal(db.payments.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// HALLAZGO 14 — el PATCH no fija `status`
// ═══════════════════════════════════════════════════════════════════════════
test("H14 · PATCH {status:CANCELLED} sobre una factura cobrada se rechaza", async () => {
  const { PATCH } = await import("@/app/api/invoices/[id]/route");
  setInvoice({ total: 5000, paid: 5000, balance: 0, status: "PAID", paidAt: new Date() });

  const res = await readJson(await PATCH(req({ status: "CANCELLED" }), P));
  assert.equal(res.status, 400, "no se cancela una factura cobrada por PATCH");
  assert.equal(db.invoice.status, "PAID", "los $5,000 no desaparecen de la caja");
  assert.match(res.body.error ?? "", /cancel|reembols|endpoint/i);
});

test("H14 · PATCH {status:PENDING} no resucita una factura cancelada", async () => {
  const { PATCH } = await import("@/app/api/invoices/[id]/route");
  setInvoice({ total: 5000, paid: 0, balance: 5000, status: "CANCELLED" });

  const res = await readJson(await PATCH(req({ status: "PENDING" }), P));
  assert.equal(res.status, 400);
  assert.equal(db.invoice.status, "CANCELLED", "una cancelada no vuelve a ser timbrable");
});

test("H14 · PATCH {status:PAID} no pinta PAGADA una factura con saldo", async () => {
  const { PATCH } = await import("@/app/api/invoices/[id]/route");
  setInvoice({ total: 5000, paid: 0, balance: 5000, status: "PENDING" });

  const res = await readJson(await PATCH(req({ status: "PAID" }), P));
  assert.equal(res.status, 400);
  assert.equal(db.invoice.status, "PENDING");
  assert.equal(db.invoice.balance, 5000);
});

test("H14 · el PATCH de notas y conceptos sigue funcionando", async () => {
  const { PATCH } = await import("@/app/api/invoices/[id]/route");

  setInvoice({ total: 1000, balance: 1000, subtotal: 1000, status: "PENDING", notes: "vieja" });
  const soloNotas = await readJson(await PATCH(req({ notes: "nota nueva" }), P));
  assert.equal(soloNotas.status, 200, `las notas deben poder editarse: ${soloNotas.body?.error}`);
  assert.equal(db.invoice.notes, "nota nueva");

  setInvoice({ total: 1000, balance: 1000, subtotal: 1000, status: "DRAFT" });
  const conItems = await readJson(await PATCH(
    req({ items: [{ description: "Limpieza", quantity: 1, unitPrice: 800, total: 800 }] }), P,
  ));
  assert.equal(conItems.status, 200, `el borrador debe poder editarse: ${conItems.body?.error}`);
  assert.equal(db.invoice.total, 800);

  // Y el mismo status que ya tiene no es una transición: no rompe a quien reenvía.
  setInvoice({ total: 1000, balance: 1000, status: "PENDING" });
  const mismo = await readJson(await PATCH(req({ status: "PENDING", notes: "x" }), P));
  assert.equal(mismo.status, 200);
  assert.equal(db.invoice.notes, "x");
});

// ═══════════════════════════════════════════════════════════════════════════
// HALLAZGO 16 — el pago en línea deriva el saldo de total − paid, y avisa
// ═══════════════════════════════════════════════════════════════════════════
test("H16 · un sobrepago en línea queda señalado", async () => {
  const { applyInvoiceOnlinePayment } = await import("@/lib/patient-portal/online-payment");

  // $1,000 con $400 cobrados en efectivo mientras el paciente tenía abierto el
  // Checkout por el total: llega el webhook por $1,000.
  setInvoice({ total: 1000, paid: 400, balance: 600, status: "PARTIAL", subtotal: 1000 });

  const out = await quiet(() => applyInvoiceOnlinePayment({
    invoiceId: "inv1", amountMxn: 1000, reference: "pi_1",
  }));

  assert.equal(out.applied, true);
  assert.equal(out.reason, "overpaid", "el excedente tiene que salir señalado");
  assert.equal(db.invoice.paid, 1400, "el dinero cobrado se registra tal cual");
  assert.equal(db.invoice.balance, 0);
  assert.equal(db.invoice.status, "PAID");
  assert.equal(db.payments.length, 1);
  assert.match(db.payments[0].notes ?? "", /⚠️/);
  assert.match(db.payments[0].notes ?? "", /400/, "la nota dice cuánto sobra");
});

test("H16 · el saldo del pago en línea sale de total − paid", async () => {
  const { applyInvoiceOnlinePayment } = await import("@/lib/patient-portal/online-payment");

  // Factura legada con `balance` desincronizado (700) del invariante (600).
  setInvoice({ total: 1000, paid: 400, balance: 700, status: "PARTIAL", subtotal: 1000 });

  const out = await quiet(() => applyInvoiceOnlinePayment({
    invoiceId: "inv1", amountMxn: 300, reference: "pi_2",
  }));

  assert.equal(out.applied, true);
  assert.equal(db.invoice.paid, 700);
  assert.equal(db.invoice.balance, 300, "300 = total − paid, no 400 = balance − amount");
  assert.equal(db.invoice.status, "PARTIAL");
});

test("H16 · un pago en línea normal sigue saldando la factura", async () => {
  const { applyInvoiceOnlinePayment } = await import("@/lib/patient-portal/online-payment");
  setInvoice({ total: 1000, paid: 0, balance: 1000, status: "PENDING", subtotal: 1000 });

  const out = await applyInvoiceOnlinePayment({ invoiceId: "inv1", amountMxn: 1000, reference: "pi_3" });
  assert.equal(out.applied, true);
  assert.equal(out.reason, undefined);
  assert.equal(db.invoice.paid, 1000);
  assert.equal(db.invoice.balance, 0);
  assert.equal(db.invoice.status, "PAID");
  assert.equal(db.payments[0].notes, "Pago en línea desde el portal del paciente");
});

test("H16 · un balance en 0 desincronizado no archiva el pago real", async () => {
  const { applyInvoiceOnlinePayment } = await import("@/lib/patient-portal/online-payment");

  // Factura de $1,000 sin cobrar cuya columna `balance` quedó en 0 (fila legada
  // o piso en 0 de un total bajado). El pago del paciente TIENE que aplicarse.
  setInvoice({ total: 1000, paid: 0, balance: 0, status: "PENDING", subtotal: 1000 });

  const out = await quiet(() => applyInvoiceOnlinePayment({
    invoiceId: "inv1", amountMxn: 1000, reference: "pi_4",
  }));

  assert.equal(out.applied, true);
  assert.notEqual(out.reason, "anomaly", "no es una factura saldada: debía $1,000");
  assert.equal(db.invoice.paid, 1000);
  assert.equal(db.invoice.balance, 0);
  assert.equal(db.invoice.status, "PAID");
});

// ═══════════════════════════════════════════════════════════════════════════
// HALLAZGO 17 — efectivo fuera de un turno de caja queda MARCADO
// ═══════════════════════════════════════════════════════════════════════════
test("H17 · efectivo sin caja abierta se cobra pero queda marcado", async () => {
  const { POST } = await import("@/app/api/invoices/[id]/route");

  setInvoice({ total: 1500, balance: 1500, subtotal: 1500 });
  db.register = null; // corte hecho a las 19:00; son las 20:30

  const res = await readJson(await quiet(() => POST(req({ amount: 1500, method: "cash" }), P)));

  assert.equal(res.status, 200, "bloquear el cobro dejaría a la clínica sin poder cobrar");
  assert.equal(db.payments.length, 1);
  assert.match(db.payments[0].notes ?? "", /sin caja abierta/i, "el dinero deja rastro");
  assert.ok(res.body.warning, "la respuesta avisa para que la UI lo muestre");
});

test("H17 · con la caja abierta el cobro en efectivo no se marca", async () => {
  const { POST } = await import("@/app/api/invoices/[id]/route");

  setInvoice({ total: 1500, balance: 1500, subtotal: 1500 });
  db.register = { openedAt: new Date(Date.now() - 3600_000) };

  const res = await readJson(await POST(req({ amount: 1500, method: "cash", notes: "abono" }), P));
  assert.equal(res.status, 200);
  assert.equal(db.payments[0].notes, "abono", "sin ruido en el flujo normal");
  assert.equal(res.body.warning, undefined);
});

test("H17 · la fecha que manda el modal no dispara el aviso (falso positivo)", async () => {
  const { POST } = await import("@/app/api/invoices/[id]/route");

  setInvoice({ total: 1500, balance: 1500, subtotal: 1500 });
  db.register = { openedAt: new Date(Date.now() - 3600_000) };

  // payment-modal.tsx manda `new Date("AAAA-MM-DD").toISOString()`: medianoche
  // UTC, que en México son las 18:00 del día ANTERIOR. Comparar esa fecha
  // contra `openedAt` marcaría casi todos los cobros del día y el aviso dejaría
  // de significar nada, así que el aviso mira solo si HAY caja abierta.
  const comoElModal = new Date(new Date().toISOString().slice(0, 10)).toISOString();
  const res = await readJson(await POST(req({ amount: 1500, method: "cash", paidAt: comoElModal }), P));

  assert.equal(res.status, 200);
  assert.equal(db.payments[0].notes ?? null, null, "un cobro normal del día no se marca");
  assert.equal(res.body.warning, undefined);
});

test("H17 · una transferencia sin caja abierta no se marca", async () => {
  const { POST } = await import("@/app/api/invoices/[id]/route");

  setInvoice({ total: 1500, balance: 1500, subtotal: 1500 });
  db.register = null;

  const res = await readJson(await POST(req({ amount: 1500, method: "transfer" }), P));
  assert.equal(res.status, 200);
  assert.equal(db.payments[0].notes ?? null, null, "el arqueo de efectivo no le aplica");
  assert.equal(res.body.warning, undefined);
});

test("H17 · mark-paid en efectivo sin caja abierta también marca", async () => {
  const { POST } = await import("@/app/api/invoices/[id]/mark-paid/route");

  setInvoice({ total: 1500, balance: 1500, subtotal: 1500 });
  db.register = null;

  const res = await readJson(await quiet(() => POST(req({}), P)));
  assert.equal(res.status, 200);
  assert.equal(db.payments.length, 1);
  assert.match(db.payments[0].notes ?? "", /sin caja abierta/i);
  assert.ok(res.body.warning);
});
