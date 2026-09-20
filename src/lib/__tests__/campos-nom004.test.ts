/**
 * Los cuatro campos que la NOM-004 pide y no capturábamos (WS1-T5).
 *
 * Run: npm run test:campos-nom004
 *
 * Lo que fija, en el orden en que importa:
 *
 *  1. Un cuestionario VIEJO —sin las secciones nuevas— se abre y se guarda
 *     igual, byte a byte. Es el caso de los que ya están en la base.
 *  2. Lo que se guarda se vuelve a leer idéntico, incluidas las casillas sin
 *     marcar: las que no se tocaron no aparecen ni antes ni después.
 *  3. El pronóstico usa los MISMOS tres valores del plan de tratamiento, y la
 *     nota los toma de ahí en vez de redeclararlos.
 *  4. Una nota firmada no se puede editar por la puerta nueva: los campos
 *     nuevos viven dentro del <fieldset disabled> y el guardado sigue cortando
 *     antes con `isLocked`.
 *  5. Vacío se guarda como vacío: ni un `false` de una casilla desmarcada, ni
 *     un «sin alteraciones» que nadie miró.
 *  6. Los nombres de los campos son EXACTAMENTE los que fijó el gerente: el
 *     PDF del expediente (ws1-t4) construye contra estos mismos.
 *  7. Toda clave i18n que nombra el catálogo existe en español y en inglés.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  APARATOS_SISTEMAS,
  EXPLORACION_FISICA,
  GRUPO_APARATOS_SISTEMAS,
  GRUPO_HEREDO_FAMILIARES,
  HEREDO_FAMILIARES,
  QUESTIONNAIRE_GROUPS,
  computeRiskFlags,
  deriveSyncArrays,
  grupoValores,
  normalizeAnswers,
  normalizeExploracionFisica,
  normalizePronostico,
  ponerEnGrupo,
  type Answers,
} from "@/lib/health-questionnaire";
import { PRONOSTICOS, PRONOSTICO_CLAVE } from "@/components/dashboard/plan-tratamiento-rediseno/plan-clinico";

const RAIZ = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

/** Un cuestionario tal como lo dejó el panel ANTES de esta tarea. */
const VIEJO: Answers = {
  diabetes: true,
  diabetesDetail: "Tipo 2, controlada con metformina",
  hypertension: false,
  allergyPenicillin: true,
  allergyOther: false,
  smoking: false,
  currentMedications: "Metformina 850 mg",
  treatingDoctorName: "Dra. Robles",
  chiefComplaint: "Dolor en molar inferior derecho",
  painLevel: 6,
  bleedingGums: true,
};

// ═══ 1 · Un cuestionario viejo entra y sale igual ═════════════════════

test("un cuestionario viejo, sin las secciones nuevas, se guarda idéntico", () => {
  const antes = JSON.parse(JSON.stringify(VIEJO));
  const despues = normalizeAnswers(VIEJO);
  assert.deepEqual(despues, antes, "la normalización tocó algo del cuestionario de siempre");
  assert.equal(JSON.stringify(despues), JSON.stringify(antes), "cambió el orden de las claves");
  // Y el objeto original no se muta: la pantalla sigue con lo suyo.
  assert.deepEqual(VIEJO, antes);
});

test("un cuestionario viejo no estrena secciones vacías al normalizarse", () => {
  const d = normalizeAnswers(VIEJO);
  assert.equal("heredoFamiliares" in d, false);
  assert.equal("aparatosSistemas" in d, false);
  assert.deepEqual(grupoValores(d, GRUPO_HEREDO_FAMILIARES), {});
  assert.deepEqual(grupoValores(d, GRUPO_APARATOS_SISTEMAS), {});
});

test("las banderas de riesgo y el merge a la ficha no cambian con las secciones nuevas", () => {
  const conNuevas = normalizeAnswers({
    ...VIEJO,
    heredoFamiliares: { diabetes: true, cancer: true },
    aparatosSistemas: { cardiovascular: true },
  });
  // Lo heredo-familiar es de los PADRES: no es un padecimiento del paciente y
  // no puede encender una bandera ni colarse en sus padecimientos crónicos.
  assert.deepEqual(computeRiskFlags(conNuevas), computeRiskFlags(VIEJO));
  assert.deepEqual(deriveSyncArrays(conNuevas), deriveSyncArrays(VIEJO));
});

