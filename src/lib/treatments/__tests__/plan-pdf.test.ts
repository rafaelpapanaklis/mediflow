/**
 * «DESCARGAR PDF» DEL PLAN DE TRATAMIENTO, CON PRECIOS (ws1-t12).
 *
 * Run: npm run test:plan-tratamiento-pdf
 *
 * Dos niveles:
 *   1. `armarDocumentoDelPlan` (puro): renglones, fases, zona, subtotal, ajuste, total, pagado y saldo.
 *   2. `GET /api/treatments/[id]/pdf` REAL, con `mock.module` sobre prisma, sesión, bitácora y
 *      visibilidad: permisos, clínica ajena → 404, ids importados, y el PDF DE VERDAD
 *      (`renderToBuffer`) leído de vuelta: trae precios y total, y nunca las notas.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import { componerDescripcion, PLAN_VACIO, type Renglon, type Rotulos } from "@/components/dashboard/plan-tratamiento-rediseno/plan-clinico";
import { formatCurrency } from "@/lib/utils";
import { writeFileSync } from "node:fs";
import { textoVisiblePorPagina } from "@/lib/pdf/__tests__/_texto-del-pdf";
import { makePng } from "@/lib/pdf/__tests__/_imagenes-de-prueba";
import { dineroExacto } from "@/lib/treatments/dinero-exacto";

type Row = Record<string, any>;

// ── La descripción, tal como la escribe la ventana del plan ─────────────────
const rot: Rotulos = {
  diagnostico: "Diagnóstico", pronostico: "Pronóstico", total: "Total de procedimientos", alternativa: "Alternativa ofrecida",
  notas: "Notas", por: "por:",
  fase: (f) => ({ urgencia: "Urgencia", sistemica: "Fase sistémica", higienica: "Fase I · Higiénica", correctiva: "Fase II · Correctiva", restauradora: "Fase III · Restauradora", mantenimiento: "Fase IV · Mantenimiento" }[f]),
  pronosticoValor: (p) => ({ bueno: "Bueno", reservado: "Reservado", malo: "Malo" }[p]),
  dinero: (n) => formatCurrency(n),
};
let seq = 0;
const reng = (r: Partial<Renglon>): Renglon => ({
  id: `r${++seq}`, fase: "higienica", procedimiento: "", procedimientoId: null, dientes: "", caras: [], motivo: "",
  cantidad: "", precio: "", precioDelTarifario: false, minutos: 0, ...r,
});

const NOTA_SECRETA = "NOTA-INTERNA-no-cobrarle-la-radiografia";
const DESCRIPCION = componerDescripcion(
  {
    ...PLAN_VACIO,
    diagnostico: "Caries múltiple",
    pronostico: "bueno",
    renglones: [
      reng({ fase: "higienica", procedimiento: "Resina", dientes: "16, 26", caras: ["M", "O"], cantidad: "2", precio: "500", motivo: "Caries" }),
      reng({ fase: "higienica", procedimiento: "Limpieza dental", precio: "800" }),
      reng({ fase: "restauradora", procedimiento: "Corona de zirconio", dientes: "36", precio: "9000" }),
    ],
    alternativa: "Resinas en vez de corona",
    notas: `${NOTA_SECRETA}\n• debe 300 de la vez pasada`,
  },
  rot,
);
// 2 × 500 + 800 + 9000
const SUMA = 10800;

// ── 1 · Puro ────────────────────────────────────────────────────────────────
test("armado: renglones con fase, zona (dientes y caras), cantidad, precio e importe; subtotales por fase", async () => {
  const { armarDocumentoDelPlan } = await import("../plan-pdf");
  const d = armarDocumentoDelPlan({ name: "Rehabilitación", description: DESCRIPCION, totalCost: SUMA }, []);
  assert.equal(d.sinDetalle, false);
  assert.deepEqual(d.grupos.map((g) => [g.fase, g.subtotal]), [["Fase I · Higiénica", 1800], ["Fase III · Restauradora", 9000]]);
  const [resina, limpieza, corona] = d.grupos.flatMap((g) => g.renglones);
  assert.deepEqual(resina, { nombre: "Resina", zona: "16, 26 (MO)", fase: "Fase I · Higiénica", motivo: "Caries", cantidad: 2, precioUnitario: 500, importe: 1000 });
  assert.equal(limpieza.zona, "");
  assert.equal(corona.importe, 9000);
  assert.equal(d.subtotal, SUMA);
  assert.equal(d.ajuste, null);
  assert.equal(d.total, SUMA);
  assert.equal(d.pagos, null);
});

test("armado: las notas, aunque traigan viñetas, nunca son un renglón", async () => {
  const { armarDocumentoDelPlan } = await import("../plan-pdf");
  const d = armarDocumentoDelPlan({ name: "P", description: DESCRIPCION, totalCost: SUMA }, []);
  const todo = JSON.stringify(d);
  assert.doesNotMatch(todo, /NOTA-INTERNA|debe 300|Resinas en vez/);
  assert.equal(d.grupos.flatMap((g) => g.renglones).length, 3);
});

test("armado: un costo tecleado a mano por debajo de la suma sale como descuento; por encima, como ajuste; el redondeo no", async () => {
  const { armarDocumentoDelPlan } = await import("../plan-pdf");
  const menos = armarDocumentoDelPlan({ name: "P", description: DESCRIPCION, totalCost: 9800 }, []);
  assert.equal(menos.subtotal, SUMA);
  assert.deepEqual(menos.ajuste, { tipo: "descuento", monto: -1000 });
  assert.equal(menos.total, 9800);
  assert.deepEqual(armarDocumentoDelPlan({ name: "P", description: DESCRIPCION, totalCost: 11000 }, []).ajuste, { tipo: "ajuste", monto: 200 });
  assert.equal(armarDocumentoDelPlan({ name: "P", description: DESCRIPCION, totalCost: 10800 }, []).ajuste, null);
});

test("armado: el precio exacto del tarifario gana al redondeo del texto (como «Convertir en presupuesto»)", async () => {
  const { armarDocumentoDelPlan } = await import("../plan-pdf");
  const desc = componerDescripcion({ ...PLAN_VACIO, renglones: [reng({ procedimiento: "Endodoncia", precio: "3500.5" })] }, rot);
  const d = armarDocumentoDelPlan({ name: "P", description: desc, totalCost: 3500.5 }, [{ id: "e", name: "Endodoncia", basePrice: 3500.5 }]);
  assert.equal(d.grupos[0].renglones[0].precioUnitario, 3500.5);
  assert.equal(d.subtotal, 3500.5);
  assert.equal(d.ajuste, null);
});

test("armado: un plan de los de antes (descripción libre = nota) sale con un solo renglón: su nombre y su costo", async () => {
  const { armarDocumentoDelPlan } = await import("../plan-pdf");
  const d = armarDocumentoDelPlan({ name: "Ortodoncia 18 meses", description: NOTA_SECRETA, totalCost: 25000 }, []);
  assert.equal(d.sinDetalle, true);
  assert.deepEqual(d.grupos.map((g) => g.renglones.map((r) => [r.nombre, r.importe])), [[["Ortodoncia 18 meses", 25000]]]);
  assert.doesNotMatch(JSON.stringify(d), /NOTA-INTERNA/);
});

test("armado: pagado y saldo solo cuando el sistema sabe de facturas del plan", async () => {
  const { armarDocumentoDelPlan } = await import("../plan-pdf");
  const plan = { name: "P", description: DESCRIPCION, totalCost: SUMA };
  assert.equal(armarDocumentoDelPlan(plan, [], { pagado: 0, facturas: 0, facturado: 0, porPagar: 0 }).pagos, null);
  // Todo el plan facturado a su precio: el saldo es lo que falta de esas facturas.
  assert.deepEqual(armarDocumentoDelPlan(plan, [], { pagado: 3000, facturas: 2, facturado: SUMA, porPagar: 7800 }).pagos, { pagado: 3000, saldo: 7800 });
  assert.deepEqual(armarDocumentoDelPlan(plan, [], { pagado: SUMA, facturas: 1, facturado: SUMA, porPagar: 0 }).pagos, { pagado: SUMA, saldo: 0 });
});

test("nombre del archivo: sin acentos ni espacios, con el día", async () => {
  const { nombreDeArchivo } = await import("../plan-pdf");
  assert.equal(nombreDeArchivo("plan-de-tratamiento", "Ana María López", "2026-10-20"), "plan-de-tratamiento-ana-maria-lopez-2026-10-20.pdf");
});

// ── 2 · La ruta, con dobles ─────────────────────────────────────────────────
const db = {
  plans: [] as Row[], quotes: [] as Row[], invoices: [] as Row[], cargos: [] as Row[], audit: [] as Row[], catalogo: [] as Row[],
  tablasDeCargos: false,
};
const ocultos = new Set<string>();
const authCtx: Row = {};
let sinSesion = false;

const coincide = (fila: Row, where: Row = {}): boolean =>
  Object.entries(where).every(([k, v]) => {
    if (v === undefined) return true; // Prisma descarta las claves undefined
    if (v && typeof v === "object" && "in" in v) return (v.in as unknown[]).includes(fila[k]);
    if (v && typeof v === "object" && "not" in v) return fila[k] !== v.not;
    return fila[k] === v;
  });

const CLINICAS: Record<string, Row> = {
  c1: { name: "Clínica Sonrisa Centro", address: "Av. Juárez 120", city: "Mérida", state: "Yucatán", phone: "999 123 4567", email: "hola@sonrisa.mx", logoUrl: null, timezone: "America/Merida", locale: "es" },
  c2: { name: "Clínica Ajena", address: null, city: null, state: null, phone: null, email: null, logoUrl: null, timezone: null, locale: "es" },
};

const prismaStub: any = {
  treatmentPlan: { findFirst: async ({ where }: any) => structuredClone(db.plans.find((p) => coincide(p, where)) ?? null) },
  clinic: { findUnique: async ({ where }: any) => structuredClone(CLINICAS[where.id] ?? null) },
  procedureCatalog: { findMany: async () => db.catalogo.map((p) => structuredClone(p)) },
  quote: { findMany: async ({ where }: any) => db.quotes.filter((q) => coincide(q, where)).map((q) => structuredClone(q)) },
  invoice: { findMany: async ({ where }: any) => db.invoices.filter((i) => coincide(i, where)).map((i) => structuredClone(i)) },
  $queryRaw: async (partes: TemplateStringsArray, ...valores: unknown[]) => {
    const sql = partes.join("?");
    if (sql.includes("to_regclass")) return [{ existe: db.tablasDeCargos }];
    if (sql.includes("quote_charges")) {
      const clinicId = valores[0];
      return db.cargos.filter((c) => c.clinicId === clinicId);
    }
    return [];
  },
};

(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
(mock as any).module("@/lib/auth-context", { namedExports: { getAuthContext: async () => (sinSesion ? null : authCtx) } });
(mock as any).module("@/lib/audit", {
  namedExports: { logAudit: async (a: Row) => { db.audit.push(a); }, logMutation: async () => {}, extractAuditMeta: () => ({}) },
});
(mock as any).module("@/lib/patient-visibility", {
  namedExports: {
    assertPatientVisible: async (id: string) => (ocultos.has(id) ? NextResponse.json({ error: "patient_not_found" }, { status: 404 }) : null),
  },
});

const plan = (extra: Row): Row => ({
  clinicId: "c1", patientId: "p1", doctorId: "doc-1", name: "Rehabilitación", description: DESCRIPCION, totalCost: SUMA,
  status: "ACTIVE", startDate: new Date("2026-10-01T15:00:00Z"),
  patient: { firstName: "Ana", lastName: "López", patientNumber: "P-0042" },
  doctor: { firstName: "Mariana", lastName: "Cortés", cedulaProfesional: "12345678" },
  ...extra,
});

beforeEach(async () => {
  db.plans = [
    plan({ id: "cmabc123def456ghi789jkl0" }), // cuid (importado de Dentalink)
    plan({ id: "prueba-plan-02", doctorId: "doc-2" }), // id de siembra, de OTRO doctor
    plan({ id: "11111111-2222-4333-8444-555555555555", clinicId: "c2", patientId: "p9", name: "Ajeno" }), // uuid, otra clínica
    plan({ id: "plan-oculto", patientId: "p-oculto" }),
  ];
  db.quotes = [];
  db.invoices = [];
  db.catalogo = [];
  db.cargos = [];
  db.audit = [];
  db.tablasDeCargos = false;
  ocultos.clear();
  ocultos.add("p-oculto");
  sinSesion = false;
  for (const k of Object.keys(authCtx)) delete authCtx[k];
  Object.assign(authCtx, { clinicId: "c1", userId: "u1", role: "SUPER_ADMIN", isDoctor: false, permissionsOverride: [] });
  (await import("@/lib/quotes/aceptacion-db"))._olvidarTablas();
});

// Import perezoso: los mocks de arriba tienen que estar puestos antes de cargar el handler.
const GET = async (id: string) =>
  (await import("@/app/api/treatments/[id]/pdf/route")).GET({ headers: new Headers() } as any, { params: Promise.resolve({ id }) });
const paginasDe = async (res: Response) => textoVisiblePorPagina(Buffer.from(await res.arrayBuffer()));
// Los rótulos (fase, paciente, firmas…) van en mayúsculas por estilo: se compara sin mayúsculas.
const textoDe = async (res: Response) => (await paginasDe(res)).join(" ").toLowerCase();
const tiene = (texto: string, s: string) => texto.includes(s.toLowerCase());

test("ruta: sin sesión → 401; sin «treatments.view» → 403", async () => {
  sinSesion = true;
  assert.equal((await GET("cmabc123def456ghi789jkl0")).status, 401);
  sinSesion = false;
  authCtx.role = "DOCTOR";
  authCtx.permissionsOverride = ["patients.view", "billing.view"];
  const r = await GET("cmabc123def456ghi789jkl0");
  assert.equal(r.status, 403);
  assert.equal((await r.json()).permiso, "treatments.view");
  assert.equal(db.audit.length, 0);
});

test("ruta: un plan de OTRA clínica es 404 (igual que uno que no existe) y no deja bitácora", async () => {
  assert.equal((await GET("11111111-2222-4333-8444-555555555555")).status, 404);
  assert.equal((await GET("no-existe")).status, 404);
  assert.equal(db.audit.length, 0);
});

test("ruta: un paciente que la sesión no puede ver → 404", async () => {
  assert.equal((await GET("plan-oculto")).status, 404);
});

test("ruta: ids importados (cuid) y de siembra valen; lo que no es un id → 400", async () => {
  assert.equal((await GET("cmabc123def456ghi789jkl0")).status, 200);
  assert.equal((await GET("prueba-plan-02")).status, 200);
  assert.equal((await GET("../../etc")).status, 400);
  assert.equal((await GET("a b")).status, 400);
});

test("ruta: el PDF trae paciente, doctor, procedimientos con precio, fases, zona y el total; deja su fila en la bitácora", async () => {
  const r = await GET("cmabc123def456ghi789jkl0");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "application/pdf");
  assert.match(r.headers.get("content-disposition") ?? "", /attachment; filename="plan-de-tratamiento-ana-lopez-\d{4}-\d{2}-\d{2}\.pdf"/);
  const paginas = await paginasDe(r);
  const texto = paginas.join(" ").toLowerCase();
  for (const esperado of [
    "Clínica Sonrisa Centro", "Av. Juárez 120", "Ana López", "Mariana Cortés", "12345678", "Rehabilitación",
    "Resina", "16, 26 (MO)", "Caries", "Limpieza dental", "Corona de zirconio",
    "Fase I · Higiénica", "Fase III · Restauradora",
    "$500", "$1,000", "$800", "$9,000", "$10,800", "Subtotal", "Total", "Firma del paciente",
  ]) {
    assert.ok(tiene(texto, esperado), `falta «${esperado}» en el PDF`);
  }
  // Un plan corto cabe en UNA hoja, firmas incluidas.
  assert.equal(paginas.length, 1, "las firmas se fueron solas a otra hoja");
  assert.equal(db.audit.length, 1);
  assert.equal(db.audit[0].entityType, "treatment");
  assert.equal(db.audit[0].action, "view");
  assert.equal(db.audit[0].clinicId, "c1");
  assert.equal(db.audit[0].patientId, "p1");
});

test("ruta: NUNCA salen las notas internas (ni el diagnóstico ni la alternativa) en el PDF", async () => {
  const texto = await textoDe(await GET("cmabc123def456ghi789jkl0"));
  assert.ok(!tiene(texto, "NOTA-INTERNA"), "la nota interna salió en el PDF");
  assert.ok(!tiene(texto, "debe 300"), "una viñeta de las notas salió en el PDF");
  assert.ok(!tiene(texto, "Resinas en vez"), "la alternativa salió en el PDF");
  assert.ok(!tiene(texto, "Caries múltiple"), "el diagnóstico salió en el PDF");
});

test("ruta: un costo con descuento a mano sale con su línea de descuento y el total del plan", async () => {
  db.plans[0].totalCost = 9800;
  const texto = await textoDe(await GET("cmabc123def456ghi789jkl0"));
  assert.ok(tiene(texto, "Descuento"));
  assert.ok(tiene(texto, "-$1,000"));
  assert.ok(tiene(texto, "$9,800"));
});

test("ruta: el doctor descarga el plan de un colega del mismo paciente (lo ve en la ficha); sin billing.view no ve pagos", async () => {
  authCtx.role = "DOCTOR";
  authCtx.isDoctor = true;
  authCtx.userId = "doc-1";
  authCtx.permissionsOverride = ["treatments.view", "patients.view"];
  db.quotes = [{ id: "q1", clinicId: "c1", treatmentPlanId: "prueba-plan-02", invoiceId: "f1" }];
  db.invoices = [{ id: "f1", clinicId: "c1", status: "PARTIAL", paid: 4000, total: SUMA }];
  const r = await GET("prueba-plan-02");
  assert.equal(r.status, 200);
  const texto = await textoDe(r);
  assert.ok(tiene(texto, "$10,800"));
  assert.ok(!tiene(texto, "Pagado") && !tiene(texto, "Saldo"), "sin billing.view no salen pagos");
});

test("ruta: con billing.view salen pagado y saldo de las facturas de los presupuestos del plan (factura de siempre + cargos), sin canceladas ni de otra clínica", async () => {
  db.tablasDeCargos = true;
  const id = "cmabc123def456ghi789jkl0";
  db.quotes = [
    { id: "q1", clinicId: "c1", treatmentPlanId: id, invoiceId: "f1" },
    { id: "q2", clinicId: "c1", treatmentPlanId: id, invoiceId: null },
    { id: "q-c2", clinicId: "c2", treatmentPlanId: id, invoiceId: "f-c2" },
  ];
  db.cargos = [
    { clinicId: "c1", quoteId: "q2", quoteItemId: null, invoiceId: "f2", tipo: "abono", monto: 2000, invoiceNumber: "MF-2", status: "PAID", createdAt: new Date() },
    { clinicId: "c1", quoteId: "q1", quoteItemId: null, invoiceId: "f1", tipo: "concepto", monto: 1000, invoiceNumber: "MF-1", status: "PARTIAL", createdAt: new Date() },
  ];
  db.invoices = [
    { id: "f1", clinicId: "c1", status: "PARTIAL", paid: 1000, total: 8800 },
    { id: "f2", clinicId: "c1", status: "PAID", paid: 2000, total: 2000 },
    { id: "f3", clinicId: "c1", status: "CANCELLED", paid: 999, total: 999 },
    { id: "f-c2", clinicId: "c2", status: "PAID", paid: 50000, total: 50000 },
  ];
  const texto = await textoDe(await GET(id));
  assert.ok(tiene(texto, "Pagado"));
  assert.ok(tiene(texto, "$3,000"), "pagado = 1,000 + 2,000 (f1 contada una vez)");
  assert.ok(tiene(texto, "Saldo"));
  assert.ok(tiene(texto, "$7,800"), "saldo = 10,800 − 3,000");
});

test("ruta: sin presupuestos ligados al plan, el PDF no habla de pagos aunque se vea la facturación", async () => {
  const texto = await textoDe(await GET("cmabc123def456ghi789jkl0"));
  assert.ok(!tiene(texto, "Pagado"));
});

test("ruta: clínica en inglés → el PDF sale en inglés", async () => {
  CLINICAS.c1.locale = "en";
  try {
    const r = await GET("cmabc123def456ghi789jkl0");
    assert.match(r.headers.get("content-disposition") ?? "", /filename="treatment-plan-ana-lopez-/);
    const texto = await textoDe(r);
    assert.ok(tiene(texto, "Treatment plan"));
    assert.ok(tiene(texto, "Patient's signature"));
  } finally {
    CLINICAS.c1.locale = "es";
  }
});

// ── Arreglos de la revisión t4 (P1–P6): cada uno ejecuta su caso ─────────────

/** 38 procedimientos en tres fases, con nombres largos: un plan que ocupa varias hojas. */
function planLargo(): Renglon[] {
  const fases = ["higienica", "correctiva", "restauradora"] as const;
  return Array.from({ length: 38 }, (_, i) =>
    reng({
      fase: fases[Math.floor(i / 13)],
      procedimiento: i === 37 ? "Último procedimiento del plan" : `Rehabilitación con implantes y prótesis provisional ${i + 1}`,
      dientes: String(11 + (i % 7)),
      precio: "1500",
      motivo: "Ausencia dental con reabsorción ósea moderada",
    }),
  );
}

