/**
 * Hallazgo del odontograma → procedimiento sugerido del tarifario (ws1-t5, pieza A) y la
 * lista única de condiciones que comparten el plan y el cobro de «Completar consulta» (pieza C).
 *
 * Run: npm run test:plan-sugerencias
 */
import "../../sabina/engine-sin-server-only"; // PRIMERO: snapshot.ts importa "server-only"
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONDITIONS } from "../../../components/dashboard/odontogram-v2/data";
import {
  FASES, HALLAZGO_FASE, hallazgosPorTratar, importeRenglon,
} from "../../../components/dashboard/plan-tratamiento-rediseno/plan-clinico";
import {
  CONDICIONES_CLINICAS, ORDEN_FASE, PROCEDIMIENTOS, carasDelNombre, claveDeProcedimiento, cobrosAlMarcar,
  elegirDelTarifario, fasesDeHallazgos, raicesDelNombre, sugerenciaARenglon, sugerirPlan, sugerirProcedimiento,
  type ClaveProcedimiento, type ProcedimientoTarifario,
} from "../sugerir-procedimiento";
import { conditionToTreatmentCode } from "../../odontogram/snapshot";

const SRC = join(__dirname, "..", "..", "..");

// ── Tarifarios de mentira ──────────────────────────────────────────────────

let n = 0;
const p = (name: string, basePrice: number, duration: number | null = null, extra: Partial<ProcedimientoTarifario> = {}): ProcedimientoTarifario =>
  ({ id: `p${++n}`, name, basePrice, duration, category: "dental", code: null, isActive: true, ...extra });

/** El que siembra `GET /api/procedures` a una clínica dental nueva (sin llaves ODO_*). */
const FABRICA: ProcedimientoTarifario[] = [
  p("Profilaxis (limpieza)", 600, 30), p("Tartrectomía", 900, 45), p("Consulta general", 400, 30),
  p("Extracción simple", 800, 30), p("Extracción quirúrgica", 2500, 60),
  p("Restauración resina 1 cara", 700, 30), p("Restauración resina 2 caras", 900, 45), p("Restauración resina 3 caras", 1200, 60),
  p("Amalgama", 600, 30), p("Corona porcelana", 6500, 60), p("Corona metal-porcelana", 4500, 60), p("Corona de zirconio", 9000, 60),
  p("Endodoncia unirradicular", 2500, 60), p("Endodoncia birradicular", 3500, 90), p("Endodoncia multirradicular", 4500, 120),
  p("Implante dental", 18000, 90), p("Carilla dental", 5500, 60), p("Blanqueamiento", 3500, 90),
  p("Periodoncia (curetaje)", 2500, 60), p("Cirugía periodontal", 6000, 90), p("Férula oclusal", 2800, 45),
  p("Radiografía periapical", 200, 10),
];

/** Las 8 filas con llave del odontograma (`ensureDentalCatalog`). */
const ODO: ProcedimientoTarifario[] = [
  p("Diagnóstico de caries", 0, null, { code: "ODO_CARIES_DIAG" }),
  p("Restauración con resina", 1500, 45, { code: "ODO_RESINA" }),
  p("Corona dental", 4500, 60, { code: "ODO_CORONA" }),
  p("Endodoncia", 4000, 90, { code: "ODO_ENDODONCIA" }),
  p("Implante dental", 18000, 120, { code: "ODO_IMPLANTE" }),
  p("Extracción dental", 1200, 30, { code: "ODO_EXTRACCION" }),
  p("Limpieza profilaxis", 800, 30, { code: "ODO_LIMPIEZA" }),
  p("Blanqueamiento", 3500, 60, { code: "ODO_BLANQUEAMIENTO" }),
];

const una = (h: { diente: number; caras?: string[]; conditionId: string }, tarifario: ProcedimientoTarifario[], entradas: { toothNumber: number; conditionId: string }[] = []) =>
  sugerirProcedimiento({ caras: [], ...h }, tarifario, entradas);

