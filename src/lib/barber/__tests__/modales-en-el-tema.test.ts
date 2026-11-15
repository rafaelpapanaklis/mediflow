import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Los tokens del tema barber (café) viven bajo .barber-shell. Un modal que se
// pinta con createPortal directo a <body> queda fuera y toma el violeta del
// dental (foco y opción elegida en «Vender membresía», 15-nov).
function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

test("todo createPortal del vertical monta dentro de .barber-shell", () => {
  const conPortal = archivos("src/components/barber").filter((f) => /createPortal\(/.test(readFileSync(f, "utf8")));
  assert.ok(conPortal.length >= 2, "esperaba al menos los modales de membresías y suscripción");
  for (const f of conPortal) {
    const s = readFileSync(f, "utf8");
    assert.match(s, /querySelector\("\.barber-shell"\)/, f);
    assert.doesNotMatch(s, /^\s*document\.body,\s*$/m, `${f}: createPortal(…, document.body)`);
  }
});