test("P1: presupuesto con 10 % de descuento → la factura trae menos que el plan: sale «Pagado» y NO un saldo que no se debe", async () => {
  const id = "cmabc123def456ghi789jkl0";
  db.plans[0].totalCost = 10000;
  db.plans[0].description = descripcionDeVentana([reng({ procedimiento: "Corona", precio: "10000" })]);
  db.quotes = [{ id: "q1", clinicId: "c1", treatmentPlanId: id, invoiceId: "f1" }];
  db.invoices = [{ id: "f1", clinicId: "c1", status: "PAID", paid: 9000, total: 9000 }];
  const texto = await textoDe(await GET(id));
  assert.ok(tiene(texto, "Pagado") && tiene(texto, "$9,000"));
  assert.ok(!tiene(texto, "Saldo"), "con descuento del presupuesto no se puede saber el saldo: no se enseña");
  assert.ok(!tiene(texto, "$1,000"), "el «saldo» de $1,000 que el paciente no debe");
});

test("P1: presupuesto mixto (general + ortodoncia) facturado de más → solo «Pagado»; y con todo facturado a su precio, el saldo de las facturas", async () => {
  const id = "cmabc123def456ghi789jkl0";
  db.quotes = [{ id: "q1", clinicId: "c1", treatmentPlanId: id, invoiceId: "f1" }];
  db.invoices = [{ id: "f1", clinicId: "c1", status: "PARTIAL", paid: 5000, total: SUMA + 25000 }];
  assert.ok(!tiene(await textoDe(await GET(id)), "Saldo"));
  db.invoices = [{ id: "f1", clinicId: "c1", status: "PARTIAL", paid: 5000, total: SUMA }];
  const texto = await textoDe(await GET(id));
  assert.ok(tiene(texto, "Saldo") && tiene(texto, "$5,800"));
});

