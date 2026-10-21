/**
 * ws1-t10 · P1 — lo puro del editor de documentos: marcadores ⇄ fichas,
 * normalización al contrato, limpieza del pegado y el contrato mismo.
 *
 * Run: npm run test:editor-documento
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DOCUMENT_MARKERS } from "@/lib/document-templates/markers";
import {
  ALINEACIONES, ANCHOS_IMAGEN, LADOS, PATRON_ARCHIVO_IMAGEN, TAMANOS, alineacionDesdeCss, rutaImagen, sangriaValida,
  tamanoDesdeCss,
} from "../contrato";
import { estaVacioHtml, fichasAMarcadores, htmlParaEditor, marcadoresAFichas, normalizarParaGuardar } from "../html";
import { limpiarPegado, textoPlanoAHtml } from "../pegado";

const CLAVES = DOCUMENT_MARKERS.map((m) => m.token.slice(1, -1));

test("el contrato: los valores enumerados de la sección 5 del diseño", () => {
  assert.deepEqual([...TAMANOS], ["10", "11", "12", "14", "16", "18", "24"]);
  assert.deepEqual([...ALINEACIONES], ["izquierda", "centro", "derecha", "justificado"]);
  assert.deepEqual([...ANCHOS_IMAGEN], ["chico", "medio", "completo"]);
  assert.deepEqual([...LADOS], ["izquierda", "centro", "derecha"]);
  assert.ok(PATRON_ARCHIVO_IMAGEN.test("documentos/cl_1/abc-123.webp"));
  assert.ok(!PATRON_ARCHIVO_IMAGEN.test("../etc/passwd"));
  assert.ok(!PATRON_ARCHIVO_IMAGEN.test("documentos/cl_1/x.svg"));
  assert.ok(!PATRON_ARCHIVO_IMAGEN.test("documentos/cl_1/x.jpg"), "solo webp: así lo guarda P4 y así lo acepta P2");
  assert.ok(!PATRON_ARCHIVO_IMAGEN.test("documentos/cl_1/x.png"));
  assert.ok(!PATRON_ARCHIVO_IMAGEN.test("documentos/otra/../cl_1/x.webp"));
  assert.equal(rutaImagen("documentos/cl 1/a.webp"), "/api/documentos/imagenes/documentos%2Fcl%201%2Fa.webp");
  assert.equal(sangriaValida(9), 6);
  assert.equal(sangriaValida(-1), 0);
  assert.equal(sangriaValida("3"), 3);
  assert.equal(sangriaValida("x"), 0);
});

test("lo que trae Word se traduce a los valores nuestros", () => {
  assert.equal(alineacionDesdeCss("center"), "centro");
  assert.equal(alineacionDesdeCss("Right"), "derecha");
  assert.equal(alineacionDesdeCss("justify"), "justificado");
  assert.equal(alineacionDesdeCss("left"), "izquierda");
  assert.equal(alineacionDesdeCss("inherit"), null);
  assert.equal(tamanoDesdeCss("11.0pt"), "11");
  assert.equal(tamanoDesdeCss("14pt"), "14");
  assert.equal(tamanoDesdeCss("12pt"), null, "12 es el del cuerpo: no se marca");
  assert.equal(tamanoDesdeCss("16px"), null, "16 px = 12 pt");
  assert.equal(tamanoDesdeCss("24px"), "18");
  assert.equal(tamanoDesdeCss("13pt"), null, "fuera de la lista: se queda el del cuerpo");
  assert.equal(tamanoDesdeCss("grande"), null);
});

test("marcadores → fichas solo para las claves conocidas y solo en el texto", () => {
  const html = "<p>Hola [NOMBRE_PACIENTE], tu [INVENTADO] y [FECHA].</p>";
  assert.equal(
    marcadoresAFichas(html, CLAVES),
    '<p>Hola <span data-marcador="NOMBRE_PACIENTE"></span>, tu [INVENTADO] y <span data-marcador="FECHA"></span>.</p>',
  );
  // Una clave dentro de un atributo (no pasa en lo guardado, pero no se toca).
  assert.equal(marcadoresAFichas('<p title="[FECHA]">x</p>', CLAVES), '<p title="[FECHA]">x</p>');
  assert.equal(marcadoresAFichas(html, []), html);
  assert.equal(htmlParaEditor("", CLAVES), "");
});

test("fichas → marcadores: la vuelta exacta, aunque la ficha traiga clase o contenteditable", () => {
  assert.equal(fichasAMarcadores('<p>a <span data-marcador="FECHA"></span> b</p>'), "<p>a [FECHA] b</p>");
  assert.equal(
    fichasAMarcadores('<p><span class="m" data-marcador="NOMBRE_PACIENTE" contenteditable="false"></span></p>'),
    "<p>[NOMBRE_PACIENTE]</p>",
  );
});

test("ida y vuelta de marcadores: todas las claves del catálogo vuelven a ser el mismo texto", () => {
  const texto = `<p>${CLAVES.map((c) => `[${c}]`).join(" ")}</p>`;
  assert.equal(fichasAMarcadores(marcadoresAFichas(texto, CLAVES)), texto);
});

test("normalizar: <li><p> vuelve a <li> (el formato de siempre y lo que lee el PDF)", () => {
  assert.equal(normalizarParaGuardar("<ul><li><p>uno</p></li><li><p>dos</p></li></ul>"), "<ul><li>uno</li><li>dos</li></ul>");
  // Un segundo párrafo dentro del ítem se separa con <br>.
  assert.equal(normalizarParaGuardar("<ol><li><p>a</p><p>b</p></li></ol>"), "<ol><li>a<br>b</li></ol>");
  // Lista anidada: el <p> del ítem se quita y la sublista queda.
  assert.equal(
    normalizarParaGuardar("<ul><li><p>a</p><ul><li><p>a.1</p></li></ul></li></ul>"),
    "<ul><li>a<ul><li>a.1</li></ul></li></ul>",
  );
  // Un <li> sin <p> no se toca.
  assert.equal(normalizarParaGuardar("<ul><li>x</li></ul>"), "<ul><li>x</li></ul>");
});

test("normalizar: nunca style ni class; sin colgroup; colspan=1 fuera; solo los atributos del contrato", () => {
  const sucio =
    '<table style="min-width: 75px"><colgroup><col style="min-width:25px"><col></colgroup><tbody>' +
    '<tr><th colspan="1" rowspan="1" style="text-align:left" class="x"><p>A</p></th><th colspan="2"><p>B</p></th></tr>' +
    '<tr><td data-colwidth="100"><p>1</p></td><td><p>2</p></td><td><p>3</p></td></tr></tbody></table>';
  assert.equal(
    normalizarParaGuardar(sucio),
    "<table><tbody><tr><th><p>A</p></th><th colspan=\"2\"><p>B</p></th></tr><tr><td><p>1</p></td><td><p>2</p></td><td><p>3</p></td></tr></tbody></table>",
  );
  assert.equal(
    normalizarParaGuardar('<p style="text-align:center" data-alineacion="centro" data-sangria="2" class="z">x</p>'),
    '<p data-alineacion="centro" data-sangria="2">x</p>',
  );
  assert.equal(
    normalizarParaGuardar('<img src="/api/documentos/imagenes/x" data-archivo="documentos/c/a.webp" data-ancho="chico" data-alineacion="derecha" alt="rx" class="imagen">'),
    '<img data-archivo="documentos/c/a.webp" data-ancho="chico" data-alineacion="derecha" alt="rx">',
  );
  assert.equal(
    normalizarParaGuardar('<div data-tipo="linea-firma" data-lado="centro" class="f">Firma</div><div data-tipo="salto-pagina" contenteditable="false"></div>'),
    '<div data-tipo="linea-firma" data-lado="centro">Firma</div><div data-tipo="salto-pagina"></div>',
  );
  assert.equal(normalizarParaGuardar('<span style="font-size:14pt" data-tamano="14">g</span>'), '<span data-tamano="14">g</span>');
  assert.equal(normalizarParaGuardar('<p onclick="x()">a</p>'), "<p>a</p>");
});

test("normalizar: un HTML viejo (p/h1-h3/listas/b/i/u/br) sale igual que entró", () => {
  const viejo = "<h1>Título</h1><p>Hola <b>negrita</b> <i>cursiva</i> <u>sub</u><br>otra</p><ul><li>uno</li></ul><ol><li>dos</li></ol><h2>Sub</h2><h3>Ap</h3><p></p>";
  assert.equal(normalizarParaGuardar(viejo), viejo);
});

test("normalizar: el texto no se toca (entidades, comillas, corchetes que no son marcador)", () => {
  const html = "<p>Tom &amp; Jerry &lt;3 &quot;x&quot; [no es marcador] [TAMPOCO-ESTO]</p>";
  assert.equal(normalizarParaGuardar(html), html);
});

test("estaVacioHtml: sin texto ni imagen ni tabla", () => {
  assert.ok(estaVacioHtml(""));
  assert.ok(estaVacioHtml("<p></p>"));
  assert.ok(estaVacioHtml("<p>&nbsp;</p><p>  </p>"));
  assert.ok(estaVacioHtml('<div data-tipo="salto-pagina"></div><p></p>'));
  assert.ok(!estaVacioHtml("<p>a</p>"));
  assert.ok(!estaVacioHtml("<p>[NOMBRE_PACIENTE]</p>"));
  assert.ok(!estaVacioHtml('<img data-archivo="documentos/c/a.webp" data-ancho="medio" data-alineacion="centro" alt="">'));
  assert.ok(!estaVacioHtml("<table><tbody><tr><td><p></p></td></tr></tbody></table>"));
});

test("pegar de Word: fuera comentarios condicionales, o:p, xml, style y mso-*; el formato se queda", () => {
  const word =
    '<html><head><style>p.MsoNormal{margin:0}</style><xml><w:x/></xml></head><body><!--[if gte mso 9]><xml>x</xml><![endif]-->' +
    '<p class="MsoNormal" style="mso-margin-top-alt:auto;text-align:center"><b>Hola</b><o:p></o:p></p>' +
    '<span style="mso-bidi-font-weight:bold"> </span><p>fin</p></body></html>';
  const limpio = limpiarPegado(word);
  assert.ok(!/mso-|MsoNormal|<o:p|<xml|<style|\[if/.test(limpio), limpio);
  assert.ok(limpio.includes("<b>Hola</b>"));
  assert.ok(limpio.includes('style="text-align:center"'), "la alineación viaja hasta el esquema, que la traduce");
  assert.ok(limpio.includes("<p>fin</p>"));
});

test("pegar de Google Docs: el <b style=font-weight:normal> que envuelve todo no es negrita", () => {
  const gd = '<b style="font-weight:normal;" id="docs-internal-guid-1"><p><span style="font-weight:700">Neg</span> normal</p></b>';
  const limpio = limpiarPegado(gd);
  assert.ok(!/<b\s/.test(limpio), limpio);
  assert.ok(limpio.includes('<span style="font-weight:700">Neg</span>'));
});

test("texto plano pegado: cada renglón es un párrafo y el HTML se escapa", () => {
  assert.equal(textoPlanoAHtml("uno\r\n\r\ndos <b>"), "<p>uno</p><p>dos &lt;b&gt;</p>");
  assert.equal(textoPlanoAHtml(""), "");
});
