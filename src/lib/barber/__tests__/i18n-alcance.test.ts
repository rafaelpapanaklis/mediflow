// ═══════════════════════════════════════════════════════════════════════
// ALCANCE DEL DICCIONARIO — la prueba que hubiera atrapado el bug de
// /barber/campanas antes de que llegara a producción.
//
// El vertical mezcla DOS convenciones legítimas y no hay nada que las
// obligue a coincidir:
//
//   A) el servidor baja el diccionario COMPLETO y el hook del cliente
//      antepone el prefijo:  makeBarberT(dict, "barber.campanas")
//   B) el servidor baja YA RECORTADO el sub-árbol y el hook no prefija:
//      makeBarberT(dictBarberCaja)
//
// Cruzarlas no rompe el render ni el build ni los tipos: makeT devuelve la
// llave cuando no resuelve, así que la pantalla se pinta "bien" con
// "barber.campanas.title" en el encabezado. Eso fue exactamente lo que pasó.
//
// Estas pruebas son ESTÁTICAS (leen el código fuente): no necesitan
// Postgres, ni navegador, ni sesión. Corren en medio segundo.
//
//   npx tsx --test src/lib/barber/__tests__/i18n-alcance.test.ts
// ═══════════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Dictionary } from "@/i18n/t";
import { getBarberDict } from "@/i18n/dictionaries/barber";

const RAIZ = join(__dirname, "..", "..", "..", ".."); // → raíz del repo
const SRC = join(RAIZ, "src");

function leer(rel: string): string {
  return readFileSync(join(RAIZ, rel), "utf8");
}

function recorrer(dir: string, out: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const p = join(dir, entrada);
    if (statSync(p).isDirectory()) recorrer(p, out);
    else if (/[.]tsx?$/.test(entrada)) out.push(p);
  }
  return out;
}

// ── 1. Quien ANTEPONE prefijo exige el diccionario COMPLETO ─────────────
//
// Cada pareja es: el hook que prefija, y el componente que monta su
// provider. La página que renderiza ese componente TIENE que pasarle la
// raíz — si recorta el sub-árbol, el prefijo se aplica dos veces.
const PREFIJADORES = [
  { hook: "src/components/barber/campanas/ui.tsx", monta: "src/components/barber/campanas/campanas-screen.tsx", pagina: "src/app/barber/(panel)/campanas/page.tsx", prefijo: "barber.campanas" },
  { hook: "src/components/barber/whatsapp/ui.tsx", monta: "src/components/barber/whatsapp/whatsapp-screen.tsx", pagina: "src/app/barber/(panel)/whatsapp/page.tsx", prefijo: "barber.whatsapp" },
  { hook: "src/components/barber/bot/bot-screen.tsx", monta: "src/components/barber/bot/bot-screen.tsx", pagina: "src/app/barber/(panel)/whatsapp/bot/page.tsx", prefijo: "barber.bot" },
  { hook: "src/components/barber/team/admin-ui.tsx", monta: "src/components/barber/team/admin-frame.tsx", pagina: "src/components/barber/team/admin-frame.tsx", prefijo: "barber.admin" },
];

test("el que antepone prefijo recibe el diccionario COMPLETO, no el sub-árbol", () => {
  for (const { hook, pagina, prefijo } of PREFIJADORES) {
    const fuenteHook = leer(hook);
    assert.ok(
      fuenteHook.includes(`"${prefijo}"`) || fuenteHook.includes(`\`${prefijo}.`),
      `${hook} ya no antepone "${prefijo}" — actualiza esta prueba`,
    );

    const fuentePagina = leer(pagina);
    // La línea que arma el diccionario. Recortar el sub-árbol aquí es EL bug.
    const recorta = /getBarberDict\([^)]*\)[^;]*\.(barber|campanas|clientes|caja|reportes|whatsapp|bot|admin)\b/.test(
      fuentePagina,
    );
    assert.equal(
      recorta,
      false,
      `${pagina} le entrega un sub-árbol RECORTADO a un componente que antepone "${prefijo}.". ` +
        `Así busca "${prefijo}.title" DENTRO de "${prefijo}" y se pinta la llave cruda en pantalla. ` +
        `Pásale getBarberDict(locale) entero.`,
    );
  }
});

