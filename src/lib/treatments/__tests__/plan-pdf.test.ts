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
import { textosPintados, textoVisiblePorPagina } from "@/lib/pdf/__tests__/_texto-del-pdf";
import { makePng } from "@/lib/pdf/__tests__/_imagenes-de-prueba";
import { dineroExacto } from "@/lib/treatments/dinero-exacto";
import { leerRenglonesDelPlan } from "@/lib/quotes/desde-plan";
import { soloEntero } from "@/components/dashboard/plan-tratamiento-rediseno/plan-clinico";

type Row = Record<string, any>;

// ── La descripción, tal como la escribe la ventana del plan ─────────────────
const rot: Rotulos = {
  diagnostico: "Diagnóstico", pronostico: "Pronóstico", total: "Total de procedimientos", alternativa: "Alternativa ofrecida",
  notas: "Notas", por: "por:",
  fase: (f) => ({ urgencia: "Urgencia", sistemica: "Fase sistémica", higienica: "Fase I · Higiénica", correctiva: "Fase II · Correctiva", restauradora: "Fase III · Restauradora", mantenimiento: "Fase IV · Mantenimiento" }[f]),
  pronosticoValor: (p) => ({ bueno: "Bueno", reservado: "Reservado", malo: "Malo" }[p]),
  dinero: (n) => formatCurrency(n),
};
/** Rótulos de la ventana de HOY: dinero exacto y la marca de «precios exactos» (t8, N3-P2). */
const rotExacto: Rotulos = { ...rot, dinero: (n) => dineroExacto(n), exacto: true };
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
  rotExacto,
);
// 2 × 500 + 800 + 9000
const SUMA = 10800;


// ── 1 · Puro ────────────────────────────────────────────────────────────────
test("armado: renglones con fase, zona (dientes y caras), cantidad, precio e importe; subtotales por fase", async () => {
  const { armarDocumentoDelPlan } = await import("../plan-pdf");
  const d = armarDocumentoDelPlan({ name: "Rehabilitación", description: DESCRIPCION, totalCost: SUMA });
  assert.equal(d.sinDetalle, false);
  assert.deepEqual(d.grupos.map((g) => [g.fase, g.subtotal]), [["Fase I · Higiénica", 1800], ["Fase III · Restauradora", 9000]]);
  const [resina, limpieza, corona] = d.grupos.flatMap((g) => g.renglones);
  assert.deepEqual(resina, { nombre: "Resina", zona: "16, 26 (MO)", fase: "Fase I · Higiénica", motivo: "Caries", cantidad: 2, precioUnitario: 500, importe: 1000 });
  assert.equal(limpieza.zona, "");
  assert.equal(corona.importe, 9000);
  assert.equal(d.subtotal, SUMA);
  assert.equal(d.ajuste, null);
  assert.equal(d.total, SUMA);
});

test("armado: las notas, aunque traigan viñetas, nunca son un renglón", async () => {
  const { armarDocumentoDelPlan } = await import("../plan-pdf");
  const d = armarDocumentoDelPlan({ name: "P", description: DESCRIPCION, totalCost: SUMA });
  const todo = JSON.stringify(d);
  assert.doesNotMatch(todo, /NOTA-INTERNA|debe 300|Resinas en vez/);
  assert.equal(d.grupos.flatMap((g) => g.renglones).length, 3);
});

test("armado: un costo tecleado a mano por debajo de la suma sale como descuento; por encima, como ajuste; el redondeo no", async () => {
  const { armarDocumentoDelPlan } = await import("../plan-pdf");
  const menos = armarDocumentoDelPlan({ name: "P", description: DESCRIPCION, totalCost: 9800 });
  assert.equal(menos.subtotal, SUMA);
  assert.deepEqual(menos.ajuste, { tipo: "descuento", monto: -1000 });
  assert.equal(menos.total, 9800);
  assert.deepEqual(armarDocumentoDelPlan({ name: "P", description: DESCRIPCION, totalCost: 11000 }).ajuste, { tipo: "ajuste", monto: 200 });
  assert.equal(armarDocumentoDelPlan({ name: "P", description: DESCRIPCION, totalCost: 10800 }).ajuste, null);
});

