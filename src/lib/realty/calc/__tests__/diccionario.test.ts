// ═══════════════════════════════════════════════════════════════════════
// ALCANCE DEL DICCIONARIO DE LAS CALCULADORAS.
//
// calc.json NO se cuelga del barril de realty (src/i18n/dictionaries/realty/
// index.ts) a propósito: las diez terminales de la Ola 1 lo editan a la vez
// y sería un choque garantizado. El precio de esa decisión es que la prueba
// del vertical (i18n-alcance.test.ts) no lo alcanza — así que la red la
// pone este archivo.
//
// Es la misma clase de bug que ya mordió dos veces en barber: una llave rota
// NO se ve como un error, se ve como una feature que no existe.
//
//   npx tsx --test src/lib/realty/calc/__tests__/diccionario.test.ts
// ═══════════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(__dirname, "..", "..", "..", "..", "..");
const SRC = join(RAIZ, "src");

// eslint-disable-next-line @typescript-eslint/no-var-requires
const DICT = JSON.parse(
  readFileSync(join(SRC, "i18n", "dictionaries", "realty", "calc.json"), "utf8"),
) as Record<string, Record<string, unknown>>;

type Nodo = string | { [k: string]: Nodo };

/** Un nodo { one, other } es una forma PLURAL: es hoja, no rama. */
function esPlural(v: unknown): boolean {
  return !!v && typeof v === "object" && !Array.isArray(v) && ("one" in v || "other" in v);
}

function aplanar(o: Record<string, unknown>, pre = "", out: string[] = []): string[] {
  for (const [k, v] of Object.entries(o)) {
    const llave = pre ? `${pre}.${k}` : k;
    if (typeof v === "string" || esPlural(v)) out.push(llave);
    else if (v && typeof v === "object") aplanar(v as Record<string, unknown>, llave, out);
  }
  return out;
}

/** Lo mismo que hace makeT: string suelto o forma plural cuentan como resuelto. */
function resuelve(o: Record<string, unknown>, llave: string): boolean {
  const n = buscar(o, llave);
  return typeof n === "string" || esPlural(n);
}

function buscar(o: Record<string, unknown>, llave: string): Nodo | undefined {
  let nodo: unknown = o;
  for (const parte of llave.split(".")) {
    if (nodo == null || typeof nodo === "string") return undefined;
    nodo = (nodo as Record<string, unknown>)[parte];
  }
  return nodo as Nodo | undefined;
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

test("el diccionario trae los dos idiomas", () => {
  assert.ok(DICT.es, "falta el árbol es");
  assert.ok(DICT.en, "falta el árbol en");
});

test("es y en tienen EXACTAMENTE las mismas llaves", () => {
  const es = new Set(aplanar(DICT.es));
  const en = new Set(aplanar(DICT.en));
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

test("ninguna traducción está vacía (una etiqueta vacía es una feature que desaparece)", () => {
  for (const locale of ["es", "en"] as const) {
    const raiz = DICT[locale];
    const vacias = aplanar(raiz).filter((k) => {
      const v = buscar(raiz, k);
      if (typeof v === "string") return v.trim() === "";
      if (esPlural(v)) {
        return Object.values(v as Record<string, unknown>).some(
          (x) => typeof x === "string" && x.trim() === "",
        );
      }
      return false;
    });
    assert.deepEqual(vacias, [], `traducciones vacías en ${locale}`);
  }
});

/**
 * La prueba que de verdad atrapa el bug: recorre el CÓDIGO de las
 * calculadoras, saca cada t("…") con literal y comprueba que resuelve.
 * No hay lista escrita a mano que se pueda quedar vieja.
 */
test("toda llave que piden las pantallas existe en los dos idiomas", () => {
  const archivos = [
    ...recorrer(join(SRC, "components", "realty", "calc")),
    ...recorrer(join(SRC, "app", "inmobiliaria", "(panel)", "calculadoras")),
  ];
  assert.ok(archivos.length >= 5, "no se encontraron los archivos de las calculadoras");

  const pedidas = new Set<string>();
  for (const archivo of archivos) {
    const fuente = readFileSync(archivo, "utf8");
    const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // Array.from y NO for..of directo sobre matchAll: el tsconfig del repo
    // no fija `target`, así que iterar el iterador saca TS2802 en tsc --noEmit
    // (el mismo error que el test de barber arrastra y que aquí no se hereda).
    for (const m of Array.from(codigo.matchAll(/\bt\(\s*"([A-Za-z0-9_.]+)"/g))) {
      pedidas.add(m[1]);
    }
  }
  assert.ok(pedidas.size > 20, `se esperaban muchas llaves y solo se hallaron ${pedidas.size}`);

  for (const locale of ["es", "en"] as const) {
    const faltan = Array.from(pedidas)
      .filter((k) => !resuelve(DICT[locale], k))
      .sort();
    assert.deepEqual(faltan, [], `llaves que el código pide y el diccionario ${locale} no tiene`);
  }
});

test("las pantallas de inmuebles usan makeRealtyT y nunca makeT pelado", () => {
  // Duplica a propósito la prueba del vertical: si alguien mueve estos
  // archivos fuera de components/realty, aquella deja de mirarlos y esta no.
  const culpables: string[] = [];
  for (const archivo of [
    ...recorrer(join(SRC, "components", "realty", "calc")),
    ...recorrer(join(SRC, "app", "inmobiliaria", "(panel)", "calculadoras")),
  ]) {
    const fuente = readFileSync(archivo, "utf8");
    const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    if (/\bmakeT\s*\(/.test(codigo)) culpables.push(archivo.slice(RAIZ.length + 1));
  }
  assert.deepEqual(culpables, [], "usa makeRealtyT de @/lib/realty/i18n");
});

test("la convención B no se cruza: la página recorta y el componente no prefija", () => {
  const pagina = readFileSync(
    join(SRC, "app", "inmobiliaria", "(panel)", "calculadoras", "page.tsx"),
    "utf8",
  );
  assert.match(
    pagina,
    /calcDict[^;]*\)\[locale\]/,
    "la página ya no recorta el sub-árbol por idioma; revisa esta prueba",
  );

  const pantalla = readFileSync(
    join(SRC, "components", "realty", "calc", "calculadoras-screen.tsx"),
    "utf8",
  );
  // Un segundo argumento sería el prefijo: con el sub-árbol ya recortado eso
  // buscaría "realty.calc.title" DENTRO del sub-árbol y pintaría la llave.
  assert.equal(
    /makeRealtyT\(\s*dict\s*,/.test(pantalla),
    false,
    "calculadoras-screen recibe el sub-árbol YA RECORTADO y además antepone prefijo",
  );
});

test("el aviso de que no es asesoría existe en los dos idiomas del contrato", () => {
  // La leyenda la genera el código (lleva el año interpolado), pero el texto
  // de plan/permiso sí vive en el diccionario y no puede faltar.
  for (const locale of ["es", "en"] as const) {
    for (const k of ["errores.sinPlan", "errores.sinPermiso", "faltantes.title", "faltantes.body"]) {
      assert.equal(resuelve(DICT[locale], k), true, `falta ${k} en ${locale}`);
    }
  }
});
