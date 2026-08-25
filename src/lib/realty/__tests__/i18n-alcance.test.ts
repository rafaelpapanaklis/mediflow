// ═══════════════════════════════════════════════════════════════════════
// ALCANCE DEL DICCIONARIO — la prueba que hubiera atrapado el bug de
// /barber/campanas antes de que llegara a producción.
//
// 🔴 POR QUÉ EXISTE: una llave de i18n rota NO se ve como un error. Se ve
// como una feature que no existe. En barber pasó dos veces:
//   · /barber/campanas llegó a producción pintando "barber.campanas.title"
//     en el encabezado, y nadie se enteró porque la pantalla "funcionaba".
//   · Peor: el modal de cobro se veía SIN OPCIONES, porque las etiquetas de
//     sus botones venían vacías.
//
// La causa no fue una llave faltante sino un DESAJUSTE DE ALCANCE. El
// vertical mezcla DOS convenciones legítimas y nada las obliga a coincidir:
//
//   A) el servidor baja el diccionario COMPLETO y el componente antepone el
//      prefijo:  makeRealtyT(dict, "realty.registro")
//   B) el servidor baja YA RECORTADO el sub-árbol y el componente NO
//      prefija:  makeRealtyT(dictRegistro)
//
// Cruzarlas no rompe el render, ni el build, ni los tipos: makeT devuelve la
// llave cuando no resuelve. Por eso hace falta una prueba.
//
// Estas pruebas son ESTÁTICAS (leen el código fuente y los JSON): no
// necesitan Postgres, ni navegador, ni sesión. Corren en medio segundo.
//
//   npx tsx --test src/lib/realty/__tests__/i18n-alcance.test.ts
// ═══════════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Dictionary } from "@/i18n/t";
import { REALTY_DICTS, getRealtyDict } from "@/i18n/dictionaries/realty";
import { REALTY_NAV_ITEMS } from "@/lib/realty/types";

const RAIZ = join(__dirname, "..", "..", "..", ".."); // → raíz del repo
const SRC = join(RAIZ, "src");

function leer(rel: string): string {
  return readFileSync(join(RAIZ, rel), "utf8");
}

function recorrer(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entrada of readdirSync(dir)) {
    const p = join(dir, entrada);
    if (statSync(p).isDirectory()) recorrer(p, out);
    else if (/[.]tsx?$/.test(entrada)) out.push(p);
  }
  return out;
}

function buscar(dict: Dictionary, llave: string): string | Dictionary | undefined {
  let nodo: string | Dictionary | undefined = dict;
  for (const parte of llave.split(".")) {
    if (nodo == null || typeof nodo === "string") return undefined;
    nodo = nodo[parte];
  }
  return nodo;
}

function resuelve(dict: Dictionary, llave: string): boolean {
  const n = buscar(dict, llave);
  return typeof n === "string" || (!!n && typeof n === "object" && ("one" in n || "other" in n));
}

function aplanar(o: Dictionary, pre = "", out: string[] = []): string[] {
  for (const [k, v] of Object.entries(o)) {
    const llave = pre ? `${pre}.${k}` : k;
    if (typeof v === "string") out.push(llave);
    else if (v && typeof v === "object") {
      if ("one" in v || "other" in v) out.push(llave);
      else aplanar(v as Dictionary, llave, out);
    }
  }
  return out;
}

// ── 1. RECORRE LAS PANTALLAS: cada item del menú necesita su etiqueta y su
//       descripción, en los DOS idiomas ─────────────────────────────────
//
// Esta es la prueba que "recorre las pantallas": no hay una lista escrita a
// mano de llaves que se pueda quedar vieja — sale de REALTY_NAV_ITEMS, que
// es lo que arma el sidebar de verdad. Un item nuevo sin traducir hace
// fallar esto ANTES de que alguien lo vea pintado en crudo.
test("cada pantalla del menú tiene etiqueta y descripción en es y en en", () => {
  for (const locale of ["es", "en"] as const) {
    const raiz = getRealtyDict(locale);
    const faltan: string[] = [];
    for (const item of REALTY_NAV_ITEMS) {
      if (!resuelve(raiz, `realty.shell.nav.${item.key}`)) {
        faltan.push(`realty.shell.nav.${item.key}`);
      }
      // La descripción la usa el placeholder: sin ella la pantalla en
      // construcción no dice qué va a haber ahí, que es todo su valor.
      if (!resuelve(raiz, `realty.shell.areas.${item.key}`)) {
        faltan.push(`realty.shell.areas.${item.key}`);
      }
    }
    assert.deepEqual(faltan, [], `faltan en ${locale}: ${faltan.join(", ")}`);
  }
});

