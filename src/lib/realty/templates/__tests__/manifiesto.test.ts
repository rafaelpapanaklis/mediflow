// ═══════════════════════════════════════════════════════════════════════
// LA PRUEBA DEL MANIFIESTO DE LA WEB PÚBLICA DE INMUEBLES.
//
//   npx tsx --test src/lib/realty/templates/__tests__/manifiesto.test.ts
//
// Cuatro cosas, y la primera es la que de verdad protege:
//
//   1. MANIFIESTO ↔ JSX. Lo que un bloque declara que PINTA es lo que su
//      componente pinta de verdad. Se comprueba leyendo el .tsx como texto
//      y con IGUALDAD ESTRICTA en las DOS direcciones: declarar de más
//      falla igual que declarar de menos. Sin esto, la declaración se
//      separa del código al primer refactor y el editor empieza a mentirle
//      a la inmobiliaria — le ofrece llenar un campo que su plantilla no
//      pinta, o le esconde uno que sí saldría.
//
//   2. LAS NUEVE SON DISTINTAS EN ESTRUCTURA. La firma de una plantilla es
//      el orden de sus bloques. Dos firmas iguales son la misma plantilla
//      con otro color, que es exactamente lo que este vertical NO vende.
//
//   3. CAMBIAR DE PLANTILLA NO PIERDE NADA, y la fusión a tres bandas solo
//      da 409 cuando de verdad lo hay. Junto a cada caso que debe
//      fusionarse en silencio está su gemelo que SÍ debe dar conflicto.
//
//   4. LA WEB ES PÚBLICA. A los mapeadores de salida se les mete una fila
//      con TODO lo sensible dentro (tokens, comisiones, notas internas, el
//      dueño) y se comprueba que no sale ni una clave ni un valor.
//
// Todo es ESTÁTICO y PURO: sin Postgres, sin navegador, sin sesión.
// ═══════════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  REALTY_WEB_ACENTOS,
  REALTY_WEB_BLOQUE_IDS,
  REALTY_WEB_CAMPOS_PROHIBIDOS,
  REALTY_WEB_COPY_MAX,
  REALTY_WEB_PINTA_KEYS,
  REALTY_WEB_TEMPLATE_IDS,
  REALTY_WEB_TEMPLATE_MODE,
  aAgentePublico,
  aCuentaPublica,
  aInmueblePublico,
  aSucursalPublica,
  bloqueDef,
  configRealtyWebVacia,
  esUrlDeArchivoPublica,
  fusionarConfigRealtyWeb,
  fusionarPlantilla,
  manifiestoRealtyWeb,
  nombreDesdeClave,
  tituloDePanel,
  normalizarConfigRealtyWeb,
  ordenDeBloques,
  plantillaEfectiva,
  plantillasDeModo,
  type RealtyWebConfig,
  type RealtyWebPinta,
  type RealtyWebTemplateId,
} from "@/lib/realty/landing";
import { REALTY_WEB_BLOQUES, REALTY_WEB_MANIFESTS } from "@/lib/realty/templates/manifest";
import { realtyTourEmbedUrl } from "@/lib/realty/tours";
import type { RealtyMode } from "@/lib/realty/types";

const RAIZ = join(__dirname, "..", "..", "..", "..", ".."); // → raíz del repo
const CARPETA_BLOQUES = "src/components/realty/web/blocks";

/**
 * La MARCA de cada dato que un bloque puede pintar.
 *
 * Son EXPRESIONES DE CÓDIGO reales y no palabras sueltas: `config.zonas` o
 * `MapaBajoDemanda` solo aparecen si el bloque de verdad usa ese dato o
 * monta ese componente. Antes de buscar se borran los comentarios, así que
 * una mención en la prosa de la cabecera no engaña a la prueba.
 */
const MARCAS: Record<RealtyWebPinta, RegExp> = {
  credenciales: /\bconfig\.credenciales\b/,
  zonas: /\bconfig\.zonas\b/,
  testimonios: /\bconfig\.testimonios\b/,
  requisitos: /\bconfig\.requisitos\b/,
  numeros: /\bconfig\.numeros\b/,
  historia: /\bconfig\.historia\b/,
  sucursales: /\bdata\.sucursales\b/,
  agentes: /\bdata\.agentes\b/,
  inmuebles: /\bdata\.inmuebles\b/,
  buscador: /\bBuscadorInmuebles\b/,
  recorrido: /\btieneRecorrido\b/,
  mapa: /\bMapaBajoDemanda\b/,
  whatsapp: /\bligaWhatsApp\b/,
};

function rutaDelBloque(id: string): string {
  return join(RAIZ, CARPETA_BLOQUES, `${id}.tsx`);
}

