/**
 * CANDADOS DEL REDISEÑO DE LAS TRES PANTALLAS PEQUEÑAS (ws1-t6):
 * Reseñas, Pantallas TV y Bitácora.
 *
 * Run: npx tsx --test src/components/dashboard/pequenas-rediseno/__tests__/pequenas-rediseno.test.ts
 *
 * Se prueba leyendo el código fuente, como `hoy-rediseno.test.ts`: lo que se
 * vigila es CABLEADO (que la hoja no invente tokens y lea los del menú, que
 * no haya letra de máquina, que las pantallas nuevas manden a los mismos
 * sitios que las de siempre, que el camino viejo siga vivo y que la Bitácora
 * no toque el orden del registro), y eso se ve en el archivo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..", "..");           // src/
const CARPETA = join(SRC, "components", "dashboard", "pequenas-rediseno");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const archivosNuevos = readdirSync(CARPETA)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => ({ nombre: f, texto: readFileSync(join(CARPETA, f), "utf8") }));

const css = () => archivosNuevos.find((a) => a.nombre === "pequenas.module.css")!.texto;
const nuevo = (nombre: string) => archivosNuevos.find((a) => a.nombre === nombre)!.texto;

// ═══════════════════════════════════════════════════════════════════════════
// Instrument Sans en el 100 %: ni una letra de máquina en la carpeta nueva
// ═══════════════════════════════════════════════════════════════════════════
// La palabra prohibida se arma en trozos para que un grep sobre la carpeta
// (el gate de cierre: «cero letra de máquina») no se tope con este archivo.
const LETRA_DE_MAQUINA = new RegExp(["font-", "mono", "|", "ui-", "mono", "space", "|", "mono", "space"].join(""));

test("sin letra de máquina en la carpeta del rediseño", () => {
  assert.ok(archivosNuevos.length >= 6, "faltan archivos en la carpeta");
  for (const a of archivosNuevos) {
    assert.ok(
      !LETRA_DE_MAQUINA.test(a.texto),
      `${a.nombre} usa letra de máquina; las cifras van con tabular-nums sobre Instrument Sans`,
    );
    // Tampoco las clases globales que la traen por la puerta de atrás.
    assert.ok(!/["'` ]mono(-tecnico)?["'` ]/.test(a.texto), `${a.nombre} usa la clase global de letra de máquina`);
  }
  assert.match(css(), /font-variant-numeric:\s*tabular-nums/, "las cifras se alinean con tabular-nums");
});

// ═══════════════════════════════════════════════════════════════════════════
// Sin tokens nuevos: la hoja solo LEE los del menú (--m2-*) y los de globals
// ═══════════════════════════════════════════════════════════════════════════
test("pequenas.module.css no declara ninguna variable CSS propia", () => {
  const declaraciones = css().match(/^\s*--[a-z0-9-]+\s*:/gim) ?? [];
  assert.deepEqual(declaraciones, [], `declara tokens propios: ${declaraciones.join(", ")}`);
  assert.match(css(), /var\(--m2-/, "lee los tokens del menú");
  const raiz = nuevo("raiz.tsx");
  assert.match(raiz, /CLASES_MENU/, "la raíz monta CLASES_MENU (menu-dos-niveles/clases.ts)");
  assert.match(raiz, /from "@\/components\/dashboard\/menu-dos-niveles\/clases"/, "CLASES_MENU sale de clases.ts, no de una copia");
});

test("todo hex de la hoja es un respaldo dentro de un var(), nunca un color a mano", () => {
  // El gate del gerente: `grep '#[0-9a-f]{6}' | grep -v 'var(--'` tiene que salir vacío.
  const lineasConHex = css().split("\n").filter((l) => /#[0-9a-f]{6}/i.test(l));
  const sueltas = lineasConHex.filter((l) => !/var\(--/.test(l));
  assert.deepEqual(sueltas, [], `colores escritos a mano: ${sueltas.join(" | ")}`);
  for (const a of archivosNuevos.filter((x) => /\.tsx?$/.test(x.nombre))) {
    // En los .tsx el único hex permitido es el texto de ejemplo del campo
    // «color de marca» de Pantallas TV (`placeholder=`), que ya está así en la
    // pantalla de siempre: no es un color que se pinte, es una pista al usuario.
    const sinPlaceholder = a.texto.replace(/placeholder="#[0-9a-f]{6}"/gi, "");
    const hex = sinPlaceholder.match(/#[0-9a-f]{6}/gi) ?? ([] as string[]);
    assert.deepEqual(hex, [], `${a.nombre} trae colores a mano: ${hex.join(", ")}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Mismos destinos que las pantallas de siempre
// ═══════════════════════════════════════════════════════════════════════════
test("Reseñas nueva responde contra el mismo endpoint que la de siempre", () => {
  const viejo = leer("app/dashboard/resenas/ResenasClient.tsx");
  const ahora = nuevo("resenas.tsx");
  for (const d of ["/api/reviews/${review.id}/respond", "REVIEW_MAX_RESPONSE_CHARS", "formatReviewDate("]) {
    assert.ok(viejo.includes(d), `la Reseñas de siempre ya no usa ${d}: actualiza este candado`);
    assert.ok(ahora.includes(d), `el rediseño de Reseñas perdió ${d}`);
  }
  // La lista y la paginación NO se piden dos veces: llegan del cliente de siempre.
  assert.ok(!/fetch\(\s*`\/api\/reviews\?/.test(ahora), "el rediseño no vuelve a pedir /api/reviews: eso lo hace ResenasClient");
});

test("Pantallas TV nueva usa los mismos endpoints y la misma URL pública", () => {
  const viejo = leer("app/dashboard/tv-modes/tv-modes-client.tsx");
  const ahora = nuevo("tv-modes.tsx");
  for (const d of ["/api/tv-displays/${display.id}", '"/api/tv-displays"', "/tv/${d.publicSlug}", "durationSec: 8", "min={3}", "max={30}"]) {
    assert.ok(viejo.includes(d), `la Pantallas TV de siempre ya no usa ${d}: actualiza este candado`);
    assert.ok(ahora.includes(d), `el rediseño de Pantallas TV perdió ${d}`);
  }
  // La lista NO se pide dos veces ni se borra desde aquí: llega del cliente de siempre.
  assert.ok(!/fetch\(\s*"\/api\/tv-displays"\s*\)/.test(ahora), "el rediseño no vuelve a pedir la lista");
  assert.ok(!/method:\s*"DELETE"/.test(ahora), "borrar sigue siendo del cliente de siempre");
  // Los mismos campos del formulario, ni uno inventado.
  for (const campo of ["brandColor", "brandLogo", "promotions", "showWaitTimes", '"OPERATIONAL"', '"MARKETING"', '"HYBRID"']) {
    assert.ok(ahora.includes(campo), `el formulario perdió ${campo}`);
  }
  // `testimonials` existe en el tipo y en la config vacía (igual que hoy), pero
  // el panel no tiene editor: nadie lo LEE ni lo pinta.
  assert.ok(!/\.testimonials|testimonials\]/.test(ahora), "no se inventa un editor de testimonios que el panel no tiene");
});

// ═══════════════════════════════════════════════════════════════════════════
// Bitácora: registro de auditoría, mismo contenido y mismo orden
// ═══════════════════════════════════════════════════════════════════════════
test("Bitácora nueva pinta las filas tal cual llegan, sin ordenar ni filtrar", () => {
  const ahora = nuevo("auditoria.tsx");
  assert.ok(ahora.includes("rows.map("), "las filas se pintan una por una");
  for (const prohibido of ["rows.sort(", "rows.filter(", "rows.slice(", "rows.reverse(", ".sort((", "toSorted("]) {
    assert.ok(!ahora.includes(prohibido), `la Bitácora nueva toca el orden del registro: ${prohibido}`);
  }
  // No consulta nada por su cuenta: los datos llegan de AuditoriaClient (SWR).
  assert.ok(!/useSWR|fetch\(/.test(ahora), "el rediseño de Bitácora no pide datos: eso lo hace AuditoriaClient");
});

test("Bitácora nueva tiene las mismas seis columnas, en el mismo orden", () => {
  const viejo = leer("app/dashboard/auditoria/auditoria-client.tsx");
  const ahora = nuevo("auditoria.tsx");
  const columnas = (src: string) => {
    const thead = src.slice(src.indexOf("<thead>"), src.indexOf("</thead>"));
    return [...thead.matchAll(/tr\("(auditoria\.col[A-Za-z]+)"/g)].map((m) => m[1]);
  };
  assert.deepEqual(columnas(viejo), ["auditoria.colDate", "auditoria.colUser", "auditoria.colAction", "auditoria.colEntity", "auditoria.colIp", "auditoria.colDetail"], "la Bitácora de siempre cambió de columnas: actualiza este candado");
  assert.deepEqual(columnas(ahora), columnas(viejo), "las columnas del rediseño no son las de siempre");
  // El detalle también enseña lo mismo: campo, antes, después.
  for (const k of ["auditoria.field", "auditoria.before", "auditoria.after", "auditoria.browser", "auditoria.noChanges"]) {
    assert.ok(ahora.includes(`"${k}"`), `el detalle perdió ${k}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Toda clave i18n que usa el rediseño existe en el diccionario en español
// ═══════════════════════════════════════════════════════════════════════════
test("todas las claves t(\"…\") del rediseño existen en es.json", () => {
  const dict = JSON.parse(leer("i18n/dictionaries/es.json")) as Record<string, unknown>;
  const existe = (clave: string): boolean => {
    let nodo: unknown = dict;
    for (const parte of clave.split(".")) {
      if (!nodo || typeof nodo !== "object" || !(parte in (nodo as object))) return false;
      nodo = (nodo as Record<string, unknown>)[parte];
    }
    return typeof nodo === "string";
  };
  const claves = new Set<string>();
  const tv = nuevo("tv-modes.tsx");
  for (const m of tv.matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"/g)) claves.add(m[1]);
  for (const m of tv.matchAll(/:\s*"(pages\.tvModes\.[a-zA-Z0-9_.]+)"/g)) claves.add(m[1]);
  assert.ok(claves.size > 25, `se esperaban decenas de claves, hay ${claves.size}`);
  const faltan = [...claves].filter((k) => !existe(k));
  assert.deepEqual(faltan, [], `claves sin traducción: ${faltan.join(", ")}`);
  // Bitácora usa tr(clave, respaldo): la clave no existe en es.json hoy y el
  // respaldo es lo que se ve. El rediseño usa los MISMOS respaldos que la de
  // siempre, para que la pantalla diga lo mismo.
  const respaldos = (src: string) => new Set([...src.matchAll(/tr\("auditoria\.[A-Za-z0-9]+",\s*"([^"]+)"\)/g)].map((m) => m[1]));
  const viejos = respaldos(leer("app/dashboard/auditoria/auditoria-client.tsx"));
  const nuevos = respaldos(nuevo("auditoria.tsx"));
  const sinRespaldoViejo = [...nuevos].filter((r) => !viejos.has(r));
  assert.deepEqual(sinRespaldoViejo, [], `textos que la Bitácora de siempre no dice: ${sinRespaldoViejo.join(" | ")}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// El camino viejo sigue vivo y el interruptor es el de todo el rediseño
// ═══════════════════════════════════════════════════════════════════════════
test("cada page.tsx elige con menuDosNivelesEncendido y baja `rediseno` al cliente", () => {
  for (const rel of ["app/dashboard/resenas/page.tsx", "app/dashboard/tv-modes/page.tsx", "app/dashboard/auditoria/page.tsx"]) {
    const page = leer(rel);
    assert.match(page, /from "@\/lib\/menu-dos-niveles\/interruptor"/, `${rel}: usa el interruptor compartido, no uno propio`);
    assert.equal((page.match(/menuDosNivelesEncendido\(/g) ?? []).length, 1, `${rel}: una sola lectura del interruptor`);
    assert.match(page, /rediseno=\{rediseno\}/, `${rel}: no baja la bandera al cliente`);
  }
});

test("con la bandera apagada cada cliente pinta su marcado de siempre", () => {
  const casos: Array<[string, string, string[]]> = [
    ["app/dashboard/resenas/ResenasClient.tsx", "ResenasRediseno", ['className="kpi kpi--hero"', 'className="card"', "function ReviewRow(", "function EmptyState(", "function PagerBtn("]],
    ["app/dashboard/tv-modes/tv-modes-client.tsx", "TvModesRediseno", ["function TvDisplayModal(", "function IconBtn(", "function Box(", "function Field(", 'padding: "clamp(14px, 1.6vw, 28px)", maxWidth: 1200']],
    ["app/dashboard/auditoria/auditoria-client.tsx", "AuditoriaRediseno", ['className="table-new"', "function DetailModal(", "function Meta(", "function Chip(", 'className="p-4 sm:p-6 space-y-4"']],
  ];
  for (const [rel, componente, marcas] of casos) {
    const src = leer(rel);
    assert.match(src, /\{ rediseno = false \}/, `${rel}: la bandera apagada es el valor por defecto`);
    assert.match(src, new RegExp(`if \\(rediseno\\) \\{\\s*return \\(\\s*<${componente}`), `${rel}: el rediseño se monta solo con la bandera`);
    for (const marca of marcas) {
      assert.ok(src.includes(marca), `${rel}: el camino viejo perdió «${marca}»`);
    }
    // El rediseño aparece UNA vez (la rama) más el import: nada del camino viejo se reescribió con él.
    assert.equal((src.match(new RegExp(componente, "g")) ?? []).length, 2, `${rel}: ${componente} aparece más de lo esperado`);
  }
});

test("la carpeta nueva no toca nada compartido", () => {
  for (const a of archivosNuevos) {
    assert.ok(!/menu-dos-niveles\.module\.css/.test(a.texto), `${a.nombre} importa la hoja del menú a pelo: pasa por clases.ts`);
    assert.ok(!/from "@\/components\/dashboard\/(pacientes-rediseno|hoy-rediseno|agenda-nueva)/.test(a.texto), `${a.nombre} depende de la carpeta de otra pantalla`);
  }
});