// ═══ 2 · Ida y vuelta, con las casillas sin marcar ════════════════════

test("lo que se guarda se vuelve a leer idéntico, incluidas las casillas sin marcar", () => {
  let a: Answers = { ...VIEJO };
  a = ponerEnGrupo(a, GRUPO_HEREDO_FAMILIARES, "diabetes", true);
  a = ponerEnGrupo(a, GRUPO_HEREDO_FAMILIARES, "cancer", true);
  a = ponerEnGrupo(a, GRUPO_HEREDO_FAMILIARES, "otros", "Padre finado por EVC");
  a = ponerEnGrupo(a, GRUPO_APARATOS_SISTEMAS, "respiratorio", true);

  const guardado = normalizeAnswers(a);
  // Las casillas que nadie tocó no están: ni `true`, ni `false`, ni la clave.
  assert.deepEqual(guardado.heredoFamiliares, {
    diabetes: true,
    cancer: true,
    otros: "Padre finado por EVC",
  });
  assert.deepEqual(guardado.aparatosSistemas, { respiratorio: true });
  assert.equal("hipertension" in guardado.heredoFamiliares, false);
  assert.equal("digestivo" in guardado.aparatosSistemas, false);

  // Ida y vuelta por JSON (que es lo que hace la columna) y renormalizar:
  // punto fijo, no hay deriva entre una versión y la siguiente.
  const releido = JSON.parse(JSON.stringify(guardado));
  assert.deepEqual(normalizeAnswers(releido), guardado);
  assert.equal(JSON.stringify(normalizeAnswers(releido)), JSON.stringify(guardado));
});

test("desmarcar una casilla la BORRA, y vaciar la sección la borra entera", () => {
  let a: Answers = ponerEnGrupo({ ...VIEJO }, GRUPO_HEREDO_FAMILIARES, "diabetes", true);
  assert.deepEqual(a.heredoFamiliares, { diabetes: true });

  a = ponerEnGrupo(a, GRUPO_HEREDO_FAMILIARES, "diabetes", false);
  assert.equal("heredoFamiliares" in a, false, "la sección vacía tiene que desaparecer");
  // Y el resto del cuestionario sigue intacto.
  assert.deepEqual(a, VIEJO);
});

test("el texto libre en blanco no deja rastro AL GUARDAR", () => {
  // Vaciar el campo borra la sección al momento…
  assert.deepEqual(ponerEnGrupo({}, GRUPO_APARATOS_SISTEMAS, "notas", ""), {});
  // …pero un espacio suelto SÍ se puede teclear: si se borrara la clave al
  // vuelo, el campo controlado volvería a "" y no se podría empezar por
  // espacio. Lo que se recorta es lo que se guarda.
  const conEspacio = ponerEnGrupo({}, GRUPO_APARATOS_SISTEMAS, "notas", "   ");
  assert.deepEqual(conEspacio, { aparatosSistemas: { notas: "   " } });
  assert.deepEqual(normalizeAnswers(conEspacio), {});

  assert.deepEqual(
    ponerEnGrupo({}, GRUPO_APARATOS_SISTEMAS, "notas", "Refiere disnea"),
    { aparatosSistemas: { notas: "Refiere disnea" } },
  );
});

test("la normalización descarta lo que no es del catálogo y lo que no es `true`", () => {
  const sucio: Answers = {
    heredoFamiliares: { diabetes: true, hipertension: false, inventada: true, otros: "  " },
    aparatosSistemas: { cardiovascular: "sí", nervioso: true, notas: "  vigilar  " },
  };
  const limpio = normalizeAnswers(sucio);
  assert.deepEqual(limpio.heredoFamiliares, { diabetes: true });
  assert.deepEqual(limpio.aparatosSistemas, { nervioso: true, notas: "vigilar" });
});

test("una sección que llega rota (null, array, texto) no tumba el guardado", () => {
  [null, undefined, [], "texto", 7].forEach((basura) => {
    const limpio = normalizeAnswers({ heredoFamiliares: basura as any, diabetes: true });
    assert.equal("heredoFamiliares" in limpio, false);
    assert.equal(limpio.diabetes, true);
  });
  assert.deepEqual(normalizeAnswers(null as any), {});
  assert.deepEqual(normalizeAnswers([] as any), {});
});

// ═══ 3 · El pronóstico es el del plan de tratamiento ══════════════════