// ── 2. Todo el vertical pasa por makeBarberT ────────────────────────────
//
// makeBarberT avisa por consola en desarrollo cuando una llave no resuelve.
// Si alguien vuelve a usar makeT pelado en barber, ese aviso se pierde.
test("ningún componente de barber usa makeT pelado (pierde el aviso de desarrollo)", () => {
  const culpables: string[] = [];
  for (const carpeta of ["components/barber", "app/barber"]) {
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
    `usa makeBarberT de @/lib/barber/i18n en vez de makeT: ${culpables.join(", ")}`,
  );
});

// ── 3. Las llaves de la pantalla de campañas existen en los DOS idiomas ──
const AUDIENCIAS = ["birthday", "inactive", "membershipExpiring", "membershipExpired", "loyaltyReward", "noShow"];
const OMISIONES = ["optOut", "blocked", "noPhone", "alreadySent", "cooldown"];
const PESTANAS = ["lists", "templates", "results", "optouts"];

const LLAVES_CAMPANAS = [
  "title",
  "subtitle",
  ...PESTANAS.map((k) => `tabs.${k}`),
  ...AUDIENCIAS.map((a) => `audiences.${a}.name`),
  ...AUDIENCIAS.map((a) => `audiences.${a}.hint`),
  ...OMISIONES.map((r) => `list.skip.${r}`),
  "list.skip.detail",
  ...AUDIENCIAS.map((a) => `list.why.${a}`),
  "list.why.inactiveNever",
  "cost.heading",
  "cost.none",
  "cost.oneMessage",
  "cost.messages",
  "errors.generic",
  "errors.noPlan",
  "errors.noPermission",
  "errors.noWhatsapp",
];

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

test("campañas: encabezado, 4 pestañas, 6 audiencias, omisiones, costo y errores traducen en es y en", () => {
  for (const locale of ["es", "en"] as const) {
    const raiz = getBarberDict(locale);
    const faltan = LLAVES_CAMPANAS.filter((k) => !resuelve(raiz, `barber.campanas.${k}`));
    assert.deepEqual(faltan, [], `faltan en ${locale}: ${faltan.join(", ")}`);
  }
});

test("campañas: es y en tienen EXACTAMENTE las mismas llaves", () => {
  const aplanar = (o: Dictionary, pre = "", out: string[] = []): string[] => {
    for (const [k, v] of Object.entries(o)) {
      const llave = pre ? `${pre}.${k}` : k;
      if (typeof v === "string") out.push(llave);
      else if (v && typeof v === "object") {
        if ("one" in v || "other" in v) out.push(llave);
        else aplanar(v as Dictionary, llave, out);
      }
    }
    return out;
  };
  const sub = (locale: "es" | "en") =>
    ((getBarberDict(locale).barber as Dictionary).campanas ?? {}) as Dictionary;

  const es = new Set(aplanar(sub("es")));
  const en = new Set(aplanar(sub("en")));
  assert.deepEqual([...es].filter((k) => !en.has(k)), [], "llaves que solo están en es");
  assert.deepEqual([...en].filter((k) => !es.has(k)), [], "llaves que solo están en en");
});

// ── 4. TODA llave literal del vertical existe en es y en ────────────────
//
// El bug de /barber/inicio: el aviso rojo de "no hay horarios cargados"
// pintaba "barber.inicio.blocker.title" en pantalla. La llave no faltaba —
// el objeto "blocker" estaba escrito bajo la raíz "reportes" del mismo
// archivo (inicio.es.json), y nadie pide "barber.reportes.blocker". Un
// padre equivocado y la pantalla se ve rota sin que reviente nada.
//
// Ni el build ni los tipos ven eso: makeT devuelve la llave cuando no
// resuelve. Así que la única red posible es leer el código y comprobar,
// llave por llave, que existe en los DOS diccionarios.
//
// Se extraen las llaves ESTÁTICAS de dos formas:
//   a) t("barber.algo.otro") — literal completo.
//   b) helper de prefijo constante del archivo:
//        const k = (key) => t(`barber.inicio.${key}`)   → k("blocker.title")
//        const t = useMemo(() => { ... return (k) => tt(`barber.web.${k}`) })
//      El prefijo sale del template; las llaves, de cada llamada literal a
//      ese helper en el MISMO archivo.
// Un ternario de dos literales, k(cond ? "a" : "b"), cuenta como dos
// llaves: las dos se pintan según el caso.
// Lo dinámico (`kpi.${nombre}`, t(variable)) no se puede
// comprobar leyendo: se ignora a propósito.

