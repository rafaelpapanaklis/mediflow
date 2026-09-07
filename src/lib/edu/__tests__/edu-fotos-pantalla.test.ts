/**
 * DaleControl INSTITUCIONAL — LA PESTAÑA FOTOS (ws2-t2).
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-fotos-pantalla.test.ts
 *
 * `edu-fotos.test.ts` (Ola B) fija el BACKEND: topes, MIME, paths, el par
 * A/B y la cuota. Esto fija la PANTALLA, que es lo que esta casilla trajo:
 *
 *  1. el ORDEN de las etapas es el orden en que se pinta la galería, y los
 *     grupos vacíos se pintan;
 *  2. el par A/B con datos como los que le llegan de verdad a la UI
 *     (etiquetas ya escritas, URL firmadas, la vista) — no con objetos
 *     mínimos;
 *  3. 🔴 `src/components/edu/fotos` no importa NADA del dental;
 *  4. el doble candado de la pestaña y de la página (permiso + alcance) y
 *     que no se inventó ninguna key de permiso;
 *  5. el Resumen deja de rotular una foto como «Radiografía» y el medidor
 *     de dirección pinta por fin el segundo número.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  eduAgruparFotosPorEtapa,
  eduContarFotosPorEtapa,
  eduParFotosComparador,
  eduPuedeCompararFotos,
  type EduPhotoRow,
} from "../fotos-core";
import {
  EDU_PHOTO_STAGE_DESCRIPTIONS,
  EDU_PHOTO_STAGE_LABELS,
  EDU_PHOTO_STAGES,
  EDU_PHOTO_TYPE_LABELS,
  type EduPhotoStage,
  type EduPhotoType,
} from "../types";

const RAIZ = join(__dirname, "..", "..", "..", "..");

function crudo(...tramos: string[]): string {
  return readFileSync(join(RAIZ, ...tramos), "utf8");
}

/**
 * El código SIN sus comentarios.
 *
 * Hace falta de verdad aquí: los componentes de esta carpeta EXPLICAN por
 * escrito que no importan `PhotoCompareSlider` ni `PhotoLightbox`, y sin
 * este recorte la única forma de pasar la prueba sería no explicarlo.
 */
function sinComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

/** Todos los archivos de una carpeta, en profundidad. */
function archivos(dir: string): string[] {
  const out: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) out.push(...archivos(ruta));
    else out.push(ruta);
  }
  return out;
}

const DIR_FOTOS = join(RAIZ, "src", "components", "edu", "fotos");

// ═════════════════════════════════════════════════════════════════════
// 1 · LA GALERÍA: el orden de las etapas Y los grupos vacíos
// ═════════════════════════════════════════════════════════════════════

/** Una fila TAL COMO le llega a la pantalla: con las etiquetas ya
 *  escritas por el servidor y las URL firmadas. */
function fila(
  id: string,
  stage: EduPhotoStage,
  capturedAt: string,
  photoType: EduPhotoType = "SONRISA",
): EduPhotoRow {
  return {
    id,
    photoType,
    stage,
    capturedAt,
    // N-7 · El día CIVIL en la zona del instituto, resuelto por el
    // servidor. Con mediodía UTC coincide con el recorte en UTC; el modal
    // de corregir siembra su fecha con ESTE campo y no con aquél.
    capturedDayISO: capturedAt.slice(0, 10),
    capturedLabel: `día de ${id}`,
    mime: "image/jpeg",
    sizeBytes: 512_000,
    sizeLabel: "500 KB",
    width: 2400,
    height: 1600,
    notes: null,
    caseId: null,
    caseProgramName: null,
    uploadedById: "u1",
    uploadedByName: "Alumna Pérez",
    createdAt: capturedAt,
    url: `https://firmada/${id}.jpg?token=x`,
    thumbUrl: `https://firmada/${id}-thumb.webp?token=x`,
  };
}

test("🔴 el orden de la galería es PRE → DURANTE → POST → CONTROL, siempre", () => {
  // El orden vive en `EDU_PHOTO_STAGES` y NO dentro de un componente: es
  // lo que hace que la galería, las píldoras de filtro y el visor recorran
  // las fotos en el mismo orden.
  assert.deepEqual(EDU_PHOTO_STAGES, ["PRE", "DURANTE", "POST", "CONTROL"]);
  const grupos = eduAgruparFotosPorEtapa([
    fila("c", "CONTROL", "2026-06-01T12:00:00Z"),
    fila("a", "PRE", "2026-01-01T12:00:00Z"),
  ]);
  assert.deepEqual(grupos.map((g) => g.stage), ["PRE", "DURANTE", "POST", "CONTROL"]);
});