test("P2: precios con centavos salen tal cual ($500.50), sin «Descuento» inventado; y $1,250 sin «.00»", async () => {
  const { armarDocumentoDelPlan } = await import("../plan-pdf");
  assert.equal(dineroExacto(1250.5), "$1,250.50");
  assert.equal(dineroExacto(1250), "$1,250");
  assert.equal(dineroExacto(0.1 + 0.2), "$0.30");
  const desc = descripcionDeVentana([reng({ procedimiento: "Resina", precio: "500.50" }), reng({ procedimiento: "Sellador", precio: "500.50" }), reng({ procedimiento: "Pulido", precio: "500.50" })]);
  assert.match(desc, /\$500\.50/, "la ventana escribe ya los centavos en el texto del plan");
  const d = armarDocumentoDelPlan({ name: "P", description: desc, totalCost: 1501.5 }, []);
  assert.deepEqual(d.grupos[0].renglones.map((r) => r.precioUnitario), [500.5, 500.5, 500.5]);
  assert.equal(d.subtotal, 1501.5);
  assert.equal(d.ajuste, null);

  const id = "cmabc123def456ghi789jkl0";
  db.plans[0].description = desc;
  db.plans[0].totalCost = 1501.5;
  const texto = await textoDe(await GET(id));
  assert.ok(tiene(texto, "$500.50") && tiene(texto, "$1,501.50"));
  assert.ok(!tiene(texto, "Descuento"));
  assert.ok(!tiene(texto, "$1,501.50.00") && !tiene(texto, "$1,501.00"));
});

