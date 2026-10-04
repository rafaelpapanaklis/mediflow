/**
 * Núcleo del timbrado, vuelta 2 (ws1-t4, 3-oct-2026). HANDLERS REALES de
 *   · POST /api/cfdi                (factura completa)
 *   · POST /api/payments/[id]/cfdi  («Facturar este pago»)
 * con Facturapi y la base simulados: aquí no se timbra NADA de verdad.
 *
 * Run: npm run test:cfdi-vuelta2
 *
 *   · F-05 receptor   — el cliente sale del receptor NORMALIZADO; extranjero con su país y S01.
 *   · F-07 IVA/pago   — un pago de $1,160 con IVA agregado timbraba $1,345.60.
 *   · F-12 llave      — misma idempotency_key para el mismo apartado; «Reintentar»
 *                       tras un «no se sabe» trae el CFDI que ya salió, no otro.
 *   · F-19 identidad  — serie/folio de la factura y external_id.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { CLAVES_SAT_MEDICOS, UNIDAD_SAT, FORMAS_PAGO_SAT } from "@/lib/cfdi-catalogs";
import { marcarTimbre } from "@/lib/invoices/cfdi-timbre-incierto";

// ── Estado ──────────────────────────────────────────────────────────────────
const db = {
  clinic: null as any,
  invoice: null as any,
  payments: [] as any[],
  credits: [] as any[],
  /** Pagos de otras facturas (origen de un saldo a favor). */
  otrosPagos: [] as any[],
  condiciones: null as any,
  cfdiPorPago: [] as any[],
  cfdiRecords: [] as any[],
  /** ¿Está pegado sql/ws1-t4-cfdi-ambiente.sql? */
  columnaAmbiente: true,
  /** null = falta sql/ws1-t4-cfdi-retenciones.sql; true/false = el ajuste de la clínica (F-01). */
  retenciones: null as boolean | null,
  /** Catálogo de procedimientos con su clave SAT e IVA (F-11 / F-08). */
  catalogo: [] as { id: string; name: string; category: string; claveSat: string | null; ivaCfdi: string | null }[],
};
const pac = {
  /** Cada petición de timbre que llegó a Facturapi (con sus argumentos). */
  timbres: [] as any[],
  /** CFDI emitidos de verdad, por idempotency_key: el doble de Facturapi respeta la llave. */
  porLlave: new Map<string, any>(),
  emitidos: 0,
  clientes: [] as any[],
  validaciones: 0,
  /** El timbre SALE y la respuesta se pierde (corte de red). */
  perderRespuesta: false,
  /** Total que «timbra» el SAT (si no, el del cálculo de Facturapi). */
  totalForzado: null as number | null,
  /** Si trae texto, Facturapi rechaza el timbre con ese mensaje (4xx: no salió). */
  rechazo: null as string | null,
};
const authCtx: any = { clinicId: "c1", userId: "u1", role: "ADMIN", isAdmin: true };

function setClinic(over: Record<string, any> = {}) {
  db.clinic = {
    facturApiOrgId: "org_1", facturApiEnabled: true, name: "Clínica", rfcEmisor: "ROAB800101AB1",
    plan: "pro", timezone: "America/Mexico_City", cfdiTaxMode: "exempt", csdUploaded: true,
    locale: "es", regimenFiscal: "626", ...over,
  };
}
/** Factura de $1,600 exenta, pagada con débito. */
function setInvoice(over: Record<string, any> = {}, pagos?: any[]) {
  db.invoice = {
    id: "inv1", clinicId: "c1", patientId: "p1", invoiceNumber: "F-0002",
    status: "PAID", items: [{ description: "Control de ortodoncia", quantity: 1, unitPrice: 1600, total: 1600 }],
    subtotal: 1600, discount: 0, total: 1600, paid: 1600, balance: 0,
    taxRate: 0, taxIncluded: true, paymentMethod: null, cfdiUuid: null, ...over,
  };
  db.payments = pagos ?? [{ id: "pay1", invoiceId: "inv1", method: "debit", amount: 1600, paidAt: new Date("2026-10-02T12:00:00Z") }];
}

