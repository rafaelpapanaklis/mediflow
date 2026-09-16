/**
 * Presupuesto nuevo (WS1-T8) — los candados de la pantalla.
 *
 * Run: npm run test:presupuesto-nuevo
 *
 * Lo que fija, y por qué:
 *
 *  1. CON LA BANDERA APAGADA NO CAMBIA UN PÍXEL. El rediseño solo se monta si
 *     `quotes-tab.tsx` recibe `rediseno`, y ese prop sale del interruptor
 *     `menu-dos-niveles` de la clínica. Ningún archivo del rediseño se importa
 *     desde ningún otro sitio, y el editor viejo sigue entero en su archivo.
 *
 *  2. NADIE SE INVENTA UN TOTAL. Los componentes del rediseño no suman dinero
 *     por su cuenta: el total sale de `totalACobrar` (= la aritmética de la
 *     factura) y las mensualidades de `calcularCalendario`. Una suma a mano en
 *     un componente es exactamente cómo nace un desfase de centavos.
 *
 *  3. NO SE PROMETEN «MESES SIN INTERESES» EN NINGUNA SUPERFICIE — ni en la
 *     pantalla, ni en el PDF, ni en la página del paciente. El término tiene
 *     significado bancario; el panel no puede diferir un cargo.
 *
 *  4. El SQL es aditivo, plano y no toca ninguna tabla que ya exista.
 *
 *  5. Toda key i18n que nombran los módulos existe en español y en inglés, y
 *     las etiquetas de los seis métodos de pago dicen lo mismo en las tres
 *     listas que las tienen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ETIQUETA_METODO_ES, METODOS_PAGO } from "@/lib/quotes/condiciones-pago";

const RAIZ = join(__dirname, "..", "..", "..", "..", "..");
const CARPETA = join(RAIZ, "src/components/dashboard/presupuesto-nuevo");

function leer(rel: string): string {
  return readFileSync(join(RAIZ, rel), "utf8");
}

const FUENTES = readdirSync(CARPETA).filter((f) => /\.tsx?$/.test(f));

// ═══ 1 · La bandera ══════════════════════════════════════════════════

test("el rediseño solo se monta desde quotes-tab, y solo con la bandera", () => {
  const tab = leer("src/components/quotes/quotes-tab.tsx");
  assert.match(tab, /import \{ PresupuestoEditor \}/);
  assert.match(tab, /import \{ PresupuestoLista \}/);
  // El prop existe y nace APAGADO: cualquier pantalla que monte QuotesTab sin
  // pasarlo sigue viendo lo de siempre.
  assert.match(tab, /rediseno = false/);
  // Y las dos ramas están: con bandera el nuevo, sin ella el de siempre.
  assert.match(tab, /return rediseno \? \(\s*<PresupuestoEditor/);
  assert.match(tab, /if \(rediseno\) \{\s*return \(\s*<PresupuestoLista/);
});

test("el editor y la lista de SIEMPRE siguen enteros en su archivo", () => {
  // Si alguien "limpia" el editor viejo, las clínicas sin la bandera se quedan
  // sin pantalla. Esto es lo que lo impide.
  const tab = leer("src/components/quotes/quotes-tab.tsx");
  assert.match(tab, /function QuoteEditor\(/, "se borró el editor de siempre");
  assert.match(tab, /function QuoteCard\(/, "se borró la tarjeta de siempre");
  assert.match(tab, /computeTotals\(/, "el editor de siempre ya no calcula sus totales");
});

test("el prop sale del interruptor de la clínica, no de una constante", () => {
  const ficha = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  // El <QuotesTab …> de la ficha recibe el mismo `rediseno` que el resto del
  // rediseño de Pacientes, que a su vez viene de menuDosNivelesEncendido().
  const bloque = /<QuotesTab[\s\S]*?\n {12}\/>/.exec(ficha)?.[0] ?? "";
  assert.ok(bloque, "no se encontró el <QuotesTab> de la ficha");
  assert.match(bloque, /rediseno=\{rediseno\}/);
  const pagina = leer("src/app/dashboard/patients/[id]/page.tsx");
  assert.match(pagina, /menuDosNivelesEncendido/);
});

test("nadie más importa el rediseño (ni una pantalla que no mire la bandera)", () => {
  const importadores: string[] = [];
  const recorrer = (dir: string) => {
    readdirSync(join(RAIZ, dir), { withFileTypes: true }).forEach((e) => {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".next") return;
        recorrer(rel);
        return;
      }
      if (!/\.tsx?$/.test(e.name)) return;
      if (rel.startsWith("src/components/dashboard/presupuesto-nuevo")) return;
      if (rel.includes("__tests__")) return;
      if (/dashboard\/presupuesto-nuevo\//.test(leer(rel))) importadores.push(rel);
    });
  };
  recorrer("src");
  assert.deepEqual(importadores, ["src/components/quotes/quotes-tab.tsx"]);
});

// ═══ 2 · Nadie se inventa un total ═══════════════════════════════════

test("el editor deriva el total de la aritmética de la FACTURA, no de una suma propia", () => {
  const editor = leer("src/components/dashboard/presupuesto-nuevo/editor.tsx");
  assert.match(editor, /totalACobrar\(/, "el editor no usa la aritmética de la factura");
  assert.match(editor, /computeTotals\(/, "el editor no normaliza con la del servidor");
  assert.match(editor, /calcularCalendario\(/, "el editor no reparte con el módulo común");
  // El importe de línea y el descuento salen de helpers del módulo, nunca de
  // un `reduce` suelto sobre los totales.
  assert.doesNotMatch(
    editor,
    /reduce\([^)]*\.total\b/,
    "hay una suma de totales a mano en el editor",
  );
});

test("el PDF y la página del paciente reciben el plan RESUELTO, no lo calculan", () => {
  const pdf = leer("src/lib/pdf/quote-document.tsx");
  // El documento pinta lo que le dan: ni divide, ni reparte, ni suma cuotas.
  assert.doesNotMatch(pdf, /calcularCalendario|repartirCentavos/);
  assert.match(pdf, /props\.plan/);

  const constructor = leer("src/lib/quotes/quote-pdf.ts");
  assert.match(constructor, /planParaDocumento\(/);

  const publica = leer("src/app/presupuesto/[token]/page.tsx");
  assert.match(publica, /planParaDocumento\(/);
  assert.doesNotMatch(publica, /repartirCentavos/);
});

test("las condiciones se normalizan SIEMPRE contra el total del servidor", () => {
  // Si se normalizara contra el total que manda el cliente, un enganche de
  // $99,999 sobre un presupuesto de $1,000 pasaría el acotado y el calendario
  // dejaría de sumar el total.
  ["src/app/api/quotes/route.ts", "src/app/api/quotes/[id]/route.ts"].forEach((f) => {
    const ruta = leer(f);
    assert.match(
      ruta,
      /normalizarCondiciones\(body\.condicionesPago, Number\(quote\.total\)\)/,
      `${f} no normaliza contra el total del servidor`,
    );
  });
});

// ═══ 3 · «Meses sin intereses» ═══════════════════════════════════════

test("ninguna superficie promete «meses sin intereses»", () => {
  const superficies = [
    ...FUENTES.map((f) => `src/components/dashboard/presupuesto-nuevo/${f}`),
    "src/lib/pdf/quote-document.tsx",
    "src/lib/quotes/quote-pdf.ts",
    "src/app/presupuesto/[token]/page.tsx",
  ];
  superficies.forEach((f) => {
    const codigo = leer(f)
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    assert.doesNotMatch(codigo, /\bMSI\b/, `${f} nombra MSI en código vivo`);
  });

  // En los textos que LEE el usuario, «meses sin intereses» solo aparece para
  // explicar que la clínica no lo puede ofrecer desde aquí.
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json"));
  const textos = JSON.stringify(es.presupuestoNuevo);
  const menciones = textos.match(/sin intereses/gi) ?? [];
  assert.ok(menciones.length > 0, "el aviso que lo explica desapareció");
  assert.match(es.presupuestoNuevo.msiTexto, /no puede diferir un cargo/);
  assert.match(es.presupuestoNuevo.msiTexto, /banco que emitió la tarjeta/);
});

test("la casilla del MSI de terminal no se ofrece sobre un plan a plazos", () => {
  const editor = leer("src/components/dashboard/presupuesto-nuevo/editor.tsx");
  // Solo con UN pago y tarjeta de CRÉDITO: es el único caso en el que existe
  // un banco emisor que pueda diferir el cargo.
  assert.match(editor, /cond\.modo === "unico" && cond\.metodo === "credit"/);
});

// ═══ 4 · El SQL ══════════════════════════════════════════════════════

test("el SQL es plano, aditivo y no toca ninguna tabla que ya exista", () => {
  const conComentarios = leer("sql/presupuesto-condiciones-pago.sql");
  // Solo las SENTENCIAS: el encabezado explica por qué NO hay bloques DO, y esa
  // explicación no puede hacer fallar la comprobación que la respalda.
  const sql = conComentarios
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "quote_payment_terms"/);
  // Plano: sin bloques DO, con o sin delimitador con nombre.
  assert.doesNotMatch(sql, /\bDO \$/i, "el SQL usa un bloque DO $$…$$");
  // Idempotente: la política se recrea, no se duplica.
  assert.match(sql, /DROP POLICY IF EXISTS "quote_payment_terms_deny_anon"/);
  // No altera tablas existentes: el único ALTER permitido es el RLS de la suya.
  const alters = sql.match(/ALTER TABLE "([a-z_]+)"/g) ?? [];
  alters.forEach((a) => assert.match(a, /"quote_payment_terms"/, `ALTER sobre otra tabla: ${a}`));
  // Y nada destructivo sobre datos.
  assert.doesNotMatch(sql, /\bDROP TABLE\b(?![^\n]*--)/, "hay un DROP TABLE fuera de comentario");
  assert.doesNotMatch(sql, /\bUPDATE "quotes"|\bDELETE FROM "quotes"/);
});

test("sin el SQL aplicado no se cae nada: todo pasa por la guarda de existencia", () => {
  const db = leer("src/lib/quotes/condiciones-pago-db.ts");
  assert.match(db, /to_regclass\('public\.quote_payment_terms'\)/);
  // Las cuatro puertas (leer, leer en lote, guardar, copiar) preguntan antes de
  // tocar la tabla, y lo hacen con la versión que distingue «no está» de «no se
  // pudo preguntar» (ver la prueba de la sonda, más abajo).
  const guardas = db.match(/await seguroQueNoEsta\(db\)/g) ?? [];
  assert.ok(guardas.length >= 4, `solo ${guardas.length} guardas de existencia`);
  // Y ningún error sube: las condiciones de pago no pueden tumbar un alta.
  assert.match(db, /console\.warn\("\[presupuesto:condiciones\]/);
  // El modelo Prisma NO se tocó: la tabla se lee con SQL crudo justamente para
  // que un deploy sin el SQL no rompa la pantalla de Presupuestos.
  assert.doesNotMatch(leer("prisma/schema.prisma"), /quote_payment_terms/);
});

test("el aislamiento por clínica se comprueba contra quotes antes de escribir", () => {
  const db = leer("src/lib/quotes/condiciones-pago-db.ts");
  // La tabla no tiene clinicId propio: el inquilino se resuelve contra quotes.
  assert.match(db, /FROM "quotes" WHERE "id" = \$\{quoteId\} AND "clinicId" = \$\{clinicId\}/);
  // Y sin clinicId no se escribe nada (un undefined en Prisma no filtra).
  assert.match(db, /if \(!quoteId \|\| !clinicId\) return nada;/);
});

// ═══ 5 · i18n y los seis métodos ═════════════════════════════════════

test("toda key i18n de la pantalla existe en español y en inglés", () => {
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json"));
  const en = JSON.parse(leer("src/i18n/dictionaries/en.json"));
  const buscar = (dict: unknown, key: string): unknown =>
    key.split(".").reduce<unknown>(
      (acc, parte) => (acc == null ? undefined : (acc as Record<string, unknown>)[parte]),
      dict,
    );

  assert.ok(FUENTES.length > 0, "no se encontró ningún archivo de la pantalla");
  const keys = new Set<string>();
  FUENTES.forEach((f) => {
    const texto = readFileSync(join(CARPETA, f), "utf8");
    const re = /["'`](presupuestoNuevo\.[A-Za-z0-9_.]+)["'`]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(texto)) !== null) keys.add(m[1]);
  });
  assert.ok(keys.size > 20, `solo se hallaron ${keys.size} keys`);

  keys.forEach((k) => {
    assert.equal(typeof buscar(es, k), "string", `falta en es.json: ${k}`);
    assert.equal(typeof buscar(en, k), "string", `falta en en.json: ${k}`);
  });

  // Las dos familias que se arman con plantilla (`presupuestoNuevo.metodos.X`
  // y `.frecuencias.X`) no las ve el regex de arriba: se comprueban a mano.
  METODOS_PAGO.forEach((m) => {
    assert.equal(typeof buscar(es, `presupuestoNuevo.metodos.${m}`), "string", `falta metodo es: ${m}`);
    assert.equal(typeof buscar(en, `presupuestoNuevo.metodos.${m}`), "string", `falta metodo en: ${m}`);
  });
  ["WEEKLY", "BIWEEKLY", "MONTHLY"].forEach((f) => {
    assert.equal(typeof buscar(es, `presupuestoNuevo.frecuencias.${f}`), "string", `falta frecuencia es: ${f}`);
    assert.equal(typeof buscar(en, `presupuestoNuevo.frecuencias.${f}`), "string", `falta frecuencia en: ${f}`);
  });
});

test("los seis métodos dicen lo mismo en las tres listas que los tienen", () => {
  // La del presupuesto (client-safe), la de Sabina y la del selector de cobros.
  // La de Sabina se lee del ARCHIVO, no se importa: `sabina/dinero/comun.ts`
  // arrastra auth-context y `react.cache`, que fuera de Next no existe.
  const comun = leer("src/lib/sabina/dinero/comun.ts");
  const listaSabina = Array.from(
    (/export const METODOS_COBRO = \[([^\]]+)\]/.exec(comun)?.[1] ?? "").matchAll(/"([a-z]+)"/g),
  ).map((m) => m[1]);
  assert.deepEqual([...METODOS_PAGO], listaSabina);

  const bloqueSabina = /export const ETIQUETA_METODO[\s\S]*?\n\};/.exec(comun)?.[0] ?? "";
  METODOS_PAGO.forEach((m) => {
    const etiqueta = new RegExp(`${m}:\\s*"([^"]+)"`).exec(bloqueSabina)?.[1];
    assert.equal(
      ETIQUETA_METODO_ES[m],
      etiqueta,
      `«${m}» se llama distinto en el presupuesto y en Sabina`,
    );
  });
  // Y las del selector, vía su diccionario.
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json"));
  METODOS_PAGO.forEach((m) => {
    assert.equal(
      es.presupuestoNuevo.metodos[m],
      ETIQUETA_METODO_ES[m],
      `«${m}» se llama distinto en la pantalla y en el PDF`,
    );
  });
});

// ═══ 6 · El patrón visual de ws1-t4 ══════════════════════════════════

test("la pantalla usa los tokens del rediseño, no una paleta propia", () => {
  const css = leer("src/components/dashboard/presupuesto-nuevo/presupuesto.module.css");
  // Ni un hex suelto: todo el color sale de las variables --pr-* que hereda de
  // <RaizRediseno>. Es la regla que mantiene una sola paleta en el panel.
  const hexes = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  assert.deepEqual(hexes, [], `hay color a mano en el CSS: ${hexes.join(", ")}`);
  assert.match(css, /var\(--pr-activo\)/);
  // Las cifras SIEMPRE con tabular-nums (regla del patrón).
  assert.ok((css.match(/tabular-nums/g) ?? []).length >= 6);
});

test("los componentes son de cliente y declaran «use client» en la primera línea", () => {
  FUENTES.forEach((f) => {
    const texto = readFileSync(join(CARPETA, f), "utf8");
    assert.equal(texto.split("\n")[0], '"use client";', `${f} no declara "use client"`);
  });
});

// ═══ 7 · Los cabos que encontró la revisión ══════════════════════════

test("un PATCH que no menciona las formas de pago NO las borra", () => {
  // El editor de SIEMPRE (bandera apagada) nunca manda `condicionesPago`. Si el
  // PATCH guardara igual, `normalizarCondiciones(undefined)` daría condiciones
  // vacías y la escritura BORRARÍA la fila: una corrección de ortografía en el
  // título le arrancaba el plan de 12 mensualidades a un presupuesto ya firmado.
  const ruta = leer("src/app/api/quotes/[id]/route.ts");
  assert.match(ruta, /hasOwnProperty\.call\(body, "condicionesPago"\)/);
  assert.match(ruta, /tocaCondiciones\s*\n?\s*\?\s*await guardarCondiciones/);
  // Y el editor de siempre, en efecto, no lo manda: es lo que hace real al caso.
  const tab = leer("src/components/quotes/quotes-tab.tsx");
  const viejo = /async function save\(\)[\s\S]*?\n  \}/.exec(tab)?.[0] ?? "";
  assert.ok(viejo, "no se encontró el save() del editor de siempre");
  assert.doesNotMatch(viejo, /condicionesPago/);
});

test("el total de la barra se calcula sobre las líneas que SÍ se van a guardar", () => {
  // El servidor descarta las líneas sin nombre (sanitizeItems). Si la pantalla
  // las sumaba, la cifra grande y el calendario que ve el paciente incluían una
  // línea a medio escribir que después no se guardaba.
  const editor = leer("src/components/dashboard/presupuesto-nuevo/editor.tsx");
  assert.match(editor, /const guardables = useMemo\(/);
  assert.match(editor, /guardables\.map\(\(l\) => \(\{/, "el dinero no sale de `guardables`");
  assert.match(editor, /const limpias = guardables;/, "guardar() filtra por su cuenta");
  // Y el servidor sigue descartándolas, que es de donde viene la regla.
  assert.match(leer("src/lib/quotes/service.ts"), /typeof i\.name === "string" && i\.name\.trim\(\)\.length > 0/);
});

test("pasar el descuento de $ a % CONVIERTE el importe, no lo conserva ni lo acota", () => {
  // «$150 de descuento» + un clic en «%» se leía como 150 %, que computeTotals
  // acota al 100 %: total $0.00 y la factura borrador ligada con él. Acotar a
  // 100 daba EXACTAMENTE el mismo $0.00 con cualquier descuento de $100 o más.
  // Lo único que no mueve el dinero es convertir contra la base.
  const editor = leer("src/components/dashboard/presupuesto-nuevo/editor.tsx");
  assert.match(editor, /const cambiarUnidad = \(u: UnidadDescuento\) => \{/);
  assert.match(editor, /if \(u === unidad\) return;/, "no se protege el clic repetido");
  assert.match(editor, /onValor\(Math\.min\(100, Math\.round\(\(valor \/ base\)/, "\$→% no convierte");
  assert.match(editor, /onValor\(Math\.round\(\(\(base \* Math\.min\(100, valor\)\) \/ 100\)/, "%→\$ no convierte");
  assert.match(editor, /if \(base <= 0\) onValor\(0\);/, "sin base no se acota a 0");
  // Los dos botones pasan por la conversión, no por el `onUnidad` pelado.
  assert.match(editor, /onClick=\{\(\) => cambiarUnidad\("monto"\)\}/);
  assert.match(editor, /onClick=\{\(\) => cambiarUnidad\("pct"\)\}/);
  // Y cada uno convierte contra SU base: el global contra el subtotal, el de
  // línea contra el importe bruto de su línea. Una base equivocada movería el
  // dinero al cambiar de unidad, que es justo lo que esto viene a impedir.
  assert.match(editor, /base=\{dinero_\.subtotal\}/);
  assert.match(editor, /base=\{importeBruto\}/);
});

test("un plan que no se pudo LEER no se puede borrar al guardar", () => {
  // La cadena que encontró la refutación: un timeout en la lectura devolvía
  // `null`, el editor arrancaba «sin plan», y como el guardado mandaba siempre
  // el campo, corregir una coma borraba las 12 mensualidades ya firmadas.
  const db = leer("src/lib/quotes/condiciones-pago-db.ts");
  // Las dos lecturas distinguen «no hay» de «no pude leer».
  assert.match(db, /export interface ResultadoLeer/);
  assert.match(db, /return \{ condiciones: null, fallo: true \};/);
  assert.match(db, /return \{ porQuote: salida, fallo: true \};/);

  // La lista —de donde el editor saca el presupuesto que abre— marca TODOS los
  // presupuestos de esa respuesta como ilegibles cuando el lote falló.
  assert.match(
    leer("src/app/api/quotes/route.ts"),
    /serializeQuote\(q, porQuote\.get\(q\.id\) \?\? null, fallo\)/,
  );
  assert.match(leer("src/lib/quotes/types.ts"), /condicionesPagoIlegible\?: boolean;/);

  // Y el editor, con esa marca, NO manda el campo (= «no lo cambies») y lo dice.
  const editor = leer("src/components/dashboard/presupuesto-nuevo/editor.tsx");
  assert.match(editor, /const condicionesIlegibles = editando\?\.condicionesPagoIlegible === true;/);
  assert.match(editor, /\.\.\.\(condicionesIlegibles \? \{\} : \{ condicionesPago: cond \}\)/);
  assert.match(editor, /\{condicionesIlegibles \? \(/, "la sección no se bloquea");
  assert.match(editor, /ilegibleTitulo/);
});

test("si el plan de pagos no se guarda, el editor lo dice en vez de cerrarse", () => {
  const db = leer("src/lib/quotes/condiciones-pago-db.ts");
  // «La tabla no está» NO es un fallo; «había algo que escribir y falló», sí.
  assert.match(db, /return \{ condiciones: null, fallo: hayCondiciones\(condiciones\) \};/);
  assert.match(db, /if \(await seguroQueNoEsta\(db\)\) return nada;/);

  ["src/app/api/quotes/route.ts", "src/app/api/quotes/[id]/route.ts"].forEach((f) => {
    assert.match(leer(f), /guardado\.fallo \? \{ condicionesPagoFallo: true \}/, `${f} se lo calla`);
  });

  const editor = leer("src/components/dashboard/presupuesto-nuevo/editor.tsx");
  assert.match(editor, /if \(salida\.condicionesPagoFallo\)/);
  assert.match(editor, /errorFormaDePago/);
});

test("un fallo de la sonda no ciega el módulo durante un minuto", () => {
  // Un timeout del pooler no es «la tabla no existe». Cachearlo como tal hacía
  // que durante 60 s TODOS los planes a plazos se perdieran en silencio.
  const db = leer("src/lib/quotes/condiciones-pago-db.ts");
  assert.match(db, /Promise<boolean \| null>/, "la sonda no distingue el tercer estado");
  assert.match(db, /return null;\s*\n\s*\}\s*\n\}/, "el catch de la sonda cachea el fallo");
  assert.match(db, /=== false;/, "«no se pudo preguntar» se trata como «no está»");
  // Las tres puertas usan la versión que distingue.
  assert.ok((db.match(/seguroQueNoEsta\(db\)/g) ?? []).length >= 4);
});

test("copiar las condiciones comprueba la clínica del ORIGEN, no solo del destino", () => {
  const db = leer("src/lib/quotes/condiciones-pago-db.ts");
  const copiar = /export async function copiarCondiciones[\s\S]*?\n\}/.exec(db)?.[0] ?? "";
  assert.ok(copiar, "no se encontró copiarCondiciones");
  assert.match(copiar, /WHERE "id" = \$\{args\.origenId\} AND "clinicId" = \$\{args\.clinicId\}/);
});