test("P2: un plan VIEJO cuyo texto redondeó $500.50 a $501 → la diferencia sale como «Redondeo de precios», nunca como descuento", async () => {
  const id = "cmabc123def456ghi789jkl0";
  db.plans[0].description = componerDescripcion(
    { ...PLAN_VACIO, renglones: [reng({ procedimiento: "Resina", precio: "500.50" }), reng({ procedimiento: "Sellador", precio: "500.50" }), reng({ procedimiento: "Pulido", precio: "500.50" })] },
    rot, // formatCurrency: pesos enteros, como escribía la ventana antes
  );
  db.plans[0].totalCost = 1501.5;
  const texto = await textoDe(await GET(id));
  assert.ok(tiene(texto, "Redondeo de precios") && tiene(texto, "-$1.50"));
  assert.ok(!tiene(texto, "Descuento"));
  assert.ok(tiene(texto, "$1,501.50"), "el total es el costo exacto del plan");
});

test("P3: una cortesía en $0 sale en $0 aunque el tarifario la tenga con precio, y no hay «Descuento»", async () => {
  const id = "cmabc123def456ghi789jkl0";
  db.catalogo = [{ id: "rev", name: "Revisión", basePrice: 500 }];
  db.plans[0].description = descripcionDeVentana([reng({ procedimiento: "Revisión" }), reng({ procedimiento: "Resina", precio: "800" })]);
  db.plans[0].totalCost = 800;
  const { armarDocumentoDelPlan } = await import("../plan-pdf");
  const d = armarDocumentoDelPlan({ name: "P", description: db.plans[0].description, totalCost: 800 }, db.catalogo as any);
  assert.deepEqual(d.grupos[0].renglones.map((r) => [r.nombre, r.importe]), [["Revisión", 0], ["Resina", 800]]);
  assert.equal(d.ajuste, null);
  const texto = await textoDe(await GET(id));
  assert.ok(tiene(texto, "Revisión") && tiene(texto, "$0"));
  assert.ok(!tiene(texto, "Descuento") && !tiene(texto, "$500"));
});

