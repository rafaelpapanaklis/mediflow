// Uso del panel (ws6-t4): lo puro — pantallas sin datos, enlaces, etiquetas,
// validación del lote, tope y la cola del navegador. Sin base, sin DOM.
//   npx tsx --test src/lib/barber/__tests__/uso-core.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  USO_MAX_LOTE,
  USO_TOPE_CLIENTE_MIN,
  USO_TOPE_SERVIDOR_MIN,
  cuantosCaben,
  destinoDeEnlace,
  hayVerComo,
  horaDelEvento,
  limpiarAccion,
  limpiarEtiqueta,
  normalizarPantalla,
  validarLote,
} from "@/lib/barber/uso/uso-core";
import { crearComparadorEtiquetas, etiquetaDelPanel } from "@/lib/barber/uso/etiquetas";
import { crearRegistrador, USO_OFF_KEY, type AlmacenSimple } from "@/lib/barber/uso/registrador-core";
import type { UsoLoteCliente } from "@/lib/barber/uso/uso-core";

const ORIGEN = "https://www.dalecontrol.com";

test("la pantalla se guarda sin ids, sin consulta y solo si es del panel", () => {
  assert.equal(normalizarPantalla("/barber/clientes/cmwj33u4e000297chet5iq1rg?q=juan#x"), "/barber/clientes/[id]");
  assert.equal(normalizarPantalla("/barber/caja/corte/123"), "/barber/caja/corte/[id]");
  assert.equal(
    normalizarPantalla("/barber/x/0b6c2f2e-1d0c-4e5a-9a3b-2f4e5d6c7b8a/editar"),
    "/barber/x/[id]/editar",
  );
  assert.equal(normalizarPantalla("/barber/mi-web/"), "/barber/mi-web");
  assert.equal(normalizarPantalla("/barber"), "/barber");
  assert.equal(normalizarPantalla("https://x.com/barber/inicio?a=1"), "/barber/inicio");
  assert.equal(normalizarPantalla("/dashboard/patients"), null, "lo del dental no es del panel barber");
  assert.equal(normalizarPantalla("/b/barberia-prueba/reservar"), null, "la página pública no es el panel");
  assert.equal(normalizarPantalla(42), null);
});

test("un enlace se guarda como su pantalla destino; uno de fuera, solo «externo» (nunca el teléfono)", () => {
  assert.equal(destinoDeEnlace("/barber/clientes/cmwj33u4e000297chet5iq1rg", ORIGEN), "/barber/clientes/[id]");
  assert.equal(destinoDeEnlace("https://wa.me/5219991234567?text=hola", ORIGEN), "externo");
  assert.equal(destinoDeEnlace("tel:+529991234567", ORIGEN), "externo");
  assert.equal(destinoDeEnlace("mailto:a@b.com", ORIGEN), "externo");
  assert.equal(destinoDeEnlace("/b/barberia/reservar", ORIGEN), "externo", "la pública no es una pantalla del panel");
  assert.equal(destinoDeEnlace("#seccion", ORIGEN), null);
  assert.equal(destinoDeEnlace("javascript:void(0)", ORIGEN), null);
});

test("del texto de un botón no sale ningún dígito ni correo", () => {
  assert.equal(limpiarEtiqueta("  Cobrar   $720.00 "), "Cobrar $000.00");
  assert.equal(limpiarEtiqueta("Llamar 999 123 4567"), "Llamar 000 000 0000");
  assert.equal(limpiarEtiqueta("juan@correo.com"), null);
  assert.equal(limpiarEtiqueta(""), null);
  assert.equal(limpiarEtiqueta("x".repeat(200))?.length, 60);
  assert.equal(limpiarAccion(" Cobrar Ticket!! "), "cobrarticket");
  assert.equal(limpiarAccion("ver-ticket"), "ver-ticket");
  assert.equal(limpiarAccion(""), null);
});

