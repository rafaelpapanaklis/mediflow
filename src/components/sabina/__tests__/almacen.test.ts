/**
 * EL ALMACÉN DE SABINA — la conversación que comparten sus dos puertas.
 *
 *   npm run test:sabina-almacen
 *
 * Lo que se vigila aquí es UNA cosa, y es de dinero: **con una pregunta en
 * vuelo no se cambia de hilo**. Vaciar los mensajes mientras el
 * `POST /api/sabina` está en el aire hace que la respuesta llegue a un mensaje
 * que ya no existe y se descarte en silencio — después de que el monedero de la
 * clínica ya la pagó, porque los tokens se los quedó Anthropic pase lo que
 * pase. La carrera es nueva de esta pantalla (el cajón se abre y enfoca la caja
 * de texto de golpe con `Alt + S`), así que también es nueva la guarda.
 *
 * El almacén es JavaScript pelado a propósito —sin React— y por eso se puede
 * probar así: se sustituye `fetch` y se mira el estado.
 */

import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import {
  abrirConversacion,
  cambiandoDeHilo,
  leerEstado,
  nuevaConversacion,
  preguntar,
  reiniciarParaPruebas,
  usarClinica,
} from "../almacen";

/** Un `fetch` que se queda colgado: deja el POST «en vuelo» todo el tiempo que haga falta. */
function fetchColgado() {
  return () => new Promise<Response>(() => {});
}

/** Un `fetch` que contesta lo que le digan. */
function fetchQueContesta(cuerpo: Record<string, unknown>) {
  return async () =>
    new Response(JSON.stringify(cuerpo), { status: 200, headers: { "Content-Type": "application/json" } });
}

const fetchOriginal = globalThis.fetch;

beforeEach(() => {
  reiniciarParaPruebas();
  usarClinica("cl-prueba");
  globalThis.fetch = fetchOriginal;
});

test("preguntar deja la conversación «en vuelo»", () => {
  globalThis.fetch = fetchColgado() as typeof fetch;
  preguntar("¿cuántas citas tengo hoy?", { pantalla: "agenda" });
  const e = leerEstado();
  assert.equal(e.sending, true);
  assert.equal(e.messages.length, 2, "el turno del usuario y el hueco de la respuesta");
  assert.equal(e.messages[0].content, "¿cuántas citas tengo hoy?");
  assert.equal(e.messages[1].pending, true);
  assert.equal(cambiandoDeHilo(), true);
});

test("🔴 con una pregunta en vuelo, «nueva conversación» no borra el turno pagado", () => {
  globalThis.fetch = fetchColgado() as typeof fetch;
  preguntar("¿quién me debe?", null);
  const antes = leerEstado().messages;

  nuevaConversacion();

  assert.deepEqual(leerEstado().messages, antes, "se tiró un turno que el monedero ya está pagando");
});

test("🔴 con una pregunta en vuelo, abrir una conversación del historial tampoco", async () => {
  globalThis.fetch = fetchColgado() as typeof fetch;
  preguntar("¿quién me debe?", null);
  const antes = leerEstado().messages;

  await abrirConversacion({ id: "conv-vieja", title: "De ayer" });

  assert.deepEqual(leerEstado().messages, antes);
  assert.notEqual(leerEstado().conversationId, "conv-vieja", "se cambió de hilo con una respuesta en el aire");
});

test("🔴 mientras se abre un hilo, una pregunta nueva no sale (y no se cobra)", async () => {
  let llamadas = 0;
  // El GET del historial se queda colgado: `openingConv` se queda en true.
  globalThis.fetch = ((url: unknown) => {
    llamadas += 1;
    void url;
    return new Promise<Response>(() => {});
  }) as typeof fetch;

  void abrirConversacion({ id: "conv-vieja" });
  assert.equal(leerEstado().openingConv, true);

  preguntar("¿cuántas citas tengo hoy?", null);

  assert.equal(llamadas, 1, "salió un POST a /api/sabina mientras se abría otro hilo");
  assert.equal(leerEstado().messages.length, 0);
  assert.equal(leerEstado().sending, false);
});

test("sin nada en vuelo, cambiar de hilo sí funciona", async () => {
  globalThis.fetch = fetchQueContesta({ conversation: { id: "conv-vieja", title: "De ayer" }, messages: [] }) as typeof fetch;
  await abrirConversacion({ id: "conv-vieja", title: "De ayer" });
  assert.equal(leerEstado().conversationId, "conv-vieja");
  assert.equal(leerEstado().openingConv, false);

  nuevaConversacion();
  assert.equal(leerEstado().conversationId, null);
  assert.equal(leerEstado().messages.length, 0);
});

test("cambiar de clínica reinicia la conversación: no se arrastra la de la otra sede", () => {
  globalThis.fetch = fetchColgado() as typeof fetch;
  preguntar("¿quién me debe?", null);
  assert.ok(leerEstado().messages.length > 0);

  usarClinica("cl-otra-sede");

  assert.equal(leerEstado().clinicaId, "cl-otra-sede");
  assert.deepEqual(leerEstado().messages, []);
  assert.equal(leerEstado().conversationId, null);
});

test("apagada o sin texto, preguntar no manda nada", () => {
  let llamadas = 0;
  globalThis.fetch = (() => {
    llamadas += 1;
    return new Promise<Response>(() => {});
  }) as typeof fetch;

  preguntar("   ", null);
  assert.equal(llamadas, 0, "una pregunta vacía no se manda");
});

test("«nueva conversación» pide el foco para la caja de texto", () => {
  const antes = leerEstado().foco;
  nuevaConversacion();
  assert.equal(leerEstado().foco, antes + 1);
});
