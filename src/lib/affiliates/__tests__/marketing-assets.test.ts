import { test } from "node:test";
import assert from "node:assert/strict";
import {
  affiliateShortName,
  displayShortUrl,
  findSocialFormat,
  findSocialVariant,
  findPrintPiece,
  SOCIAL_FORMATS,
  SOCIAL_VARIANTS,
  PRINT_PIECES,
} from "../marketing-assets";

// Las piezas del kit visual llevan el nombre del afiliado impreso. Lo que se
// prueba aquí es lo que no se puede mirar en un PDF: que una cuenta sin nombre
// no tumbe la generación, y que un parámetro inventado en la URL no llegue a
// la ruta como si fuera un formato válido.

/* ── Nombre para la pieza ─────────────────────────────────────────────── */

test("nombre y apellido → nombre de pila + inicial", () => {
  assert.equal(affiliateShortName("Martín Rodríguez Salas"), "Martín R.");
  assert.equal(affiliateShortName("Ana López"), "Ana L.");
});

test("un solo nombre se queda tal cual, sin inicial colgando", () => {
  assert.equal(affiliateShortName("Guadalupe"), "Guadalupe");
});

test("sin nombre utilizable devuelve null — la línea se OMITE, no revienta", () => {
  // El caso real: cuenta dada de alta con el campo vacío o en blancos. Las
  // tres piezas y las cuatro imágenes se generan igual, solo que sin la
  // línea "Recomendado por".
  assert.equal(affiliateShortName(""), null);
  assert.equal(affiliateShortName("   "), null);
  assert.equal(affiliateShortName("\n\t "), null);
  assert.equal(affiliateShortName(null), null);
  assert.equal(affiliateShortName(undefined), null);
});

test("espacios de sobra no inventan un apellido vacío", () => {
  assert.equal(affiliateShortName("  Martín   Rodríguez  "), "Martín R.");
});

test("un apellido que no empieza por letra no aporta inicial", () => {
  // "Martín .." se vería como un error de impresión; mejor el nombre solo.
  assert.equal(affiliateShortName("Martín -Rodríguez"), "Martín");
  assert.equal(affiliateShortName('Ana "La Güera"'), "Ana");
});

test("un nombre larguísimo se recorta: en una tarjeta de 90 mm no cabe", () => {
  const short = affiliateShortName("Maximilianowenceslaobuenaventura Echeverría");
  assert.ok(short && short.length <= 26, `demasiado largo: ${short}`);
  assert.ok(short!.endsWith("E."));
});

/* ── URL visible bajo el QR ───────────────────────────────────────────── */

test("la URL impresa pierde el protocolo y el www, no el resto", () => {
  assert.equal(displayShortUrl("https://www.dalecontrol.com/r/AB12CD34"), "dalecontrol.com/r/AB12CD34");
  assert.equal(displayShortUrl("http://dalecontrol.com/r/ab12cd34"), "dalecontrol.com/r/ab12cd34");
  // Una base con barra final dejaría "dalecontrol.com/r/CODE" intacto; lo que
  // se recorta es la barra suelta del final, no un segmento de la ruta.
  assert.equal(displayShortUrl("https://dalecontrol.com/r/AB12CD34/"), "dalecontrol.com/r/AB12CD34");
});

/* ── Catálogo: nada que no esté en la lista ───────────────────────────── */

test("los buscadores aceptan lo del catálogo y RECHAZAN lo demás", () => {
  for (const f of SOCIAL_FORMATS) assert.equal(findSocialFormat(f.id)?.id, f.id);
  for (const v of SOCIAL_VARIANTS) assert.equal(findSocialVariant(v.id)?.id, v.id);
  for (const p of PRINT_PIECES) assert.equal(findPrintPiece(p.id)?.id, p.id);

  // Lo que llega por la URL: si un id inventado colara, acabaría en el nombre
  // del archivo de descarga y en un render sin escala definida.
  for (const junk of ["", "POST", "post ", "../etc/passwd", "<script>", null, undefined]) {
    assert.equal(findSocialFormat(junk), null, `formato colado: ${junk}`);
    assert.equal(findSocialVariant(junk), null, `variante colada: ${junk}`);
    assert.equal(findPrintPiece(junk), null, `pieza colada: ${junk}`);
  }
});

test("cada formato trae medida y escala propias, y ningún id se repite", () => {
  const ids = new Set(SOCIAL_FORMATS.map((f) => f.id));
  assert.equal(ids.size, SOCIAL_FORMATS.length);
  for (const f of SOCIAL_FORMATS) {
    assert.ok(f.width > 0 && f.height > 0, `${f.id} sin medida`);
    assert.ok(["square", "vertical", "wide"].includes(f.layout));
  }
});

test("ningún mensaje promete lo que el producto no hace", () => {
  // Los tres claims prohibidos del encargo. No sustituye a leerlos, pero
  // impide que vuelvan de un copy-paste distraído.
  const prohibidos = [/nom-?\s?024/i, /prueba gratis/i, /gratis/i, /\bgarantiz/i, /\$\s?\d/];
  const textos = SOCIAL_VARIANTS.flatMap((v) => [v.eyebrow, v.headline, ...v.lines]).concat(
    PRINT_PIECES.flatMap((p) => [p.label, p.size, p.hint]),
  );
  for (const t of textos) {
    for (const re of prohibidos) {
      assert.ok(!re.test(t), `claim prohibido (${re}) en: "${t}"`);
    }
  }
});
