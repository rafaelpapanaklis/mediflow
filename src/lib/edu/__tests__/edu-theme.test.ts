/**
 * DaleControl INSTITUCIONAL — el tema del vertical no se pisa a sí mismo.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-theme.test.ts
 *
 * ═══════════════════════════════════════════════════════════════════════
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * edu-theme.css es UNA sola hoja de más de seis mil renglones para todo el
 * vertical. Cuando dos olas distintas le ponen el mismo nombre a dos cosas
 * distintas no hay error, no hay aviso y nada se pone rojo: gana la última
 * regla y la pantalla del otro dueño sale torcida. Es la peor forma de
 * fallar, porque solo se ve.
 *
 * Ya pasó EN PRODUCCIÓN. La ola de Casos llamó `.edu-linea` a la línea de
 * tiempo del resumen de la ficha. Ese nombre YA era de los renglones del
 * cobro de Caja, que declara `grid-template-columns: minmax(0,1fr) 88px
 * 110px auto auto`. La línea de tiempo heredó esas cinco columnas y sus
 * entradas salieron UNA JUNTO A OTRA —900px y 88px en escritorio, con el
 * texto partido letra por letra— en vez de apiladas. Se arregló
 * renombrando a la recién llegada, que pasó a ser `.edu-historia`. El
 * candado contra la próxima es esto.
 *
 * QUÉ CUENTA COMO CHOQUE
 *
 * Solo los bloques de PRIMER NIVEL cuyo selector es una clase sola
 * (`.edu-algo {`). También se miran los selectores agrupados por comas:
 * `.edu-shell, .edu-auth {` declara las dos. Lo que NO cuenta:
 *
 *   · lo que está dentro de @media/@container/@supports — reescribir una
 *     clase en otro ancho es lo normal, no un choque;
 *   · `.dark .edu-x`, `.edu-x:hover`, `.edu-a.edu-b` — no son una clase
 *     sola, son otra cosa;
 *   · `.edu-x--mod` y `.edu-x__hijo` — son nombres propios, distintos de
 *     `.edu-x`.
 *
 * LOS PERDONES
 *
 * Hoy quedan dos choques legítimos, y son el MISMO patrón: el bloque de
 * tokens de arriba nombra a `.edu-shell` y a `.edu-auth` juntos para
 * darles la misma paleta, y más abajo cada uno tiene su propia regla de
 * maquetación. Están escritos uno por uno, con los selectores EXACTOS que
 * se les perdonan: si aparece un tercer bloque, o cambia la forma de los
 * dos de hoy, la prueba se pone roja igual. Una lista que perdonara "esta
 * clase donde sea" no serviría de nada, y una que perdonara de más se
 * pudre sola: por eso la segunda prueba exige que cada perdón siga
 * haciendo falta.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EDU_RESUMEN_TIMELINE_KIND_LABELS } from "../resumen-core";

const RAIZ = join(__dirname, "..", "..", "..", "..");

const TEMA = "src/app/instituto/edu-theme.css";
const FICHA = "src/app/instituto/(panel)/pacientes/[id]/page.tsx";

function crudo(...tramos: string[]): string {
  return readFileSync(join(RAIZ, ...tramos), "utf8");
}

/**
 * Los comentarios fuera, pero dejando los saltos de línea en su sitio: así
 * los números de renglón que se imprimen en un fallo son los del archivo
 * de verdad y se puede ir directo a mirarlos.
 */
