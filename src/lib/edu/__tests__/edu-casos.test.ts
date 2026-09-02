/**
 * DaleControl INSTITUCIONAL — pruebas de la OLA DE CASOS.
 *
 * Tres frentes, sin base de datos:
 *
 *   1. ANTECEDENTES MÉDICOS (pacientes-core): el TRI-ESTADO que separa
 *      "sin antecedentes registrados" de "se le preguntó y no refiere" —
 *      confundirlos es como se mata a alguien — y el saneo del bloque.
 *   2. LA PANTALLA DE CASOS (casos-core): la columna "qué espera", los
 *      filtros de la URL y el CSV.
 *   3. CANDADOS DE FUENTE (estilo de la auditoría): que el export y los
 *      antecedentes pasen por el guard y por el MISMO camino que la
 *      pantalla — porque ninguno de los cuatro hallazgos graves de la
 *      auditoría habría puesto roja una prueba de lógica pura: lo que
 *      fallaba era quién llamaba a qué.
 *
 * Se corren con: npx tsx --test src/lib/edu/__tests__/*.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EDU_ANTECEDENTES_MAX_ITEMS,
  EDU_BLOOD_TYPES,
  eduAntecedentesChips,
  eduAntecedentesEstado,
  parseEduAntecedentes,
  type EduAntecedentes,
} from "../pacientes-core";
import {
  EDU_CASO_ESPERA_TAG,
  EDU_CASOS_PANEL_EMPTY_FILTERS,
  buildEduCasosCsv,
  eduCasoEsperando,
  eduCasosPanelQuery,
  eduHasCasosPanelFilters,
  parseEduCasosPanelFilters,
  type EduCasosPanelFilters,
  type EduCasosPanelRow,
} from "../casos-core";
import { eduResumenTimeline, type EduResumenTimelineItem } from "../resumen-core";

const RAIZ = join(__dirname, "..", "..", "..", "..");

/** El archivo, sin comentarios: se juzga por lo que hace, no por lo que dice. */
function fuente(...tramos: string[]): string {
  return readFileSync(join(RAIZ, ...tramos), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
}

// ═══════════════════════════════════════════════════════════════════════
// 1 · ANTECEDENTES — el tri-estado
// ═══════════════════════════════════════════════════════════════════════

const VACIO = { allergies: [], chronicConditions: [], currentMedications: [] };

test("antecedentes · listas vacías SIN fecha = SIN_REGISTRAR (nadie preguntó)", () => {
  assert.equal(eduAntecedentesEstado({ ...VACIO, recordedAt: null }), "SIN_REGISTRAR");
});

test("antecedentes · listas vacías CON fecha = NO_REFIERE (se preguntó y no hay)", () => {
  assert.equal(
    eduAntecedentesEstado({ ...VACIO, recordedAt: "2026-08-31T10:00:00.000Z" }),
    "NO_REFIERE",
  );
});

test("antecedentes · los DATOS mandan sobre la fecha: alergias sin fecha NO se esconden tras 'sin registrar'", () => {
  // Una fila con alergias pero sin sello (un import a mano) es CON_DATOS:
  // pintarle "sin antecedentes registrados" escondería la alergia — el
  // único error peor que confundir los otros dos estados.
  assert.equal(
    eduAntecedentesEstado({ ...VACIO, allergies: ["penicilina"], recordedAt: null }),
    "CON_DATOS",
  );
});

function antecedentes(sobre: Partial<EduAntecedentes>): EduAntecedentes {
  return {
    bloodType: null,
    allergies: [],
    chronicConditions: [],
    currentMedications: [],
    emergencyContactName: null,
    emergencyContactPhone: null,
    emergencyContactRelation: null,
    recordedAt: "2026-08-31T10:00:00.000Z",
    recordedByName: "Recepción Uno",
    ...sobre,
  };
}

test("chips · SIN_REGISTRAR es UN chip ámbar con esas palabras exactas — jamás un verde", () => {
  const chips = eduAntecedentesChips(antecedentes({ recordedAt: null, recordedByName: null }));
  assert.equal(chips.length, 1);
  assert.equal(chips[0].kind, "sin-registrar");
  assert.equal(chips[0].tone, "warn");
  assert.equal(chips[0].text, "Sin antecedentes registrados");
});

test("chips · NO_REFIERE es un chip verde que dice 'no refiere' — no 'sin alergias' a secas", () => {
  const chips = eduAntecedentesChips(antecedentes({}));
  const ok = chips.find((c) => c.kind === "no-refiere");
  assert.ok(ok, "falta el chip de revisado");
  assert.equal(ok!.tone, "ok");
  assert.match(ok!.text, /no refiere/i);
  assert.match(ok!.text, /revisado/i);
});

test("chips · las ALERGIAS salen TODAS en rojo, sin tope: la cuarta es justo la que importa", () => {
  const chips = eduAntecedentesChips(
    antecedentes({ allergies: ["penicilina", "látex", "aines", "lidocaína", "sulfas"] }),
  );
  const alergias = chips.filter((c) => c.kind === "alergia");
  assert.equal(alergias.length, 5);
  for (const a of alergias) assert.equal(a.tone, "danger");
  assert.ok(alergias.some((a) => a.text.includes("lidocaína")));
});

test("chips · padecimientos y medicamentos se topan en 3 y el '+N' carga el resto en detail", () => {
  const chips = eduAntecedentesChips(
    antecedentes({ chronicConditions: ["hta", "dm2", "asma", "epoc", "gota"] }),
  );
  const padecimientos = chips.filter((c) => c.kind === "padecimiento");
  assert.equal(padecimientos.length, 3);
  const mas = chips.find((c) => c.kind === "mas");
  assert.ok(mas, "falta el chip +N");
  assert.equal(mas!.text, "+2 padecimientos");
  assert.match(mas!.detail ?? "", /epoc/);
  assert.match(mas!.detail ?? "", /gota/);
});

test("chips · el tipo de sangre sale como chip ('Sangre O+')", () => {
  const chips = eduAntecedentesChips(antecedentes({ bloodType: "O+" }));
  assert.ok(chips.some((c) => c.kind === "sangre" && c.text === "Sangre O+"));
});

// ═══════════════════════════════════════════════════════════════════════
// 2 · ANTECEDENTES — el saneo del bloque
// ═══════════════════════════════════════════════════════════════════════

test("saneo · el texto con comas se parte, se recorta y se DEDUPLICA sin mayúsculas ni acentos", () => {
  const r = parseEduAntecedentes({
    allergies: "Penicilina,  penicilina , PENICILINA, penicilína,, látex ",
  });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.data.allergies, ["Penicilina", "látex"]);
});

