/**
 * Dashboard de /admin (1-oct-2026): la tarjeta azul pasa de «Clínicas cerca de un
 * tope» a «Clínicas en línea», y «cerca de un tope» baja DENTRO del recuadro
 * «Este mes» (no se pierde).
 *
 * Run: node --import tsx --test src/components/admin/portada/__tests__/tarjeta-en-linea.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import "./_react-global";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PortadaVista, type DatosPortada } from "../portada-vista";
import { EMPTY_MRR } from "@/lib/admin/mrr-core";
import type { ConteosTiles } from "../pendientes";

const TILES: ConteosTiles = {
  porVerificar: { pagos: 0, clinicas: 0, monto: 0 },
  cobrosRotos: 0,
  renovaciones: 0,
  cercaDelTope: 7,
};

function datos(extra: Partial<DatosPortada> = {}): DatosPortada {
  return {
    fechaStr: "jueves 1 de octubre",
    tiles: TILES,
    series: { semana: [], mes: [], anio: [] },
    sparks: { meses: 6, altas: [0], bajas: [0], cfdi: [0], pagos: [0], cfdiMedido: true },
    facturacion: { hoy: 0, mes: 0, anio: 0, porCobrar: 0, fallidos: 0, medido: true },
    negocio: {
      mrr: EMPTY_MRR, mrrPotencial: 0, activas: 1, enTrial: 0, vencidas: 0, total: 1, dePrueba: 0,
      archivadas: 0, altasMes: 0, altasMesAnterior: 0, bajasMes: 0, cancelacionesPedidas: 0,
    },
    pendientes: [],
    clinicasConPendiente: 0,
    reales: 1,
    ultimosPagos: [],
    trabajando: [],
    enLinea: 0,
    avisos: [],
    ...extra,
  };
}

const pinta = (d: DatosPortada) => renderToStaticMarkup(createElement(PortadaVista, { datos: d, now: new Date("2026-10-01T18:00:00Z") }));
/** El bloque de las cuatro tarjetas de color (hasta donde empieza la gráfica). */
const tiles = (html: string) => html.slice(html.indexOf('class="dcp-tiles"'), html.indexOf("Ingresos y altas"));
/** El recuadro «Este mes» (hasta «Requiere tu atención»). */
const esteMes = (html: string) => html.slice(html.indexOf(">Este mes<"), html.indexOf("Requiere tu atención"));

test("la cuarta tarjeta es «Clínicas en línea» con el número", () => {
  const html = pinta(datos({ enLineaAhora: { disponible: true, clinicas: 3, ahora: 1 } }));
  const t = tiles(html);
  assert.ok(t.includes("Clínicas en línea"));
  assert.match(t, /data-en-linea[^>]*>.*?dcp-tile__n[^>]*>3</s);
  assert.ok(t.includes("dcp-tile--info"), "sigue siendo la azul");
  assert.ok(/<button[^>]*data-en-linea/.test(t), "es un botón: al clic abre la lista");
});

test("«Clínicas cerca de un tope» ya no es una tarjeta de color", () => {
  const t = tiles(pinta(datos({ enLineaAhora: { disponible: true, clinicas: 3, ahora: 1 } })));
  assert.ok(!t.includes("cerca de un tope"));
});

test("«Clínicas cerca de un tope» vive dentro de «Este mes», con su número, y lleva a Clínicas", () => {
  const m = esteMes(pinta(datos({ enLineaAhora: { disponible: true, clinicas: 3, ahora: 1 } })));
  assert.ok(m.includes("Clínicas cerca de un tope"));
  assert.match(m, /data-cerca-del-tope[^>]*>7</);
  assert.ok(m.includes('href="/admin/clinics"'));
  assert.ok(m.includes("Altas") && m.includes("Bajas"), "Altas y Bajas siguen ahí");
});

test("sin dato de presencia (sin Redis, o dato ausente) la tarjeta dice «sin dato», no 0", () => {
  for (const enLineaAhora of [{ disponible: false, clinicas: null, ahora: 1 }, undefined]) {
    const t = tiles(pinta(datos({ enLineaAhora })));
    assert.ok(t.includes("sin dato"));
    assert.match(t, /dcp-tile__n[^>]*>—</);
    assert.ok(t.includes("dcp-tile--quieto"));
  }
});

test("con 0 clínicas en línea y dato válido se pinta 0 (no «sin dato»)", () => {
  const t = tiles(pinta(datos({ enLineaAhora: { disponible: true, clinicas: 0, ahora: 1 } })));
  assert.match(t, /dcp-tile__n[^>]*>0</);
  assert.ok(!t.includes("sin dato"));
});

test("las otras tres tarjetas de color siguen igual", () => {
  const t = tiles(pinta(datos({ enLineaAhora: { disponible: true, clinicas: 1, ahora: 1 } })));
  for (const s of ["Pagos por verificar", "Cobros fallidos o usando sin plan", "Renovaciones manuales en 7 días"]) {
    assert.ok(t.includes(s), s);
  }
});