function sinComentarios(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

/** Un selector que es UNA clase y nada más. */
const CLASE_SOLA = /^\.[A-Za-z_][A-Za-z0-9_-]*$/;

interface Sitio {
  linea: number;
  /** El selector completo del bloque, con los espacios normalizados. */
  preludio: string;
}

/**
 * Recorre la hoja contando llaves y devuelve, por cada clase declarada en
 * un bloque de PRIMER NIVEL, dónde se declaró. Se cuenta a mano en vez de
 * con una expresión regular porque hay que saber la profundidad: una regla
 * dentro de un @media no es una declaración nueva, es la misma clase en
 * otro ancho.
 */
function declaracionesDePrimerNivel(css: string): Map<string, Sitio[]> {
  const texto = sinComentarios(css);
  const donde = new Map<string, Sitio[]>();
  let profundidad = 0;
  let inicio = 0;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === "{") {
      if (profundidad === 0) {
        const preludio = texto.slice(inicio, i);
        // `@media`, `@keyframes`, `@font-face`… no declaran clases.
        if (!preludio.trimStart().startsWith("@")) {
          const linea = texto.slice(0, i).split("\n").length;
          const normalizado = preludio.trim().replace(/\s+/g, " ");
          for (const parte of preludio.split(",")) {
            const selector = parte.trim();
            if (CLASE_SOLA.test(selector)) {
              const sitios = donde.get(selector) ?? [];
              sitios.push({ linea, preludio: normalizado });
              donde.set(selector, sitios);
            }
          }
        }
      }
      profundidad++;
    } else if (c === "}") {
      profundidad--;
      if (profundidad === 0) inicio = i + 1;
    }
  }

  assert.equal(
    profundidad,
    0,
    "las llaves de edu-theme.css no cierran: el recorrido quedó descuadrado y " +
      "esta prueba no estaría mirando lo que cree — arregla el CSS primero",
  );
  return donde;
}

/**
 * Los choques que SÍ se perdonan, escritos a mano y uno por uno. `sitios`
 * son los selectores exactos que se esperan, en el orden en que aparecen:
 * cualquier otra cosa —un tercer bloque, o uno de estos dos cambiado— no
 * está perdonada.
 */
const PERDONADOS: ReadonlyArray<{
  clase: string;
  sitios: readonly string[];
  porque: string;
}> = [
  {
    clase: ".edu-shell",
    sitios: [".edu-shell, .edu-auth", ".edu-shell"],
    porque:
      "el bloque de arriba le da la paleta del vertical al panel y al login a la vez; " +
      "el segundo es la maquetación del panel, que el login no comparte",
  },
  {
    clase: ".edu-auth",
    sitios: [".edu-shell, .edu-auth", ".edu-auth"],
    porque:
      "mismo caso que .edu-shell: hereda los tokens del bloque compartido y luego " +
      "declara su propia maquetación, la del login de /instituto",
  },
];

/* ═══════════════════════════════════════════════════════════════════════
 * 1 · El candado: dos bloques no pueden bautizarse igual
 * ═══════════════════════════════════════════════════════════════════════ */

test("ninguna clase del tema se declara en dos bloques distintos", () => {
  const declaraciones = declaracionesDePrimerNivel(crudo(TEMA));

  // Si el recorrido se rompiera, el mapa saldría casi vacío y la prueba
  // pasaría sin mirar nada. Que sean muchas es la señal de que sí leyó.
  assert.ok(
    declaraciones.size > 300,
    `solo se encontraron ${declaraciones.size} clases en edu-theme.css: el recorrido ` +
      "no está leyendo la hoja y esta prueba estaría pasando en falso",
  );

  const problemas: string[] = [];
  for (const [clase, sitios] of declaraciones) {
    if (sitios.length < 2) continue;

    const perdon = PERDONADOS.find((p) => p.clase === clase);
    const lugares = sitios.map((s) => `línea ${s.linea} (${s.preludio})`).join(" y ");

    if (!perdon) {
      problemas.push(
        `${clase} se declara ${sitios.length} veces: ${lugares}.\n` +
          "    Son dos dueños distintos con el mismo nombre: el segundo hereda las\n" +
          "    propiedades del primero (columnas, display, padding…) y su pantalla sale\n" +
          "    torcida sin que nada falle. Renombra al RECIÉN LLEGADO con su propio\n" +
          "    prefijo y toda su familia (__hijo, --modificador). NO lo tapes\n" +
          "    redeclarando propiedades: el próximo cambio del dueño original lo rompe\n" +
          "    otra vez.",
      );
      continue;
    }

    const vistos = sitios.map((s) => s.preludio);
    if (vistos.length !== perdon.sitios.length || vistos.some((v, i) => v !== perdon.sitios[i])) {
      problemas.push(
        `${clase} está perdonada, pero ya no con la forma que se le perdonó.\n` +
          `    Se esperaba: ${perdon.sitios.join(" + ")}\n` +
          `    Se encontró: ${vistos.join(" + ")} (${lugares}).\n` +
          `    El perdón dice: ${perdon.porque}.\n` +
          "    Si el cambio es a propósito, actualiza PERDONADOS en este archivo y\n" +
          "    explica por qué el choque nuevo también es legítimo.",
      );
    }
  }

  assert.deepEqual(
    problemas,
    [],
    "edu-theme.css tiene nombres de clase que chocan:\n\n  · " + problemas.join("\n\n  · ") + "\n",
  );
});

