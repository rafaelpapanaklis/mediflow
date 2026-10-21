/**
 * ws1-t10 · P1 — la ida y vuelta por el ESQUEMA REAL del editor, en node
 * (`@tiptap/html/server` arma el mismo esquema que el navegador, sin DOM).
 *
 * Run: npm run test:editor-documento
 *
 * Lo que fija:
 *  - Una plantilla vieja (p/h1-h3/listas/b/i/u/br, marcadores en texto) entra al
 *    editor y, normalizada, vuelve a ser la misma (salvo b→strong, i→em, que el
 *    saneador del servidor ya permite).
 *  - Todo lo nuevo del contrato (tabla, columnas, imagen, firma, salto, sangría,
 *    alineación, tamaño) se conserva EXACTO: ni un atributo de más ni de menos.
 *  - Lo que no está en la lista blanca (enlaces, imágenes con src, color, código,
 *    citas) se cae y queda el texto.
 *  - Lo de Word se traduce (text-align, font-size) y lo demás se tira.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateHTML, generateJSON } from "@tiptap/html/server";
import { DOCUMENT_MARKERS } from "@/lib/document-templates/markers";
import { extensionesDocumento } from "../extensiones";
import { htmlParaEditor, normalizarParaGuardar } from "../html";
import { limpiarPegado } from "../pegado";

const CLAVES = DOCUMENT_MARKERS.map((m) => m.token.slice(1, -1));
const ext = extensionesDocumento({
  marcadores: Object.fromEntries(CLAVES.map((c) => [c, { etiqueta: c, ejemplo: c }])),
  textos: { placeholder: "Escribe aquí…", nuevaPagina: "Nueva página" },
});

/** Lo que haría el editor: abrir el HTML guardado, serializar y normalizar para guardar. */
function idaYVuelta(guardado: string): string {
  const json = generateJSON(htmlParaEditor(guardado, CLAVES), ext);
  return normalizarParaGuardar(generateHTML(json, ext));
}

/** Lo que haría un pegado: limpiar, parsear con el esquema (que tira lo que no conoce) y normalizar. */
function pegar(html: string): string {
  return normalizarParaGuardar(generateHTML(generateJSON(limpiarPegado(html), ext), ext));
}

test("una plantilla vieja abre y se guarda igual (b→strong, i→em)", () => {
  const vieja =
    "<h1>Control de resina</h1><p>Paciente: [NOMBRE_PACIENTE] (expediente [EXPEDIENTE_PACIENTE]), [EDAD_PACIENTE].</p>" +
    "<p>Motivo: <b>control</b> de <i>restauración</i> con <u>resina</u>.<br>Segundo renglón.</p>" +
    "<h2>Indicaciones</h2><ul><li>Evitar alimentos duros.</li><li>Cepillado con pasta desensibilizante.</li></ul>" +
    "<h3>Plan</h3><ol><li>Control en 6 meses.</li></ol><p>Atendió: [NOMBRE_DOCTOR] · [CEDULA_DOCTOR] · [FECHA]</p>";
  const esperada = vieja
    .replace("<b>control</b>", "<strong>control</strong>")
    .replace("<i>restauración</i>", "<em>restauración</em>");
  assert.equal(idaYVuelta(vieja), esperada);
});

test("la carta precargada de consentimiento (secciones y viñetas) se conserva", () => {
  const carta =
    "<p><strong>CARTA DE CONSENTIMIENTO INFORMADO</strong></p><h3>1. DATOS DEL PACIENTE</h3>" +
    "<p>Nombre: [NOMBRE_PACIENTE]. Representante: [NOMBRE_REPRESENTANTE] ([PARENTESCO_REPRESENTANTE]). Lugar: [LUGAR].</p>" +
    "<h3>2. RIESGOS</h3><ul><li>Dolor e inflamación.</li><li>Sangrado leve.</li></ul><p>Firma: ________</p>";
  assert.equal(idaYVuelta(carta), carta);
});

test("un marcador escrito que no existe se queda como texto", () => {
  assert.equal(idaYVuelta("<p>[NO_EXISTE] y [FECHA]</p>"), "<p>[NO_EXISTE] y [FECHA]</p>");
});

test("todo lo nuevo del contrato vuelve exacto", () => {
  const nuevo =
    '<p data-sangria="2" data-alineacion="centro">Texto <span data-tamano="14">grande</span> y <span data-tamano="10">chico</span></p>' +
    '<h2 data-alineacion="derecha">Título a la derecha</h2>' +
    '<table><tbody><tr><th><p>Pieza</p></th><th colspan="2"><p>Hallazgo</p></th></tr>' +
    '<tr><td><p>1.6</p></td><td><p>Íntegra</p></td><td><p>Control</p></td></tr>' +
    '<tr><td rowspan="2"><p>2.6</p></td><td><p>a</p></td><td><p>b</p></td></tr><tr><td><p>c</p></td><td><p>d</p></td></tr></tbody></table>' +
    '<div data-n="2" data-tipo="columnas"><div data-tipo="columna"><h3>Procedimiento</h3><p>Aislamiento.</p></div><div data-tipo="columna"><ul><li>Evitar duros.</li></ul></div></div>' +
    '<img data-archivo="documentos/cl_1/rx-01.webp" data-ancho="medio" data-alineacion="izquierda" alt="Radiografía">' +
    '<div data-lado="derecha" data-tipo="linea-firma">Nombre y firma del doctor</div>' +
    '<div data-tipo="salto-pagina"></div>' +
    "<p>Después del salto [FECHA]</p>";
  assert.equal(idaYVuelta(nuevo), nuevo);
});