test("🔴 los grupos VACÍOS se pintan: que falte el «Después» es información", () => {
  const grupos = eduAgruparFotosPorEtapa([fila("a", "PRE", "2026-01-01T12:00:00Z")]);
  assert.equal(grupos.length, 4);
  assert.equal(grupos[2].rows.length, 0, "«Después» tiene que existir aunque esté vacío");

  // Y la pantalla los pinta de verdad, con su explicación, en vez de
  // filtrarlos: sin esto, nadie ve que falta el «después» de un paciente.
  const screen = crudo("src", "components", "edu", "fotos", "fotos-screen.tsx");
  assert.match(screen, /edu-fotos-grupo__vacio/);
  assert.match(screen, /EDU_PHOTO_STAGE_DESCRIPTIONS\[g\.stage\]/);
  assert.equal(
    /grupos\.filter\(\(g\) => g\.rows\.length > 0\)/.test(screen),
    false,
    "la pantalla está escondiendo los grupos vacíos",
  );
});

test("cada etapa que pinta la pantalla tiene rótulo Y explicación", () => {
  for (const s of EDU_PHOTO_STAGES) {
    assert.ok(EDU_PHOTO_STAGE_LABELS[s], `falta el rótulo de ${s}`);
    assert.ok(EDU_PHOTO_STAGE_DESCRIPTIONS[s], `falta la explicación de ${s}`);
  }
});

test("las píldoras cuentan por etapa, y con un filtro de vista cuentan LO FILTRADO", () => {
  // Un contador que no cuadra con lo que se ve debajo es peor que no
  // tener contador: por eso la pantalla cuenta sobre lo ya filtrado por
  // vista, que es lo que hace `eduContarFotosPorEtapa` con esa lista.
  const todas = [
    fila("s1", "PRE", "2026-01-01T12:00:00Z", "SONRISA"),
    fila("f1", "PRE", "2026-01-02T12:00:00Z", "FRONTAL"),
    fila("s2", "POST", "2026-05-01T12:00:00Z", "SONRISA"),
  ];
  assert.deepEqual(eduContarFotosPorEtapa(todas), { PRE: 2, DURANTE: 0, POST: 1, CONTROL: 0 });
  const soloSonrisa = todas.filter((f) => f.photoType === "SONRISA");
  assert.deepEqual(eduContarFotosPorEtapa(soloSonrisa), {
    PRE: 1,
    DURANTE: 0,
    POST: 1,
    CONTROL: 0,
  });
});

// ═════════════════════════════════════════════════════════════════════
// 2 · EL PAR A/B, CON DATOS DE UI
// ═════════════════════════════════════════════════════════════════════

test("🔴 el par A/B con filas de UI: A = la primera PRE, B = la última POST/CONTROL", () => {
  const rows = [
    fila("pre-ene", "PRE", "2026-01-10T12:00:00Z"),
    fila("dur-mar", "DURANTE", "2026-03-10T12:00:00Z"),
    fila("post-jun", "POST", "2026-06-10T12:00:00Z"),
    fila("ctrl-dic", "CONTROL", "2026-12-10T12:00:00Z"),
  ];
  const par = eduParFotosComparador(rows);
  assert.equal(par.a?.id, "pre-ene");
  assert.equal(par.b?.id, "ctrl-dic");
  // Y lo que la pantalla necesita para rotularlos viene ya escrito del
  // servidor: la etiqueta del comparador no vuelve a formatear una fecha.
  assert.equal(par.a?.capturedLabel, "día de pre-ene");
  assert.ok(par.b?.url.startsWith("https://firmada/"));
  assert.equal(EDU_PHOTO_TYPE_LABELS[par.a!.photoType], "Sonrisa");
  assert.equal(eduPuedeCompararFotos(rows), true);
});

test("con una sola foto el comparador NO desaparece: dice que falta la otra", () => {
  const rows = [fila("sola", "PRE", "2026-01-10T12:00:00Z")];
  assert.equal(eduPuedeCompararFotos(rows), false);
  const comp = crudo("src", "components", "edu", "fotos", "comparador.tsx");
  // La tarjeta se queda y el aviso ocupa el sitio de la imagen: si el
  // comparador se escondiera, nadie sabría que existe.
  assert.match(comp, /edu-fotos-comp__vacio/);
  assert.match(comp, /Hace falta una segunda foto/);
});

