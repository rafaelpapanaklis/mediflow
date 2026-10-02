/**
 * ws1-t2 (ticket BEVADENT 3, 9a) — una línea de ayuda bajo «Marcar llegada», «Pasar al sillón» y
 * «Pasar a consulta».
 *
 * Run: npx tsx --test src/lib/agenda/__tests__/ayuda-de-pasos.test.ts
 *
 * Dos cosas: que los textos existan en es/en y solo para esos tres pasos, y que las cuatro pantallas
 * que pintan esos botones (Agenda nueva, Agenda de siempre y las dos Hoy) los pidan de aquí.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ayudaDelPaso } from "../ayuda-de-pasos";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("los tres pasos que se confunden llevan ayuda, en español", () => {
  assert.equal(ayudaDelPaso("CHECKED_IN", "es"), "El paciente llegó y espera");
  assert.equal(ayudaDelPaso("IN_CHAIR", "es"), "Ya está en el sillón");
  assert.equal(ayudaDelPaso("IN_PROGRESS", "es"), "Empezar la atención y abrir su expediente");
});

test("y en inglés, distinta de la española", () => {
  for (const paso of ["CHECKED_IN", "IN_CHAIR", "IN_PROGRESS"]) {
    const en = ayudaDelPaso(paso, "en");
    assert.ok(en && en.length > 0, `falta la ayuda en inglés de ${paso}`);
    assert.notEqual(en, ayudaDelPaso(paso, "es"), `sin traducir: ${paso}`);
  }
  assert.equal(ayudaDelPaso("CHECKED_IN", undefined), ayudaDelPaso("CHECKED_IN", "es"));
});

test("los demás pasos no llevan ayuda (no se inventa una línea donde no se pidió)", () => {
  for (const paso of ["CONFIRMED", "COMPLETED", "CHECKED_OUT", "SCHEDULED", "CANCELLED", "NO_SHOW", "", null, undefined]) {
    assert.equal(ayudaDelPaso(paso, "es"), null, `no debería llevar ayuda: ${paso}`);
  }
});

test("las cuatro pantallas con esos botones usan la misma ayuda", () => {
  const panelNuevo = leer("components/dashboard/agenda-nueva/panel-cita.tsx");
  assert.match(panelNuevo, /useAyudaDelPaso/);
  // El paso principal Y los secundarios: «Pasar al sillón» es secundario para un doctor.
  assert.match(panelNuevo, /ayudaDelPaso\(principal\.destino\)/, "el paso principal no pide su ayuda");
  assert.match(panelNuevo, /ayudaDelPaso\(a\.destino\)/, "los pasos secundarios no piden su ayuda");
  assert.match(panelNuevo, /aria-describedby/, "la ayuda no está ligada al botón");

  const agendaVieja = leer("components/dashboard/agenda/agenda-detail-panel.tsx");
  assert.match(agendaVieja, /ayudaDelPaso\(target\)/, "la agenda de siempre no pide la ayuda");

  const hoyNuevo = leer("components/dashboard/hoy-rediseno/fila-cita.tsx");
  assert.match(hoyNuevo, /ayudaDelPaso\("CHECKED_IN"\)/, "Hoy (rediseño) no pide la ayuda de «Check-in»");
  const hoyViejo = leer("components/dashboard/home/parts/today-appointment-row.tsx");
  assert.match(hoyViejo, /ayudaDelPaso\("CHECKED_IN"\)/, "Hoy no pide la ayuda de «Check-in»");
});

test("ni colores a mano ni px de más: la línea usa tokens", () => {
  const css = leer("components/dashboard/agenda-nueva/agenda-nueva.module.css");
  const bloque = css.slice(css.indexOf(".ayudaPaso {"), css.indexOf(".pasoConAyuda .accionSecundaria"));
  assert.ok(bloque.length > 0, "no está el bloque .ayudaPaso");
  assert.doesNotMatch(bloque, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, "color a mano en la ayuda");
  const vieja = readFileSync(join(SRC, "components/dashboard/agenda/agenda.module.css"), "utf8");
  const bloqueViejo = vieja.slice(vieja.indexOf(".detailActionConAyuda {"), vieja.indexOf(".detailActionAyuda {") + 140);
  assert.doesNotMatch(bloqueViejo, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, "color a mano en la ayuda (agenda de siempre)");
});

// Revisión ws1-t9 (fallo 4), a 1440×900 con un doctor: «Pasar a consulta» se partía en dos
// renglones con su ayuda al borde, y el botón flotante de Sabina tapaba «Pedir anticipo» y
// «Siguiente con…». Fallan con el código viejo: la fila no bajaba de renglón y el pie no
// dejaba la esquina libre.
const reglaDe = (css: string, selector: string) => {
  const i = css.indexOf(`${selector} {`);
  return i < 0 ? "" : css.slice(i, css.indexOf("}", i));
};

test("pie del panel de la cita: los pasos bajan de renglón sin partir su texto", () => {
  const css = leer("components/dashboard/agenda-nueva/agenda-nueva.module.css");
  assert.match(reglaDe(css, ".accionesSecundarias"), /flex-wrap:\s*wrap/);
  const boton = reglaDe(css, ".panelPie .accionesSecundarias > .accionSecundaria");
  assert.match(boton, /white-space:\s*nowrap/);
  assert.match(boton, /flex:\s*1 0 auto/, "crece, pero no se encoge por debajo de su texto");
  // El paso con ayuda va en su propio renglón, a lo ancho.
  assert.match(reglaDe(css, ".pasoConAyuda"), /flex:\s*1 1 100%/);
  // Los diálogos que comparten `.accionSecundaria` no cambian.
  assert.doesNotMatch(reglaDe(css, ".accionSecundaria"), /nowrap|1 0 auto/);
});

test("pie del panel de la cita: la esquina del botón de Sabina queda libre", () => {
  const css = leer("components/dashboard/agenda-nueva/agenda-nueva.module.css");
  const i = css.indexOf(".panelPie .accionesSecundarias,\n.panelPie .siguienteEnUnidad {");
  assert.ok(i > 0, "falta la reserva de la esquina");
  const reserva = Number(/margin-right:\s*(\d+)px/.exec(css.slice(i, css.indexOf("}", i)))?.[1]);
  // El botón: 52 px a 20 px de la derecha (48 a 16 en móvil); el pie ya tiene 20 px de margen.
  const sabina = readFileSync(join(SRC, "components/dashboard/layout-rediseno/cajon-sabina.module.css"), "utf8");
  const fab = reglaDe(sabina, ".fab");
  const ancho = Number(/width:\s*(\d+)px/.exec(fab)?.[1]);
  const derecha = Number(/right:\s*(\d+)px/.exec(fab)?.[1]);
  assert.ok(ancho > 0 && derecha > 0, "no se leyó el botón de Sabina");
  assert.ok(reserva >= ancho + derecha - 20, `reserva ${reserva}px < ${ancho + derecha - 20}px`);
  // Y el botón sigue en la esquina de abajo (si sube, esta reserva ya no sirve).
  const panelSabina = readFileSync(join(SRC, "components/dashboard/sabina/panel.tsx"), "utf8");
  assert.match(panelSabina, /const ALTURA_FAB = HIDE_SUPPLY_MODULES \? 24 : 92;/);
  assert.match(readFileSync(join(SRC, "lib/hidden-modules.ts"), "utf8"), /export const HIDE_SUPPLY_MODULES = true;/);
});