test("el pronóstico acepta EXACTAMENTE los valores del plan de tratamiento", () => {
  assert.deepEqual([...PRONOSTICOS], ["bueno", "reservado", "malo"]);
  PRONOSTICOS.forEach((p) => {
    assert.equal(normalizePronostico(p, PRONOSTICOS), p);
    assert.equal(typeof PRONOSTICO_CLAVE[p], "string", `sin texto traducido: ${p}`);
  });
  // Cualquier otra cosa es "sin definir", nunca un valor inventado.
  ["", "  ", "regular", "BUENO", "malísimo", null, 3, {}].forEach((raro) => {
    assert.equal(normalizePronostico(raro as any, PRONOSTICOS), "", `coló: ${String(raro)}`);
  });
  // «bueno » con espacios sí se recorta y vale: es un copiar-pegar, no un valor nuevo.
  assert.equal(normalizePronostico(" bueno ", PRONOSTICOS), "bueno");
});

test("la nota TOMA el léxico del plan, no lo redeclara", () => {
  const src = leer("src/components/clinical/dental-form.tsx");
  assert.match(
    src,
    /import\s*\{[^}]*PRONOSTICOS[^}]*\}\s*from\s*"@\/components\/dashboard\/plan-tratamiento-rediseno\/plan-clinico"/s,
    "dental-form no importa PRONOSTICOS del plan de tratamiento",
  );
  assert.ok(
    !/const\s+PRONOSTICOS\s*=/.test(src),
    "dental-form declara su propia lista de pronósticos",
  );
  // Ni los tres textos a mano: salen de PRONOSTICO_CLAVE + i18n.
  assert.ok(src.indexOf("PRONOSTICO_CLAVE[p]") !== -1, "los textos del pronóstico no salen del plan");
  // Y el contrato compartido RECIBE la lista en vez de llevarla dentro: en
  // `health-questionnaire.ts` los tres valores solo aparecen documentados.
  const lib = leer("src/lib/health-questionnaire.ts");
  assert.ok(!/PRONOSTICOS\s*[:=]/.test(lib), "el contrato declara su propia lista de pronósticos");
  assert.match(
    lib,
    /export function normalizePronostico\(raw: any, permitidos: readonly string\[\]\)/,
    "normalizePronostico dejó de recibir la lista de valores",
  );
});

// ═══ 4 · Una nota firmada sigue siendo inalterable ════════════════════

test("los campos nuevos de la nota viven DENTRO del fieldset que se apaga al firmar", () => {
  const src = leer("src/components/clinical/dental-form.tsx");
  // El <fieldset> de verdad, no la palabra dentro del comentario que lo explica.
  const apertura = /<fieldset\s+disabled=\{isLocked\}/.exec(src);
  assert.ok(apertura, "el fieldset de la nota ya no se apaga al firmar");
  const abre = apertura.index;
  const cierra = src.indexOf("</fieldset>");
  assert.ok(cierra > abre, "no se encontró el cierre del fieldset");

  ["dental-ef-", 'id="dental-pronostico"'].forEach((marca) => {
    const donde = src.indexOf(marca);
    assert.ok(donde > 0, `no se encontró el campo nuevo: ${marca}`);
    assert.ok(donde > abre && donde < cierra, `el campo nuevo ${marca} quedó FUERA del fieldset`);
  });
});

test("en una nota FIRMADA la exploración se abre sola: si no, queda ilegible", () => {
  // El <fieldset disabled> apaga TODOS los controles que cuelgan de él, y el
  // botón de desplegar es uno. Plegada + firmada = lo capturado no se puede
  // leer en pantalla, con un chip verde prometiendo que está ahí.
  const src = leer("src/components/clinical/dental-form.tsx");
  assert.match(
    src,
    /const \[exploracionOpen, setExploracionOpen\] = useState\(\s*\(\) => isLocked && Object\.keys\(initExploracion\)\.length > 0,?\s*\);/,
    "la exploración de una nota firmada con contenido no arranca abierta",
  );
});

