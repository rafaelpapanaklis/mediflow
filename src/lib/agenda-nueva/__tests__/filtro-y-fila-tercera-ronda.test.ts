// ws1-t1 (tercera ronda) — N-45 (filtro de doctores sin «solo este», «2 doctores 22», Mes con renglones cortados) y
// N-46 (Fila de espera sin miga y con dos «Agregar»; en Hoy el «vacío» dos veces y dos «Agregar»).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("🔴→🟢 N-45: «Solo» deja a la vista a un doctor; el número del botón es lo que se ve, no los desmarcados", () => {
  const filtro = leer("components/dashboard/agenda-nueva/filtro-doctores-unidades.tsx");
  assert.match(filtro, /onClick=\{\(\) => ag\.soloDoctor\(r\.id\)\}/);
  assert.match(filtro, /\{!ag\.todoMarcado && <span className=\{s\.filtroContador\}>\{ag\.docsVisibles\.size\}<\/span>\}/);
  const ctx = leer("components/dashboard/agenda-nueva/contexto-agenda-nueva.tsx");
  assert.match(ctx, /setDocsOcultos\(new Set\(responsablesTodos\.filter\(\(r\) => r\.id !== id\)\.map\(\(r\) => r\.id\)\)\)/);
  const css = leer("components/dashboard/agenda-nueva/agenda-nueva.module.css");
  assert.match(css, /\.filtroContador \{\s*\/\*[^*]*\*\/\s*display: none !important;/);
  assert.match(leer("components/dashboard/agenda-nueva/vista-mes.tsx"), /const ALTO_MINIMO_FILA_MES = 120;/);
});

test("🔴→🟢 N-46: la Fila de espera y Mensajes tienen miga, y no hay dos «Agregar»", () => {
  const topbar = leer("components/dashboard/topbar.tsx");
  assert.match(topbar, /"\/dashboard\/walk-in":\s+"pages\.walkIn\.title",/);
  assert.match(topbar, /"\/dashboard\/inbox":\s+"sidebar\.nav\.inbox",/);
  const fila = leer("components/dashboard/piezas-rediseno/fila-espera.tsx");
  assert.ok(!/onClick=\{\(\) => nombreRef\.current\?\.focus\(\)\}/.test(fila), "sin el botón de cabecera que solo enfocaba el formulario");
  const hoy = leer("components/dashboard/hoy-rediseno/hoy-recepcion.tsx");
  assert.match(hoy, /sub=\{data\.waitlist\.length === 0 \? undefined :/);
  assert.match(hoy, /\{puedeAgregarEspera && data\.waitlist\.length > 0 && \(/);
});