/** El código del bloque SIN comentarios: interesa lo que hace, no lo que dice. */
function codigoDelBloque(id: string): string {
  const fuente = readFileSync(rutaDelBloque(id), "utf8");
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/* ══════════════════════════════════════════════════════════════════
   1 · MANIFIESTO ↔ JSX
   ══════════════════════════════════════════════════════════════════ */

test("cada bloque del catálogo tiene su componente", () => {
  const faltan = REALTY_WEB_BLOQUE_IDS.filter((id) => !existsSync(rutaDelBloque(id)));
  assert.deepEqual(faltan, [], `bloques sin archivo en ${CARPETA_BLOQUES}: ${faltan.join(", ")}`);
});

test("cada bloque está registrado en el motor", () => {
  // Se lee index.tsx como texto: importarlo traería JSX y CSS a node.
  const registro = readFileSync(
    join(RAIZ, "src/components/realty/web/index.tsx"),
    "utf8",
  );
  const trozo = registro.slice(
    registro.indexOf("REALTY_WEB_COMPONENTES"),
    registro.indexOf("export function redesDe"),
  );
  const faltan = REALTY_WEB_BLOQUE_IDS.filter(
    (id) => !trozo.includes(`${id}:`) && !trozo.includes(`"${id}":`),
  );
  assert.deepEqual(faltan, [], `bloques sin entrada en REALTY_WEB_COMPONENTES: ${faltan.join(", ")}`);
});

for (const id of REALTY_WEB_BLOQUE_IDS) {
  test(`${id}: lo que el manifiesto dice que pinta es lo que pinta`, () => {
    const codigo = codigoDelBloque(id);
    const declarado = new Set<string>(REALTY_WEB_BLOQUES[id].pinta);

    for (const clave of REALTY_WEB_PINTA_KEYS) {
      const enElCodigo = MARCAS[clave].test(codigo);
      assert.equal(
        declarado.has(clave),
        enElCodigo,
        `El bloque "${id}" y su JSX no dicen lo mismo sobre "${clave}". ` +
          (enElCodigo
            ? `El componente USA ${MARCAS[clave]} pero el catálogo no lo declara: agrégalo a pinta.`
            : `El catálogo declara "${clave}" pero el componente no lo usa: quítalo o píntalo. ` +
              `El editor decide con esta declaración qué campos ofrecer, así que separarla del ` +
              `código es mentirle a la inmobiliaria.`),
      );
    }
  });
}

test("ningún bloque se queda sin modos (sería invisible para todos)", () => {
  const huerfanos = REALTY_WEB_BLOQUE_IDS.filter((id) => REALTY_WEB_BLOQUES[id].modos.length === 0);
  assert.deepEqual(huerfanos, []);
});

/* ── El encabezado del editor: ningún bloque puede quedarse mudo ────
 *
 * 🔴 POR QUÉ EXISTE ESTA PRUEBA. El editor de "Mi web" pinta cada bloque
 * como un `<details>` CERRADO: lo único que se ve en la columna izquierda
 * es `nombre`, y lo único que explica qué hay dentro es `ayuda`. Un bloque
 * sin nombre no se ve como un error — se ve como una BARRA GRIS VACÍA, y
 * uno sin ayuda se ve como una sección que no dice nada. Es exactamente el
 * modo de falla de la llave de i18n vacía en barber (campañas pintando
 * "barber.campanas.title" y el modal de cobro "sin opciones"): la pantalla
 * "funciona", así que nadie se entera.
 *
 * Se comprueban las DOS puntas: el catálogo (donde se declaran) y lo que
 * el editor pide de verdad para CADA plantilla y CADA modo, que es
 * `bloqueDef(bloque.id)` — el mismo camino que recorre controles.tsx.
 */
test("todo bloque del catálogo tiene nombre y ayuda (sin ellos el editor pinta una barra gris)", () => {
  const malos: string[] = [];
  for (const id of REALTY_WEB_BLOQUE_IDS) {
    const def = REALTY_WEB_BLOQUES[id];
    if (typeof def.nombre !== "string" || def.nombre.trim() === "") malos.push(`${id}.nombre`);
    if (typeof def.ayuda !== "string" || def.ayuda.trim() === "") malos.push(`${id}.ayuda`);
  }
  assert.deepEqual(
    malos,
    [],
    "bloques sin nombre o sin ayuda en REALTY_WEB_BLOQUES: " +
      malos.join(", ") +
      ". El editor los pinta como una barra gris sin texto y quien la ve cree que " +
      "esa sección no existe. El nombre y la ayuda van en " +
      "src/lib/realty/templates/manifest.ts.",
  );
});

test("cada bloque de cada plantilla llega al editor con encabezado (los tres modos)", () => {
  const malos: string[] = [];
  for (const modo of ["AGENCY", "AGENT", "OWNER"] as RealtyMode[]) {
    for (const tid of REALTY_WEB_TEMPLATE_IDS) {
      const manifiesto = manifiestoRealtyWeb(tid, modo);
      if (manifiesto.modo !== modo) continue; // la plantilla de otro modo cae a la suya
      for (const bloque of manifiesto.bloques) {
        // MISMA llamada que hace src/components/realty/web/editor/controles.tsx
        const def = bloqueDef(bloque.id);
        if (!def.nombre || def.nombre.trim() === "") {
          malos.push(`${modo}/${manifiesto.id}/${bloque.id}: sin nombre`);
        }
        if (!def.ayuda || def.ayuda.trim() === "") {
          malos.push(`${modo}/${manifiesto.id}/${bloque.id}: sin ayuda`);
        }
      }
    }
  }
  assert.deepEqual(malos, [], `paneles mudos en el editor: ${malos.join(" · ")}`);
});

test("un bloque desconocido tampoco pinta un encabezado vacío", () => {
  // bloqueDef es el único punto por el que el editor saca el título. Si
  // alguien guarda un orden con un id que ya no existe, la barra tiene que
  // seguir diciendo CUÁL es, no quedarse en blanco.
  const fantasma = bloqueDef("bloque-que-ya-no-existe");
  assert.equal(fantasma.nombre, "Bloque que ya no existe");
  assert.ok(fantasma.ayuda.trim().length > 0, "el bloque de emergencia también lleva ayuda");

  // Y el caso límite de verdad: una clave vacía.
  assert.equal(nombreDesdeClave(""), "Sección");
  assert.equal(nombreDesdeClave("trato-directo"), "Trato directo");
});

test("la RED DE SEGURIDAD nunca devuelve un espacio (sería la misma barra gris)", () => {
  /* 🔴 ESTE ES EL AGUJERO QUE TENÍA LA PRIMERA VERSIÓN DEL ARREGLO. El
   * `.trim()` corría ANTES de cambiar los separadores por espacios, así que
   * una clave de puros guiones ("-", "__", " - ") pasaba el guardia de
   * vacío y devolvía " ": la red contra la barra muda pintaba exactamente
   * una barra muda. Y la única prueba que había miraba `""`, que es el
   * único caso que sí funcionaba.
   *
   * Se comprueba la función PURA que usa el componente, no el .tsx como
   * texto: así vaciarla rompe la suite.
   */
  const clavesFeas = ["", "   ", "-", "--", "_", "__", " - ", "-_-", "	"];
  for (const clave of clavesFeas) {
    const nombre = nombreDesdeClave(clave);
    assert.equal(nombre.trim(), nombre, `"${clave}" deja espacios sueltos: ${JSON.stringify(nombre)}`);
    assert.ok(nombre.length > 0, `"${clave}" devolvió vacío`);
    assert.equal(nombre, "Sección", `"${clave}" debería caer al nombre neutro`);
  }
  // Y una clave con basura alrededor sigue leyéndose.
  assert.equal(nombreDesdeClave("__sobre-mi__"), "Sobre mi");

  // tituloDePanel: lo que el <summary> pinta de verdad. NUNCA vacío.
  for (const titulo of ["", "   ", null, undefined, 0, {}]) {
    const visible = tituloDePanel(titulo as unknown, "trato-directo");
    assert.equal(visible, "Trato directo", `título ${JSON.stringify(titulo)} no cayó al respaldo`);
  }
  for (const titulo of ["", "   ", null, undefined]) {
    const visible = tituloDePanel(titulo as unknown, "-");
    assert.ok(visible.trim().length > 0, "el respaldo del respaldo también tiene que tener texto");
  }
  // Y un título bueno se respeta tal cual (recortado).
  assert.equal(tituloDePanel("  Redes sociales  ", "loQueSea"), "Redes sociales");
});

test("NINGÚN panel del editor puede quedarse sin título, venga de donde venga", () => {
  /* 🔴 POR QUÉ ESTA PRUEBA ES MÁS ANCHA QUE LA DE ARRIBA.
   *
   * Las de arriba cuidan el ÚNICO encabezado dinámico: el de EditorBloque,
   * que saca su nombre del manifiesto. Pero la columna izquierda del editor
   * tiene DOCE paneles más —Plantilla, Color, Publicación, Tu historia,
   * Credenciales, Zonas, Testimonios, Requisitos, Números, Cómo te
   * contactan, Redes sociales, Título y descripción— y hoy su título es un
   * literal escrito en el JSX. Hoy. El día que alguien cambie uno por una
   * variable (por i18n, por ejemplo) y esa variable llegue vacía, volvemos
   * exactamente al síntoma que se está arreglando: una barra gris sin texto
   * que no parece un error, parece una sección que no existe.
   *
   * Aquí se leen TODAS las llamadas a <Panel> del editor y se exige que
   * cada `titulo=` sea, o un literal con texto, o `{def.nombre}` — que es el
   * único dinámico y viene con su red de seguridad (`clave`) comprobada en
   * la prueba siguiente. Cualquier tercera forma tiene que pasar por aquí
   * antes de llegar a la pantalla.
   */
  const editor = readFileSync(
    join(RAIZ, "src/components/realty/web/editor/editor.tsx"),
    "utf8",
  );
  const llamadas = editor.match(/<Panel\s+titulo=(\{[^}]*\}|"[^"]*")/g) ?? [];
  // 🔴 Sin esta igualdad, el guardián se esquiva SOLO con reordenar los
  // atributos: `<Panel abierto titulo={loQueSea}>` no casa con el patrón de
  // arriba y pasaría invisible. Aquí se cuentan TODOS los <Panel del
  // archivo y se exige que el patrón los haya visto a todos.
  const todos = editor.match(/<Panel[\s>]/g) ?? [];
  assert.equal(
    llamadas.length,
    todos.length,
    `hay ${todos.length} <Panel> en el editor y el patrón solo reconoció ${llamadas.length}. ` +
      "Seguramente alguno no lleva `titulo` como primer atributo: ponlo primero " +
      "o amplía esta prueba, pero no lo dejes sin vigilar.",
  );
  assert.ok(
    llamadas.length >= 10,
    `solo se encontraron ${llamadas.length} paneles en el editor; ¿cambió la forma de llamarlos? ` +
      "Si es así, ACTUALIZA esta prueba: sin ella una barra gris vuelve a pasar sin que nadie la vea.",
  );

  const malos: string[] = [];
  for (const llamada of llamadas) {
    const valor = llamada.replace(/^<Panel\s+titulo=/, "");
    if (valor.startsWith('"')) {
      if (valor.replace(/"/g, "").trim() === "") malos.push(`${llamada} (literal vacío)`);
      continue;
    }
    // La única expresión permitida es la del catálogo, que ya está cubierta.
    if (valor.replace(/\s/g, "") !== "{def.nombre}") malos.push(llamada);
  }
  assert.deepEqual(
    malos,
    [],
    "títulos de panel que no son ni un literal con texto ni {def.nombre}: " +
      malos.join(" · ") +
      ". Si de verdad hace falta un título dinámico nuevo, pásale también " +
      "`clave` al Panel y agrégalo a esta prueba.",
  );
});

test("el editor no puede volver a llamar a Panel sin la clave del bloque", () => {
  // La red de seguridad de controles.tsx solo sirve si recibe la clave: sin
  // ella el nombre de emergencia sería "Sección" para todos y el aviso de
  // consola no diría cuál se rompió. Esto se lee del código, que es donde
  // vive el riesgo.
  const fuente = readFileSync(
    join(RAIZ, "src/components/realty/web/editor/controles.tsx"),
    "utf8",
  );
  const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    /<Panel\s+titulo=\{def\.nombre\}[^>]*\bclave=\{p\.bloque\.id\}/.test(codigo),
    "EditorBloque tiene que pasarle `clave={p.bloque.id}` al Panel: es lo que " +
      "convierte una barra gris muda en un nombre legible y en un aviso de consola.",
  );
  assert.ok(
    /<Panel\s+titulo=\{def\.nombre\}\s+ayuda=\{def\.ayuda\}/.test(codigo),
    "EditorBloque tiene que pasarle `ayuda={def.ayuda}` al Panel: sin esa línea " +
      "el panel abierto no dice qué sale en esa sección de la web.",
  );
});

/* ══════════════════════════════════════════════════════════════════
   2 · LAS NUEVE PLANTILLAS
   ══════════════════════════════════════════════════════════════════ */

test("hay tres plantillas por modo y ninguna se cruza", () => {
  for (const modo of ["AGENCY", "AGENT", "OWNER"] as RealtyMode[]) {
    const lista = plantillasDeModo(modo);
    assert.equal(lista.length, 3, `el modo ${modo} no tiene tres plantillas`);
    for (const id of lista) {
      assert.equal(REALTY_WEB_MANIFESTS[id].modo, modo, `${id} declara otro modo en su manifiesto`);
    }
  }
});

test("cada plantilla lleva portada y contacto, y las dos son obligatorias", () => {
  for (const id of REALTY_WEB_TEMPLATE_IDS) {
    const m = REALTY_WEB_MANIFESTS[id];
    const portada = m.bloques.find((b) => b.id === "portada");
    const contacto = m.bloques.find((b) => b.id === "contacto");
    assert.ok(portada, `${id} no tiene portada`);
    assert.ok(contacto, `${id} no tiene contacto`);
    assert.equal(portada?.obligatoria, true, `la portada de ${id} se puede apagar`);
    assert.equal(contacto?.obligatoria, true, `el contacto de ${id} se puede apagar`);
  }
});

test("ninguna plantilla repite un bloque", () => {
  for (const id of REALTY_WEB_TEMPLATE_IDS) {
    const ids = REALTY_WEB_MANIFESTS[id].bloques.map((b) => b.id);
    const repetidos = ids.filter((x, i) => ids.indexOf(x) !== i);
    assert.deepEqual(repetidos, [], `${id} repite: ${repetidos.join(", ")}`);
  }
});

test("una plantilla solo usa bloques de SU modo", () => {
  for (const id of REALTY_WEB_TEMPLATE_IDS) {
    const m = REALTY_WEB_MANIFESTS[id];
    const intrusos = m.bloques
      .filter((b) => !bloqueDef(b.id).modos.includes(m.modo))
      .map((b) => b.id);
    assert.deepEqual(
      intrusos,
      [],
      `${id} (${m.modo}) usa bloques de otro modo: ${intrusos.join(", ")}. ` +
        "Una web AGENT con «sucursales» es una empresa fingida.",
    );
  }
});

test("las nueve se diferencian en ESTRUCTURA, no solo en color", () => {
  // La firma de una plantilla es el orden de sus bloques. Dos plantillas con
  // la misma firma son la misma con otro color.
  const firmas = new Map<string, string>();
  for (const id of REALTY_WEB_TEMPLATE_IDS) {
    const firma = REALTY_WEB_MANIFESTS[id].bloques.map((b) => b.id).join(">");
    const gemela = firmas.get(firma);
    assert.equal(gemela, undefined, `«${id}» tiene la misma estructura que «${gemela}»: ${firma}`);
    firmas.set(firma, id);
  }
});

test("cada plantilla usa un acento del catálogo cerrado", () => {
  const ids = REALTY_WEB_ACENTOS.map((a) => a.id as string);
  for (const id of REALTY_WEB_TEMPLATE_IDS) {
    assert.ok(
      ids.includes(REALTY_WEB_MANIFESTS[id].acentoSugerido),
      `${id} sugiere un acento que no existe`,
    );
  }
});

test("ningún texto suelto se declara dos veces dentro de un bloque", () => {
  for (const id of REALTY_WEB_TEMPLATE_IDS) {
    for (const b of REALTY_WEB_MANIFESTS[id].bloques) {
      const claves = (b.copia ?? []).map((c) => c.clave);
      const repetidas = claves.filter((c, i) => claves.indexOf(c) !== i);
      assert.deepEqual(repetidas, [], `${id}/${b.id} repite claves: ${repetidas.join(", ")}`);
    }
  }
});

test("todo texto por defecto cabe en su propio campo", () => {
  // El editor abre con el campo vacío y el default de placeholder; si el
  // default no cabe en el maxLen, quien lo copie y pegue vería su texto
  // recortado sin que nadie le dijera nada.
  const malos: string[] = [];
  for (const id of REALTY_WEB_TEMPLATE_IDS) {
    for (const b of REALTY_WEB_MANIFESTS[id].bloques) {
      for (const c of b.copia ?? []) {
        const tope = c.maxLen ?? REALTY_WEB_COPY_MAX;
        if (c.porDefecto.length > tope) {
          malos.push(`${id}/${c.clave}: ${c.porDefecto.length} > ${tope}`);
        }
      }
      for (const t of b.textos ?? []) {
        const tope = t.campo === "titulo" ? 120 : 300;
        if (t.porDefecto.length > tope) {
          malos.push(`${id}/${b.id}.${t.campo}: ${t.porDefecto.length} > ${tope}`);
        }
      }
    }
  }
  assert.deepEqual(malos, [], "hay literales que no caben en su propio campo");
});

test("una plantilla desconocida cae a la de SU modo, no a una pantalla en blanco", () => {
  assert.equal(manifiestoRealtyWeb("no-existe", "AGENT").id, "asesor");
  assert.equal(manifiestoRealtyWeb(null, "OWNER").id, "mis-rentas");
  assert.equal(manifiestoRealtyWeb(undefined, "AGENCY").id, "clasica");
  // Y una plantilla de OTRO modo tampoco se cuela: el default de la columna
  // es "clasica" (AGENCY) y una cuenta AGENT no puede acabar hablando como
  // una empresa por un default de la base.
  assert.equal(plantillaEfectiva("clasica", "AGENT"), "asesor");
  assert.equal(plantillaEfectiva("mis-rentas", "AGENCY"), "clasica");
  assert.equal(plantillaEfectiva("historia", "AGENT"), "historia");
});

test("el modo de cada plantilla coincide con la tabla del contrato", () => {
  for (const id of REALTY_WEB_TEMPLATE_IDS) {
    assert.equal(
      REALTY_WEB_MANIFESTS[id].modo,
      REALTY_WEB_TEMPLATE_MODE[id],
      `${id}: el manifiesto y REALTY_WEB_TEMPLATE_MODE no dicen lo mismo`,
    );
  }
});

/* ══════════════════════════════════════════════════════════════════
   3 · CAMBIAR DE PLANTILLA Y FUSIONAR
   ══════════════════════════════════════════════════════════════════ */

function conf(parche: Partial<RealtyWebConfig> = {}): RealtyWebConfig {
  return { ...configRealtyWebVacia(), ...parche };
}

test("el contenido compartido sobrevive a un cambio de plantilla", () => {
  const c = normalizarConfigRealtyWeb({
    copia: { "portada.cta": "Vente ya", "inmuebles.cta": "Lo quiero ver" },
    fotos: { portada: "https://x.test/p.webp", logo: "https://x.test/l.webp" },
    bloques: { inmuebles: { visible: false, titulo: "Lo que tengo" } },
    zonas: ["Providencia"],
    whatsapp: "3312345678",
  });

  for (const id of REALTY_WEB_TEMPLATE_IDS) {
    assert.equal(c.copia["portada.cta"], "Vente ya", `${id} perdió el texto`);
    assert.equal(c.fotos.portada, "https://x.test/p.webp", `${id} perdió la foto`);
    assert.equal(c.bloques.inmuebles.titulo, "Lo que tengo", `${id} perdió el título`);
    const orden = ordenDeBloques(REALTY_WEB_MANIFESTS[id], c);
    const suyos = REALTY_WEB_MANIFESTS[id].bloques.map((b) => b.id);
    assert.deepEqual(
      [...orden].sort(),
      [...suyos].sort(),
      `${id} tiene un orden inconsistente con sus bloques`,
    );
  }
});

test("un orden guardado de otra plantilla no arrastra bloques fantasma", () => {
  const c = conf({ orden: { minimal: ["testimonios", "inmuebles", "portada", "contacto"] } });
  const orden = ordenDeBloques(REALTY_WEB_MANIFESTS.minimal, c);
  assert.equal(orden.includes("testimonios"), false, "se coló un bloque que minimal no tiene");
  for (const b of REALTY_WEB_MANIFESTS.minimal.bloques) {
    assert.equal(orden.includes(b.id), true, `falta ${b.id}`);
  }
});

test("una clave de copia inventada se descarta en silencio", () => {
  const c = normalizarConfigRealtyWeb({ copia: { "no.existe": "hola", "portada.cta": "Ver" } });
  assert.equal(c.copia["no.existe"], undefined);
  assert.equal(c.copia["portada.cta"], "Ver");
});

test("vaciar un texto BORRA la clave (si no, el default se materializaría)", () => {
  const c = normalizarConfigRealtyWeb({ copia: { "portada.cta": "   " } });
  assert.equal("portada.cta" in c.copia, false);
});

test("la fusión: si no lo toqué, gana el servidor", () => {
  const base = conf({ historia: "vieja" });
  const mio = conf({ historia: "vieja" });
  const servidor = conf({ historia: "la que escribió el otro" });
  const r = fusionarConfigRealtyWeb(base, mio, servidor);
  assert.equal(r.config.historia, "la que escribió el otro");
  assert.deepEqual(r.conflictos, []);
});

test("la fusión: si solo lo toqué yo, gana lo mío", () => {
  const base = conf({ historia: "vieja" });
  const mio = conf({ historia: "la mía" });
  const servidor = conf({ historia: "vieja" });
  const r = fusionarConfigRealtyWeb(base, mio, servidor);
  assert.equal(r.config.historia, "la mía");
  assert.deepEqual(r.conflictos, []);
});

test("la fusión: campos DISTINTOS de los dos entran los dos, sin conflicto", () => {
  const base = conf();
  const mio = conf({ historia: "la mía" });
  const servidor = conf({ whatsapp: "5215512345678" });
  const r = fusionarConfigRealtyWeb(base, mio, servidor);
  assert.equal(r.config.historia, "la mía");
  assert.equal(r.config.whatsapp, "5215512345678");
  assert.deepEqual(r.conflictos, []);
});

test("la fusión: EL MISMO campo a valores distintos SÍ es conflicto, y se nombra", () => {
  const base = conf({ historia: "vieja" });
  const mio = conf({ historia: "la mía" });
  const servidor = conf({ historia: "la suya" });
  const r = fusionarConfigRealtyWeb(base, mio, servidor);
  assert.equal(r.conflictos.length, 1);
  assert.match(r.conflictos[0], /historia/);
});

test("la fusión: el mismo campo al MISMO valor no es conflicto", () => {
  const base = conf({ historia: "vieja" });
  const mio = conf({ historia: "igual" });
  const servidor = conf({ historia: "igual" });
  const r = fusionarConfigRealtyWeb(base, mio, servidor);
  assert.deepEqual(r.conflictos, []);
});

test("la fusión: dos claves de copia distintas conviven; la misma clave choca", () => {
  const base = conf({ copia: { "portada.cta": "A" } });
  const mio = conf({ copia: { "portada.cta": "A", "inmuebles.cta": "Mío" } });
  const servidor = conf({ copia: { "portada.cta": "A", "contacto.enviar": "Suyo" } });
  const ok = fusionarConfigRealtyWeb(base, mio, servidor);
  assert.deepEqual(ok.conflictos, []);
  assert.equal(ok.config.copia["inmuebles.cta"], "Mío");
  assert.equal(ok.config.copia["contacto.enviar"], "Suyo");

  const choque = fusionarConfigRealtyWeb(
    conf({ copia: { "portada.cta": "A" } }),
    conf({ copia: { "portada.cta": "Mío" } }),
    conf({ copia: { "portada.cta": "Suyo" } }),
  );
  assert.equal(choque.conflictos.length, 1);
  assert.match(choque.conflictos[0], /portada\.cta/);
});

test("la fusión: BORRAR una clave que el otro no tocó no la resucita", () => {
  const base = conf({ copia: { "portada.cta": "A" } });
  const mio = conf({ copia: {} });
  const servidor = conf({ copia: { "portada.cta": "A" } });
  const r = fusionarConfigRealtyWeb(base, mio, servidor);
  assert.equal("portada.cta" in r.config.copia, false);
  assert.deepEqual(r.conflictos, []);
});

test("la fusión: el ORDEN de las claves de jsonb no es una diferencia", () => {
  // Postgres no conserva el orden de inserción en jsonb: sin serialización
  // canónica, dos objetos idénticos reordenados darían conflicto siempre.
  const base = conf();
  const mio = conf({ credenciales: [{ titulo: "EC0110.02", folio: "1" }] });
  const servidor = conf({ credenciales: [{ folio: "1", titulo: "EC0110.02" }] });
  const r = fusionarConfigRealtyWeb(base, mio, servidor);
  assert.deepEqual(r.conflictos, []);
});

// ── Los tres caminos de PÉRDIDA SILENCIOSA que encontró la revisión ──
//
// Los tres tenían la misma pinta: el sistema decía "listo" y algo se había
// borrado. Van con prueba porque un 409 mal resuelto es peor que un 409.

test('"publicar lo mío" NO revierte lo que el otro cambió y yo no toqué', () => {
  // Ana toca la historia. Beto toca la historia Y el título de Google.
  // Ana elige "publicar lo mío": debe ganar SU historia y sobrevivir el
  // título de Beto, que Ana nunca vio ni tocó. Con `gana: "servidor"` (el
  // guardado normal) ganaría la historia de Beto.
  const base = conf({ historia: "vieja", seoTitulo: "" });
  const mio = conf({ historia: "la de Ana", seoTitulo: "" });
  const servidor = conf({ historia: "la de Beto", seoTitulo: "Casas en Providencia" });

  const aFavorDeMio = fusionarConfigRealtyWeb(base, mio, servidor, "mio");
  assert.equal(aFavorDeMio.config.historia, "la de Ana", "no ganó lo mío en el campo en disputa");
  assert.equal(
    aFavorDeMio.config.seoTitulo,
    "Casas en Providencia",
    "se revirtió en silencio un campo que el otro cambió y yo no toqué",
  );

  // Y el default sigue siendo el del servidor, que es el que usa el PATCH.
  const normal = fusionarConfigRealtyWeb(base, mio, servidor);
  assert.equal(normal.config.historia, "la de Beto");
});

test("la plantilla también se puede resolver a favor de lo mío", () => {
  assert.equal(fusionarPlantilla("clasica", "boutique", "corporativa", "mio").template, "boutique");
  assert.equal(fusionarPlantilla("clasica", "boutique", "corporativa").template, "corporativa");
});

test("editar el TÍTULO mientras el otro edita la BAJADA no es conflicto", () => {
  // Un bloque son tres campos independientes. Tratándolo como un objeto
  // entero, esto daba 409 aunque hubieran tocado cosas distintas — y al
  // resolverlo se perdía la bajada del otro.
  const vacio = { visible: true, titulo: null, subtitulo: null };
  const base = conf({ bloques: { portada: { ...vacio } } });
  const mio = conf({ bloques: { portada: { ...vacio, titulo: "Casas en Providencia" } } });
  const servidor = conf({ bloques: { portada: { ...vacio, subtitulo: "Trato directo" } } });

  const r = fusionarConfigRealtyWeb(base, mio, servidor);
  assert.deepEqual(r.conflictos, [], "409 falso: cambiaron campos distintos del mismo bloque");
  assert.equal(r.config.bloques.portada.titulo, "Casas en Providencia");
  assert.equal(r.config.bloques.portada.subtitulo, "Trato directo");
});

test("apagar una sección mientras el otro le cambia el título tampoco choca", () => {
  const vacio = { visible: true, titulo: null, subtitulo: null };
  const base = conf({ bloques: { equipo: { ...vacio } } });
  const mio = conf({ bloques: { equipo: { ...vacio, visible: false } } });
  const servidor = conf({ bloques: { equipo: { ...vacio, titulo: "Quién te atiende" } } });

  const r = fusionarConfigRealtyWeb(base, mio, servidor);
  assert.deepEqual(r.conflictos, []);
  assert.equal(r.config.bloques.equipo.visible, false);
  assert.equal(r.config.bloques.equipo.titulo, "Quién te atiende");
});

test("el MISMO campo de un bloque a valores distintos SÍ choca, y se nombra el campo", () => {
  const vacio = { visible: true, titulo: null, subtitulo: null };
  const base = conf({ bloques: { portada: { ...vacio } } });
  const mio = conf({ bloques: { portada: { ...vacio, titulo: "El mío" } } });
  const servidor = conf({ bloques: { portada: { ...vacio, titulo: "El suyo" } } });

  const r = fusionarConfigRealtyWeb(base, mio, servidor);
  assert.equal(r.conflictos.length, 1);
  assert.match(r.conflictos[0], /el título de «portada»/);
});

test("la plantilla se fusiona con la misma regla", () => {
  assert.deepEqual(fusionarPlantilla("clasica", "clasica", "boutique"), {
    template: "boutique",
    conflicto: false,
  });
  assert.deepEqual(fusionarPlantilla("clasica", "boutique", "clasica"), {
    template: "boutique",
    conflicto: false,
  });
  assert.equal(fusionarPlantilla("clasica", "boutique", "corporativa").conflicto, true);
});

/* ══════════════════════════════════════════════════════════════════
   4 · LA WEB ES PÚBLICA: nada sensible sale
   ══════════════════════════════════════════════════════════════════ */

/** Un valor que no puede aparecer en ningún DTO público. Si sale, se ve. */
const SECRETO = "NO-DEBE-SALIR-JAMAS";

test("el DTO del inmueble no deja salir nada privado", () => {
  const dto = aInmueblePublico({
    id: "p1",
    title: "Casa en Chapalita",
    publicUrlSlug: "casa-chapalita",
    kind: "CASA",
    operation: "VENTA",
    status: "DISPONIBLE",
    price: 4_500_000,
    currency: "MXN",
    showExactAddress: false,
    address: "Calle Secreta 123",
    colonia: "Chapalita",
    city: "Guadalajara",
    lat: 20.6736,
    lng: -103.344,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    photos: [],
    tours: [],
    // Todo lo que NO puede salir:
    accountId: SECRETO,
    internalNotes: SECRETO,
    commissionPct: 5,
    ownerId: SECRETO,
    owner: { name: SECRETO, phone: SECRETO, rfc: SECRETO },
    assignedUserId: SECRETO,
    officeId: SECRETO,
    documents: [{ url: SECRETO }],
    isPublished: true,
  });

  const json = JSON.stringify(dto);
  assert.equal(json.includes(SECRETO), false, `se filtró un valor privado: ${json}`);
  for (const campo of REALTY_WEB_CAMPOS_PROHIBIDOS) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(dto, campo),
      false,
      `el DTO del inmueble expone "${campo}"`,
    );
  }
});

