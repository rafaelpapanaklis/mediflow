/**
 * Menú recogido al abrir la ficha de un paciente — candados (ws1-t4).
 *
 * Run: npm run test:menu-recogido-en-paciente
 *
 * Lo que fija:
 *  1. Qué es «la ficha»: /dashboard/patients/<id> y lo que cuelga de ahí. La
 *     lista de pacientes, las especialidades y radiografías NO lo son.
 *  2. La regla: en la ficha recogido; fuera, la preferencia de la persona.
 *  3. El hook, corrido con un React de juguete (solo useState/useCallback,
 *     que es lo único que usa): al entrar se recoge, al salir vuelve como
 *     estaba, desplegar a mano dentro no pisa la preferencia, y cambiar de
 *     paciente vuelve a recoger.
 *  4. El cableado: el menú de dos niveles enchufa el hook en la línea del
 *     estado `encogido`, y ese es el ÚNICO cambio en el archivo compartido
 *     (aparte del import).
 */
import Module from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { encogidoEfectivo, esFichaDePaciente, pacienteDeFicha } from "../recogido";

const RAIZ = join(__dirname, "..", "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

// ── 1. Qué es la ficha ───────────────────────────────────────────────

test("solo la ficha de Pacientes cuenta como ficha", () => {
  assert.equal(pacienteDeFicha("/dashboard/patients/abc-123"), "abc-123");
  assert.equal(pacienteDeFicha("/dashboard/patients/abc-123/"), "abc-123");
  assert.equal(pacienteDeFicha("/dashboard/patients/abc-123/orthodontics"), "abc-123", "las pantallas dentro de la ficha son la ficha");
  assert.equal(pacienteDeFicha("/dashboard/patients/abc-123?tab=citas"), "abc-123");
  assert.equal(pacienteDeFicha("/dashboard/patients"), null, "la lista no es la ficha");
  assert.equal(pacienteDeFicha("/dashboard/patients/"), null);
  assert.equal(pacienteDeFicha("/dashboard/patientsx/1"), null);
  assert.equal(pacienteDeFicha("/dashboard"), null);
  assert.equal(pacienteDeFicha("/dashboard/agenda"), null);
  assert.equal(pacienteDeFicha("/dashboard/specialties/orthodontics/abc-123"), null, "las especialidades no cambian");
  assert.equal(pacienteDeFicha("/dashboard/xrays/abc-123"), null, "radiografías no cambia");
  assert.equal(pacienteDeFicha(null), null);
  assert.equal(pacienteDeFicha(""), null);
  assert.equal(esFichaDePaciente("/dashboard/patients/abc-123"), true);
  assert.equal(esFichaDePaciente("/dashboard/patients"), false);
});

// ── 2. La regla ──────────────────────────────────────────────────────

test("fuera de la ficha manda la preferencia; dentro, recogido salvo que se haya elegido otra cosa en esa visita", () => {
  assert.equal(encogidoEfectivo(false, false, null), false);
  assert.equal(encogidoEfectivo(true, false, null), true);
  assert.equal(encogidoEfectivo(false, false, false), false, "fuera de la ficha la elección de la ficha no cuenta");
  assert.equal(encogidoEfectivo(false, true, null), true, "en la ficha, recogido");
  assert.equal(encogidoEfectivo(true, true, null), true);
  assert.equal(encogidoEfectivo(false, true, false), false, "desplegado a mano dentro de la ficha");
  assert.equal(encogidoEfectivo(true, true, false), false);
  assert.equal(encogidoEfectivo(false, true, true), true);
});

// ── 3. El hook, con un React de juguete ──────────────────────────────
// El hook solo usa useState y useCallback. Se le da un React mínimo con las
// mismas reglas que importan aquí: una celda por llamada en orden, un set que
// pide volver a pintar, y un set DURANTE el render que vuelve a pintar en el
// acto (así es como React trata «ajustar estado al cambiar una prop»).
type Hook = (base: [boolean, (v: boolean) => void], pathname: string | null) => [boolean, (v: boolean) => void];

function cargarHookConReactDeJuguete(): { hook: Hook; pintar: <T>(f: () => T) => T } {
  const celdas: unknown[] = [];
  let i = 0;
  let pendiente = false;
  const reactDeJuguete = {
    useState<T>(inicial: T | (() => T)) {
      const idx = i++;
      if (!(idx in celdas)) celdas[idx] = typeof inicial === "function" ? (inicial as () => T)() : inicial;
      const set = (v: T | ((p: T) => T)) => {
        celdas[idx] = typeof v === "function" ? (v as (p: T) => T)(celdas[idx] as T) : v;
        pendiente = true;
      };
      return [celdas[idx] as T, set] as const;
    },
    useCallback<F>(fn: F) { return fn; },
  };
  const M = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
  const original = M._load;
  M._load = function (request: string, parent: unknown, isMain: boolean) {
    if (request === "react") return reactDeJuguete;
    return original.call(this, request, parent, isMain);
  };
  let hook: Hook;
  try {
    // Sin caché: cada arnés carga SU copia del hook, atada a SU React de juguete.
    delete require.cache[require.resolve("../use-encogido-en-ficha")];
    hook = (require("../use-encogido-en-ficha") as { useEncogidoEnFicha: Hook }).useEncogidoEnFicha;
  } finally {
    M._load = original;
  }
  const pintar = <T,>(f: () => T): T => {
    let salida: T;
    let vueltas = 0;
    do {
      pendiente = false;
      i = 0;
      salida = f();
      assert.ok(++vueltas < 10, "el hook se quedó pintando en bucle");
    } while (pendiente);
    return salida;
  };
  return { hook, pintar };
}

/** Una persona con su preferencia guardada (lo que hoy vive en localStorage). */
function persona(preferenciaInicial: boolean) {
  const { hook, pintar } = cargarHookConReactDeJuguete();
  let preferencia = preferenciaInicial;
  const guardar = (v: boolean) => { preferencia = v; };
  let ultimoCambiar: (v: boolean) => void = () => {};
  const navegar = (pathname: string) => {
    const [encogido, cambiar] = pintar(() => hook([preferencia, guardar], pathname));
    ultimoCambiar = cambiar;
    return encogido;
  };
  const pulsarBoton = (pathname: string) => {
    // El botón del menú hace setEncogido(!encogido): se pinta lo contrario.
    const antes = navegar(pathname);
    ultimoCambiar(!antes);
    return navegar(pathname);
  };
  return { navegar, pulsarBoton, preferencia: () => preferencia };
}

test("con el menú desplegado: al abrir la ficha se recoge y al salir vuelve desplegado", () => {
  const p = persona(false);
  assert.equal(p.navegar("/dashboard/patients"), false);
  assert.equal(p.navegar("/dashboard/patients/p1"), true, "al abrir la ficha, recogido");
  assert.equal(p.navegar("/dashboard/patients/p1/orthodontics"), true, "dentro de la ficha sigue recogido");
  assert.equal(p.navegar("/dashboard/patients"), false, "al salir, como estaba");
  assert.equal(p.preferencia(), false, "la preferencia no se tocó");
});

test("con el menú recogido a mano: la ficha lo respeta y al salir sigue recogido", () => {
  const p = persona(true);
  assert.equal(p.navegar("/dashboard/agenda"), true);
  assert.equal(p.navegar("/dashboard/patients/p1"), true);
  assert.equal(p.navegar("/dashboard/agenda"), true, "no se le desplegó al salir");
  assert.equal(p.preferencia(), true);
});

test("desplegar a mano dentro de la ficha funciona, no pisa la preferencia, y la siguiente ficha vuelve recogida", () => {
  const p = persona(false);
  assert.equal(p.navegar("/dashboard/patients/p1"), true);
  assert.equal(p.pulsarBoton("/dashboard/patients/p1"), false, "se puede desplegar dentro de la ficha");
  assert.equal(p.navegar("/dashboard/patients/p1/orthodontics"), false, "la elección dura mientras se está con ese paciente");
  assert.equal(p.preferencia(), false, "la preferencia guardada no cambió");
  assert.equal(p.navegar("/dashboard/patients/p2"), true, "otro paciente: se recoge otra vez");
  assert.equal(p.navegar("/dashboard/patients"), false, "fuera, la preferencia de siempre");
  assert.equal(p.navegar("/dashboard/patients/p1"), true, "volver a abrir el mismo paciente desde la lista: recogido otra vez");
});

test("si alguien tenía el menú recogido y lo despliega dentro de la ficha, al salir lo recupera recogido, como lo tenía", () => {
  const p = persona(true);
  assert.equal(p.navegar("/dashboard/patients/p1"), true);
  assert.equal(p.pulsarBoton("/dashboard/patients/p1"), false);
  assert.equal(p.navegar("/dashboard/hoy"), true, "vuelve como lo tenía, no como lo dejó dentro");
  assert.equal(p.preferencia(), true);
});

test("fuera de la ficha el botón sigue guardando la preferencia, como siempre", () => {
  const p = persona(false);
  assert.equal(p.pulsarBoton("/dashboard/agenda"), true);
  assert.equal(p.preferencia(), true, "fuera de la ficha el botón escribe la preferencia");
  assert.equal(p.pulsarBoton("/dashboard/agenda"), false);
  assert.equal(p.preferencia(), false);
});

// ── 3b. Y con el React de verdad (primer render, en servidor) ────────
// react-dom/server no vuelve a pintar tras un setState, pero sí demuestra que
// el hook, con las reglas reales de React, sale recogido en la ficha desde el
// PRIMER render (sin salto) y respeta la preferencia fuera.
test("con React de verdad: el primer render ya sale recogido en la ficha y como la preferencia fuera", () => {
  delete require.cache[require.resolve("../use-encogido-en-ficha")];
  const { useEncogidoEnFicha } = require("../use-encogido-en-ficha") as typeof import("../use-encogido-en-ficha");
  const { createElement } = require("react") as typeof import("react");
  const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");
  const Menu = ({ preferencia, pathname }: { preferencia: boolean; pathname: string }) => {
    const [encogido] = useEncogidoEnFicha([preferencia, () => {}], pathname);
    return createElement("aside", { "data-encogido": encogido ? "true" : "false" });
  };
  const pinta = (preferencia: boolean, pathname: string) =>
    renderToStaticMarkup(createElement(Menu, { preferencia, pathname }));
  assert.equal(pinta(false, "/dashboard/patients/p1"), '<aside data-encogido="true"></aside>');
  assert.equal(pinta(true, "/dashboard/patients/p1"), '<aside data-encogido="true"></aside>');
  assert.equal(pinta(false, "/dashboard/patients"), '<aside data-encogido="false"></aside>');
  assert.equal(pinta(true, "/dashboard/patients"), '<aside data-encogido="true"></aside>');
  assert.equal(pinta(false, "/dashboard/specialties/orthodontics/p1"), '<aside data-encogido="false"></aside>');
});

// ── 4. El cableado en el menú compartido ─────────────────────────────

test("el menú de dos niveles enchufa el hook en la línea de `encogido`, y ese es el único cambio", () => {
  const menu = leer("src/components/dashboard/menu-dos-niveles/menu-dos-niveles.tsx");
  assert.match(
    menu,
    /import \{ useEncogidoEnFicha \} from "@\/components\/dashboard\/menu-recogido-en-paciente\/use-encogido-en-ficha";/,
    "importa el hook desde su carpeta",
  );
  assert.match(
    menu,
    /const \[encogido, setEncogido\] = useEncogidoEnFicha\(useEncogido\(\), pathname\);/,
    "envuelve la preferencia de siempre con la regla de la ficha",
  );
  assert.equal((menu.match(/useEncogidoEnFicha\(/g) ?? []).length, 1, "se usa una sola vez");
  // La preferencia manual sigue viviendo donde vivía: misma clave, mismo hook.
  assert.match(menu, /const LS_ENCOGIDO = "menu-dos-niveles-encogido";/);
  assert.match(menu, /function useEncogido\(\): \[boolean, \(v: boolean\) => void\]/);
  // El hook no se mete con localStorage: la preferencia es del menú.
  const hook = leer("src/components/dashboard/menu-recogido-en-paciente/use-encogido-en-ficha.ts");
  assert.ok(!/localStorage\s*[.[]/.test(hook), "el hook no toca localStorage: la preferencia es del menú");
  assert.match(hook, /^"use client";/, "es un hook de cliente");
});

test("el menú viejo (bandera apagada) no sabe nada de esto", () => {
  const sidebar = leer("src/components/dashboard/sidebar.tsx");
  assert.ok(!/menu-recogido-en-paciente/.test(sidebar), "con la bandera apagada todo sigue idéntico");
});
