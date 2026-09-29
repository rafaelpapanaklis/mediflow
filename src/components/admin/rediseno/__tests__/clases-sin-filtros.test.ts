/**
 * Las clases del rediseño de /admin no pueden llamarse como las que ocultan los
 * bloqueadores de anuncios.
 *
 * Medido el 29-sep-2026: la portada de /admin salía con SOLO el encabezado
 * («Dashboard · fecha · Registrar pago · Reporte completo») y todo lo demás en
 * blanco, con la consola vacía, en producción y en panel.108, a cualquier
 * ancho, y solo en el navegador de Rafael. Los bloqueadores (EasyList y la lista
 * base de AdGuard) traen las reglas genéricas `##.ad-card` y `##.ad-tile`, que
 * dan `display:none` a esas clases en CUALQUIER sitio. La portada son tarjetas
 * `.ad-card` y cuatro `.ad-tile`; las rejillas que las contienen no tienen fondo,
 * así que no se veía nada. El DOM estaba completo y no hay ningún error de JS.
 * El prefijo `ad-` tiene ~2300 reglas genéricas en esas listas: no basta con
 * esquivar las dos que chocan hoy. El prefijo del rediseño es `dcp-`.
 *
 * Run: node --import tsx --test src/components/admin/rediseno/__tests__/clases-sin-filtros.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Prefijos que las listas de filtros usan a mansalva. */
const PREFIJO_PELIGROSO = /^(ad|ads|adv|advert|sponsor|banner|promo)[-_]/i;
/** Nombres exactos que EasyList / AdGuard ocultan en cualquier sitio y que suenan a UI normal. */
const GENERICAS_CONOCIDAS = new Set(["ad-card", "ad-tile", "ad-grid", "ad-container", "adbox", "adsbox", "banner-ad", "sponsored", "sponsor"]);

export function claveProhibida(clase: string): boolean {
  return PREFIJO_PELIGROSO.test(clase) || GENERICAS_CONOCIDAS.has(clase.toLowerCase());
}

const RAIZ = process.cwd();

function archivos(dir: string, exts: string[], salida: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    if (nombre === "__tests__" || nombre === "node_modules") continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivos(ruta, exts, salida);
    else if (exts.some((e) => nombre.endsWith(e))) salida.push(ruta);
  }
  return salida;
}

/** Clases que DEFINE una hoja: los `.nombre` de sus selectores (sin comentarios ni valores). */
function clasesDeCss(css: string): string[] {
  const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectores = sinComentarios.replace(/\{[^{}]*\}/g, "{}"); // fuera los bloques de declaraciones
  return [...selectores.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]);
}

/** Palabras con pinta de clase dentro de un tsx: `className="a b"`, `` `a ${x}` ``, `" a"`. */
function candidatasDeTsx(fuente: string): string[] {
  return [...fuente.matchAll(/(?:^|[\s"'`{(])((?:ad|ads|adv)[-_][A-Za-z0-9_-]+)/g)].map((m) => m[1]);
}

test("el detector reconoce las clases que EasyList oculta", () => {
  for (const c of ["ad-card", "ad-tile", "ad-grid-2", "ads-x", "adv-y", "banner-hero", "Ad_slot"]) assert.ok(claveProhibida(c), c);
  for (const c of ["dcp-card", "dcp-tile", "ficha-cabecera", "adm-x", "add-item", "load-more"]) assert.ok(!claveProhibida(c), c);
});

test("las hojas del rediseño de /admin no definen clases que un bloqueador oculte", () => {
  const hojas = [
    ...archivos(join(RAIZ, "src/components/admin"), [".css"]),
    ...archivos(join(RAIZ, "src/app/admin"), [".css"]),
  ];
  assert.ok(hojas.length > 0, "no encontré ninguna hoja de /admin");
  const malas = hojas.flatMap((h) => clasesDeCss(readFileSync(h, "utf8")).filter(claveProhibida).map((c) => `${h}: .${c}`));
  assert.deepEqual([...new Set(malas)], [], "clases que los bloqueadores de anuncios ocultan:\n" + malas.join("\n"));
});

test("los componentes de /admin no usan clases con prefijo de anuncio", () => {
  const fuentes = [
    ...archivos(join(RAIZ, "src/components/admin"), [".tsx"]),
    ...archivos(join(RAIZ, "src/app/admin"), [".tsx"]),
  ];
  assert.ok(fuentes.length > 0, "no encontré ningún componente de /admin");
  const malas = fuentes.flatMap((f) => candidatasDeTsx(readFileSync(f, "utf8")).map((c) => `${f}: ${c}`));
  assert.deepEqual(malas, [], "clases con prefijo ad-/ads-/adv- en /admin:\n" + malas.join("\n"));
});

test("la portada y sus piezas usan el prefijo dcp- que sí existe en la hoja", () => {
  const css = readFileSync(join(RAIZ, "src/components/admin/rediseno/admin-rediseno.css"), "utf8");
  const definidas = new Set(clasesDeCss(css));
  for (const c of ["dcp-tile", "dcp-card", "dcp-tiles", "dcp-grid-2", "dcp-grid-3", "dcp-pagina", "dcp-cabecera"]) {
    assert.ok(definidas.has(c), `la hoja no define .${c}`);
  }
});