/* ═══════════════════════════════════════════════════════════════════════
 * 2 · La lista de perdones no puede engordar sola
 * ═══════════════════════════════════════════════════════════════════════ */

test("cada perdón de PERDONADOS sigue haciendo falta", () => {
  const declaraciones = declaracionesDePrimerNivel(crudo(TEMA));

  for (const perdon of PERDONADOS) {
    const sitios = declaraciones.get(perdon.clase) ?? [];
    assert.ok(
      sitios.length > 1,
      `${perdon.clase} está en PERDONADOS pero ya solo se declara ${sitios.length} vez: ` +
        "borra la entrada. Un perdón que ya no hace falta es un agujero abierto para " +
        "el día que alguien vuelva a usar ese nombre.",
    );
  }
});

/* ═══════════════════════════════════════════════════════════════════════
 * 3 · La regresión concreta: la historia del resumen ya no es `.edu-linea`
 * ═══════════════════════════════════════════════════════════════════════ */

test("la línea de tiempo del resumen no comparte nombre con los renglones de Caja", () => {
  const css = crudo(TEMA);
  const declaraciones = declaracionesDePrimerNivel(css);

  const linea = declaraciones.get(".edu-linea") ?? [];
  assert.equal(
    linea.length,
    1,
    `.edu-linea debe tener UN solo dueño —los renglones del cobro de Caja— y se ` +
      `declara ${linea.length} veces: ${linea.map((s) => s.linea).join(", ")}`,
  );

  // El dueño legítimo se reconoce porque reparte columnas: eso es justo lo
  // que heredaba la línea de tiempo cuando se llamaba igual.
  const bloqueCaja = css.slice(css.indexOf(".edu-linea {"));
  assert.match(
    bloqueCaja.slice(0, bloqueCaja.indexOf("}")),
    /grid-template-columns/,
    ".edu-linea sigue siendo el renglón del cobro de Caja, el que declara columnas: " +
      "si esto cambió, revisa que el nombre no se lo haya quedado otra pantalla",
  );

  assert.equal(
    (declaraciones.get(".edu-historia") ?? []).length,
    1,
    ".edu-historia (la línea de tiempo del resumen) debe declararse exactamente una vez",
  );

  const ficha = crudo(FICHA).replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
  assert.equal(
    /edu-linea/.test(ficha),
    false,
    "la ficha del paciente volvió a usar `edu-linea`, que es de Caja: sus columnas " +
      "reparten las entradas de la historia una junto a otra en vez de apiladas",
  );
});

/* ═══════════════════════════════════════════════════════════════════════
 * 4 · La ficha y el tema hablan de las mismas clases
 * ═══════════════════════════════════════════════════════════════════════ */

