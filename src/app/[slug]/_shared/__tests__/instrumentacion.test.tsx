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

import { manifestOf, plantillaPinta, plantillasInstrumentadas, topeDeCopia } from "../template-manifest";
import { reglaDeCampo } from "../edit-labels";
import { EditProvider } from "../edit-runtime";
import {
  CARPETA_GOLDEN, CLINICA_FIXTURE, CLINICA_UN_DOCTOR, CLINICA_VACIA, PLANTILLAS_CON_GOLDEN,
  congelarReloj, elementoDePlantilla, htmlPublicado,
} from "./fixture";

congelarReloj();

/** Dónde vive el JSX de cada plantilla, para leerlo como texto. */
const FUENTES_DE_PLANTILLA: Record<string, string> = {
  classic:       "src/app/[slug]/landing-client.tsx",
  futurista:     "src/app/[slug]/templates/template-futurista.tsx",
  healthtech:    "src/app/[slug]/templates/template-healthtech.tsx",
  calido:        "src/app/[slug]/templates/template-calido.tsx",
  equipo:        "src/app/[slug]/templates/template-equipo.tsx",
  sonrisa:       "src/app/[slug]/templates/template-sonrisa.tsx",
  consultorio:   "src/app/[slug]/templates/template-consultorio.tsx",
  especialistas: "src/app/[slug]/templates/template-especialistas.tsx",
};

const golden = (tpl: string) =>
  readFileSync(join(process.cwd(), CARPETA_GOLDEN, `${tpl}.html`), "utf8");

/** El mismo árbol, pero con el runtime de edición puesto. */
const htmlEnEdicion = (tpl: string) =>
  renderToString(<EditProvider slug="aurora" tpl={tpl}>{elementoDePlantilla(tpl)}</EditProvider>);

/**
 * Los TRES estados de la plantilla, pegados.
 *
 * Una plantilla no pinta lo mismo según lo que tenga la clínica, y hay textos
 * y ranuras que solo existen en uno de esos estados:
 *   · llena       — el caso normal.
 *   · vacía       — el tercer acceso de `equipo` dice "Cómo llegar" en vez de
 *                   "Conócenos", y la tabla de horarios dice "Cerrado".
 *   · un doctor   — `sonrisa` cambia a retrato grande (ranura "doctor") y a la
 *                   lista de tratamientos con su rótulo.
 * Con un solo render, todo eso podría declararse en el manifiesto y no existir
 * en ninguna parte de la plantilla.
 */
