/**
 * Rutas de ws1-t8 con sus HANDLERS REALES (mock.module, de ahí --experimental-test-module-mocks):
 *   · POST /api/cfdi/[cfdiId]/enviar — correo por Facturapi y WhatsApp con ventana de 24 h (F-17);
 *   · POST /api/settings/cfdi y /certificate — régimen contra persona, bitácora y avisos (F-15);
 *   · GET /api/cfdi/cobrado-sin-cfdi — el reporte para el contador, aislado por clínica (F-09).
 * Run: npm run test:cfdi-envio-rutas
 *
 * Facturapi y WhatsApp son dobles: nada sale a la red ni a un teléfono.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Estado de los dobles ────────────────────────────────────────────────────
const db = {
  cfdi: null as any,
  invoice: null as any,
  clinic: null as any,
  clinicUpdates: [] as any[],
  pagos: [] as any[],
  registros: [] as any[],
  creditos: [] as any[],
};
const llamadas = {
  correo: [] as any[],
  whatsapp: [] as any[],
  bitacora: [] as any[],
  legal: [] as any[],
  cert: [] as any[],
};
const entorno = { ultimoEntrante: null as Date | null, rfcOrg: null as string | null, correoFalla: null as null | { status: number; msg: string } };

const authCtx: any = { clinicId: "c1", userId: "u1", role: "ADMIN", isAdmin: true, isSuperAdmin: false, permissionsOverride: null };

function exigeClinica(where: any) {
  // Regla (c): toda lectura lleva el clinicId de la sesión, nunca undefined.
  if (!where || where.clinicId === undefined) throw new Error("consulta sin clinicId");
}

const prismaStub: any = {
  cfdiRecord: {
    findFirst: async ({ where }: any) => { exigeClinica(where); return db.cfdi && db.cfdi.id === where.id && db.cfdi.clinicId === where.clinicId ? db.cfdi : null; },
    findMany: async ({ where }: any) => { exigeClinica(where); return db.registros.filter((r) => r.clinicId === where.clinicId && where.invoiceId.in.includes(r.invoiceId)); },
  },
  invoice: {
    findFirst: async ({ where }: any) => { exigeClinica(where); return db.invoice && db.invoice.id === where.id && db.invoice.clinicId === where.clinicId ? db.invoice : null; },
  },
  clinic: {
    findUnique: async ({ where }: any) => (db.clinic && where.id === db.clinic.id ? { ...db.clinic } : null),
    update: async ({ where, data }: any) => { db.clinicUpdates.push({ where, data }); Object.assign(db.clinic, data); return { ...db.clinic }; },
  },
  payment: {
    findMany: async ({ where }: any) => {
      // C-38: el reporte también pide los cobros y reembolsos de la definición única (AND de Finanzas).
      const w = Array.isArray(where?.AND) ? where.AND[0] : where;
      if (!w?.invoice?.clinicId) throw new Error("pagos sin clinicId");
      let xs = db.pagos.filter((p) => p.invoice.clinicId === w.invoice.clinicId && p.paidAt >= w.paidAt.gte && p.paidAt < w.paidAt.lt);
      if (w.method === "refund") xs = xs.filter((p) => p.method === "refund");
      else if (Array.isArray(w.method?.notIn)) xs = xs.filter((p) => !w.method.notIn.includes(p.method));
      return xs;
    },
  },
  patientCredit: {
    findMany: async ({ where }: any) => { exigeClinica(where); return db.creditos.filter((c: any) => c.clinicId === where.clinicId); },
  },
};

(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
(mock as any).module("@/lib/auth-context", {
  namedExports: {
    getAuthContext: async () => authCtx,
    requireAdmin: (ctx: any) => (ctx?.isAdmin ? null : new Response(null, { status: 403 })),
  },
});
(mock as any).module("@/lib/patient-visibility", { namedExports: { assertPatientVisible: async () => null } });
(mock as any).module("@/lib/rate-limit", { namedExports: { rateLimit: () => null, rateLimitKey: () => true } });
(mock as any).module("@/lib/audit", { namedExports: { logMutation: async (a: any) => { llamadas.bitacora.push(a); } } });
(mock as any).module("@/lib/facturapi", {
  namedExports: {
    getOrgApiKey: async () => "sk_test_org",
    downloadInvoiceFileForOrg: async () => new TextEncoder().encode("%PDF-1.4").buffer,
    createOrganization: async () => "org_nueva",
    updateOrgLegal: async (_id: string, d: any) => { llamadas.legal.push(d); },
    getOrganizationStatus: async () => ({ exists: true }),
    uploadCertificate: async (_o: string, cer: Buffer) => { llamadas.cert.push(cer.length); return { hasCertificate: true, validUntil: "2026-10-20T00:00:00.000Z", serialNumber: "30001000000500003416" }; },
  },
});
class EnvioCorreoErrorDoble extends Error { constructor(m: string, public status: number) { super(m); } }
(mock as any).module("@/lib/cfdi/facturapi-extra.server", {
  namedExports: {
    EnvioCorreoError: EnvioCorreoErrorDoble,
    enviarCfdiPorCorreo: async (a: any) => {
      if (entorno.correoFalla) throw new EnvioCorreoErrorDoble(entorno.correoFalla.msg, entorno.correoFalla.status);
      llamadas.correo.push(a);
    },
    rfcDeLaOrganizacion: async () => entorno.rfcOrg,
  },
});
(mock as any).module("@/lib/orthodontics/responsable-telefono-db", { namedExports: { contactoDelResponsableDeLaFactura: async () => null } });
(mock as any).module("@/lib/whatsapp/inbox-log", { namedExports: { lastInboundAtForPhone: async () => entorno.ultimoEntrante } });
(mock as any).module("@/lib/whatsapp/send-and-log", {
  namedExports: { sendWhatsAppLogged: async (a: any) => { llamadas.whatsapp.push(a); return { ok: true }; } },
});
(mock as any).module("@/lib/invoices/cfdi-pago-db", { namedExports: { columnaPagoListaParaCfdi: async () => false } });

function req(url: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
  const { NextRequest } = require("next/server");
  return new NextRequest(new URL(url, "https://panel.test"), {
    method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://panel.test";
  authCtx.clinicId = "c1"; authCtx.role = "ADMIN"; authCtx.isAdmin = true; authCtx.permissionsOverride = null;
  db.clinic = {
    id: "c1", name: "Clínica Prueba", locale: "es", facturApiOrgId: "org1", timezone: "America/Mexico_City",
    waConnected: true, waPhoneNumberId: "pn", waAccessToken: "tok", waTemplates: {},
    rfcEmisor: "VADA800927DJ3", regimenFiscal: "612", cpEmisor: "06600", cfdiTaxMode: "exempt",
    csdUploaded: true, csdValidUntil: new Date("2027-05-01T00:00:00Z"),
  };
  db.cfdi = { id: "cfdi1", clinicId: "c1", uuid: "UUID-1", facturapiId: "fapi_1", invoiceId: "inv1", total: 1600, status: "valid", receptor: { rfc: "XAXX", email: "maria@correo.com" } };
  db.invoice = {
    id: "inv1", clinicId: "c1", invoiceNumber: "MF-1042", patientId: "p1",
    patient: { firstName: "María", lastName: "López", email: "otro@correo.com", phone: "5512345678" },
    clinic: db.clinic,
  };
  db.clinicUpdates = []; db.pagos = []; db.registros = [];
  for (const k of Object.keys(llamadas)) (llamadas as any)[k] = [];
  entorno.ultimoEntrante = null; entorno.rfcOrg = null; entorno.correoFalla = null;
});

// ═══ F-17 · enviar ═════════════════════════════════════════════════════════

test("enviar por correo: Facturapi recibe el CFDI de ESA clínica y los correos; queda en Movimientos sin el correo completo", async () => {
  const { POST } = await import("@/app/api/cfdi/[cfdiId]/enviar/route");
  const res = await POST(req("/api/cfdi/cfdi1/enviar", { canal: "correo", correos: "Maria@Correo.com, conta@despacho.mx" }), { params: { cfdiId: "cfdi1" } });
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  assert.deepEqual(llamadas.correo.map((c) => [c.apiKey, c.facturapiId, c.correos]), [["sk_test_org", "fapi_1", ["maria@correo.com", "conta@despacho.mx"]]]);
  assert.equal(llamadas.bitacora.length, 1);
  assert.equal(llamadas.bitacora[0].entityId, "inv1");
  assert.equal(llamadas.bitacora[0].patientId, "p1");
  assert.match(llamadas.bitacora[0].texto, /por correo \(m\*\*\*@correo\.com, c\*\*\*@despacho\.mx\)/);
  assert.doesNotMatch(JSON.stringify(llamadas.bitacora[0]), /maria@correo\.com/);
});

test("enviar: el CFDI de OTRA clínica no existe (404) y no se llama a Facturapi", async () => {
  const { POST } = await import("@/app/api/cfdi/[cfdiId]/enviar/route");
  authCtx.clinicId = "c2";
  const res = await POST(req("/api/cfdi/cfdi1/enviar", { canal: "correo", correos: "a@b.mx" }), { params: { cfdiId: "cfdi1" } });
  assert.equal(res.status, 404);
  assert.equal(llamadas.correo.length, 0);
});

test("enviar: un CFDI cancelado no se manda (409) — ni por correo ni por WhatsApp", async () => {
  const { POST } = await import("@/app/api/cfdi/[cfdiId]/enviar/route");
  db.cfdi.status = "cancelled";
  for (const canal of ["correo", "whatsapp"]) {
    const res = await POST(req("/api/cfdi/cfdi1/enviar", { canal, correos: "a@b.mx" }), { params: { cfdiId: "cfdi1" } });
    assert.equal(res.status, 409);
  }
  assert.equal(llamadas.correo.length + llamadas.whatsapp.length, 0);
});

test("enviar: correo inválido → 400 sin llamar a Facturapi; Facturapi rechaza → su motivo, sin bitácora", async () => {
  const { POST } = await import("@/app/api/cfdi/[cfdiId]/enviar/route");
  const r1 = await POST(req("/api/cfdi/cfdi1/enviar", { canal: "correo", correos: "maria@" }), { params: { cfdiId: "cfdi1" } });
  assert.equal(r1.status, 400);
  entorno.correoFalla = { status: 400, msg: "El correo no es válido" };
  const r2 = await POST(req("/api/cfdi/cfdi1/enviar", { canal: "correo", correos: "a@b.mx" }), { params: { cfdiId: "cfdi1" } });
  assert.equal(r2.status, 400);
  // C-57: en humano, con el motivo de Facturapi entre paréntesis.
  assert.equal((await r2.json()).error, "No se pudo mandar el correo. Revisa que la dirección esté bien escrita y vuelve a intentarlo. (El correo no es válido)");
  assert.equal(llamadas.bitacora.length, 0);
});

test("enviar por WhatsApp fuera de la ventana de 24 h: 409 y NO sale nada (no hay plantilla del CFDI)", async () => {
  const { POST } = await import("@/app/api/cfdi/[cfdiId]/enviar/route");
  entorno.ultimoEntrante = new Date(Date.now() - 25 * 60 * 60 * 1000);
  const res = await POST(req("/api/cfdi/cfdi1/enviar", { canal: "whatsapp" }), { params: { cfdiId: "cfdi1" } });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, "CFDI_WA_FUERA_DE_VENTANA");
  assert.equal(llamadas.whatsapp.length, 0);
});

test("enviar por WhatsApp con la ventana abierta: tipo «system» (sin plantilla de respaldo), PDF adjunto y enlaces firmados", async () => {
  const { POST } = await import("@/app/api/cfdi/[cfdiId]/enviar/route");
  entorno.ultimoEntrante = new Date(Date.now() - 60 * 60 * 1000);
  const res = await POST(req("/api/cfdi/cfdi1/enviar", { canal: "whatsapp" }), { params: { cfdiId: "cfdi1" } });
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  assert.equal(llamadas.whatsapp.length, 1);
  const w = llamadas.whatsapp[0];
  assert.equal(w.kind, "system");
  assert.equal(w.to, "5512345678");
  assert.equal(w.attachment.filename, "CFDI-UUID-1.pdf");
  assert.match(w.body, /https:\/\/panel\.test\/api\/cfdi\/descarga\/cfdi1\?f=pdf&e=\d+&t=[\w-]+/);
  assert.match(w.body, /f=xml/);
  assert.match(llamadas.bitacora[0].texto, /por WhatsApp \(María López · •••• 5678\)/);
});

test("enviar: sin «Crear facturas» no se manda (403); sin «Enviar WhatsApp» no sale el WhatsApp", async () => {
  const { POST } = await import("@/app/api/cfdi/[cfdiId]/enviar/route");
  authCtx.role = "RECEPTIONIST"; authCtx.isAdmin = false;
  authCtx.permissionsOverride = ["billing.view"];
  const r1 = await POST(req("/api/cfdi/cfdi1/enviar", { canal: "correo", correos: "a@b.mx" }), { params: { cfdiId: "cfdi1" } });
  assert.equal(r1.status, 403);
  authCtx.permissionsOverride = ["billing.view", "billing.create"];
  entorno.ultimoEntrante = new Date();
  const r2 = await POST(req("/api/cfdi/cfdi1/enviar", { canal: "whatsapp" }), { params: { cfdiId: "cfdi1" } });
  assert.equal(r2.status, 403);
  assert.equal(llamadas.correo.length + llamadas.whatsapp.length, 0);
});

test("GET enviar: sugiere el correo del receptor del CFDI y dice por qué no sale el WhatsApp", async () => {
  const { GET } = await import("@/app/api/cfdi/[cfdiId]/enviar/route");
  const res = await GET(req("/api/cfdi/cfdi1/enviar"), { params: { cfdiId: "cfdi1" } });
  const d = await res.json();
  assert.equal(d.correo, "maria@correo.com");
  assert.equal(d.whatsapp.modo, "blocked");
  assert.match(d.whatsapp.motivo, /24 h/);
  assert.equal(d.whatsapp.destino, "María López · •••• 5678");
});

// ═══ F-15 · emisor ═════════════════════════════════════════════════════════

const DATOS = { rfcEmisor: "EKU9003173C9", regimenFiscal: "601", cpEmisor: "06600", razonSocial: "Clinica SA de CV", cfdiTaxMode: "exempt" };

test("datos fiscales: régimen 612 con RFC de persona moral → 400 y no se toca Facturapi ni la base", async () => {
  process.env.FACTURAPI_USER_KEY = "sk_user";
  const { POST } = await import("@/app/api/settings/cfdi/route");
  const res = await POST(req("/api/settings/cfdi", { ...DATOS, regimenFiscal: "612" }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /solo para personas físicas/);
  assert.equal(llamadas.legal.length, 0);
  assert.equal(db.clinicUpdates.length, 0);
});

test("datos fiscales: se guardan, quedan en Movimientos (antes y después) y avisan persona moral + exento y RFC ≠ CSD", async () => {
  process.env.FACTURAPI_USER_KEY = "sk_user";
  entorno.rfcOrg = "VADA800927DJ3";
  const { POST } = await import("@/app/api/settings/cfdi/route");
  const res = await POST(req("/api/settings/cfdi", DATOS));
  const d = await res.json();
  assert.equal(res.status, 200, JSON.stringify(d));
  assert.deepEqual(d.avisos.map((a: any) => a.code), ["RFC_DISTINTO_AL_CSD", "EXENTO_PERSONA_MORAL"]);
  const b = llamadas.bitacora.find((x) => /datos fiscales/.test(x.texto));
  assert.ok(b, "queda en la bitácora");
  assert.equal(b.before.rfcEmisor, "VADA800927DJ3");
  assert.equal(b.after.rfcEmisor, "EKU9003173C9");
  assert.equal(b.after.regimenFiscal, "601");
});

test("subir el CSD deja rastro (serie, RFC, vigencia; nada de la llave) y avisa que vence pronto", async () => {
  process.env.FACTURAPI_USER_KEY = "sk_user";
  entorno.rfcOrg = "VADA800927DJ3";
  const { POST } = await import("@/app/api/settings/cfdi/certificate/route");
  const res = await POST(req("/api/settings/cfdi/certificate", {
    cerBase64: Buffer.from("cer").toString("base64"), keyBase64: Buffer.from("key").toString("base64"), password: "secreta",
  }));
  const d = await res.json();
  assert.equal(res.status, 200, JSON.stringify(d));
  const b = llamadas.bitacora.find((x) => /certificado de sello digital/.test(x.texto));
  assert.ok(b);
  assert.deepEqual(b.after.csd, { cargado: true, vigencia: "2026-10-20T00:00:00.000Z", numeroDeSerie: "30001000000500003416", rfc: "VADA800927DJ3" });
  assert.doesNotMatch(JSON.stringify(b), /secreta|a2V5/, "ni la contraseña ni la llave");
  // Vence el 20-oct: a menos de 30 días de cualquier fecha de prueba de octubre de 2026 en adelante… o ya vencido.
  assert.ok(d.avisos.some((a: any) => a.code === "CSD_POR_VENCER" || a.code === "CSD_VENCIDO"));
});

// ═══ F-09 · reporte ════════════════════════════════════════════════════════

test("reporte: solo la clínica de la sesión, sin lo timbrado, y CSV descargable", async () => {
  const { GET } = await import("@/app/api/cfdi/cobrado-sin-cfdi/route");
  const pago = (id: string, clinicId: string, amount: number, inv: any = {}) => ({
    id, paidAt: new Date("2026-10-10T18:00:00Z"), amount, method: "cash",
    invoice: { id: `i_${id}`, clinicId, invoiceNumber: `MF-${id}`, status: "PAID", balance: 0, cfdiUuid: null, taxRate: 16, taxIncluded: true, ...inv },
  });
  db.pagos = [pago("1", "c1", 500), pago("2", "c1", 900, { cfdiUuid: "U2" }), pago("3", "c2", 7000)];
  db.registros = [{ clinicId: "c1", invoiceId: "i_2", status: "valid" }];
  const res = await GET(req("/api/cfdi/cobrado-sin-cfdi?mes=2026-10"));
  const d = await res.json();
  assert.equal(res.status, 200, JSON.stringify(d));
  assert.deepEqual(d.filas.map((f: any) => f.folio), ["MF-1"]);
  assert.equal(d.total, 500);
  assert.equal(d.excluidos.timbradas, 1);
  const csv = await GET(req("/api/cfdi/cobrado-sin-cfdi?mes=2026-10&formato=csv"));
  assert.equal(csv.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.match(csv.headers.get("content-disposition") ?? "", /cobrado-sin-cfdi-2026-10\.csv/);
  assert.match(await csv.text(), /"MF-1"/);
});

test("reporte (C-38/C-39): el traspaso a saldo a favor no resta y el anticipo de Mercado Pago sin nota entra, con la definición de Finanzas", async () => {
  const { GET } = await import("@/app/api/cfdi/cobrado-sin-cfdi/route");
  const p = (id: string, amount: number, extra: any = {}) => ({
    id, paidAt: new Date("2026-09-10T18:00:00Z"), amount, method: "cash", refundMethod: null,
    invoice: { id: "i_1036", clinicId: "c1", invoiceNumber: "MF-1036", status: "PAID", balance: 0, cfdiUuid: null, taxRate: 16, taxIncluded: true },
    ...extra,
  });
  db.pagos = [p("a", 2400), p("b", 400, { method: "refund", refundMethod: "saldo_a_favor" })];
  db.registros = [];
  db.creditos = [{ id: "cr1", clinicId: "c1", amount: 700, creditDate: new Date("2026-09-12T18:00:00Z"), source: "anticipo_mercadopago" }];
  const d = await (await GET(req("/api/cfdi/cobrado-sin-cfdi?mes=2026-09"))).json();
  assert.equal(d.total, 3100);
  assert.equal(d.apartados.reembolsos.length, 0);
  assert.equal(d.apartados.traspasos.length, 1);
  assert.equal(d.anticiposSinNota, 700);
  db.creditos = [];
});

test("reporte: solo dueño y administrador; mes inválido → 400", async () => {
  const { GET } = await import("@/app/api/cfdi/cobrado-sin-cfdi/route");
  const malo = await GET(req("/api/cfdi/cobrado-sin-cfdi?mes=2026-13"));
  assert.equal(malo.status, 400);
  authCtx.isAdmin = false;
  const res = await GET(req("/api/cfdi/cobrado-sin-cfdi?mes=2026-10"));
  assert.equal(res.status, 403);
});
