// H3 y H8 (revisión final, ws1-t4): Ajustes → Anticipos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(__dirname, "../../../../../..");
const leer = (r: string) => readFileSync(join(RAIZ, r), "utf8");
const PANTALLA = leer("src/app/dashboard/settings/anticipos/anticipos-client.tsx");

test("H3: «Monto sugerido» no aparenta un valor que no está guardado", () => {
  assert.match(PANTALLA, /value=\{panelMonto\}[\s\S]{0,200}placeholder="Sin definir"/);
  assert.match(PANTALLA, /Vacío: «Pedir anticipo» abre sin monto y recepción lo escribe\./);
});

test("H8: cada etiqueta de anticipos apunta a su campo", () => {
  const campo = leer("src/components/dashboard/configuracion-rediseno/piezas.tsx");
  assert.match(campo, /<label className=\{s\.campoEtiqueta\} htmlFor=\{htmlFor\}>/);
  for (const k of ["botMonto", "botPorcentaje", "botMinutos", "panelMonto", "panelPorcentaje", "panelHoras"]) {
    assert.match(PANTALLA, new RegExp(`htmlFor=\\{ids\\.${k}\\}`), `etiqueta de ${k}`);
    assert.match(PANTALLA, new RegExp(`id=\\{ids\\.${k}\\}`), `campo de ${k}`);
  }
});

test("H8: «Guardado» se queda a la vista junto al botón", () => {
  assert.match(PANTALLA, /setGuardadoEn\("panel"\)/);
  assert.match(PANTALLA, /setGuardadoEn\("bot"\)/);
  assert.match(PANTALLA, /role="status"[\s\S]{0,120}guardadoEn === "panel" \? "✓ Guardado"/);
});