test("saneo · también acepta arreglo de strings (y rebota el que no es texto)", () => {
  const bien = parseEduAntecedentes({ chronicConditions: ["hta", " dm2 "] });
  assert.ok(bien.ok);
  if (bien.ok) assert.deepEqual(bien.data.chronicConditions, ["hta", "dm2"]);

  const mal = parseEduAntecedentes({ chronicConditions: ["hta", 7] });
  assert.equal(mal.ok, false);
});

test("saneo · demasiados renglones rebota con su tope, no recorta en silencio", () => {
  const lista = Array.from({ length: EDU_ANTECEDENTES_MAX_ITEMS + 1 }, (_, i) => `item ${i}`);
  const r = parseEduAntecedentes({ currentMedications: lista });
  assert.equal(r.ok, false);
});

test("saneo · el tipo de sangre solo acepta los 8 grupos; '0+' con CERO rebota, 'o+' se normaliza", () => {
  assert.equal(EDU_BLOOD_TYPES.length, 8);

  const cero = parseEduAntecedentes({ bloodType: "0+" });
  assert.equal(cero.ok, false);

  const minuscula = parseEduAntecedentes({ bloodType: "o+" });
  assert.ok(minuscula.ok);
  if (minuscula.ok) assert.equal(minuscula.data.bloodType, "O+");

  const vacio = parseEduAntecedentes({ bloodType: "" });
  assert.ok(vacio.ok);
  if (vacio.ok) assert.equal(vacio.data.bloodType, null);
});

test("saneo · el teléfono de emergencia se normaliza a dígitos, y uno sin números rebota", () => {
  const bien = parseEduAntecedentes({ emergencyContactPhone: "+52 55 4433 2211" });
  assert.ok(bien.ok);
  if (bien.ok) assert.equal(bien.data.emergencyContactPhone, "+525544332211");

  const mal = parseEduAntecedentes({ emergencyContactPhone: "sin números" });
  assert.equal(mal.ok, false);
});

