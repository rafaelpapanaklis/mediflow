// Prueba de la hoja que despliega la página dentro del iframe del visor de heatmap.
// Sin navegador: el inyector sólo usa getElementById / createElement / head.appendChild,
// así que una cabecera de mentira basta. Lo que de verdad protege esta prueba es el
// ACOPLE con el armazón: si el layout del panel deja de llevar las clases por las que
// va el selector, el arreglo se apaga en silencio y la página vuelve a salir cortada.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CSS_DESPLIEGUE,
  ID_ESTILO_DESPLIEGUE,
  desplegarDocumento,
  type CabezaInyectable,
} from "../iframe-desplegar";

/** Documento de mentira con lo mínimo que toca el inyector. */
function documentoFalso(opciones: { conCabeza?: boolean } = {}) {
  const conCabeza = opciones.conCabeza !== false;
  const puestos: { id: string; textContent: string | null }[] = [];
  const doc = {
    getElementById: (id: string) => puestos.find((e) => e.id === id) ?? null,
    createElement: (_tag: "style") => ({ id: "", textContent: null as string | null }),
    head: conCabeza
      ? {
          appendChild: (nodo: unknown) => {
            puestos.push(nodo as { id: string; textContent: string | null });
            return nodo;
          },
        }
      : null,
  };
  return { doc: doc as CabezaInyectable, puestos };
}

test("inyecta la hoja una sola vez, aunque se mida muchas veces", () => {
  const { doc, puestos } = documentoFalso();
  assert.equal(desplegarDocumento(doc), "inyectado");
  assert.equal(puestos.length, 1);
  assert.equal(puestos[0].id, ID_ESTILO_DESPLIEGUE);
  assert.equal(puestos[0].textContent, CSS_DESPLIEGUE);

  // El escenario llama a medir desde el `load`, desde los reintentos y desde el
  // ResizeObserver: no puede acumular un <style> por llamada.
  for (let i = 0; i < 20; i++) assert.equal(desplegarDocumento(doc), "ya-estaba");
  assert.equal(puestos.length, 1);
});

test("sin <head> no revienta: lo dice y no inyecta nada", () => {
  const { doc, puestos } = documentoFalso({ conCabeza: false });
  assert.equal(desplegarDocumento(doc), "sin-cabeza");
  assert.equal(puestos.length, 0);
});

test("la hoja quita el techo de 100vh y la barra de scroll interna del armazón", () => {
  // La firma de la columna de trabajo, con los `:` de Tailwind escapados.
  assert.ok(CSS_DESPLIEGUE.includes(".flex-1.lg\\:max-h-screen.lg\\:overflow-y-auto"));
  assert.ok(CSS_DESPLIEGUE.includes("max-height: none !important"));
  assert.ok(CSS_DESPLIEGUE.includes("overflow: visible !important"));
  // El documento también tiene que poder crecer.
  assert.ok(/html,\s*body\s*\{/.test(CSS_DESPLIEGUE));
});

test("suelta también el 100vh de las dos columnas del armazón", () => {
  // Sin esto el alto se muerde la cola: el iframe adopta el alto medido, el
  // armazón crece HASTA ese alto (min-height:100vh en la columna, height:100vh
  // en la barra lateral) y la medida siguiente sale más alta, sin tope. Medido
  // en Chromium sobre una maqueta del armazón real: +30 px por vuelta.
  assert.ok(CSS_DESPLIEGUE.includes(".dashboard-shell > *"));
  assert.ok(CSS_DESPLIEGUE.includes("height: auto !important"));
  assert.ok(CSS_DESPLIEGUE.includes("min-height: 0 !important"));
});

test("no es un comodín: todo selector va anclado a un ancestro concreto", () => {
  // Un `* { height:auto }` desmonta la maquetación que se está midiendo, que es
  // justo lo que rompe la alineación de los puntos. Un `*` sólo vale detrás de
  // un ancestro (`.dashboard-shell > *`), nunca suelto.
  const sinComentarios = CSS_DESPLIEGUE.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectores = sinComentarios
    .split("}")
    .map((bloque) => bloque.split("{")[0])
    .filter((sel) => sel.trim())
    .flatMap((sel) => sel.split(","))
    .map((sel) => sel.trim())
    .filter(Boolean);
  assert.ok(selectores.length >= 4);
  for (const sel of selectores) {
    assert.notEqual(sel, "*", "hay un selector comodín suelto");
    const anclado = sel.startsWith(".") || sel === "html" || sel === "body";
    assert.ok(anclado, `selector sin anclar: ${sel}`);
  }
});

test("la hoja no pinta nada: ni un hex, ni un color (vale en claro y en oscuro)", () => {
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(CSS_DESPLIEGUE));
  for (const prop of ["color", "background", "border", "font"]) {
    assert.ok(!new RegExp(`(^|[\\s;{])${prop}\\s*:`).test(CSS_DESPLIEGUE), prop);
  }
});

test("el armazón sigue llevando las clases por las que va el selector", () => {
  // Si esto falla, el layout cambió de clases y el selector dejó de enganchar:
  // hay que actualizar iframe-desplegar.ts, no borrar la prueba.
  const layout = readFileSync("src/app/dashboard/layout.tsx", "utf8");
  const columna = layout
    .split("\n")
    .find((l) => l.includes("lg:max-h-screen") && l.includes("lg:overflow-y-auto"));
  assert.ok(columna, "la columna de trabajo del panel ya no lleva lg:max-h-screen + lg:overflow-y-auto");
  assert.ok(columna.includes("flex-1"), "la columna de trabajo ya no lleva flex-1");
});
