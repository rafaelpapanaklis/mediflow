/**
 * EL VISOR DE ESTUDIOS DEL INSTITUTO — el del dental, montado en la ficha.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-visor.test.ts
 *
 * ═══════════════════════════════════════════════════════════════════════
 * QUÉ CAMBIÓ, Y POR QUÉ CAMBIÓ ESTE ARCHIVO ENTERO
 *
 * El vertical tenía un visor CBCT PROPIO (cbct-viewer.tsx y sus cuatro
 * acompañantes): 984 líneas que reproducían el del dental con otra pinta,
 * abrían en una hoja a pantalla completa y traían su propia panorámica.
 * Se retiró. Ahora se monta el visor del DENTAL —el mismo que ve un
 * dentista— dentro de un modal del vertical, y lo único que el instituto
 * pone es la hoja, el CSS y las rutas de servidor.
 *
 * Lo que esta prueba vigila es, por tanto, otra cosa. Ya no hay medidas
 * propias que cuadrar: hay una FRONTERA con un producto vivo que no
 * controlamos. Y las fronteras se rompen en silencio.
 *
 *   1. Que la elección del visor la haga la EXTENSIÓN, y que sea la misma
 *      que hace el dental. Se EJECUTA (no se busca en el texto): por eso
 *      esa función vive en un módulo sin importaciones.
 *   2. Que no haya vuelto a aparecer una copia del dental dentro del
 *      vertical, ni un resto del fork retirado.
 *   3. Que las dos rutas del visor sean las del INSTITUTO. Es lo único que
 *      separa "ver mi tomografía" de "un 404 mudo": si alguien revierte la
 *      prop `endpoints` del dental, aquí se pone rojo ANTES de que un
 *      alumno lo descubra con el paciente en el sillón.
 *   4. Que la rejilla 2×2 siga cabiendo en la primera pantalla. Depende de
 *      TRES cosas que viven en tres archivos distintos —el punto de corte
 *      del dental, el alto en línea de sus paneles y el @media del tema— y
 *      si se separan no falla nada: solo vuelve el desplazamiento que este
 *      trabajo venía a quitar.
 *   5. Que el panel de notas MUERTO del visor DICOM 2D siga oculto. Guarda
 *      contra las tablas del dental y desde el instituto contesta 404
 *      siempre; se tapa desde el CSS con la clase que el dental le pone, y
 *      el día que el dental cambie esa clase el botón reaparecería sin que
 *      nada fallara.
 *   6. Que la taxonomía inventada no vuelva a la pantalla.
 *
 * Lo que NO se puede probar aquí: el visor son lienzos, y sin navegador no
 * hay `getBoundingClientRect`, ni `ResizeObserver`, ni un CBCT real que
 * decodificar. Eso se verificó a mano y se dice en el reporte.
 *
 * Los comentarios se quitan antes de buscar: se juzga a un archivo por lo
 * que hace, no por lo que dice su prosa.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { eduVisorPorExtension } from "../../../components/edu/estudios/visor-tipo";

const RAIZ = join(__dirname, "..", "..", "..", "..");

function crudo(...tramos: string[]): string {
  return readFileSync(join(RAIZ, ...tramos), "utf8");
}

/** Un texto sin sus comentarios. */
function sinComentarios(texto: string): string {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
}

/** El archivo, sin comentarios. */
function fuente(...tramos: string[]): string {
  return sinComentarios(crudo(...tramos));
}

/** Todos los .ts/.tsx bajo una carpeta del vertical. */
function archivosDe(...tramos: string[]): string[] {
  const base = join(RAIZ, ...tramos);
  return readdirSync(base, { recursive: true, encoding: "utf8" })
    .filter((p) => p.endsWith(".ts") || p.endsWith(".tsx"))
    .map((p) => join(base, p));
}

const MODAL = "src/components/edu/estudios/visor-modal.tsx";
const TIPO = "src/components/edu/estudios/visor-tipo.ts";
const MALLA = "src/components/edu/estudios/modelo-3d-viewer.tsx";
const VIEWER = "src/components/edu/expediente/estudio-viewer.tsx";
const GALERIA = "src/components/edu/expediente/estudios-screen.tsx";
const SUBIDA = "src/components/edu/expediente/edu-upload-client.ts";
const TEMA = "src/app/instituto/edu-theme.css";

// Los tres visores del dental. Se importan; no se copian.
const DENTAL_CBCT = "src/components/patient-3d/DicomSetViewer.tsx";
const DENTAL_2D = "src/components/patient-3d/DicomViewer2D.tsx";
const DENTAL_TAB = "src/components/patient-3d/Models3DTab.tsx";