// ═══════════════════════════════════════════════════════════════════════════
// C · La lista única
// ═══════════════════════════════════════════════════════════════════════════

test("la lista cubre EXACTAMENTE las condiciones del odontograma (47), sin una de más", () => {
  const ids = CONDITIONS.map((c) => c.id).sort();
  assert.equal(ids.length, 47);
  assert.deepEqual(Object.keys(CONDICIONES_CLINICAS).sort(), ids);
});

test("cada condición o sugiere algo o declara por qué no; lo que se sugiere existe", () => {
  for (const [id, c] of Object.entries(CONDICIONES_CLINICAS)) {
    if (c.sugiere) {
      assert.ok(c.fase, `${id}: sugiere sin fase`);
      assert.equal(c.sinTratamiento, undefined, `${id}: sugiere y dice que no se trata`);
      assert.ok(PROCEDIMIENTOS[c.sugiere], `${id}: ${c.sugiere} no es un procedimiento`);
    } else {
      assert.equal(c.fase, null, `${id}: fase sin sugerencia`);
      assert.ok(c.sinTratamiento, `${id}: sin sugerencia y sin motivo`);
    }
    for (const e of c.encadena ?? []) assert.ok(PROCEDIMIENTOS[e], `${id}: encadena ${e}`);
  }
  // Las que no llevan tratamiento, declaradas por grupo.
  const sin = (m: string) => Object.entries(CONDICIONES_CLINICAS).filter(([, c]) => c.sinTratamiento === m).map(([id]) => id).sort();
  assert.deepEqual(sin("dato_clinico"), ["displaced", "pigmentation", "rotated", "unerupted"]);
  assert.deepEqual(sin("ortodoncia"), ["band", "bracket", "diastema", "migration"]);
  assert.equal(sin("trabajo_hecho").length, 19);
});

test("el plan sigue viendo los MISMOS hallazgos por tratar con las MISMAS fases que antes de unificar", () => {
  const antes = {
    pulpitis: "urgencia", fracture: "urgencia", caries: "higienica", caries_inc: "higienica", necrosis: "higienica",
    periapical1: "higienica", periapical2: "higienica", periapical3: "higienica", ext_indicated: "higienica",
    root_remnant: "higienica", temp_rest: "higienica", calculus: "higienica", pocket: "higienica", bleeding: "higienica",
    impacted: "correctiva", recession: "correctiva", furcation: "correctiva", mobility: "correctiva",
    perio_mobility: "correctiva", missing: "restauradora",
  };
  assert.deepEqual(fasesDeHallazgos(), antes);
  assert.deepEqual(HALLAZGO_FASE, antes);
});

test("«Completar consulta» sigue cobrando lo MISMO: ni una condición más ni una menos", () => {
  const antes = {
    restoration: "ODO_RESINA", crown: "ODO_CORONA", rct: "ODO_ENDODONCIA",
    implant: "ODO_IMPLANTE", missing: "ODO_EXTRACCION", ext_done: "ODO_EXTRACCION",
  };
  assert.deepEqual(cobrosAlMarcar(), antes);
  for (const c of CONDITIONS) assert.equal(conditionToTreatmentCode(c.id), antes[c.id as keyof typeof antes] ?? null, c.id);
  assert.equal(conditionToTreatmentCode("no_existe"), null);
});

test("«Ausente» queda dicho en UN sitio: hueco por reponer para el plan, extracción para el cobro de siempre", () => {
  const m = CONDICIONES_CLINICAS.missing;
  assert.equal(m.fase, "restauradora");
  assert.equal(m.sugiere, "implante");
  assert.equal(m.revisar, true);
  assert.equal(m.cobroAlMarcar, "ODO_EXTRACCION");
  // Las dos listas viejas ya no existen como literales.
  const snap = readFileSync(join(SRC, "lib/odontogram/snapshot.ts"), "utf8");
  const plan = readFileSync(join(SRC, "components/dashboard/plan-tratamiento-rediseno/plan-clinico.ts"), "utf8");
  assert.match(snap, /CONDITION_TREATMENT_CODE: Record<string, string> = cobrosAlMarcar\(\)/);
  assert.match(plan, /HALLAZGO_FASE: Record<string, Fase> = fasesDeHallazgos\(\)/);
  assert.doesNotMatch(snap, /missing: "ODO_EXTRACCION"/);
});

