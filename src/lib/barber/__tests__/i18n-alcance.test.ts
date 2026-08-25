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
