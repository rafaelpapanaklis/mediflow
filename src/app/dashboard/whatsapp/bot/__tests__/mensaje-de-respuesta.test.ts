/**
 * El bot de WhatsApp no enseña el texto crudo del servidor al fallar (ws1-t12,
 * fallo menor 1 de la revisión final de ws1-t5).
 *
 * Run: npm run test:wa-bot-errores
 *
 * Antes, `bot-client.tsx` hacía `throw new Error(await res.text())` y mostraba
 * `err.message`: un 500 de texto plano salía como «Internal Server Error» en el
 * toast. Ahora todo pasa por `mensajeDeError`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ErrorLegible, SIN_PERMISO, mensajeDeCatch, mensajeDeRespuestaBot } from "../mensaje-de-respuesta";
import { errorDeTamanoDePersona, PERSONA_MAX_CARACTERES } from "@/lib/whatsapp/bot/ai-prompt";

const ES = JSON.parse(readFileSync(join(process.cwd(), "src", "i18n", "dictionaries", "es.json"), "utf8"));
const hoja = (ruta: string): string | undefined => ruta.split(".").reduce((o: any, k) => o?.[k], ES);
const t = (k: string) => hoja(k) ?? `«${k}»`;

const respuesta = (status: number, cuerpo: string) => ({ status, text: async () => cuerpo });
const sinCuerpo = (status: number) => ({ status, text: async () => { throw new Error("sin cuerpo"); } });
const NO_SE_PUDO = "No se pudo guardar";

test("un 500 de texto plano en inglés sale con la frase de la clínica, no crudo", async () => {
  const m = await mensajeDeRespuestaBot(respuesta(500, "Internal Server Error"), t, NO_SE_PUDO);
  assert.equal(m, t("errores.interno"));
  assert.doesNotMatch(m, /Internal Server Error/);
});

test("un 401 «Unauthorized» (JSON o texto) sale como sesión terminada", async () => {
  assert.equal(await mensajeDeRespuestaBot(respuesta(401, JSON.stringify({ error: "Unauthorized" })), t, NO_SE_PUDO), t("errores.sesion"));
  assert.equal(await mensajeDeRespuestaBot(respuesta(401, "Unauthorized"), t, NO_SE_PUDO), t("errores.sesion"));
});

test("un código del servidor no se enseña: ni en JSON ni suelto", async () => {
  const m1 = await mensajeDeRespuestaBot(respuesta(400, JSON.stringify({ error: "invalid_payload" })), t, NO_SE_PUDO);
  assert.equal(m1, t("errores.datosInvalidos"));
  const m2 = await mensajeDeRespuestaBot(respuesta(422, JSON.stringify({ error: "algo_raro_x" })), t, NO_SE_PUDO);
  assert.equal(m2, NO_SE_PUDO);
});

test("un cuerpo vacío o ilegible usa el estado o la frase de la pantalla", async () => {
  assert.equal(await mensajeDeRespuestaBot(respuesta(502, ""), t, NO_SE_PUDO), t("errores.interno"));
  assert.equal(await mensajeDeRespuestaBot(sinCuerpo(400), t, NO_SE_PUDO), NO_SE_PUDO);
});

test("un 403 se dice con las palabras de la pantalla", async () => {
  assert.equal(await mensajeDeRespuestaBot(respuesta(403, JSON.stringify({ error: "forbidden" })), t, NO_SE_PUDO), SIN_PERMISO);
});

test("las frases en español que ya manda el servidor siguen saliendo tal cual (tope de la persona, FAQ, precios)", async () => {
  const persona = errorDeTamanoDePersona("x".repeat(PERSONA_MAX_CARACTERES + 5), "");
  assert.ok(persona);
  for (const frase of [
    persona!,
    "Dar precios por WhatsApp todavía no está activo en tu clínica.",
    "FAQ no encontrada",
    "JSON inválido",
    "question y answer requeridos",
  ]) {
    const m = await mensajeDeRespuestaBot(respuesta(400, JSON.stringify({ error: frase, code: "lo_que_sea" })), t, NO_SE_PUDO);
    assert.equal(m, frase);
  }
});

test("el catch: lo ya traducido pasa tal cual y un error de red en inglés no se enseña", () => {
  assert.equal(mensajeDeCatch(new ErrorLegible("Frase lista"), t, NO_SE_PUDO), "Frase lista");
  const red = mensajeDeCatch(new TypeError("Failed to fetch"), t, NO_SE_PUDO);
  assert.doesNotMatch(red, /Failed to fetch/);
  const json = mensajeDeCatch(new SyntaxError("Unexpected token '<', \"<html>\" is not valid JSON"), t, NO_SE_PUDO);
  assert.doesNotMatch(json, /Unexpected token|JSON/);
});

test("bot-client.tsx ya no lee el cuerpo crudo ni muestra err.message", () => {
  const src = readFileSync(join(process.cwd(), "src/app/dashboard/whatsapp/bot/bot-client.tsx"), "utf8");
  assert.doesNotMatch(src, /res\.text\(\)/);
  assert.doesNotMatch(src, /toast\.error\(err instanceof Error/);
  assert.equal((src.match(/mensajeDeRespuestaBot\(res, t,/g) ?? []).length, 6);
});
