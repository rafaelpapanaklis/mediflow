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
  PLAN_FOOTNOTE,
  PLAN_FOOTNOTE_PRINT,
  COMBO_LAYOUT,
  FEATURE_ICONS,
  featureLabel,
  featuresForFormat,
  needsPlanFootnote,
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
    // Un tema trae apoyos O funciones, nunca las dos ni ninguna: son dos
    // formas distintas de pieza y cada superficie elige el bloque por ahí.
    // Un tema con las dos cosas dejaría una mitad sin pintar en silencio.
    const apoyos = Array.isArray(v.lines);
    const funciones = Array.isArray(v.features);
    assert.ok(apoyos !== funciones, `${v.id}: tiene que traer apoyos O funciones, no ${apoyos ? "las dos" : "ninguna"}`);
    if (apoyos) {
      // Dos apoyos: con tres, en 1080 px de ancho ya no respiran.
      assert.ok(v.lines!.length === 2, `${v.id} tiene ${v.lines!.length} apoyos, no 2`);
      for (const l of v.lines!) assert.ok(l.trim().length > 0, `${v.id} con un apoyo vacío`);
    } else {
      assert.ok(v.features!.length >= 8, `${v.id} lista solo ${v.features!.length} funciones`);
      for (const f of v.features!) assert.ok(f.text.trim().length > 0, `${v.id} con una función vacía`);
    }
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
  //
  // Dos salidas válidas: la pastilla de plan (tema de una sola función) o el
  // asterisco de la función + la nota al pie (tema "todo en uno"). Lo que no
  // vale es prometerlo a secas.
  const gatillos = [/\bIA\b/, /inteligencia artificial/i, /sucursal/i, /sede/i, /ilimitad/i, /usuarios/i];
  for (const v of SOCIAL_VARIANTS) {
    const cuerpo = [v.eyebrow, v.headline, ...(v.lines ?? []), v.printIntro].join(" · ");
    if (gatillos.some((re) => re.test(cuerpo))) {
      assert.ok(
        v.planNote,
        `el tema "${v.id}" habla de IA/sucursales/usuarios y no trae nota de plan: "${cuerpo}"`,
      );
    }
    for (const f of v.features ?? []) {
      if (gatillos.some((re) => re.test(f.text))) {
        assert.ok(f.capped, `la función "${f.text}" de "${v.id}" promete de más y NO va marcada con tope`);
        assert.match(featureLabel(f), /\*$/, `la función "${f.text}" no sale con asterisco`);
      }
    }
  }
});

/* ── El tema "todo en uno" ────────────────────────────────────────────────
   El que sirve para promocionar en frío: una sola pieza con el sistema
   entero. Lo que se prueba aquí es que salga primero, que ningún formato
   liste más funciones de las que se leen, y que las dos funciones con tope
   nunca aparezcan sin su asterisco y su nota. */

test("el tema que enseña TODO va primero y es el único recomendado", () => {
  // Es el que un afiliado abre por defecto para presentar DaleControl a quien
  // no lo conoce: si quedara en el puesto siete, el panel arrancaría en un
  // tema de una sola función y volveríamos al problema de origen.
  const primero = SOCIAL_VARIANTS[0];
  assert.ok(primero.features && primero.features.length >= 8, "el primer tema no lista las funciones");
  assert.equal(primero.recommended, true, "el primer tema no está marcado como recomendado");

  const recomendados = SOCIAL_VARIANTS.filter((v) => v.recommended);
  assert.equal(recomendados.length, 1, "hay más de un tema recomendado: el selector marcaría dos");

  // …y los diez temas de una función siguen ahí. Sirven para publicar variado
  // sin repetir la misma pieza.
  const sueltos = SOCIAL_VARIANTS.filter((v) => !v.features);
  assert.equal(sueltos.length, 10, `quedan ${sueltos.length} temas sueltos, no 10`);
  for (const id of ["agenda", "recordatorios", "bot", "web", "tomografias", "cfdi", "odontograma", "portal", "sucursales", "ia"]) {
    assert.ok(findSocialVariant(id), `desapareció el tema suelto "${id}"`);
  }
});

test("cada formato lista las funciones que CABEN, y la fila nunca queda coja", () => {
  const combo = SOCIAL_VARIANTS[0];
  const total = combo.features!.length;
  assert.equal(total, 10, `el tema completo lista ${total} funciones`);

  for (const f of SOCIAL_FORMATS) {
    const { count, cols } = COMBO_LAYOUT[f.id];
    assert.ok(count > 0 && count <= total, `${f.id} pide ${count} de ${total}`);
    // Si `count` no es múltiplo de `cols`, la última fila sale coja y la
    // rejilla se ve rota — es a mano, no con CSS grid: ni satori ni @react-pdf
    // lo tienen.
    assert.equal(count % cols, 0, `${f.id}: ${count} funciones en ${cols} columnas dejan una fila coja`);
    assert.equal(featuresForFormat(combo, f.id).length, count);
    // Lo que se recorta es siempre la COLA: el orden del catálogo es el orden
    // de fuerza, así que la portada se queda con las cuatro primeras.
    assert.deepEqual(featuresForFormat(combo, f.id), combo.features!.slice(0, count));
  }

  // La historia (1080 × 1920) es el único formato con aire para las diez; la
  // portada de Facebook es una banda de 624 px y no aguanta ni la mitad.
  assert.equal(COMBO_LAYOUT.historia.count, total, "la historia debería llevarlas todas");
  assert.ok(
    COMBO_LAYOUT.portada.count < COMBO_LAYOUT.post.count,
    "la portada no puede listar tantas como el post cuadrado",
  );
  // Antes que achicar la tipografía se quitan funciones: en 1080 px de ancho,
  // diez renglones obligan a bajar el cuerpo a ~18 px (6 px en un celular).
  assert.ok(COMBO_LAYOUT.post.count <= 8, "el post cuadrado se pasa de renglones");

  // Un tema de una sola función no lista nada: el bloque de rejilla no se usa.
  const suelto = SOCIAL_VARIANTS.find((v) => !v.features)!;
  for (const f of SOCIAL_FORMATS) assert.deepEqual(featuresForFormat(suelto, f.id), []);
});

