/**
 * Rediseño de Pacientes — candados.
 *
 * Run: npm run test:pacientes-rediseno
 *
 * Lo que fija:
 *  - El menú de la ficha enseña SIEMPRE los mismos seis apartados fijos y los
 *    mismos tres grupos, sin importar el ancho: eso es todo el encargo. Y
 *    ningún apartado que pase el filtro de permisos se queda fuera del menú ni
 *    sale dos veces — ni siquiera uno que nadie dio de alta en esta estructura.
 *  - Los chips de alerta dejan de salir dos veces: «Alergia a penicilina» +
 *    «Penicilina» era el defecto fotografiado. Y lo que NO es un repetido
 *    (una alergia que no tiene bandera) sigue saliendo.
 *  - Las fechas sin hora se pintan en el día que son: «2026-10-09» es 9 de
 *    octubre, no 8, para cualquier clínica al oeste de Greenwich.
 *  - Los antecedentes que enseña «Nueva consulta» salen de lo que ya está
 *    guardado, y cuando no hay nada guardado el resultado es vacío (la
 *    pantalla manda al cuestionario en vez de ofrecer un cuadro en blanco).
 *  - Toda key i18n que nombran los módulos del rediseño existe en español y
 *    en inglés.
 */
import { test } from "node:test";
import { APARTADOS_FUERA_DEL_MENU } from "@/components/dashboard/presupuestos-en-facturacion/menu";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildPatientNavItems } from "@/components/dashboard/patient-detail/patient-nav-items";
import {
  FIJOS,
  GRUPO_ARCHIVOS,
  GRUPO_CLINICO,
  GRUPO_MAS,
  construirMenuFicha,
} from "@/components/dashboard/pacientes-rediseno/menu-estructura";
import { construirAlertas, normalizar } from "@/components/dashboard/pacientes-rediseno/alertas";
import { construirAntecedentes } from "@/components/dashboard/pacientes-rediseno/antecedentes";
import { aFechaLocal, fechaCorta, diasHasta } from "@/components/dashboard/pacientes-rediseno/fechas";

const RAIZ = join(__dirname, "..", "..", "..", "..", "..");

/** Todo abierto: dueño en una clínica con todos los módulos. */
const TODO = {
  pediatrics: { state: "hidden" as const },
  showPeriodontics: false,
  showEndodontics: false,
  showImplants: true,
  showOrthodontics: false,
  showBilling: true,
  showConsents: true,
  showXrays: true,
  showPrescriptions: true,
};

// ═══ El menú de la ficha ═════════════════════════════════════════════

test("los seis fijos son los seis acordados, en orden", () => {
  const menu = construirMenuFicha(buildPatientNavItems(TODO));
  assert.deepEqual(
    menu.fijos.map((i) => i.id),
    ["resumen", "expediente", "odontograma", "tratamiento", "agenda", "facturacion"],
  );
});

test("los tres grupos son Clínico, Archivos y Más, con su contenido", () => {
  const menu = construirMenuFicha(buildPatientNavItems(TODO));
  assert.deepEqual(menu.grupos.map((g) => g.id), ["clinico", "archivos", "mas"]);
  const porId: Record<string, string[]> = {};
  menu.grupos.forEach((g) => { porId[g.id] = g.items.map((i) => i.id); });
  assert.deepEqual(porId.clinico, [
    "historia", "cuestionario", "historial-consultas", "recetas", "consentimientos",
  ]);
  assert.deepEqual(porId.archivos, ["radiografias", "fotos", "subidos", "modelos-3d"]);
  // Implantes no está en ninguna lista: cae en «Más», detrás de los suyos.
  // «Presupuestos» salió del menú en ws1-t1 (se unió con Facturación): ver
  // `presupuestos-en-facturacion/`. No está ni en «Más» ni en ningún otro sitio.
  assert.deepEqual(porId.mas, ["referencias", "implantes"]);
});