test("cada clase edu-historia que usa la ficha existe en el tema", () => {
  const css = crudo(TEMA);
  const ficha = crudo(FICHA);

  // Las que se escriben enteras en el JSX. Las que terminan en `--` son el
  // arranque de una plantilla (`edu-historia__punto--${t.kind}`) y se
  // comprueban abajo, kind por kind.
  const usadas = [...new Set(ficha.match(/edu-historia[A-Za-z0-9_-]*/g) ?? [])].filter(
    (c) => !c.endsWith("--"),
  );
  assert.ok(usadas.length > 0, "la ficha ya no usa ninguna clase edu-historia: ¿la renombraron?");

  for (const clase of usadas) {
    assert.ok(
      css.includes(`.${clase} {`),
      `la ficha usa .${clase} pero edu-theme.css no la declara: el renombre quedó a medias`,
    );
  }

  // Cada tipo de entrada de la historia pinta su punto de un color. Un
  // tipo nuevo sin su regla sale con el color de relleno y nadie se entera.
  for (const kind of Object.keys(EDU_RESUMEN_TIMELINE_KIND_LABELS)) {
    assert.ok(
      css.includes(`.edu-historia__punto--${kind} {`),
      `falta .edu-historia__punto--${kind} en edu-theme.css: la entrada "${kind}" de la ` +
        "historia reciente pintaría su punto con el color de relleno",
    );
  }
});

/* ═══════════════════════════════════════════════════════════════════════
 * 5 · LA REGRESIÓN QUE COSTÓ UN BOTÓN INALCANZABLE
 * ═══════════════════════════════════════════════════════════════════════
 * Historia, para que no se repita: la última columna de la lista de
 * pacientes subió de 96 a 210 px porque le entró un segundo botón. Nadie
 * volvió a sumar las seis pistas. El mínimo de la tabla pasó de ~808 a
 * 922 px, la forma renglón seguía estrenándose a 1180 px de ventana —donde
 * el contenido mide 864, porque el cajón se come 252 y el padding 64— y el
 * botón «Expediente» quedaba 41 px fuera. Encima `.edu-table` llevaba un
 * `overflow: hidden` puesto solo para redondear esquinas, así que el botón
 * no se recortaba "feo": se volvía INALCANZABLE, sin barra y sin gesto.
 *
 * Estas dos pruebas son las reglas 3, 4 y 6 de la cabecera de la hoja,
 * escritas de forma que fallen si alguien vuelve a tocar una pista sin
 * volver a sumar.
 */