/** El bloque del CSS que va desde una regla hasta su llave de cierre. */
function regla(css: string, selector: string): string {
  const i = css.indexOf(selector + " {");
  assert.notEqual(i, -1, `no se encontró la regla ${selector}: ¿la renombraron?`);
  const fin = css.indexOf("}", i);
  return css.slice(i, fin);
}

/* ═══════════════════════════════════════════════════════════════════════
 * 1 · El visor lo elige la EXTENSIÓN, y elige lo mismo que el dental
 * ═══════════════════════════════════════════════════════════════════════ */

test("cada extensión abre el visor que le toca", () => {
  assert.equal(eduVisorPorExtension("cbct-paciente.zip"), "cbct");
  assert.equal(eduVisorPorExtension("corte.dcm"), "dicom");
  assert.equal(eduVisorPorExtension("corte.dicom"), "dicom");
  assert.equal(eduVisorPorExtension("arcada.stl"), "malla");
  assert.equal(eduVisorPorExtension("arcada.ply"), "malla");
  assert.equal(eduVisorPorExtension("arcada.obj"), "malla");
  // Una imagen o un PDF no van al visor 3D: se pintan en la hoja normal.
  assert.equal(eduVisorPorExtension("panoramica.jpg"), null);
  assert.equal(eduVisorPorExtension("reporte.pdf"), null);
  assert.equal(eduVisorPorExtension("sin_extension"), null);
});

test("se compara en minúsculas y con el nombre completo", () => {
  // Los nombres llegan tal como los tenía el archivo del alumno.
  assert.equal(eduVisorPorExtension("ESTUDIO.ZIP"), "cbct");
  assert.equal(eduVisorPorExtension("Modelo Superior.STL"), "malla");
  // Un nombre con puntos en medio se juzga por el ÚLTIMO trozo.
  assert.equal(eduVisorPorExtension("tac.2026.01.zip"), "cbct");
  // Y "zip" en medio del nombre no convierte un PDF en una tomografía.
  assert.equal(eduVisorPorExtension("informe.zip.pdf"), null);
});

test("el reparto es EL MISMO que hace el dental", () => {
  // El dental decide con isZip() y formatFromName(); si algún día acepta un
  // formato más, el instituto tiene que enterarse aquí y no por un estudio
  // que se abre en el visor equivocado.
  const dental = fuente(DENTAL_TAB);
  assert.match(dental, /\/\\\.zip\$\/i\.test\(name\)/, "el dental ya no reconoce el .zip igual");
  for (const ext of ["stl", "ply", "obj", "dcm", "dicom"]) {
    assert.ok(
      dental.includes(`"${ext}"`),
      `formatFromName del dental ya no menciona "${ext}": revisa eduVisorPorExtension`,
    );
  }
});

test("el módulo que decide el visor no importa NADA", () => {
  // Es lo que permite que la prueba de arriba lo EJECUTE en vez de buscar
  // texto dentro de un .tsx que el corredor no puede cargar.
  const src = fuente(TIPO);
  assert.equal(/^\s*import\s/m.test(src), false, `${TIPO} tiene importaciones`);
});

/* ═══════════════════════════════════════════════════════════════════════
 * 2 · Los visores se IMPORTAN del dental. No hay copias, ni restos.
 * ═══════════════════════════════════════════════════════════════════════ */

test("el modal importa los tres visores del dental", () => {
  const src = fuente(MODAL);
  assert.ok(
    src.includes("@/components/patient-3d/DicomSetViewer"),
    "el CBCT tiene que ser el del dental",
  );
  assert.ok(
    src.includes("@/components/patient-3d/DicomViewer2D"),
    "el corte DICOM tiene que ser el del dental",
  );
  // La malla entra por el adaptador, que es quien le monta el i18n y quien
  // NO le pasa patientId/fileId.
  assert.ok(src.includes("EduModelo3DViewer"), "la malla entra por su adaptador");
  assert.ok(
    fuente(MALLA).includes("@/components/patient-3d/Model3DViewer"),
    "el adaptador tiene que importar el visor del dental, no una copia",
  );
});

