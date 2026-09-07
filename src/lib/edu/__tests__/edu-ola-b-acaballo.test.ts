/**
 * LAS DOS PIEZAS QUE LA OLA B DEJÓ A CABALLO — candados de montaje.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-ola-b-acaballo.test.ts
 *
 * ═══════════════════════════════════════════════════════════════════════
 * POR QUÉ EXISTE
 *
 * La Ola B se repartió en tres casillas y dos arreglos quedaron partidos
 * en dos mitades: una casilla escribió la CAPACIDAD y la otra tenía que
 * MONTARLA, en archivos que la primera no podía tocar sin pisarle la rama
 * a nadie. Las dos mitades se juntaron en la integración, y eso significa
 * que hoy nadie las prueba desde su propia rama.
 *
 * Estas pruebas son eso: que el montaje no se deshaga en la ola siguiente.
 * Son de LECTURA DE FUENTE —el mismo recurso que usa edu-theme.test.ts—
 * porque lo que hay que fijar es que un archivo LLAME a algo, y eso no se
 * puede comprobar ejecutando una función pura.
 *
 * Las dos piezas:
 *   1. Los chips «menor · tutor» y «embarazo/lactancia» en la cabecera de
 *      la ficha del paciente (la función es de ws2-t3, el layout de otra).
 *   2. El buscador del desplegable de pacientes al agendar (la búsqueda en
 *      servidor es de ws2-t3, los dos `<select>` son de otras).
 * ═══════════════════════════════════════════════════════════════════════
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(__dirname, "..", "..", "..", "..");

const LAYOUT_FICHA = "src/app/instituto/(panel)/pacientes/[id]/layout.tsx";
const SELECTOR = "src/components/edu/clinica/paciente-selector.tsx";
const AGENDA_MODALES = "src/components/edu/agenda/agenda-modales.tsx";
const TAMIZAJE = "src/components/edu/clinica/tamizaje-screen.tsx";
const NUCLEO = "src/lib/edu/pacientes-core.ts";

function crudo(...tramos: string[]): string {
  return readFileSync(join(RAIZ, ...tramos), "utf8");
}

// ═══════════════════════════════════════════════════════════════════════
// 1 · LOS CHIPS DE LA CABECERA
// ═══════════════════════════════════════════════════════════════════════

test("chips · el layout de la ficha MONTA eduPatientFichaChips", () => {
  const src = crudo(...LAYOUT_FICHA.split("/"));
  assert.ok(
    src.includes("eduPatientFichaChips"),
    "la cabecera de la ficha dejó de pintar los chips «menor · tutor» y «embarazo»: " +
      "la función existe en pacientes-core.ts y sin esta llamada no la usa nadie",
  );
  assert.ok(
    src.includes("edu-fichahero__chips"),
    "los chips salieron del hero: tienen que verse en TODAS las pestañas, no solo en Datos",
  );
});

test("chips · el layout les pasa los CINCO campos que la función pide", () => {
  const src = crudo(...LAYOUT_FICHA.split("/"));
  const i = src.indexOf("eduPatientFichaChips({");
  assert.ok(i > 0, "la llamada dejó de ser literal: revisa esta prueba junto con el cambio");
  const llamada = src.slice(i, src.indexOf("})", i));
  for (const campo of ["ageYears", "guardianName", "guardianRelation", "pregnancy", "isChild"]) {
    assert.ok(
      llamada.includes(`${campo}:`),
      `la llamada no pasa "${campo}": el chip que depende de ese campo deja de salir EN SILENCIO`,
    );
  }
});

test("chips · el mapa de iconos es el de EduFichaChipKind, no el de las alertas", () => {
  const src = crudo(...LAYOUT_FICHA.split("/"));
  // 🔴 El candado de verdad. `ALERT_ICONS` es un Record EXHAUSTIVO sobre
  // `EduAlertChipKind`: si alguien "simplifica" metiendo "menor" y
  // "embarazo" en aquella unión, este archivo deja de compilar. El aviso
  // vive aquí y en pacientes-core.ts, y la prueba gemela de
  // edu-ficha-completa.test.ts vigila el otro lado.
  assert.ok(
    src.includes("Record<EduFichaChipKind, LucideIcon>"),
    "los chips de la ficha perdieron su propio mapa de iconos",
  );
  assert.ok(
    src.includes("Record<EduAlertChipKind, LucideIcon>"),
    "el mapa de las alertas médicas ya no es exhaustivo: se puede colar un chip sin icono",
  );

  const nucleo = crudo(...NUCLEO.split("/"));
  const i = nucleo.indexOf("export type EduAlertChipKind");
  const union = nucleo.slice(i, nucleo.indexOf(";", i));
  assert.ok(!union.includes("menor"), "se amplió EduAlertChipKind: tumba el layout de la ficha");
  assert.ok(!union.includes("embarazo"), "se amplió EduAlertChipKind: tumba el layout de la ficha");
});

// ═══════════════════════════════════════════════════════════════════════
// 2 · EL BUSCADOR DEL DESPLEGABLE
// ═══════════════════════════════════════════════════════════════════════

test("buscador · el selector pega contra el endpoint con ?opciones=1&q=", () => {
  const src = crudo(...SELECTOR.split("/"));
  assert.ok(
    src.includes("/api/instituto/pacientes?opciones=1"),
    "el desplegable dejó de buscar en el SERVIDOR: filtrar en el navegador solo " +
      "filtra los 300 que ya bajaron, que es exactamente el fallo que esto arregla",
  );
  assert.ok(src.includes("q=${encodeURIComponent("), "el texto va sin escapar a la URL");
});

test("buscador · no dispara una consulta por tecla", () => {
  const src = crudo(...SELECTOR.split("/"));
  assert.ok(
    /const DEBOUNCE_MS = \d+/.test(src),
    "se perdió el debounce: «Zúñiga» son seis consultas a Postgres y seis respuestas " +
      "que pueden llegar desordenadas",
  );
  assert.ok(
    src.includes("turno.current"),
    "se perdió el guardia de respuestas tardías: la penúltima búsqueda puede pisar a la última",
  );
});

test("buscador · el elegido no se pierde al cambiar la búsqueda", () => {
  const src = crudo(...SELECTOR.split("/"));
  // Sin esto, el `<option>` del paciente elegido desaparece del DOM cuando
  // cambia la búsqueda: el `<select>` se pinta en blanco y el formulario
  // sigue llevando su id. Se agenda a alguien que la pantalla ya no dice.
  assert.ok(
    src.includes("elegido") && src.includes("[elegido, ...base]"),
    "el paciente elegido ya no se clava en la lista",
  );
});

test("buscador · LAS DOS pantallas montan el MISMO componente", () => {
  for (const pantalla of [AGENDA_MODALES, TAMIZAJE]) {
    const src = crudo(...pantalla.split("/"));
    assert.ok(
      src.includes("<EduPacienteSelector"),
      `${pantalla} volvió a su propio <select> de pacientes: dos copias es cómo una ` +
        `se queda sin el arreglo de la siguiente ola`,
    );
    assert.ok(
      !/\{patients\.map\(\(p\)/.test(src),
      `${pantalla} sigue pintando la lista a mano: el buscador no la alcanza`,
    );
  }
});

test("buscador · el `truncated` del servidor llega hasta las dos pantallas", () => {
  // No se deduce del largo de la lista: el servidor ya lo calcula y
  // deducirlo da un falso positivo cuando hay exactamente el tope.
  const modales = crudo(...AGENDA_MODALES.split("/"));
  assert.ok(
    modales.includes("inicialesTruncadas={patientsTruncated}"),
    "agendar dejó de avisar de que la lista viene recortada",
  );
  const tamizaje = crudo(...TAMIZAJE.split("/"));
  assert.ok(
    tamizaje.includes("inicialesTruncadas={patientsTruncated}"),
    "la valoración dejó de avisar de que la lista viene recortada",
  );
  const pagina = crudo("src", "app", "instituto", "(panel)", "agenda", "tamizaje", "page.tsx");
  assert.ok(
    pagina.includes("patientsTruncated={pacientes.truncated}"),
    "la página de valoración ya no pasa el truncated que le devuelve listEduPatientOptions",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 3 · EL NÚMERO DE PESTAÑAS
// ═══════════════════════════════════════════════════════════════════════

test("las pestañas de la ficha son DOCE, y los comentarios lo dicen", () => {
  const src = crudo(...LAYOUT_FICHA.split("/"));
  const cuantas = (src.match(/^\s*(?:key: "|\{ key: ")/gm) ?? []).length;
  // Se cuenta por `key:` dentro de `definicion`, que es la lista completa
  // ANTES de filtrar por permiso. Lo que ve una persona depende de sus
  // llaves; lo que se documenta es la lista.
  assert.equal(
    cuantas,
    12,
    "cambió el número de pestañas de la ficha: actualiza también los comentarios de " +
      "layout.tsx y paciente-tabs.tsx, que llevaban tres olas diciendo «DIEZ»",
  );
  assert.ok(!/DIEZ/.test(src), "layout.tsx vuelve a decir «DIEZ pestañas»");
  const tabs = crudo("src", "components", "edu", "expediente", "paciente-tabs.tsx");
  assert.ok(!/DIEZ/.test(tabs), "paciente-tabs.tsx vuelve a decir «DIEZ pestañas»");
});
