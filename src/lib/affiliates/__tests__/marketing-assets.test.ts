import { test } from "node:test";
import assert from "node:assert/strict";
import {
  affiliateShortName,
  displayShortUrl,
  findSocialFormat,
  findSocialVariant,
  findSocialStyle,
  findPrintPiece,
  SOCIAL_FORMATS,
  SOCIAL_VARIANTS,
  SOCIAL_STYLES,
  PRINT_PIECES,
  PRINT_DEFAULT_STYLE,
  PLAN_NOTES,
} from "../marketing-assets";
import { FALLBACK_PLAN_CONFIG } from "../../plan-shared";

// Las piezas del kit visual llevan el nombre del afiliado impreso. Lo que se
// prueba aquí es lo que no se puede mirar en un PDF: que una cuenta sin nombre
// no tumbe la generación, que un parámetro inventado en la URL no llegue a la
// ruta como si fuera un formato válido, y —lo que más caro sale— que ninguna
// pieza prometa algo que el plan del dentista no incluye.

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
  for (const s of SOCIAL_STYLES) assert.equal(findSocialStyle(s.id)?.id, s.id);
  for (const p of PRINT_PIECES) assert.equal(findPrintPiece(p.id)?.id, p.id);

  // Lo que llega por la URL: si un id inventado colara, acabaría en el nombre
  // del archivo de descarga y en un render sin escala ni paleta definidas.
  for (const junk of ["", "POST", "post ", "../etc/passwd", "<script>", "oscuro ", null, undefined]) {
    assert.equal(findSocialFormat(junk), null, `formato colado: ${junk}`);
    assert.equal(findSocialVariant(junk), null, `variante colada: ${junk}`);
    assert.equal(findSocialStyle(junk), null, `estilo colado: ${junk}`);
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

/* ── La matriz: tema × estilo × formato ───────────────────────────────── */

test("hay al menos 10 temas y ninguno repite id ni titular", () => {
  assert.ok(SOCIAL_VARIANTS.length >= 10, `solo ${SOCIAL_VARIANTS.length} temas`);
  const ids = new Set(SOCIAL_VARIANTS.map((v) => v.id));
  const heads = new Set(SOCIAL_VARIANTS.map((v) => v.headline));
  assert.equal(ids.size, SOCIAL_VARIANTS.length, "id de tema repetido");
  assert.equal(heads.size, SOCIAL_VARIANTS.length, "dos temas dicen lo mismo");
});

test("los tres estilos existen y hay UNO recomendado para imprenta", () => {
  assert.equal(SOCIAL_STYLES.length, 3);
  const rec = SOCIAL_STYLES.filter((s) => s.printRecommended);
  assert.equal(rec.length, 1, "el panel marca un solo estilo como recomendado");
  assert.equal(PRINT_DEFAULT_STYLE, rec[0].id);
  // El recomendado para papel es el claro: es el único que no cubre la hoja.
  assert.equal(PRINT_DEFAULT_STYLE, "claro");
});

test("la matriz completa está entera: ninguna combinación sin contenido", () => {
  // 10 temas × 3 estilos × 4 formatos. Lo que se comprueba no es el pixel sino
  // que cada celda tenga con qué pintarse: si un tema se quedara sin bullets o
  // sin eyebrow, la imagen saldría con un hueco y nadie se enteraría hasta
  // verla publicada.
  let combos = 0;
  for (const v of SOCIAL_VARIANTS) {
    assert.ok(v.eyebrow.trim().length > 0, `${v.id} sin eyebrow`);
    assert.ok(v.headline.trim().length > 0, `${v.id} sin titular`);
    assert.ok(v.label.trim().length > 0, `${v.id} sin nombre en el selector`);
    assert.ok(v.printIntro.trim().length > 20, `${v.id} sin entrada para el papel`);
    // Dos apoyos: con tres, en 1080 px de ancho ya no respiran.
    assert.ok(v.lines.length === 2, `${v.id} tiene ${v.lines.length} apoyos, no 2`);
    for (const l of v.lines) assert.ok(l.trim().length > 0, `${v.id} con un apoyo vacío`);
    // El titular tiene que caber en la portada de Facebook (48 px sobre 1080
    // de caja segura): pasando de ~52 caracteres se parte en tres renglones y
    // se come el mensaje.
    assert.ok(v.headline.length <= 52, `titular largo en ${v.id}: ${v.headline.length}`);
    for (const s of SOCIAL_STYLES) {
      for (const f of SOCIAL_FORMATS) {
        assert.ok(findSocialVariant(v.id) && findSocialStyle(s.id) && findSocialFormat(f.id));
        combos += 1;
      }
    }
  }
  assert.ok(combos >= 120, `solo ${combos} combinaciones`);
});

test("las piezas de papel que llevan tema son el volante y el díptico", () => {
  const withVariant = PRINT_PIECES.filter((p) => p.usesVariant).map((p) => p.id);
  assert.deepEqual(withVariant.sort(), ["diptico", "volante"]);
  // La tarjeta NO: en 90 × 50 mm no cabe un titular de campaña con su nota de
  // plan, y sin la nota sería justo la pieza que miente.
  assert.equal(findPrintPiece("tarjetas")?.usesVariant, undefined);
});

/* ── Notas de plan: lo que más caro sale ──────────────────────────────── */

test("la nota de multi-sucursal dice el plan Y el número real de sedes", () => {
  const max = FALLBACK_PLAN_CONFIG.CLINIC.maxClinics;
  // Si esto cambia, es que el plan cambió: la nota tiene que seguirlo, no
  // quedarse con un "hasta 3" escrito a mano.
  assert.equal(max, 3);
  assert.match(PLAN_NOTES.sucursales, /Clínica/);
  assert.match(PLAN_NOTES.sucursales, /hasta 3 sedes/);
  // "Sucursales ilimitadas" sería mentira mientras maxClinics tenga tope.
  assert.doesNotMatch(PLAN_NOTES.sucursales, /ilimitad/i);
});

test("la nota de IA manda al plan que SÍ trae tokens, no al Básico", () => {
  // El Básico tiene 0 tokens y "ai-assistant" apagado: quien lo compre por la
  // IA se sentiría engañado con razón.
  assert.equal(FALLBACK_PLAN_CONFIG.BASIC.aiTokensDefault, 0);
  assert.equal(FALLBACK_PLAN_CONFIG.BASIC.features["ai-assistant"], false);
  assert.ok(FALLBACK_PLAN_CONFIG.PRO.aiTokensDefault > 0);
  assert.match(PLAN_NOTES.ia, /Profesional/);
  assert.doesNotMatch(PLAN_NOTES.ia, /Básico/i);
});

test("todo tema con tope de plan LLEVA su nota, y la nota nombra un plan", () => {
  // La reja de verdad. Un tema con límite y sin nota es material que promete
  // de más, y el papel impreso no se corrige.
  const conTope: Record<string, RegExp> = {
    sucursales: /Clínica/,
    ia: /Profesional/,
  };
  for (const v of SOCIAL_VARIANTS) {
    const esperado = conTope[v.id];
    if (esperado) {
      assert.ok(v.planNote, `el tema "${v.id}" tiene tope de plan y NO trae nota`);
      assert.match(v.planNote!, esperado, `la nota de "${v.id}" no dice el plan`);
      assert.match(v.planNote!, /plan/i, `la nota de "${v.id}" no dice que es un plan`);
    }
  }
  // …y al revés: ningún tema SIN tope arrastra una nota que confunda.
  for (const v of SOCIAL_VARIANTS) {
    if (!conTope[v.id]) {
      assert.equal(v.planNote, undefined, `el tema "${v.id}" no tiene tope pero trae nota`);
    }
  }
});

test("nadie promete IA, sedes o usuarios sin decir en qué plan vienen", () => {
  // Barrido sobre TODO el texto del catálogo, no solo sobre los dos temas que
  // sabemos: si mañana un apoyo suelto dice "usuarios ilimitados", aquí truena.
  const gatillos = [/\bIA\b/, /inteligencia artificial/i, /sucursal/i, /sede/i, /ilimitad/i, /usuarios/i];
  for (const v of SOCIAL_VARIANTS) {
    const cuerpo = [v.eyebrow, v.headline, ...v.lines, v.printIntro].join(" · ");
    const promete = gatillos.some((re) => re.test(cuerpo));
    if (promete) {
      assert.ok(
        v.planNote,
        `el tema "${v.id}" habla de IA/sucursales/usuarios y no trae nota de plan: "${cuerpo}"`,
      );
    }
  }
});

/* ── Claims prohibidos ────────────────────────────────────────────────── */

test("ningún mensaje promete lo que el producto no hace", () => {
  const prohibidos: { re: RegExp; motivo: string }[] = [
    { re: /nom-?\s?024/i, motivo: "el cumplimiento va al ~44%, no está certificado" },
    { re: /prueba gratis|periodo de prueba|\btrial\b/i, motivo: "el registro cobra desde el primer mes" },
    { re: /\bgratis\b/i, motivo: "no hay nada gratis en el registro" },
    { re: /\bgarantiz/i, motivo: "no se puede garantizar un resultado" },
    { re: /\$\s?\d/, motivo: "los precios cambian y el papel no" },
    // Lenguaje de diagnóstico: el visor 3D lleva su DiagnosticDisclaimer
    // justamente porque NO es de grado diagnóstico.
    { re: /diagn[oó]stic/i, motivo: "el visor no es de grado diagnóstico" },
    { re: /detect[ao]\s+(patolog|caries|lesion)/i, motivo: "el sistema no detecta patologías" },
    { re: /interpreta\s+(la\s+)?(tomograf|radiograf)/i, motivo: "el sistema no interpreta estudios" },
    // Especialidades que no existen: el producto es dental.
    { re: /dermatolog|pediatr[ií]a general|veterinar|oftalmolog/i, motivo: "solo dental" },
    { re: /\bcura\b|\bsana\b/i, motivo: "un software no cura a nadie" },
  ];

  const textos = [
    ...SOCIAL_VARIANTS.flatMap((v) => [
      v.label,
      v.eyebrow,
      v.headline,
      ...v.lines,
      v.printIntro,
      v.planNote ?? "",
    ]),
    ...SOCIAL_STYLES.flatMap((s) => [s.label, s.hint]),
    ...PRINT_PIECES.flatMap((p) => [p.label, p.size, p.hint]),
    ...SOCIAL_FORMATS.flatMap((f) => [f.label, f.where, f.hint]),
    PLAN_NOTES.ia,
    PLAN_NOTES.sucursales,
  ];

  for (const t of textos) {
    for (const { re, motivo } of prohibidos) {
      assert.ok(!re.test(t), `claim prohibido (${re} — ${motivo}) en: "${t}"`);
    }
  }
});

test("el tema de tomografías habla de ABRIR y REVISAR, nunca de diagnosticar", () => {
  const cbct = SOCIAL_VARIANTS.find((v) => v.id === "tomografias");
  assert.ok(cbct, "falta el tema de tomografías");
  const cuerpo = [cbct!.headline, ...cbct!.lines, cbct!.printIntro].join(" ");
  assert.match(cuerpo, /abre|abren|revisa|revisas/i);
  assert.doesNotMatch(cuerpo, /diagn[oó]stic|detect|interpret|hallazgo/i);
});

test("el tema de CFDI no promete que el timbre llegue al SAT", () => {
  // El timbrado real depende de FACTURAPI_ENV: en "test" no llega al SAT. Lo
  // que la pieza puede prometer es DÓNDE se timbra, que es lo que controlamos.
  const cfdi = SOCIAL_VARIANTS.find((v) => v.id === "cfdi");
  assert.ok(cfdi);
  const cuerpo = [cfdi!.headline, ...cfdi!.lines, cfdi!.printIntro].join(" ");
  assert.doesNotMatch(cuerpo, /\bSAT\b|validez|válida ante|autorizad/i);
  assert.match(cuerpo, /timbr/i);
});