test("P3: un plan cuyos renglones no traen precio (solo costo total) no inventa $0 ni ajuste: «—» y el total", async () => {
  const { armarDocumentoDelPlan } = await import("../plan-pdf");
  const desc = descripcionDeVentana([reng({ procedimiento: "Extracción" }), reng({ procedimiento: "Puente" })]);
  const d = armarDocumentoDelPlan({ name: "P", description: desc, totalCost: 9000 }, []);
  assert.deepEqual(d.grupos[0].renglones.map((r) => r.precioUnitario), [null, null]);
  assert.equal(d.subtotal, null);
  assert.equal(d.ajuste, null);
  assert.equal(d.total, 9000);
});

test("P4: sin la línea en blanco antes de «▸ Notas», la nota NO sale como procedimiento (presupuesto ni PDF)", async () => {
  const { leerRenglonesDelPlan } = await import("@/lib/quotes/desde-plan");
  const aMano = "▸ Diagnóstico: Caries\n\n▸ Fase I · Higiénica — $800\n• Resina · 1 × $800 = $800\n▸ Notas: interno\n• no cobrar rx\n• cliente moroso";
  assert.deepEqual(leerRenglonesDelPlan(aMano).map((r) => r.nombre), ["Resina"]);
  // Un encabezado que no es fase conocida tampoco abre una:
  assert.deepEqual(leerRenglonesDelPlan("▸ Fase I · Higiénica\n• Resina\n▸ Pendiente de cobro\n• no cobrar rx").map((r) => r.nombre), ["Resina"]);
  // En inglés también se reconocen las fases:
  assert.deepEqual(leerRenglonesDelPlan("▸ Phase I · Hygienic — $800\n• Filling · 1 × $800 = $800\n▸ Notes: x\n• skip").map((r) => r.nombre), ["Filling"]);
  const id = "cmabc123def456ghi789jkl0";
  db.plans[0].description = aMano;
  db.plans[0].totalCost = 800;
  const texto = await textoDe(await GET(id));
  assert.ok(tiene(texto, "Resina"));
  assert.ok(!tiene(texto, "no cobrar rx") && !tiene(texto, "moroso"));
});

