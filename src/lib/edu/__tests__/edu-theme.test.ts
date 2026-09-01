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
import { readFileSync } from "node:fs";
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