test("sin showExactAddress no salen ni la calle ni las coordenadas", () => {
  const privado = aInmueblePublico({
    id: "p1",
    title: "Casa",
    showExactAddress: false,
    address: "Calle Secreta 123",
    lat: 20.6736,
    lng: -103.344,
    colonia: "Chapalita",
    photos: [],
    tours: [],
  });
  assert.equal(privado.direccion, null, "salió la calle con la privacidad activada");
  assert.equal(privado.lat, null, "salió la latitud: un pin a siete decimales ES la dirección");
  assert.equal(privado.lng, null);
  assert.equal(privado.colonia, "Chapalita", "la colonia SÍ debe salir");

  const publico = aInmueblePublico({
    id: "p2",
    title: "Casa",
    showExactAddress: true,
    address: "Av. Vallarta 100",
    lat: 20.6736,
    lng: -103.344,
    photos: [],
    tours: [],
  });
  assert.equal(publico.direccion, "Av. Vallarta 100");
  assert.equal(publico.lat, 20.6736);
});

test("el DTO del asesor no deja salir su correo (que es su usuario del panel)", () => {
  const dto = aAgentePublico({
    displayName: "Ana López",
    photoUrl: "https://x.test/a.webp",
    bio: "Diez años en la zona",
    zones: ["Providencia"],
    specialties: ["Residencial"],
    credentials: [{ titulo: "EC0110.02", folio: "77" }],
    socials: { whatsapp: "3312345678", instagram: "analopez" },
    publicSlug: "ana-lopez",
    // Privado:
    email: SECRETO,
    supabaseId: SECRETO,
    permissionsOverride: [SECRETO],
    realtyUserId: SECRETO,
    accountId: SECRETO,
  });

  const json = JSON.stringify(dto);
  assert.equal(json.includes(SECRETO), false, `se filtró un valor privado: ${json}`);
  assert.equal(Object.prototype.hasOwnProperty.call(dto, "email"), false);
  assert.equal(dto.whatsapp, "523312345678", "el WhatsApp sí sale, ya normalizado");
});