test("el fork del visor ya no existe", () => {
  // 984 líneas que reproducían el visor del dental con otra pinta, más sus
  // cuatro acompañantes. Un archivo que vuelva es una segunda copia que se
  // quedará sin las correcciones del dental.
  for (const muerto of [
    "src/components/edu/estudios/cbct-viewer.tsx",
    "src/components/edu/estudios/panoramica-pane.tsx",
    "src/components/edu/estudios/visor-medidas.ts",
    "src/components/edu/estudios/visor-gestos.ts",
    "src/components/edu/estudios/visor-shell.tsx",
  ]) {
    assert.equal(existsSync(join(RAIZ, muerto)), false, `${muerto} volvió: era el fork retirado`);
  }
});

test("ninguna pieza del visor del dental está copiada dentro del vertical", () => {
  // Firmas de la matemática y del render del dental. Si alguna aparece bajo
  // src/components/edu es que alguien pegó código en vez de importarlo.
  const firmas = [
    "export function autoDetectArch",
    "export function reslicePanoramic",
    "export function keepDominantSeries",
    "export function sortSlicesForVolume",
    "export default function DicomSetViewer",
    "export default function MprPane",
  ];
  for (const archivo of archivosDe("src/components/edu")) {
    const src = sinComentarios(readFileSync(archivo, "utf8"));
    for (const firma of firmas) {
      assert.equal(
        src.includes(firma),
        false,
        `${archivo} contiene "${firma}": el visor se IMPORTA del dental; una copia se ` +
          "queda sin las correcciones que el dental pague mañana",
      );
    }
  }
});

test("no quedan clases del fork colgando en el tema", () => {
  // El bloque de CSS del visor viejo (.edu-visor3d*, .edu-visorhoja*) se
  // fue con sus archivos. Si vuelve sin dueño son 400 renglones que nadie
  // se atreve a borrar después.
  const css = crudo(TEMA);
  for (const muerta of [".edu-visor3d", ".edu-visorhoja", ".edu-modal__card--wide"]) {
    assert.equal(css.includes(muerta), false, `${muerta} sigue en el tema y ya no la usa nadie`);
  }
  // Y las del visor de imágenes/PDF, que NO eran del fork, siguen.
  assert.ok(css.includes(".edu-visor__marco"), "el visor de imágenes no se llevó por delante");
});

/* ═══════════════════════════════════════════════════════════════════════
 * 3 · Las rutas son las del INSTITUTO
 * ═══════════════════════════════════════════════════════════════════════ */

test("el modal no cablea ni una ruta del dental", () => {
  const src = fuente(MODAL);
  assert.equal(
    src.includes("/api/patients/"),
    false,
    "una ruta del dental con ids del instituto contesta 401/404",
  );
  assert.ok(src.includes("/api/instituto/estudios/"), "las rutas del visor son las del vertical");
  assert.ok(src.includes("/lite"), "falta la ruta que prepara la tomografía para el móvil");
  assert.ok(src.includes("/notas"), "falta la ruta que guarda las notas del estudio");
});

test("el visor del dental sigue aceptando que le cambien las rutas", () => {
  // La ÚNICA modificación de esta ola en el producto dental. Si alguien la
  // revierte, el instituto vuelve a hablarle a /api/patients/** y el móvil
  // se queda sin poder abrir una tomografía — sin que nada falle al
  // compilar.
  const src = fuente(DENTAL_CBCT);
  assert.match(
    src,
    /endpoints\?:\s*\{\s*lite:\s*string;\s*notes:\s*string\s*\}/,
    "DicomSetViewer perdió la prop `endpoints`",
  );
  assert.ok(src.includes("endpoints?.lite ??"), "la ruta del lite ya no sale de la prop");
  assert.ok(src.includes("endpoints?.notes ??"), "la ruta de las notas ya no sale de la prop");
  // Y el dental conserva las suyas cuando nadie le pasa nada.
  assert.ok(
    src.includes("/api/patients/${patientId}/dicom-set/${fileId}/lite"),
    "el dental perdió su ruta por defecto",
  );
  assert.ok(
    src.includes("/api/patients/${patientId}/models-3d/${fileId}"),
    "el dental perdió su PATCH de notas por defecto",
  );
});

