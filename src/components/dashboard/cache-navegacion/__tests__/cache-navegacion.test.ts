/**
 * CANDADOS DE LA CACHÉ DE NAVEGACIÓN (ws1-t5).
 *
 * Run: npx tsx --test src/components/dashboard/cache-navegacion/__tests__/cache-navegacion.test.ts
 *
 * Dos clases de candado: la POLÍTICA (funciones puras) y el CABLEADO, que se
 * prueba leyendo el código fuente, como `hoy-rediseno/__tests__/`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  PLAZO_NEXT_MS,
  RUTAS_TOLERANTES,
  VIDA_FOTO_MS,
  debeRevalidar,
  fotoVigente,
  reglaDe,
} from "../politica";

const RAIZ = join(__dirname, "..", "..", "..", "..", "..");      // raíz del repo
const SRC = join(RAIZ, "src");
const CARPETA = join(SRC, "components", "dashboard", "cache-navegacion");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const archivosNuevos = readdirSync(CARPETA)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => ({ nombre: f, texto: readFileSync(join(CARPETA, f), "utf8") }));

// ═══════════════════════════════════════════════════════════════════════════
// 🔴 EL LÍMITE: la Agenda y Caja NO pueden ganar ni un segundo de caché
// ═══════════════════════════════════════════════════════════════════════════
test("la lista de rutas tolerantes es exactamente Hoy y Analítica", () => {
  assert.deepEqual(Object.keys(RUTAS_TOLERANTES).sort(), ["/dashboard", "/dashboard/analytics"]);
});

test("ninguna pantalla donde un dato viejo hace daño entra en la política", () => {
  for (const ruta of [
    "/dashboard/agenda",
    "/dashboard/appointments",
    "/dashboard/caja",
    "/dashboard/billing",
    "/dashboard/finanzas",
    "/dashboard/patients",
    "/dashboard/inbox",
    "/dashboard/agenda/",
    "/dashboard/analytics/waiting-room",
    "toString",
    "__proto__",
    "",
  ]) {
    assert.equal(reglaDe(ruta), null, `${ruta} no puede tener regla`);
  }
  assert.equal(reglaDe(null), null);
});

test("Hoy se refresca por detrás al volver; Analítica no", () => {
  assert.equal(RUTAS_TOLERANTES["/dashboard"].revalidarAlVolver, true);
  assert.equal(RUTAS_TOLERANTES["/dashboard/analytics"].revalidarAlVolver, false);
});

test("next.config.mjs sigue sin tocar el plazo global de la caché de router", () => {
  const config = readFileSync(join(RAIZ, "next.config.mjs"), "utf8");
  assert.doesNotMatch(config, /staleTimes/, "staleTimes es global: alcanzaría a la Agenda y a Caja");
});

// ═══════════════════════════════════════════════════════════════════════════
// La política, caso por caso
// ═══════════════════════════════════════════════════════════════════════════
test("debeRevalidar: solo Hoy, solo la URL limpia, solo con foto viva de más de 30 s", () => {
  const t0 = 1_000_000;
  // dentro de los 30 s que Next ya daba por buenos: como hoy, sin petición
  assert.equal(debeRevalidar("/dashboard", "", t0, t0 + PLAZO_NEXT_MS - 1), false);
  // pasados los 30 s: se pinta la foto y se refresca por detrás
  assert.equal(debeRevalidar("/dashboard", "", t0, t0 + PLAZO_NEXT_MS), true);
  assert.equal(debeRevalidar("/dashboard", "", t0, t0 + VIDA_FOTO_MS - 1), true);
  // foto expirada: Next ya hizo su petición normal, no se duplica
  assert.equal(debeRevalidar("/dashboard", "", t0, t0 + VIDA_FOTO_MS), false);
  // sin foto: navegación normal
  assert.equal(debeRevalidar("/dashboard", "", undefined, t0), false);
  // con parámetros la foto no aplica (es de la URL limpia)
  assert.equal(debeRevalidar("/dashboard", "?period=year", t0, t0 + 60_000), false);
  // Analítica nunca; la Agenda, menos
  assert.equal(debeRevalidar("/dashboard/analytics", "", t0, t0 + 60_000), false);
  assert.equal(debeRevalidar("/dashboard/agenda", "", t0, t0 + 60_000), false);
});

test("fotoVigente: 5 min exactos, que es lo que vive una entrada «full» en Next 14.2", () => {
  assert.equal(VIDA_FOTO_MS, 300_000);
  assert.equal(PLAZO_NEXT_MS, 30_000);
  assert.equal(fotoVigente(undefined, 5), false);
  assert.equal(fotoVigente(0, VIDA_FOTO_MS - 1), true);
  assert.equal(fotoVigente(0, VIDA_FOTO_MS), false);
});

// ═══════════════════════════════════════════════════════════════════════════
// Cableado: solo con el interruptor, y la rama apagada intacta
// ═══════════════════════════════════════════════════════════════════════════
test("el layout monta CacheNavegacion SOLO en la rama encendida", () => {
  const layout = leer("app/dashboard/layout.tsx");
  assert.equal((layout.match(/<CacheNavegacion\b/g) ?? []).length, 1, "una sola instancia");
  assert.match(layout, /\{menuDosNiveles && <CacheNavegacion \/>\}/, "colgado del interruptor: apagado no se monta");
});

test("el componente no pinta nada y pide la foto como prefetch FULL", () => {
  const c = archivosNuevos.find((a) => a.nombre === "cache-navegacion.tsx")!.texto;
  assert.match(c, /^"use client";/);
  assert.match(c, /return null;/);
  assert.match(c, /router\.prefetch\(vengoDe, \{ kind: PrefetchKind\.FULL \}\)/);
  assert.doesNotMatch(c, /className|style=/, "no tiene cara: no necesita ropa");
});

// ═══════════════════════════════════════════════════════════════════════════
// Lenguaje visual: ni letra de máquina ni colores a mano en la carpeta nueva
// ═══════════════════════════════════════════════════════════════════════════
// La palabra prohibida se arma en trozos para que un grep sobre la carpeta no
// se tope con este archivo.
const LETRA_DE_MAQUINA = new RegExp(["font-", "mono", "|", "ui-", "mono", "space", "|", "mono", "space"].join(""));
const COLOR_A_MANO = new RegExp(["#", "[0-9a-f]{6}", "\\b"].join(""), "i");

test("sin letra de máquina ni colores escritos a mano en la carpeta", () => {
  for (const a of archivosNuevos) {
    assert.ok(!LETRA_DE_MAQUINA.test(a.texto), `${a.nombre} usa letra de máquina`);
    assert.ok(!COLOR_A_MANO.test(a.texto), `${a.nombre} escribe un color a mano`);
  }
});