test("las llaves ODO_* que se buscan existen en el catálogo sembrado; el orden de fases es el del plan", () => {
  const snap = readFileSync(join(SRC, "lib/odontogram/snapshot.ts"), "utf8");
  for (const [clave, proc] of Object.entries(PROCEDIMIENTOS)) {
    if (proc.codigo) assert.ok(snap.includes(`code: "${proc.codigo}"`), `${clave}: ${proc.codigo} no está en DENTAL_CATALOG_SEED`);
  }
  assert.deepEqual(Object.entries(ORDEN_FASE).sort((a, b) => a[1] - b[1]).map(([f]) => f), [...FASES]);
});

// ═══════════════════════════════════════════════════════════════════════════
// A · Un hallazgo → su sugerencia
// ═══════════════════════════════════════════════════════════════════════════

test("caries → resina por número de caras, con precio y minutos del tarifario", () => {
  const dos = una({ diente: 16, caras: ["M", "O"], conditionId: "caries" }, FABRICA);
  assert.equal(dos.sinTratamiento, null);
  assert.equal(dos.sugerencias.length, 1);
  const s = dos.sugerencias[0];
  assert.deepEqual([s.clave, s.nombre, s.precio, s.minutos, s.fase, s.caras.join(""), s.elegir, s.revisar],
    ["resina", "Restauración resina 2 caras", 900, 45, "higienica", "MO", false, false]);
  assert.deepEqual(s.origen, ["16:caries"]);

  const una1 = una({ diente: 16, caras: ["O"], conditionId: "caries" }, FABRICA).sugerencias[0];
  assert.equal(una1.nombre, "Restauración resina 1 cara");
  const tres = una({ diente: 16, caras: ["M", "O", "D"], conditionId: "caries" }, FABRICA).sugerencias[0];
  assert.equal(tres.nombre, "Restauración resina 3 caras");
  // Cuatro caras y el tarifario llega a tres: la de tres, para revisar.
  const cuatro = una({ diente: 16, caras: ["M", "O", "D", "V"], conditionId: "caries" }, FABRICA).sugerencias[0];
  assert.deepEqual([cuatro.nombre, cuatro.revisar], ["Restauración resina 3 caras", true]);
  // Incisal de un anterior («I» en pantalla) cuenta como la «O» de la base.
  const incisal = una({ diente: 11, caras: ["I", "M"], conditionId: "caries" }, FABRICA).sugerencias[0];
  assert.deepEqual([incisal.caras.join(""), incisal.nombre], ["MO", "Restauración resina 2 caras"]);
});

test("caries sin variantes por caras: la resina con llave ODO_RESINA de la clínica", () => {
  const s = una({ diente: 26, caras: ["O"], conditionId: "caries" }, ODO).sugerencias[0];
  assert.deepEqual([s.nombre, s.precio, s.procedimientoId, s.revisar], ["Restauración con resina", 1500, ODO[1].id, false]);
  // Con variantes Y llave, mandan las variantes (la resina «por número de caras»).
  const ambos = una({ diente: 26, caras: ["O", "M"], conditionId: "caries" }, [...ODO, ...FABRICA]).sugerencias[0];
  assert.equal(ambos.nombre, "Restauración resina 2 caras");
});