test("armado: en un plan viejo que redondeó $3,500.50 a $3,501, el renglón dice lo del plan y la diferencia es «Redondeo»", async () => {
  const { armarDocumentoDelPlan } = await import("../plan-pdf");
  const desc = componerDescripcion({ ...PLAN_VACIO, renglones: [reng({ procedimiento: "Endodoncia", precio: "3500.5" })] }, rot);
  const d = armarDocumentoDelPlan({ name: "P", description: desc, totalCost: 3500.5 });
  assert.equal(d.grupos[0].renglones[0].precioUnitario, 3501, "el precio del PLAN (su texto), nunca el del tarifario");
  assert.deepEqual(d.ajuste, { tipo: "redondeo", monto: -0.5 });
  assert.equal(d.total, 3500.5);
});

test("armado: un plan de los de antes (descripción libre = nota) sale con un solo renglón: su nombre y su costo", async () => {
  const { armarDocumentoDelPlan } = await import("../plan-pdf");
  const d = armarDocumentoDelPlan({ name: "Ortodoncia 18 meses", description: NOTA_SECRETA, totalCost: 25000 });
  assert.equal(d.sinDetalle, true);
  assert.deepEqual(d.grupos.map((g) => g.renglones.map((r) => [r.nombre, r.importe])), [[["Ortodoncia 18 meses", 25000]]]);
  assert.doesNotMatch(JSON.stringify(d), /NOTA-INTERNA/);
});

test("nombre del archivo: sin acentos ni espacios, con el día", async () => {
  const { nombreDeArchivo } = await import("../plan-pdf");
  assert.equal(nombreDeArchivo("plan-de-tratamiento", "Ana María López", "2026-10-20"), "plan-de-tratamiento-ana-maria-lopez-2026-10-20.pdf");
});