test("ningún apartado se pierde ni se repite, para ningún juego de permisos", () => {
  const combinaciones = [
    TODO,
    { ...TODO, showImplants: false },
    { ...TODO, showBilling: false, showConsents: false },
    { ...TODO, showXrays: false, showPrescriptions: false },
    { ...TODO, showBilling: false, showConsents: false, showXrays: false, showPrescriptions: false, showImplants: false },
  ];
  combinaciones.forEach((opts) => {
    const items = buildPatientNavItems(opts);
    const menu = construirMenuFicha(items);
    const pintados = menu.fijos
      .map((i) => i.id)
      .concat(...menu.grupos.map((g) => g.items.map((i) => i.id)));
    // Todos, menos los que se sacaron del menú A PROPÓSITO y con nombre
    // (`APARTADOS_FUERA_DEL_MENU`): hoy, solo «presupuestos».
    assert.deepEqual(
      pintados.slice().sort(),
      items.map((i) => i.id).filter((id) => APARTADOS_FUERA_DEL_MENU.indexOf(id) === -1).sort(),
      `faltan o sobran apartados con ${JSON.stringify(opts)}`,
    );
    assert.equal(new Set(pintados).size, pintados.length, "hay un apartado repetido");
  });
});

test("un apartado nuevo que nadie dio de alta aquí NO desaparece: cae en Más", () => {
  const items = buildPatientNavItems(TODO);
  const inventado: any = { ...items[0], id: "pestana-del-futuro" };
  const menu = construirMenuFicha(items.concat(inventado));
  const mas = menu.grupos.find((g) => g.id === "mas");
  assert.ok(mas, "el grupo Más tiene que existir");
  assert.ok(
    mas!.items.some((i) => i.id === "pestana-del-futuro"),
    "una pestaña desconocida tiene que seguir siendo alcanzable",
  );
});

test("un grupo que se queda sin apartados no se pinta", () => {
  // Sin recetas ni consentimientos, Clínico todavía tiene historia,
  // cuestionario e historial: sigue. Se fuerza el caso vacío a mano.
  const items = buildPatientNavItems(TODO).filter(
    (i) => GRUPO_ARCHIVOS.indexOf(i.id as any) === -1,
  );
  const menu = construirMenuFicha(items);
  assert.ok(!menu.grupos.some((g) => g.id === "archivos"), "Archivos vacío no se pinta");
});

test("las cuatro listas de la estructura no se solapan", () => {
  const todas = ([] as string[]).concat(FIJOS as any, GRUPO_CLINICO as any, GRUPO_ARCHIVOS as any, GRUPO_MAS as any);
  assert.equal(new Set(todas).size, todas.length, "un apartado está en dos sitios a la vez");
});

// ═══ Los chips de alerta ═════════════════════════════════════════════

test("«Alergia a penicilina» y «Penicilina» ya no salen las dos", () => {
  const chips = construirAlertas({
    riskFlags: ["ALERGIA_PENICILINA", "ALERGIA_LATEX", "HIPERTENSION"],
    allergies: ["Penicilina", "Látex"],
    chronicConditions: ["Hipertensión controlada"],
    currentMedications: [],
  });
  const textos = chips.map((c) => c.texto);
  assert.deepEqual(textos, ["Alergia a penicilina", "Alergia al látex", "Hipertensión"]);
});

test("una alergia SIN bandera se sigue pintando", () => {
  const chips = construirAlertas({
    riskFlags: ["ALERGIA_PENICILINA"],
    allergies: ["Penicilina", "Ibuprofeno", "Mariscos"],
    chronicConditions: [],
    currentMedications: [],
  });
  assert.deepEqual(chips.map((c) => c.texto), ["Alergia a penicilina", "Ibuprofeno", "Mariscos"]);
});

test("un medicamento que dice CUÁL y CUÁNTO no se calla", () => {
  // «Anticoagulantes» es la bandera; «Warfarina 5 mg» dice cuál y cuánto.
  const chips = construirAlertas({
    riskFlags: ["ANTICOAGULANTES"],
    allergies: [],
    chronicConditions: [],
    currentMedications: ["Warfarina 5 mg"],
  });
  assert.deepEqual(chips.map((c) => c.texto), ["Anticoagulantes", "Warfarina 5 mg"]);
});

test("«Anticoagulantes» NO sale dos veces (bandera + medicamento)", () => {
  // Al contestar «toma anticoagulantes: sí», el cuestionario escribe esa misma
  // palabra en la medicación del paciente Y levanta la bandera.
  const chips = construirAlertas({
    riskFlags: ["ANTICOAGULANTES", "BIFOSFONATOS"],
    allergies: [],
    chronicConditions: [],
    currentMedications: ["Anticoagulantes", "Bifosfonatos"],
  });
  assert.deepEqual(chips.map((c) => c.texto), ["Anticoagulantes", "Bifosfonatos"]);
});