test("saneo · TODO vacío es un guardado VÁLIDO: así se registra 'no refiere'", () => {
  const r = parseEduAntecedentes({});
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.data.allergies, []);
    assert.deepEqual(r.data.chronicConditions, []);
    assert.deepEqual(r.data.currentMedications, []);
    assert.equal(r.data.bloodType, null);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 3 · LA PANTALLA DE CASOS — qué espera el caso
// ═══════════════════════════════════════════════════════════════════════

test("espera · un caso cerrado no espera nada", () => {
  for (const st of ["COMPLETED", "TRANSFERRED", "ABANDONED"] as const) {
    const e = eduCasoEsperando(st, [{ stage: "PLAN", status: "PENDING" }]);
    assert.equal(e.kind, "cerrado");
  }
});

test("espera · una PENDING gana a todo y nombra la etapa; con varias, la del flujo primero y '+N'", () => {
  const e = eduCasoEsperando("IN_TREATMENT", [
    { stage: "DISCHARGE", status: "PENDING" },
    { stage: "PLAN", status: "PENDING" },
  ]);
  assert.equal(e.kind, "firma");
  // PLAN va antes que DISCHARGE en el flujo aunque el arreglo venga al revés.
  assert.match(e.label, /plan de tratamiento/i);
  assert.match(e.label, /\+1/);
});

test("espera · ASSIGNED sin nada mandado = 'falta mandar el plan' (la fila que dirección busca)", () => {
  const e = eduCasoEsperando("ASSIGNED", []);
  assert.equal(e.kind, "falta");
  assert.match(e.label, /plan/i);
});

test("espera · ASSIGNED con el plan FIRMADO = puede pasar a tratamiento", () => {
  const e = eduCasoEsperando("ASSIGNED", [{ stage: "PLAN", status: "APPROVED" }]);
  assert.equal(e.kind, "listo");
  assert.match(e.label, /tratamiento/i);
});

test("espera · EN TRATAMIENTO sin alta firmada no 'debe' nada; con alta firmada, puede cerrarse", () => {
  const sin = eduCasoEsperando("IN_TREATMENT", [{ stage: "PLAN", status: "APPROVED" }]);
  assert.equal(sin.kind, "nada");

  const con = eduCasoEsperando("IN_TREATMENT", [{ stage: "DISCHARGE", status: "APPROVED" }]);
  assert.equal(con.kind, "listo");
  assert.match(con.label, /cerrar/i);
});

test("espera · un rechazo o un vencido NO cuentan como firmado", () => {
  const e = eduCasoEsperando("ASSIGNED", [
    { stage: "PLAN", status: "REJECTED" },
    { stage: "PLAN", status: "EXPIRED" },
  ]);
  assert.equal(e.kind, "falta");
});

test("espera · cada kind tiene su tag y su etiqueta legible", () => {
  for (const kind of ["firma", "listo", "falta", "nada", "cerrado"] as const) {
    assert.ok(EDU_CASO_ESPERA_TAG[kind], `falta el tag de ${kind}`);
    assert.match(EDU_CASO_ESPERA_TAG[kind], /^edu-tag--/);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 4 · LA PANTALLA DE CASOS — los filtros de la URL
// ═══════════════════════════════════════════════════════════════════════

test("filtros · lee lo suyo y descarta la basura (estado inventado, id con símbolos, fecha rota)", () => {
  const f = parseEduCasosPanelFilters({
    estado: "IN_TREATMENT",
    especialidad: "prog_1",
    alumno: "st_1",
    docente: "u_doc",
    desde: "2026-08-01",
    hasta: "2026-08-31",
    q: "  maría lópez  ",
    cerrados: "1",
    // basura:
    institutionId: "otra_escuela",
  });
  assert.equal(f.status, "IN_TREATMENT");
  assert.equal(f.programId, "prog_1");
  assert.equal(f.studentId, "st_1");
  assert.equal(f.supervisorUserId, "u_doc");
  assert.equal(f.desdeISO, "2026-08-01");
  assert.equal(f.hastaISO, "2026-08-31");
  assert.equal(f.q, "maría lópez");
  assert.equal(f.incluirCerrados, true);
  // 🔴 El tenant NO es un filtro: no existe ningún campo que lo acepte.
  assert.ok(!("institutionId" in f));

  const basura = parseEduCasosPanelFilters({
    estado: "INVENTADO",
    especialidad: "id con espacios",
    desde: "31/08/2026",
  });
  assert.deepEqual(basura, EDU_CASOS_PANEL_EMPTY_FILTERS);
});

test("filtros · un rango al revés se descarta entero en vez de consultar un imposible", () => {
  const f = parseEduCasosPanelFilters({ desde: "2026-09-01", hasta: "2026-08-01" });
  assert.equal(f.desdeISO, null);
  assert.equal(f.hastaISO, null);
});

test("filtros · la query string va y viene sin perder nada (el enlace del export ES la pantalla)", () => {
  const f: EduCasosPanelFilters = {
    status: "ON_HOLD",
    programId: "p1",
    studentId: "s1",
    supervisorUserId: "d1",
    incluirCerrados: true,
    desdeISO: "2026-01-15",
    hastaISO: "2026-02-15",
    q: "A-0012",
  };
  const qs = eduCasosPanelQuery(f);
  const sp: Record<string, string> = {};
  // forEach y no for..of: el target de este tsconfig no itera URLSearchParams.
  new URLSearchParams(qs).forEach((v, k) => {
    sp[k] = v;
  });
  assert.deepEqual(parseEduCasosPanelFilters(sp), f);

  assert.equal(eduCasosPanelQuery(EDU_CASOS_PANEL_EMPTY_FILTERS), "");
  assert.equal(eduHasCasosPanelFilters(EDU_CASOS_PANEL_EMPTY_FILTERS), false);
  assert.equal(eduHasCasosPanelFilters(f), true);
});

// ═══════════════════════════════════════════════════════════════════════
// 5 · LA PANTALLA DE CASOS — el CSV
// ═══════════════════════════════════════════════════════════════════════

function fila(sobre: Partial<EduCasosPanelRow>): EduCasosPanelRow {
  return {
    id: "caso_1",
    status: "IN_TREATMENT",
    statusLabel: "En tratamiento",
    patientId: "pac_1",
    patientName: "María López",
    patientFolio: "P-0001",
    studentId: "st_1",
    studentName: "Alumno Uno",
    studentMatricula: "A-001",
    supervisorName: "Dra. Vega",
    programName: "Endodoncia",
    cohortName: "2026-A",
    semester: 3,
    openedISO: "2026-08-01",
    openedLabel: "sáb 1 ago",
    closedLabel: null,
    espera: { kind: "nada", label: "En tratamiento, nada pendiente" },
    ...sobre,
  };
}

test("csv · BOM para Excel, encabezado, y la fila con folio, generación y qué espera", () => {
  const csv = buildEduCasosCsv([fila({})]);
  assert.ok(csv.startsWith("﻿"), "sin BOM, Excel en Windows lee mojibake");
  const lineas = csv.replace("﻿", "").trim().split("\r\n");
  assert.equal(lineas.length, 2);
  assert.match(lineas[0], /"Generación"/);
  assert.match(lineas[0], /"Esperando"/);
  assert.match(lineas[1], /"P-0001"/);
  assert.match(lineas[1], /"2026-A"/);
  assert.match(lineas[1], /"En tratamiento, nada pendiente"/);
});

test("csv · un nombre que empieza con '=' sale desarmado (anti fórmula) y las comillas se escapan", () => {
  const csv = buildEduCasosCsv([
    fila({ patientName: '=SUM(A1:A9)', studentName: 'El "Güero" Pérez' }),
  ]);
  assert.match(csv, /"'=SUM\(A1:A9\)"/);
  assert.match(csv, /"El ""Güero"" Pérez"/);
});

test("csv · sin responsable designado lo DICE, no deja la celda vacía", () => {
  const csv = buildEduCasosCsv([fila({ supervisorName: null })]);
  assert.match(csv, /"Sin responsable designado"/);
});

// ═══════════════════════════════════════════════════════════════════════
// 6 · EL RESUMEN — la línea de tiempo
// ═══════════════════════════════════════════════════════════════════════

test("timeline · ordena del más reciente al más viejo, recorta y NO muta la entrada", () => {
  const items: EduResumenTimelineItem[] = [
    { kind: "nota", atISO: "2026-08-01T10:00:00.000Z", whenLabel: "a", title: "vieja", who: "x" },
    { kind: "receta", atISO: "2026-08-30T10:00:00.000Z", whenLabel: "b", title: "nueva", who: "y" },
    { kind: "estudio", atISO: "2026-08-15T10:00:00.000Z", whenLabel: "c", title: "media", who: "z" },
  ];
  const copia = [...items];
  const out = eduResumenTimeline(items, 2);
  assert.deepEqual(
    out.map((i) => i.title),
    ["nueva", "media"],
  );
  assert.deepEqual(items, copia, "eduResumenTimeline mutó su entrada");
});

// ═══════════════════════════════════════════════════════════════════════
// 7 · CANDADOS DE FUENTE — quién llama a qué
//     (la lección de la auditoría: las 516 pruebas pasaban y los cuatro
//     agujeros estaban en la capa que CONSUME los módulos, no en ellos.)
// ═══════════════════════════════════════════════════════════════════════

test("fuente · el export de casos pasa por el guard y por los MISMOS filtros que la pantalla", () => {
  const src = fuente("src", "app", "api", "instituto", "casos", "export", "route.ts");
  assert.match(src, /eduApiGuard\("casos\.view"\)/);
  assert.match(src, /parseEduCasosPanelFilters/);
  // Lee por el camino del EXPORT (su propio techo, en lotes), no por el de
  // la pantalla. Lo que NO cambia: el guard y los filtros son los mismos.
  assert.match(src, /listEduCasosParaExport/);
  assert.doesNotMatch(
    src,
    /await listEduCasosPanel\(/,
    "el export volvió al tope de PANTALLA: con eso, marcar 'incluir cerrados' devuelve 413",
  );
});

test("🔴 fuente · el export tiene SU tope, más alto que el de la pantalla, y sigue negando por encima", () => {
  const core = fuente("src", "lib", "edu", "casos-core.ts");
  assert.match(core, /export const EDU_CASOS_EXPORT_MAX_ROWS = (\d+);/);
  const tope = Number(/EDU_CASOS_EXPORT_MAX_ROWS = (\d+)/.exec(core)?.[1]);
  const pantalla = Number(
    /EDU_CLINICA_MAX_ROWS = (\d+)/.exec(fuente("src", "lib", "edu", "agenda-core.ts"))?.[1],
  );
  assert.ok(Number.isFinite(tope) && Number.isFinite(pantalla));
  assert.ok(
    tope > pantalla * 10,
    `el tope del export (${tope}) tiene que ser MUY superior al de la pantalla (${pantalla}): ` +
      "si no, un export de una acreditación vuelve a caber en una pantalla",
  );

  // Y la regla que NO cambia: por encima de ese tope, 413.
  const route = fuente("src", "app", "api", "instituto", "casos", "export", "route.ts");
  assert.match(route, /if \(page\.truncated\)/);
  assert.match(route, /status: 413/);
  assert.match(
    route,
    /EDU_CASOS_EXPORT_MAX_ROWS/,
    "el 413 tiene que decir CUÁNTOS caben, no solo que hay más",
  );
});

test("🔴 fuente · el export lee EN LOTES y con un orden TOTAL (si no, el cursor duplica o pierde)", () => {
  const src = fuente("src", "lib", "edu", "casos.ts");
  const desde = src.indexOf("export async function listEduCasosParaExport");
  assert.notEqual(desde, -1, "¿renombraron listEduCasosParaExport?");
  const cuerpo = src.slice(desde);

  assert.match(cuerpo, /EDU_CASOS_EXPORT_BATCH/, "el export tiene que leer por lotes");
  assert.match(cuerpo, /cursor: \{ id: cursor \}/, "la paginación va por cursor de id");
  assert.match(cuerpo, /skip: 1/, "sin skip:1 el cursor repite la última fila de cada lote");

  // El desempate por id es lo que hace el orden TOTAL. Sin él, dos casos
  // abiertos en el mismo instante pueden salir en dos lotes o en ninguno.
  const orden = /const CASOS_PANEL_ORDER[\s\S]*?\];/.exec(src)?.[0] ?? "";
  assert.match(orden, /openedAt: "desc"/);
  assert.match(orden, /id: "desc"/, "el orden del export empata sin el desempate por id");
});

test("fuente · la lista y el export comparten where, orden y select — no hay segunda consulta", () => {
  const src = fuente("src", "lib", "edu", "casos.ts");
  for (const fn of ["listEduCasosPanel", "listEduCasosParaExport"]) {
    const desde = src.indexOf(`export async function ${fn}`);
    assert.notEqual(desde, -1, `¿renombraron ${fn}?`);
    const cuerpo = src.slice(desde, desde + 2000);
    assert.match(cuerpo, /eduCasosPanelWhere\(/, `${fn} armó su propio where`);
    assert.match(cuerpo, /CASOS_PANEL_ORDER/, `${fn} armó su propio orden`);
    assert.match(cuerpo, /CASOS_PANEL_SELECT/, `${fn} armó su propio select`);
  }
});

test("fuente · el PATCH de antecedentes exige una de las DOS llaves, además del guard base", () => {
  const src = fuente(
    "src",
    "app",
    "api",
    "instituto",
    "pacientes",
    "[id]",
    "antecedentes",
    "route.ts",
  );
  assert.match(src, /eduApiGuard\("pacientes\.view"\)/);
  assert.match(src, /hasEduPermission\(permUser, "pacientes\.manage"\)/);
  assert.match(src, /hasEduPermission\(permUser, "expediente\.write"\)/);
  assert.match(src, /updateEduPatientAntecedentes/);
});

test("fuente · updateEduPatientAntecedentes busca DENTRO del alcance y estampa fecha y autor JUNTOS", () => {
  const src = fuente("src", "lib", "edu", "pacientes.ts");
  const desde = src.indexOf("export async function updateEduPatientAntecedentes");
  assert.notEqual(desde, -1, "¿renombraron updateEduPatientAntecedentes?");
  const cuerpo = src.slice(desde);
  assert.match(cuerpo, /eduPatientScopeWhere/);
  assert.match(cuerpo, /historyRecordedAt: now/);
  assert.match(cuerpo, /historyRecordedById: ctx\.eduUserId/);
});

test("fuente · la lista Y el export recortan con eduCaseScopeWhere, como todo el vertical", () => {
  const src = fuente("src", "lib", "edu", "casos.ts");

  // El recorte vive en el where COMPARTIDO...
  const where = src.indexOf("function eduCasosPanelWhere");
  assert.notEqual(where, -1, "¿renombraron eduCasosPanelWhere?");
  assert.match(src.slice(where, where + 1500), /eduCaseScopeWhere/);

  // ...y las dos puertas comprueban el alcance vacío ANTES de consultar.
  // El export es una puerta nueva: sin esta prueba, una lectura sin
  // `eduScopeIsEmpty` le entregaría a CAJA un CSV de la clínica entera.
  for (const fn of ["listEduCasosPanel", "listEduCasosParaExport"]) {
    const desde = src.indexOf(`export async function ${fn}`);
    assert.notEqual(desde, -1, `¿renombraron ${fn}?`);
    const cuerpo = src.slice(desde, desde + 1200);
    assert.match(cuerpo, /eduVisibility\(ctx, "cases"\)/, `${fn} no pide el alcance`);
    assert.match(cuerpo, /eduScopeIsEmpty\(scope\)/, `${fn} no corta con alcance vacío`);
  }
});

test("fuente · la pantalla /instituto/casos exige el permiso y niega a caja con palabras", () => {
  const src = fuente("src", "app", "instituto", "(panel)", "casos", "page.tsx");
  assert.match(src, /hasEduPermission\(permUser, "casos\.view"\)/);
  assert.match(src, /eduVisibility\(ctx, "cases"\)/);
  assert.match(src, /EDU_VISIBILITY_NONE_DETAIL\.cases/);
});

test("fuente · el item de menú de casos existe, con su etiqueta y su permiso reusado", () => {
  const src = fuente("src", "lib", "edu", "types.ts");
  assert.match(src, /key: "casos",\s*\n\s*href: "\/instituto\/casos"/);
  assert.match(src, /casos: "Casos"/);
});
