/**
 * CANDADOS DE «MARKETPLACE OCULTO, POR AHORA» (ws1-t6).
 *
 * Run: npx tsx --test src/components/dashboard/marketplace-oculto/__tests__/marketplace-oculto.test.ts
 *
 * Se prueba leyendo el código fuente, como `hoy-rediseno.test.ts`: lo que se
 * vigila es CABLEADO — que ninguna pantalla mande a Marketplace por su cuenta,
 * que la ruta siga existiendo, que el camino viejo siga igual y que la carpeta
 * nueva no invente colores ni letra de máquina.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  MARKETPLACE_OCULTO,
  RUTA_PLANES,
  destinoModuloVencidoSegun,
  seOcultaMarketplace,
} from "../destino";

const SRC = join(__dirname, "..", "..", "..", "..");           // src/
const CARPETA = join(SRC, "components", "dashboard", "marketplace-oculto");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const archivosNuevos = readdirSync(CARPETA)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => ({ nombre: f, texto: readFileSync(join(CARPETA, f), "utf8") }));

function recorrer(dir: string, salida: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) {
      if (n === "__tests__" || n === "node_modules") continue;
      recorrer(p, salida);
    } else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) {
      salida.push(p);
    }
  }
  return salida;
}

// ═══════════════════════════════════════════════════════════════════════════
// La decisión, en números: bandera encendida → Planes; apagada → lo de siempre
// ═══════════════════════════════════════════════════════════════════════════
test("camino nuevo: un módulo vencido ya no manda a Marketplace", () => {
  assert.equal(MARKETPLACE_OCULTO, true, "si Rafael lo deshizo, esta prueba se actualiza con él");
  assert.equal(seOcultaMarketplace(true), true);
  assert.equal(destinoModuloVencidoSegun(true, "orthodontics"), RUTA_PLANES);
  assert.ok(!RUTA_PLANES.includes("marketplace"));
});

test("bandera apagada: el destino es, letra por letra, el de siempre", () => {
  assert.equal(seOcultaMarketplace(false), false);
  assert.equal(
    destinoModuloVencidoSegun(false, "orthodontics"),
    "/dashboard/marketplace?expired=orthodontics",
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Ninguna pantalla manda a Marketplace por su cuenta
// ═══════════════════════════════════════════════════════════════════════════
// Quien quiera mandar ahí tiene que pasar por destino.ts, que es donde se
// apaga. Los permitidos son el camino VIEJO (solo lectura, intacto) y la
// propia pantalla de Marketplace, que sigue viva para quien llegue por URL.
const PERMITIDOS = [
  "components/dashboard/marketplace-oculto/destino.ts",
  "components/dashboard/module-locked.tsx",          // bandera apagada
  "components/dashboard/sidebar-nav.ts",             // «Próximamente»: no navega
  "components/dashboard/trial-sidebar-status.tsx",   // no lo monta nadie
  "app/actions/cart.ts",                             // revalidatePath, no un enlace
];
// La carpeta de este arreglo se llama `dashboard/marketplace-oculto`: importarla
// no es enlazar a la pantalla.
const ENLAZA_A_MARKETPLACE = /\/dashboard\/marketplace(?!-oculto)/;
const ES_DE_MARKETPLACE = /^(app\/dashboard\/marketplace|components\/marketplace|lib\/marketplace)\//;

test("nadie fuera de destino.ts escribe la ruta de Marketplace", () => {
  const culpables = recorrer(SRC)
    .map((p) => ({ rel: relative(SRC, p).split(sep).join("/"), texto: readFileSync(p, "utf8") }))
    .filter((a) => !ES_DE_MARKETPLACE.test(a.rel) && !PERMITIDOS.includes(a.rel))
    .filter((a) => ENLAZA_A_MARKETPLACE.test(a.texto))
    .map((a) => a.rel);
  assert.deepEqual(culpables, [], `mandan a Marketplace sin pasar por destino.ts: ${culpables.join(", ")}`);
});

test("el aviso de prueba del menú de siempre sigue sin montarse en ningún sitio", () => {
  const quien = recorrer(SRC)
    .filter((p) => !p.endsWith("trial-sidebar-status.tsx"))
    .filter((p) => /trial-sidebar-status|TrialSidebarStatus/.test(readFileSync(p, "utf8")));
  assert.deepEqual(quien, [], "si alguien lo monta, su enlace a Marketplace vuelve a ser una entrada");
});

test("en el menú de siempre Marketplace sigue siendo «Próximamente» (no navega)", () => {
  const linea = leer("components/dashboard/sidebar-nav.ts")
    .split("\n")
    .find((l) => l.includes('id: "marketplace"'));
  assert.ok(linea, "la opción sigue existiendo: ocultar no es borrar");
  assert.match(linea!, /comingSoon:\s*true/);
});

// ═══════════════════════════════════════════════════════════════════════════
// OCULTAR, NO BORRAR: la ruta y el camino viejo siguen ahí
// ═══════════════════════════════════════════════════════════════════════════
test("la pantalla de Marketplace sigue existiendo", () => {
  assert.ok(existsSync(join(SRC, "app", "dashboard", "marketplace", "page.tsx")));
});

test("ModuleLocked sigue vivo, con su enlace de siempre, para la bandera apagada", () => {
  assert.ok(leer("components/dashboard/module-locked.tsx").includes('href="/dashboard/marketplace"'));
  for (const rel of ["app/dashboard/analytics/layout.tsx", "app/dashboard/analytics/page.tsx", "app/dashboard/tv-modes/page.tsx"]) {
    const texto = leer(rel);
    assert.match(texto, /return <ModuleLocked name="/, `${rel} ya no cae en ModuleLocked con la bandera apagada`);
    assert.match(texto, /<ModuloFueraDelPlan name="/, `${rel} no usa la pantalla nueva`);
  }
});

test("la pantalla nueva dice lo mismo que ModuleLocked y lleva a Planes", () => {
  const nuevo = leer("components/dashboard/marketplace-oculto/modulo-fuera-del-plan.tsx");
  const viejo = leer("components/dashboard/module-locked.tsx");
  for (const frase of ["no está en tu plan", "Mejora tu plan para desbloquear esta función.", "Ver planes"]) {
    assert.ok(viejo.includes(frase) && nuevo.includes(frase), `«${frase}» tiene que estar en las dos`);
  }
  assert.match(nuevo, /href=\{RUTA_PLANES\}/);
});

// ═══════════════════════════════════════════════════════════════════════════
// Lenguaje visual: ni letra de máquina, ni colores a mano, ni tokens propios
// ═══════════════════════════════════════════════════════════════════════════
// La palabra prohibida se arma en trozos para que un grep sobre la carpeta no
// se tope con este archivo.
const LETRA_DE_MAQUINA = new RegExp(["font-", "mono", "|", "ui-", "mono", "space", "|", "mono", "space"].join(""));

test("sin letra de máquina en la carpeta", () => {
  for (const a of archivosNuevos) {
    assert.ok(!LETRA_DE_MAQUINA.test(a.texto), `${a.nombre} usa letra de máquina`);
  }
  const css = archivosNuevos.find((a) => a.nombre === "modulo-fuera-del-plan.module.css")!.texto;
  assert.match(css, /font-variant-numeric:\s*tabular-nums/);
});

test("la hoja no declara tokens propios ni colores a mano: solo lee --m2-*", () => {
  const css = archivosNuevos.find((a) => a.nombre === "modulo-fuera-del-plan.module.css")!.texto;
  assert.deepEqual(css.match(/^\s*--[a-z0-9-]+\s*:/gim) ?? [], []);
  assert.deepEqual(css.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) ?? [], []);
  assert.match(css, /var\(--m2-/);
  const tsx = archivosNuevos.find((a) => a.nombre === "modulo-fuera-del-plan.tsx")!.texto;
  assert.match(tsx, /CLASES_MENU/, "la raíz monta CLASES_MENU (menu-dos-niveles/clases.ts)");
});
