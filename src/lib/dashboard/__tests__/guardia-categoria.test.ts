/**
 * WS1-T4 ronda 6 · G7 — guardia de categoría de las páginas del panel.
 *
 * Run: npx tsx --test src/lib/dashboard/__tests__/guardia-categoria.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { NAV_ITEMS } from "@/components/dashboard/sidebar-nav";
import {
  categoriasDeLaRuta,
  destinoSiNoPermitida,
  normalizarRuta,
  paginaPermitidaParaCategoria,
} from "../guardia-categoria";

const PROTEGIDAS = ["/dashboard/exercises", "/dashboard/orthotics", "/dashboard/formulas", "/dashboard/packages"];

test("una clínica DENTAL no entra a Ejercicios, Ortesis, Fórmulas ni Paquetes", () => {
  for (const ruta of PROTEGIDAS) {
    assert.equal(paginaPermitidaParaCategoria(ruta, "DENTAL"), false, ruta);
  }
});

test("la categoría que SÍ las tiene en el menú sí entra", () => {
  assert.equal(paginaPermitidaParaCategoria("/dashboard/exercises", "PHYSIOTHERAPY"), true);
  assert.equal(paginaPermitidaParaCategoria("/dashboard/exercises", "PODIATRY"), true);
  assert.equal(paginaPermitidaParaCategoria("/dashboard/orthotics", "PODIATRY"), true);
  assert.equal(paginaPermitidaParaCategoria("/dashboard/formulas", "HAIR_SALON"), true);
  assert.equal(paginaPermitidaParaCategoria("/dashboard/formulas", "ALTERNATIVE_MEDICINE"), true);
  assert.equal(paginaPermitidaParaCategoria("/dashboard/packages", "SPA"), true);
  assert.equal(paginaPermitidaParaCategoria("/dashboard/packages", "LASER_HAIR_REMOVAL"), true);
});

test("fuente única: el guardia dice EXACTAMENTE lo que dice el menú, categoría por categoría", () => {
  const TODAS = [
    "DENTAL", "MEDICINE", "NUTRITION", "PSYCHOLOGY", "DERMATOLOGY", "AESTHETIC_MEDICINE",
    "HAIR_RESTORATION", "BEAUTY_CENTER", "BROW_LASH", "MASSAGE", "LASER_HAIR_REMOVAL", "HAIR_SALON",
    "ALTERNATIVE_MEDICINE", "NAIL_SALON", "SPA", "PHYSIOTHERAPY", "PODIATRY", "OTHER",
  ];
  for (const ruta of PROTEGIDAS) {
    const item = NAV_ITEMS.find((i) => i.href === ruta);
    assert.ok(item, `${ruta} ya no está en NAV_ITEMS`);
    assert.ok(item.categories && item.categories.length > 0, `${ruta} perdió sus categories en el menú`);
    assert.deepEqual(categoriasDeLaRuta(ruta), item.categories);
    for (const c of TODAS) {
      assert.equal(
        paginaPermitidaParaCategoria(ruta, c),
        (item.categories as string[]).includes(c),
        `${ruta} · ${c}`,
      );
    }
  }
});

test("«orthotics» (ortesis) y «orthodontics» (ortodoncia) no se confunden", () => {
  assert.equal(paginaPermitidaParaCategoria("/dashboard/orthotics", "DENTAL"), false);
  assert.equal(paginaPermitidaParaCategoria("/dashboard/orthodontics", "DENTAL"), true);
  assert.equal(paginaPermitidaParaCategoria("/dashboard/orthodontics/cobranza", "DENTAL"), true);
  assert.equal(paginaPermitidaParaCategoria("/dashboard/orthodontics/pacientes/abc", "DENTAL"), true);
});

test("subrutas, barra final y query siguen la regla de su página", () => {
  assert.equal(paginaPermitidaParaCategoria("/dashboard/packages/", "DENTAL"), false);
  assert.equal(paginaPermitidaParaCategoria("/dashboard/packages?tab=1", "DENTAL"), false);
  assert.equal(paginaPermitidaParaCategoria("/dashboard/packages/abc/edit", "DENTAL"), false);
  assert.equal(paginaPermitidaParaCategoria("/dashboard/packages/abc", "SPA"), true);
  assert.equal(normalizarRuta("/dashboard/packages/?x=1#y"), "/dashboard/packages");
  // Un prefijo de texto no es una subruta.
  assert.equal(paginaPermitidaParaCategoria("/dashboard/packages-otra-cosa", "DENTAL"), true);
});

test("sin categoría conocida, una página con condición NO abre (falla cerrado)", () => {
  for (const ruta of [...PROTEGIDAS, "/dashboard/resource-bookings"]) {
    assert.equal(paginaPermitidaParaCategoria(ruta, null), false, ruta);
    assert.equal(paginaPermitidaParaCategoria(ruta, undefined), false, ruta);
    assert.equal(paginaPermitidaParaCategoria(ruta, ""), false, ruta);
  }
});

test("«Reservas legacy» no está en el menú: cerrada para DENTAL, abierta para las demás", () => {
  assert.equal(NAV_ITEMS.some((i) => i.href === "/dashboard/resource-bookings"), false);
  assert.equal(paginaPermitidaParaCategoria("/dashboard/resource-bookings", "DENTAL"), false);
  assert.equal(paginaPermitidaParaCategoria("/dashboard/resource-bookings", "SPA"), true);
  assert.equal(paginaPermitidaParaCategoria("/dashboard/resource-bookings", "MEDICINE"), true);
  assert.equal(paginaPermitidaParaCategoria("/dashboard/resource-bookings", "OTHER"), true);
  assert.equal(destinoSiNoPermitida("/dashboard/resource-bookings"), "/dashboard/resources");
  // …y el destino SÍ le abre a una clínica dental.
  assert.equal(paginaPermitidaParaCategoria("/dashboard/resources", "DENTAL"), true);
});

test("las páginas de siempre de una clínica dental siguen abriendo", () => {
  for (const ruta of [
    "/dashboard", "/dashboard/agenda", "/dashboard/patients", "/dashboard/patients/abc",
    "/dashboard/billing", "/dashboard/inventory", "/dashboard/resources", "/dashboard/settings",
    "/dashboard/procedures", "/dashboard/ai-assistant", "/dashboard/una-que-no-existe",
  ]) {
    assert.equal(paginaPermitidaParaCategoria(ruta, "DENTAL"), true, ruta);
  }
});

test("destino por defecto: el inicio del panel, que abre a cualquiera", () => {
  for (const ruta of PROTEGIDAS) {
    assert.equal(destinoSiNoPermitida(ruta), "/dashboard");
  }
  assert.equal(paginaPermitidaParaCategoria("/dashboard", "DENTAL"), true);
  assert.equal(paginaPermitidaParaCategoria("/dashboard", null), true);
});

test("Teleconsulta: oculta en dental (va a la Agenda), abierta en las demás categorías", () => {
  assert.equal(paginaPermitidaParaCategoria("/dashboard/teleconsulta", "DENTAL"), false);
  assert.equal(paginaPermitidaParaCategoria("/dashboard/teleconsulta/", "DENTAL"), false);
  assert.equal(destinoSiNoPermitida("/dashboard/teleconsulta"), "/dashboard/agenda");
  assert.equal(paginaPermitidaParaCategoria("/dashboard/teleconsulta", "PSYCHOLOGY"), true);
  assert.equal(paginaPermitidaParaCategoria("/dashboard/teleconsulta", "MEDICINE"), true);
  assert.equal(paginaPermitidaParaCategoria("/dashboard/teleconsulta", null), false, "sin categoría falla cerrado");
});

test("«Antes/Después» sale en el menú de una clínica dental (decisión de Rafael, ws1-t4 ronda 6)", () => {
  const item = NAV_ITEMS.find((i) => i.id === "before-after");
  assert.ok(item?.categories?.includes("DENTAL"));
});
