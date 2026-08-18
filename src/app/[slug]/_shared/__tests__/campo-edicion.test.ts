/* ============================================================
   LA REGLA DEL CAMPO DE EDICIÓN.

     npm run test:campo-edicion

   Dos preguntas, y las dos tienen que contestarse a la vez:

   1. ¿CON QUÉ ABRE? Con el texto que ve un paciente. Antes abría
      vacío y el marcador enseñaba el nombre del campo, así que para
      pasar de "Agendar" a "Agendar cita" había que teclear "Agendar"
      otra vez. Y como los defaults NO se materializan nunca, casi
      todo texto llega con valor null: ese era el caso normal.

   2. ¿QUÉ SE GUARDA? Solo lo que se apartó de la plantilla. Precargar
      el literal y guardarlo tal cual sería materializar el default por
      la puerta de atrás — y entonces cambiar de plantilla arrastraría
      el copy de la anterior, que es justo lo que la regla prohíbe.

   El test que de verdad sujeta las dos es «abrir y confirmar sin
   tocar nada no manda ni un mensaje»: recorre el viaje entero
   (precarga → confirmación) en vez de comprobar cada mitad por su
   cuenta, que es como se separarían sin que nadie se entere.

   Sin DOM a propósito: las dos funciones son puras y viven aparte del
   resto de edit-runtime.tsx justamente para poder probarse así.
   ============================================================ */
import { test } from "node:test";
import assert from "node:assert/strict";

import { resolverConfirmacion, textoPrecargado, type Confirmacion } from "../edit-runtime";

/** El viaje completo: se abre el campo, no se toca, se confirma. */
function abrirYConfirmar(
  campo: { valor: string | null; porDefecto: string | null; obligatorio?: boolean },
): { precarga: string; resultado: Confirmacion } {
  const precarga = textoPrecargado(campo.valor, campo.porDefecto);
  return {
    precarga,
    resultado: resolverConfirmacion(precarga, {
      valor: campo.valor,
      porDefecto: campo.porDefecto,
      obligatorio: campo.obligatorio ?? false,
    }),
  };
}

/* ══════════════════════════════════════════════════════════════
   1 · Con qué abre
   ══════════════════════════════════════════════════════════════ */

test("abre con lo que escribió la clínica, si escribió algo", () => {
  assert.equal(textoPrecargado("Reservar ahora", "Agendar"), "Reservar ahora");
});

test("sin valor propio, abre con el literal de la plantilla", () => {
  // El caso normal: los defaults no se materializan, así que esto es lo que
  // le pasa a casi todo texto de una clínica que no ha tocado el editor.
  assert.equal(textoPrecargado(null, "Agendar"), "Agendar");
});

test("un valor que solo tiene espacios cuenta como no escrito", () => {
  // Es el mismo criterio que aplica <Txt> al decidir qué pinta la página
  // pública (`valor.trim() ? valor : null`). Si aquí no coincidiera, el campo
  // abriría con tres espacios donde el paciente lee "Agendar".
  assert.equal(textoPrecargado("   ", "Agendar"), "Agendar");
  assert.equal(textoPrecargado("", "Agendar"), "Agendar");
});

test("sin literal declarado, abre vacío — nunca con el nombre del campo", () => {
  // porDefecto null = declarado sin literal. En el lienzo se pinta atenuado
  // con la ETIQUETA ("Botón de reservar de la barra"), que es el nombre del
  // campo y no texto de la clínica: precargarlo lo guardaría como copy.
  assert.equal(textoPrecargado(null, null), "");
});

test("cuando la plantilla CONSTRUYE la frase, abre vacío", () => {
  // porDefecto "" son los plazos de MSI, la ciudad, cuántos dentistas hay:
  // no hay literal que precargar. Hoy <Txt> ya lo convierte en null antes de
  // llegar aquí; se fija igualmente para que la regla no dependa de eso.
  assert.equal(textoPrecargado(null, ""), "");
  assert.equal(textoPrecargado("", ""), "");
});

test("el salto de línea del literal llega entero al campo", () => {
  const titular = "Tu salud, nuestra\nprioridad";
  assert.equal(textoPrecargado(null, titular), titular);
  assert.equal(textoPrecargado(titular, "Otra cosa"), titular);
});

/* ══════════════════════════════════════════════════════════════
   2 · Abrir y confirmar sin tocar nada no escribe NADA
   ══════════════════════════════════════════════════════════════ */

const CAMPOS: Array<{ caso: string; valor: string | null; porDefecto: string | null; obligatorio?: boolean }> = [
  { caso: "el caso normal: literal de plantilla, nada escrito", valor: null, porDefecto: "Agendar" },
  { caso: "con valor propio ya guardado", valor: "Reservar ahora", porDefecto: "Agendar" },
  { caso: "declarado sin literal", valor: null, porDefecto: null },
  { caso: "la plantilla construye la frase", valor: null, porDefecto: "" },
  { caso: "multilínea", valor: null, porDefecto: "Tu salud, nuestra\nprioridad" },
  { caso: "obligatorio con literal", valor: null, porDefecto: "Limpieza dental", obligatorio: true },
  { caso: "obligatorio con valor propio", valor: "Blanqueamiento", porDefecto: "Limpieza dental", obligatorio: true },
  { caso: "un valor que ya era igual al literal", valor: "Agendar", porDefecto: "Agendar" },
  { caso: "espacios sobrantes en el valor guardado", valor: "  Agendar  ", porDefecto: "Agendar" },
];

