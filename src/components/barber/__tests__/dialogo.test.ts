// FOCO EN LAS VENTANAS — «solo se puede escribir UNA letra» (Rafael, 15-nov,
// «Dar una estrella»: cada tecla mandaba el cursor a la X).
//
// El efecto de cada ventana dependía de onClose, y quien la usa le pasa una
// función nueva en cada render: cada tecla re-corría el efecto y el foco
// saltaba al primer enfocable. Ahora las seis usan useDialogo (dialogo.ts).
// Estas pruebas son estáticas (no hay DOM en Node); la prueba con navegador
// es ~/navegador/ws6-t1-foco-banco.mjs (banco) y ws6-t1-foco.mjs (panel.108).
//
//   npx tsx --test src/components/barber/__tests__/dialogo.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leer = (rel: string) => readFileSync(rel, "utf8");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const VENTANAS = [
  "src/components/barber/clients/ui.tsx",
  "src/components/barber/team/admin-ui.tsx",
  "src/components/barber/agenda/agenda-ui.tsx",
  "src/components/barber/memberships/ui.tsx",
  "src/components/barber/cash/modal.tsx",
  "src/components/barber/billing/modal.tsx",
];

test("useDialogo: onClose por ref, y Esc/foco dependen SOLO de abrir y cerrar", () => {
  const s = sinComentarios(leer("src/components/barber/dialogo.ts"));
  assert.match(s, /const onCloseRef = useRef\(opts\.onClose\);\s*onCloseRef\.current = opts\.onClose;/);
  assert.match(s, /onCloseRef\.current\(\)/);
  // Ningún efecto depende de onClose.
  const deps = Array.from(s.matchAll(/\}, \[([^\]]*)\]\);/g)).map((m) => m[1]);
  assert.ok(deps.length >= 2);
  for (const d of deps) assert.doesNotMatch(d, /onClose/, `un efecto depende de onClose: [${d}]`);
  assert.ok(deps.some((d) => d.trim() === "abierta"), "el foco inicial se pone una vez por apertura");
});

test("el foco inicial va al primer CAMPO; si no hay, a un control que no sea la X", () => {
  const s = leer("src/components/barber/dialogo.ts");
  assert.match(s, /raiz\.querySelector<HTMLElement>\(CAMPOS\) \?\? raiz\.querySelector<HTMLElement>\(OTROS\)/);
  assert.match(s, /const CAMPOS =\s*'input:not\(\[type="hidden"\]\)/);
  assert.match(s, /:not\(\[\$\{DIALOGO_CERRAR\}\]\)/);
});

test("las seis ventanas usan useDialogo, marcan su X y ya no tienen el efecto viejo", () => {
  for (const f of VENTANAS) {
    const s = sinComentarios(leer(f));
    assert.match(s, /useDialogo\(\{ panel: /, f);
    // El patrón del fallo: un useEffect con onClose en sus dependencias.
    assert.doesNotMatch(s, /\}, \[[^\]]*onClose[^\]]*\]\);/, `${f}: efecto que depende de onClose`);
    // Y ningún .focus() suelto en la ventana: el foco lo pone el gancho.
    assert.doesNotMatch(s, /\.focus\(\)/, `${f}: .focus() fuera del gancho`);
  }
  // Las que tienen X la marcan para que el foco nunca caiga en ella.
  for (const f of VENTANAS.filter((v) => !v.includes("billing"))) {
    assert.match(leer(f), /\[DIALOGO_CERRAR\]: ""/, `${f}: X sin marcar`);
  }
});

test("no queda otra ventana del vertical con el patrón (efecto con onClose que enfoca)", () => {
  // Barrido de las carpetas con diálogos: ningún efecto que dependa de
  // onClose/open Y llame .focus() en su cuerpo.
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const archivos: string[] = [];
  const recorrer = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) recorrer(p);
      else if (/\.tsx?$/.test(e) && !p.includes("__tests__")) archivos.push(p);
    }
  };
  recorrer("src/components/barber");
  recorrer("src/app/barber");
  const culpables: string[] = [];
  for (const f of archivos) {
    const s = sinComentarios(leer(f));
    for (const m of Array.from(s.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\}, \[([^\]]*)\]\);/g))) {
      if (/\.focus\(/.test(m[1]) && /onClose/.test(m[2])) culpables.push(f);
    }
  }
  assert.deepEqual(culpables, []);
});
