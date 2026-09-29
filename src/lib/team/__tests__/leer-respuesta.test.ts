/**
 * ws1-t3 — Equipo no enseña «Unexpected end of JSON input», y la confirmación
 * «¿seguro?» no se rompe con el rediseño.
 *
 * Run: npx tsx --test src/lib/team/__tests__/leer-respuesta.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MENSAJE_RESPUESTA_ROTA, leerRespuestaEquipo, parsearCuerpo } from "../leer-respuesta";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const res = (cuerpo: string, status: number) => new Response(cuerpo, { status });

test("respuesta vacía con error → mensaje entendible, no texto técnico", async () => {
  for (const status of [400, 500, 502]) {
    await assert.rejects(leerRespuestaEquipo(res("", status)), (e: Error) => e.message === MENSAJE_RESPUESTA_ROTA);
  }
  assert.match(MENSAJE_RESPUESTA_ROTA, /desactiva al miembro/);
});

test("respuesta que no es JSON (página de error) → el mismo mensaje", async () => {
  await assert.rejects(leerRespuestaEquipo(res("<html>Bad Gateway</html>", 502)), (e: Error) => e.message === MENSAJE_RESPUESTA_ROTA);
});

test("el error del servidor sigue diciendo su causa", async () => {
  await assert.rejects(leerRespuestaEquipo(res(JSON.stringify({ error: "No puedes eliminarte a ti mismo" }), 400)), /No puedes eliminarte/);
  await assert.rejects(leerRespuestaEquipo(res(JSON.stringify({ error: "  " }), 500)), (e: Error) => e.message === MENSAJE_RESPUESTA_ROTA);
});

test("éxito: devuelve el JSON, o {} si vino vacío", async () => {
  assert.deepEqual(await leerRespuestaEquipo(res(JSON.stringify({ deactivated: true }), 200)), { deactivated: true });
  assert.deepEqual(await leerRespuestaEquipo(res("", 200)), {});
  assert.equal(parsearCuerpo("nope"), null);
});

test("el cliente de Equipo ya no llama res.json() a pelo", () => {
  const c = leer("src/app/dashboard/team/team-client.tsx");
  assert.doesNotMatch(c, /await res\.json\(\)/);
  assert.match(c, /leerRespuestaEquipo\(res\)/);
});

test("confirm-dialog no usa <style jsx>: styled-jsx pisaría el className que llega por spread desde vestir()", () => {
  const c = leer("src/components/ui/confirm-dialog.tsx");
  assert.doesNotMatch(c, /<style jsx/);
  assert.match(c, /<style>\{`/, "los keyframes siguen, en un <style> normal");
  assert.match(c, /@keyframes mfConfirmSlide/);
});