test("el DTO de la cuenta no deja salir tokens ni Stripe", () => {
  const dto = aCuentaPublica({
    slug: "mi-inmobiliaria",
    name: "Mi Inmobiliaria",
    mode: "AGENCY",
    phone: "3312345678",
    city: "Guadalajara",
    logoUrl: "https://x.test/l.webp",
    licenseNumber: "JAL-001",
    licenseState: "Jalisco",
    licenseExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
    // Privado:
    whatsappToken: SECRETO,
    wabaId: SECRETO,
    phoneNumberId: SECRETO,
    stripeCustomerId: SECRETO,
    stripeSubscriptionId: SECRETO,
    subscriptionStatus: SECRETO,
    storageUsedBytes: 123,
    legalName: SECRETO,
    teamSize: SECRETO,
    plan: SECRETO,
  });

  const json = JSON.stringify(dto);
  assert.equal(json.includes(SECRETO), false, `se filtró un valor privado: ${json}`);
  for (const campo of REALTY_WEB_CAMPOS_PROHIBIDOS) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(dto, campo),
      false,
      `el DTO de la cuenta expone "${campo}"`,
    );
  }
  assert.deepEqual(dto.licencia, { numero: "JAL-001", estado: "Jalisco" });
});

test("el correo de la CUENTA no sale: es el usuario con el que se entra al panel", () => {
  // El alta escribe el MISMO valor en RealtyAccount.email y en
  // RealtyUser.email, que es la credencial (@@unique([accountId, email])).
  // Publicarlo regala media llave, y el sitemap lista todas las cuentas que
  // pagan. El correo público es el que se escribe a mano en el editor.
  const dto = aCuentaPublica({
    slug: "x",
    name: "X",
    mode: "AGENCY",
    email: SECRETO,
  });
  assert.equal(JSON.stringify(dto).includes(SECRETO), false, "salió el correo del login");
  assert.equal(Object.prototype.hasOwnProperty.call(dto, "correo"), false);
});