/** El ancho mínimo real de una rejilla `--edu-cols`, pista a pista. */
function anchoMinimoDeTabla(css: string, tabla: string): number {
  const m = new RegExp(`\\.edu-table--${tabla}\\s*\\{\\s*--edu-cols:\\s*([^;]+);`).exec(
    sinComentarios(css),
  );
  assert.ok(m, `edu-theme.css ya no declara --edu-cols para .edu-table--${tabla}`);

  // Separar por espacios respetando los paréntesis de minmax().
  const pistas: string[] = [];
  let hondo = 0;
  let actual = "";
  for (const ch of m![1].replace(/\s+/g, " ").trim()) {
    if (ch === "(") hondo++;
    if (ch === ")") hondo--;
    if (ch === " " && hondo === 0) {
      if (actual) pistas.push(actual);
      actual = "";
    } else {
      actual += ch;
    }
  }
  if (actual) pistas.push(actual);

  let suma = 0;
  for (const pista of pistas) {
    // El SUELO de la pista: el primer argumento de minmax(), o el número
    // a secas. Es lo que la rejilla no puede bajar.
    const mm = /^minmax\(\s*([0-9.]+)px\s*,/.exec(pista);
    const px = /^([0-9.]+)px$/.exec(pista);
    assert.ok(mm || px, `pista con suelo no medible en .edu-table--${tabla}: "${pista}"`);
    suma += parseFloat((mm ?? px)![1]);
  }

  const HUECO = 12; // gap del renglón
  const PADDING = 32; // .edu-row: padding 12px 16px
  const BORDE = 2; // borde de .edu-table
  return suma + (pistas.length - 1) * HUECO + PADDING + BORDE;
}

test("la lista de pacientes no se hace renglón antes de caber (reglas 3 y 6)", () => {
  const css = crudo(TEMA);
  const minimo = anchoMinimoDeTabla(css, "pacientes");

  const m = /@container edu-tabla \(min-width:\s*([0-9.]+)px\)/.exec(sinComentarios(css));
  assert.ok(m, "la lista de pacientes ya no se mide con @container: ¿volvió a medir la ventana?");
  const umbral = parseFloat(m![1]);

  assert.equal(
    umbral,
    minimo,
    `el umbral de la forma renglón (${umbral} px) no es la suma de las pistas ` +
      `(${minimo} px). Si acabas de cambiar el ancho de UNA columna, vuelve a sumar las ` +
      "SEIS y pon ese número en el @container: el corte de «Expediente» nació exactamente " +
      "de no hacerlo (regla 6).",
  );

  // Y que quepa donde Rafael trabaja: con la ventana en 1180 px al
  // contenido le quedan 864 (1180 − 252 del cajón − 64 del padding).
  assert.ok(
    minimo <= 864,
    `la fila pide ${minimo} px y en un portátil de 1180 px solo hay 864: se vería recortada ` +
      "en toda la franja 1180-1235. Acorta un rótulo o baja una pista (regla 7).",
  );
});

/** Los bloques `@container edu-tabla (min-width: N)` de primer nivel, con
 *  su umbral y su cuerpo. Se cuentan las llaves a mano —igual que arriba—
 *  porque dentro hay reglas anidadas y una expresión regular perezosa se
 *  quedaría en la primera de ellas. */
function bloquesDeContenedor(css: string): { umbral: number; cuerpo: string }[] {
  const texto = sinComentarios(css);
  const re = /@container edu-tabla \(min-width:\s*([0-9.]+)px\)\s*\{/g;
  const out: { umbral: number; cuerpo: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    let profundidad = 1;
    let i = m.index + m[0].length;
    const desde = i;
    for (; i < texto.length && profundidad > 0; i++) {
      if (texto[i] === "{") profundidad++;
      else if (texto[i] === "}") profundidad--;
    }
    assert.equal(profundidad, 0, `el @container de ${m[1]}px no cierra`);
    out.push({ umbral: parseFloat(m[1]), cuerpo: texto.slice(desde, i - 1) });
  }
  return out;
}

test("NINGUNA tabla envuelta recorta con overflow: hidden (regla 4)", () => {
  const bloques = bloquesDeContenedor(crudo(TEMA));

  // Ola B: las 26 listas del vertical se miden a sí mismas. Si el número
  // baja, es que alguna volvió a medir la ventana.
  assert.ok(
    bloques.length >= 7,
    `solo hay ${bloques.length} bloques @container de listas y tiene que haber uno por cubo ` +
      "más el de pacientes: ¿alguna lista volvió a un @media?",
  );

  for (const { umbral, cuerpo } of bloques) {
    assert.ok(
      !/overflow:\s*hidden/.test(cuerpo),
      `el @container de ${umbral}px vuelve a llevar un \`overflow: hidden\`. Ese overflow ` +
        "estaba ahí solo para redondear esquinas y es lo que dejó el botón «Expediente» " +
        "INALCANZABLE: recortaba sin barra y sin gesto. El radio va en `.edu-rowhead` y en " +
        "la última fila, y quien se desplaza es el envoltorio (regla 4).",
    );
    assert.ok(
      /min-width:\s*fit-content/.test(cuerpo),
      `al @container de ${umbral}px le falta \`min-width: fit-content\`: sin él la tabla se ` +
        "encoge al ancho del envoltorio y la rejilla se sale por debajo en vez de hacer que " +
        "el envoltorio se desplace",
    );
  }
});

/* ═══════════════════════════════════════════════════════════════════════
 * 6 · OLA B · TODA LISTA QUE SE HACE RENGLÓN TIENE SU ENVOLTORIO
 * ═══════════════════════════════════════════════════════════════════════
 * La forma renglón de una tabla vive ahora en un `@container`, y un
 * `@container` sin `container-type` arriba NO SE APLICA NUNCA: la tabla se
 * quedaría en forma tarjeta para siempre, en todos los anchos, sin que
 * nada falle ni se ponga rojo. Es exactamente la forma de fallar que este
 * archivo existe para cazar — solo se ve.
 *
 * Así que por cada `.edu-table--X` que aparezca dentro de un `@container`,
 * esta prueba busca el JSX que la pinta y exige que esté envuelta en
 * `.edu-tablewrap`.
 */

/** Todos los `.tsx` bajo src/, para buscar quién pinta cada tabla. */
function pantallas(): string[] {
  const out: string[] = [];
  const pila = [join(RAIZ, "src")];
  while (pila.length > 0) {
    const dir = pila.pop()!;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, e.name);
      if (e.isDirectory()) pila.push(ruta);
      else if (e.name.endsWith(".tsx")) out.push(ruta);
    }
  }
  return out;
}

