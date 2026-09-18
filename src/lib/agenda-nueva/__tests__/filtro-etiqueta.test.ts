/**
 * Candados del botón del filtro de doctores y unidades y del texto «Buscar
 * espacio» de la barra de la agenda nueva (ws1-t3).
 *
 * Run: npm run test:agenda-nueva-filtro
 *
 * Rafael: «Buscar hueco cámbialo por Buscar espacio, y donde dice todos los
 * doctores y unidades borra la letra y solo deja el icono de filtrar». Lo que
 * se fija: sin filtro no hay letra visible pero SÍ nombre accesible (Ley 3:
 * nada se esconde); con filtro se ve qué está marcado; y «Buscar hueco» no
 * vuelve a aparecer en la agenda nueva.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { textoDelFiltro } from "@/lib/agenda-nueva/filtro-etiqueta";

const SRC = join(__dirname, "..", "..", "..");
const CARPETA = join(SRC, "components", "dashboard", "agenda-nueva");

const BASE = {
  hayUnidades: true,
  todoMarcado: true,
  nDocs: 3,
  nombreUnico: null,
  nUnidades: 2,
  nUnidadesTotal: 2,
};

test("sin filtro: solo el ícono, pero el nombre accesible dice qué filtra", () => {
  const t = textoDelFiltro(BASE);
  assert.equal(t.visible, null, "sin filtro no puede haber letra visible");
  assert.equal(t.accesible, "Filtrar doctores y unidades: todos");
  assert.ok(!/todos los doctores/i.test(t.accesible), "la etiqueta vieja no vuelve ni al lector de pantalla");
});

test("sin unidades en la clínica, el nombre no las menciona", () => {
  const t = textoDelFiltro({ ...BASE, hayUnidades: false, nUnidades: 0, nUnidadesTotal: 0 });
  assert.equal(t.visible, null);
  assert.equal(t.accesible, "Filtrar doctores: todos");
});

test("con un solo doctor marcado se ve su nombre", () => {
  const t = textoDelFiltro({ ...BASE, todoMarcado: false, nDocs: 1, nombreUnico: "Dra. Díaz" });
  assert.equal(t.visible, "Dra. Díaz");
  assert.equal(t.accesible, "Filtrar doctores y unidades: Dra. Díaz");
});

test("con doctores y unidades filtrados se ven las dos partes", () => {
  const t = textoDelFiltro({ ...BASE, todoMarcado: false, nDocs: 2, nUnidades: 1 });
  assert.equal(t.visible, "2 doctores · 1 unidad");
  const u = textoDelFiltro({ ...BASE, todoMarcado: false, nDocs: 0, nUnidades: 0 });
  assert.equal(u.visible, "Ningún doctor · ninguna unidad");
});

test("con las unidades todas marcadas solo se nombra a los doctores", () => {
  const t = textoDelFiltro({ ...BASE, todoMarcado: false, nDocs: 2 });
  assert.equal(t.visible, "2 doctores");
});

test("el botón del filtro usa el nombre accesible y no pinta la etiqueta vieja", () => {
  const fuente = readFileSync(join(CARPETA, "filtro-doctores-unidades.tsx"), "utf8");
  assert.ok(!/Todos los doctores/.test(fuente), "«Todos los doctores…» sigue escrito en el botón");
  assert.match(fuente, /aria-label=\{texto\.accesible\}/, "el botón perdió su aria-label");
  assert.match(fuente, /title=\{texto\.accesible\}/, "el botón perdió su title");
  assert.match(fuente, /filtroBotonSoloIcono/, "sin filtro el botón tiene que ser solo ícono");
  const css = readFileSync(join(CARPETA, "agenda-nueva.module.css"), "utf8");
  assert.match(css, /\.filtroBotonSoloIcono \{/, "falta la clase de solo ícono en el CSS");
});

test("«Buscar hueco» ya no aparece en la agenda nueva: ahora es «Buscar espacio»", () => {
  const archivos = readdirSync(CARPETA).filter((f) => /\.(tsx?|css)$/.test(f));
  for (const f of archivos) {
    const texto = readFileSync(join(CARPETA, f), "utf8");
    assert.ok(!/Buscar hueco/.test(texto), `${f} todavía dice «Buscar hueco»`);
  }
  const barra = readFileSync(join(CARPETA, "barra-herramientas.tsx"), "utf8");
  assert.match(barra, /aria-label="Buscar espacio"/);
  assert.match(barra, />Buscar espacio</);
  const panel = readFileSync(join(CARPETA, "panel-huecos.tsx"), "utf8");
  assert.match(panel, /aria-label="Buscar espacio"/);
  assert.match(panel, />Buscar espacio</);
});