test("pulpitis → endodoncia por raíces del diente, en urgencia, y sugiere corona después", () => {
  const r = una({ diente: 46, conditionId: "pulpitis" }, FABRICA).sugerencias;
  assert.deepEqual(r.map((s) => [s.clave, s.fase, s.nombre, s.encadenadaDe]), [
    ["endodoncia", "urgencia", "Endodoncia multirradicular", null],
    ["corona", "restauradora", "Corona porcelana", "endodoncia"],
  ]);
  assert.equal(r[0].precio, 4500);
  // Tres coronas posibles: se elige la de nombre más corto y se marca para revisar con las otras dos.
  assert.equal(r[1].revisar, true);
  assert.equal(r[1].alternativas.length, 2);
  assert.equal(una({ diente: 11, conditionId: "pulpitis" }, FABRICA).sugerencias[0].nombre, "Endodoncia unirradicular");
  assert.equal(una({ diente: 14, conditionId: "pulpitis" }, FABRICA).sugerencias[0].nombre, "Endodoncia birradicular");
  assert.equal(una({ diente: 35, conditionId: "pulpitis" }, FABRICA).sugerencias[0].nombre, "Endodoncia unirradicular");
  // Con las llaves ODO_*: la corona de la clínica, sin revisar.
  const odo = una({ diente: 46, conditionId: "pulpitis" }, ODO).sugerencias;
  assert.deepEqual(odo.map((s) => [s.nombre, s.precio, s.revisar]), [["Endodoncia", 4000, false], ["Corona dental", 4500, false]]);
});

test("necrosis o lesión periapical en un diente con conducto → retratamiento; con corona no se encadena otra", () => {
  const ent = [{ toothNumber: 36, conditionId: "rct" }, { toothNumber: 36, conditionId: "crown" }];
  const r = una({ diente: 36, conditionId: "periapical2" }, FABRICA, ent).sugerencias;
  assert.equal(r.length, 1);
  // El tarifario de fábrica no tiene retratamiento: NO cae a la endodoncia (saldría más barato), se pide elegir.
  assert.deepEqual([r[0].clave, r[0].elegir, r[0].precio, r[0].nombre], ["retratamiento", true, null, "Retratamiento de conductos"]);
  const con = una({ diente: 36, conditionId: "necrosis" }, [...FABRICA, p("Retratamiento de conductos molar", 5500, 120)], ent).sugerencias;
  assert.deepEqual([con[0].nombre, con[0].precio, con[0].elegir], ["Retratamiento de conductos molar", 5500, false]);
  // Pulpitis en un diente con conducto no es un retratamiento (no tiene pulpa): sigue siendo endodoncia.
  assert.equal(una({ diente: 36, conditionId: "pulpitis" }, FABRICA, ent).sugerencias[0].clave, "endodoncia");
});

test("diente temporal: pulpotomía o pulpectomía y corona de acero; sin ellas en el tarifario, se pide elegir", () => {
  const r = una({ diente: 85, conditionId: "pulpitis" }, FABRICA).sugerencias;
  assert.deepEqual(r.map((s) => [s.clave, s.elegir, s.precio]), [["pulpotomia", true, null], ["corona_acero", true, null]]);
  const ped = [...FABRICA, p("Pulpotomía", 1200, 45), p("Pulpectomía", 1500, 60), p("Corona de acero cromo", 1400, 30)];
  assert.deepEqual(una({ diente: 74, conditionId: "necrosis" }, ped).sugerencias.map((s) => [s.nombre, s.precio]),
    [["Pulpectomía", 1500], ["Corona de acero cromo", 1400]]);
});

test("extracción indicada → extracción simple; impactado → quirúrgica; resto radicular → extracción", () => {
  const ext = una({ diente: 38, conditionId: "ext_indicated" }, FABRICA).sugerencias[0];
  assert.deepEqual([ext.nombre, ext.precio, ext.fase], ["Extracción simple", 800, "higienica"]);
  const imp = una({ diente: 48, conditionId: "impacted" }, FABRICA).sugerencias[0];
  assert.deepEqual([imp.nombre, imp.precio, imp.fase], ["Extracción quirúrgica", 2500, "correctiva"]);
  assert.equal(una({ diente: 24, conditionId: "root_remnant" }, ODO).sugerencias[0].nombre, "Extracción dental");
  // Sin quirúrgica en el tarifario: no se ofrece la simple en su lugar.
  const sinQx = una({ diente: 48, conditionId: "impacted" }, ODO).sugerencias[0];
  assert.deepEqual([sinQx.elegir, sinQx.precio], [true, null]);
});