/** Borra comentarios SIN mover líneas: la prosa menciona llaves de ejemplo. */
function sinComentarios(fuente: string): string {
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, antes: string) => antes + " ".repeat(m.length - antes.length));
}

/** `barber.web.${k}` → "barber.web". Con la interpolación AL FINAL: si hay
 *  algo después (`barber.x.${a}.title`) la llave es dinámica y no cuenta. */
const RE_PREFIJO = /`(barber\.[A-Za-z0-9_]+)\.\$\{\s*[A-Za-z_$][\w$]*\s*\}`/;

/** Helpers de prefijo declarados en el archivo: nombre → prefijo. */
function prefijosDelArchivo(codigo: string): Map<string, string> {
  const lineas = codigo.split("\n");
  const mapa = new Map<string, string>();
  lineas.forEach((linea, i) => {
    const m = RE_PREFIJO.exec(linea);
    if (!m) return;
    // const k = (key) => t(`barber.inicio.${key}`)
    let nombre = /const\s+([A-Za-z_$][\w$]*)\s*=\s*[<(]/.exec(linea)?.[1];
    // const t = useMemo(() => { ...; return (k) => tt(`barber.web.${k}`) })
    for (let j = i - 1; !nombre && j >= 0 && j >= i - 12; j--) {
      nombre = /const\s+([A-Za-z_$][\w$]*)\s*=\s*useMemo/.exec(lineas[j])?.[1];
    }
    if (nombre) mapa.set(nombre, m[1]);
  });
  return mapa;
}

type Uso = {
  archivo: string;
  linea: number;
  llave: string;
  /** true = el prefijo se leyó del archivo, la ruta es la definitiva. */
  exacta: boolean;
};

/** Una llave de verdad: identificador con puntos, sin espacios (mismo
 *  criterio que looksLikeKey en src/lib/barber/i18n.ts). Así un t("Hola")
 *  ya resuelto no se cuela como llave faltante. */
const PARECE_LLAVE = /^[A-Za-z][A-Za-z0-9_.-]*$/;

/** Cualquier `algo("literal")` del archivo: el nombre y el primer argumento. */
const RE_LLAMADA = /\b([A-Za-z_$][\w$]*)\(\s*"([^"\\]*)"/g;

/** `k(cond ? "a" : "b")` — las dos ramas son literales y las dos se pintan.
 *  En el bug de Inicio, blocker.body y blocker.bodyPublished salían justo
 *  de aquí, así que ignorarlas dejaba fuera 2 de las 5 llaves rotas. */
