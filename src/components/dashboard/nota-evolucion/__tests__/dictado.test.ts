/**
 * ws1-t5 — micrófono en el editor de «Nueva nota de evolución».
 * Run: npm run test:nota-evolucion-dictado
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { textoParaInsertar } from "../dictado";

test("lo dictado se inserta tal cual en una hoja vacía o tras un espacio", () => {
  assert.equal(textoParaInsertar("", "paciente asintomático"), "paciente asintomático");
  assert.equal(textoParaInsertar("Evolución: ", "sin dolor"), "sin dolor");
  assert.equal(textoParaInsertar("línea anterior\n", "sin dolor"), "sin dolor");
});

test("tras una palabra pegada al cursor lleva un espacio delante, para no pegarse", () => {
  assert.equal(textoParaInsertar("Evolución:", "sin dolor"), " sin dolor");
  assert.equal(textoParaInsertar("hola", "mundo"), " mundo");
});

test("saltos de línea y espacios sobrantes de la transcripción no crean bloques nuevos", () => {
  assert.equal(textoParaInsertar("", "  uno\n\n dos \r\n tres  "), "uno dos tres");
});

test("un dictado vacío no inserta nada", () => {
  assert.equal(textoParaInsertar("algo", ""), "");
  assert.equal(textoParaInsertar("algo", " \n "), "");
  assert.equal(textoParaInsertar("algo", undefined as unknown as string), "");
});

test("el editor de la nota usa el MISMO componente de dictado y lo inserta en el cursor, no en el HTML entero", () => {
  const fuente = readFileSync(path.join(process.cwd(), "src/components/dashboard/nota-evolucion/nota-evolucion-panel.tsx"), "utf8");
  assert.match(fuente, /from "@\/components\/clinical\/shared\/dictation-mic"/);
  assert.match(fuente, /<DictationMic onText=\{dictar\}/);
  // insertText (respeta el formato) y no reescribir innerHTML con lo dictado.
  assert.match(fuente, /execCommand\("insertText"/);
  const dictar = fuente.slice(fuente.indexOf("const dictar ="), fuente.indexOf("const dictar =") + 1500);
  assert.ok(!/innerHTML\s*=/.test(dictar.split("tocado.current = true")[0]), "dictar no debe reescribir innerHTML");
});