test("P5: emoji, cirílico y chino se quitan limpiamente; acentos, ñ, ü, «» y € se quedan", async () => {
  const { textoParaHelvetica } = await import("../plan-pdf");
  assert.equal(textoParaHelvetica("Zoë Ñañez 🙂"), "Zoë Ñañez");
  assert.equal(textoParaHelvetica("Иван Pérez"), "Pérez");
  assert.equal(textoParaHelvetica("王 Lǐ «Güero» €"), "L «Güero» €");
  assert.equal(textoParaHelvetica("e\u0301"), "é", "un acento escrito aparte se junta");
  assert.equal(textoParaHelvetica("👨‍👩‍👧"), "");
  const id = "cmabc123def456ghi789jkl0";
  db.plans[0].patient = { firstName: "Zoë 🙂", lastName: "Ñañez", patientNumber: "P-1" };
  db.plans[0].doctor = { firstName: "Иван", lastName: "Gómez ✨", cedulaProfesional: "7654321" };
  db.plans[0].name = "Sonrisa 😁 nueva";
  const texto = await textoDe(await GET(id));
  assert.ok(tiene(texto, "Zoë Ñañez") && tiene(texto, "Gómez") && tiene(texto, "Sonrisa nueva"));
  assert.ok(!/=b|ø=|þ/.test(texto), "sin basura de glifos");
  assert.match(
    (await GET(id)).headers.get("content-disposition") ?? "",
    /filename="plan-de-tratamiento-zoe-nanez-\d{4}-\d{2}-\d{2}\.pdf"/,
  );
});