const RE_TERNARIO = /\b([A-Za-z_$][\w$]*)\(\s*[^)"']*?\?\s*"([^"\\]*)"\s*:\s*"([^"\\]*)"/g;

function llavesDelArchivo(rutaAbs: string): Uso[] {
  const codigo = sinComentarios(readFileSync(rutaAbs, "utf8"));
  const prefijos = prefijosDelArchivo(codigo);
  const rel = rutaAbs.slice(RAIZ.length + 1).split("\\").join("/");
  const usos: Uso[] = [];

  const anota = (llamador: string, literal: string, indice: number) => {
    // Solo t() y los helpers de prefijo del propio archivo: un
    // startsWith("barber.") o cualquier otra llamada no es una llave.
    if (llamador !== "t" && !prefijos.has(llamador)) return;
    const prefijo = prefijos.get(llamador);
    const llave = literal.startsWith("barber.") ? literal : prefijo ? `${prefijo}.${literal}` : null;
    if (!llave || !PARECE_LLAVE.test(llave)) return;
    usos.push({
      archivo: rel,
      linea: codigo.slice(0, indice).split("\n").length,
      llave,
      exacta: !literal.startsWith("barber."),
    });
  };

  for (const m of codigo.matchAll(RE_LLAMADA)) anota(m[1], m[2], m.index);
  for (const m of codigo.matchAll(RE_TERNARIO)) {
    anota(m[1], m[2], m.index);
    anota(m[1], m[3], m.index);
  }
  return usos;
}

/** Las raíces del vertical: shell, agenda, caja, inicio, reportes… */
const AREAS = Object.keys(getBarberDict("es").barber as Dictionary);

/**
 * Un literal que empieza por `barber.` es AMBIGUO leyendo el archivo:
 *   · si la página le pasó la raíz, es la llave completa;
 *   · si le pasó el sub-árbol YA RECORTADO, es relativa a un área.
 * La segunda pasa de verdad: /barber/reportes baja `barber.reportes` y el
 * selector de barbero pide t("barber.label") → barber.reportes.barber.label.
 * Así que se acepta si resuelve de CUALQUIERA de las dos formas; solo se
 * exige la ruta exacta cuando el prefijo se leyó del propio archivo.
 */
function resuelveEnAlgunAlcance(raiz: Dictionary, u: Uso): boolean {
  if (resuelve(raiz, u.llave)) return true;
  if (u.exacta) return false;
  return AREAS.some((area) => resuelve(raiz, `barber.${area}.${u.llave}`));
}

// Llaves que el código pide y que NO existen en NINGÚN diccionario: se
// sacan de la afirmación con un TODO que las nombra, nunca inventando el
// texto. Vacío = el vertical está sano.
const SIN_TRADUCCION_TODAVIA = new Set<string>([
  // (vacío)
]);

test("toda llave literal de barber existe en es y en", () => {
  const usos: Uso[] = [];
  for (const carpeta of ["components/barber", "app/barber"]) {
    for (const archivo of recorrer(join(SRC, carpeta))) usos.push(...llavesDelArchivo(archivo));
  }
  // Red de seguridad del propio extractor: si alguien cambia la forma de
  // llamar a t() y aquí dejan de salir llaves, la prueba pasaría en verde
  // sin haber comprobado NADA.
  assert.ok(usos.length > 500, `solo se extrajeron ${usos.length} llaves literales — el extractor se quedó ciego`);
  assert.ok(
    usos.some((u) => u.llave === "barber.inicio.blocker.title"),
    "el extractor dejó de leer el helper de prefijo de inicio-view.tsx — era justo el caso que se escapó",
  );

  const faltan: string[] = [];
  for (const locale of ["es", "en"] as const) {
    const raiz = getBarberDict(locale);
    for (const u of usos) {
      if (SIN_TRADUCCION_TODAVIA.has(u.llave)) continue;
      if (!resuelveEnAlgunAlcance(raiz, u)) faltan.push(`[${locale}] ${u.llave} ← ${u.archivo}:${u.linea}`);
    }
  }
  assert.deepEqual(
    [...new Set(faltan)].sort(),
    [],
    "el código pide llaves que el diccionario no tiene — mira si el bloque quedó colgado del padre equivocado",
  );
});

test("el aviso de 'sin horarios' de Inicio cuelga de barber.inicio, no de barber.reportes", () => {
  for (const locale of ["es", "en"] as const) {
    const raiz = getBarberDict(locale);
    for (const hoja of ["title", "body", "bodyPublished", "cta", "askOwner"]) {
      assert.ok(
        resuelve(raiz, `barber.inicio.blocker.${hoja}`),
        `falta barber.inicio.blocker.${hoja} en ${locale}`,
      );
      assert.ok(
        !resuelve(raiz, `barber.reportes.blocker.${hoja}`),
        `barber.reportes.blocker.${hoja} volvió a existir en ${locale}: nadie lo pide ahí, el bloque va bajo inicio`,
      );
    }
  }
});