function cumple(row: any, where: any): boolean {
  if (!row) return false;
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      const c = v as any;
      if (c.notIn !== undefined && c.notIn.includes(row[k])) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

/** Doble de $queryRaw / $executeRaw para lo que lee y escribe el ambiente (F-14). */
function sqlDe(strings: TemplateStringsArray) { return strings.join("?"); }
const prismaStub: any = {
  $queryRaw: async (strings: TemplateStringsArray, ...vals: any[]) => {
    const q = sqlDe(strings);
    if (q.includes("information_schema.columns") && q.includes("procedure_catalog")) return [{ column_name: "claveSat" }, { column_name: "ivaCfdi" }];
    if (q.includes("information_schema.columns") && q.includes("cfdiRetenciones")) return db.retenciones === null ? [] : [{ n: 1 }];
    if (q.includes('SELECT "cfdiRetenciones"')) return [{ v: db.retenciones === true }];
    if (q.includes('SELECT "id", "claveSat", "ivaCfdi"')) return db.catalogo.map((c) => ({ id: c.id, claveSat: c.claveSat, ivaCfdi: c.ivaCfdi }));
    if (q.includes("information_schema.columns")) return db.columnaAmbiente ? [{ n: 1 }] : [];
    if (q.includes('SELECT "environment"')) {
      const r = db.cfdiRecords.find((x) => x.uuid === vals[1]);
      return r ? [{ environment: r.environment ?? null }] : [];
    }
    return [];
  },
  $executeRaw: async (strings: TemplateStringsArray, ...vals: any[]) => {
    const q = sqlDe(strings);
    if (q.includes('SET "environment"')) { const r = db.cfdiRecords.find((x) => x.uuid === vals[2]); if (r) r.environment = vals[0]; return r ? 1 : 0; }
    if (q.includes(`SET "status" = 'prueba'`)) { const r = db.cfdiRecords.find((x) => x.uuid === vals[1] && x.environment === "test" && x.status === "valid"); if (r) r.status = "prueba"; return r ? 1 : 0; }
    return 0;
  },
  $transaction: async (arg: any) => (typeof arg === "function" ? arg(prismaStub) : Promise.all(arg)),
  clinic: { findUnique: async () => ({ ...db.clinic }) },
  procedureCatalog: { findMany: async () => db.catalogo.map((c) => ({ id: c.id, name: c.name, category: c.category })) },
  invoice: {
    findFirst: async ({ where }: any) => {
      if (!cumple(db.invoice, { id: where?.id, clinicId: where?.clinicId })) return null;
      return { ...db.invoice, patient: { firstName: "Ana", lastName: "Pérez", email: null }, payments: [...db.payments] };
    },
    updateMany: async ({ where, data }: any) => {
      if (!cumple(db.invoice, where)) return { count: 0 };
      Object.assign(db.invoice, data);
      return { count: 1 };
    },
    update: async ({ data }: any) => { Object.assign(db.invoice, data); return { ...db.invoice }; },
  },
  payment: {
    findFirst: async ({ where }: any) => {
      const p = db.payments.find((x) => x.id === where?.id);
      if (!p || where?.invoice?.clinicId !== db.invoice.clinicId) return null;
      return { ...p, invoice: { ...db.invoice, patient: { firstName: "Ana", lastName: "Pérez", email: null }, payments: [...db.payments] } };
    },
    findMany: async ({ where }: any) => {
      const todos = [...db.payments, ...db.otrosPagos];
      const ids = new Set<string>();
      const facturas = new Set<string>();
      for (const o of where?.OR ?? []) {
        for (const id of o.id?.in ?? []) ids.add(id);
        for (const id of o.invoiceId?.in ?? []) facturas.add(id);
      }
      return todos.filter((p) => ids.has(p.id) || facturas.has(p.invoiceId));
    },
  },
  patientCredit: {
    findFirst: async () => null,
    findMany: async ({ where }: any) => db.credits.filter((c) => c.clinicId === where.clinicId && c.patientId === where.patientId && c.amount > 0),
  },
  cfdiRecord: {
    create: async ({ data }: any) => { db.cfdiRecords.push(data); return { id: "cfdi1", ...data }; },
    findFirst: async ({ where }: any) => db.cfdiRecords.find((r) => r.invoiceId === where?.invoiceId && r.status === where?.status && (r.tipoComprobante ?? "I") === where?.tipoComprobante) ?? null,
  },
  cfdiUsage: { upsert: async () => ({ stamped: 1 }) },
};

(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
(mock as any).module("@/lib/facturapi", {
  namedExports: {
    getOrgApiKey: async () => "sk_test",
    getOrganizationStatus: async () => ({ exists: true, isProductionReady: true, pendingSteps: [], stepsKnown: true }),
    validateRfc: async () => { pac.validaciones += 1; return { ok: true }; },
    createOrUpdateCustomer: async (_k: string, cliente: any) => { pac.clientes.push(cliente); return "cus_1"; },
    createInvoice: async (args: any) => {
      pac.timbres.push(args);
      if (pac.rechazo) throw marcarTimbre(new Error(pac.rechazo), false);
      const ya = args.idempotencyKey ? pac.porLlave.get(args.idempotencyKey) : null;
      if (ya) return ya; // misma llave: Facturapi devuelve el que ya emitió
      // Como Facturapi: con tax_included el precio ya trae el IVA; sin él, se le suma.
      const r2 = (x: number) => Math.round(x * 100) / 100;
      const total = r2(args.items.reduce((a: number, it: any) => {
        const bruto = it.product.price * it.quantity - (it.discount ?? 0);
        const taxes = it.product.taxes ?? [];
        const iva = taxes.some((t: any) => t.type === "IVA" && t.rate === 0.16 && !t.withholding);
        if (it.product.tax_included) return a + bruto; // (solo sin retenciones)
        const base = r2(bruto);
        const ret = taxes.filter((t: any) => t.withholding).reduce((x: number, t: any) => x + r2(base * t.rate), 0);
        return a + base + (iva ? r2(base * 0.16) : 0) - ret;
      }, 0));
      pac.emitidos += 1;
      const r = { id: `fapi_${pac.emitidos}`, uuid: `UUID-${pac.emitidos}`, total: pac.totalForzado ?? total };
      if (args.idempotencyKey) pac.porLlave.set(args.idempotencyKey, r);
      if (pac.perderRespuesta) { pac.perderRespuesta = false; throw marcarTimbre(new TypeError("fetch failed"), true); }
      return r;
    },
    CLAVES_SAT_MEDICOS, UNIDAD_SAT, FORMAS_PAGO_SAT,
  },
});
/** FACTURAPI_ENV de la prueba (pruebas por defecto). */
const entornoLive = { live: false };
(mock as any).module("@/lib/facturapi-env", { namedExports: { isFacturapiLive: () => entornoLive.live, facturapiEnv: () => (entornoLive.live ? "live" : "test") } });
(mock as any).module("@/lib/plans", { namedExports: { getResolvedPlan: async () => ({ cfdiMonthly: 100, cfdiOverageCents: 0 }) } });
(mock as any).module("@/lib/auth-context", {
  namedExports: {
    getAuthContext: async () => authCtx,
    requireAdmin: (ctx: any) => (ctx?.isAdmin ? null : new Response(null, { status: 403 })),
  },
});
(mock as any).module("@/lib/patient-visibility", { namedExports: { assertPatientVisible: async () => null } });
const bitacora: any[] = [];
(mock as any).module("@/lib/audit", { namedExports: { logMutation: async (e: any) => { bitacora.push(e); } } });
(mock as any).module("@/lib/invoices/condiciones-pago-db", {
  namedExports: {
    leerCondicionesDeFacturas: async () => ({ porFactura: new Map(db.condiciones ? [["inv1", db.condiciones]] : []) }),
  },
});
(mock as any).module("@/lib/invoices/cfdi-pago-db", {
  namedExports: {
    algunPagoTieneCfdiVigente: async () => false,
    columnaPagoListaParaCfdi: async () => true,
    buscarCfdiDePago: async () => null,
    sumaCfdiValidaDeFactura: async () => 0,
    claimDePago: (id: string) => `timbrando:${id}`,
    apartarCfdiDePago: async () => ({ ok: true, id: "fila1" }),
    confirmarCfdiDePago: async (_db: any, a: any) => { db.cfdiPorPago.push(a); return { id: "cfdiPago1" }; },
    soltarCfdiDePago: async () => {},
  },
});

// ── Utilidades ──────────────────────────────────────────────────────────────
function req(body: any): any {
  return { json: async () => body, headers: new Headers({ "x-forwarded-for": "10.0.0.1" }), nextUrl: new URL("http://localhost/api/cfdi"), url: "http://localhost/api/cfdi" };
}
async function leer(res: any) { return { status: res.status, body: await res.json() }; }
async function quieto<T>(fn: () => Promise<T>): Promise<T> {
  const [e, w] = [console.error, console.warn];
  console.error = () => {}; console.warn = () => {};
  try { return await fn(); } finally { console.error = e; console.warn = w; }
}

const PF_612 = { rfc: "GOMA800101AB1", nombre: "ANA GOMEZ", regimenFiscal: "612", cp: "06600" };
const EMPRESA = { rfc: "ABC010101AB1", nombre: "EMPRESA SA DE CV", regimenFiscal: "601", cp: "06600" };
const PUBLICO = { rfc: "XAXX010101000", nombre: "PUBLICO EN GENERAL", regimenFiscal: "616", cp: "06600" };
const PLAZOS = { modo: "plazos", metodo: null, enganche: 2000, numPagos: 12, frecuencia: "MONTHLY", primerPago: "2026-10-01", difiereConSuBanco: false };

async function timbrar(body: Record<string, any>) {
  const { POST } = await import("@/app/api/cfdi/route");
  return quieto(async () => leer(await POST(req({ invoiceId: "inv1", taxMode: "exento", ...body }))));
}
async function timbrarPago(paymentId: string, body: Record<string, any>) {
  const { POST } = await import("@/app/api/payments/[id]/cfdi/route");
  return quieto(async () => leer(await POST(req({ taxMode: "exento", ...body }), { params: { id: paymentId } })));
}

beforeEach(async () => {
  authCtx.clinicId = "c1";
  setClinic();
  setInvoice();
  db.credits = [];
  db.otrosPagos = [];
  db.condiciones = null;
  db.cfdiPorPago = [];
  db.cfdiRecords = [];
  pac.timbres = [];
  pac.porLlave = new Map();
  pac.emitidos = 0;
  pac.clientes = [];
  pac.validaciones = 0;
  pac.perderRespuesta = false;
  pac.totalForzado = null;
  pac.rechazo = null;
  bitacora.length = 0;
  db.columnaAmbiente = true;
  db.catalogo = [];
  db.retenciones = null;
  entornoLive.live = false;
  // Import dinámico: así carga DESPUÉS de los dobles (facturapi-env, prisma).
  (await import("@/lib/invoices/cfdi-ambiente.server"))._olvidarColumnaAmbiente();
  (await import("@/lib/cfdi/fiscal-concepto.server"))._olvidarColumnasFiscales();
  (await import("@/lib/cfdi/retenciones.server"))._olvidarColumnaRetenciones();
});

import { llaveIdempotencia, serieYFolio } from "@/lib/invoices/cfdi-identidad";
import { cfdiBloqueaEnLive } from "@/lib/invoices/cfdi-ambiente";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ═══════════════════════════════════════════════════════════════════════════
// F-05 · receptor
// ═══════════════════════════════════════════════════════════════════════════
test("F-05 · el cliente de Facturapi sale del receptor normalizado (RFC en mayúsculas y sin espacios)", async () => {
  const r = await timbrar({ receptor: { rfc: " goma 800101ab1 ", nombre: " ANA GOMEZ ", regimenFiscal: "612", cp: " 03100 ", email: "ana@correo.test" }, paymentForm: "28" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(pac.clientes[0], { legal_name: "ANA GOMEZ", tax_id: "GOMA800101AB1", tax_system: "612", email: "ana@correo.test", address: { zip: "03100" } });
});

test("F-05 · extranjero (ws1-t8): su ID fiscal y su país, uso S01 siempre y sin la lista EFOS", async () => {
  const receptor = { rfc: "XEXX010101000", nombre: "JOHN DOE", regimenFiscal: "616", cp: "92101", extranjero: { pais: "usa", numRegIdTrib: "123-45-6789" } };
  const r = await timbrar({ receptor, usoCfdi: "D01", paymentForm: "28" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(pac.clientes[0], { legal_name: "JOHN DOE", tax_id: "123-45-6789", address: { zip: "92101", country: "USA" } });
  assert.equal(pac.timbres[0].usoCfdi, "S01", "un extranjero va con S01 aunque el formulario mande D01");
  assert.equal(pac.validaciones, 0, "la lista negra EFOS es de RFC mexicanos");
});

test("F-05 · extranjero sin país (o con MEX) no se timbra", async () => {
  const r = await timbrar({ receptor: { rfc: "XEXX010101000", nombre: "JOHN", regimenFiscal: "616", cp: "92101", extranjero: { pais: "MEX", numRegIdTrib: "1" } }, paymentForm: "28" });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "CFDI_RECEPTOR_EXTRANJERO");
  assert.equal(pac.timbres.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// F-07 · CFDI por pago con IVA
// ═══════════════════════════════════════════════════════════════════════════
const PLAZOS_IVA = { modo: "plazos", metodo: null, enganche: 1160, numPagos: 3, frecuencia: "MONTHLY", primerPago: "2026-10-01", difiereConSuBanco: false };

test("F-07 · pago de $1,160 de una factura con IVA AGREGADO → CFDI de $1,160.00 (antes $1,345.60)", async () => {
  db.condiciones = PLAZOS_IVA;
  setInvoice({ total: 4640, paid: 1160, balance: 3480, status: "PARTIAL", taxRate: 16, taxIncluded: false,
    items: [{ description: "Blanqueamiento", quantity: 1, unitPrice: 4000, total: 4000 }] },
    [{ id: "eng", invoiceId: "inv1", method: "transfer", amount: 1160, paidAt: new Date("2026-10-01T12:00:00Z") }]);
  const r = await timbrarPago("eng", { receptor: PF_612, taxMode: "iva16" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const item = pac.timbres[0].items[0];
  assert.equal(item.product.price, 1160);
  assert.equal(item.product.tax_included, true, "el pago ya trae el IVA dentro");
  assert.equal(db.cfdiPorPago[0].total, 1160);
  assert.equal(r.body.warning, undefined);
});

test("F-07 · si el SAT timbra otro importe que el del pago, avisa y deja constancia (el CFDI ya está emitido)", async () => {
  db.condiciones = PLAZOS_IVA;
  setInvoice({ total: 4640, paid: 1160, balance: 3480, status: "PARTIAL", taxRate: 16, taxIncluded: false,
    items: [{ description: "Blanqueamiento", quantity: 1, unitPrice: 4000, total: 4000 }] },
    [{ id: "eng", invoiceId: "inv1", method: "transfer", amount: 1160, paidAt: new Date("2026-10-01T12:00:00Z") }]);
  pac.totalForzado = 1345.6;
  const r = await timbrarPago("eng", { receptor: PF_612, taxMode: "iva16" });
  assert.equal(r.status, 200);
  assert.equal(r.body.warning?.code, "CFDI_STAMPED_TOTAL_DIFFERS");
  assert.match(r.body.warning.message, /\$1345\.60 y el pago fue de \$1160\.00/);
});

// ═══════════════════════════════════════════════════════════════════════════
// F-12 · idempotency_key
// ═══════════════════════════════════════════════════════════════════════════
test("F-12 · la llave sale del apartado de la factura (el que queda en cfdiUuid mientras se timbra)", async () => {
  let apartadoAlTimbrar: string | null = null;
  const orig = prismaStub.invoice.updateMany;
  prismaStub.invoice.updateMany = async (a: any) => { const r = await orig(a); if (String(a.data?.cfdiUuid ?? "").startsWith("timbrando:")) apartadoAlTimbrar = a.data.cfdiUuid; return r; };
  try {
    const r = await timbrar({ receptor: PF_612, paymentForm: "28" });
    assert.equal(r.status, 200);
  } finally { prismaStub.invoice.updateMany = orig; }
  assert.ok(apartadoAlTimbrar);
  assert.equal(pac.timbres[0].idempotencyKey, llaveIdempotencia(apartadoAlTimbrar!));
  assert.match(pac.timbres[0].idempotencyKey, /^dc[0-9a-f]{48}$/);
});

test("F-12 · se corta la red DESPUÉS de timbrar: «Reintentar sin duplicar» trae ESE CFDI y no timbra otro", async () => {
  pac.perderRespuesta = true;
  const primero = await timbrar({ receptor: PF_612, paymentForm: "28" });
  assert.equal(primero.status, 503);
  assert.equal(primero.body.code, "CFDI_TIMBRE_INCIERTO");
  assert.equal(pac.emitidos, 1, "el CFDI SÍ salió ante el SAT");
  const apartado = db.invoice.cfdiUuid;
  assert.match(String(apartado), /^timbrando:inv1:/, "la factura se queda apartada");

  // Volver a timbrar «normal» sigue bloqueado…
  const normal = await timbrar({ receptor: PF_612, paymentForm: "28" });
  assert.equal(normal.status, 409);
  assert.equal(normal.body.code, "CFDI_EN_CURSO");

  // …y el reintento usa la MISMA llave: Facturapi devuelve el que ya emitió.
  const re = await timbrar({ receptor: PF_612, paymentForm: "28", reintentarIncierto: true });
  assert.equal(re.status, 200, JSON.stringify(re.body));
  assert.equal(re.body.uuid, "UUID-1");
  assert.equal(pac.emitidos, 1, "no se emitió un segundo CFDI");
  assert.equal(pac.timbres[1].idempotencyKey, pac.timbres[0].idempotencyKey);
  assert.equal(db.invoice.cfdiUuid, "UUID-1");
});

test("F-12 · el reintento no aplica si el apartado era la sustitución de un CFDI vigente", async () => {
  db.invoice.cfdiUuid = "timbrando:inv1:abc";
  db.cfdiRecords.push({ invoiceId: "inv1", status: "valid", tipoComprobante: "I", uuid: "UUID-VIEJO" });
  const r = await timbrar({ receptor: PF_612, paymentForm: "28", reintentarIncierto: true });
  assert.equal(r.status, 409);
  assert.equal(pac.timbres.length, 0);
});

test("F-12 · «Facturar este pago» también manda la llave de su apartado", async () => {
  db.condiciones = PLAZOS_IVA;
  setInvoice({ total: 4640, paid: 1160, balance: 3480, status: "PARTIAL", taxRate: 16, taxIncluded: false,
    items: [{ description: "Blanqueamiento", quantity: 1, unitPrice: 4000, total: 4000 }] },
    [{ id: "eng", invoiceId: "inv1", method: "transfer", amount: 1160, paidAt: new Date("2026-10-01T12:00:00Z") }]);
  const r = await timbrarPago("eng", { receptor: PF_612, taxMode: "iva16" });
  assert.equal(r.status, 200);
  assert.equal(pac.timbres[0].idempotencyKey, llaveIdempotencia("timbrando:eng"));
  assert.equal(pac.timbres[0].externalId, "eng");
});

// ═══════════════════════════════════════════════════════════════════════════
// F-19 · serie, folio y external_id
// ═══════════════════════════════════════════════════════════════════════════
test("F-19 · el CFDI lleva la serie y el folio de la factura (F-0002 → F, 2) y external_id = la factura", async () => {
  const r = await timbrar({ receptor: PF_612, paymentForm: "28" });
  assert.equal(r.status, 200);
  assert.equal(pac.timbres[0].series, "F");
  assert.equal(pac.timbres[0].folioNumber, 2);
  assert.equal(pac.timbres[0].externalId, "inv1");
});

test("F-19 · serieYFolio", () => {
  assert.deepEqual(serieYFolio("F-000155"), { series: "F", folioNumber: 155 });
  assert.deepEqual(serieYFolio("MF-0042"), { series: "MF", folioNumber: 42 });
  assert.deepEqual(serieYFolio("0042"), { folioNumber: 42 });
  assert.deepEqual(serieYFolio("SIN-NUMERO"), {});
  assert.deepEqual(serieYFolio(null), {});
});

// ═══════════════════════════════════════════════════════════════════════════
// F-14 · ambiente test / live
// ═══════════════════════════════════════════════════════════════════════════
test("F-14 · cfdiBloqueaEnLive: en Live solo un CFDI de PRUEBAS deja de bloquear (sin marca = vigente)", () => {
  assert.equal(cfdiBloqueaEnLive({ live: true, ambiente: "test" }), false);
  assert.equal(cfdiBloqueaEnLive({ live: true, ambiente: "live" }), true);
  assert.equal(cfdiBloqueaEnLive({ live: true, ambiente: null }), true);
  assert.equal(cfdiBloqueaEnLive({ live: false, ambiente: "live" }), false);
});

test("F-14 · cada timbrado deja escrito su ambiente (live)", async () => {
  entornoLive.live = true;
  const r = await timbrar({ receptor: PF_612, paymentForm: "28" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(db.cfdiRecords.find((x) => x.uuid === "UUID-1")?.environment, "live");
});

test("F-14 · en Live, una factura con un CFDI de PRUEBAS (caso F-000155) se timbra de verdad y el de prueba queda retirado", async () => {
  entornoLive.live = true;
  db.invoice.cfdiUuid = "UUID-TEST";
  db.cfdiRecords.push({ invoiceId: "inv1", uuid: "UUID-TEST", status: "valid", tipoComprobante: "I", environment: "test" });
  const r = await timbrar({ receptor: PF_612, paymentForm: "28" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(db.invoice.cfdiUuid, "UUID-1");
  assert.equal(db.cfdiRecords.find((x) => x.uuid === "UUID-TEST")?.status, "prueba");
});

test("F-14 · sin marca de ambiente (CFDI viejo) sigue contando como vigente: no se timbra encima", async () => {
  entornoLive.live = true;
  db.invoice.cfdiUuid = "UUID-VIEJO";
  db.cfdiRecords.push({ invoiceId: "inv1", uuid: "UUID-VIEJO", status: "valid", tipoComprobante: "I", environment: null });
  const r = await timbrar({ receptor: PF_612, paymentForm: "28" });
  assert.equal(r.status, 400);
  assert.equal(pac.timbres.length, 0);
});

test("F-14 · sin el SQL pegado nada cambia: el de prueba sigue bloqueando como hoy", async () => {
  entornoLive.live = true;
  db.columnaAmbiente = false;
  db.invoice.cfdiUuid = "UUID-TEST";
  db.cfdiRecords.push({ invoiceId: "inv1", uuid: "UUID-TEST", status: "valid", tipoComprobante: "I", environment: "test" });
  const r = await timbrar({ receptor: PF_612, paymentForm: "28" });
  assert.equal(r.status, 400);
});

test("F-14 · la guarda de cancelar/anular/reembolsar/cambiar precio: en Live un CFDI de PRUEBAS no bloquea", async () => {
  entornoLive.live = true;
  db.cfdiRecords.push({ uuid: "U-T", environment: "test" }, { uuid: "U-L", environment: "live" }, { uuid: "U-N", environment: null });
  const { denyIfCfdiVigenteEnAmbiente } = await import("@/lib/invoices/cfdi-ambiente.server");
  const g = (uuid: string) => denyIfCfdiVigenteEnAmbiente(prismaStub, { clinicId: "c1", cfdiUuid: uuid, accion: "cancelar" });
  assert.equal(await g("U-T"), null);
  assert.equal((await g("U-L"))?.status, 409);
  assert.equal((await g("U-N"))?.status, 409);
  assert.equal((await g("timbrando:inv1:x"))?.status, 409, "un timbrado en curso bloquea siempre");
  entornoLive.live = false;
  assert.equal(await g("U-L"), null, "en pruebas nada bloquea, como siempre");
});

test("F-14 · las 4 rutas (anular, cancelar, reembolsar, cambiar precio) usan la guarda con ambiente", () => {
  const raiz = join(__dirname, "..", "..", "invoices", "[id]");
  for (const f of ["route.ts", "cancel/route.ts", "refund/route.ts", "edit-price/route.ts"]) {
    const src = readFileSync(join(raiz, f), "utf8");
    assert.match(src, /denyIfCfdiVigenteEnAmbiente\(/, f);
    assert.doesNotMatch(src, /[^A-Za-z]denyIfCfdiVigente\(/, f);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// F-11 · clave SAT por procedimiento   ·   F-08 · IVA por concepto
// ═══════════════════════════════════════════════════════════════════════════
const CATALOGO_F2 = [
  { id: "p-orto", name: "Control de ortodoncia", category: "orthodontics", claveSat: null, ivaCfdi: null },
  { id: "p-resina", name: "Restauración con resina", category: "Operatoria", claveSat: null, ivaCfdi: null },
];

test("F-11 · el CFDI F2 de $1,600 sale con 85122005 (control de ortodoncia) y 85122001 (resina), no con 85121502", async () => {
  db.catalogo = CATALOGO_F2;
  setInvoice({ items: [
    { description: "Control de ortodoncia", quantity: 1, unitPrice: 800, total: 800 },
    { description: "Restauración con resina", quantity: 1, unitPrice: 800, total: 800 },
  ] });
  const r = await timbrar({ receptor: PF_612, paymentForm: "04" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const items = pac.timbres[0].items;
  assert.deepEqual(items.map((i: any) => i.product.product_key), ["85122005", "85122001"]);
  assert.deepEqual(items.map((i: any) => i.product.unit_key), ["E48", "E48"]);
  assert.equal(db.cfdiRecords[0].total, 1600);
});

test("F-11 · sin catálogo que coincida, ninguna sale como «consulta de médico» (85121502)", async () => {
  const r = await timbrar({ receptor: PF_612, paymentForm: "28" });
  assert.equal(r.status, 200);
  assert.equal(pac.timbres[0].items[0].product.product_key, "85122005", "«Control de ortodoncia» por su nombre");
  setInvoice({ items: [{ description: "Corona de zirconia", quantity: 1, unitPrice: 1600, total: 1600 }] });
  await timbrar({ receptor: PF_612, paymentForm: "28" });
  assert.equal(pac.timbres[1].items[0].product.product_key, "85122001");
});

test("F-11 · «Facturar este pago» de ortodoncia sale con 85122005", async () => {
  db.condiciones = PLAZOS_IVA;
  setInvoice({ total: 26000, paid: 2000, balance: 24000, status: "PARTIAL",
    items: [{ description: "Tratamiento de ortodoncia (brackets metálicos)", quantity: 1, unitPrice: 26000, total: 26000 }] },
    [{ id: "eng", invoiceId: "inv1", method: "transfer", amount: 2000, paidAt: new Date("2026-10-01T12:00:00Z") }]);
  const r = await timbrarPago("eng", { receptor: PF_612 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(pac.timbres[0].items[0].product.product_key, "85122005");
});

const CATALOGO_MIXTO = [
  { id: "p-limp", name: "Limpieza dental", category: "Prevención", claveSat: null, ivaCfdi: "exento" },
  { id: "p-cep", name: "Cepillo eléctrico", category: "general", claveSat: null, ivaCfdi: "iva16" },
];

test("F-08 · limpieza exenta de $800 + cepillo de $1,160 con IVA incluido → cada uno con su IVA, total $1,960.00", async () => {
  db.catalogo = CATALOGO_MIXTO;
  setInvoice({ total: 1960, paid: 1960, subtotal: 1960, taxRate: 0, taxIncluded: true, items: [
    { description: "Limpieza dental", quantity: 1, unitPrice: 800, total: 800 },
    { description: "Cepillo eléctrico", quantity: 1, unitPrice: 1160, total: 1160 },
  ] });
  const r = await timbrar({ receptor: PF_612, paymentForm: "28", taxMode: "exento" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const [limpieza, cepillo] = pac.timbres[0].items;
  assert.deepEqual(limpieza.product.taxes, [{ type: "IVA", factor: "Exento", rate: 0 }]);
  assert.equal(limpieza.product.tax_included, false);
  assert.deepEqual(cepillo.product.taxes, [{ type: "IVA", rate: 0.16 }]);
  assert.equal(cepillo.product.tax_included, true, "el precio de $1,160 ya trae los $160 de IVA");
  assert.equal(db.cfdiRecords[0].total, 1960);
});

test("F-08 · la misma mezcla con «IVA agregado» no se timbra (descuadraría): dice qué hacer", async () => {
  db.catalogo = CATALOGO_MIXTO;
  setInvoice({ total: 2088, paid: 2088, subtotal: 1800, taxRate: 16, taxIncluded: false, items: [
    { description: "Limpieza dental", quantity: 1, unitPrice: 800, total: 800 },
    { description: "Cepillo eléctrico", quantity: 1, unitPrice: 1000, total: 1000 },
  ] });
  const r = await timbrar({ receptor: PF_612, paymentForm: "28", taxMode: "iva16" });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "CFDI_IVA_MIXTO_AGREGADO");
  assert.equal(pac.timbres.length, 0);
});

test("F-08 · «Facturar este pago» de una factura con IVA mezclado no se timbra (no sabe repartirlo)", async () => {
  db.catalogo = CATALOGO_MIXTO;
  db.condiciones = PLAZOS_IVA;
  setInvoice({ total: 1960, paid: 500, balance: 1460, status: "PARTIAL", taxIncluded: true, items: [
    { description: "Limpieza dental", quantity: 1, unitPrice: 800, total: 800 },
    { description: "Cepillo eléctrico", quantity: 1, unitPrice: 1160, total: 1160 },
  ] }, [{ id: "eng", invoiceId: "inv1", method: "cash", amount: 500, paidAt: new Date("2026-10-01T12:00:00Z") }]);
  const r = await timbrarPago("eng", { receptor: PF_612 });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "CFDI_IVA_MIXTO_POR_PAGO");
});

// ═══════════════════════════════════════════════════════════════════════════
// F-01 · retenciones (ajuste por clínica, APAGADO por defecto)
// ═══════════════════════════════════════════════════════════════════════════
const TRATAMIENTO_10K = { total: 10000, paid: 10000, subtotal: 10000, items: [{ description: "Rehabilitación con coronas", quantity: 1, unitPrice: 10000, total: 10000 }] };

test("F-01 · sin el SQL (o apagado), RESICO → empresa sigue bloqueado como en la Tanda 0", async () => {
  setInvoice(TRATAMIENTO_10K);
  let r = await timbrar({ receptor: EMPRESA, paymentForm: "03" });
  assert.equal(r.body.code, "CFDI_RETENCION_PENDIENTE");
  db.retenciones = false;
  (await import("@/lib/cfdi/retenciones.server"))._olvidarColumnaRetenciones();
  r = await timbrar({ receptor: EMPRESA, paymentForm: "03" });
  assert.equal(r.body.code, "CFDI_RETENCION_PENDIENTE");
  assert.equal(pac.timbres.length, 0);
});

test("F-01 · ENCENDIDO: RESICO → empresa, exento $10,000, la empresa pagó $9,875 → CFDI con ISR retenido $125 (neto $9,875.00)", async () => {
  db.retenciones = true;
  setInvoice({ ...TRATAMIENTO_10K, paid: 9875, balance: 125, status: "PARTIAL" });
  const r = await timbrar({ receptor: EMPRESA, paymentForm: "03" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const it = pac.timbres[0].items[0];
  assert.equal(it.product.price, 10000);
  assert.equal(it.product.tax_included, false);
  assert.deepEqual(it.product.taxes, [{ type: "IVA", factor: "Exento", rate: 0 }, { type: "ISR", rate: 0.0125, withholding: true }]);
  assert.equal(db.cfdiRecords[0].total, 9875);
  assert.equal(r.body.retencion.neto, 9875);
  assert.equal(r.body.retencion.isrRetenido, 125);
  assert.equal(r.body.warning, undefined, "lo timbrado cuadra con el neto");
});

test("F-01 · ENCENDIDO: si la empresa todavía no paga el neto ($9,000 de $9,875), no se timbra PUE", async () => {
  db.retenciones = true;
  setInvoice({ ...TRATAMIENTO_10K, paid: 9000, balance: 1000, status: "PARTIAL" });
  const r = await timbrar({ receptor: EMPRESA, paymentForm: "03" });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "CFDI_CON_SALDO");
  assert.match(r.body.error, /\$875\.00/);
});

test("F-01 · ENCENDIDO: 612 → empresa con servicio GRAVADO (IVA agregado) → IVA $1,600, ISR $1,000, IVA retenido $1,066.67, neto $9,533.33", async () => {
  db.retenciones = true;
  setClinic({ regimenFiscal: "612" });
  setInvoice({ total: 11600, paid: 9533.33, balance: 2066.67, status: "PARTIAL", subtotal: 10000, taxRate: 16, taxIncluded: false,
    items: [{ description: "Blanqueamiento estético", quantity: 1, unitPrice: 10000, total: 10000 }] });
  const r = await timbrar({ receptor: EMPRESA, paymentForm: "03", taxMode: "iva16" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(pac.timbres[0].items[0].product.taxes, [{ type: "IVA", rate: 0.16 }, { type: "ISR", rate: 0.10, withholding: true }, { type: "IVA", rate: 0.106667, withholding: true }]);
  assert.equal(db.cfdiRecords[0].total, 9533.33);
});

test("F-01 · ENCENDIDO: a una persona física no se le retiene nada", async () => {
  db.retenciones = true;
  setInvoice(TRATAMIENTO_10K);
  const r = await timbrar({ receptor: PF_612, paymentForm: "03" });
  assert.equal(r.status, 200);
  assert.equal(pac.timbres[0].items[0].product.taxes.some((t: any) => t.withholding), false);
  assert.equal(r.body.retencion, undefined);
});

test("F-01 · ENCENDIDO: el CFDI de un pago suelto con retención todavía no existe (lo dice)", async () => {
  db.retenciones = true;
  db.condiciones = PLAZOS_IVA;
  setInvoice({ total: 26000, paid: 2000, balance: 24000, status: "PARTIAL" },
    [{ id: "eng", invoiceId: "inv1", method: "transfer", amount: 2000, paidAt: new Date("2026-10-01T12:00:00Z") }]);
  const r = await timbrarPago("eng", { receptor: EMPRESA });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "CFDI_RETENCION_POR_PAGO");
});

// ═══════════════════════════════════════════════════════════════════════════
// F-18 · bitácora fiscal   ·   F-21 · mes de cobro   ·   F-24 · rechazos del PAC
// ═══════════════════════════════════════════════════════════════════════════
test("F-18 · la bitácora dice con qué se timbró (uso, forma, régimen, tipo de persona, facturapiId, serie/folio) y NO guarda el RFC", async () => {
  const r = await timbrar({ receptor: PF_612, paymentForm: "28" });
  assert.equal(r.status, 200);
  const e = bitacora.find((x) => x.texto === "Timbró el CFDI de una factura");
  assert.ok(e, "hay registro en Movimientos");
  assert.equal(e.after.facturapiId, "fapi_1");
  assert.equal(e.after.series, "F");
  assert.equal(e.after.folioNumber, 2);
  assert.deepEqual(e.after.receptor, { regimen: "612", tipoPersona: "fisica", extranjero: false });
  assert.equal(e.after.cfdi.usoCfdi, "D01");
  assert.equal(e.after.cfdi.paymentForm, "28");
  assert.deepEqual(e.after.cfdi.conceptos, [{ claveSat: "85122005", iva: "exento" }]);
  assert.ok(!JSON.stringify(e).includes(PF_612.rfc), "el RFC del paciente no va a la bitácora");
  assert.equal(db.cfdiRecords[0].receptor.usoCfdi, "D01", "el uso queda guardado con el CFDI");
});

test("F-21 · cobrado en agosto y timbrado hoy: el CFDI sale, con el aviso del mes y en la bitácora", async () => {
  setInvoice({}, [{ id: "pay1", invoiceId: "inv1", method: "debit", amount: 1600, paidAt: new Date("2026-08-15T18:00:00Z") }]);
  // C-49: sin confirmar que no entró en la global de agosto, no se timbra.
  const sin = await timbrar({ receptor: PF_612, paymentForm: "28" });
  assert.equal(sin.status, 409);
  assert.equal(sin.body.code, "CFDI_CONFIRMAR_GLOBAL");
  assert.match(sin.body.error, /NO entró en la factura global de agosto 2026/);
  assert.equal(db.invoice.cfdiUuid, null, "ni se apartó");
  const r = await timbrar({ receptor: PF_612, paymentForm: "28", confirmaFueraDeGlobal: true });
  assert.equal(r.status, 200);
  assert.match(r.body.avisoMes, /Esto se cobró en agosto 2026, pero el CFDI sale con fecha de/);
  const e = bitacora.find((x) => x.texto === "Timbró el CFDI de una factura");
  assert.deepEqual(e.after.mesDeCobro, ["2026-08"]);
});

test("F-24 · el PAC rechaza por el código postal: el mensaje original + qué revisar, y la factura queda libre", async () => {
  pac.rechazo = "CFDI40147 - El campo DomicilioFiscalReceptor del receptor, debe pertenecer al nombre asociado al RFC registrado en el campo Rfc del Receptor.";
  const r = await timbrar({ receptor: PF_612, paymentForm: "28" });
  assert.equal(r.status, 500);
  assert.match(r.body.error, /^CFDI40147 - El campo DomicilioFiscalReceptor/);
  assert.match(r.body.error, /Revisa el código postal del paciente contra su constancia de situación fiscal\.$/);
  assert.equal(db.invoice.cfdiUuid, null);
});

test("F-24 · el PDF interno no imprime «UUID: timbrando:…» de un apartado en curso", () => {
  const src = readFileSync(join(__dirname, "..", "..", "..", "..", "lib", "invoices", "print-pdf.tsx"), "utf8");
  assert.match(src, /cfdiUuid && !p\.invoice\.cfdiUuid\.startsWith\("timbrando:"\)/);
});