test("cada lista que se hace renglón está envuelta en .edu-tablewrap (Ola B)", () => {
  const css = crudo(TEMA);
  const clases = new Set<string>();
  for (const { cuerpo } of bloquesDeContenedor(css)) {
    for (const m of cuerpo.matchAll(/\.edu-table--([a-z]+)/g)) clases.add(m[1]);
  }
  assert.ok(clases.size >= 20, `solo se encontraron ${clases.size} listas en los @container`);

  const fuentes = pantallas().map((f) => ({ f, src: readFileSync(f, "utf8") }));

  const sinPantalla: string[] = [];
  const sinEnvoltorio: string[] = [];

  for (const clase of [...clases].sort()) {
    const marca = `edu-table edu-table--${clase}`;
    const duenos = fuentes.filter((x) => x.src.includes(marca));
    if (duenos.length === 0) {
      sinPantalla.push(clase);
      continue;
    }
    for (const { f, src } of duenos) {
      // El envoltorio es el padre INMEDIATO en el marcado: se comprueba
      // que cada aparición de la tabla venga precedida por él sin nada
      // entre medias salvo espacios y un comentario JSX.
      const re = new RegExp(
        `<div className="edu-tablewrap">\\s*(?:\\{/\\*[\\s\\S]*?\\*/\\}\\s*)?<div className="${marca}"`,
      );
      const veces = (src.match(new RegExp(marca, "g")) ?? []).length;
      const envueltas = (src.match(new RegExp(re.source, "g")) ?? []).length;
      if (envueltas < veces) {
        sinEnvoltorio.push(`${clase} (${f.slice(f.indexOf("src/"))}: ${envueltas}/${veces})`);
      }
    }
  }

  assert.deepEqual(
    sinEnvoltorio,
    [],
    "estas listas se hacen renglón con un `@container` pero su tabla NO está envuelta en " +
      "`.edu-tablewrap`: sin envoltorio no hay contenedor que medir, así que la forma " +
      "renglón no se estrena NUNCA y la lista se queda en tarjetas a cualquier ancho. Es un " +
      "fallo que no rompe nada y solo se ve:\n  · " + sinEnvoltorio.join("\n  · "),
  );

  // Las tres clases sin dueño son conocidas y están escritas aquí a
  // propósito: si aparece una CUARTA, alguien acaba de dejar una lista sin
  // envolver o de borrar una pantalla.
  assert.deepEqual(
    sinPantalla.sort(),
    ["diralumnos", "notas", "usosillones"],
    "cambió la lista de clases `.edu-table--*` que no usa ningún JSX. Si acabas de estrenar " +
      "una de ellas, envuélvela en `.edu-tablewrap` y quítala de aquí; si acabas de dejar " +
      "otra sin marcado, revisa por qué.",
  );
});