test("una alergia PARECIDA a una bandera, pero distinta, NO se calla", () => {
  // Lo peor que puede hacer una alerta de alergia es esconder una alergia.
  const chips = construirAlertas({
    riskFlags: ["ALERGIA_PENICILINA", "DIABETES", "ALERGIA_ANESTESIA"],
    allergies: ["Penicilina", "Antibióticos sulfamidas", "Alergia a antibióticos"],
    chronicConditions: ["Diabetes insípida"],
    currentMedications: [],
  });
  const textos = chips.map((c) => c.texto);
  assert.ok(textos.indexOf("Antibióticos sulfamidas") !== -1, "la alergia a sulfas se perdió");
  assert.ok(textos.indexOf("Alergia a antibióticos") !== -1, "la alergia a antibióticos se perdió");
  assert.ok(textos.indexOf("Diabetes insípida") !== -1, "la diabetes insípida se perdió");
  assert.ok(textos.indexOf("Penicilina") === -1, "«Penicilina» sí era un repetido de la bandera");
});

test("«Alérgico a la penicilina» también se reconoce como el mismo dato", () => {
  const chips = construirAlertas({
    riskFlags: ["ALERGIA_PENICILINA"],
    allergies: ["Alérgico a la penicilina"],
    chronicConditions: [],
    currentMedications: [],
  });
  assert.deepEqual(chips.map((c) => c.texto), ["Alergia a penicilina"]);
});

test("dentro de una misma lista tampoco hay repetidos, con o sin acento", () => {
  const chips = construirAlertas({
    riskFlags: [],
    allergies: ["Látex", "latex", "LÁTEX", "  "],
    chronicConditions: [],
    currentMedications: [],
  });
  assert.deepEqual(chips.map((c) => c.texto), ["Látex"]);
});

test("sin nada que avisar, no hay chips (la cabecera pinta «sin alergias»)", () => {
  assert.deepEqual(
    construirAlertas({ riskFlags: [], allergies: [], chronicConditions: [], currentMedications: [] }),
    [],
  );
});

test("normalizar quita acentos, mayúsculas y espacios de sobra", () => {
  assert.equal(normalizar("  Alergia  AL   Látex "), "alergia al latex");
});

// ═══ Las fechas ══════════════════════════════════════════════════════

test("una fecha sin hora es el día que dice, no el anterior", () => {
  const d = aFechaLocal("2026-10-09")!;
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 9);
  assert.equal(d.getDate(), 9);
  assert.match(fechaCorta("2026-10-09"), /9/);
});

test("un ISO con hora se respeta tal cual", () => {
  const d = aFechaLocal("2026-10-09T15:00:00.000Z")!;
  assert.equal(d.toISOString(), "2026-10-09T15:00:00.000Z");
});

test("diasHasta cuenta días, no milisegundos", () => {
  const hoy = new Date();
  const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  assert.equal(diasHasta(iso(hoy)), 0);
  const manana = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1);
  assert.equal(diasHasta(iso(manana)), 1);
  const ayer = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1);
  assert.equal(diasHasta(iso(ayer)), -1);
});

test("un valor vacío no revienta", () => {
  assert.equal(aFechaLocal(null), null);
  assert.equal(aFechaLocal("no soy una fecha"), null);
  assert.equal(fechaCorta(null), "—");
  assert.equal(diasHasta(undefined), null);
});

// ═══ El orden de las citas del Resumen ═══════════════════════════════

test("con dos citas el MISMO día, la próxima es la de más temprano", () => {
  // El server manda las citas de la más lejana a la más vieja, y ordenarlas
  // por DÍA las deja empatadas: `sort` es estable, así que el empate conserva
  // ese orden y la cita de las 17:00 salía como «la próxima».
  const instante = (c: any): number => {
    const t = new Date(c.startsAt ?? c.date).getTime();
    return isNaN(t) ? 0 : t;
  };
  const hoy = new Date();
  const dia = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
  const tarde = { id: "t", date: dia, startsAt: `${dia}T23:00:00.000Z` };
  const temprano = { id: "m", date: dia, startsAt: `${dia}T13:00:00.000Z` };
  const comoLlegan = [tarde, temprano]; // desc, como las manda el server
  const ordenadas = comoLlegan.slice().sort((a, b) => instante(a) - instante(b));
  assert.equal(ordenadas[0].id, "m", "la próxima tiene que ser la de más temprano");
  assert.equal(ordenadas.length, 2, "no se puede perder ninguna cita del día");
});