test("P6: plan largo → el encabezado de columnas se repite en cada hoja, la última hoja trae procedimiento + totales + firmas, y nada de «im-plantes»", async () => {
  const id = "cmabc123def456ghi789jkl0";
  db.plans[0].description = descripcionDeVentana(planLargo());
  db.plans[0].totalCost = 38 * 1500;
  const paginas = (await paginasDe(await GET(id))).map((p) => p.toLowerCase());
  assert.ok(paginas.length >= 3, `se esperaban varias hojas, salieron ${paginas.length}`);
  assert.ok(!paginas[0].includes("(continúa)"));
  for (const [i, p] of paginas.entries()) {
    assert.ok(p.includes("procedimiento") && p.includes("importe"), `hoja ${i + 1} sin encabezado de columnas`);
    assert.ok(p.includes("rehabilitación con implantes") || p.includes("último procedimiento"), `hoja ${i + 1} sin procedimientos`);
    if (i > 0) assert.ok(p.includes("(continúa)"), `hoja ${i + 1} sin «Procedimientos (continúa)»`);
  }
  const ultima = paginas[paginas.length - 1];
  assert.ok(ultima.includes("último procedimiento del plan") && ultima.includes("firma del paciente") && ultima.includes("total"));
  assert.ok(!paginas.slice(0, -1).some((p) => p.includes("firma del paciente")), "las firmas van solo en la última hoja");
  assert.ok(!/im-plantes|reha-bilitación|pró-tesis|provi-sional|reab-sorción/.test(paginas.join(" ")), "palabra partida con guion");
  // Los 38 están, cada uno una vez.
  for (let n = 1; n <= 37; n++) {
    assert.equal(paginas.join(" ").split(`prótesis provisional ${n}`).length - 1 >= 1, true, `falta el renglón ${n}`);
  }
});

