// ═══════════════════════════════════════════════════════════════════════
// LANDING /barberias — pruebas ESTÁTICAS (sin BD, sin navegador).
//
//   npx tsx --test src/lib/barber/__tests__/marketing.test.ts
//
// Vigilan las tres reglas de la landing:
//   1. Cada promesa apunta a archivos del panel que EXISTEN (si alguien
//      borra el módulo, la promesa deja de pasar antes de mentir).
//   2. Ningún precio de plan vive en el código ni en el copy: todo sale de
//      barber_plan_configs. Se busca el seed (199 / 329 / 749) en los
//      archivos de la landing y no puede aparecer.
//   3. Cero vocabulario del dental (paciente, doctor, Dr., clínica,
//      consulta, expediente) en la landing ni en sus diccionarios.
// Y además: es/en con las mismas llaves, cada llave que usan los componentes
// resuelve en los dos idiomas, y el view-model de los planes se arma bien.
// ═══════════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Dictionary } from "@/i18n/t";
import { getBarberDict } from "@/i18n/dictionaries/barber";
import { BARBER_FEATURES, FALLBACK_BARBER_PLAN_CONFIG, type BarberResolvedPlan } from "@/lib/barber/plan-shared";
import { BARBER_WA_PRICE_USD } from "@/lib/barber/whatsapp-core";
import { BARBER_BOT_USD_MXN_FALLBACK } from "@/lib/barber/bot-core";
import {
  BARBER_LANDING_EXAMPLE_VISITS,
  BARBER_LANDING_FAQ_KEYS,
  BARBER_LANDING_FORBIDDEN_WORDS,
  BARBER_LANDING_GROUPS,
  BARBER_LANDING_PROBLEMS,
  BARBER_LANDING_WA_POINTS,
  barberFromPriceLabel,
  barberPlanRequiredFor,
  buildBarberPlanCards,
  cheapestBarberPlan,
  estimateBarberReminderCost,
  serializeBarberJsonLd,
} from "@/lib/barber/marketing";

const RAIZ = join(__dirname, "..", "..", "..", "..");

/** Los archivos que forman la landing (código + copy). */
const LANDING_DIRS = ["src/app/barberias", "src/components/public/barberias"];
const LANDING_FILES = [
  "src/lib/barber/marketing.ts",
  "src/i18n/dictionaries/barber/landing.es.json",
  "src/i18n/dictionaries/barber/landing.en.json",
];

function recorrer(dir: string, out: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const p = join(dir, entrada);
    if (statSync(p).isDirectory()) recorrer(p, out);
    else out.push(p);
  }
  return out;
}

function archivosLanding(): string[] {
  const out: string[] = [];
  for (const d of LANDING_DIRS) out.push(...recorrer(join(RAIZ, d)));
  for (const f of LANDING_FILES) out.push(join(RAIZ, f));
  return out;
}