test("cada función cabe en la celda más angosta y trae un ícono dibujable", () => {
  for (const v of SOCIAL_VARIANTS) {
    for (const f of v.features ?? []) {
      // La portada reparte ~167 px por columna: pasando de ~32 caracteres, la
      // celda crece un renglón y desalinea la fila entera.
      assert.ok(f.text.length <= 32, `función larga (${f.text.length}): "${f.text}"`);
      const trazos = FEATURE_ICONS[f.icon];
      assert.ok(trazos && trazos.length > 0, `el ícono "${f.icon}" no existe`);
      for (const d of trazos) {
        assert.match(d, /^M/, `trazo sin punto de partida en "${f.icon}": ${d}`);
        // Sin arcos: satori, @react-pdf y el navegador los normalizan cada uno
        // a su manera y el mismo ícono saldría distinto en la imagen y en el
        // volante.
        assert.doesNotMatch(d, /[Aa]\s*[\d.]/, `el ícono "${f.icon}" usa un arco`);
      }
    }
  }
});

test("IA y sucursales NUNCA salen sin asterisco, y donde salen va la nota", () => {
  const combo = SOCIAL_VARIANTS[0];
  const conTope = combo.features!.filter((f) => f.capped).map((f) => f.text);
  assert.deepEqual(conTope, ["Asistente con IA", "Varias sucursales"]);

  for (const f of combo.features!) {
    assert.equal(featureLabel(f), f.capped ? `${f.text} *` : f.text);
  }

  // Formato por formato: si en la pieza salió una función con tope, la pieza
  // pide nota al pie; si no salió ninguna, NO arrastra una nota que no le toca
  // (una nota de plan sobre cuatro funciones sin tope confunde en vez de
  // avisar).
  for (const f of SOCIAL_FORMATS) {
    const lista = featuresForFormat(combo, f.id);
    const hayTope = lista.some((x) => x.capped);
    assert.equal(needsPlanFootnote(lista), hayTope, `${f.id} no decide bien la nota al pie`);
    for (const x of lista) {
      if (x.capped) assert.match(featureLabel(x), /\*$/, `${f.id}: "${x.text}" sin asterisco`);
    }
  }

  // El camino inverso, que es el que importa: una función con tope a la que se
  // le olvide el `capped` deja de pedir nota. Si esta comprobación no fallara,
  // el resto del test no probaría nada.
  const sinMarca = combo.features!.map((f) => ({ ...f, capped: false }));
  assert.equal(needsPlanFootnote(sinMarca), false);
  assert.doesNotMatch(featureLabel(sinMarca[8]), /\*/);
});

test("las notas al pie dicen el plan real, y la de papel sale de maxClinics", () => {
  // La corta, la de las imágenes: no promete un plan concreto (no cabe), pero
  // avisa de que hay planes de por medio.
  assert.match(PLAN_FOOTNOTE, /^\*/, "la nota corta no arranca con el asterisco que la ancla");
  assert.match(PLAN_FOOTNOTE, /plan/i);
  assert.doesNotMatch(PLAN_FOOTNOTE, /ilimitad/i);

  // La larga, la del papel: un volante se lee de cerca y se guarda, así que
  // dice el plan exacto de cada función con tope. Y el número de sedes sale de
  // FALLBACK_PLAN_CONFIG, no de la mano.
  assert.equal(FALLBACK_PLAN_CONFIG.CLINIC.maxClinics, 3);
  assert.match(PLAN_FOOTNOTE_PRINT, /^\*/);
  assert.match(PLAN_FOOTNOTE_PRINT, /Profesional/);
  assert.match(PLAN_FOOTNOTE_PRINT, /Clínica/);
  assert.match(PLAN_FOOTNOTE_PRINT, /hasta 3 sedes/);
  assert.doesNotMatch(PLAN_FOOTNOTE_PRINT, /ilimitad/i);
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
      ...(v.lines ?? []),
      // Las funciones del tema "todo en uno" pasan por la MISMA reja: son
      // texto que se publica igual que un apoyo.
      ...(v.features ?? []).map((f) => f.text),
      v.printIntro,
      v.planNote ?? "",
    ]),
    ...SOCIAL_STYLES.flatMap((s) => [s.label, s.hint]),
    ...PRINT_PIECES.flatMap((p) => [p.label, p.size, p.hint]),
    ...SOCIAL_FORMATS.flatMap((f) => [f.label, f.where, f.hint]),
    PLAN_NOTES.ia,
    PLAN_NOTES.sucursales,
    PLAN_FOOTNOTE,
    PLAN_FOOTNOTE_PRINT,
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