/** Corre `fn` con el logo de prueba servido; lo demás (el wasm del maquetador de @react-pdf) sigue su camino. */
async function conLogo<T>(fn: () => Promise<T>): Promise<T> {
  CLINICAS.c1.logoUrl = "https://logo.prueba/logo.png";
  const fetchReal = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) =>
    String(url).startsWith("https://logo.prueba/")
      ? new Response(new Uint8Array(makePng(240, 80)), { status: 200, headers: { "content-type": "image/png" } })
      : fetchReal(url as RequestInfo, init)) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = fetchReal;
    CLINICAS.c1.logoUrl = null;
  }
}

/** Descripción escrita como la escribe HOY la ventana (dinero con centavos solo si los hay). */
const descripcionDeVentana = (renglones: Renglon[], extra: Record<string, string> = {}) =>
  componerDescripcion({ ...PLAN_VACIO, renglones, ...extra }, { ...rot, dinero: (n) => dineroExacto(n) });

test("muestras: con MUESTRA_DIR=<carpeta> deja los PDF de muestra (datos inventados)", async (t) => {
  const dir = process.env.MUESTRA_DIR;
  if (!dir) return t.skip("sin MUESTRA_DIR");
  const id = "cmabc123def456ghi789jkl0";
  await conLogo(async () => {
    // 1 · El de siempre: descuento a mano, todo facturado a su precio → pagado y saldo.
    db.plans[0].totalCost = 10300;
    db.quotes = [{ id: "q1", clinicId: "c1", treatmentPlanId: id, invoiceId: "f1" }];
    db.invoices = [{ id: "f1", clinicId: "c1", status: "PARTIAL", paid: 3500, total: 10300 }];
    writeFileSync(`${dir}/plan-muestra-1-saldo.pdf`, Buffer.from(await (await GET(id)).arrayBuffer()));

    // 2 · Centavos, una cortesía en $0 y un presupuesto con 10 % de descuento real → solo «Pagado».
    db.plans[0].description = descripcionDeVentana([
      reng({ fase: "higienica", procedimiento: "Revisión", motivo: "Control" }),
      reng({ fase: "higienica", procedimiento: "Resina compuesta", dientes: "16", caras: ["O"], cantidad: "3", precio: "500.50", motivo: "Caries" }),
      reng({ fase: "restauradora", procedimiento: "Incrustación de porcelana", dientes: "36", precio: "4250.75" }),
    ]);
    db.plans[0].totalCost = 5752.25;
    db.catalogo = [{ id: "rev", name: "Revisión", basePrice: 500 }];
    db.invoices = [{ id: "f1", clinicId: "c1", status: "PARTIAL", paid: 2000, total: 5177.03 }];
    writeFileSync(`${dir}/plan-muestra-2-centavos-cortesia-descuento.pdf`, Buffer.from(await (await GET(id)).arrayBuffer()));

    // 3 · Plan largo (varias hojas) con nombres con emoji y otros alfabetos.
    db.plans[0].description = descripcionDeVentana(planLargo());
    db.plans[0].totalCost = 38 * 1500;
    db.plans[0].patient = { firstName: "Zoë 🙂", lastName: "Ñañez Иванова", patientNumber: "P-0099" };
    db.plans[0].name = "Rehabilitación con implantes 🦷";
    db.quotes = [];
    db.invoices = [];
    db.catalogo = [];
    writeFileSync(`${dir}/plan-muestra-3-largo-emoji.pdf`, Buffer.from(await (await GET(id)).arrayBuffer()));
  });
});

test("textos: es.json y en.json tienen las mismas llaves de planTratamiento.pdf, y en es van con tú", async () => {
  const es = (await import("@/i18n/dictionaries/es.json")).default as any;
  const en = (await import("@/i18n/dictionaries/en.json")).default as any;
  const llaves = Object.keys(es.planTratamiento.pdf).sort();
  assert.deepEqual(Object.keys(en.planTratamiento.pdf).sort(), llaves);
  for (const k of ["boton", "titulo", "firmaPaciente", "total", "saldo", "pagina", "archivo"]) assert.ok(llaves.includes(k), k);
  assert.doesNotMatch(JSON.stringify(es.planTratamiento.pdf), /\b(intentá|podés|tenés|usted)\b/i);
});
