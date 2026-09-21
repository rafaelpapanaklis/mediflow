/**
 * El texto de la ventana «en vivo» sale del VALOR, nunca de una cadena a mano.
 *
 * Run: npm run test:ventana-en-vivo
 *
 * ── El caso ─────────────────────────────────────────────────────────────────
 * El KPI «En vivo» de /admin/analytics decía `sub="últimos 5 min"` escrito a
 * mano. Nunca fue verdad: con `LIVE_WINDOW_MS = 75 s` mentía por exceso, y al
 * subirlo a 150 s siguió mintiendo (son 2,5 min). La pestaña «En vivo» sí leía
 * `data?.windowSeconds`, pero su respaldo estaba clavado en `75`, así que
 * mentía justo cuando la API no contestaba — que es cuando más se mira.
 *
 * Por eso aquí hay dos mitades: la REGLA de formato, y el CABLEADO (que los
 * dos componentes la usen y no quede ninguna cifra escrita a mano).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LIVE_WINDOW_MS } from "@/lib/analytics/constants";
import {
  VENTANA_EN_VIVO_S,
  duracionVentana,
  rotuloVentanaEnVivo,
  fraseVentanaEnVivo,
} from "../ventana-en-vivo";

// ── 1. La regla ────────────────────────────────────────────────────────────

test("la ventana sale de LIVE_WINDOW_MS y de ningún otro sitio", () => {
  assert.equal(VENTANA_EN_VIVO_S, Math.round(LIVE_WINDOW_MS / 1000));
  assert.equal(VENTANA_EN_VIVO_S, 150, "hoy son 150 s; si esto cambia, el texto cambia solo");
});

test("hoy el rótulo dice 2,5 min, que es lo que de verdad mide", () => {
  assert.equal(rotuloVentanaEnVivo(), "últimos 2,5 min");
  assert.equal(fraseVentanaEnVivo(), "Activos en los últimos 2,5 min");
});

test("coma decimal y sin el «,0» cuando la cifra es entera", () => {
  assert.equal(duracionVentana(150), "2,5 min");
  assert.equal(duracionVentana(300), "5 min");
  assert.equal(duracionVentana(120), "2 min");
  assert.equal(duracionVentana(90), "1,5 min");
});

test("por debajo del minuto y medio se dicen segundos", () => {
  // «75 s» se lee mejor que «1,3 min», y era el valor anterior de la ventana.
  assert.equal(duracionVentana(75), "75 s");
  assert.equal(duracionVentana(45), "45 s");
  assert.equal(duracionVentana(89), "89 s");
});

test("un valor imposible no imprime NaN en el panel", () => {
  for (const malo of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(duracionVentana(malo), "0 s", String(malo));
  }
});

test("si mañana se mueve la ventana, el texto se mueve con ella", () => {
  // La razón de ser del módulo: nadie tiene que acordarse de editar un string.
  assert.equal(rotuloVentanaEnVivo(600), "últimos 10 min");
  assert.equal(rotuloVentanaEnVivo(30), "últimos 30 s");
});

// ── 2. El cableado ─────────────────────────────────────────────────────────

const AQUI = join(__dirname, "..");
const OVERVIEW = readFileSync(join(AQUI, "overview-tab.tsx"), "utf8");
const LIVE = readFileSync(join(AQUI, "live-tab.tsx"), "utf8");
/** Sin comentarios: los dos archivos citan el «5 min» viejo al explicarse. */
const soloCodigo = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

test("el KPI «En vivo» deriva su rótulo, no lo escribe", () => {
  assert.match(OVERVIEW, /rotuloVentanaEnVivo\(\)/);
  assert.equal(/últimos 5 min/.test(soloCodigo(OVERVIEW)), false, "vuelve a haber un «5 min» a mano");
  assert.equal(/"últimos [\d,.]+ ?(min|s)"/.test(soloCodigo(OVERVIEW)), false, "cualquier ventana a mano");
});

test("la pestaña «En vivo» ya no tiene un 75 clavado de respaldo", () => {
  assert.match(LIVE, /fraseVentanaEnVivo\(data\?\.windowSeconds \?\? VENTANA_EN_VIVO_S\)/);
  assert.equal(/windowSeconds \?\? \d+/.test(soloCodigo(LIVE)), false, "el respaldo vuelve a ser un número");
});

test("ninguno de los dos se inventa su propia ventana", () => {
  for (const [nombre, texto] of [["overview", OVERVIEW], ["live", LIVE]] as const) {
    assert.match(texto, /from "\.\/ventana-en-vivo"/, `${nombre} no importa el módulo`);
    assert.equal(
      /LIVE_WINDOW_MS\s*\/\s*\d/.test(soloCodigo(texto)),
      false,
      `${nombre} vuelve a hacer su propia cuenta de la ventana`,
    );
  }
});