test("cálculo → limpieza (de la clínica, por nombre o por llave)", () => {
  const bevadent = [p("Limpieza dental", 700, 40), p("Consulta", 300)];
  assert.deepEqual(una({ diente: 31, caras: ["L"], conditionId: "calculus" }, bevadent).sugerencias.map((s) => [s.nombre, s.precio, s.revisar]),
    [["Limpieza dental", 700, false]]);
  assert.equal(una({ diente: 31, conditionId: "calculus" }, ODO).sugerencias[0].nombre, "Limpieza profilaxis");
  // Fábrica: profilaxis y tartrectomía, las dos son limpieza → una, para revisar.
  const fab = una({ diente: 31, conditionId: "calculus" }, FABRICA).sugerencias[0];
  assert.equal(fab.revisar, true);
  assert.equal(fab.alternativas.length, 1);
});

test("ausente → implante para revisar, en fase restauradora", () => {
  const s = una({ diente: 36, conditionId: "missing" }, FABRICA).sugerencias[0];
  assert.deepEqual([s.clave, s.nombre, s.precio, s.minutos, s.fase, s.revisar], ["implante", "Implante dental", 18000, 90, "restauradora", true]);
});

test("lo que no se trata lo dice, y no inventa sugerencias", () => {
  assert.deepEqual(una({ diente: 11, conditionId: "rotated" }, FABRICA), { sinTratamiento: "dato_clinico", sugerencias: [] });
  assert.deepEqual(una({ diente: 11, conditionId: "crown" }, FABRICA), { sinTratamiento: "trabajo_hecho", sugerencias: [] });
  assert.deepEqual(una({ diente: 11, conditionId: "bracket" }, FABRICA), { sinTratamiento: "ortodoncia", sugerencias: [] });
  assert.deepEqual(una({ diente: 11, conditionId: "no_existe" }, FABRICA), { sinTratamiento: "desconocida", sugerencias: [] });
});

test("cada hallazgo por tratar de las 47 da al menos una sugerencia, con o sin tarifario", () => {
  for (const [id, c] of Object.entries(CONDICIONES_CLINICAS)) {
    if (!c.fase) continue;
    for (const tarifario of [[], FABRICA, ODO]) {
      const r = una({ diente: 16, caras: ["O"], conditionId: id }, tarifario);
      assert.ok(r.sugerencias.length >= 1, id);
      for (const s of r.sugerencias) {
        assert.equal(s.elegir, s.procedimientoId === null, id);
        assert.equal(s.precio === null, s.elegir, id);
        assert.ok(s.nombre.trim(), id);
      }
    }
  }
});

test("sin tarifario: la sugerencia sale sin precio, con su nombre, y marcada para elegir", () => {
  const s = una({ diente: 16, caras: ["O"], conditionId: "caries" }, []).sugerencias[0];
  assert.deepEqual([s.elegir, s.precio, s.minutos, s.procedimientoId, s.nombre, s.nombreSugerido.en],
    [true, null, null, null, "Restauración con resina", "Composite restoration"]);
});

test("un procedimiento desactivado del tarifario no se sugiere", () => {
  const t = [p("Restauración resina 1 cara", 700, 30, { isActive: false }), p("Resina", 650, 30)];
  assert.equal(una({ diente: 16, caras: ["O"], conditionId: "caries" }, t).sugerencias[0].nombre, "Resina");
  const odoApagada = ODO.map((x) => (x.code === "ODO_LIMPIEZA" ? { ...x, isActive: false } : x));
  assert.equal(una({ diente: 16, conditionId: "calculus" }, odoApagada).sugerencias[0].elegir, true);
});

// ═══════════════════════════════════════════════════════════════════════════
// A · Todos los hallazgos → el plan propuesto
// ═══════════════════════════════════════════════════════════════════════════