function planesSeed(): BarberResolvedPlan[] {
  return (Object.keys(FALLBACK_BARBER_PLAN_CONFIG) as Array<keyof typeof FALLBACK_BARBER_PLAN_CONFIG>).map(
    (id) => ({ id, ...FALLBACK_BARBER_PLAN_CONFIG[id] }),
  );
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
function subLanding(locale: "es" | "en"): Dictionary {
  return ((getBarberDict(locale).barber as Dictionary).landing ?? {}) as Dictionary;
}

// ── 1. Cada promesa apunta a código que existe ─────────────────────────
test("cada promesa de la landing se verificó en archivos del panel que existen", () => {
  const claims = [
    ...BARBER_LANDING_GROUPS.flatMap((g) => g.items),
    ...BARBER_LANDING_WA_POINTS,
  ];
  assert.ok(claims.length >= 20, "la landing promete al menos 20 cosas verificadas");
  const faltan: string[] = [];
  for (const c of claims) {
    assert.ok(c.verifiedIn.length > 0, `${c.key} no dice dónde se verificó`);
    for (const rel of c.verifiedIn) {
      if (!existsSync(join(RAIZ, rel))) faltan.push(`${c.key} → ${rel}`);
    }
  }
  assert.deepEqual(faltan, [], `promesas cuyo archivo del panel ya no existe: ${faltan.join(", ")}`);
});

test("cada feature de una promesa existe en el catálogo de planes", () => {
  const catalogo = BARBER_FEATURES.map((f) => f.key);
  const claims = [...BARBER_LANDING_GROUPS.flatMap((g) => g.items), ...BARBER_LANDING_WA_POINTS];
  for (const c of claims) {
    if (c.feature === null) continue;
    assert.ok(catalogo.includes(c.feature), `${c.key} usa la feature desconocida "${c.feature}"`);
  }
});

// ── 2. Cero precios en código ──────────────────────────────────────────
test("ningún archivo de la landing trae el seed de precios (199 / 329 / 749)", () => {
  const culpables: string[] = [];
  for (const archivo of archivosLanding()) {
    const fuente = readFileSync(archivo, "utf8");
    for (const precio of Object.values(FALLBACK_BARBER_PLAN_CONFIG).map((p) => String(p.priceMonthly))) {
      if (fuente.includes(precio)) {
        culpables.push(`${archivo.slice(RAIZ.length + 1).replace(/\\/g, "/")} contiene "${precio}"`);
      }
    }
  }
  assert.deepEqual(culpables, [], culpables.join("; "));
});

// ── 3. Cero vocabulario del dental ─────────────────────────────────────
test("la landing y sus diccionarios no dicen paciente, doctor, Dr., clínica, consulta ni expediente", () => {
  const culpables: string[] = [];
  for (const archivo of archivosLanding()) {
    const rel = archivo.slice(RAIZ.length + 1).replace(/\\/g, "/");
    // marketing.ts es donde VIVE la lista de palabras: se salta a sí mismo.
    if (rel === "src/lib/barber/marketing.ts") continue;
    const fuente = readFileSync(archivo, "utf8");
    for (const palabra of BARBER_LANDING_FORBIDDEN_WORDS) {
      // "consulta" también atrapa "consultar"/"consultas": esa es la intención.
      const idx = fuente.toLowerCase().indexOf(palabra.toLowerCase());
      if (idx >= 0) culpables.push(`${rel}: "${palabra}"`);
    }
  }
  assert.deepEqual(culpables, [], culpables.join("; "));
});

// ── 4. Diccionarios ────────────────────────────────────────────────────
test("landing: es y en tienen EXACTAMENTE las mismas llaves", () => {
  const es = new Set(aplanar(subLanding("es")));
  const en = new Set(aplanar(subLanding("en")));
  assert.ok(es.size > 100, "el diccionario de la landing no puede estar vacío");
  assert.deepEqual(Array.from(es).filter((k) => !en.has(k)), [], "llaves que solo están en es");
  assert.deepEqual(Array.from(en).filter((k) => !es.has(k)), [], "llaves que solo están en en");
});

test("landing: las llaves que arma la estructura (grupos, promesas, problema, FAQ, features) resuelven en es y en", () => {
  const llaves: string[] = [];
  for (const g of BARBER_LANDING_GROUPS) {
    llaves.push(`features.groups.${g.key}.title`, `features.groups.${g.key}.sub`);
    for (const it of g.items) {
      llaves.push(
        `features.groups.${g.key}.items.${it.key}.title`,
        `features.groups.${g.key}.items.${it.key}.body`,
      );
    }
  }
  for (const p of BARBER_LANDING_WA_POINTS) {
    llaves.push(`whatsapp.points.${p.key}.title`, `whatsapp.points.${p.key}.body`);
  }
  for (const p of BARBER_LANDING_PROBLEMS) {
    llaves.push(`problem.items.${p.key}.title`, `problem.items.${p.key}.body`);
  }
  for (const k of BARBER_LANDING_FAQ_KEYS) llaves.push(`faq.items.${k}.q`, `faq.items.${k}.a`);
  for (const f of BARBER_FEATURES) llaves.push(`pricing.features.${f.key}`);
  llaves.push("features.groups.barbero.items.roles.extra", "faq.items.whatsapp.aInbox", "faq.items.whatsapp.aBot");

  for (const locale of ["es", "en"] as const) {
    const raiz = getBarberDict(locale);
    const faltan = llaves.filter((k) => !resuelve(raiz, `barber.landing.${k}`));
    assert.deepEqual(faltan, [], `faltan en ${locale}: ${faltan.join(", ")}`);
  }
});

test("landing: cada t(\"…\") literal de los componentes resuelve en es y en", () => {
  const usadas = new Set<string>();
  const re = /\bt\(\s*"([A-Za-z0-9_.]+)"/g;
  for (const archivo of archivosLanding()) {
    if (!/[.]tsx?$/.test(archivo)) continue;
    const fuente = readFileSync(archivo, "utf8");
    let m: RegExpExecArray | null;
    while ((m = re.exec(fuente)) !== null) usadas.add(m[1]);
  }
  assert.ok(usadas.size >= 40, `se esperaban muchas llaves literales, se encontraron ${usadas.size}`);
  for (const locale of ["es", "en"] as const) {
    const raiz = getBarberDict(locale);
    const faltan = Array.from(usadas).filter((k) => !resuelve(raiz, `barber.landing.${k}`));
    assert.deepEqual(faltan, [], `llaves usadas por los componentes que faltan en ${locale}: ${faltan.join(", ")}`);
  }
});

// ── 5. View-model de planes ────────────────────────────────────────────
test("las tarjetas se arman de la tabla: orden, destacado, precio formateado y features acumuladas", () => {
  const cards = buildBarberPlanCards(planesSeed());
  assert.equal(cards.length, 3);
  assert.deepEqual(
    cards.map((c) => c.id),
    ["BASICO", "AVANZADO", "PROFESIONAL"],
  );
  assert.deepEqual(cards.map((c) => c.recommended), [false, true, false]);
  for (const c of cards) {
    assert.ok(c.monthlyLabel.startsWith("$"), `precio formateado: ${c.monthlyLabel}`);
    assert.ok(c.monthlyLabel.includes(String(c.monthly)), `el precio de la fila va en la etiqueta: ${c.monthlyLabel}`);
    // Sin priceYearly ni firstMonthPrice en el seed, no se inventan.
    assert.equal(c.yearlyLabel, null);
    assert.equal(c.firstMonthLabel, null);
  }
  // El primero lista TODO; los demás solo lo que agregan.
  assert.deepEqual(cards[0].addedFeatureKeys, cards[0].featureKeys);
  assert.equal(cards[0].previousPlanName, null);
  assert.equal(cards[1].previousPlanName, cards[0].name);
  for (const k of cards[1].addedFeatureKeys) assert.ok(!cards[0].featureKeys.includes(k), k);
  for (const k of cards[2].addedFeatureKeys) assert.ok(!cards[1].featureKeys.includes(k), k);
  assert.equal(
    cards[0].featureKeys.length + cards[1].addedFeatureKeys.length + cards[2].addedFeatureKeys.length,
    cards[2].featureKeys.length,
  );
});

test("un plan inactivo no sale, y el primer mes solo se pinta si es menor al mensual", () => {
  const seed = planesSeed();
  const conCambios = seed.map((p) =>
    p.id === "AVANZADO"
      ? { ...p, isActive: false }
      : p.id === "BASICO"
        ? { ...p, firstMonthPrice: p.priceMonthly - 1, priceYearly: p.priceMonthly * 10 }
        : p,
  );
  const cards = buildBarberPlanCards(conCambios);
  assert.deepEqual(cards.map((c) => c.id), ["BASICO", "PROFESIONAL"]);
  assert.equal(cards[0].firstMonth, seed[0].priceMonthly - 1);
  assert.ok(cards[0].firstMonthLabel && cards[0].firstMonthLabel.startsWith("$"));
  assert.ok(cards[0].yearlyLabel && cards[0].yearlyPerMonthLabel);
  assert.equal(cards[1].previousPlanName, cards[0].name);
  // Con dos planes no hay "de en medio" → ninguno destacado.
  assert.deepEqual(cards.map((c) => c.recommended), [false, false]);
});

test("desde $X y 'desde <plan>' salen de la tabla", () => {
  const seed = planesSeed();
  const cheapest = cheapestBarberPlan(seed);
  assert.ok(cheapest);
  assert.equal(cheapest.id, "BASICO");
  assert.equal(barberFromPriceLabel(seed), cheapest ? `$${cheapest.priceMonthly}` : "");
  // Lo que ya trae el plan más barato no lleva etiqueta.
  assert.equal(barberPlanRequiredFor(seed, "agenda"), null);
  assert.equal(barberPlanRequiredFor(seed, null), null);
  assert.equal(barberPlanRequiredFor(seed, "walkinQueue")?.id, "AVANZADO");
  assert.equal(barberPlanRequiredFor(seed, "whatsappBot")?.id, "PROFESIONAL");
  assert.equal(barberPlanRequiredFor(seed, "noExiste"), null);
});

// ── 6. Costo de WhatsApp: compuesto de las constantes del panel ────────
test("el costo de WhatsApp se calcula con BARBER_WA_PRICE_USD y el tipo de cambio del bot", () => {
  const c = estimateBarberReminderCost(BARBER_LANDING_EXAMPLE_VISITS);
  assert.equal(c.perMessageUsd, BARBER_WA_PRICE_USD.UTILITY);
  assert.equal(c.usd, Math.round(BARBER_LANDING_EXAMPLE_VISITS * BARBER_WA_PRICE_USD.UTILITY * 100) / 100);
  assert.equal(c.mxn, Math.ceil(c.usd * BARBER_BOT_USD_MXN_FALLBACK));
  assert.ok(c.mxn > 0 && c.mxn < 200, `un mes de recordatorios cuesta unos pesos, no cientos: ${c.mxn}`);
  const propio = estimateBarberReminderCost(100, 20);
  assert.equal(propio.usdMxn, 20);
});

// ── 7. JSON-LD ─────────────────────────────────────────────────────────
test("el JSON-LD escapa el < para no salirse del <script>", () => {
  const out = serializeBarberJsonLd({ name: "</script><b>x" });
  assert.ok(!out.includes("</script>"));
  assert.ok(!out.includes("<"));
  assert.deepEqual(JSON.parse(out), { name: "</script><b>x" });
});
