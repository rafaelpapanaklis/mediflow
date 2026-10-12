/**
 * Tanda 0 de facturación (ws1-t4, 3-oct-2026): proteger a una clínica que ya
 * timbra en Live. Se ejercitan los HANDLERS REALES de
 *   · POST /api/cfdi                (factura completa)
 *   · POST /api/payments/[id]/cfdi  («Facturar este pago»)
 * con Facturapi y la base simulados: aquí no se timbra NADA de verdad.
 *
 * Run: npm run test:cfdi-tanda0
 *
 * Cada caso falla con el código de antes:
 *   · retencion-candado  — antes timbraba a una empresa desde un RESICO sin retención.
 *   · pue-saldo          — antes `confirmUnpaidPue: true` timbraba PUE con saldo.
 *   · forma-pago-mayor   — antes mandaba la forma del ÚLTIMO pago y Mercado Pago como «03».
 *   · uso-por-regimen    — antes mandaba D01 a todos (no vale para 626 ni personas morales).
 *   · límite             — antes la 6.ª factura en una hora daba 429 (5 por IP).
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { CLAVES_SAT_MEDICOS, UNIDAD_SAT, FORMAS_PAGO_SAT } from "@/lib/cfdi-catalogs";

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
};
const pac = { timbres: [] as any[], clientes: [] as any[] };
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

const prismaStub: any = {
  $transaction: async (arg: any) => (typeof arg === "function" ? arg(prismaStub) : Promise.all(arg)),
  clinic: { findUnique: async () => ({ ...db.clinic }) },
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
    findMany: async ({ where }: any) => db.credits.filter((c) => c.clinicId === where.clinicId
      && (where.patientId?.in ? where.patientId.in.includes(c.patientId) : c.patientId === where.patientId)
      && (where.amount?.gt === undefined || c.amount > where.amount.gt)),
  },
  cfdiRecord: { create: async ({ data }: any) => ({ id: "cfdi1", ...data }) },
  cfdiUsage: { upsert: async () => ({ stamped: 1 }) },
};

(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
(mock as any).module("@/lib/facturapi", {
  namedExports: {
    getOrgApiKey: async () => "sk_test",
    validateRfc: async () => ({ ok: true }),
    createOrUpdateCustomer: async (_k: string, c: any) => { pac.clientes.push(c); return "cus_1"; },
    createInvoice: async (args: any) => {
      pac.timbres.push(args);
      const n = pac.timbres.length;
      const total = args.items.reduce((a: number, it: any) => a + it.product.price * it.quantity - (it.discount ?? 0), 0);
      return { id: `fapi_${n}`, uuid: `UUID-${n}`, total };
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
(mock as any).module("@/lib/audit", { namedExports: { logMutation: async () => {} } });
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
  return quieto(async () => leer(await POST(req({ taxMode: "exento", ...body }), { params: Promise.resolve({ id: paymentId }) })));
}

beforeEach(() => {
  authCtx.clinicId = "c1";
  setClinic();
  setInvoice();
  db.credits = [];
  db.otrosPagos = [];
  db.condiciones = null;
  db.cfdiPorPago = [];
  pac.timbres = [];
});

// ═══════════════════════════════════════════════════════════════════════════
// retencion-candado (F-01a)
// ═══════════════════════════════════════════════════════════════════════════
test("retencion-candado · RESICO 626 → empresa (RFC de 12): NO timbra y dice qué hacer", async () => {
  const r = await timbrar({ receptor: EMPRESA, usoCfdi: "G03", paymentForm: "28" });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "CFDI_RETENCION_PENDIENTE");
  assert.match(r.body.error, /Todavía no se pueden emitir desde DaleControl facturas a empresas/);
  assert.match(r.body.error, /emítela por fuera mientras lo habilitamos/);
  assert.equal(pac.timbres.length, 0, "ni se le pidió el timbre a Facturapi");
  assert.equal(db.invoice.cfdiUuid, null, "ni se apartó la factura");
});

test("retencion-candado · 612 → empresa: tampoco; 626 → persona física (RFC 13) y → público en general: sí", async () => {
  setClinic({ regimenFiscal: "612" });
  assert.equal((await timbrar({ receptor: EMPRESA, paymentForm: "28" })).body.code, "CFDI_RETENCION_PENDIENTE");

  setClinic({ regimenFiscal: "626" });
  const pf = await timbrar({ receptor: PF_612, paymentForm: "28" });
  assert.equal(pf.status, 200, JSON.stringify(pf.body));

  setInvoice();
  const pg = await timbrar({ receptor: PUBLICO, paymentForm: "28" });
  assert.equal(pg.status, 200, JSON.stringify(pg.body));
  assert.equal(pac.timbres.length, 2);
});

test("retencion-candado · una persona moral (601) que le factura a otra empresa no lleva retención: timbra", async () => {
  setClinic({ regimenFiscal: "601", rfcEmisor: "CDE010101AB1" });
  const r = await timbrar({ receptor: EMPRESA, paymentForm: "28" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test("C-41 · RESICO persona MORAL (626 + RFC de 12) → empresa: timbra, sin candado ni retención", async () => {
  setClinic({ regimenFiscal: "626", rfcEmisor: "CDS1201011A3" });
  const r = await timbrar({ receptor: EMPRESA, usoCfdi: "G03", paymentForm: "28" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.retencion, undefined, "sin retención de ISR (el 113-J es solo para personas físicas)");
  const impuestos = pac.timbres[0].items.flatMap((it: any) => it.product.taxes);
  assert.ok(impuestos.every((t: any) => !t.withholding), JSON.stringify(impuestos));
});

test("C-41 · 626 sin RFC guardado → empresa: candado (no se sabe si es persona física)", async () => {
  setClinic({ regimenFiscal: "626", rfcEmisor: null });
  const r = await timbrar({ receptor: EMPRESA, usoCfdi: "G03", paymentForm: "28" });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "CFDI_RETENCION_PENDIENTE");
  assert.match(r.body.error, /guarda tu RFC/);
});

test("C-47 · público en general: el CFDI va a «PUBLICO EN GENERAL», 616, S01 y el CP del emisor, diga lo que diga el formulario", async () => {
  setClinic({ cpEmisor: "06600" });
  const r = await timbrar({ receptor: { ...PUBLICO, nombre: "juan perez", regimenFiscal: "612", cp: "97000" }, usoCfdi: "G03", paymentForm: "28" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(pac.timbres[0].usoCfdi, "S01");
  assert.equal(pac.clientes.at(-1).legal_name, "PUBLICO EN GENERAL");
  assert.equal(pac.clientes.at(-1).tax_system, "616");
  assert.deepEqual(pac.clientes.at(-1).address, { zip: "06600" });
});

test("C-47 · empresa con 612 → 400 sin hablar con Facturapi", async () => {
  setClinic({ regimenFiscal: "601", rfcEmisor: "CDE010101AB1" }); // sin candado de retención de por medio
  const r = await timbrar({ receptor: { ...EMPRESA, regimenFiscal: "612" }, usoCfdi: "G03", paymentForm: "28" });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "CFDI_RECEPTOR_INVALIDO");
  assert.equal(pac.timbres.length, 0);
});

test("retencion-candado · también en «Facturar este pago»", async () => {
  db.condiciones = PLAZOS;
  setInvoice({ total: 8000, paid: 2000, balance: 6000, status: "PARTIAL" },
    [{ id: "eng", invoiceId: "inv1", method: "transfer", amount: 2000, paidAt: new Date("2026-10-01T12:00:00Z") }]);
  const r = await timbrarPago("eng", { receptor: { ...EMPRESA, rfc: " abc010101ab1 " }, paymentForm: "03" });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "CFDI_RETENCION_PENDIENTE");
  assert.equal(pac.timbres.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// pue-saldo (F-04)
// ═══════════════════════════════════════════════════════════════════════════
test("pue-saldo · factura de $8,000 con $2,000 pagados: aunque mande confirmUnpaidPue, NO timbra PUE", async () => {
  setInvoice({ total: 8000, paid: 2000, balance: 6000, status: "PARTIAL", items: [{ description: "Resina", quantity: 1, unitPrice: 8000, total: 8000 }] },
    [{ id: "p1", invoiceId: "inv1", method: "cash", amount: 2000, paidAt: new Date("2026-10-01T12:00:00Z") }]);
  const r = await timbrar({ receptor: PF_612, paymentForm: "01", confirmUnpaidPue: true });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "CFDI_CON_SALDO");
  assert.match(r.body.error, /\$6,000\.00/);
  assert.equal(pac.timbres.length, 0);
  assert.equal(db.invoice.cfdiUuid, null);
});

test("pue-saldo · a plazos (ortodoncia, enganche + 12): el aviso manda a «Facturar este pago»", async () => {
  db.condiciones = PLAZOS;
  setInvoice({ total: 26000, paid: 4000, balance: 22000, status: "PARTIAL", items: [{ description: "Tratamiento de ortodoncia", quantity: 1, unitPrice: 26000, total: 26000 }] },
    [{ id: "eng", invoiceId: "inv1", method: "transfer", amount: 2000, paidAt: new Date("2026-10-01T12:00:00Z") },
     { id: "m1", invoiceId: "inv1", method: "cash", amount: 2000, paidAt: new Date("2026-11-01T12:00:00Z") }]);
  const r = await timbrar({ receptor: PF_612, paymentForm: "03", confirmUnpaidPue: true });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "CFDI_CON_SALDO_A_PLAZOS");
  assert.match(r.body.error, /Esta factura tiene saldo \(\$22,000\.00\): factura cada pago cobrado con «Facturar este pago»/);
  assert.equal(pac.timbres.length, 0);
});

test("pue-saldo · y «Facturar este pago» SÍ timbra la mensualidad ya cobrada ($2,000), aunque la factura tenga saldo", async () => {
  db.condiciones = PLAZOS;
  setInvoice({ total: 26000, paid: 4000, balance: 22000, status: "PARTIAL", items: [{ description: "Tratamiento de ortodoncia", quantity: 1, unitPrice: 26000, total: 26000 }] },
    [{ id: "eng", invoiceId: "inv1", method: "transfer", amount: 2000, paidAt: new Date("2026-10-01T12:00:00Z") },
     { id: "m1", invoiceId: "inv1", method: "cash", amount: 2000, paidAt: new Date("2026-11-01T12:00:00Z") }]);
  const r = await timbrarPago("m1", { receptor: PF_612 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(pac.timbres.length, 1);
  const t = pac.timbres[0];
  assert.equal(t.items[0].product.price, 2000);
  assert.equal(t.paymentForm, "01", "la mensualidad se pagó en efectivo");
  assert.equal(t.usoCfdi, "D01", "persona física 612");
});

test("pue-saldo · un centavo de redondeo no cuenta como saldo: timbra", async () => {
  setInvoice({ total: 1600, paid: 1599.99, balance: 0.01 });
  const r = await timbrar({ receptor: PF_612, paymentForm: "28" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

// ═══════════════════════════════════════════════════════════════════════════
// forma-pago-mayor (F-06)
// ═══════════════════════════════════════════════════════════════════════════
test("forma-pago-mayor · $4,000 con tarjeta de crédito y $1,000 en efectivo al final → «04», no «01»", async () => {
  setInvoice({ total: 5000, paid: 5000, items: [{ description: "Corona", quantity: 1, unitPrice: 5000, total: 5000 }] }, [
    { id: "a", invoiceId: "inv1", method: "credit", amount: 4000, paidAt: new Date("2026-10-01T12:00:00Z") },
    { id: "b", invoiceId: "inv1", method: "cash", amount: 1000, paidAt: new Date("2026-10-02T12:00:00Z") },
  ]);
  const r = await timbrar({ receptor: PF_612 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(pac.timbres[0].paymentForm, "04");
});

test("forma-pago-mayor · cobrado solo por Mercado Pago y sin forma escogida → no se inventa «03»: hay que escogerla", async () => {
  setInvoice({}, [{ id: "mp", invoiceId: "inv1", method: "mercadopago", amount: 1600, paidAt: new Date("2026-10-03T12:00:00Z") }]);
  const r = await timbrar({ receptor: PF_612 });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "CFDI_FORMA_PAGO_REQUERIDA");
  assert.equal(pac.timbres.length, 0);

  // Escogida a mano (lo que hizo recepción el 3-oct): pasa tal cual.
  const ok = await timbrar({ receptor: PF_612, paymentForm: "04" });
  assert.equal(ok.status, 200);
  assert.equal(pac.timbres[0].paymentForm, "04");
});

test("forma-pago-mayor · un «anticipo» hereda la forma del dinero que formó el saldo a favor (efectivo → «01»)", async () => {
  setInvoice({ total: 500, paid: 500, items: [{ description: "Limpieza", quantity: 1, unitPrice: 500, total: 500 }] },
    [{ id: "ant", invoiceId: "inv1", method: "anticipo", amount: 500, paidAt: new Date("2026-10-03T12:00:00Z") }]);
  db.credits = [{ clinicId: "c1", patientId: "p1", amount: 500, source: "excedente_de_cobro", paymentId: "exc1", invoiceId: "inv0" }];
  db.otrosPagos = [{ id: "exc1", invoiceId: "inv0", method: "cash", amount: 500 }];
  const r = await timbrar({ receptor: PF_612 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(pac.timbres[0].paymentForm, "01");
});

test("forma-pago-mayor · «Facturar este pago» de Mercado Pago sin forma → hay que escogerla (antes salía «03»)", async () => {
  db.condiciones = PLAZOS;
  setInvoice({ total: 26000, paid: 2000, balance: 24000, status: "PARTIAL" },
    [{ id: "mp", invoiceId: "inv1", method: "mercadopago", amount: 2000, paidAt: new Date("2026-10-01T12:00:00Z") }]);
  const r = await timbrarPago("mp", { receptor: PF_612 });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "CFDI_FORMA_PAGO_REQUERIDA");
  assert.equal(pac.timbres.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// uso-por-regimen (F-10)
// ═══════════════════════════════════════════════════════════════════════════
test("uso-por-regimen · sin uso en el cuerpo: 612 → D01, 626 → G03, 616 → S01, empresa → G03", async () => {
  await timbrar({ receptor: PF_612, paymentForm: "28" });
  setInvoice();
  await timbrar({ receptor: { ...PF_612, regimenFiscal: "626" }, paymentForm: "28" });
  setInvoice();
  await timbrar({ receptor: PUBLICO, paymentForm: "28" });
  setClinic({ regimenFiscal: "601", rfcEmisor: "CDE010101AB1" });
  setInvoice();
  await timbrar({ receptor: EMPRESA, paymentForm: "28" });
  assert.deepEqual(pac.timbres.map((t) => t.usoCfdi), ["D01", "G03", "S01", "G03"]);
});

test("uso-por-regimen · CP01 (solo de complementos de pago) ya no se acepta en un CFDI de ingreso", async () => {
  const r = await timbrar({ receptor: PF_612, paymentForm: "28", usoCfdi: "CP01" });
  assert.equal(r.status, 400);
  assert.equal(pac.timbres.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// Límite por clínica (F-13)
// ═══════════════════════════════════════════════════════════════════════════
test("límite · la recepción timbra 6 facturas seguidas desde la misma IP y las 6 salen (antes la 6.ª daba 429)", async () => {
  authCtx.clinicId = "c-limite-6";
  for (let i = 0; i < 6; i++) {
    setInvoice({ clinicId: "c-limite-6" });
    const r = await timbrar({ receptor: PF_612, paymentForm: "28" });
    assert.equal(r.status, 200, `la ${i + 1}.ª: ${JSON.stringify(r.body)}`);
  }
  assert.equal(pac.timbres.length, 6);
});

test("límite · es POR CLÍNICA: a la 61.ª en una hora se frena, y otra clínica sigue timbrando", async () => {
  authCtx.clinicId = "c-limite-61";
  for (let i = 0; i < 60; i++) {
    setInvoice({ clinicId: "c-limite-61" });
    assert.equal((await timbrar({ receptor: PF_612, paymentForm: "28" })).status, 200);
  }
  setInvoice({ clinicId: "c-limite-61" });
  const r = await timbrar({ receptor: PF_612, paymentForm: "28" });
  assert.equal(r.status, 429);
  assert.match(r.body.error, /Tu clínica llegó a 60 timbrados en una hora/);

  authCtx.clinicId = "c-otra";
  setInvoice({ clinicId: "c-otra" });
  assert.equal((await timbrar({ receptor: PF_612, paymentForm: "28" })).status, 200);
});

// ═══════════════════════════════════════════════════════════════════════════
// Auditoría de uso (ws1-t4, 4-oct-2026): «Facturar este pago» en cualquier nota (C-48), la
// global del mes anterior (C-49) y el 403 en palabras de la clínica (C-46/C-57)
// ═══════════════════════════════════════════════════════════════════════════
test("C-48 · MF-1114: abono de $150 a una nota de $400 SIN plan a plazos → su CFDI por $150 («— abono»)", async () => {
  db.condiciones = null;
  setInvoice({ total: 400, paid: 150, balance: 250, status: "PARTIAL", items: [{ description: "Resina", quantity: 1, unitPrice: 400, total: 400 }] },
    [{ id: "abono", invoiceId: "inv1", method: "cash", amount: 150, paidAt: new Date() }]);
  const r = await timbrarPago("abono", { receptor: PF_612, paymentForm: "01" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(pac.timbres.length, 1);
  assert.equal(pac.timbres[0].items[0].product.description, "Resina — abono");
  assert.equal(pac.timbres[0].items[0].product.price, 150);
});

test("C-49 · un cobro de un mes anterior: sin confirmar que no entró en la global, no se timbra (ni la nota ni el pago)", async () => {
  const septiembre = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 10, 18));
  setInvoice({}, [{ id: "pay1", invoiceId: "inv1", method: "debit", amount: 1600, paidAt: septiembre }]);
  const sin = await timbrar({ receptor: PF_612, paymentForm: "28" });
  assert.equal(sin.status, 409);
  assert.equal(sin.body.code, "CFDI_CONFIRMAR_GLOBAL");
  assert.equal(pac.timbres.length, 0);
  const con = await timbrar({ receptor: PF_612, paymentForm: "28", confirmaFueraDeGlobal: true });
  assert.equal(con.status, 200, JSON.stringify(con.body));

  db.condiciones = null;
  setInvoice({ total: 400, paid: 150, balance: 250, status: "PARTIAL" }, [{ id: "ab", invoiceId: "inv1", method: "cash", amount: 150, paidAt: septiembre }]);
  const pago = await timbrarPago("ab", { receptor: PF_612, paymentForm: "01" });
  assert.equal(pago.body.code, "CFDI_CONFIRMAR_GLOBAL");
});

test("C-46/C-57 · quien no es dueño ni admin recibe qué hacer, no «Solo administradores»", async () => {
  authCtx.isAdmin = false;
  try {
    const r = await timbrar({ receptor: PF_612, paymentForm: "28" });
    assert.equal(r.status, 403);
    assert.equal(r.body.code, "CFDI_SOLO_DUENO");
    assert.match(r.body.error, /solo el dueño o un administrador/);
    const p = await timbrarPago("pay1", { receptor: PF_612, paymentForm: "28" });
    assert.equal(p.status, 403);
    assert.doesNotMatch(p.body.error, /Solo administradores/);
  } finally {
    authCtx.isAdmin = true;
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Segunda auditoría de uso (ws1-t4, 4-oct-2026): N-21 y N-22
// ═══════════════════════════════════════════════════════════════════════════
test("N-21 · MF-1128: cobro $3,000 con reembolso de $1,000 → «Facturar este pago» timbra $2,000, no $3,000", async () => {
  db.condiciones = null;
  setInvoice({ total: 3000, paid: 2000, balance: 1000, status: "PARTIAL", items: [{ description: "Endodoncia", quantity: 1, unitPrice: 3000, total: 3000 }] }, [
    { id: "cobro", invoiceId: "inv1", method: "cash", amount: 3000, paidAt: new Date() },
    { id: "dev", invoiceId: "inv1", method: "refund", refundMethod: "cash", amount: 1000, paidAt: new Date() },
  ]);
  const r = await timbrarPago("cobro", { receptor: PF_612, paymentForm: "01" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(pac.timbres[0].items[0].product.price, 2000);
});

test("N-21 · MF-1140: total $800 tras el reembolso, cobro $1,000 → $800 (antes 409 hablando de «el caso»); todo devuelto → 409 claro", async () => {
  db.condiciones = null;
  setInvoice({ total: 800, paid: 800, balance: 0, status: "PAID", items: [{ description: "Resina", quantity: 1, unitPrice: 1000, total: 1000 }], discount: 200 }, [
    { id: "cobro", invoiceId: "inv1", method: "cash", amount: 1000, paidAt: new Date() },
    { id: "dev", invoiceId: "inv1", method: "refund", refundMethod: "cash", amount: 200, paidAt: new Date() },
  ]);
  const r = await timbrarPago("cobro", { receptor: PF_612, paymentForm: "01" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(pac.timbres[0].items[0].product.price, 800);

  pac.timbres = [];
  setInvoice({ total: 500, paid: 0, balance: 500, status: "PENDING" }, [
    { id: "cobro", invoiceId: "inv1", method: "cash", amount: 500, paidAt: new Date() },
    { id: "dev", invoiceId: "inv1", method: "refund", refundMethod: "cash", amount: 500, paidAt: new Date() },
  ]);
  const nada = await timbrarPago("cobro", { receptor: PF_612, paymentForm: "01" });
  assert.equal(nada.status, 409);
  assert.match(nada.body.error, /se devolvió/);
  assert.doesNotMatch(nada.body.error, /caso/);
  assert.equal(pac.timbres.length, 0);
});

test("N-22 · nota pagada con saldo a favor que ENTRÓ en septiembre: pide confirmar la global de septiembre antes de timbrarla", async () => {
  const sep = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 10, 18));
  setInvoice({ total: 4000, paid: 4000, balance: 0, items: [{ description: "Corona", quantity: 1, unitPrice: 4000, total: 4000 }] }, [
    { id: "ant", invoiceId: "inv1", method: "anticipo", amount: 500, paidAt: new Date() },
    { id: "tr", invoiceId: "inv1", method: "transfer", amount: 3500, paidAt: new Date() },
  ]);
  db.otrosPagos = [{ id: "o1", invoiceId: "inv_ori", method: "transfer", amount: 500, paidAt: sep }];
  db.credits = [
    { id: "cr1", clinicId: "c1", patientId: "p1", amount: 500, source: "cita_cancelada", invoiceId: "inv_ori", paymentId: null, creditDate: sep },
    { id: "ap1", clinicId: "c1", patientId: "p1", amount: -500, source: "aplicado_a_factura", invoiceId: "inv1", paymentId: "ant", creditDate: new Date() },
  ];
  const sin = await timbrar({ receptor: PF_612, paymentForm: "03" });
  assert.equal(sin.status, 409, "antes timbraba los $4,000 sin aviso, con el $500 ya en la global de septiembre");
  assert.equal(sin.body.code, "CFDI_CONFIRMAR_GLOBAL");
  assert.equal(pac.timbres.length, 0);
  const con = await timbrar({ receptor: PF_612, paymentForm: "03", confirmaFueraDeGlobal: true });
  assert.equal(con.status, 200, JSON.stringify(con.body));
});
