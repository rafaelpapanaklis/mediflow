/**
 * El LECTOR del HTML guardado (`html-a-bloques.ts`) con lo que escribe el
 * editor nuevo: tablas, columnas, imagen, línea de firma, salto de página,
 * sangría, alineación y tamaño de letra. Y el PDF de RESPALDO (@react-pdf) que
 * lo pinta, leído DE VERDAD página a página (`_texto-del-pdf.ts`).
 *
 * Run: npm run test:html-a-bloques
 *
 *   · `<li><p>x</p></li>` (Tiptap) no pierde la viñeta, aunque se haya guardado
 *     sin normalizar;
 *   · una imagen en el PDF de respaldo es un hueco con su descripción: nunca
 *     revienta, ni con 40;
 *   · «Nueva página» corta de verdad la hoja;
 *   · lo viejo se lee igual que siempre.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { htmlABloques, htmlATexto, type Bloque } from "../html-a-bloques";
import { renderizarPdf, type DocumentoParaPdf } from "../pdf";
import { sanitizeTemplateHtml } from "@/lib/document-templates/sanitize";
import { textoVisiblePorPagina } from "@/lib/pdf/__tests__/_texto-del-pdf";
import { MAQUETA_CONSENTIMIENTO, MAQUETA_NOTA, MAQUETA_PLANTILLA } from "@/lib/document-templates/__tests__/_maqueta-lo-que-se-guardaria";

const ARCHIVO = "documentos/clinica_qa_prueba/0123456789abcdef0123456789abcdef.webp";
const conClave = (html: string) => html.replace(/<img src="[^"]*"/g, `<img data-archivo="${ARCHIVO}"`);

const texto = (b: Bloque) => ("tramos" in b ? b.tramos.map((t) => t.texto).join("") : "");

const DOC: DocumentoParaPdf = {
  id: "doc-0001-abcdef", tipo: "Nota de evolución", titulo: "Control de resina", fecha: "21 de octubre de 2026",
  clinicaNombre: "Clínica de Prueba QA", clinicaDireccion: "Calle 60 #123, Mérida", clinicaTelefono: "999 123 4567",
  logoUrl: null, pacienteNombre: "Ana López", pacienteNumero: "P-0042", pacienteCurp: "LOAA900101MYNPNN09",
  pacienteSinCurp: false, doctorNombre: "Laura Pérez", cedula: "1234567", doctorCedulaEspecialidad: null,
  doctorEspecialidad: "Endodoncia", cuerpoHtml: "", firmado: true, firmadoEl: "21 de octubre de 2026, 10:00",
};

describe("lo de siempre se lee igual", () => {
  it("párrafos, títulos, listas anidadas, marcas y entidades", () => {
    const b = htmlABloques("<p>a &amp; b &lt;c&gt;<br>d</p><ul><li>uno<ul><li>dentro</li></ul></li></ul>suelto");
    assert.equal(texto(b[0]), "a & b <c>\nd");
    assert.deepEqual(b.slice(1).map((x) => (x.tipo === "item" ? [x.marca, x.nivel] : x.tipo)), [["•", 0], ["•", 1], "parrafo"]);
    assert.deepEqual(htmlABloques("<p><br></p>"), []);
    assert.equal(htmlATexto("<p>Hola</p><ol><li>x</li></ol>"), "Hola\n\n1. x");
    const [p] = htmlABloques("<p><b>n<i>ni</i></b><u>s</u></p>");
    assert.ok(p.tipo === "parrafo");
    assert.deepEqual(
      p.tramos.map((t) => [t.texto, t.negrita, t.cursiva, t.subrayado, t.tamano]),
      [["n", true, false, false, null], ["ni", true, true, false, null], ["s", false, false, true, null]],
    );
    assert.equal(p.sangria, 0);
    assert.equal(p.alineacion, null);
  });

  it("las cartas de fábrica dan el mismo texto que antes", () => {
    const html = "<h1>CARTA</h1>\n<p>Yo, [NOMBRE_PACIENTE]</p>\n<h2>1. RIESGOS</h2>\n<ul><li>Dolor</li><li>Sangrado</li></ul>";
    assert.equal(htmlATexto(html), "CARTA\n\nYo, [NOMBRE_PACIENTE]\n\n1. RIESGOS\n\n• Dolor\n\n• Sangrado");
  });
});

describe("lo que escribe el editor nuevo", () => {
  it("<li><p>x</p></li> conserva la viñeta y el texto (aunque se guardara sin normalizar)", () => {
    const b = htmlABloques("<ul><li><p>uno</p></li><li><p>dos</p><p>sigue</p></li></ul><ol><li><p>a</p><ol><li><p>a.1</p></li></ol></li></ol>");
    assert.deepEqual(
      b.map((x) => (x.tipo === "item" ? [x.marca, x.nivel, texto(x)] : x.tipo)),
      [["•", 0, "uno"], ["•", 0, "dos\nsigue"], ["1.", 0, "a"], ["1.", 1, "a.1"]],
    );
  });

  it("sangría, alineación y tamaño de letra llegan al bloque", () => {
    const [p, h] = htmlABloques('<p data-sangria="3" data-alineacion="justificado">x <span data-tamano="18">y</span></p><h2 data-alineacion="centro">T</h2>');
    assert.ok(p.tipo === "parrafo" && h.tipo === "h2");
    assert.equal(p.sangria, 3);
    assert.equal(p.alineacion, "justificado");
    assert.deepEqual(p.tramos.map((t) => t.tamano), [null, 18]);
    assert.equal(h.alineacion, "centro");
  });

  it("tabla: filas, encabezados, colspan y lo que lleva cada celda", () => {
    const [t] = htmlABloques('<table><tbody><tr><th><p>Pieza</p></th><th colspan="2"><p>Plan</p></th></tr><tr><td><p>1.6</p></td><td><ul><li>a</li></ul></td><td>b</td></tr></tbody></table>');
    assert.ok(t.tipo === "tabla");
    assert.deepEqual(t.filas.map((f) => f.map((c) => [c.encabezado, c.colspan])), [[[true, 1], [true, 2]], [[false, 1], [false, 1], [false, 1]]]);
    assert.deepEqual(t.filas[1][1].bloques.map((b) => b.tipo), ["item"]);
    assert.equal(htmlATexto('<table><tr><th>A</th><th>B</th></tr><tr><td><p>1</p><p>2</p></td><td>3</td></tr></table>'), "A | B\n1 2 | 3");
  });

  it("columnas, firma, salto e imagen", () => {
    const b = htmlABloques(
      '<div data-tipo="columnas" data-n="2"><div data-tipo="columna"><p>izq</p></div><div data-tipo="columna"><div data-tipo="linea-firma" data-lado="derecha">Dra. Ana</div></div></div>' +
        '<div data-tipo="salto-pagina"></div>' +
        `<img data-archivo="${ARCHIVO}" data-ancho="chico" data-alineacion="derecha" alt="Rx periapical">` +
        `<img data-archivo="${ARCHIVO}">` +
        '<div data-tipo="linea-firma"></div>',
    );
    assert.deepEqual(b.map((x) => x.tipo), ["columnas", "salto", "imagen", "imagen", "firma"]);
    const [cols, , img, imgDefecto, firmaVacia] = b;
    assert.ok(cols.tipo === "columnas");
    assert.deepEqual(cols.columnas.map((c) => c.map((x) => [x.tipo, texto(x)])), [[["parrafo", "izq"]], [["firma", "Dra. Ana"]]]);
    assert.ok(cols.columnas[1][0].tipo === "firma" && cols.columnas[1][0].lado === "derecha");
    assert.deepEqual(img, { tipo: "imagen", archivo: ARCHIVO, ancho: "chico", alineacion: "derecha", alt: "Rx periapical" });
    assert.ok(imgDefecto.tipo === "imagen" && imgDefecto.ancho === "medio" && imgDefecto.alineacion === "centro");
    assert.ok(firmaVacia.tipo === "firma", "la raya de firma se queda aunque no lleve nombre");
    assert.equal(
      htmlATexto(`<p>a</p><img data-archivo="${ARCHIVO}" alt="Rx"><div data-tipo="salto-pagina"></div><div data-tipo="linea-firma">Dra. Ana</div>`),
      "a\n\n[Imagen: Rx]\n\n______________________________\nDra. Ana",
    );
  });

  it("un salto dentro de una celda o columna no corta la hoja (solo cuenta en el cuerpo)", () => {
    const b = htmlABloques('<table><tr><td>a<div data-tipo="salto-pagina"></div>b</td></tr></table>');
    assert.ok(b[0].tipo === "tabla");
    assert.ok(!JSON.stringify(b).includes('"salto"'));
  });

  it("tolerante: lo que no está en su sitio no se pierde ni revienta", () => {
    const raros = [
      "<td>suelta</td><tr>fila</tr>",
      "<table>antes<tr><td>x</td></tr><p>colado</p></table>",
      "<table><tr><td><table><tr><td>anidada</td></tr></table></td></tr></table>",
      "<ul><li>a<p>b",
      '<div data-tipo="columna">sin columnas</div><div data-tipo="columnas">sin columna</div>',
      '<div data-tipo="linea-firma"><p>uno</p><p>dos</p></div>',
      "<p>3 < 5 y <b>sin cerrar",
      "</p></li></table>texto",
      `<p>antes<img data-archivo="${ARCHIVO}">después</p>`,
    ];
    for (const r of raros) {
      const plano = htmlATexto(r);
      for (const palabra of r.replace(/<[^>]*>/g, " ").split(/\s+/).filter((w) => /^[a-zá-ú]+$/i.test(w))) {
        assert.ok(plano.includes(palabra), `«${palabra}» se perdió leyendo ${r} → ${JSON.stringify(plano)}`);
      }
    }
    assert.deepEqual(
      htmlABloques('<div data-tipo="linea-firma"><p>uno</p><p>dos</p></div>').map((b) => [b.tipo, texto(b)]),
      [["firma", "uno\ndos"]],
    );
  });

  it("todo lo que deja el saneador se puede leer (3000 sopas)", () => {
    let s = 99;
    const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const PIEZAS = [
      "<p>", "</p>", "<li>", "</li>", "<ul>", "<ol>", "</ul>", "<table>", "</table>", "<tr>", "<td colspan=\"3\">", "</td>", "<th>",
      "<span data-tamano=\"24\">", "</span>", "<b>", "</b>", "<br>", `<img data-archivo="${ARCHIVO}" alt="x">`,
      "<div data-tipo=\"columnas\" data-n=\"3\">", "<div data-tipo=\"columna\">", "<div data-tipo=\"linea-firma\">",
      "<div data-tipo=\"salto-pagina\">", "</div>", "<h2 data-alineacion=\"derecha\">", "texto", " ", "&lt;", "<",
    ];
    for (let k = 0; k < 3000; k++) {
      const html = sanitizeTemplateHtml(Array.from({ length: 1 + Math.floor(r() * 30) }, () => PIEZAS[Math.floor(r() * PIEZAS.length)]).join(""));
      htmlABloques(html);
      htmlATexto(html);
    }
  });
});

describe("el PDF de respaldo pinta lo nuevo", () => {
  it("la nota de la maqueta: tabla, columnas, firma, imagen como hueco y «Nueva página» que corta la hoja", async () => {
    const cuerpo = sanitizeTemplateHtml(conClave(MAQUETA_NOTA));
    const paginas = textoVisiblePorPagina(await renderizarPdf({ ...DOC, cuerpoHtml: cuerpo }, null));
    assert.ok(paginas.length >= 2, `${paginas.length} página(s)`);
    const donde = (s: string) => paginas.findIndex((p) => p.includes(s));
    for (const s of ["Prueba", "Resultado", "Percusión", "Negativa", "Ajuste oclusal selectivo.", "Higiene", "Alimentación", "Imagen", "Dra. Ana Sofía Beltrán"]) {
      assert.ok(donde(s) >= 0, `«${s}» no está en el PDF`);
    }
    // El salto va justo antes de «Indicaciones entregadas»: lo de antes y lo de después, en hojas distintas.
    assert.ok(donde("Indicaciones entregadas") > donde("acepta el plan"), "el salto de página no cortó la hoja");
    assert.ok(paginas.every((p, i) => p.includes(`Página ${i + 1} de ${paginas.length}`)));
  });

  it("las tres de la maqueta, y un documento con 40 imágenes, se generan sin reventar", async () => {
    const cuarenta = Array.from({ length: 40 }, (_, n) => `<img data-archivo="documentos/c1/${String(n).padStart(32, "0")}.webp" alt="Foto ${n}"><p>Pie ${n}</p>`).join("");
    for (const html of [MAQUETA_PLANTILLA, MAQUETA_NOTA, MAQUETA_CONSENTIMIENTO, cuarenta]) {
      const pdf = await renderizarPdf({ ...DOC, cuerpoHtml: sanitizeTemplateHtml(conClave(html)) }, null);
      assert.ok(pdf.subarray(0, 5).toString() === "%PDF-");
    }
    const paginas = textoVisiblePorPagina(await renderizarPdf({ ...DOC, cuerpoHtml: sanitizeTemplateHtml(cuarenta) }, null));
    assert.ok(paginas.join(" ").includes("Imagen: Foto 39"), "cada imagen deja su hueco con su descripción");
  });

  it("la carta de la maqueta: título centrado, firmas en columnas y testigos", async () => {
    const paginas = textoVisiblePorPagina(await renderizarPdf({ ...DOC, cuerpoHtml: sanitizeTemplateHtml(MAQUETA_CONSENTIMIENTO) }, null));
    const todo = paginas.join(" ");
    for (const s of ["CARTA DE CONSENTIMIENTO INFORMADO", "Paciente o representante legal", "Estomatólogo responsable", "Testigo 1", "Testigo 2"]) {
      assert.ok(todo.includes(s), `«${s}» no está en el PDF`);
    }
  });
});

describe("pintar lo guardado: imágenes en el visor y en el correo", () => {
  it("el visor pone la src de la ruta a cada clave válida, y a ninguna otra cosa", async () => {
    const { conSrcDeImagenes, rutaDeImagen } = await import("@/lib/documentos/imagenes");
    const guardado = sanitizeTemplateHtml(`<p>a</p><img data-archivo="${ARCHIVO}" data-ancho="chico" alt="Rx">`);
    assert.equal(
      conSrcDeImagenes(guardado),
      `<p>a</p><img src="${rutaDeImagen(ARCHIVO)}" data-archivo="${ARCHIVO}" data-ancho="chico" alt="Rx">`,
    );
    assert.equal(rutaDeImagen(ARCHIVO), `/api/documentos/imagenes/${encodeURIComponent(ARCHIVO)}`);
    // Un documento viejo (sin imágenes) sale tal cual, sin tocar.
    const viejo = "<p>Hola</p><ul><li>x</li></ul>";
    assert.equal(conSrcDeImagenes(viejo), viejo);
    // Una clave que no tiene la forma exacta no recibe src (aunque llegara a estar guardada).
    assert.equal(conSrcDeImagenes('<img data-archivo="documentos/x/../y.webp">'), '<img data-archivo="documentos/x/../y.webp">');
  });

  it("DocumentoCuerpo pinta con conSrcDeImagenes (el visor de notas y el de consentimientos)", async () => {
    const { readFileSync } = await import("node:fs");
    const fuente = readFileSync("src/components/dashboard/documentos-paciente/documento-hoja.tsx", "utf8");
    assert.match(fuente, /dangerouslySetInnerHTML=\{\{ __html: conSrcDeImagenes\(html\) \}\}/);
  });

  it("en el correo la imagen va como su descripción, en el HTML y en el texto plano", async () => {
    const { correoDelDocumento } = await import("../envio");
    const cuerpoHtml = sanitizeTemplateHtml(`<p>Control</p><img data-archivo="${ARCHIVO}" alt="Rx &quot;inicial&quot;"><img data-archivo="${ARCHIVO}">`);
    const c = correoDelDocumento({
      tipo: "Nota de evolución", titulo: "Control", fecha: "21 de octubre", clinicaNombre: "Sol",
      pacienteNombre: "Ana", doctorNombre: "Laura", cedula: null, cuerpoHtml,
    });
    assert.ok(!c.html.includes("<img"), "ninguna <img> rota en el correo");
    assert.ok(c.html.includes("[Imagen: Rx &quot;inicial&quot;]") && c.html.includes("[Imagen]"));
    assert.ok(c.text.includes('[Imagen: Rx "inicial"]') && c.text.includes("[Imagen]"));
  });
});