const htmlDeTodosLosEstados = (tpl: string) =>
  [CLINICA_FIXTURE, CLINICA_VACIA, CLINICA_UN_DOCTOR]
    .map(c => renderToString(<EditProvider slug="aurora" tpl={tpl}>{elementoDePlantilla(tpl, c)}</EditProvider>))
    .join("");

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

  test(`${tpl}: cada texto suelto del manifiesto tiene su nodo editable`, () => {
    const html = htmlDeTodosLosEstados(tpl);
    const m = manifestOf(tpl);
    const faltan = (m.copia ?? [])
      .filter(c => !c.variante)
      .map(c => `copia:${c.clave}`)
      .filter(dir => !html.includes(`data-dc-txt="${dir}"`));
    assert.deepEqual(
      faltan, [],
      `El manifiesto de "${tpl}" declara textos sueltos que la plantilla no envuelve en <Txt>. ` +
      `O se instrumentan, o se quitan del manifiesto — declarados y sin nodo, la clínica no puede ` +
      `editarlos y aun así ocuparían sitio en landingCopy. Si el texto solo sale en otro estado ` +
      `(reseñas de Google, p. ej.), márcalo con "variante" y el motivo.`,
    );
  });

  test(`${tpl}: toda dirección tiene nombre humano en el manifiesto`, () => {
    // Las etiquetas ya no viajan en las props de cada <Txt> —eran 7 KB de
    // texto que nunca se pinta en público—: las resuelve el runtime desde el
    // manifiesto. Si una dirección no se resuelve, el editor enseña la
    // dirección cruda ("copia:hero.cta") como nombre del campo. Aquí se exige
    // que no quede ninguna.
    const html = htmlDeTodosLosEstados(tpl);
    const titulos = html.match(/title="([^"]*?) — clic para editar"/g) ?? [];
    const crudas = titulos.filter(t => /title="(copia:|sec:|servicio:|faq:|testimonio:|clinica:)/.test(t));
    assert.ok(titulos.length > 0, "no se encontró ni un campo editable");
    assert.deepEqual(
      crudas, [],
      `En "${tpl}" hay campos cuyo nombre no está en el manifiesto: el editor ` +
      `enseñaría la dirección cruda. Declara la clave en \`copia\` o el texto ` +
      `en \`textos\`, o pasa \`etiqueta\` desde la plantilla.`,
    );
  });

  test(`${tpl}: ningún texto suelto se declara dos veces`, () => {
    const claves = (manifestOf(tpl).copia ?? []).map(c => c.clave);
    const repetidas = claves.filter((c, i) => claves.indexOf(c) !== i);
    assert.deepEqual(repetidas, [], `Claves repetidas en el manifiesto de "${tpl}".`);
  });

  test(`${tpl}: cada ranura de foto del manifiesto tiene su hueco`, () => {
    // Los tres estados, por lo mismo que los textos: la ranura "doctor" de
    // `sonrisa` solo existe cuando la clínica tiene UN doctor.
    const html = htmlDeTodosLosEstados(tpl);
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

/**
 * El manifiesto dice qué datos sueltos pinta cada plantilla, y el formulario
 * avisa con eso ("«X» no pinta este aviso; se guarda y aparece al cambiar de
 * plantilla"). Si la declaración se separa del JSX, ese aviso miente — que es
 * exactamente lo que la Ola 1 vino a quitar.
 */
for (const [tpl, fuente] of Object.entries(FUENTES_DE_PLANTILLA)) {
  test(`${tpl}: lo que el manifiesto dice que pinta es lo que pinta`, () => {
    const src = readFileSync(join(process.cwd(), fuente), "utf8");
    for (const [que, marca] of [["urgencias", /landingUrgentText|urgentText\(/], ["msi", /landingMsiPlazos|msiPlazos\(/]] as const) {
      assert.equal(
        plantillaPinta(tpl, que as "urgencias" | "msi"),
        marca.test(src),
        `El manifiesto de "${tpl}" y su JSX no dicen lo mismo sobre "${que}". ` +
        `El formulario avisa con el manifiesto: si se separan, le miente a la clínica.`,
      );
    }
  });
}

/**
 * El campo del lienzo no puede aceptar más de lo que el PATCH guarda.
 *
 * Cuando el `maxLen` se escribía a mano en cada <Txt> se separó de la regla:
 * diez botones dejaban escribir 80 caracteres donde el servidor acepta 60, así
 * que la clínica escribía, `aplicarDireccion` descartaba el cambio por pasarse
 * del tope, y el texto volvía atrás SIN DECIR NADA. Ahora el campo lo resuelve
 * de la misma fuente; esto lo fija.
 */
test("el tope del campo nunca supera el que aplica el servidor", () => {
  const malos: string[] = [];
  for (const tpl of plantillasInstrumentadas()) {
    for (const c of manifestOf(tpl).copia ?? []) {
      const campo = reglaDeCampo(`copia:${c.clave}`, tpl).maxLen;
      const servidor = topeDeCopia(c.clave);
      if (campo > servidor) malos.push(`${tpl}/${c.clave}: campo ${campo} > servidor ${servidor}`);
    }
  }
  assert.deepEqual(malos, [], "Hay campos que dejan escribir más de lo que se puede guardar.");
});

/**
 * Y el literal de la plantilla tiene que caber en su propio campo.
 *
 * Antes daba igual: el campo abría vacío, así que un default de 180
 * caracteres en un campo de 160 no molestaba a nadie. Ahora el campo abre
 * PRECARGADO con ese literal, y uno que se pase del tope abre ya en rojo,
 * con el contador desbordado y sin dejar escribir una letra más — la clínica
 * tendría que recortar el texto que ella no escribió para poder tocarlo.
 */
test("todo texto por defecto del manifiesto cabe en su propio campo", () => {
  const malos: string[] = [];
  for (const tpl of plantillasInstrumentadas()) {
    const m = manifestOf(tpl);
    for (const c of m.copia ?? []) {
      const tope = reglaDeCampo(`copia:${c.clave}`, tpl).maxLen;
      if (c.porDefecto.length > tope) malos.push(`${tpl}/copia:${c.clave}: ${c.porDefecto.length} > ${tope}`);
    }
    for (const t of m.textos) {
      const tope = reglaDeCampo(`sec:${t.seccion}:${t.campo}`, tpl).maxLen;
      if (t.porDefecto.length > tope) malos.push(`${tpl}/sec:${t.seccion}:${t.campo}: ${t.porDefecto.length} > ${tope}`);
    }
  }
  assert.deepEqual(malos, [], "Hay literales de plantilla más largos que el campo con el que se precargan.");
});

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