test("una URL FIRMADA del bucket privado nunca llega a una foto ni a un recorrido", () => {
  // realty-files es privado y sirve URLs de cinco minutos. Si una de esas
  // llegara a RealtyPropertyPhoto.url, el token quedaría incrustado en una
  // página ISR cacheada: la fuga de tokens del dental, otra vez.
  const firmadas = [
    `https://x.supabase.co/storage/v1/object/sign/realty-files/a.webp?token=${SECRETO}`,
    `https://x.s3.amazonaws.com/a.webp?X-Amz-Signature=${SECRETO}`,
    `https://x.test/a.webp?signature=${SECRETO}`,
  ];
  for (const url of firmadas) {
    assert.equal(esUrlDeArchivoPublica(url), false, `pasó una URL firmada: ${url}`);
  }
  assert.equal(
    esUrlDeArchivoPublica("https://x.supabase.co/storage/v1/object/public/clinic-public/a.webp"),
    true,
    "se descartó una URL pública legítima",
  );
  assert.equal(esUrlDeArchivoPublica("http://x.test/a.webp"), false, "http en una página https");

  const dto = aInmueblePublico({
    id: "p1",
    title: "Casa",
    showExactAddress: false,
    photos: [{ url: firmadas[0], isCover: true }, { url: "https://x.test/ok.webp" }],
    tours: [{ kind: "TOUR_360", provider: "propio", fileUrl: firmadas[1] }],
  });
  assert.equal(JSON.stringify(dto).includes(SECRETO), false, "se filtró un token de archivo");
  assert.equal(dto.fotos.length, 1, "la foto firmada debía descartarse y la buena quedarse");
  assert.equal(dto.tours.length, 0, "el recorrido con URL firmada debía descartarse");
});