test("cada sección del menú tiene su encabezado en es y en en", () => {
  const secciones = Array.from(new Set(REALTY_NAV_ITEMS.map((i) => i.section)));
  for (const locale of ["es", "en"] as const) {
    const raiz = getRealtyDict(locale);
    const faltan = secciones.filter((s) => !resuelve(raiz, `realty.shell.navSections.${s}`));
    assert.deepEqual(faltan, [], `encabezados de sección sin traducir en ${locale}`);
  }
});

test("las llaves sueltas del shell existen en es y en en", () => {
  const LLAVES = [
    "brand.product",
    "brand.vertical",
    "topbar.root",
    "logout",
    "placeholder.soon",
    "placeholder.body",
    "placeholder.hint",
    "modes.AGENCY",
    "modes.AGENT",
    "modes.OWNER",
  ];
  for (const locale of ["es", "en"] as const) {
    const raiz = getRealtyDict(locale);
    const faltan = LLAVES.filter((k) => !resuelve(raiz, `realty.shell.${k}`));
    assert.deepEqual(faltan, [], `faltan en ${locale}: ${faltan.join(", ")}`);
  }
});

// ── 2. El formulario de alta: TODA llave que pide, existe ───────────────
//
// El formulario usa la convención B (sub-árbol recortado, prefijo vacío),
// así que sus llaves se piden SIN "realty.registro." delante. Aquí se
// vuelven a poner para buscarlas desde la raíz.
test("el alta pública tiene todas sus llaves en es y en en", () => {
  const LLAVES = [
    "step.mode",
    "step.form",
    "mode.title",
    "mode.subtitle",
    "mode.change",
    "mode.AGENCY.label",
    "mode.AGENCY.help",
    "mode.AGENT.label",
    "mode.AGENT.help",
    "mode.OWNER.label",
    "mode.OWNER.help",
    "form.accountName",
    "form.accountNameAgent",
    "form.accountNameOwner",
    "form.firstName",
    "form.lastName",
    "form.email",
    "form.password",
    "form.phone",
    "form.phoneHint",
    "form.city",
    "form.state",
    "form.teamSize",
    "form.submit",
    "form.submitting",
    "form.haveAccount",
    "form.signIn",
    "errors.accountName",
    "errors.firstName",
    "errors.lastName",
    "errors.email",
    "errors.password",
    "errors.phone",
    "errors.generic",
    "success.title",
    "success.body",
    "success.next",
    "success.cta",
  ];
  for (const locale of ["es", "en"] as const) {
    const raiz = getRealtyDict(locale);
    const faltan = LLAVES.filter((k) => !resuelve(raiz, `realty.registro.${k}`));
    assert.deepEqual(faltan, [], `faltan en ${locale}: ${faltan.join(", ")}`);
  }
});

// ── 3. Las dos convenciones NO se cruzan ────────────────────────────────
//
// Quien recibe el sub-árbol YA RECORTADO no puede anteponer el prefijo, y
// al revés. Esto se comprueba leyendo el código, que es donde vive el bug.
test("quien recibe el sub-árbol recortado NO antepone el prefijo", () => {
  const pagina = leer("src/app/inmobiliaria/registro/page.tsx");
  const recorta = /getRealtyDict\([^)]*\)[^;]*\.registro/.test(pagina);
  assert.equal(recorta, true, "la página de registro ya no recorta el sub-árbol; revisa esta prueba");

  const form = leer("src/components/realty/realty-registro-form.tsx");
  // Un segundo argumento en makeRealtyT sería el prefijo: con el sub-árbol
  // ya recortado, eso busca "realty.registro.mode.title" DENTRO de
  // "realty.registro" y pinta la llave cruda.
  const anteponePrefijo = /makeRealtyT\(\s*dict\s*,/.test(form);
  assert.equal(
    anteponePrefijo,
    false,
    'realty-registro-form.tsx recibe el sub-árbol YA RECORTADO y además antepone un prefijo. ' +
      'Así busca "realty.registro.mode.title" dentro de "realty.registro" y se pinta la llave ' +
      "cruda en pantalla. O quita el prefijo, o pásale getRealtyDict(locale) entero.",
  );
});