test("las rutas del instituto existen y pasan por la puerta del vertical", () => {
  const lite = fuente("src/app/api/instituto/estudios/[id]/lite/route.ts");
  const notas = fuente("src/app/api/instituto/estudios/[id]/notas/route.ts");

  // El institutionId sale SIEMPRE de la sesión, nunca del cuerpo ni del
  // query: `eduApiGuard` es la única puerta del vertical.
  for (const [nombre, src] of [
    ["lite", lite],
    ["notas", notas],
  ] as const) {
    assert.ok(src.includes("eduApiGuard("), `la ruta ${nombre} no pasa por eduApiGuard`);
    assert.ok(
      src.includes("getEduStudyForViewer(") || src.includes("updateEduStudyNotes("),
      `la ruta ${nombre} no resuelve el estudio dentro del alcance`,
    );
  }

  // La lectura basta para PREPARAR el estudio; escribir notas es escribir
  // en el expediente y pide el permiso de escritura de esta pantalla.
  assert.ok(lite.includes('eduApiGuard("estudios.view")'), "el lite pide estudios.view");
  assert.ok(notas.includes('eduApiGuard("estudios.upload")'), "las notas piden estudios.upload");

  // La reducción se IMPORTA de la lib compartida: copiarla habría dejado al
  // instituto sin las correcciones de geometría del dental.
  assert.ok(
    fuente("src/lib/edu/estudios.ts").includes('import("@/lib/cbct-lite")'),
    "buildCbctLite se importa; no se reescribe",
  );
});

test("el estudio se busca DENTRO del alcance clínico, nunca por id suelto", () => {
  const src = fuente("src/lib/edu/estudios.ts");
  const i = src.indexOf("export async function getEduStudyForViewer");
  assert.notEqual(i, -1, "desapareció el resolutor del visor");
  const cuerpo = src.slice(i, src.indexOf("export async function updateEduStudyNotes"));
  assert.ok(cuerpo.includes("requireInstitution(ctx)"), "el institutionId sale de la sesión");
  assert.ok(cuerpo.includes("eduPatientScopeWhere("), "falta el recorte por paciente del rol");
  assert.ok(cuerpo.includes("eduScopeIsEmpty("), "un alcance vacío tiene que cerrar la consulta");
});

/* ═══════════════════════════════════════════════════════════════════════
 * 4 · La rejilla 2×2 cabe en la primera pantalla
 * ═══════════════════════════════════════════════════════════════════════ */

test("el dental sigue partiendo la rejilla en dos columnas a partir de lg", () => {
  // El @media del tema tiene que ser EL MISMO punto de corte que el `lg:`
  // de Tailwind con el que el dental pasa de una columna a dos. Si el
  // dental cambia de punto, el reparto se aplicaría donde no hay 2×2 (o al
  // revés) y no fallaría nada: solo se vería mal.
  const dental = fuente(DENTAL_CBCT);
  assert.ok(
    dental.includes("grid grid-cols-1 lg:grid-cols-2"),
    "la rejilla del dental ya no es 1→2 columnas en `lg`",
  );
  assert.ok(
    crudo(TEMA).includes("@media (min-width: 1024px)"),
    "el tema tiene que repartir en el mismo punto que `lg:` (1024px)",
  );
});