test("una licencia VENCIDA no se presume", () => {
  const dto = aCuentaPublica(
    {
      slug: "x",
      name: "X",
      mode: "AGENT",
      licenseNumber: "JAL-001",
      licenseExpiresAt: new Date("2020-01-01T00:00:00.000Z"),
    },
    new Date("2026-08-25T00:00:00.000Z"),
  );
  assert.equal(dto.licencia, null, "se enseñó una licencia caducada");
});

test("el DTO de la sucursal solo lleva lo que se pinta", () => {
  const dto = aSucursalPublica({
    name: "Matriz",
    address: "Av. Vallarta 100",
    phone: "3312345678",
    isMain: true,
    accountId: SECRETO,
  });
  assert.equal(JSON.stringify(dto).includes(SECRETO), false);
});

/* ══════════════════════════════════════════════════════════════════
   5 · RECORRIDOS: la conversión a URL embebible
   ══════════════════════════════════════════════════════════════════ */

// La conversión a URL embebible vive en el PUNTO ÚNICO del contrato
// (src/lib/realty/tours.ts, de la ola de la cartera). Estas pruebas están
// aquí porque la web pública es quien pinta el iframe: si alguien cambiara
// esa función, el marco saldría en blanco en las fichas y nadie lo
// relacionaría con tours.ts. `?rel=0` es suyo y es correcto: sin él,
// YouTube cierra el recorrido con videos de otra gente.
test("un youtube.com/watch se convierte al embed sin cookies", () => {
  assert.equal(
    realtyTourEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0",
  );
  assert.equal(
    realtyTourEmbedUrl("https://youtube.com/shorts/dQw4w9WgXcQ"),
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0",
  );
});

