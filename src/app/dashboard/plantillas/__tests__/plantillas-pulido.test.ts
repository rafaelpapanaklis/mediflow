/**
 * Administración → Plantillas — candados del pulido.
 *
 * Run: npm run test:plantillas
 *
 * Lo que fija:
 *  - La tarjeta NO pinta el cuerpo de la carta: título, fechas y botones.
 *  - El hover del botón morado es un COLOR de verdad. `--brand-700` es un
 *    triplete HSL suelto: como fondo es inválido y dejaba el botón transparente.
 *  - La papelera va con fondo rojo y sin esquinas redondeadas.
 *  - Ningún color escrito a mano: todo sale de tokens.
 *  - El orden: en uso arriba, las de la clínica antes que las precargadas.
 *  - Los textos nuevos existen en los DOS diccionarios.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { esPrecargada, fueEditada, ordenarPlantillas } from "../tarjeta";

const AQUI = join(__dirname, "..");
const RAIZ = join(AQUI, "..", "..", "..", "..");
const cliente = readFileSync(join(AQUI, "plantillas-client.tsx"), "utf8");
const css = readFileSync(join(AQUI, "plantillas.module.css"), "utf8");
const sinComentarios = (texto: string) => texto.replace(/\/\*[\s\S]*?\*\//g, "");

/** Las declaraciones de una regla CSS exacta (`.btnPrimary:hover:not(:disabled)`). */
function regla(selector: string): string {
  const limpio = sinComentarios(css);
  const i = limpio.indexOf(`${selector} {`);
  assert.notEqual(i, -1, `no existe la regla ${selector}`);
  return limpio.slice(i, limpio.indexOf("}", i));
}

test("la tarjeta no pinta el cuerpo de la carta", () => {
  const lista = cliente.slice(cliente.indexOf("<ul className={styles.list}>"), cliente.indexOf("</ul>"));
  assert.ok(lista.includes("p.name"), "la tarjeta tiene que seguir enseñando el título");
  assert.ok(lista.includes("p.createdAt") && lista.includes("p.updatedAt"), "la tarjeta tiene que enseñar las fechas");
  assert.ok(!/\bp\.body\b/.test(lista), "la tarjeta vuelve a leer el cuerpo de la plantilla");
  assert.ok(!/extracto|cardExcerpt/.test(cliente), "volvió el extracto del cuerpo");
  assert.ok(!/cardExcerpt/.test(css));
  // El cuerpo solo se usa para abrir el editor, nunca con innerHTML en la lista.
  assert.ok(!cliente.includes("dangerouslySetInnerHTML"));
});

test("el hover del botón morado es un morado más oscuro, no un hueco", () => {
  const hover = regla(".btnPrimary:hover:not(:disabled)");
  assert.match(hover, /background:\s*var\(--violet-700\)/);
  // Los `--brand-NNN` de globals.css son tripletes HSL: solos no son un color.
  assert.ok(!/var\(--brand-\d+\)/.test(sinComentarios(css)), "un token --brand-NNN suelto no es un color");
  const globals = readFileSync(join(RAIZ, "src/app/globals.css"), "utf8");
  assert.match(globals, /--violet-700:\s*#[0-9a-fA-F]{6}/, "--violet-700 tiene que seguir siendo un color");
});

test("la papelera: fondo rojo, cuadrada y sin esquinas redondeadas", () => {
  const base = regla(".iconBtnDanger");
  assert.match(base, /background:\s*var\(--danger\)/);
  assert.match(base, /border-radius:\s*0;/);
  assert.match(regla(".iconBtnDanger:hover:not(:disabled)"), /background:\s*var\(--danger-strong\)/);
  assert.match(cliente, /styles\.iconBtn\} \$\{styles\.iconBtnDanger\}/);
});

test("ningún color a mano: todo sale de tokens", () => {
  const limpio = sinComentarios(css);
  // El blanco sobre un botón de color es el único literal (no hay token para él).
  const encontrados: string[] = limpio.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  const hex = encontrados.filter((h) => h.toLowerCase() !== "#fff");
  assert.deepEqual(hex, [], "hay colores hex escritos a mano");
});

test("orden: en uso arriba, y las de la clínica antes que las precargadas", () => {
  const p = (name: string, isActive: boolean, precargada: boolean) => ({ name, isActive, precargada });
  const orden = ordenarPlantillas(
    [p("Extracción", true, true), p("Zeta mía", true, false), p("Apagada mía", false, false), p("Blanqueamiento", true, true), p("Alfa mía", true, false)],
    "es",
  ).map((x) => x.name);
  assert.deepEqual(orden, ["Alfa mía", "Zeta mía", "Blanqueamiento", "Extracción", "Apagada mía"]);
});

test("precargada = sembrada sin autor; editada = tocada después de crearse", () => {
  assert.equal(esPrecargada(null), true);
  assert.equal(esPrecargada(undefined), true);
  assert.equal(esPrecargada("user_1"), false);
  assert.equal(fueEditada("2026-09-18T10:00:00.000Z", "2026-09-18T10:00:00.400Z"), false);
  assert.equal(fueEditada("2026-09-18T10:00:00.000Z", "2026-09-19T09:00:00.000Z"), true);
  assert.equal(fueEditada("no-es-fecha", "2026-09-19T09:00:00.000Z"), false);
});

test("los textos que usa la pantalla existen en es.json Y en en.json", () => {
  const fuentes = cliente + readFileSync(join(AQUI, "plantilla-modal.tsx"), "utf8");
  const claves = new Set([...fuentes.matchAll(/"pages\.plantillas\.([A-Za-z0-9.]+)"/g)].map((m) => m[1]));
  for (const id of ["titulo1", "titulo2", "titulo3", "parrafo"]) claves.add(`barraCorta.${id}`);
  assert.ok(claves.size > 20);
  for (const idioma of ["es", "en"]) {
    const dic = JSON.parse(readFileSync(join(RAIZ, `src/i18n/dictionaries/${idioma}.json`), "utf8")).pages.plantillas;
    for (const clave of claves) {
      const valor = clave.split(".").reduce((o: any, k) => o?.[k], dic);
      assert.equal(typeof valor, "string", `falta pages.plantillas.${clave} en ${idioma}.json`);
    }
  }
});
