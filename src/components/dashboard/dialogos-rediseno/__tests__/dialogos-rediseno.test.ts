/**
 * CANDADOS DE LOS DIÁLOGOS DEL REDISEÑO (ws1-t5, hallazgos 6 y 7):
 * «Nuevo paciente» y las confirmaciones «¿seguro?» del ConfirmProvider.
 *
 * Run: npx tsx --test src/components/dashboard/dialogos-rediseno/__tests__/dialogos-rediseno.test.ts
 *
 * Se prueba leyendo el código fuente, como `hoy-rediseno/__tests__/
 * hoy-rediseno.test.ts`: lo que se vigila es CABLEADO (que la ropa cuelgue
 * del interruptor y de nada más, que sin ella el camino viejo quede intacto,
 * que la hoja no invente tokens ni letra de máquina, que los textos de las
 * confirmaciones no cambien), y eso se ve en el archivo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..", "..");           // src/
const CARPETA = join(SRC, "components", "dashboard", "dialogos-rediseno");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const archivosNuevos = readdirSync(CARPETA)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => ({ nombre: f, texto: readFileSync(join(CARPETA, f), "utf8") }));

const CONFIRM = "components/ui/confirm-dialog.tsx";
const MODAL = "components/dashboard/new-patient-modal.tsx";
const PROVIDER = "components/dashboard/new-patient/new-patient-provider.tsx";
const LAYOUT = "app/dashboard/layout.tsx";
const PACIENTES = "app/dashboard/patients/patients-client.tsx";

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
  const css = archivosNuevos.find((a) => a.nombre === "dialogos.module.css")!.texto;
  assert.match(css, /font-variant-numeric:\s*tabular-nums/, "las cifras se alinean con tabular-nums");
});

test("el camino NUEVO del alta de paciente no pide la letra de máquina", () => {
  // La CURP llevaba `--font-mono` en línea; con la ropa nueva va en la letra
  // del panel, como el resto de datos administrativos (tipografia-panel.tsx).
  const modal = leer(MODAL);
  const fin = modal.indexOf('placeholder="GOPA');
  assert.ok(fin > 0, "no se encontró el campo de la CURP");
  const curp = modal.slice(modal.lastIndexOf("<input", fin), fin);
  assert.match(curp, /nueva\s*\?\s*\{\s*textTransform/, "la rama nueva de la CURP no lleva fontFamily");
  assert.match(curp, /:\s*\{\s*fontFamily:\s*"var\(--font-mono, monospace\)"/, "la rama clásica de la CURP conserva la letra de siempre");
});

// ═══════════════════════════════════════════════════════════════════════════
// Sin tokens nuevos: la hoja solo LEE los del menú (--m2-*) y los de globals
// ═══════════════════════════════════════════════════════════════════════════
test("dialogos.module.css no declara ninguna variable CSS propia", () => {
  const css = archivosNuevos.find((a) => a.nombre === "dialogos.module.css")!.texto;
  const declaraciones = css.match(/^\s*--[a-z0-9-]+\s*:/gim) ?? [];
  assert.deepEqual(declaraciones, [], `declara tokens propios: ${declaraciones.join(", ")}`);
  assert.match(css, /var\(--m2-/, "lee los tokens del menú");
  const ropa = leer("components/dashboard/dialogos-rediseno/vestir-dialogos.tsx");
  assert.match(ropa, /CLASES_MENU/, "las cajas montan CLASES_MENU (menu-dos-niveles/clases.ts)");
  // Las dos cajas y los dos velos llevan los tokens: se abren en un portal y
  // nadie más se los presta.
  for (const pieza of ["velo: `${CLASES_MENU}", "caja: `${CLASES_MENU}"]) {
    assert.equal((ropa.match(new RegExp(pieza.replace(/[$`{}]/g, "\\$&"), "g")) ?? []).length, 2, `${pieza} en la confirmación y en el alta`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Ni un hex copiado a mano: el violeta del menú se lee, no se escribe
// ═══════════════════════════════════════════════════════════════════════════
test("la carpeta del rediseño no escribe ningún color en hex", () => {
  for (const a of archivosNuevos) {
    const sueltos = a.texto.split("\n").filter((l) => /#[0-9a-f]{3,8}\b/i.test(l) && !/var\(--/.test(l));
    assert.deepEqual(sueltos, [], `${a.nombre} escribe un color a mano:\n${sueltos.join("\n")}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// La ropa cuelga del interruptor del menú, y de nada más
// ═══════════════════════════════════════════════════════════════════════════
test("el layout viste los dos diálogos SOLO con menuDosNiveles", () => {
  const layout = leer(LAYOUT);
  assert.match(layout, /<NewPatientProvider apariencia=\{menuDosNiveles \? "nueva" : "clasica"\}>/, "Nuevo paciente por prop, como Nueva cita");
  assert.match(layout, /<NewAppointmentProvider apariencia=\{menuDosNiveles \? "nueva" : "clasica"\}>/, "Nueva cita sigue igual");
  // VestirDialogos es un ENVOLTORIO de hijo único con el interruptor como
  // prop, no un hijo más del layout: apagado, el árbol de siempre no gana ni
  // una ranura (los useId del panel no se mueven) y el menú sigue eligiéndose
  // con el mismo «encendido ? nuevo : de siempre» de antes.
  assert.equal((layout.match(/<VestirDialogos activo=\{menuDosNiveles\}>/g) ?? []).length, 1, "se monta una sola vez, con el interruptor");
  assert.equal((layout.match(/<\/VestirDialogos>/g) ?? []).length, 1);
  assert.match(layout, /<VestirDialogos activo=\{menuDosNiveles\}>\s*<NewPatientProvider/, "envuelve al provider de Nuevo paciente");
  assert.match(layout, /menuDosNiveles \? \(\s*<MenuDosNivelesServidor/, "la elección del menú sigue tal cual");
  const ropa = leer("components/dashboard/dialogos-rediseno/vestir-dialogos.tsx");
  assert.match(ropa, /useVestirConfirm\(activo \? ROPA_CONFIRM : null\);/);
  assert.match(ropa, /return <>\{children\}<\/>;/, "no pinta nada propio");
});

test("Pacientes viste su copia del modal con el mismo interruptor", () => {
  assert.match(leer(PACIENTES), /<NewPatientModal\s+open=\{newPatientOpen\}\s+apariencia=\{rediseno \? "nueva" : "clasica"\}/);
});

test("el provider pasa la apariencia y por defecto es la clásica", () => {
  const provider = leer(PROVIDER);
  assert.match(provider, /apariencia = "clasica"/, "sin prop, la ropa de siempre");
  assert.match(provider, /apariencia=\{apariencia\}/, "y se la pasa al modal");
  const modal = leer(MODAL);
  assert.match(modal, /apariencia = "clasica" \}: Props/, "el modal también arranca en clásica");
  assert.match(modal, /const nueva = apariencia === "nueva";/);
});

// ═══════════════════════════════════════════════════════════════════════════
// El camino viejo sigue vivo: sin ropa, los `style` de siempre, sin clase
// ═══════════════════════════════════════════════════════════════════════════
test("ConfirmProvider: sin ropa montada, cada pieza recibe sus style de siempre", () => {
  const confirm = leer(CONFIRM);
  assert.match(confirm, /useState<ConfirmRopa \| null>\(null\)/, "arranca sin ropa");
  assert.match(confirm, /ropa \? \{ className: ropa\[pieza\] \} : \{ style: clasico \}/, "vestir(): style O className, nunca los dos");
  // Los valores de siempre siguen escritos tal cual: velo, caja, botones.
  for (const literal of [
    'background: "rgba(5,5,10,0.72)"',
    'zIndex: 200,',
    'zIndex: 201,',
    'maxWidth: 420,',
    'background: "var(--bg-elev)"',
    'animation: "mfConfirmSlide 0.2s cubic-bezier(0.16, 1, 0.3, 1)"',
    'className={ropa ? ropa.motivoCampo : "input-new"}',
    'style={ropa ? undefined : { width: "100%", resize: "vertical", minHeight: 64 }}',
    '{...(ropa ? { "data-tono": variant } : {})}',
  ]) {
    assert.ok(confirm.includes(literal), `el camino viejo perdió: ${literal}`);
  }
  // La ropa la monta un descendiente por hook (sin nodo) y se quita al desmontarse.
  assert.match(confirm, /export function useVestirConfirm\(ropa: ConfirmRopa \| null\): void/);
  assert.match(confirm, /if \(!vestir \|\| !ropa\) return;/);
  assert.match(confirm, /return \(\) => vestir\(null\);/);
});

test("ConfirmProvider: ni los textos ni las variantes cambian con la ropa", () => {
  const confirm = leer(CONFIRM);
  for (const texto of ['"¿Estás seguro?"', '"Motivo (opcional)"', '"Agrega una nota…"', '"Cancelar"', '"Eliminar"', '"Continuar"', '"Confirmar"', 'aria-label="Cerrar"']) {
    assert.ok(confirm.includes(texto), `cambió el texto ${texto}`);
  }
  assert.match(confirm, /export type ConfirmVariant = "default" \| "danger" \| "warning";/);
  assert.match(confirm, /if \(variant === "danger"\) return "Eliminar";/);
  assert.match(confirm, /if \(variant === "warning"\) return "Continuar";/);
  // Aceptar y cancelar hacen lo mismo de siempre.
  assert.match(confirm, /onClick=\{\(\) => handleResult\(false\)\}/);
  assert.match(confirm, /onClick=\{\(\) => handleResult\(true\)\}\s+autoFocus/);
  assert.match(confirm, /r\(\{ confirmed, reason: confirmed && reason \? reason : undefined \}\);/);
});

test("Nuevo paciente: sin la ropa, la caja es `.modal` con sus style de siempre", () => {
  const modal = leer(MODAL);
  assert.match(modal, /className=\{nueva \? ROPA_ALTA_PACIENTE\.caja : "modal"\}/);
  for (const literal of [
    'background: "rgba(15,10,30,0.55)"',
    'backdropFilter: "blur(4px)"',
    'zIndex: 90,',
    'zIndex: 91,',
    'maxHeight: "92vh"',
    'style: { fontSize: 11, color: "var(--text-3)", padding: "6px 4px" }',
    'style: { fontSize: 12, color: "var(--text-2)", cursor: "pointer" }',
    ': { height: 64, paddingTop: 8, resize: "vertical" }',
    ': "text-xs font-bold px-3.5 py-2.5 rounded-lg bg-[var(--brand)]',
  ]) {
    assert.ok(modal.includes(literal), `el camino viejo perdió: ${literal}`);
  }
  // Los seis obligatorios siguen marcando el error con su borde en línea de
  // siempre (esas líneas no se tocaron), y el POST no cambia.
  for (const clave of ["firstName", "lastName", "dob", "gender", "phone", "allergies"]) {
    assert.ok(modal.includes(`borderColor: errors.${clave} ?`), `el campo ${clave} perdió su borde de error`);
    assert.ok(modal.includes(`newErrors.${clave} = true`), `${clave} dejó de ser obligatorio`);
  }
  assert.match(modal, /fetch\("\/api\/patients", \{\s*method: "POST"/);
  assert.match(modal, /window\.confirm\(\s*t\("shell\.newPatient\.confirmDuplicate"/, "el aviso de duplicado sigue igual");
});

// ═══════════════════════════════════════════════════════════════════════════
// Nada compartido del menú se tocó: clases.ts y su carpeta son solo lectura
// ═══════════════════════════════════════════════════════════════════════════
test("clases.ts sigue exportando CLASES_MENU tal cual", () => {
  const clases = leer("components/dashboard/menu-dos-niveles/clases.ts");
  assert.match(clases, /export const CLASES_MENU = \[s\.tokens, instrumentSans\.variable, materialSymbols\.variable\]\.join\(" "\);/);
});