test("el comparador propone, y deja CAMBIAR A y B y intercambiarlos", () => {
  const comp = crudo("src", "components", "edu", "fotos", "comparador.tsx");
  // La regla del par no se reimplementa en el componente: se le pregunta
  // al módulo puro, que es el que tiene la prueba.
  assert.match(comp, /eduParFotosComparador/);
  assert.match(comp, /aria-label="Foto A \(el antes\)"/);
  assert.match(comp, /aria-label="Foto B \(el después\)"/);
  assert.match(comp, /aria-label="Intercambiar A y B"/);
  // Los dos modos.
  assert.match(comp, /Deslizador/);
  assert.match(comp, /Lado a lado/);
  assert.match(comp, /clipPath: `inset\(0 0 0 \$\{corte\}%\)`/);
});

test("🔴 el deslizador se arrastra con el DEDO y con el ratón, y se mueve con teclado", () => {
  const comp = crudo("src", "components", "edu", "fotos", "comparador.tsx");
  // Punteros y no `mousedown`: con eventos de ratón, en un teléfono no se
  // movía nada.
  assert.match(comp, /onPointerDown/);
  assert.match(comp, /onPointerMove/);
  assert.match(comp, /setPointerCapture/);
  assert.equal(/onMouseDown|onTouchStart/.test(comp), false, "quedó un camino de ratón aparte");
  // Y el rango accesible: es la única forma de moverlo con el teclado.
  assert.match(comp, /type="range"/);
  const css = crudo("src", "app", "instituto", "edu-theme.css");
  // Sin `touch-action: none` el navegador se queda el gesto para
  // desplazar la página y el tirador no se mueve.
  assert.match(css, /\.edu-fotos-comp__marco \{[^}]*touch-action: none;/);
});

test("el visor a pantalla completa navega con teclado y devuelve el foco", () => {
  const visor = crudo("src", "components", "edu", "fotos", "visor.tsx");
  assert.match(visor, /e\.key === "Escape"/);
  assert.match(visor, /e\.key === "ArrowLeft"/);
  assert.match(visor, /e\.key === "ArrowRight"/);
  assert.match(visor, /volverA\.current\?\.focus\?\.\(\)/);
  assert.match(visor, /aria-modal="true"/);
});

// ═════════════════════════════════════════════════════════════════════
// 3 · 🔴 NADA DEL DENTAL
// ═════════════════════════════════════════════════════════════════════