test("solo se guarda un texto DEL PANEL; con hueco, la plantilla y nunca el dato", () => {
  const cmp = crearComparadorEtiquetas([
    { a: { cobrar: "Cobrar {amount}", guardar: "Guardar", hola: "Hola, {name}", solo: "{name}", largo: "x".repeat(90) } },
  ]);
  assert.equal(cmp("Guardar"), "Guardar");
  assert.equal(cmp("guardar"), "Guardar", "sin importar mayúsculas");
  assert.equal(cmp(limpiarEtiqueta("Cobrar $720.00")), "Cobrar {amount}");
  assert.equal(cmp("Hola, Juan Pérez"), "Hola, {name}", "el nombre NO se guarda: se guarda la plantilla");
  assert.equal(cmp("Juan Pérez"), null, "un texto que no es del panel se tira");
  assert.equal(cmp("x".repeat(90)), null, "un párrafo no es un botón");
  assert.equal(cmp(null), null);
});

test("el comparador real conoce los botones del panel barber (es y en)", () => {
  assert.notEqual(etiquetaDelPanel("Guardar y publicar"), null);
  assert.notEqual(etiquetaDelPanel("Abrir caja"), null);
  assert.equal(etiquetaDelPanel("María Fernanda López"), null);
});

test("el lote se valida: claves cortas, tope de tamaño, eventos raros se tiran", () => {
  assert.equal(validarLote(null), null);
  assert.equal(validarLote({ sid: "x", events: [] }), null, "sid demasiado corto");
  assert.equal(validarLote({ sid: "abcdefgh-1234", events: "no" }), null);
  const muchos = Array.from({ length: USO_MAX_LOTE + 20 }, () => ({ k: "V", p: "/barber/inicio" }));
  assert.equal(validarLote({ sid: "abcdefgh-1234", events: muchos })!.eventos.length, USO_MAX_LOTE);

  const r = validarLote({
    sid: "abcdefgh-1234",
    // barbershopId / userId en el cuerpo se IGNORAN: salen de la sesión.
    barbershopId: "otra-barberia",
    events: [
      { k: "S", p: "/barber/inicio", t: 1 },
      { k: "V", p: "/barber/clientes/cmwj33u4e000297chet5iq1rg" },
      { k: "C", p: "/barber/caja", a: "Cobrar", l: "Cobrar $000.00", h: "https://wa.me/52999" },
      { k: "C", p: "/barber/caja", h: "externo" },
      { k: "X", p: "/barber/inicio" },
      { k: "V", p: "/dashboard" },
      { k: "V", a: "solo-accion" },
    ],
  })!;
  assert.equal(r.eventos.length, 4);
  assert.deepEqual(r.eventos.map((e) => e.type), ["SESSION", "VIEW", "CLICK", "CLICK"]);
  assert.equal(r.eventos[1].screen, "/barber/clientes/[id]");
  assert.equal(r.eventos[2].accion, "cobrar");
  assert.equal(r.eventos[2].target, null, "una URL de fuera que llegue cruda no se guarda");
  assert.equal(r.eventos[3].target, "externo");
  assert.equal(r.eventos[0].accion, null, "una entrada no lleva acción");
  assert.equal("barbershopId" in r, false);
});

test("tope del servidor por usuario y minuto", () => {
  assert.equal(cuantosCaben(0, 10), 10);
  assert.equal(cuantosCaben(USO_TOPE_SERVIDOR_MIN - 3, 10), 3);
  assert.equal(cuantosCaben(USO_TOPE_SERVIDOR_MIN, 10), 0);
  assert.equal(cuantosCaben(USO_TOPE_SERVIDOR_MIN + 50, 10), 0);
});

test("la hora del navegador se usa solo si es creíble", () => {
  const ahora = 1_800_000_000_000;
  assert.equal(horaDelEvento(ahora - 20_000, ahora).getTime(), ahora - 20_000);
  assert.equal(horaDelEvento(ahora - 3_600_000, ahora).getTime(), ahora, "una hora atrás: reloj torcido");
  assert.equal(horaDelEvento(ahora + 3_600_000, ahora).getTime(), ahora);
  assert.equal(horaDelEvento(null, ahora).getTime(), ahora);
});

test("«Ver como barbería»: con su cookie no se registra", () => {
  assert.equal(hayVerComo("a=1; dcb_ver_como=admin123; b=2"), true);
  assert.equal(hayVerComo("dcb_ver_como=0"), false);
  assert.equal(hayVerComo("dcb_ver_comox=1"), false);
  assert.equal(hayVerComo(null), false);
});