// ── 4. Todo el vertical pasa por makeRealtyT ────────────────────────────
//
// makeRealtyT avisa por consola en desarrollo cuando una llave no resuelve.
// Si alguien usa makeT pelado en inmuebles, ese aviso se pierde y volvemos
// al escenario del bug.
test("ningún archivo de inmuebles usa makeT pelado (perdería el aviso de desarrollo)", () => {
  const culpables: string[] = [];
  for (const carpeta of ["components/realty", "app/inmobiliaria", "app/i"]) {
    for (const archivo of recorrer(join(SRC, carpeta))) {
      const fuente = readFileSync(archivo, "utf8");
      // sin comentarios: interesa el código, no la prosa que menciona makeT
      const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      if (/\bmakeT\s*\(/.test(codigo)) {
        culpables.push(archivo.slice(RAIZ.length + 1).replace(/\\/g, "/"));
      }
    }
  }
  assert.deepEqual(
    culpables,
    [],
    `usa makeRealtyT de @/lib/realty/i18n en vez de makeT: ${culpables.join(", ")}`,
  );
});

// ── 5. ES y EN tienen EXACTAMENTE las mismas llaves ─────────────────────
//
// Una llave que solo está en español no falla en español: falla el día que
// una cuenta pone locale "en" y ve la llave cruda. Se compara el árbol
// completo del vertical, no un área suelta.
test("es y en tienen exactamente las mismas llaves en todo el vertical", () => {
  const sub = (locale: "es" | "en") => (REALTY_DICTS[locale].realty ?? {}) as Dictionary;
  const es = new Set(aplanar(sub("es")));
  const en = new Set(aplanar(sub("en")));
  // Array.from y NO [...set]: el tsconfig del repo no fija `target`, así que
  // el spread de un Set saca TS2802 en `tsc --noEmit`. El test de barber
  // arrastra esos dos errores desde que se escribió; aquí no se heredan.
  assert.deepEqual(
    Array.from(es).filter((k) => !en.has(k)).sort(),
    [],
    "llaves que solo están en es",
  );
  assert.deepEqual(
    Array.from(en).filter((k) => !es.has(k)).sort(),
    [],
    "llaves que solo están en en",
  );
});

// ── 6. Ningún valor del diccionario se quedó vacío ──────────────────────
//
// El modal de cobro de barber se veía "sin opciones" porque sus etiquetas
// eran cadenas vacías: el JSON tenía la llave, así que ninguna comprobación
// de existencia lo atrapaba. Una etiqueta vacía es una llave rota.
test("ninguna traducción está vacía (una etiqueta vacía es una feature que desaparece)", () => {
  for (const locale of ["es", "en"] as const) {
    const raiz = (REALTY_DICTS[locale].realty ?? {}) as Dictionary;
    const vacias = aplanar(raiz).filter((k) => {
      const v = buscar(raiz, k);
      return typeof v === "string" && v.trim() === "";
    });
    assert.deepEqual(vacias, [], `traducciones vacías en ${locale}: ${vacias.join(", ")}`);
  }
});

// ── 7. Los mapas de iconos cubren TODO el menú ──────────────────────────
//
// No es i18n, pero es exactamente el mismo modo de falla: un icono que no
// está en el mapa cae al fallback EN SILENCIO, y toda pantalla desconocida
// termina pintando el mismo edificio genérico. Es el bug del megáfono de
// barber (un icono inexistente caía a "tijeras", que ya significaba otra
// cosa) y se atrapa igual de barato.
test("el sidebar sabe pintar el icono de todos los items del menú", () => {
  const fuente = leer("src/components/realty/realty-sidebar.tsx");
  const mapa = fuente.slice(fuente.indexOf("const ICONS"), fuente.indexOf("const SECTION_ORDER"));
  const faltan = REALTY_NAV_ITEMS.map((i) => i.icon)
    .filter((icon, idx, arr) => arr.indexOf(icon) === idx)
    .filter((icon) => !mapa.includes(`${icon}:`) && !mapa.includes(`"${icon}":`));
  assert.deepEqual(faltan, [], `iconos sin entrada en el mapa ICONS del sidebar: ${faltan.join(", ")}`);
});

test("el placeholder sabe pintar el icono de todas las áreas", () => {
  const fuente = leer("src/components/realty/realty-placeholder.tsx");
  const mapa = fuente.slice(fuente.indexOf("const ICONS"), fuente.indexOf("export function"));
  const faltan = REALTY_NAV_ITEMS.map((i) => i.key).filter(
    (key) => !mapa.includes(`${key}:`) && !mapa.includes(`"${key}":`),
  );
  assert.deepEqual(faltan, [], `áreas sin icono en el placeholder: ${faltan.join(", ")}`);
});

// ── 8. Todo item del menú apunta a una página que EXISTE ────────────────
//
// Un href sin página es un 404 desde el propio menú. Barber tiene seis
// rutas al revés (páginas sin item de menú, inalcanzables); esto atrapa la
// otra mitad del problema, que es la que el usuario sí ve.
test("cada item del menú apunta a una página que existe", () => {
  const faltan = REALTY_NAV_ITEMS.filter((item) => {
    const area = item.href.replace("/inmobiliaria/", "");
    return !existsSync(join(SRC, "app", "inmobiliaria", "(panel)", area, "page.tsx"));
  }).map((i) => `${i.key} → ${i.href}`);
  assert.deepEqual(faltan, [], `items del menú sin página: ${faltan.join(", ")}`);
});