test("un plan típico de 5 hallazgos sale ordenado por fase, sin repetir y con su total", () => {
  const entradas = [
    { toothNumber: 46, surface: null, conditionId: "pulpitis" },
    { toothNumber: 46, surface: null, conditionId: "periapical2" },  // mismo diente: una sola endodoncia
    { toothNumber: 16, surface: "M", conditionId: "caries" },
    { toothNumber: 16, surface: "O", conditionId: "caries" },
    { toothNumber: 16, surface: "D", conditionId: "temp_rest" },    // mismo diente: una resina de 3 caras
    { toothNumber: 38, surface: null, conditionId: "ext_indicated" },
    { toothNumber: 31, surface: "L", conditionId: "calculus" },
    { toothNumber: 41, surface: "L", conditionId: "calculus" },     // una sola limpieza para la boca
    { toothNumber: 26, surface: null, conditionId: "crown" },       // trabajo hecho: no sale
  ];
  const plan = sugerirPlan(hallazgosPorTratar(entradas), FABRICA, entradas);
  assert.deepEqual(plan.map((s) => [s.fase, s.clave, s.dientes.join(","), s.caras.join(""), s.nombre]), [
    ["urgencia", "endodoncia", "46", "", "Endodoncia multirradicular"],
    ["higienica", "resina", "16", "MOD", "Restauración resina 3 caras"],
    ["higienica", "limpieza", "31,41", "", "Tartrectomía"],
    ["higienica", "extraccion", "38", "", "Extracción simple"],
    ["restauradora", "corona", "46", "", "Corona porcelana"],
  ]);
  assert.deepEqual(plan[0].origen, ["46:pulpitis", "46:periapical2"]);
  assert.deepEqual(plan[1].origen, ["16:caries", "16:temp_rest"]);
  const total = plan.reduce((a, s) => a + (s.precio ?? 0) * s.cantidad, 0);
  assert.equal(total, 4500 + 1200 + 900 + 800 + 6500);
});

test("raspado: uno por cuadrante", () => {
  const plan = sugerirPlan([
    { diente: 16, caras: [], conditionId: "pocket" },
    { diente: 17, caras: [], conditionId: "pocket" },
    { diente: 26, caras: [], conditionId: "pocket" },
  ], FABRICA);
  assert.deepEqual(plan.map((s) => [s.clave, s.dientes.join(","), s.nombre]), [
    ["raspado", "16,17", "Periodoncia (curetaje)"],
    ["raspado", "26", "Periodoncia (curetaje)"],
  ]);
});

test("una corona encadenada que coincide con una pedida por el hallazgo deja de ser encadenada", () => {
  const plan = sugerirPlan([
    { diente: 21, caras: [], conditionId: "fracture" },   // → resina (revisar)
    { diente: 21, caras: [], conditionId: "pulpitis" },   // → endodoncia + corona
  ], ODO);
  assert.deepEqual(plan.map((s) => [s.fase, s.clave, s.encadenadaDe]), [
    ["urgencia", "resina", null],
    ["urgencia", "endodoncia", null],
    ["restauradora", "corona", "endodoncia"],
  ]);
});

test("la sugerencia entra como renglón de la ventana de hoy y su importe es el del tarifario", () => {
  const [s] = una({ diente: 16, caras: ["M", "O"], conditionId: "caries" }, FABRICA).sugerencias;
  const r = sugerenciaARenglon(s, { id: "r1", motivo: "Caries" });
  assert.deepEqual(r, {
    id: "r1", fase: "higienica", procedimiento: "Restauración resina 2 caras", procedimientoId: s.procedimientoId,
    dientes: "16", caras: ["M", "O"], motivo: "Caries", cantidad: "1", precio: "900", precioDelTarifario: true, minutos: 45,
    origen: ["16:caries"], clave: "resina", revisar: false,
  });
  assert.equal(importeRenglon(r), 900);
  const [sin] = una({ diente: 16, caras: ["O"], conditionId: "caries" }, []).sugerencias;
  const r2 = sugerenciaARenglon(sin, { id: "r2", motivo: "Caries", idioma: "en" });
  assert.deepEqual([r2.procedimiento, r2.procedimientoId, r2.precio, r2.precioDelTarifario], ["Composite restoration", null, "", false]);
});

