/**
 * CANDADOS DE LAS VENTANAS DEL PLAN DE TRATAMIENTO (ws1-t2).
 *
 * Run: npx tsx --test src/components/dashboard/plan-tratamiento-rediseno/__tests__/plan-tratamiento-rediseno.test.ts
 *
 * Dos clases de candado, como en `hoy-rediseno`: los que leen el código fuente
 * (sin letra de máquina, sin tokens propios, el camino viejo vivo, nada que
 * escriba por su cuenta) y los de la lógica pura de `plan-clinico.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  PLAN_VACIO, alternarDiente, avisosDeOrden, componerDescripcion, esDescripcionDePlan, esFdi,
  hallazgosPorTratar, importeRenglon, leerDientes, letraCentro, sesionesSugeridas, subtotalesPorFase,
  totalProcedimientos, type Renglon, type Rotulos,
} from "../plan-clinico";

const SRC = join(__dirname, "..", "..", "..", "..");           // src/
const CARPETA = join(SRC, "components", "dashboard", "plan-tratamiento-rediseno");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const archivosNuevos = readdirSync(CARPETA)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => ({ nombre: f, texto: readFileSync(join(CARPETA, f), "utf8") }));

// ═══════════════════════════════════════════════════════════════════════════
// Lenguaje visual: Instrument Sans en el 100 % y ni un token propio
// ═══════════════════════════════════════════════════════════════════════════
// La palabra prohibida se arma en trozos para que un grep sobre la carpeta no
// se tope con este archivo.
const LETRA_DE_MAQUINA = new RegExp(["font-", "mono", "|", "ui-", "mono", "space", "|", "mono", "space"].join(""));

test("sin letra de máquina en la carpeta", () => {
  for (const a of archivosNuevos) {
    assert.ok(!LETRA_DE_MAQUINA.test(a.texto), `${a.nombre} usa letra de máquina; las cifras van con tabular-nums`);
  }
  const css = archivosNuevos.find((a) => a.nombre === "plan.module.css")!.texto;
  assert.match(css, /font-variant-numeric:\s*tabular-nums/, "las cifras se alinean con tabular-nums");
});

test("plan.module.css no declara variables propias ni copia colores a mano", () => {
  const css = archivosNuevos.find((a) => a.nombre === "plan.module.css")!.texto;
  const declaraciones = css.match(/^\s*--[a-z0-9-]+\s*:/gim) ?? [];
  assert.deepEqual(declaraciones, [], `declara tokens propios: ${declaraciones.join(", ")}`);
  assert.match(css, /var\(--m2-/, "lee los tokens del menú");
  // Un color escrito a mano solo vale como RESPALDO dentro de un var(--…, #xxxxxx).
  const sueltos = css.split("\n").filter((l) => /#[0-9a-f]{3,8}\b/i.test(l) && !/var\(--[a-z0-9-]+,[^)]*#[0-9a-f]{3,8}/i.test(l));
  assert.deepEqual(sueltos, [], `colores a mano: ${sueltos.join(" | ")}`);
  for (const f of ["ventana-nuevo-plan.tsx", "ventanas-plan.tsx"]) {
    assert.match(leer(`components/dashboard/plan-tratamiento-rediseno/${f}`), /CLASES_MENU/, `${f} monta CLASES_MENU`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Toda clave i18n existe en español y en inglés
// ═══════════════════════════════════════════════════════════════════════════
test("todas las claves del plan existen en es.json y en.json", () => {
  const claves = new Set<string>();
  for (const a of archivosNuevos) {
    for (const m of a.texto.matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"/g)) claves.add(m[1]);
    for (const m of a.texto.matchAll(/"((?:planTratamiento|patients)\.[a-zA-Z0-9_.]+)"/g)) claves.add(m[1]);
  }
  // Las que se arman con plantilla: caras y avisos de orden.
  for (const c of ["M", "O", "I", "D", "V", "L"]) claves.add(`planTratamiento.cara.${c}`);
  for (const a of ["endoAntesDeCorona", "cicatrizacionAntesDeImplante"]) claves.add(`planTratamiento.aviso.${a}`);
  for (const k of ["titulo", "nuevo", "vacio", "crearPrimero"]) claves.add(`planTratamiento.lista.${k}`);
  assert.ok(claves.size > 50, "se esperaban decenas de claves");

  for (const idioma of ["es", "en"]) {
    const dict = JSON.parse(leer(`i18n/dictionaries/${idioma}.json`)) as Record<string, unknown>;
    const existe = (clave: string): boolean => {
      let nodo: unknown = dict;
      for (const parte of clave.split(".")) {
        if (!nodo || typeof nodo !== "object" || !(parte in (nodo as object))) return false;
        nodo = (nodo as Record<string, unknown>)[parte];
      }
      return true;
    };
    const faltan = [...claves].filter((k) => !existe(k));
    assert.deepEqual(faltan, [], `${idioma}.json: claves sin traducción: ${faltan.join(", ")}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Se llama «Plan de tratamiento»… solo con la bandera
// ═══════════════════════════════════════════════════════════════════════════
test("el camino nuevo dice «plan de tratamiento»; los textos de siempre no se tocaron", () => {
  const es = JSON.parse(leer("i18n/dictionaries/es.json"));
  assert.equal(es.planTratamiento.nuevo.titulo, "Nuevo plan de tratamiento");
  assert.equal(es.planTratamiento.nuevo.crear, "Crear plan de tratamiento");
  assert.equal(es.planTratamiento.lista.nuevo, "Nuevo plan de tratamiento");
  // Lo que pinta la clínica SIN bandera sigue diciendo lo de hoy, letra por letra.
  assert.equal(es.patients.treatment.newTreatment, "+ Nuevo tratamiento");
  assert.equal(es.patients.treatment.modalTitle, "Nuevo tratamiento para {name}");
  assert.equal(es.patients.treatment.createBtn, "Crear tratamiento");
  assert.equal(es.patients.treatment.title, "Tratamientos del paciente");

  const lista = leer("components/dashboard/expediente-rediseno/plan-tratamiento.tsx");
  assert.ok(!/patients\.treatment\.(newTreatment|title|empty|createFirst)"/.test(lista), "la lista nueva sigue diciendo «tratamiento»");
});

// ═══════════════════════════════════════════════════════════════════════════
// El camino viejo sigue vivo, y el nuevo solo se monta con la bandera
// ═══════════════════════════════════════════════════════════════════════════
test("patient-detail-client conserva las tres ventanas de siempre y elige con `rediseno`", () => {
  const ficha = leer("app/dashboard/patients/[id]/patient-detail-client.tsx");
  for (const viejo of ["patients.treatment.modalTitle", "patients.treatment.createBtn", "patients.treatment.viewTitle", "patients.treatment.editTitle"]) {
    assert.ok(ficha.includes(`t("${viejo}"`), `la ventana de siempre perdió ${viejo}`);
  }
  assert.match(ficha, /showNewTreatment && \(rediseno \? \(\s*<VentanaNuevoPlan/, "la ventana nueva no va detrás de la bandera");
  assert.match(ficha, /if \(rediseno\) \{\s*return \(\s*<VentanaVerPlan/, "«ver plan» no va detrás de la bandera");
  assert.match(ficha, /editPlan && \(rediseno \? \(\s*<VentanaEditarPlan/, "«editar plan» no va detrás de la bandera");
  // Un solo sitio guarda, el de siempre: la ventana nueva le pasa el formulario.
  assert.match(ficha, /onCrear=\{handleCreateTreatment\}/);
  assert.match(ficha, /onGuardar=\{handleUpdatePlan\}/);
  assert.equal((ficha.match(/fetch\("\/api\/treatments"/g) ?? []).length, 1, "apareció un segundo POST de planes");
});

// ═══════════════════════════════════════════════════════════════════════════
// ⛔ El seguimiento por WhatsApp no se toca
// ═══════════════════════════════════════════════════════════════════════════
test("la carpeta nueva no escribe nada: solo LEE tarifario y odontograma", () => {
  for (const a of archivosNuevos.filter((x) => x.nombre.endsWith(".tsx"))) {
    assert.ok(!/method\s*:/.test(a.texto), `${a.nombre} hace una petición que no es GET`);
    assert.ok(!/fetch\(\s*["'`]\/api\/treatments/.test(a.texto), `${a.nombre} llama a /api/treatments: guardar es cosa del padre`);
  }
  // Lo que alimenta al cron sigue saliendo de los mismos campos y del mismo sitio.
  const api = leer("app/api/treatments/route.ts");
  assert.match(api, /const \{ patientId, doctorId, name, description, totalSessions, sessionIntervalDays, totalCost \} = body;/);
  assert.match(api, /nextExpectedDate = new Date\(startDate\.getTime\(\) \+ interval \* 24 \* 60 \* 60 \* 1000\)/);
});

// ═══════════════════════════════════════════════════════════════════════════
// Lógica pura
// ═══════════════════════════════════════════════════════════════════════════
const renglon = (p: Partial<Renglon>): Renglon => ({
  id: Math.random().toString(36).slice(2), fase: "higienica", procedimiento: "", procedimientoId: null,
  dientes: "", caras: [], motivo: "", cantidad: "1", precio: "", precioDelTarifario: false, minutos: 0, ...p,
});

const ROTULOS: Rotulos = {
  diagnostico: "Diagnóstico", pronostico: "Pronóstico", total: "Total", alternativa: "Alternativa", notas: "Notas", por: "por:",
  fase: (f) => `F:${f}`, pronosticoValor: (p) => `P:${p}`, dinero: (n) => `$${n.toFixed(2)}`,
};

test("dientes FDI: se leen, se validan y se alternan", () => {
  assert.ok(esFdi(11) && esFdi(48) && esFdi(55) && esFdi(85));
  assert.ok(!esFdi(19) && !esFdi(49) && !esFdi(56) && !esFdi(91) && !esFdi(0) && !esFdi(16.5));
  assert.deepEqual(leerDientes("16, 26 y 99; 16"), { dientes: [16, 26], invalidos: ["99"] });
  assert.deepEqual(leerDientes(""), { dientes: [], invalidos: [] });
  assert.equal(alternarDiente("16, 26", 26), "16");
  assert.equal(alternarDiente("16", 11), "16, 11");
  assert.equal(letraCentro([11, 23]), "I");
  assert.equal(letraCentro([11, 16]), "O");
  assert.equal(letraCentro([]), "O");
});

test("cuentas: importe, subtotales en orden de fase, total y sesiones", () => {
  const rs = [
    renglon({ fase: "restauradora", procedimiento: "Corona", dientes: "16", precio: "6500", minutos: 60 }),
    renglon({ fase: "higienica", procedimiento: "Resina 2 caras", dientes: "26", caras: ["O", "M"], cantidad: "2", precio: "900", minutos: 45 }),
    renglon({ fase: "higienica", procedimiento: "", precio: "500" }), // sin procedimiento no cuenta
  ];
  assert.equal(importeRenglon(rs[1]), 1800);
  assert.deepEqual(subtotalesPorFase(rs).map((f) => [f.fase, f.subtotal]), [["higienica", 1800], ["restauradora", 6500]]);
  assert.equal(totalProcedimientos(rs), 8300);
  // higiénica: 2 × 45 = 90 min → 2 citas; restauradora: 60 min → 1 cita.
  assert.equal(sesionesSugeridas(rs), 3);
  assert.equal(sesionesSugeridas([]), 0);
  assert.equal(importeRenglon(renglon({ procedimiento: "x", cantidad: "-3", precio: "abc" })), 0);
});

test("avisa cuando la corona va antes que la endodoncia, y del implante sin cicatrización", () => {
  const mal = [
    renglon({ fase: "higienica", procedimiento: "Corona de zirconio", dientes: "16" }),
    renglon({ fase: "restauradora", procedimiento: "Endodoncia multirradicular", dientes: "16" }),
    renglon({ fase: "correctiva", procedimiento: "Extracción simple", dientes: "36" }),
    renglon({ fase: "correctiva", procedimiento: "Implante dental", dientes: "36" }),
  ];
  assert.deepEqual(avisosDeOrden(mal).map((a) => `${a.tipo}:${a.diente}`).sort(), ["cicatrizacionAntesDeImplante:36", "endoAntesDeCorona:16"]);
  const bien = [
    renglon({ fase: "higienica", procedimiento: "Endodoncia", dientes: "16" }),
    renglon({ fase: "restauradora", procedimiento: "Corona", dientes: "16" }),
    renglon({ fase: "higienica", procedimiento: "Extracción", dientes: "36" }),
    renglon({ fase: "correctiva", procedimiento: "Implante", dientes: "36" }),
    renglon({ fase: "higienica", procedimiento: "Corona", dientes: "46" }), // otro diente: no aplica
  ];
  assert.deepEqual(avisosDeOrden(bien), []);
});

test("quien usa el plan como hoy guarda EXACTAMENTE lo de hoy", () => {
  assert.equal(componerDescripcion(PLAN_VACIO, ROTULOS), "");
  assert.equal(componerDescripcion({ ...PLAN_VACIO, notas: "  Revisar en 6 meses " }, ROTULOS), "Revisar en 6 meses");
  assert.ok(!esDescripcionDePlan("Revisar en 6 meses"));
  assert.ok(!esDescripcionDePlan(null));
});

test("el plan clínico se escribe como texto ordenado por fase", () => {
  const texto = componerDescripcion({
    diagnostico: "Caries múltiple",
    pronostico: "reservado",
    alternativa: "Puente fijo",
    notas: "Paciente ansioso",
    renglones: [
      renglon({ fase: "restauradora", procedimiento: "Corona", dientes: "16", precio: "6500" }),
      renglon({ fase: "higienica", procedimiento: "Resina", dientes: "11", caras: ["M", "O"], cantidad: "1", precio: "900", motivo: "Caries" }),
    ],
  }, ROTULOS);
  assert.ok(esDescripcionDePlan(texto));
  assert.equal(texto, [
    "▸ Diagnóstico: Caries múltiple\n▸ Pronóstico: P:reservado",
    "▸ F:higienica — $900.00\n• Resina — 11 (MI) · 1 × $900.00 = $900.00 · por: Caries",
    "▸ F:restauradora — $6500.00\n• Corona — 16 · 1 × $6500.00 = $6500.00",
    "▸ Total: $7400.00",
    "▸ Alternativa: Puente fijo",
    "▸ Notas: Paciente ansioso",
  ].join("\n\n"));
});

test("del odontograma salen los hallazgos por tratar, con sus caras juntas", () => {
  const hs = hallazgosPorTratar([
    { toothNumber: 16, surface: "O", conditionId: "caries" },
    { toothNumber: 16, surface: "M", conditionId: "caries" },
    { toothNumber: 26, surface: null, conditionId: "crown" },     // trabajo hecho: no es un problema
    { toothNumber: 36, surface: null, conditionId: "missing" },
    { toothNumber: 46, surface: null, conditionId: "pulpitis" },
    { toothNumber: 99, surface: null, conditionId: "caries" },    // diente que no existe
  ]);
  assert.deepEqual(hs.map((h) => [h.diente, h.conditionId, h.fase, h.caras.join("")]), [
    [46, "pulpitis", "urgencia", ""],
    [16, "caries", "higienica", "OM"],
    [36, "missing", "restauradora", ""],
  ]);
  // Cada id que se da por «problema» existe en el catálogo del odontograma.
  const catalogo = leer("components/dashboard/odontogram-v2/data.ts");
  const clinico = leer("components/dashboard/plan-tratamiento-rediseno/plan-clinico.ts");
  const bloque = clinico.slice(clinico.indexOf("export const HALLAZGO_FASE"), clinico.indexOf("export interface EntradaOdontograma"));
  for (const m of bloque.matchAll(/^\s{2}([a-z0-9_]+):/gm)) {
    assert.ok(catalogo.includes(`C("${m[1]}"`), `${m[1]} no existe en odontogram-v2/data.ts`);
  }
});