test("tres columnas y una firma dentro de una columna", () => {
  const html =
    '<div data-n="3" data-tipo="columnas"><div data-tipo="columna"><div data-lado="izquierda" data-tipo="linea-firma">Paciente</div></div>' +
    '<div data-tipo="columna"><div data-lado="izquierda" data-tipo="linea-firma">Doctor</div></div><div data-tipo="columna"><p>Testigo</p></div></div>';
  assert.equal(idaYVuelta(html), html);
});

test("valores fuera del contrato se corrigen al valor por defecto (no se guardan a ciegas)", () => {
  assert.equal(idaYVuelta('<p data-sangria="9" data-alineacion="raro">x</p>'), '<p data-sangria="6">x</p>');
  assert.equal(idaYVuelta('<span data-tamano="13">x</span>'), "<p>x</p>");
  assert.equal(
    idaYVuelta('<img data-archivo="documentos/cl_1/a.webp" data-ancho="enorme" data-alineacion="arriba" alt="">'),
    '<img data-archivo="documentos/cl_1/a.webp" data-ancho="medio" data-alineacion="centro" alt="">',
  );
  assert.equal(idaYVuelta('<div data-tipo="linea-firma" data-lado="abajo">F</div>'), '<div data-lado="izquierda" data-tipo="linea-firma">F</div>');
});

test("una imagen con src (data: o https) o sin clave válida NO entra; queda el texto de alrededor", () => {
  assert.equal(idaYVuelta('<p>antes</p><img src="data:image/png;base64,AAAA"><p>después</p>'), "<p>antes</p><p>después</p>");
  assert.equal(idaYVuelta('<img src="https://x/y.png" data-archivo="../../etc/passwd">'), "<p></p>");
  assert.equal(idaYVuelta('<img data-archivo="documentos/cl_1/a.webp" src="javascript:alert(1)" data-ancho="chico" data-alineacion="centro" alt="">'),
    '<img data-archivo="documentos/cl_1/a.webp" data-ancho="chico" data-alineacion="centro" alt="">');
});

test("lo que no está en la lista blanca se cae y queda su texto", () => {
  const sucio =
    '<p>Ver <a href="https://x">la liga</a> y <code>cod</code> y <s>tachado</s> y <span style="color:red">rojo</span></p>' +
    "<blockquote><p>cita</p></blockquote><pre><code>bloque</code></pre><hr><script>alert(1)</script>";
  assert.equal(pegar(sucio), "<p>Ver la liga y cod y tachado y rojo</p><p>cita</p><p>bloque</p>");
});

test("pegar de Word: negritas, listas, tabla, alineación y tamaño se conservan como contrato", () => {
  const word =
    '<html><body><!--[if gte mso 9]><xml>x</xml><![endif]--><p class="MsoNormal" style="text-align:center;mso-x:1"><b><span style="font-size:14.0pt">Título</span></b><o:p></o:p></p>' +
    '<p class="MsoListParagraph" style="text-indent:-18pt"><span style="font-family:Symbol">·</span> No es lista de verdad</p>' +
    '<ul><li class="MsoNormal">Uno</li><li class="MsoNormal">Dos</li></ul>' +
    '<table class="MsoTableGrid" border="1" cellspacing="0" style="border-collapse:collapse"><tr><td width="200" valign="top" style="border:solid"><p class="MsoNormal">A</p></td><td><p class="MsoNormal">B</p></td></tr></table>' +
    "</body></html>";
  const r = pegar(word);
  assert.equal(
    r,
    '<p data-alineacion="centro"><strong><span data-tamano="14">Título</span></strong></p>' +
      "<p>· No es lista de verdad</p><ul><li>Uno</li><li>Dos</li></ul>" +
      "<table><tbody><tr><td><p>A</p></td><td><p>B</p></td></tr></tbody></table>",
  );
});

test("pegar de Google Docs: el envoltorio <b style=font-weight:normal> no pone todo en negrita", () => {
  const gd =
    '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-x"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt">' +
    '<span style="font-size:11pt;font-family:Arial;color:#000000;font-weight:400">Normal y </span><span style="font-size:11pt;font-weight:700">negrita</span></p></b>';
  assert.equal(pegar(gd), '<p><span data-tamano="11">Normal y </span><strong><span data-tamano="11">negrita</span></strong></p>');
});

test("sin texto queda un párrafo vacío, que el servidor rechaza como cuerpo vacío", () => {
  assert.equal(idaYVuelta(""), "<p></p>");
});