test("ninguna sección plegable de la nota queda ILEGIBLE al firmar", () => {
  // El gemelo del caso de arriba: los signos vitales tenían el mismo defecto.
  // Se arregló en la misma línea y va declarado como desviación en el reporte.
  const src = leer("src/components/clinical/dental-form.tsx");
  const abre = /<fieldset\s+disabled=\{isLocked\}/.exec(src)!.index;
  const cierra = src.indexOf("</fieldset>");
  const cuerpo = src.slice(abre, cierra);

  // Toda sección que se despliega con un botón DENTRO del fieldset (y que por
  // tanto queda inerte al firmar) tiene que nacer abierta si la nota está
  // firmada y hay algo que leer. `rxOpen` no cuenta: es un modal, no una
  // sección plegable.
  const togglesDentro = (cuerpo.match(/set(\w+)Open\(\w+ => !\w+\)/g) ?? [])
    .map((m) => /set(\w+)Open/.exec(m)![1]);
  assert.ok(
    togglesDentro.length >= 2,
    `se esperaban al menos dos secciones plegables dentro del fieldset, hay ${togglesDentro.length}`,
  );
  togglesDentro.forEach((nombre) => {
    // El nombre del estado va en minúscula inicial (`vitalsOpen`) y el del
    // setter en mayúscula (`setVitalsOpen`): se ancla en el setter.
    const inicial = new RegExp(
      `set${nombre}Open\\] = useState\\(([\\s\\S]{0,200}?)\\);`,
    ).exec(src);
    assert.ok(inicial, `no se encontró el estado inicial de ${nombre}Open`);
    assert.match(
      inicial![1],
      /isLocked &&/,
      `«${nombre}» arranca plegada aunque la nota esté firmada: su contenido sería ilegible`,
    );
  });
});