// ── 2 · La ruta, con dobles ─────────────────────────────────────────────────
const db = {
  plans: [] as Row[], quotes: [] as Row[], invoices: [] as Row[], cargos: [] as Row[], audit: [] as Row[], catalogo: [] as Row[],
  tablasDeCargos: false,
  cargosFallan: false,
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

/** Los conceptos de un presupuesto «Convertir» del plan: sus renglones (o su nombre, sin detalle). */
const conceptosDelPlanDe = (planId: string) => {
  const p = db.plans.find((x) => x.id === planId);
  if (!p) return [];
  const leidos = leerRenglonesDelPlan(p.description);
  return (leidos.length > 0 ? leidos.map((r) => r.nombre) : [p.name]).map((name) => ({ name }));
};

const prismaStub: any = {
  treatmentPlan: { findFirst: async ({ where }: any) => structuredClone(db.plans.find((p) => coincide(p, where)) ?? null) },
  clinic: { findUnique: async ({ where }: any) => structuredClone(CLINICAS[where.id] ?? null) },
  procedureCatalog: { findMany: async () => db.catalogo.map((p) => structuredClone(p)) },
  // Sin `items` explícitos, el presupuesto trae justo los conceptos del plan (el «Convertir» de siempre).
  quote: {
    findMany: async ({ where }: any) =>
      db.quotes.filter((q) => coincide(q, where)).map((q) => ({ ...structuredClone(q), items: q.items ?? conceptosDelPlanDe(q.treatmentPlanId) })),
  },
  invoice: { findMany: async ({ where }: any) => db.invoices.filter((i) => coincide(i, where)).map((i) => structuredClone(i)) },
  $queryRaw: async (partes: TemplateStringsArray, ...valores: unknown[]) => {
    const sql = partes.join("?");
    if (sql.includes("to_regclass")) return [{ existe: db.tablasDeCargos }];
    if (sql.includes("quote_charges")) {
      if (db.cargosFallan) throw new Error("timeout del pooler (simulado)");
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
  db.cargosFallan = false;
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

test("ruta: el doctor descarga el plan de un colega del mismo paciente (lo ve en la ficha)", async () => {
  authCtx.role = "DOCTOR";
  authCtx.isDoctor = true;
  authCtx.userId = "doc-1";
  authCtx.permissionsOverride = ["treatments.view", "patients.view"];
  const r = await GET("prueba-plan-02");
  assert.equal(r.status, 200);
  const texto = await textoDe(r);
  assert.ok(tiene(texto, "$10,800"));
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

test("P2: precios con centavos salen tal cual ($500.50), sin «Descuento» inventado; y $1,250 sin «.00»", async () => {
  const { armarDocumentoDelPlan } = await import("../plan-pdf");
  assert.equal(dineroExacto(1250.5), "$1,250.50");
  assert.equal(dineroExacto(1250), "$1,250");
  assert.equal(dineroExacto(0.1 + 0.2), "$0.30");
  const desc = descripcionDeVentana([reng({ procedimiento: "Resina", precio: "500.50" }), reng({ procedimiento: "Sellador", precio: "500.50" }), reng({ procedimiento: "Pulido", precio: "500.50" })]);
  assert.match(desc, /\$500\.50/, "la ventana escribe ya los centavos en el texto del plan");
  const d = armarDocumentoDelPlan({ name: "P", description: desc, totalCost: 1501.5 });
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
  const d = armarDocumentoDelPlan({ name: "P", description: db.plans[0].description, totalCost: 800 });
  assert.deepEqual(d.grupos[0].renglones.map((r) => [r.nombre, r.importe]), [["Revisión", 0], ["Resina", 800]]);
  assert.equal(d.ajuste, null);
  const texto = await textoDe(await GET(id));
  assert.ok(tiene(texto, "Revisión") && tiene(texto, "$0"));
  assert.ok(!tiene(texto, "Descuento") && !tiene(texto, "$500"));
});

test("P3: un plan cuyos renglones no traen precio (solo costo total) no inventa $0 ni ajuste: «—» y el total", async () => {
  const { armarDocumentoDelPlan } = await import("../plan-pdf");
  const desc = descripcionDeVentana([reng({ procedimiento: "Extracción" }), reng({ procedimiento: "Puente" })]);
  const d = armarDocumentoDelPlan({ name: "P", description: desc, totalCost: 9000 });
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
  assert.equal(textoParaHelvetica("王 Lǐ «Güero» €"), "Li «Güero» €", "t8 N-P6: a «ǐ» se le quita solo el acento");
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

// ── Segunda vuelta (t8): N-P1 a N-P7 ─────────────────────────────────────────

test("t8 N-P2: el precio del PLAN manda: $449.60 sale $449.60 aunque el tarifario diga $450, sin «Descuento» de centavos", async () => {
  const id = "cmabc123def456ghi789jkl0";
  db.catalogo = [{ id: "res", name: "Resina", basePrice: 450 }];
  db.plans[0].description = descripcionDeVentana([reng({ procedimiento: "Resina", precio: "449.60" })]);
  db.plans[0].totalCost = 449.6;
  const texto = await textoDe(await GET(id));
  assert.ok(tiene(texto, "$449.60"));
  assert.ok(!tiene(texto, "$450") && !tiene(texto, "Descuento") && !tiene(texto, "Redondeo"));
  // Y un precio entero de un plan NUEVO ($450) tampoco lo pisa un tarifario de $449.60.
  db.catalogo = [{ id: "res", name: "Resina", basePrice: 449.6 }];
  db.plans[0].description = descripcionDeVentana([reng({ procedimiento: "Resina", precio: "450" })]);
  db.plans[0].totalCost = 450;
  const entero = await textoDe(await GET(id));
  assert.ok(tiene(entero, "$450") && !tiene(entero, "$449.60") && !tiene(entero, "Descuento"));
});

test("t8 N-P5: en un plan NUEVO, 24 × $1,500 con costo de $35,990 es «Descuento -$10», no «Redondeo»", async () => {
  const { armarDocumentoDelPlan } = await import("../plan-pdf");
  const desc = descripcionDeVentana([reng({ procedimiento: "Mensualidad", cantidad: "24", precio: "1500" })]);
  const nuevo = armarDocumentoDelPlan({ name: "P", description: desc, totalCost: 35990 });
  assert.deepEqual(nuevo.ajuste, { tipo: "descuento", monto: -10 });
  // En un plan VIEJO con el costo tecleado (≠ al total que el plan escribió) no se puede separar
  // redondeo de descuento: «Ajuste», con su signo; nunca «Redondeo».
  const sinMarca = componerDescripcion({ ...PLAN_VACIO, renglones: [reng({ procedimiento: "Mensualidad", cantidad: "24", precio: "1500" })] }, rot);
  const viejo = armarDocumentoDelPlan({ name: "P", description: sinMarca, totalCost: 35990 });
  assert.deepEqual(viejo.ajuste, { tipo: "ajuste", monto: -10 });
  // Y el redondeo solo se nombra en un plan viejo cuyo costo es el que él mismo escribió.
  const redondeado = componerDescripcion({ ...PLAN_VACIO, renglones: [reng({ procedimiento: "Resina", cantidad: "3", precio: "500.50" })] }, rot);
  assert.deepEqual(armarDocumentoDelPlan({ name: "P", description: redondeado, totalCost: 1501.5 }).ajuste, { tipo: "redondeo", monto: -1.5 });
  // El mismo texto CON la marca de la ventana de hoy no se trata como redondeo.
  const conMarca = redondeado.replace("Total de procedimientos: ", "Total de procedimientos:\u00a0");
  assert.notEqual(conMarca, redondeado);
  assert.equal(armarDocumentoDelPlan({ name: "P", description: conMarca, totalCost: 1501.5 }).ajuste?.tipo, "descuento");
  // Por la ruta: el plan nuevo dice «Descuento -$10».
  const id = "cmabc123def456ghi789jkl0";
  db.plans[0].description = desc;
  db.plans[0].totalCost = 35990;
  const texto = await textoDe(await GET(id));
  assert.ok(tiene(texto, "Descuento") && tiene(texto, "-$10") && !tiene(texto, "Redondeo"));
});

test("t8 N-P4: una cantidad con decimales de un plan viejo sale tal cual (1.5 × $500 = $750), sin «Descuento»; la ventana ya solo acepta enteros", async () => {
  const { soloEntero } = await import("@/components/dashboard/plan-tratamiento-rediseno/plan-clinico");
  assert.equal(soloEntero("1.5"), "1");
  assert.equal(soloEntero("2,5"), "2");
  assert.equal(soloEntero("12"), "12");
  assert.equal(soloEntero("-3"), "3");
  const id = "cmabc123def456ghi789jkl0";
  db.plans[0].description = componerDescripcion({ ...PLAN_VACIO, renglones: [reng({ procedimiento: "Resina", cantidad: "1.5", precio: "500" })] }, rot);
  assert.match(db.plans[0].description, /1\.5 × \$500 = \$750/);
  db.plans[0].totalCost = 750;
  const texto = await textoDe(await GET(id));
  assert.ok(tiene(texto, "1.5") && tiene(texto, "$750"));
  assert.ok(!tiene(texto, "Descuento") && !tiene(texto, "$1,000") && !tiene(texto, "Ajuste") && !tiene(texto, "Redondeo"));
});

test("t8 N-P6: a las letras latinas fuera de WinAnsi se les quita solo el acento; lo que queda vacío sale «—»", async () => {
  const { textoParaHelvetica, textoParaPintar } = await import("../plan-pdf");
  assert.equal(textoParaHelvetica("Łukasz Wałęsa"), "Lukasz Walesa");
  assert.equal(textoParaHelvetica("Nguyễn Văn Đức"), "Nguyen Van Duc");
  assert.equal(textoParaHelvetica("Ștefan Țepeș"), "Stefan Tepes");
  assert.equal(textoParaHelvetica("Erdoğan Şükrü Ő"), "Erdogan Sükrü O");
  assert.equal(textoParaPintar("🦷"), "—");
  assert.equal(textoParaPintar("Иван"), "—");
  assert.equal(textoParaPintar(""), "");
  const id = "cmabc123def456ghi789jkl0";
  db.plans[0].patient = { firstName: "Łukasz", lastName: "Wałęsa", patientNumber: "P-7" };
  db.plans[0].doctor = { firstName: "Иван", lastName: "Петров", cedulaProfesional: "7654321" };
  db.plans[0].name = "🦷";
  const r = await GET(id);
  assert.match(r.headers.get("content-disposition") ?? "", /filename="plan-de-tratamiento-lukasz-walesa-/);
  const pdf = Buffer.from(await r.arrayBuffer());
  const texto = textoVisiblePorPagina(pdf).join(" ");
  assert.ok(texto.includes("Lukasz Walesa"), "el nombre sin letras borradas");
  assert.ok(!texto.includes("ukasz Wasa"));
  // El extractor de las pruebas no decodifica «—» (sale como texto vacío), pero sí dice DÓNDE se
  // pintó algo: bajo el rótulo «PLAN» (misma x) tiene que haber un valor, no el hueco que había.
  const pintados = textosPintados(pdf)[0];
  for (const rotulo of ["PLAN", "DOCTOR RESPONSABLE"]) {
    const i = pintados.findIndex((x) => x.s === rotulo);
    assert.ok(i >= 0, rotulo);
    const valor = pintados[i + 1];
    assert.ok(valor && Math.abs(valor.x - pintados[i].x) < 0.5 && valor.y < pintados[i].y, `«${rotulo}» sin valor debajo: salió en blanco`);
  }
});

test("t8 N-P7: un último renglón gigante no saca el total ni las firmas de la hoja", async () => {
  const id = "cmabc123def456ghi789jkl0";
  const gigante = "Rehabilitación integral con implantes ".repeat(90).trim(); // ~3,400 letras
  db.plans[0].description = descripcionDeVentana([
    reng({ procedimiento: "Resina", precio: "500" }),
    reng({ procedimiento: gigante, precio: "1000", motivo: "Ausencia dental ".repeat(20).trim() }),
  ]);
  db.plans[0].totalCost = 1500;
  const paginas = (await paginasDe(await GET(id))).map((p) => p.toLowerCase());
  // textoVisiblePorPagina solo cuenta lo que cae DENTRO del papel: si se salieran, no estarían.
  const ultima = paginas[paginas.length - 1];
  assert.ok(ultima.includes("total") && ultima.includes("$1,500"), "el total se ve en la hoja");
  assert.ok(ultima.includes("firma del paciente") && ultima.includes("firma del doctor"), "las firmas se ven en la hoja");
  const todo = paginas.join(" ");
  assert.ok((todo.match(/rehabilitación integral con implantes/g) ?? []).length >= 90, "el renglón gigante sale entero, partido entre hojas");
});

// ── Tercera vuelta (t8) ──────────────────────────────────────────────────────

test("t8 v3 · decisión del gerente: el PDF NO lleva «Pagado» ni «Saldo», ni lee facturas, aunque haya cobros y se vea la facturación", async () => {
  const id = "cmabc123def456ghi789jkl0";
  authCtx.permissionsOverride = ["treatments.view", "patients.view", "billing.view"];
  db.tablasDeCargos = true;
  db.quotes = [{ id: "q1", clinicId: "c1", treatmentPlanId: id, invoiceId: "f1" }];
  db.invoices = [{ id: "f1", clinicId: "c1", status: "PARTIAL", paid: 4321, total: SUMA }];
  let leyoFacturas = 0;
  const original = prismaStub.invoice.findMany;
  prismaStub.invoice.findMany = async (...a: any[]) => { leyoFacturas++; return original(...a); };
  try {
    const texto = await textoDe(await GET(id));
    assert.ok(!tiene(texto, "Pagado") && !tiene(texto, "Saldo") && !tiene(texto, "Pagos registrados"));
    assert.ok(!tiene(texto, "$4,321") && !tiene(texto, "$6,479"), "N3-P1: ni lo pagado ni un saldo, ciertos o no");
    assert.ok(tiene(texto, "$10,800"), "el total del plan sí");
    assert.equal(leyoFacturas, 0, "el PDF ni siquiera lee facturas");
  } finally {
    prismaStub.invoice.findMany = original;
  }
  const es = (await import("@/i18n/dictionaries/es.json")).default as any;
  for (const k of ["pagado", "saldo", "notaPagos"]) assert.equal(es.planTratamiento.pdf[k], undefined, `sobra la llave ${k}`);
});

test("t8 v3 N3-P2: plan exacto o viejo lo dice la MARCA que deja la ventana de hoy, no una fecha", async () => {
  const { textoEsExacto } = await import("@/lib/quotes/desde-plan");
  const { MARCA_EXACTO } = await import("@/components/dashboard/plan-tratamiento-rediseno/plan-clinico");
  const deHoy = descripcionDeVentana([reng({ procedimiento: "Resina", precio: "500.50" })]);
  assert.ok(deHoy.includes(`Total de procedimientos:${MARCA_EXACTO}`), "la ventana de hoy deja la marca");
  assert.equal(MARCA_EXACTO, "\u00a0", "un espacio duro: está en WinAnsi (el PDF del expediente lo pinta como espacio)");
  assert.equal(textoEsExacto(deHoy), true);
  // Una pestaña abierta con la ventana de antes que escribe DESPUÉS del despliegue: sin marca → viejo.
  const pestanaVieja = componerDescripcion({ ...PLAN_VACIO, renglones: [reng({ procedimiento: "Resina", precio: "500.50" })] }, rot);
  assert.equal(textoEsExacto(pestanaVieja), false);
  const { armarDocumentoDelPlan } = await import("../plan-pdf");
  assert.deepEqual(armarDocumentoDelPlan({ name: "P", description: pestanaVieja, totalCost: 500.5 }).ajuste, { tipo: "redondeo", monto: -0.5 }, "nunca «Descuento -$0.50»");
  assert.equal(armarDocumentoDelPlan({ name: "P", description: deHoy, totalCost: 500.5 }).ajuste, null);
  assert.equal(textoEsExacto(null), false);
  assert.equal(textoEsExacto("Una frase"), false);
  // La ventana real escribe con la marca (y el rótulo del diccionario, que es el que se reconoce).
  const { readFileSync } = await import("node:fs");
  const ventana = readFileSync("src/components/dashboard/plan-tratamiento-rediseno/ventana-nuevo-plan.tsx", "utf8");
  assert.match(ventana, /total: t\("planTratamiento\.texto\.total"\)/);
  assert.match(ventana, /dinero: \(n: number\) => dineroExacto\(n\)/);
  assert.match(ventana, /exacto: true/);
  // Por la ruta, con la misma pestaña vieja:
  db.plans[0].description = pestanaVieja;
  db.plans[0].totalCost = 500.5;
  const texto = await textoDe(await GET("cmabc123def456ghi789jkl0"));
  assert.ok(tiene(texto, "Redondeo de precios") && !tiene(texto, "Descuento"));
});

test("t8 v3 N3-P7: un plan VIEJO con «$1,000.00» en sus notas o diagnóstico sigue siendo viejo (sin «Descuento -$0.50»)", async () => {
  const { armarDocumentoDelPlan } = await import("../plan-pdf");
  const desc = componerDescripcion(
    { ...PLAN_VACIO, diagnostico: "Caries; anticipo $1,000.00", renglones: [reng({ procedimiento: "Resina", precio: "500.50" })], notas: "Dejó $2,500.50 de anticipo" },
    rot,
  );
  assert.deepEqual(armarDocumentoDelPlan({ name: "P", description: desc, totalCost: 500.5 }).ajuste, { tipo: "redondeo", monto: -0.5 });
});

test("t8 v3 N3-P3: cantidad «0»: la ventana no la deja (vale 1); un «0 ×» de antes sale tal cual ($0) en el PDF, sin «Descuento», y «Convertir» no lo cobra", async () => {
  const { soloEntero, cantidadDe, importeRenglon } = await import("@/components/dashboard/plan-tratamiento-rediseno/plan-clinico");
  assert.equal(soloEntero("0"), "");
  assert.equal(soloEntero("007"), "7");
  assert.equal(soloEntero("10"), "10");
  assert.equal(cantidadDe({ cantidad: "0" }), 1);
  assert.equal(importeRenglon(reng({ cantidad: "0", precio: "500" })), 500);
  assert.match(descripcionDeVentana([reng({ procedimiento: "Resina", cantidad: "0", precio: "500" })]), /1 × \$500 = \$500/, "nunca se escribe «0 ×»");
  // Un texto de antes con «0 ×»:
  const viejo = "▸ Fase I · Higiénica — $800\n• Resina · 0 × $500 = $0\n• Limpieza dental · 1 × $800 = $800\n\n▸ Total de procedimientos: $800";
  const { armarDocumentoDelPlan } = await import("../plan-pdf");
  const d = armarDocumentoDelPlan({ name: "P", description: viejo, totalCost: 800 });
  assert.deepEqual(d.grupos[0].renglones.map((r) => [r.nombre, r.cantidad, r.importe]), [["Resina", 0, 0], ["Limpieza dental", 1, 800]]);
  assert.equal(d.ajuste, null, "sin «Descuento -$500» falso");
  const { armarPresupuestoDePlan } = await import("@/lib/quotes/desde-plan");
  const c = armarPresupuestoDePlan({ name: "P", description: viejo, totalCost: 800 }, []).conceptos[0];
  assert.deepEqual([c.quantity, c.unitPrice, c.notes], [1, 0, "0 × $500"], "«Convertir» no cobra $500 por esa línea");
  db.plans[0].description = viejo;
  db.plans[0].totalCost = 800;
  const texto = await textoDe(await GET("cmabc123def456ghi789jkl0"));
  assert.ok(!tiene(texto, "Descuento") && !tiene(texto, "Ajuste"));
});

test("t8 v3 N3-P4: un plan confirmado en $0 se convierte en $0 (el tarifario no lo rellena) y la vista previa lo avisa", async () => {
  const { armarPresupuestoDePlan } = await import("@/lib/quotes/desde-plan");
  const desc = descripcionDeVentana([reng({ procedimiento: "Limpieza dental" })]);
  const r = armarPresupuestoDePlan({ name: "Garantía", description: desc, totalCost: 0 }, [{ id: "l", name: "Limpieza dental", basePrice: 800 }]);
  assert.deepEqual(r.conceptos.map((c) => [c.unitPrice, c.origen]), [[0, "sinPrecio"]]);
  assert.equal(r.total, 0);
  assert.equal(r.sinPrecio, 1, "la vista previa avisa del concepto en $0");
  // Con costo y sin precios por renglón, sí se costea con el tarifario (como siempre).
  assert.equal(armarPresupuestoDePlan({ name: "P", description: desc, totalCost: 800 }, [{ id: "l", name: "Limpieza dental", basePrice: 800 }]).conceptos[0].unitPrice, 800);
});

test("t8 v3 N3-P6: el aviso de «Convertir» llama cortesía a un concepto en $0, como la ventana del plan", async () => {
  const { readFileSync } = await import("node:fs");
  const texto = readFileSync("src/components/dashboard/plan-a-presupuesto/textos-convertir-presupuesto.ts", "utf8");
  assert.match(texto, /1 concepto va en \$0 \(cortesía\)\. Si no lo es, ponle precio/);
  assert.doesNotMatch(texto, /no tiene precio: complétalo/);
  assert.match(texto, /1 item is at \$0 \(complimentary\)/);
});

test("t8 v3 N3-P8: un precio tecleado con tres decimales («100.004») se redondea a centavos antes del importe: sin «Ajuste +$0.01»", async () => {
  const { importeRenglon, precioDe } = await import("@/components/dashboard/plan-tratamiento-rediseno/plan-clinico");
  const r = reng({ procedimiento: "Resina", cantidad: "3", precio: "100.004" });
  assert.equal(precioDe(r), 100);
  assert.equal(importeRenglon(r), 300);
  const desc = descripcionDeVentana([r]);
  assert.match(desc, /3 × \$100 = \$300/);
  const { armarDocumentoDelPlan } = await import("../plan-pdf");
  assert.equal(armarDocumentoDelPlan({ name: "P", description: desc, totalCost: 300 }).ajuste, null);
  assert.equal(importeRenglon(reng({ cantidad: "3", precio: "100.005" })), 300.03, "medio centavo sube, como siempre");
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
  componerDescripcion({ ...PLAN_VACIO, renglones, ...extra }, rotExacto);

test("muestras: con MUESTRA_DIR=<carpeta> deja los PDF de muestra (datos inventados)", async (t) => {
  const dir = process.env.MUESTRA_DIR;
  if (!dir) return t.skip("sin MUESTRA_DIR");
  const id = "cmabc123def456ghi789jkl0";
  const guardar = async (nombre: string) => writeFileSync(`${dir}/${nombre}.pdf`, Buffer.from(await (await GET(id)).arrayBuffer()));
  await conLogo(async () => {
    // Facturas y cobros del plan, a propósito: el PDF ya NO los imprime (decisión del gerente, t8 vuelta 3).
    db.quotes = [{ id: "q1", clinicId: "c1", treatmentPlanId: id, invoiceId: "f1" }];
    db.invoices = [{ id: "f1", clinicId: "c1", status: "PARTIAL", paid: 3500, total: 10300 }];

    // 1 · Plan de hoy con un descuento tecleado (costo $10,300 frente a $10,800 de procedimientos).
    db.plans[0].totalCost = 10300;
    await guardar("plan-muestra-1-descuento");

    // 2 · Centavos, una cortesía en $0 (en el tarifario a $500) y una cantidad «0» tecleada (se guarda 1).
    db.plans[0].description = descripcionDeVentana([
      reng({ fase: "higienica", procedimiento: "Revisión", motivo: "Control" }),
      reng({ fase: "higienica", procedimiento: "Resina compuesta", dientes: "16", caras: ["O"], cantidad: "3", precio: "500.50", motivo: "Caries" }),
      reng({ fase: "restauradora", procedimiento: "Incrustación de porcelana", dientes: "36", cantidad: soloEntero("0"), precio: "4250.75" }),
    ]);
    db.plans[0].totalCost = 5752.25;
    db.catalogo = [{ id: "rev", name: "Revisión", basePrice: 500 }];
    await guardar("plan-muestra-2-centavos-cortesia");

    // 3 · Plan largo (varias hojas) con nombres con emoji y otros alfabetos.
    db.plans[0].description = descripcionDeVentana(planLargo());
    db.plans[0].totalCost = 38 * 1500;
    db.plans[0].patient = { firstName: "Zoë 🙂", lastName: "Ñañez Иванова", patientNumber: "P-0099" };
    db.plans[0].name = "Rehabilitación con implantes 🦷";
    db.catalogo = [];
    await guardar("plan-muestra-3-largo-emoji");

    // 4 · Plan VIEJO (sin la marca: texto redondeado a pesos): «Redondeo de precios», una cantidad 1.5,
    //     un «0 ×» de antes y nombres con Ł/ễ.
    db.plans[0].description = componerDescripcion(
      { ...PLAN_VACIO, renglones: [
        reng({ fase: "higienica", procedimiento: "Resina", dientes: "16", cantidad: "3", precio: "500.50", motivo: "Caries" }),
        reng({ fase: "higienica", procedimiento: "Blanqueamiento por sesión", cantidad: "1.5", precio: "800" }),
      ] },
      rot,
    ).replace("• Blanqueamiento", "• Sellador · 0 × $350 = $0\n• Blanqueamiento");
    db.plans[0].totalCost = 2701.5;
    db.plans[0].patient = { firstName: "Łukasz", lastName: "Nguyễn", patientNumber: "P-0100" };
    db.plans[0].name = "Rehabilitación";
    await guardar("plan-muestra-4-viejo-redondeo-cantidades");

    // 5 · Plan de hoy, 24 × $1,500 con costo de $35,990: «Descuento -$10», sin pagos aunque haya cobros.
    db.plans[0].description = descripcionDeVentana([reng({ procedimiento: "Mensualidad de ortodoncia", cantidad: "24", precio: "1500" })]);
    db.plans[0].totalCost = 35990;
    db.plans[0].patient = { firstName: "Ana", lastName: "López", patientNumber: "P-0042" };
    db.invoices = [{ id: "f1", clinicId: "c1", status: "PARTIAL", paid: 12000, total: 35990 }];
    await guardar("plan-muestra-5-descuento-sin-pagos");
  });
});

test("textos: es.json y en.json tienen las mismas llaves de planTratamiento.pdf, y en es van con tú", async () => {
  const es = (await import("@/i18n/dictionaries/es.json")).default as any;
  const en = (await import("@/i18n/dictionaries/en.json")).default as any;
  const llaves = Object.keys(es.planTratamiento.pdf).sort();
  assert.deepEqual(Object.keys(en.planTratamiento.pdf).sort(), llaves);
  for (const k of ["boton", "titulo", "firmaPaciente", "total", "redondeo", "pagina", "archivo"]) assert.ok(llaves.includes(k), k);
  assert.doesNotMatch(JSON.stringify(es.planTratamiento.pdf), /\b(intentá|podés|tenés|usted)\b/i);
});