test("los paneles del dental siguen llevando el alto EN LÍNEA (por eso el !important)", () => {
  // `MprPane` pone `style={{ height: viewportH }}` y `Dicom3DVolume`
  // `style={{ width:"100%", height, ... }}`. A un estilo en línea no se le
  // gana con especificidad: si el dental lo pasara a una clase, los dos
  // `!important` del tema sobrarían y habría que quitarlos.
  assert.match(
    fuente("src/components/patient-3d/MprPane.tsx"),
    /style=\{\{\s*height:\s*viewportH/,
    "MprPane ya no fija el alto en línea",
  );
  assert.match(
    fuente("src/components/patient-3d/Dicom3DVolume.tsx"),
    /style=\{\{\s*width:\s*"100%",\s*height,/,
    "Dicom3DVolume ya no fija el alto en línea",
  );
  // Y el ancla desde la que se mide: la caja negra del plano.
  assert.match(
    fuente("src/components/patient-3d/MprPane.tsx"),
    /className="relative w-full select-none overflow-hidden"/,
    "cambió la clase de la caja negra del plano: el modal la usa para medir " +
      "la rejilla y el tema para darle el alto",
  );
});

test("las dos filas de la rejilla miden lo que midió el JS", () => {
  const css = crudo(TEMA);
  assert.ok(
    css.includes("grid-template-rows: repeat(2, var(--edu-vsr-fila, auto))"),
    "sin esto los cuatro paneles vuelven a los 420 px fijos del dental",
  );
  // El respaldo `auto` importa: mientras el JS no ha medido (o cuando
  // decide no medir), la rejilla se comporta como la del dental en vez de
  // colapsar a cero.
  assert.ok(css.includes("var(--edu-vsr-fila, auto)"), "falta el respaldo `auto`");
  // Y las tarjetas tienen que estirarse: con el `self-start` del dental se
  // quedan en fit-content y el reparto no sirve de nada.
  assert.match(regla(css, ".edu-vsr__lienzo--cbct .grid > div"), /align-self:\s*stretch/);
});

test("el modal mide contra la VENTANA con dvh, no con vh fijo", () => {
  const css = crudo(TEMA);
  const tarjeta = regla(css, ".edu-vsr__card");
  assert.match(tarjeta, /height:\s*100dvh/, "en el móvil la barra del navegador se come el vh");
  assert.match(tarjeta, /height:\s*100vh/, "hace falta el respaldo para navegadores sin dvh");
  assert.ok(css.includes("height: min(96dvh, 100%)"), "en escritorio la hoja también es dvh");
});

test("la hoja del visor no usa consultas de contenedor", () => {
  // Es `position: fixed` y `container-type` CREA contención: un contenedor
  // de consulta encima la atraparía dentro de la columna del panel.
  const css = crudo(TEMA);
  const desde = css.indexOf(".edu-vsr {");
  assert.ok(desde > 0, "no se encontró el bloque del visor en edu-theme.css");
  assert.equal(/@container/.test(css.slice(desde)), false, "el bloque del visor usa @container");
});

test("el reparto se apaga solo cuando no hay 2×2 que cuadrar", () => {
  // Una columna, un panel maximizado, la panorámica o el modo de poca
  // memoria: ahí manda el dental. Encoger cuatro cortes para que quepan en
  // una pantalla angosta los deja ilegibles.
  const src = fuente(MODAL);
  assert.ok(src.includes("columnas < 2"), "falta la salida cuando la rejilla no es de 2 columnas");
  assert.ok(
    src.includes('removeProperty("--edu-vsr-fila")'),
    "al apagarse tiene que QUITAR la variable, no dejar el último valor puesto",
  );
  // Y se vuelve a medir cuando cambia la ventana y cuando aparece la
  // rejilla (que no existe hasta que el estudio se decodifica).
  assert.ok(src.includes("new ResizeObserver("), "sin ResizeObserver, cambiar la ventana no remide");
  assert.ok(src.includes("new MutationObserver("), "sin MutationObserver nunca llega a medir nada");
  assert.ok(
    src.includes("childList: true"),
    "se miran los hijos, no los atributos: los botones de la barra cambian de clase todo el rato",
  );
});

test("el objeto de rutas no puede re-decodificar el estudio en cada render", () => {
  // El modal crea `endpoints` nuevo en cada render. El visor del dental lo
  // reduce a dos STRINGS antes de meterlo en las dependencias del efecto
  // que decodifica; si alguien metiera el objeto, girar el iPad volvería a
  // leer los 668 cortes (296 MB) desde cero.
  const src = fuente(DENTAL_CBCT);
  const i = src.indexOf("}, [fileId, lowMem");
  assert.notEqual(i, -1, "no se encontró la lista de dependencias del efecto de carga");
  const deps = src.slice(i + 4, src.indexOf("]", i) + 1);
  assert.equal(deps.includes("endpoints"), false, `el objeto entró en las dependencias: ${deps}`);
  assert.ok(deps.includes("liteEndpoint"), "la ruta tiene que estar en las dependencias como string");
});

/* ═══════════════════════════════════════════════════════════════════════
 * 5 · El panel de notas MUERTO del visor DICOM 2D sigue oculto
 * ═══════════════════════════════════════════════════════════════════════ */

test("el panel de notas del DICOM 2D sigue teniendo la clase con la que se oculta", () => {
  // `DicomViewer2D` no acepta rutas y guarda con PATCH /api/patients/**,
  // que desde el instituto contesta 404 SIEMPRE. Se le tapa desde el CSS
  // usando `lg:w-72`, la clase con la que el dental marca esa columna. Si
  // el dental la cambia, el botón "Guardar" reaparecería y fallaría cada
  // vez, sin que nada se pusiera rojo. Por eso esta prueba.
  const src = fuente(DENTAL_2D);
  assert.ok(src.includes("lg:w-72"), "cambió la clase del panel de notas del visor DICOM 2D");
  assert.ok(
    src.includes("/api/patients/"),
    "si ya no escribe en el dental, revisa si sigue haciendo falta ocultarlo",
  );
  const css = crudo(TEMA);
  assert.ok(
    css.includes(".edu-vsr__lienzo--dicom .lg\\:w-72"),
    "el tema dejó de ocultar el panel de notas del visor DICOM 2D",
  );
  assert.match(regla(css, ".edu-vsr__lienzo--dicom .lg\\:w-72"), /display:\s*none/);
});

test("el visor de mallas sigue sin recibir patientId/fileId", () => {
  // Sin esas dos props su `canPersist` es false: no pinta panel de notas y
  // el PATCH del dental es inalcanzable. Es el mismo problema que el del
  // DICOM 2D, resuelto por la puerta buena porque ese visor sí lo permite.
  const src = fuente(MALLA);
  assert.equal(src.includes("patientId="), false, "pasarle patientId reconectaría el PATCH");
  assert.equal(src.includes("fileId="), false, "pasarle fileId reconectaría el PATCH");
});

/* ═══════════════════════════════════════════════════════════════════════
 * 6 · La taxonomía inventada no vuelve a la pantalla
 * ═══════════════════════════════════════════════════════════════════════ */

test("al subir un estudio ya no se pregunta qué es", () => {
  const src = fuente(GALERIA);
  assert.equal(src.includes("¿Qué es esta imagen?"), false, "volvió la pregunta del tipo");
  assert.equal(src.includes("radiogroup"), false, "volvieron los botones de tipo");
  assert.equal(
    src.includes("EDU_STUDY_KIND_LABELS"),
    false,
    "la galería volvió a pintar el tipo como una taxonomía",
  );
  assert.equal(
    fuente(VIEWER).includes("EDU_STUDY_KIND_LABELS"),
    false,
    "el visor volvió a pintar el tipo como una taxonomía",
  );
});

test("el cliente de la subida ya no manda el tipo", () => {
  // Que el servidor siga sin creerle a nadie es cosa de eduResolveStudyKind
  // (probado en edu-resumen.test.ts). Lo que se fija aquí es que la
  // pantalla dejó de mandarlo: si vuelve, alguien volvió a preguntarlo.
  const src = fuente(SUBIDA);
  assert.equal(src.includes("kind"), false, "el navegador volvió a proponer el tipo del estudio");
});

test("el icono de la tarjeta sale del ARCHIVO, no del tipo guardado", () => {
  // Es el mismo criterio con el que se elige el visor al abrirla: así la
  // miniatura nunca promete algo distinto de lo que se va a abrir.
  const src = fuente(GALERIA);
  assert.ok(src.includes("function iconoDeArchivo("), "falta el icono deducido de la extensión");
  assert.ok(src.includes("eduExtOfName("), "el icono tiene que mirar la extensión");
});

/* ═══════════════════════════════════════════════════════════════════════
 * 7 · Higiene del vertical
 * ═══════════════════════════════════════════════════════════════════════ */

test('ningún texto visible del visor dice "Ola N"', () => {
  for (const archivo of [MODAL, TIPO, MALLA, VIEWER, GALERIA]) {
    const src = fuente(archivo);
    assert.equal(
      /Ola\s+\d/.test(src),
      false,
      `${archivo} menciona una ola fuera de un comentario: el usuario no sabe qué es una ola`,
    );
  }
});

test("el bloque de apoyo de IA sigue montado en el visor", () => {
  const src = fuente(VIEWER);
  assert.ok(
    src.includes("<EduAnalisisIa"),
    "el panel de IA se pinta SIEMPRE, también apagado: su primer trabajo es decir por qué",
  );
});

test("la leyenda clínica se monta UNA vez, en el modal", () => {
  // Una por visor daría tres leyendas distintas según el archivo; y ninguna
  // sería la que se recuerda.
  const src = fuente(MODAL);
  assert.ok(src.includes("<DiagnosticDisclaimer"), "se fue la leyenda de 'solo apoyo visual'");
  assert.ok(
    src.includes("no sustituye una estación diagnóstica"),
    "la leyenda dejó de decir lo único que tenía que decir",
  );
});

test("el modal conserva las reglas de la casa de EduModal", () => {
  const src = fuente(MODAL);
  assert.ok(src.includes('e.key === "Escape"'), "Escape tiene que cerrar");
  assert.ok(src.includes('role="dialog"') && src.includes('aria-modal="true"'), "falta el diálogo");
  assert.ok(src.includes("aria-labelledby"), "el lector de pantalla tiene que saber de qué es");
  assert.ok(src.includes("volverA.current?.focus?.()"), "el foco tiene que VOLVER al cerrar");
  assert.ok(
    src.includes('document.body.style.overflow = "hidden"'),
    "el fondo no puede desplazarse con la hoja abierta",
  );
});