test("guardar sigue cortando antes si la nota está firmada, y no hay puerta nueva", () => {
  const src = leer("src/components/clinical/dental-form.tsx");
  assert.match(src, /const isLocked = isEditing && initialSpec\.status === "SIGNED";/);
  assert.match(src, /async function handleSave\(\)\s*\{[\s\S]{0,400}?if \(isLocked\) return;/);
  // Los campos nuevos se guardan por el MISMO camino de siempre: no estrenan
  // endpoint ni cuelan un PATCH propio.
  const rutas = src.match(/fetch\(\s*[`"][^`"]+/g) ?? [];
  rutas.forEach((r) => {
    assert.ok(
      !/exploracion|pronostico|nom004/i.test(r),
      `la nota estrenó una ruta para los campos nuevos: ${r}`,
    );
  });
});

// ═══ 5 · Vacío es vacío ══════════════════════════════════════════════

test("una exploración en blanco se guarda en blanco: no se inventa «sin alteraciones»", () => {
  const enBlanco: Record<string, string> = {};
  EXPLORACION_FISICA.forEach((c) => { enBlanco[c.key] = ""; });
  assert.deepEqual(normalizeExploracionFisica(enBlanco), {});
  assert.deepEqual(normalizeExploracionFisica({ habitus: "   ", atm: "\n" }), {});
  assert.deepEqual(normalizeExploracionFisica(null), {});
  assert.deepEqual(normalizeExploracionFisica("sin alteraciones" as any), {});

  // Lo escrito sí se guarda, recortado, y solo eso.
  assert.deepEqual(
    normalizeExploracionFisica({ habitus: "  Buena constitución  ", cavidadOral: "", sobra: "x" }),
    { habitus: "Buena constitución" },
  );
});

test("ni el catálogo ni los textos meten un valor por defecto que nadie miró", () => {
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json"));
  const en = JSON.parse(leer("src/i18n/dictionaries/en.json"));
  const textos = JSON.stringify(es.clinical.nom004) + JSON.stringify(en.clinical.nom004);
  // El catálogo no trae valores iniciales de ningún tipo.
  EXPLORACION_FISICA.forEach((c) => {
    assert.equal((c as any).valor, undefined, `${c.key} trae un valor por defecto`);
    assert.ok(c.placeholder.trim().length > 0, `${c.key} se quedó sin ejemplo`);
    assert.match(c.placeholder, /^(Ej\.|Lo que)/, `${c.key}: el ejemplo tiene que leerse como ejemplo`);
  });
  // Y la ayuda dice explícitamente que lo no marcado no afirma nada.
  assert.match(textos, /no se interpreta como/);
  assert.match(textos, /does not mean/);
});

/** El archivo sin comentarios: lo que de verdad llega al navegador. */
function sinComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("los ejemplos de la exploración caben en el campo, medidos en pantalla", () => {
  // Medido el 20-sep-2026 sobre el CSS compilado: a media rejilla el campo da
  // para ~45 caracteres a 13 px. Un ejemplo que se corta a la mitad enseña
  // menos que uno corto, y el sitio de estos ejemplos es enseñar qué va ahí.
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json"));
  const en = JSON.parse(leer("src/i18n/dictionaries/en.json"));
  EXPLORACION_FISICA.filter((c) => !c.area).forEach((c) => {
    [["es", es], ["en", en]].forEach(([idioma, dict]: any) => {
      const txt = c.placeholderKey.split(".").reduce((a: any, p: string) => a?.[p], dict);
      assert.ok(
        txt.length <= 45,
        `${idioma}: el ejemplo de ${c.key} se corta en el campo (${txt.length} caracteres)`,
      );
    });
    assert.ok(c.placeholder.length <= 45, `el respaldo de ${c.key} se corta en el campo`);
  });
});

test("el formulario de la nota no precarga ningún texto clínico", () => {
  const src = leer("src/components/clinical/dental-form.tsx");
  assert.ok(
    !/sin alteraciones/i.test(sinComentarios(src)),
    "la nota escribe «sin alteraciones» en alguna parte del código que corre",
  );
  // El estado inicial de la exploración sale de lo guardado o de "".
  assert.match(src, /base\[c\.key\] = initExploracion\[c\.key\] \?\? "";/);
});

// ═══ 6 · Los nombres del contrato, tal cual los fijó el gerente ═══════

test("los campos se llaman EXACTAMENTE como quedó acordado con ws1-t4", () => {
  assert.equal(GRUPO_HEREDO_FAMILIARES.namespace, "heredoFamiliares");
  assert.equal(GRUPO_APARATOS_SISTEMAS.namespace, "aparatosSistemas");
  assert.deepEqual(
    HEREDO_FAMILIARES.map((q) => q.key).concat(GRUPO_HEREDO_FAMILIARES.libre!.key),
    ["diabetes", "hipertension", "cardiopatias", "cancer", "otros"],
  );
  assert.deepEqual(
    APARATOS_SISTEMAS.map((q) => q.key).concat(GRUPO_APARATOS_SISTEMAS.libre!.key),
    [
      "cardiovascular", "respiratorio", "digestivo", "genitourinario",
      "endocrino", "nervioso", "musculoesqueletico", "notas",
    ],
  );
  assert.deepEqual(
    EXPLORACION_FISICA.map((c) => c.key),
    ["habitus", "cabezaCuello", "cavidadOral", "atm", "ganglios", "notas"],
  );
});

test("las dos secciones nuevas son casillas y arrancan plegadas", () => {
  [GRUPO_HEREDO_FAMILIARES, GRUPO_APARATOS_SISTEMAS].forEach((g) => {
    assert.equal(g.casillas, true, `${g.id} no es de casillas`);
    assert.equal(g.plegado, true, `${g.id} no arranca plegado`);
    assert.ok(g.libre, `${g.id} se quedó sin campo de texto libre`);
    assert.ok(g.ayudaKey, `${g.id} se quedó sin línea de ayuda`);
  });
  // Y las tres de siempre siguen siendo Sí/No y abiertas.
  ["padecimientos", "alergias", "habitos"].forEach((id) => {
    const g = QUESTIONNAIRE_GROUPS.find((x) => x.id === id)!;
    assert.ok(g, `desapareció el grupo ${id}`);
    assert.equal(g.casillas, undefined);
    assert.equal(g.plegado, undefined);
    assert.equal(g.namespace, undefined);
  });
});

test("guardar no pisa lo que se teclee mientras la petición viaja", () => {
  // El botón se deshabilita al guardar; los campos NO. Reponer el estado con
  // la foto de antes del envío le borra al asistente lo que acaba de
  // escribir, y encima bajo un toast que dice «guardado».
  [
    "src/components/dashboard/pacientes-rediseno/cuestionario.tsx",
    "src/components/dashboard/patient-detail/health-questionnaire-tab.tsx",
  ].forEach((f) => {
    const src = leer(f);
    assert.match(
      src,
      /setAnswers\(\(actual\) => \(actual === answers \? limpias : actual\)\);/,
      `${f} repone el estado a ciegas tras guardar`,
    );
  });
});

test("las dos pantallas del cuestionario pintan las secciones nuevas", () => {
  // La del rediseño las nombra a mano (importa cada grupo)…
  const rediseno = leer("src/components/dashboard/pacientes-rediseno/cuestionario.tsx");
  assert.match(rediseno, /GRUPO_HEREDO_FAMILIARES/);
  assert.match(rediseno, /GRUPO_APARATOS_SISTEMAS/);
  assert.match(rediseno, /normalizeAnswers\(answers\)/);
  // …y la de siempre las saca del catálogo, así que con la bandera apagada
  // una clínica tampoco se queda sin capturar NOM-004.
  const vieja = leer("src/components/dashboard/patient-detail/health-questionnaire-tab.tsx");
  assert.match(vieja, /group\.casillas\s*\?/);
  assert.match(vieja, /normalizeAnswers\(answers\)/);
  // Y las DOS avisan de una sección que solo tiene texto libre: plegada y sin
  // marca, parecería que nadie la llenó.
  [rediseno, vieja].forEach((src) => {
    assert.match(src, /clinical\.nom004\.conNota/, "una sección con solo nota no se marca");
  });
});

// ═══ 7 · i18n ════════════════════════════════════════════════════════

test("toda clave del catálogo NOM-004 existe en español y en inglés", () => {
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json"));
  const en = JSON.parse(leer("src/i18n/dictionaries/en.json"));
  const buscar = (dict: any, key: string) =>
    key.split(".").reduce((acc: any, parte) => (acc == null ? undefined : acc[parte]), dict);

  const claves: string[] = [
    "clinical.nom004.marcadas",
    "clinical.nom004.conNota",
    "clinical.nom004.pronostico.titulo",
    "clinical.nom004.pronostico.ayuda",
  ];
  [GRUPO_HEREDO_FAMILIARES, GRUPO_APARATOS_SISTEMAS].forEach((g) => {
    claves.push(g.titleKey!, g.ayudaKey!, g.libre!.labelKey!, g.libre!.placeholderKey!);
    g.questions.forEach((q) => claves.push(q.labelKey!));
  });
  EXPLORACION_FISICA.forEach((c) => claves.push(c.labelKey, c.placeholderKey));
  claves.push("clinical.nom004.exploracionFisica.titulo", "clinical.nom004.exploracionFisica.ayuda", "clinical.nom004.exploracionFisica.capturada");

  assert.ok(claves.length > 25, `se esperaban muchas claves, hay ${claves.length}`);
  // Una hoja del diccionario es una cadena, o un objeto { one, other } si la
  // clave lleva plural (`t.ts`: selección por `count`).
  const esHoja = (v: any) =>
    typeof v === "string" || (v != null && typeof v === "object" && typeof v.other === "string");
  claves.forEach((k) => {
    assert.equal(typeof k, "string", "una entrada del catálogo se quedó sin clave i18n");
    assert.ok(esHoja(buscar(es, k)), `falta en es.json: ${k}`);
    assert.ok(esHoja(buscar(en, k)), `falta en en.json: ${k}`);
  });

  // «1 marcadas» no se escribe: el contador tiene sus dos formas.
  [es, en].forEach((dict) => {
    const m = buscar(dict, "clinical.nom004.marcadas");
    assert.equal(typeof m.one, "string", "al contador le falta la forma singular");
    assert.ok(m.one.indexOf("{count}") === -1, "la forma singular no necesita interpolar");
  });

  // El pronóstico reusa los textos del plan: no hay copia en clinical.nom004.
  PRONOSTICOS.forEach((p) => {
    assert.equal(typeof buscar(es, PRONOSTICO_CLAVE[p]), "string", `falta en es.json: ${PRONOSTICO_CLAVE[p]}`);
    assert.equal(typeof buscar(en, PRONOSTICO_CLAVE[p]), "string", `falta en en.json: ${PRONOSTICO_CLAVE[p]}`);
    assert.equal(buscar(es, `clinical.nom004.pronostico.${p}`), undefined, `${p} se copió a clinical.nom004`);
  });
});

test("los textos de la nota salen del diccionario, no del componente", () => {
  const src = leer("src/components/clinical/dental-form.tsx");
  ["clinical.nom004.exploracionFisica.titulo", "clinical.nom004.pronostico.titulo"].forEach((k) => {
    assert.ok(src.indexOf(k) !== -1, `la nota no usa la clave ${k}`);
  });
  assert.ok(src.indexOf("planTratamiento.pronostico.sinDefinir") !== -1, "«sin definir» no sale del plan");
});