/* ═══════════════════════════════════════════════════════════════════════
 * 7 · OLA B · EL CSS QUE SE RETIRÓ NO PUEDE VOLVER SOLO
 * ═══════════════════════════════════════════════════════════════════════ */

test("`.edu-fichahead` y `.edu-fichaalertas` se retiraron y no vuelven", () => {
  const css = sinComentarios(crudo(TEMA));

  // Las cuatro fichas del vertical (paciente, estudiante, docente y la
  // bitácora) usan `.edu-fichahero`. `.edu-fichahead` se quedó sin una
  // sola pantalla, y CSS sin dueño es lo que se copia por error a la
  // quinta.
  for (const clase of [".edu-fichahead", ".edu-fichaalertas"]) {
    assert.equal(
      new RegExp(`\\${clase}[\\s,{]`).test(css),
      false,
      `${clase} volvió a edu-theme.css. Se retiró en la Ola B porque no la usaba ninguna ` +
        "pantalla: las cuatro fichas llevan `.edu-fichahero`. Si de verdad hace falta un " +
        "encabezado plano otra vez, es el hero con menos cosas — no este nombre.",
    );
  }

  // Lo que SÍ sigue vivo: el enlace de antecedentes, que la ficha del
  // paciente pinta al final de los chips, ya dentro del hero.
  assert.ok(
    css.includes(".edu-fichaalertas__link {"),
    "se retiró de más: `.edu-fichaalertas__link` sí se usa (el chip «Antecedentes»)",
  );
});

test("las CUATRO fichas usan la misma cabecera", () => {
  const fichas = [
    "src/app/instituto/(panel)/pacientes/[id]/layout.tsx",
    "src/app/instituto/(panel)/estudiantes/[id]/layout.tsx",
    "src/app/instituto/(panel)/docentes/[id]/layout.tsx",
    "src/components/edu/evaluacion/bitacora-screen.tsx",
  ];
  for (const ficha of fichas) {
    const src = crudo(...ficha.split("/"));
    assert.ok(
      src.includes('className="edu-fichahero"'),
      `${ficha} no usa .edu-fichahero: las cuatro fichas del vertical comparten cabecera`,
    );
    assert.ok(
      src.includes("edu-fichahero__avatar"),
      `${ficha} perdió el recuadro de iniciales`,
    );
    assert.ok(
      src.includes("edu-fichadato"),
      `${ficha} volvió a unir los datos clave con un join(" · ") en una línea gris`,
    );
  }
});

test("el envoltorio de las listas es el contenedor, y la tabla no", () => {
  const css = sinComentarios(crudo(TEMA));
  const wrap = /\.edu-tablewrap\s*\{([\s\S]*?)\}/.exec(css);
  assert.ok(wrap, "falta el bloque .edu-tablewrap");
  assert.ok(/container-type:\s*inline-size/.test(wrap![1]));
  assert.ok(/container-name:\s*edu-tabla/.test(wrap![1]));
  assert.ok(
    /overflow-x:\s*auto/.test(wrap![1]),
    "el envoltorio tiene que desplazarse: es la red de seguridad de la regla 4",
  );

  // Una consulta de contenedor NO puede dar estilo a su propio contenedor.
  // Si alguien mueve `container-type` a `.edu-table`, la forma renglón deja
  // de aplicarse a la tabla (fondo, borde, radio) y nadie ve por qué.
  const tabla = /\n\.edu-table\s*\{([\s\S]*?)\}/.exec(css);
  assert.ok(tabla, "falta el bloque base .edu-table");
  assert.ok(
    !/container-type/.test(tabla![1]),
    "`.edu-table` NO puede ser el contenedor: una @container no estiliza a su propio " +
      "contenedor, así que la tabla se quedaría sin fondo, sin borde y sin radio en " +
      "escritorio. El contenedor es `.edu-tablewrap`.",
  );
});
