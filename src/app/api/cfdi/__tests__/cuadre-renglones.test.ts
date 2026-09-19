/**
 * EL CFDI NO PUEDE DECLARAR UN NÚMERO DISTINTO AL DE LA FACTURA.
 *
 * Run: npm run test:cfdi-cuadre
 *
 * Caso real (F-000155): un renglón de $3,052 con `total` $100 → se timbró por
 * $3,052 una factura PAGADA de $100. El CFDI sale de los renglones y el dinero
 * del panel sale de `invoices.total`; si no son el mismo número, no se timbra.
 *
 * Dos niveles:
 *   · la cuenta pura (`cfdiCuadre`), con los casos que de verdad duelen — el
 *     descuadre, y los tres falsos positivos fáciles: descuento de factura, IVA
 *     (incluido / exento / agregado) y el céntimo de redondeo;
 *   · el HANDLER REAL de POST /api/cfdi con `mock.module`: que una factura
 *     descuadrada no llegue a Facturapi NI quede apartada en `cfdiUuid`, y que
 *     las que cuadran se timbren por el importe de la factura. El doble de
 *     Facturapi suma el payload como lo suma el PAC (IVA por concepto), así que
 *     «se timbró por X» sale de los conceptos que la ruta mandó de verdad.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { CLAVES_SAT_MEDICOS, UNIDAD_SAT, FORMAS_PAGO_SAT } from "@/lib/cfdi-catalogs";
import { cfdiCuadre } from "@/lib/invoices/cfdi-cuadre";

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ═══════════════════════════════════════════════════════════════════════════
// La cuenta pura
// ═══════════════════════════════════════════════════════════════════════════

test("F-000155 · renglones 3052 y total 100: NO cuadra, y trae los dos números", () => {
  const c = cfdiCuadre({
    items: [{ description: "Implante dental + corona · sesión 3", quantity: 1, unitPrice: 3052 }],
    discount: 0, total: 100, taxMode: "exento", taxIncluded: true,
  });
  assert.equal(c.ok, false);
  assert.equal(c.invoiceTotal, 100);
  assert.equal(c.cfdiTotal, 3052);
  assert.equal(c.diff, 2952);
});

test("descuento de factura: Σrenglones ≠ total, pero Σrenglones − descuento sí → cuadra", () => {
  const c = cfdiCuadre({
    items: [{ quantity: 1, unitPrice: 1200 }, { quantity: 2, unitPrice: 400 }],
    discount: 500, total: 1500, taxMode: "exento", taxIncluded: true,
  });
  assert.equal(c.ok, true);
  assert.equal(c.cfdiTotal, 1500);
});

test("descuento de factura MÁS descuento de renglón: también cuadra", () => {
  const c = cfdiCuadre({
    items: [{ quantity: 1, unitPrice: 1000, discount: 100 }, { quantity: 1, unitPrice: 333.33 }],
    discount: 33.33, total: 1200, taxMode: "exento", taxIncluded: true,
  });
  assert.equal(c.ok, true);
});

test("el descuento no tapa un descuadre: con descuento y total equivocado NO cuadra", () => {
  const c = cfdiCuadre({
    items: [{ quantity: 1, unitPrice: 3052 }],
    discount: 52, total: 100, taxMode: "exento", taxIncluded: true,
  });
  assert.equal(c.ok, false);
  assert.equal(c.cfdiTotal, 3000);
});

test("IVA incluido y exenta cuadran sobre la base; IVA agregado, sobre base + IVA", () => {
  const items = [{ quantity: 1, unitPrice: 1160 }];
  assert.equal(cfdiCuadre({ items, discount: 0, total: 1160, taxMode: "iva16", taxIncluded: true }).ok, true);
  assert.equal(cfdiCuadre({ items, discount: 0, total: 1160, taxMode: "exento", taxIncluded: true }).ok, true);
  // Agregado: el paciente pagó 1160 × 1.16. Compararlo contra la base lo bloquearía.
  const agregado = cfdiCuadre({ items, discount: 0, total: 1345.6, taxMode: "iva16", taxIncluded: false });
  assert.equal(agregado.ok, true);
  assert.equal(agregado.cfdiTotal, 1345.6);
  // Y al revés: total sin IVA con CFDI que lo agrega NO cuadra.
  assert.equal(cfdiCuadre({ items, discount: 0, total: 1160, taxMode: "iva16", taxIncluded: false }).ok, false);
});

test("un céntimo de redondeo cuadra; dos, en modo bruto, ya no", () => {
  const items = [{ quantity: 3, unitPrice: 10.33 }]; // 30.99
  assert.equal(cfdiCuadre({ items, discount: 0, total: 31.0, taxMode: "exento", taxIncluded: true }).ok, true);
  assert.equal(cfdiCuadre({ items, discount: 0, total: 30.98, taxMode: "exento", taxIncluded: true }).ok, true);
  assert.equal(cfdiCuadre({ items, discount: 0, total: 31.01, taxMode: "exento", taxIncluded: true }).ok, false);
});

test("IVA agregado con varios renglones: el criterio agregado del total guardado cabe en la tolerancia", () => {
  // 8 renglones de 0.33: por concepto el IVA es 8 × 0.05 = 0.40; agregado, round2(2.64 × 0.16) = 0.42.
  const items = Array.from({ length: 8 }, () => ({ quantity: 1, unitPrice: 0.33 }));
  const c = cfdiCuadre({ items, discount: 0, total: 3.06, taxMode: "iva16", taxIncluded: false });
  assert.equal(c.cfdiTotal, 3.04);
  assert.equal(c.ok, true);
});

test("un total ilegible no se da por bueno", () => {
  const items = [{ quantity: 1, unitPrice: 100 }];
  assert.equal(cfdiCuadre({ items, discount: 0, total: NaN, taxMode: "exento", taxIncluded: true }).ok, false);
  assert.equal(cfdiCuadre({ items, discount: 0, total: null as any, taxMode: "exento", taxIncluded: true }).ok, false);
});

// ═══════════════════════════════════════════════════════════════════════════
// El handler real
// ═══════════════════════════════════════════════════════════════════════════

const db = { invoice: null as any, locale: "es", apartados: 0, cfdiRecords: [] as any[] };
const pac = { timbres: 0, payloads: [] as any[] };

function cumple(row: any, where: any): boolean {
  if (!row) return false;
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (v !== null && typeof v === "object") {
      if (!Array.isArray((v as any).notIn)) throw new Error(`el doble no sabe evaluar ${k}`);
      if ((v as any).notIn.includes(row[k])) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

const prismaStub: any = {
  $transaction: async (ops: any[]) => Promise.all(ops),
  clinic: {
    findUnique: async () => ({
      facturApiOrgId: "org_1", facturApiEnabled: true, name: "Clínica", rfcEmisor: "AAA010101AAA",
      plan: "pro", timezone: "America/Mexico_City", cfdiTaxMode: "exempt", csdUploaded: true,
      locale: db.locale,
    }),
  },
  invoice: {
    findFirst: async ({ where }: any) => cumple(db.invoice, where)
      ? { ...db.invoice, patient: { firstName: "Ana", lastName: "Pérez", email: null }, payments: [] }
      : null,
    updateMany: async ({ where, data }: any) => {
      if (!cumple(db.invoice, where)) return { count: 0 };
      if (typeof data.cfdiUuid === "string") db.apartados += 1;
      Object.assign(db.invoice, data);
      return { count: 1 };
    },
    update: async ({ data }: any) => Object.assign(db.invoice, data),
  },
  cfdiRecord: {
    create: async ({ data }: any) => { const row = { id: "cfdi1", ...data }; db.cfdiRecords.push(row); return row; },
  },
  cfdiUsage: { upsert: async () => ({ stamped: 1 }) },
};

(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
(mock as any).module("@/lib/facturapi", {
  namedExports: {
    getOrgApiKey: async () => "sk_test",
    getOrganizationStatus: async () => ({ exists: true, isProductionReady: true, pendingSteps: [] }),
    validateRfc: async () => ({ ok: true }),
    createOrUpdateCustomer: async () => "cus_1",
    // Suma el payload como el PAC: importe − descuento por concepto, y el IVA
    // agregado redondeado línea por línea.
    createInvoice: async (args: any) => {
      pac.timbres += 1;
      pac.payloads.push(args.items);
      const total = r2(args.items.reduce((s: number, it: any) => {
        const base = r2(r2(it.quantity * it.product.price) - (it.discount ?? 0));
        const rate = it.product.taxes?.[0]?.factor === "Exento" ? 0 : (it.product.taxes?.[0]?.rate ?? 0);
        return s + base + (it.product.tax_included ? 0 : r2(base * rate));
      }, 0));
      return { id: "fapi_1", uuid: "UUID-1", total, xml_url: "x", pdf_url: "p" };
    },
    CLAVES_SAT_MEDICOS, UNIDAD_SAT, FORMAS_PAGO_SAT,
  },
});
(mock as any).module("@/lib/facturapi-env", { namedExports: { isFacturapiLive: () => true } });
(mock as any).module("@/lib/plans", {
  namedExports: { getResolvedPlan: async () => ({ cfdiMonthly: 100, cfdiOverageCents: 0 }) },
});
(mock as any).module("@/lib/rate-limit", { namedExports: { rateLimit: () => null } });
(mock as any).module("@/lib/auth-context", {
  namedExports: {
    getAuthContext: async () => ({ clinicId: "c1", userId: "u1", role: "ADMIN", isAdmin: true }),
    requireAdmin: (ctx: any) => (ctx?.isAdmin ? null : new Response(null, { status: 403 })),
  },
});
(mock as any).module("@/lib/patient-visibility", { namedExports: { assertPatientVisible: async () => null } });
(mock as any).module("@/lib/audit", { namedExports: { logMutation: async () => {} } });

function setInvoice(inv: Record<string, any>) {
  db.invoice = {
    id: "inv1", clinicId: "c1", patientId: "p1", invoiceNumber: "F-000155", status: "PAID",
    items: [{ description: "Implante dental + corona · sesión 3", quantity: 1, unitPrice: 3052, total: 3052 }],
    subtotal: 3052, discount: 0, total: 3052, paid: 3052, balance: 0,
    taxRate: 0, taxIncluded: true, paymentMethod: "cash", cfdiUuid: null,
    ...inv,
  };
}

async function timbrar(extra: Record<string, any> = {}) {
  const { POST } = await import("../route");
  const body = {
    invoiceId: "inv1",
    receptor: { rfc: "XAXX010101000", nombre: "PUBLICO EN GENERAL", regimenFiscal: "616", cp: "06000" },
    usoCfdi: "S01", paymentForm: "01", ...extra,
  };
  const [e, w] = [console.error, console.warn];
  console.error = () => {}; console.warn = () => {};
  try {
    const res: any = await POST({ json: async () => body, headers: new Headers(), url: "http://localhost/api/cfdi" } as any);
    return { status: res.status, body: await res.json() };
  } finally { console.error = e; console.warn = w; }
}

beforeEach(() => {
  db.locale = "es";
  db.apartados = 0;
  db.cfdiRecords = [];
  pac.timbres = 0;
  pac.payloads = [];
});

test("ruta · F-000155 (renglón 3052, total 100, PAGADA): NO timbra, NO aparta y dice los dos números", async () => {
  setInvoice({ total: 100, paid: 100 });
  const { status, body } = await timbrar();
  assert.equal(status, 409, "es un 4xx, no un 500");
  assert.equal(body.code, "CFDI_TOTAL_MISMATCH");
  assert.equal(body.invoiceTotal, 100);
  assert.equal(body.cfdiTotal, 3052);
  assert.ok(body.error.includes("$100.00"), body.error);
  assert.ok(body.error.includes("$3,052.00"), body.error);
  assert.ok(body.error.includes("F-000155"), body.error);
  assert.ok(/corrige/i.test(body.error), "dice qué corregir");
  assert.ok(!body.error.includes("{"), "sin variables sin interpolar");
  assert.equal(pac.timbres, 0, "no se pidió el timbre");
  assert.equal(db.apartados, 0, "la comprobación va ANTES del apartado");
  assert.equal(db.invoice.cfdiUuid, null);
  assert.equal(db.invoice.total, 100, "el total NO se toca: no se arregla sola");
  assert.equal(db.cfdiRecords.length, 0);
});

test("ruta · el mensaje sale en inglés para una clínica en inglés, con los mismos números", async () => {
  db.locale = "en";
  setInvoice({ total: 100, paid: 100 });
  const { status, body } = await timbrar();
  assert.equal(status, 409);
  assert.ok(/^Not stamped/.test(body.error), body.error);
  assert.ok(body.error.includes("$100.00") && body.error.includes("$3,052.00"), body.error);
});

test("ruta · el modo de impuestos elegido en el modal no sirve para colar el descuadre", async () => {
  setInvoice({ total: 100, paid: 100 });
  for (const taxMode of ["exento", "iva16"]) {
    const { status, body } = await timbrar({ taxMode });
    assert.equal(status, 409);
    assert.equal(body.code, "CFDI_TOTAL_MISMATCH");
  }
  assert.equal(pac.timbres, 0);
});

test("ruta · factura CON descuento de factura: SÍ timbra, por el total de la factura", async () => {
  setInvoice({
    items: [
      { description: "Corona", quantity: 1, unitPrice: 1200, total: 1200 },
      { description: "Limpieza", quantity: 2, unitPrice: 400, total: 800 },
    ],
    subtotal: 2000, discount: 500, total: 1500, paid: 1500,
  });
  const { status, body } = await timbrar();
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(pac.timbres, 1);
  assert.equal(db.cfdiRecords[0].total, 1500, "el descuento viajó prorrateado en los conceptos");
  assert.equal(body.warning, undefined);
  assert.equal(db.invoice.cfdiUuid, "UUID-1");
});

test("ruta · IVA incluido: timbra si cuadra", async () => {
  setInvoice({
    items: [{ description: "Blanqueamiento", quantity: 1, unitPrice: 1160, total: 1160 }],
    subtotal: 1160, total: 1160, paid: 1160, taxRate: 16, taxIncluded: true,
  });
  const { status, body } = await timbrar({ taxMode: "iva16" });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(db.cfdiRecords[0].total, 1160);
  assert.equal(pac.payloads[0][0].product.tax_included, true);
});

test("ruta · exenta: timbra si cuadra", async () => {
  setInvoice({});
  const { status, body } = await timbrar({ taxMode: "exento" });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(db.cfdiRecords[0].total, 3052);
  assert.equal(pac.payloads[0][0].product.taxes[0].factor, "Exento");
});

test("ruta · IVA agregado sobre la base: timbra por base + IVA, que es lo que pagó el paciente", async () => {
  setInvoice({
    items: [{ description: "Producto", quantity: 1, unitPrice: 1000, total: 1000 }],
    subtotal: 1000, total: 1160, paid: 1160, taxRate: 16, taxIncluded: false,
  });
  const { status, body } = await timbrar();
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(db.cfdiRecords[0].total, 1160);
});

test("ruta · un céntimo de diferencia por redondeo: SÍ timbra", async () => {
  setInvoice({
    items: [{ description: "Resina", quantity: 3, unitPrice: 10.33, total: 30.99 }],
    subtotal: 30.99, total: 31, paid: 31,
  });
  const { status, body } = await timbrar();
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(pac.timbres, 1);
});