// ═══════════════════════════════════════════════════════════════════════════
// Las piezas de lectura del tarifario
// ═══════════════════════════════════════════════════════════════════════════

test("cuántas caras y qué raíces dice un nombre", () => {
  assert.equal(carasDelNombre("Restauración resina 2 caras"), 2);
  assert.equal(carasDelNombre("Resina de una cara"), 1);
  assert.equal(carasDelNombre("Resina TRES CARAS"), 3);
  assert.equal(carasDelNombre("Resina compuesta"), 2);
  assert.equal(carasDelNombre("Resina"), null);
  assert.equal(raicesDelNombre("Endodoncia premolar"), "bi");
  assert.equal(raicesDelNombre("Endodoncia molar"), "multi");
  assert.equal(raicesDelNombre("Endodoncia unirradicular"), "uni");
  assert.equal(raicesDelNombre("Endodoncia"), null);
});

test("elegirDelTarifario sin nada que se parezca: null, sin alternativas", () => {
  assert.deepEqual(elegirDelTarifario("injerto_gingival", FABRICA), { item: null, revisar: false, alternativas: [] });
  // «Injerto óseo» no es un injerto de encía; «Férula oclusal» no es ferulizar.
  assert.equal(elegirDelTarifario("injerto_gingival", [p("Injerto óseo", 8000)]).item, null);
  assert.equal(elegirDelTarifario("ferulizacion", [p("Férula oclusal", 2800)]).item, null);
  // «Alargamiento de corona» no es una corona; «Corona sobre implante» no es un implante.
  assert.equal(elegirDelTarifario("corona", [p("Alargamiento de corona", 3000)]).item, null);
  assert.equal(elegirDelTarifario("implante", [p("Corona sobre implante", 9000)]).item, null);
});

test("qué procedimiento es, por llave o por nombre", () => {
  const casos: [string | null, string, ClaveProcedimiento | null][] = [
    ["ODO_RESINA", "", "resina"], ["ODO_EXTRACCION", "", "extraccion"], ["ODO_BLANQUEAMIENTO", "Blanqueamiento", null],
    [null, "Restauración resina 2 caras", "resina"], [null, "Amalgama", "resina"],
    [null, "Endodoncia multirradicular", "endodoncia"], [null, "Tratamiento de conductos", "endodoncia"],
    [null, "Retratamiento de conductos", "retratamiento"], [null, "Pulpotomía", "pulpotomia"],
    [null, "Corona metal-porcelana", "corona"], [null, "Corona de acero cromo", "corona_acero"],
    [null, "Corona sobre implante", "corona"], [null, "Implante dental", "implante"],
    [null, "Extracción simple", "extraccion"], [null, "Extracción quirúrgica", "extraccion_quirurgica"],
    [null, "Extracción de tercer molar", "extraccion_quirurgica"], [null, "Profilaxis (limpieza)", "limpieza"],
    [null, "Tartrectomía", "limpieza"], [null, "Limpieza profunda", "raspado"], [null, "Periodoncia (curetaje)", "raspado"],
    [null, "Sellador de fosetas", "sellante"], [null, "Aplicación de flúor", "fluor"], [null, "Carilla dental", "carilla"],
    [null, "Perno colado", "perno"], [null, "Incrustación de porcelana", "incrustacion"], [null, "Apicectomía", "apicectomia"],
    [null, "Consulta general", null], [null, "Radiografía periapical", null], [null, "Férula oclusal", null],
    [null, "Cirugía periodontal", null], [null, "", null],
  ];
  for (const [codigo, nombre, esperado] of casos) assert.equal(claveDeProcedimiento({ codigo, nombre }), esperado, `${codigo} ${nombre}`);
});