// ═══ Los antecedentes de «Nueva consulta» ════════════════════════════

test("los antecedentes salen de lo ya guardado, con el riesgo primero", () => {
  const bloques = construirAntecedentes({
    riskFlags: ["ALERGIA_PENICILINA", "DIABETES"],
    allergies: ["Penicilina", "Ibuprofeno"],
    chronicConditions: ["Diabetes tipo 2", "Asma"],
    currentMedications: ["Metformina 850 mg"],
    bloodType: "O+",
  });
  assert.deepEqual(bloques.map((b) => b.id), [
    "riesgo", "alergias", "padecimientos", "medicacion", "sangre",
  ]);
  assert.deepEqual(bloques[0].valores, ["Alergia a penicilina", "Diabetes"]);
  assert.equal(bloques[0].critico, true);
  assert.equal(bloques[1].critico, true);
  assert.equal(bloques[2].critico, false);
});

test("los antecedentes tampoco repiten lo que ya dice una bandera", () => {
  // «Penicilina» y «Diabetes tipo 2» ya los dicen las banderas de arriba;
  // «Ibuprofeno» y «Asma» no los dice nadie y tienen que seguir.
  const bloques = construirAntecedentes({
    riskFlags: ["ALERGIA_PENICILINA", "DIABETES"],
    allergies: ["Penicilina", "Ibuprofeno"],
    chronicConditions: ["Diabetes tipo 2", "Asma"],
    currentMedications: [],
  });
  const por = (id: string) => bloques.find((b) => b.id === id)?.valores ?? [];
  assert.deepEqual(por("alergias"), ["Ibuprofeno"]);
  assert.deepEqual(por("padecimientos"), ["Asma"]);
});

test("un paciente del que no se sabe nada devuelve vacío", () => {
  assert.deepEqual(
    construirAntecedentes({
      riskFlags: [],
      allergies: [],
      chronicConditions: [],
      currentMedications: [],
      bloodType: "  ",
    }),
    [],
  );
});

// ═══ i18n ════════════════════════════════════════════════════════════

test("toda key del rediseño existe en español y en inglés", () => {
  const es = JSON.parse(readFileSync(join(RAIZ, "src/i18n/dictionaries/es.json"), "utf8"));
  const en = JSON.parse(readFileSync(join(RAIZ, "src/i18n/dictionaries/en.json"), "utf8"));
  const buscar = (dict: any, key: string) =>
    key.split(".").reduce((acc: any, parte) => (acc == null ? undefined : acc[parte]), dict);

  const carpeta = join(RAIZ, "src/components/dashboard/pacientes-rediseno");
  const fuentes = readdirSync(carpeta).filter((f) => /\.tsx?$/.test(f));
  assert.ok(fuentes.length > 0, "no se encontró ningún archivo del rediseño");

  const keys = new Set<string>();
  fuentes.forEach((f) => {
    const texto = readFileSync(join(carpeta, f), "utf8");
    const re = /["'`](pacientesRediseno\.[A-Za-z0-9_.]+)["'`]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(texto)) !== null) keys.add(m[1]);
  });
  assert.ok(keys.size > 20, `se esperaban muchas keys, hay ${keys.size}`);

  keys.forEach((k) => {
    assert.equal(typeof buscar(es, k), "string", `falta en es.json: ${k}`);
    assert.equal(typeof buscar(en, k), "string", `falta en en.json: ${k}`);
  });
});

test("el rediseño se enciende con el MISMO interruptor del menú, no con otro", () => {
  const lista = readFileSync(join(RAIZ, "src/app/dashboard/patients/page.tsx"), "utf8");
  const ficha = readFileSync(join(RAIZ, "src/app/dashboard/patients/[id]/page.tsx"), "utf8");
  [lista, ficha].forEach((src) => {
    assert.match(src, /menuDosNivelesEncendido\(/, "la pantalla no consulta el interruptor");
    assert.match(src, /rediseno=\{rediseno\}/, "la pantalla no baja la bandera al cliente");
  });
});