test("una página de Vimeo se convierte al reproductor", () => {
  assert.equal(realtyTourEmbedUrl("https://vimeo.com/123456789"), "https://player.vimeo.com/video/123456789");
});

test("la liga de COMPARTIR de Matterport (y la de Kuula) se usan tal cual", () => {
  // Solo la de Compartir. Las demás ligas del mismo dominio pasan el filtro
  // de dominio y luego el iframe NO puede mostrarlas: ver la batería
  // completa en src/lib/realty/__tests__/recorridos.test.ts.
  assert.equal(
    realtyTourEmbedUrl("https://my.matterport.com/show/?m=abc123"),
    "https://my.matterport.com/show/?m=abc123",
  );
  assert.equal(realtyTourEmbedUrl("https://kuula.co/share/xyz"), "https://kuula.co/share/xyz");
  assert.equal(realtyTourEmbedUrl("https://matterport.com/discover/space/casa"), null);
});

test("una URL fuera de la allowlist NO se embebe (saldría un marco en blanco)", () => {
  assert.equal(realtyTourEmbedUrl("https://notmatterport.com/show/?m=abc"), null);
  assert.equal(realtyTourEmbedUrl("http://my.matterport.com/show/?m=abc"), null);
  assert.equal(realtyTourEmbedUrl("no-es-una-url"), null);
});