// ── La cola del navegador ──────────────────────────────────────────────

function almacen(): AlmacenSimple & { datos: Map<string, string> } {
  const datos = new Map<string, string>();
  return { datos, getItem: (k) => datos.get(k) ?? null, setItem: (k, v) => void datos.set(k, v) };
}

function arnes(respuesta: { off?: boolean } | null = { }) {
  let reloj = 1_800_000_000_000;
  let n = 0;
  const enviados: Array<{ lote: UsoLoteCliente; alSalir: boolean }> = [];
  const alm = almacen();
  const r = crearRegistrador({
    ahora: () => reloj,
    almacen: alm,
    nuevoId: () => `sesion-${++n}-abcdef`,
    enviar: async (lote, alSalir) => {
      enviados.push({ lote: JSON.parse(JSON.stringify(lote)), alSalir });
      return respuesta;
    },
  });
  return { r, enviados, alm, avanza: (ms: number) => (reloj += ms) };
}

test("navegador: entrada + pantallas + toques van en UN lote; misma pantalla no se repite", async () => {
  const { r, enviados } = arnes();
  r.pantalla("/barber/inicio");
  r.pantalla("/barber/inicio");
  r.clic({ p: "/barber/inicio", a: "ver-caja", l: "Ver caja" });
  r.pantalla("/barber/caja");
  await r.vaciar(false);
  assert.equal(enviados.length, 1);
  assert.deepEqual(enviados[0].lote.events.map((e) => e.k), ["S", "V", "C", "V"]);
  assert.equal(enviados[0].lote.sid, "sesion-1-abcdef");
  await r.vaciar(false);
  assert.equal(enviados.length, 1, "sin nada en la cola no se manda nada");
});

test("navegador: 30 min sin tocar nada = sesión nueva; antes no", async () => {
  const { r, enviados, avanza } = arnes();
  r.pantalla("/barber/inicio");
  avanza(10 * 60_000);
  r.pantalla("/barber/agenda");
  avanza(31 * 60_000);
  r.pantalla("/barber/caja");
  await r.vaciar(false);
  const ks = enviados[0].lote.events.map((e) => e.k).join("");
  assert.equal(ks, "SVVSV");
  assert.equal(r.estado().sid, "sesion-2-abcdef");
});

test("navegador: tope por minuto — una pestaña desbocada no inunda", async () => {
  const { r, enviados, avanza } = arnes();
  r.pantalla("/barber/inicio");
  for (let i = 0; i < 500; i++) r.clic({ p: "/barber/inicio", l: "Guardar" });
  assert.equal(r.estado().cola, USO_TOPE_CLIENTE_MIN);
  avanza(61_000);
  r.clic({ p: "/barber/inicio", l: "Guardar" });
  assert.equal(r.estado().cola, USO_TOPE_CLIENTE_MIN + 1, "pasado el minuto vuelve a contar");
  await r.vaciar(false);
  assert.ok(enviados[0].lote.events.length <= USO_MAX_LOTE, "un lote nunca pasa del máximo");
});

test("navegador: sin tabla ({ off: true }) se apaga para toda la pestaña y tira lo que tenía", async () => {
  const { r, enviados, alm } = arnes({ off: true });
  r.pantalla("/barber/inicio");
  await r.vaciar(false);
  assert.equal(r.estado().apagado, true);
  assert.equal(alm.datos.get(USO_OFF_KEY), "1");
  r.pantalla("/barber/caja");
  r.clic({ p: "/barber/caja", l: "Cobrar" });
  await r.vaciar(false);
  assert.equal(enviados.length, 1, "apagado ya no manda nada");
  assert.equal(r.estado().cola, 0);
});

test("navegador: si el envío falla (sin red) no truena", async () => {
  const r = crearRegistrador({
    ahora: () => 1,
    almacen: null,
    nuevoId: () => "sesion-sin-almacen",
    enviar: async () => {
      throw new Error("sin red");
    },
  });
  r.pantalla("/barber/inicio");
  await r.vaciar(true);
  assert.equal(r.estado().apagado, false);
});