for (const campo of CAMPOS) {
  test(`abrir y confirmar sin cambiar nada no escribe nada — ${campo.caso}`, () => {
    const { resultado } = abrirYConfirmar(campo);
    assert.equal(
      resultado.accion, "nada",
      `Abrir el campo y salir sin tocarlo mandó un mensaje al editor ` +
      `(${JSON.stringify(resultado)}). Eso escribe en la base sin que la clínica ` +
      `haya decidido nada, y con un literal de plantilla dentro materializa el ` +
      `default: al cambiar de plantilla se arrastraría el copy de la anterior.`,
    );
  });
}

test("un campo obligatorio con literal no se queja al confirmarlo sin tocar", () => {
  // Vaciar y "dejar el default" acaban los dos en null, pero NO son el mismo
  // aviso: con el default puesto el campo no se queda vacío en pantalla. Si
  // se confundieran, abrir el nombre de un servicio y salir soltaría un
  // "«Nombre del servicio» no puede quedarse vacío" que no viene a cuento.
  const { resultado } = abrirYConfirmar({ valor: null, porDefecto: "Limpieza dental", obligatorio: true });
  assert.notEqual(resultado.accion, "vacio-prohibido");
  assert.equal(resultado.accion, "nada");
});

/* ══════════════════════════════════════════════════════════════
   3 · El literal de la plantilla nunca acaba en la base
   ══════════════════════════════════════════════════════════════ */

test("escribir a mano el texto del default vuelve al default, no lo guarda", () => {
  // El camino de vuelta: quien reescribió el botón y luego teclea otra vez el
  // texto original está deshaciendo su cambio, no inventándose un copy propio.
  const r = resolverConfirmacion("Agendar", {
    valor: "Reservar ahora", porDefecto: "Agendar", obligatorio: false,
  });
  assert.deepEqual(r, { accion: "guardar", valor: null });
});

test("el default con espacios alrededor sigue siendo el default", () => {
  const r = resolverConfirmacion("  Agendar  ", { valor: null, porDefecto: "Agendar", obligatorio: false });
  assert.equal(r.accion, "nada");
});

test("ninguna confirmación puede mandar el literal como valor", () => {
  // Barrido: se prueba a confirmar el literal desde cualquier estado previo.
  const malos: string[] = [];
  for (const porDefecto of ["Agendar", "Tu salud, nuestra\nprioridad", "Preguntas frecuentes"]) {
    for (const valor of [null, "Otra cosa", porDefecto]) {
      for (const obligatorio of [false, true]) {
        const r = resolverConfirmacion(porDefecto, { valor, porDefecto, obligatorio });
        if (r.accion === "guardar" && r.valor !== null) {
          malos.push(`${JSON.stringify({ valor, porDefecto, obligatorio })} → ${JSON.stringify(r.valor)}`);
        }
      }
    }
  }
  assert.deepEqual(malos, [], "Se guardó el literal de la plantilla como si fuera texto de la clínica.");
});

/* ══════════════════════════════════════════════════════════════
   4 · Lo que sí se guarda, y lo que se borra
   ══════════════════════════════════════════════════════════════ */

test("escribir encima del default guarda lo escrito", () => {
  const r = resolverConfirmacion("Agendar cita", { valor: null, porDefecto: "Agendar", obligatorio: false });
  assert.deepEqual(r, { accion: "guardar", valor: "Agendar cita" });
});

test("vaciar un campo con valor propio manda null", () => {
  const r = resolverConfirmacion("   ", { valor: "Reservar ahora", porDefecto: "Agendar", obligatorio: false });
  assert.deepEqual(r, { accion: "guardar", valor: null });
});

test("vaciar un campo que ya estaba vacío no manda nada", () => {
  const r = resolverConfirmacion("", { valor: null, porDefecto: null, obligatorio: false });
  assert.equal(r.accion, "nada");
});

test("vaciar un campo obligatorio se rechaza y no escribe", () => {
  const r = resolverConfirmacion("", { valor: "Blanqueamiento", porDefecto: null, obligatorio: true });
  assert.deepEqual(r, { accion: "vacio-prohibido" });
});

test("el salto de línea sobrevive el viaje de ida y vuelta", () => {
  // Windows mete CRLF al pegar; lo que se guarda tiene que ser "\n" a secas,
  // porque es lo que la plantilla vuelve a pintar como <br/>.
  const r = resolverConfirmacion("Tu sonrisa,\r\nnuestra obsesión", {
    valor: null, porDefecto: "Tu salud, nuestra\nprioridad", obligatorio: false,
  });
  assert.deepEqual(r, { accion: "guardar", valor: "Tu sonrisa,\nnuestra obsesión" });
});

test("un titular multilínea editado en una sola línea se guarda sin salto", () => {
  const r = resolverConfirmacion("Tu salud, nuestra prioridad", {
    valor: null, porDefecto: "Tu salud, nuestra\nprioridad", obligatorio: false,
  });
  assert.deepEqual(r, { accion: "guardar", valor: "Tu salud, nuestra prioridad" });
});

test("cambiar solo el salto de sitio cuenta como cambio", () => {
  const r = resolverConfirmacion("Tu salud,\nnuestra prioridad", {
    valor: null, porDefecto: "Tu salud, nuestra\nprioridad", obligatorio: false,
  });
  assert.deepEqual(r, { accion: "guardar", valor: "Tu salud,\nnuestra prioridad" });
});

test("un campo sin literal no colapsa nada por accidente", () => {
  // Sin default, la comparación interna es contra "" — y "" solo empata con un
  // campo vacío, que ya se resolvió antes. Lo escrito se guarda tal cual.
  const r = resolverConfirmacion("Promoción de mayo", { valor: null, porDefecto: null, obligatorio: false });
  assert.deepEqual(r, { accion: "guardar", valor: "Promoción de mayo" });
});
