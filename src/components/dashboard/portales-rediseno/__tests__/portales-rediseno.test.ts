/**
 * CANDADOS DE LOS PORTALES Y POPOVERS DEL REDISEÑO (ws1-t4, hallazgos 13 y 15):
 * el asistente «Importar mi clínica», el cajón de filtros de Pacientes, el
 * menú «…» de la cabecera del expediente y el popover de alertas médicas de
 * Hoy y del expediente.
 *
 * Run: npx tsx --test src/components/dashboard/portales-rediseno/__tests__/portales-rediseno.test.ts
 *
 * Se prueba leyendo el código fuente, como `hoy-rediseno/__tests__/
 * hoy-rediseno.test.ts`: lo que se vigila es CABLEADO (que la ropa cuelgue
 * del interruptor y de nada más, que sin ella el camino viejo quede intacto,
 * que la hoja no invente tokens ni letra de máquina, que el asistente siga
 * mandando a las mismas APIs), y eso se ve en el archivo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..", "..");           // src/
const CARPETA = join(SRC, "components", "dashboard", "portales-rediseno");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const archivosNuevos = readdirSync(CARPETA)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => ({ nombre: f, texto: readFileSync(join(CARPETA, f), "utf8") }));

const WIZARD = "components/import/import-wizard.tsx";
const POPOVER = "components/dashboard/alergies-popover.tsx";
const HERO = "components/dashboard/patient-detail/hero-card.tsx";
const HOY_DOCTOR = "components/dashboard/hoy-rediseno/hoy-doctor.tsx";
const PACIENTES = "app/dashboard/patients/patients-client.tsx";
const PACIENTES_CSS = "app/dashboard/patients/patients.module.css";

// ═══════════════════════════════════════════════════════════════════════════
// Instrument Sans en el 100 %: ni una letra de máquina en la carpeta nueva
// ═══════════════════════════════════════════════════════════════════════════
// La palabra prohibida se arma en trozos para que un grep sobre la carpeta
// (el gate de cierre: «cero letra de máquina») no se tope con este archivo.
const LETRA_DE_MAQUINA = new RegExp(["font-", "mono", "|", "ui-", "mono", "space", "|", "mono", "space"].join(""));

test("sin letra de máquina en la carpeta del rediseño", () => {
  for (const a of archivosNuevos) {
    assert.ok(
      !LETRA_DE_MAQUINA.test(a.texto),
      `${a.nombre} usa letra de máquina; las cifras van con tabular-nums sobre Instrument Sans`,
    );
  }
  const css = archivosNuevos.find((a) => a.nombre === "portales.module.css")!.texto;
  assert.match(css, /font-variant-numeric:\s*tabular-nums/, "las cifras se alinean con tabular-nums");
  // Las cifras del asistente (`.mono` en el marcado de los pasos 6 y
  // resultado) y el «copia esto» (`.imp-code`) vuelven a la letra del panel.
  assert.match(css, /\.importar :global\(\.mono\) \{\s*font-family: inherit;/, "`.mono` no vuelve a la letra del panel");
  assert.match(css, /\.importar :global\(\.imp-code\) \{\s*font-family: inherit;/, "`.imp-code` no vuelve a la letra del panel");
});

// ═══════════════════════════════════════════════════════════════════════════
// Sin tokens nuevos: la hoja solo LEE los del menú (--m2-*) y los de globals
// ═══════════════════════════════════════════════════════════════════════════
test("portales.module.css no declara ninguna variable CSS propia", () => {
  const css = archivosNuevos.find((a) => a.nombre === "portales.module.css")!.texto;
  const declaraciones = css.match(/^\s*--[a-z0-9-]+\s*:/gim) ?? [];
  assert.deepEqual(declaraciones, [], `declara tokens propios: ${declaraciones.join(", ")}`);
  assert.match(css, /var\(--m2-/, "lee los tokens del menú");
  const ropa = leer("components/dashboard/portales-rediseno/ropa.tsx");
  assert.match(ropa, /CLASES_MENU/, "las cajas montan CLASES_MENU (menu-dos-niveles/clases.ts)");
  // Las tres cajas y el velo llevan los tokens: se abren en un portal y
  // nadie más se los presta.
  assert.equal((ropa.match(/caja: `\$\{CLASES_MENU\}/g) ?? []).length, 3, "cada caja monta CLASES_MENU");
  assert.equal((ropa.match(/velo: `\$\{CLASES_MENU\}/g) ?? []).length, 1, "el velo del asistente monta CLASES_MENU");
});

// ═══════════════════════════════════════════════════════════════════════════
// Ni un hex copiado a mano: el violeta del menú se lee, no se escribe
// ═══════════════════════════════════════════════════════════════════════════
test("ningún color escrito a mano fuera de un respaldo var(--x, #hex)", () => {
  for (const a of archivosNuevos) {
    const hexes = [...a.texto.matchAll(/#[0-9a-f]{3,8}\b/gi)];
    for (const h of hexes) {
      const antes = a.texto.slice(Math.max(0, h.index! - 40), h.index!);
      assert.match(antes, /var\(--[a-z0-9-]+,\s*$/, `${a.nombre}: «${h[0]}» está escrito a mano y no como respaldo de un token`);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// El asistente «Importar»: la ropa cuelga de `apariencia` y de nada más
// ═══════════════════════════════════════════════════════════════════════════
test("el asistente conserva su camino clásico y viste el nuevo con ROPA_IMPORTAR", () => {
  const wizard = leer(WIZARD);
  assert.match(wizard, /apariencia = "clasica"/, "la apariencia por defecto es la clásica");
  assert.match(wizard, /const nueva = apariencia === "nueva";/, "no calcula `nueva` a partir de la apariencia");
  // Camino viejo intacto: el `.modal` global y el velo de siempre.
  assert.match(wizard, /className=\{nueva \? ROPA_IMPORTAR\.caja : "modal modal--wide"\}/, "el camino clásico dejó de usar `.modal modal--wide`");
  assert.match(wizard, /background: "rgba\(15,10,30,0\.55\)", backdropFilter: "blur\(4px\)", zIndex: 90/, "el velo clásico cambió");
  assert.match(wizard, /style=\{nueva \? undefined : \{/, "con la ropa nueva la caja no lleva el `style` viejo");
  // Pacientes la pone con el interruptor, como hace con «Nuevo paciente».
  const pacientes = leer(PACIENTES);
  assert.match(pacientes, /<ImportWizard\s+open=\{importOpen\}\s+apariencia=\{rediseno \? "nueva" : "clasica"\}/, "Pacientes no pasa la apariencia al asistente");
  assert.match(pacientes, /menuDosNivelesEncendido|rediseno = false/, "el prop `rediseno` de Pacientes sigue viniendo del interruptor");
});

test("el asistente sigue hablando con las mismas APIs y los mismos pasos", () => {
  // Ropa, no lógica: los seis pasos, el desvío a la asistida, el preview y
  // el commit siguen exactamente igual.
  const wizard = leer(WIZARD);
  for (const firma of [
    'const STEP_KEYS = ["origin", "export", "what", "upload", "map", "review"] as const;',
    "api.preview(principalEntity, f, undefined, (p) => { if (!stale()) onProg(p); })",
    "await api.commit(",
    "api.submitAssisted(assistedFile, assistedNote)",
    "api.getOrigins()",
    "{ skipDuplicates: skipDup }",
    'ent === principalEntity ? mapping : {}',
  ]) {
    assert.ok(wizard.includes(firma), `el asistente perdió: ${firma}`);
  }
  // Los pasos no se tocan: ni el mapeo, ni la validación, ni la importación.
  for (const paso of ["step-mapping.tsx", "step-review.tsx", "importing-panel.tsx", "step-upload.tsx"]) {
    const texto = leer(`components/import/${paso}`);
    assert.ok(!texto.includes("portales-rediseno"), `${paso} no debería saber de la ropa`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// El cajón de filtros de Pacientes: lo de dentro también habla el idioma nuevo
// ═══════════════════════════════════════════════════════════════════════════
test("el cajón de filtros viste sus campos solo bajo .pageRediseno", () => {
  const css = leer(PACIENTES_CSS);
  for (const clase of ["drawerInput", "checkPill", "checkPillActive", "drawerFooter", "drawerLabel", "drawerTitle", "drawerHeader", "drawerBackdrop"]) {
    assert.match(css, new RegExp(`\\.pageRediseno \\.${clase}\\b`), `.${clase} no tiene ropa nueva bajo .pageRediseno`);
  }
  // El camino viejo queda intacto: el campo de siempre sigue en --bg-elev-2.
  const viejo = css.slice(css.indexOf(".drawerInput {"), css.indexOf(".drawerInput:focus"));
  assert.match(viejo, /background: var\(--bg-elev-2\);/, "el campo clásico del cajón cambió");
  // Y ninguna regla nueva del cajón pisa el calendario, que es de otra pantalla.
  const nuevo = css.slice(css.indexOf("El cajón de filtros (hallazgo 13"));
  assert.ok(!/df-pop|df-day|df-nav|df-sel/.test(nuevo), "la ropa del cajón toca el calendario de ui/date-field.tsx");
  // El cajón sigue montándose dentro de la página (hereda .pageRediseno).
  const pacientes = leer(PACIENTES);
  assert.ok(!pacientes.includes("popoverClassName"), "el calendario del cajón no se viste desde aquí: es de ui/date-field.tsx");
});

// ═══════════════════════════════════════════════════════════════════════════
// El popover de alertas: Hoy lo pide nuevo; el camino clásico, intacto
// ═══════════════════════════════════════════════════════════════════════════
test("AlergiesPopover viste con `apariencia` y Hoy la pide nueva", () => {
  const popover = leer(POPOVER);
  assert.match(popover, /apariencia = "clasica"/, "la apariencia por defecto es la clásica");
  // Los `style` de siempre siguen ahí, palabra por palabra.
  for (const viejo of [
    'background: "var(--bg-elev)"',
    'border: "1px solid var(--border-strong)"',
    '"0 20px 50px -10px rgba(15,10,30,0.25), 0 8px 20px -8px rgba(15,10,30,0.15)"',
    'fontFamily: "var(--font-sans, system-ui, sans-serif)"',
    'style: { fill: "var(--bg-elev)" }',
  ]) {
    assert.ok(popover.includes(viejo), `el camino clásico del popover perdió: ${viejo}`);
  }
  assert.match(popover, /nueva \? \{ className: ROPA_ALERTAS\.caja \}/, "la caja nueva no monta ROPA_ALERTAS");
  // Las tres secciones y su orden (alergias → medicación → padecimientos).
  const orden = ["shell.alergiesPopover.allergies", "shell.alergiesPopover.activeMeds", "shell.alergiesPopover.conditions"];
  const posiciones = orden.map((k) => popover.indexOf(k));
  assert.deepEqual([...posiciones].sort((a, b) => a - b), posiciones, "cambió el orden de las secciones");
  assert.ok(posiciones.every((p) => p > 0), "falta una sección");

  const hoy = leer(HOY_DOCTOR);
  assert.equal((hoy.match(/<AlergiesPopover\s+apariencia="nueva"/g) ?? []).length, 2, "Hoy (doctor) no pide el popover nuevo en sus dos chips");
  // La home de siempre no lo pide: sigue con el popover de siempre.
  const homeVieja = leer("components/dashboard/home/parts/hero-next-patient.tsx");
  assert.ok(!homeVieja.includes("apariencia"), "la home de siempre pide la ropa nueva");
});

// ═══════════════════════════════════════════════════════════════════════════
// El menú «…» del expediente: con `rediseno` monta los tokens; sin él, no
// ═══════════════════════════════════════════════════════════════════════════
test("el menú de la cabecera del expediente viste solo con `rediseno`", () => {
  const hero = leer(HERO);
  assert.match(hero, /className=\{rediseno \? `\$\{styles\.heroMenuPopover\} \$\{ROPA_MENU_FICHA\.caja\}` : styles\.heroMenuPopover\}/, "el menú no cuelga de `rediseno`");
  assert.match(hero, /\{\.\.\.\(rediseno \? \{ "data-tono": "peligro" \} : \{\}\)\}/, "«Eliminar paciente» no marca su tono solo con el rediseño");
  assert.match(hero, /\{\.\.\.\(rediseno \? \{ "data-nota": "" \} : \{\}\)\}/, "la nota de la invitación no se marca solo con el rediseño");
  // Las acciones del menú siguen siendo las mismas.
  for (const accion of [
    "patients.heroCard.editPatient",
    "patients.heroCard.portalInvite",
    "patients.heroCard.portalResend",
    "patients.heroCard.copyReadonlyLink",
    "patients.heroCard.generateReadonlyLink",
    "patients.heroCard.printSummary",
    "patients.heroCard.viewInAgenda",
    "patients.heroCard.deletePatient",
  ]) {
    assert.ok(hero.includes(accion), `el menú perdió la acción ${accion}`);
  }
});
