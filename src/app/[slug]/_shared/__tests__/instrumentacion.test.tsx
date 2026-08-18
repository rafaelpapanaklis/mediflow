/* ============================================================
   LA PRUEBA DE LAS PLANTILLAS DE LANDING.

     npm run test:landing

   Dos afirmaciones, y la segunda es la que de verdad protege:

   1. MANIFIESTO ↔ INSTRUMENTACIÓN. Por cada plantilla marcada
      `instrumentada`, existe un nodo editable por cada texto y una
      ranura por cada foto que declara su manifiesto. Es lo que evita
      que una plantilla nazca medio editable en silencio: declararla y
      olvidarse de un <Txt> deja de ser un descubrimiento del cliente.

   2. HTML BYTE-IDÉNTICO SIN EL PROVEEDOR. Las ocho plantillas, con o
      sin instrumentar, tienen que pintar EXACTAMENTE el HTML guardado
      en html-publicado/. Esos archivos se generaron antes de tocar
      nada. Si envolver un título en <Txt> añadiera un <span>, moviera
      un atributo o metiera una marca de hidratación, el diff sale
      aquí — que es la única señal que llega ANTES del deploy, porque
      las previews de Vercel están apagadas y el push va directo a
      main sobre las páginas indexadas de clínicas que pagan.

   Si un cambio en la página pública es DELIBERADO:
     npx tsx --tsconfig tsconfig.test.json scripts/landing-golden.ts
   y se revisa el diff del .html antes de commitear. Regenerar sin
   mirar es apagar la alarma.
   ============================================================ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToString } from "react-dom/server";

import { manifestOf, plantillasInstrumentadas } from "../template-manifest";
import { EditProvider } from "../edit-runtime";
import {
  CARPETA_GOLDEN, PLANTILLAS_CON_GOLDEN,
  congelarReloj, elementoDePlantilla, htmlPublicado,
} from "./fixture";

congelarReloj();

const golden = (tpl: string) =>
  readFileSync(join(process.cwd(), CARPETA_GOLDEN, `${tpl}.html`), "utf8");

/** El mismo árbol, pero con el runtime de edición puesto. */
const htmlEnEdicion = (tpl: string) =>
  renderToString(<EditProvider slug="aurora">{elementoDePlantilla(tpl)}</EditProvider>);

/* ══════════════════════════════════════════════════════════════
   1 · Todo lo declarado tiene su nodo
   ══════════════════════════════════════════════════════════════ */

for (const tpl of plantillasInstrumentadas()) {
  test(`${tpl}: cada texto del manifiesto tiene su nodo editable`, () => {
    const html = htmlEnEdicion(tpl);
    const m = manifestOf(tpl);
    const faltan = m.textos
      .map(t => `sec:${t.seccion}:${t.campo}`)
      .filter(dir => !html.includes(`data-dc-txt="${dir}"`));
    assert.deepEqual(
      faltan, [],
      `El manifiesto de "${tpl}" declara textos que la plantilla no envuelve en <Txt>. ` +
      `O se instrumentan, o se quitan del manifiesto — pero no pueden salir en el editor ` +
      `de Diseño y no existir en el lienzo.`,
    );
  });

  test(`${tpl}: cada ranura de foto del manifiesto tiene su hueco`, () => {
    const html = htmlEnEdicion(tpl);
    const m = manifestOf(tpl);
    const faltan = m.fotos
      .map(f => f.id)
      .filter(id => !html.includes(`data-dc-foto="${id}"`));
    assert.deepEqual(
      faltan, [],
      `El manifiesto de "${tpl}" declara ranuras de foto que la plantilla no envuelve en <Foto>.`,
    );
  });
}

test("hay al menos una plantilla instrumentada", () => {
  assert.ok(plantillasInstrumentadas().length > 0);
});

/* ══════════════════════════════════════════════════════════════
   2 · Sin proveedor, el HTML público no se movió
   ══════════════════════════════════════════════════════════════ */

for (const tpl of PLANTILLAS_CON_GOLDEN) {
  test(`${tpl}: el HTML público es idéntico al de referencia`, () => {
    const ahora = htmlPublicado(tpl);
    const antes = golden(tpl);
    if (ahora === antes) return;

    // Un assert de 40 KB contra 40 KB no se lee. Se señala el primer byte
    // que cambió con su contexto, que es lo que hace falta para decidir si
    // el cambio era la intención.
    let i = 0;
    while (i < antes.length && i < ahora.length && antes[i] === ahora[i]) i++;
    const ventana = (s: string) => JSON.stringify(s.slice(Math.max(0, i - 120), i + 160));
    assert.fail(
      `El HTML público de "${tpl}" cambió (byte ${i} de ${antes.length}).\n\n` +
      `  antes: ${ventana(antes)}\n\n` +
      `  ahora: ${ventana(ahora)}\n\n` +
      `Si el cambio es deliberado:\n` +
      `  npx tsx --tsconfig tsconfig.test.json scripts/landing-golden.ts\n` +
      `y revisa el diff del .html antes de commitear.`,
    );
  });
}

/* ══════════════════════════════════════════════════════════════
   3 · El modo edición añade cosas, no las quita
   ══════════════════════════════════════════════════════════════ */

for (const tpl of plantillasInstrumentadas()) {
  test(`${tpl}: en edición sigue pintando el texto por defecto de la plantilla`, () => {
    const html = htmlEnEdicion(tpl);
    const m = manifestOf(tpl);
    // La clínica de prueba no tiene landingSections, así que todo lo que se
    // ve son los literales de la plantilla. Si el lienzo enseñara el
    // marcador de posición en su lugar, la clínica creería que su título
    // está vacío y lo reescribiría encima del que ya funciona.
    const conDefault = m.textos.filter(t => t.campo === "titulo" && t.porDefecto);
    assert.ok(conDefault.length > 0, "el manifiesto no declara ningún título con texto por defecto");
    assert.ok(!html.includes("Escribe aquí"), "salió el marcador genérico donde debía haber un texto");
  });
}