test("🔴 src/components/edu/fotos no importa NI UNA LÍNEA del dental", () => {
  // Rafael lo pidió con todas sus letras: «no quiero compartir tanta cosa
  // con Dental». Se miró PhotoCompareSlider y PhotoLightbox para no
  // olvidar un gesto y se escribieron aquí. Si el dental cambia, esto no
  // cambia — y al revés.
  const encontrados = archivos(DIR_FOTOS);
  assert.ok(encontrados.length >= 5, "¿se movió la carpeta de fotos?");
  for (const ruta of encontrados) {
    const src = sinComentarios(readFileSync(ruta, "utf8"));
    const corta = ruta.slice(RAIZ.length + 1);
    assert.equal(/@\/components\/dashboard/.test(src), false, `${corta} importa components/dashboard`);
    assert.equal(/@\/lib\/clinical-shared/.test(src), false, `${corta} importa lib/clinical-shared`);
    assert.equal(
      /@\/components\/clinical-shared/.test(src),
      false,
      `${corta} importa components/clinical-shared`,
    );
    assert.equal(/@\/app\/actions/.test(src), false, `${corta} importa app/actions`);
    assert.equal(/PhotoCompareSlider|PhotoLightbox|PhotoCompare\b/.test(src), false, `${corta} usa un componente del dental`);
    assert.equal(/from "@\/lib\/storage"/.test(src), false, `${corta} usa el bucket del dental`);
    // Y ni un `useT`: el provider de i18n no existe bajo /instituto y
    // `useT` LANZA sin él.
    assert.equal(/useT\(/.test(src), false, `${corta} usa el i18n del dental`);
  }
});

/**
 * EL BLOQUE DE ESTA CASILLA dentro de edu-theme.css, ACOTADO POR ARRIBA Y
 * POR ABAJO.
 *
 * 🔴 Antes esto era `css.slice(css.indexOf(marca))` —de la marca al final
 * del archivo— y era correcto mientras este bloque fuera el último. Dejó de
 * serlo al integrar la Ola B: ws2-t3 añadió el suyo detrás, y la prueba del
 * prefijo empezó a exigirle `.edu-fotos*` a `.edu-fichab-grupo`, que es de
 * otra casilla y está bien como está. El fallo NO era del CSS: era de esta
 * prueba, que llamaba "mío" a todo lo que viniera después.
 *
 * El corte va por la convención REAL de la hoja: los banners que ABREN el
 * bloque de una casilla llevan su etiqueta `(wsN-tM)` en la línea de
 * título, y los sub-banners de dentro de un bloque no la llevan ninguno.
 * Así que el bloque termina donde empieza el banner etiquetado siguiente —y
 * la próxima ola que apile el suyo detrás queda acotada sola, sin que nadie
 * tenga que acordarse de tocar este archivo.
 */
function bloquePropio(css: string): string {
  const marca = "===== fotos y estudios (ws2-t2) =====";
  const i = css.indexOf(marca);
  assert.ok(i >= 0, "falta el bloque de la casilla en edu-theme.css");
  const resto = css.slice(i + marca.length);
  // El banner de la casilla SIGUIENTE: una raya larga de apertura y, en la
  // línea de abajo, un título con su etiqueta (wsN-tM).
  const siguiente = /\/\* ═+\r?\n[^\n]*\(ws\d+-t\d+\)/.exec(resto);
  return siguiente ? resto.slice(0, siguiente.index) : resto;
}

test("🔴 la pestaña Fotos viste con clases edu-* y tokens --edu-*", () => {
  const css = crudo("src", "app", "instituto", "edu-theme.css");
  // El bloque de esta casilla, y SOLO el de esta casilla: desde la Ola B
  // hay otro detrás y sus clases no son de aquí (ver `bloquePropio`).
  const bloque = bloquePropio(css);
  // Ni un token del dental (--brand, --violet-*, --bg-elev-*) en lo nuevo:
  // esos viven en globals.css y pintarían el instituto de violeta.
  assert.equal(/var\(--brand/.test(bloque), false);
  assert.equal(/var\(--violet-/.test(bloque), false);
  assert.equal(/var\(--bg-elev/.test(bloque), false);
  // Y todo lo declarado lleva prefijo propio. Se miran las líneas de
  // selector enteras (`.dark .edu-fotos-obl {` es legítimo: es el gemelo
  // oscuro de una clase propia), y lo que se exige es que la clase que se
  // declara sea de esta casilla.
  for (const linea of bloque.split("\n")) {
    const m = /^(\.[^{]*)\{\s*$/.exec(linea.trim());
    if (!m) continue;
    const selector = m[1].trim();
    const clases = selector.match(/\.[a-zA-Z0-9_-]+/g) ?? [];
    const ultima = clases[clases.length - 1] ?? "";
    assert.ok(
      ultima.startsWith(".edu-fotos") || ultima.startsWith(".edu-estudios"),
      `${selector} no lleva el prefijo de la casilla`,
    );
  }
});

test("a 390 px la galería es de DOS columnas y el comparador se apila", () => {
  const css = crudo("src", "app", "instituto", "edu-theme.css");
  const bloque = bloquePropio(css);
  // 390 − 28 (padding de .edu-main) = 362 de contenido. Con
  // minmax(150px, 1fr) y 10 de hueco: floor((362+10)/(150+10)) = 2.
  assert.match(bloque, /\.edu-fotos-rejilla \{[^}]*minmax\(150px, 1fr\)/);
  // El comparador APILADO en la base y en dos columnas solo cuando LA
  // TARJETA pasa de 560 (regla 8: la forma que no se puede romper va en la
  // base; la de escritorio se pide).
  assert.match(bloque, /\.edu-fotos-comp__lado \{[^}]*grid-template-columns: 1fr;/);
  assert.match(bloque, /@container edu-comparador \(min-width: 560px\)/);
  // Y se mide a SÍ MISMO con @container, no con @media (regla 2).
  assert.match(bloque, /\.edu-fotos-comp \{[^}]*container-type: inline-size;/);
});

// ═════════════════════════════════════════════════════════════════════
// 4 · LOS CANDADOS: permiso + alcance, y ninguna key nueva
// ═════════════════════════════════════════════════════════════════════

test("la pestaña Fotos va entre Estudios y Consentimientos, con `estudios.view`", () => {
  const layout = crudo("src", "app", "instituto", "(panel)", "pacientes", "[id]", "layout.tsx");
  const iEstudios = layout.indexOf('key: "estudios"');
  const iFotos = layout.indexOf('key: "fotos"');
  const iConsent = layout.indexOf('key: "consentimientos"');
  assert.ok(iEstudios > 0 && iFotos > 0 && iConsent > 0);
  assert.ok(iEstudios < iFotos && iFotos < iConsent, "la pestaña Fotos no está en su sitio");
  const entrada = layout.slice(iFotos, iConsent);
  assert.match(entrada, /permission: "estudios\.view"/);
  // 🔴 Ninguna key nueva: una key nueva empieza en cero para todo el
  // mundo y el `permissionsOverride` REEMPLAZA al default del rol, así que
  // a quien tenga overrides no le llegaría y no vería la pestaña, sin
  // error y sin pista.
  assert.equal(/["']fotos\.(view|upload|manage|delete)["']/.test(layout), false);
});

test("🔴 la página exige el permiso AQUÍ y además el alcance clínico", () => {
  const page = crudo("src", "app", "instituto", "(panel)", "pacientes", "[id]", "fotos", "page.tsx");
  // Esconder una pestaña no cierra ninguna puerta: basta con teclear la URL.
  assert.match(page, /hasEduPermission\(permUser, "estudios\.view"\)/);
  assert.match(page, /eduScopeIsEmpty\(eduClinicalScope\(ctx\)\)/);
  // Un paciente que no te toca es 404, igual que uno inventado: un 403
  // confirmaría que ese folio existe.
  assert.match(page, /getEduClinicalPatient\(ctx, params\.id\)/);
  assert.match(page, /notFound\(\)/);
  // Y subir/corregir/retirar piden el permiso de ESCRITURA. Se calcula en
  // una constante porque además decide si se CONSULTAN las retiradas: una
  // consulta cuyo resultado nadie va a ver es un viaje pagado por nadie.
  assert.match(page, /const canUpload = hasEduPermission\(permUser, "estudios\.upload"\);/);
  assert.match(page, /canUpload=\{canUpload\}/);
  assert.match(page, /listEduPatientPhotosRetiradas/);
  assert.match(page, /retiradas=\{retiradas\}/);
  // force-dynamic: las URL son firmadas y caducan.
  assert.match(page, /export const dynamic = "force-dynamic"/);
});

test("⚠️ sin permiso los botones se DESHABILITAN con el motivo escrito, no se esconden", () => {
  // El patrón de paciente-whatsapp.tsx:23-24. Un botón que no está no se
  // puede preguntar por qué no está.
  const screen = crudo("src", "components", "edu", "fotos", "fotos-screen.tsx");
  assert.match(screen, /disabled=\{!canUpload\}/);
  assert.match(screen, /SIN_PERMISO/);
  assert.match(screen, /estudios\.upload/);
  const editar = crudo("src", "components", "edu", "estudios", "estudio-editar.tsx");
  assert.match(editar, /disabled=\{!canUpload\}/);
  assert.match(editar, /\{SIN_PERMISO\}/);
});

test("🔴 N-2 · la compresión del navegador es OBLIGATORIA, y el original NO se manda", () => {
  const comp = sinComentarios(crudo("src", "components", "edu", "fotos", "comprimir.ts"));
  // Ya no hay umbral: se comprime SIEMPRE. Sharp no va a ver esta foto —
  // sube directo al bucket—, así que lo que sale del canvas es lo que
  // queda en el expediente.
  assert.equal(/3\.5 \* 1024 \* 1024/.test(comp), false, "quedó el umbral del best-effort");
  assert.equal(/talCual/.test(comp), false, "quedó la puerta por la que se colaba el original");
  // Los parámetros son los de sharp, IMPORTADOS y no copiados.
  assert.match(comp, /EDU_PHOTO_MAX_EDGE/);
  assert.match(comp, /EDU_PHOTO_JPEG_QUALITY/);
  assert.match(comp, /EDU_PHOTO_THUMB_EDGE/);
  assert.match(comp, /EDU_PHOTO_THUMB_QUALITY/);
  // La orientación EXIF es AHORA la única oportunidad de aplicarse: al
  // pasar por el canvas los metadatos se pierden y el `.rotate()` del
  // servidor ya no está detrás.
  assert.match(comp, /imageOrientation: "from-image"/);
  // Y si no se puede leer, se RECHAZA con el motivo escrito.
  assert.match(comp, /class EduFotoIlegible/);
  assert.match(comp, /no puede leer HEIC/);
});

test("🔴 N-2 · el modal ya no promete 25 MB, y sube por los tres pasos", () => {
  const subir = crudo("src", "components", "edu", "fotos", "subir-foto.tsx");
  // El subtítulo prometía un tope que la tubería no aguantaba.
  assert.equal(/Hasta \$\{EDU_MAX_PHOTO_LABEL\}/.test(subir), false);
  assert.equal(/EDU_MAX_PHOTO_LABEL/.test(subir), false, "el subtítulo sigue prometiendo el tope");
  assert.match(subir, /sube directo al almacenamiento/);
  // Y el binario ya no viaja en un FormData contra el route handler.
  assert.equal(/new FormData\(\)/.test(subir), false);
  assert.match(subir, /eduUploadPhoto/);

  const cliente = sinComentarios(
    crudo("src", "components", "edu", "fotos", "subir-foto-client.ts"),
  );
  // Los tres pasos, en orden, y la limpieza del huérfano.
  const iSign = cliente.indexOf("/fotos/sign");
  const iPut = cliente.indexOf("putConProgreso(\n        signedUrl");
  const iConfirm = cliente.indexOf("/fotos/confirm");
  assert.ok(iSign > 0 && iPut > iSign && iConfirm > iPut, "los tres pasos no van en orden");
  assert.match(cliente, /\/fotos\/abort/);

  // Y la cámara del teléfono, con la trasera.
  assert.match(subir, /accept="image\/\*"/);
  assert.match(subir, /capture="environment"/);
  // La etapa NO viene preseleccionada: es lo único de lo que depende el
  // comparador.
  assert.match(subir, /useState<EduPhotoStage \| "">\(""\)/);
});

test("🔴 N-12 · con UN solo caso abierto, la foto se engancha a él", () => {
  const subir = sinComentarios(crudo("src", "components", "edu", "fotos", "subir-foto.tsx"));
  // Se cuentan los ABIERTOS: `cases` incluye los cerrados, así que «más de
  // uno» no describía ni lo que contaba ni lo que permitía.
  assert.match(subir, /cases\.filter\(\(c\) => c\.isOpen\)/);
  assert.match(subir, /abiertos\.length === 1 \? abiertos\[0\] : null/);
  assert.match(subir, /useState\(unico \? unico\.id : ""\)/);
});

test("🔴 N-5 · el onError distingue «caducó» de «no se puede pintar»", () => {
  const img = sinComentarios(crudo("src", "components", "edu", "fotos", "foto-img.tsx"));
  // Primero se pide una URL NUEVA a la ruta que se escribió justo para
  // esto y que no llamaba nadie.
  assert.match(img, /\/fotos\/\$\{foto\.id\}\/url/);
  // Y solo si CON LA URL NUEVA sigue fallando se declara rota: la prueba
  // de que caducó no es un temporizador (el reloj puede ir corrido), es
  // que el segundo intento tampoco pinta.
  assert.match(img, /renovada\.current/);
  assert.match(img, /edu-fotos-rota/);

  // Y la galería ya NO enciende el banner de «caducaron» desde un onError.
  const screen = sinComentarios(crudo("src", "components", "edu", "fotos", "fotos-screen.tsx"));
  assert.equal(/onError=\{\(\) => setCaducadas\(true\)\}/.test(screen), false);
  assert.match(screen, /no se pueden mostrar en este navegador/);

  // El visor y el comparador usan el MISMO componente: los dos pintaban la
  // URL de la carga inicial sin `onError`.
  for (const f of ["visor.tsx", "comparador.tsx"]) {
    const src = sinComentarios(crudo("src", "components", "edu", "fotos", f));
    assert.match(src, /EduFotoImagen/, f);
    assert.equal(/<img\b/.test(src), false, `${f} pinta una <img> suelta sin renovación`);
  }
});

test("🔴 N-16 · el comparador distingue «falta una foto» de «elegiste la misma dos veces»", () => {
  const comp = crudo("src", "components", "edu", "fotos", "comparador.tsx");
  assert.match(comp, /mismaDosVeces/);
  assert.match(comp, /Elegiste la misma foto en A y en B/);
  // Y el clic en A/B abre el visor sobre LA MISMA lista que alimenta el
  // comparador: con un filtro puesto, antes no hacía nada.
  const screen = crudo("src", "components", "edu", "fotos", "fotos-screen.tsx");
  assert.match(screen, /const paraComparar = filtradas\.length >= 2 \? filtradas : rows;/);
  assert.match(screen, /onAbrir=\{\(foto\) => abrirEn\(planasComp, foto\)\}/);
});

test("🔴 N-16 · los contadores de «Vista» respetan el filtro de etapa", () => {
  const screen = crudo("src", "components", "edu", "fotos", "fotos-screen.tsx");
  // Contaban sobre `rows` —el total— ignorando la etapa puesta: «Sonrisa
  // (12)» encima de una galería con dos.
  assert.match(screen, /const porEtapa = useMemo\(/);
  assert.match(screen, /Todas las vistas \(\{porEtapa\.length\}\)/);
  assert.match(screen, /porEtapa\.filter\(\(f\) => f\.photoType === t\)\.length/);
  assert.equal(/\(\{rows\.length\}\)/.test(screen), false, "sigue contando sobre el total");
});

test("🔴 N-7 · la fecha de toma no se corre un día, y solo viaja si se tocó", () => {
  const editar = sinComentarios(crudo("src", "components", "edu", "fotos", "editar-foto.tsx"));
  // El día viene YA resuelto en la zona del instituto, no recortado en UTC.
  assert.equal(/eduInstanteADiaInput/.test(editar), false, "sigue recortando el instante en UTC");
  assert.match(editar, /useState\(foto\.capturedDayISO\)/);
  // Y venir solo a corregir la ETAPA ya no reescribe `capturedAt`.
  assert.match(editar, /dia && dia !== foto\.capturedDayISO \? eduDiaISOaInstante\(dia\) : undefined/);
  // El servidor manda el día civil, calculado con la MISMA función que la
  // etiqueta que se pinta en la tarjeta.
  const server = sinComentarios(crudo("src", "lib", "edu", "fotos.ts"));
  assert.match(server, /capturedDayISO: eduUtcToZoned\(p\.capturedAt, eduSafeTimeZone\(timeZone\)\)\.dayISO/);
});

test("🔴 N-16 · el motivo de retirar se puede LEER, plegado y con estudios.upload", () => {
  const ret = crudo("src", "components", "edu", "estudios", "retirados.tsx");
  // Qué, quién, cuándo y por qué.
  assert.match(ret, /r\.que/);
  assert.match(ret, /r\.quien/);
  assert.match(ret, /r\.cuando/);
  assert.match(ret, /r\.porQue/);
  // Plegada: lo retirado no puede abrir la pantalla.
  assert.match(ret, /useState\(false\)/);
  assert.match(ret, /aria-expanded=\{abierto\}/);

  // Las dos pantallas la pintan SOLO con el permiso de escritura.
  for (const t of [
    ["src", "components", "edu", "fotos", "fotos-screen.tsx"],
    ["src", "components", "edu", "expediente", "estudios-screen.tsx"],
  ]) {
    const src = crudo(...t);
    const i = src.indexOf("<EduRetirados");
    assert.ok(i > 0, `${t.join("/")} no pinta la sección`);
    assert.match(src.slice(Math.max(0, i - 200), i), /canUpload && \(/);
  }

  // Y el servidor las lee con `deletedAt: { not: null }`, que hasta hoy no
  // aparecía en ninguna consulta fuera del historial del odontograma.
  assert.match(
    sinComentarios(crudo("src", "lib", "edu", "fotos.ts")),
    /deletedAt: \{ not: null \}/,
  );
  assert.match(
    sinComentarios(crudo("src", "lib", "edu", "estudios.ts")),
    /deletedAt: \{ not: null \}/,
  );
});

test("🔴 N-13 · un estudio RETIRADO no se analiza con IA ni gasta cupo", () => {
  const ia = sinComentarios(crudo("src", "lib", "edu", "ia.ts"));
  // El corte va ANTES del formato, del tamaño, del freno de doble clic y
  // del cupo: es el más barato de todos, la fila ya está leída.
  const iCorte = ia.indexOf("if (estudio.deletedAt)");
  const iMime = ia.indexOf("eduAnalisisMimeOk(estudio.mimeType)");
  const iCupo = ia.indexOf("eduIaConsumo");
  assert.ok(iCorte > 0, "no hay corte por estudio retirado");
  assert.ok(iCorte < iMime, "se comprueba el formato antes de saber si el estudio está retirado");
  if (iCupo > 0) assert.ok(iCorte < iCupo, "se toca el cupo de un estudio retirado");
  // Y `getEstudioEnAlcance` lo SELECCIONA en vez de filtrarlo: leer los
  // análisis de un estudio retirado sigue estando bien.
  assert.match(ia, /deletedAt: true,/);

  // La ruta más cara del vertical, con el mismo candado.
  const lite = crudo("src", "app", "api", "instituto", "estudios", "[id]", "lite", "route.ts");
  assert.match(lite, /estudio\.deletedAt/);
});

test("🔴 N-11 · el bloque «Fotos clínicas» del Resumen comprueba estudios.view", () => {
  const page = crudo("src", "app", "instituto", "(panel)", "pacientes", "[id]", "page.tsx");
  // `r.fotos` solo se anula por ALCANCE, nunca por permiso: a quien le
  // apagaron `estudios.view` con un override le desaparecía la pestaña y
  // seguía leyendo aquí el conteo con un enlace que le daba denegado.
  assert.match(page, /const veFotos = r\.fotos !== null && hasEduPermission\(permUser, "estudios\.view"\);/);
  assert.match(page, /\{veFotos && r\.fotos !== null && \(/);
  // Y «Subir la primera» pide el permiso de ESCRITURA.
  assert.match(page, /const subeFotos = hasEduPermission\(permUser, "estudios\.upload"\);/);
});

test("🔴 N-16 · el medidor habla de ARCHIVOS, no solo de estudios", () => {
  const core = crudo("src", "lib", "edu", "almacenamiento-core.ts");
  const i = core.indexOf("export function eduAlmTexto");
  assert.ok(i > 0);
  const cuerpo = core.slice(i);
  // Decía «la subida de estudios está BLOQUEADA» y «ni una radiografía
  // más» a alguien que lo que no podía subir era una foto.
  assert.match(cuerpo, /la subida de archivos está BLOQUEADA/);
  assert.equal(/ni una radiografía más/.test(cuerpo), false);
  assert.match(cuerpo, /fotos clínicas/);
  // Y sigue diciendo lo que la prueba de almacenamiento exige.
  assert.match(cuerpo, /BLOQUEADA/);
  assert.match(cuerpo, /contratar más TB/);
  assert.match(cuerpo, /liberar espacio/);
});

// ═════════════════════════════════════════════════════════════════════
// 5 · EL RESUMEN Y EL MEDIDOR
// ═════════════════════════════════════════════════════════════════════

test("🔴 el Resumen deja de rotular una foto como «Radiografía»", () => {
  const page = crudo("src", "app", "instituto", "(panel)", "pacientes", "[id]", "page.tsx");
  assert.match(page, /Fotos clínicas/);
  assert.match(page, /fotos clínicas/);
  assert.match(page, /última: \$\{r\.fotos\.ultimaLabel\}/);
  assert.match(page, /\$\{base\}\/fotos/);
  // Y el dato sale de una sola consulta agregada, sin firmar miniaturas:
  // el Resumen ya paga tres firmas por los estudios.
  const resumen = crudo("src", "lib", "edu", "resumen.ts");
  assert.match(resumen, /prisma\.eduClinicalPhoto\.aggregate/);
  assert.match(resumen, /_max: \{ capturedAt: true \}/);
  assert.match(resumen, /deletedAt: null/);
});

test("el medidor de dirección pinta POR FIN el segundo número", () => {
  // Decía "N estudios" debajo de un total que ya incluía las fotos: el
  // número de arriba y el de abajo no hablaban de lo mismo.
  const card = crudo("src", "components", "edu", "direccion", "almacenamiento-card.tsx");
  assert.match(card, /medidor\.fotos \?\? 0/);
  assert.match(card, /foto clínica|fotos clínicas/);
  // Y la nota de alcance confiesa que lo retirado no cuenta.
  const core = crudo("src", "lib", "edu", "almacenamiento-core.ts");
  assert.match(core, /sin los que estén retirados/);
});
