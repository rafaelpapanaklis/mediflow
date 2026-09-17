/**
 * CANDADOS DE LAS VENTANAS Y EL MODO OSCURO DE LA AGENDA NUEVA (ws1-t1,
 * hallazgos 9 y 18 de la auditoría del rediseño).
 *
 * Run: npm run test:agenda-nueva-ventanas-oscuro
 *
 * Se prueba leyendo el código fuente, como `hoy-rediseno.test.ts`: lo que se
 * vigila es CABLEADO —que las ventanas compartidas solo cambien de ropa
 * cuando la agenda nueva se la pasa, que el camino viejo no la conozca, que
 * cada color de la agenda tenga su tono oscuro y se lea del menú, que no
 * haya letra de máquina— y eso se ve en el archivo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..", "..");           // src/
const CARPETA = join(SRC, "components", "dashboard", "agenda-nueva");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const archivosNuevos = readdirSync(CARPETA)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => ({ nombre: f, texto: readFileSync(join(CARPETA, f), "utf8") }));

const CSS = archivosNuevos.find((a) => a.nombre === "agenda-nueva.module.css")!.texto;
const MODAL = "components/dashboard/agenda/agenda-edit-appointment-modal.tsx";
const BANNER = "components/dashboard/agenda/agenda-validate-banner.tsx";

/** El bloque `.raiz, .tokensAgenda { … }` (claro) y el `:global(.dark)` (oscuro). */
function bloque(selector: RegExp): string {
  const m = selector.exec(CSS);
  assert.ok(m, `no encontré el bloque ${selector}`);
  const desde = m!.index + m![0].length;
  return CSS.slice(desde, CSS.indexOf("\n}", desde));
}
const CLARO = bloque(/^\.raiz,\n\.tokensAgenda \{/m);
const OSCURO = bloque(/^:global\(\.dark\) \.raiz,\n:global\(\.dark\) \.tokensAgenda \{/m);

const declaradas = (b: string) =>
  [...b.matchAll(/^\s*(--ag-[a-z0-9-]+)\s*:\s*([^;]+);/gm)].map((m) => ({ nombre: m[1], valor: m[2].trim() }));

// ═══════════════════════════════════════════════════════════════════════════
// Instrument Sans en el 100 %: ni una letra de máquina en la agenda nueva
// ═══════════════════════════════════════════════════════════════════════════
const LETRA_DE_MAQUINA = new RegExp(["font-", "mono", "|", "ui-", "mono", "space", "|", "mono", "space"].join(""), "i");

test("sin letra de máquina en la carpeta de la agenda nueva ni en su ropa", () => {
  for (const a of archivosNuevos) {
    assert.ok(!LETRA_DE_MAQUINA.test(a.texto), `${a.nombre} usa letra de máquina`);
  }
  // Las clases de la ropa (las que la agenda nueva pasa a las ventanas
  // compartidas) alinean las cifras con tabular-nums, no con letra de máquina.
  assert.match(CSS, /\.validarHora \{[^}]*font-variant-numeric:\s*tabular-nums/, "la hora de «Pendientes de validar» no lleva tabular-nums");
  assert.match(CSS, /\.raiz > \*,\n\.tokensAgenda > \* \{\n\s*font-variant-numeric:\s*tabular-nums/, "los hijos de la raíz perdieron tabular-nums (la raíz lleva .tokens, que lo apaga)");
});

// ═══════════════════════════════════════════════════════════════════════════
// Hallazgo 18: cada color de la agenda tiene su tono oscuro
// ═══════════════════════════════════════════════════════════════════════════
test("todo token de color del bloque claro se vuelve a declarar en el oscuro", () => {
  const ES_COLOR = /#[0-9a-f]{3,8}\b|rgba?\(|oklch\(|var\(--m2-|\bwhite\b|color-mix\(/i;
  const colores = declaradas(CLARO).filter((d) => ES_COLOR.test(d.valor)).map((d) => d.nombre);
  assert.ok(colores.length >= 30, `se esperaban decenas de tokens de color, hay ${colores.length}`);
  const oscuros = new Set(declaradas(OSCURO).map((d) => d.nombre));
  const sinOscuro = colores.filter((c) => !oscuros.has(c) && !/^--ag-cta-(fondo|texto)$/.test(c));
  assert.deepEqual(sinOscuro, [], `tokens de color sin variante oscura: ${sinOscuro.join(", ")}`);
  // El botón principal se lee del menú en los dos modos: no necesita oscuro propio.
  assert.match(CLARO, /--ag-cta-fondo:\s*var\(--m2-cta-fondo/, "el botón principal no lee --m2-cta-fondo");
  assert.match(CLARO, /--ag-cta-texto:\s*var\(--m2-cta-texto/, "el botón principal no lee --m2-cta-texto");
});

test("el oscuro LEE los neutros del menú y no escribe ni un hex", () => {
  for (const nombre of ["--ag-tinta", "--ag-texto-2", "--ag-superficie", "--ag-fondo-app", "--ag-borde-divisor"]) {
    const d = declaradas(OSCURO).find((x) => x.nombre === nombre);
    assert.ok(d, `${nombre} no está en el bloque oscuro`);
    assert.match(d!.valor, /var\(--m2-/, `${nombre} en oscuro no se lee del menú (--m2-*)`);
  }
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(OSCURO), "el bloque oscuro escribe un hex a mano");
});

test("la raíz y los portales montan CLASES_MENU (de ahí salen los --m2-*)", () => {
  const raiz = leer("components/dashboard/agenda-nueva/agenda-nueva.tsx");
  assert.match(raiz, /className=\{`\$\{CLASES_MENU\} \$\{s\.raiz\}/, "la raíz de la agenda no monta CLASES_MENU");
  const ropa = leer("components/dashboard/agenda-nueva/ropa.ts");
  assert.match(ropa, /CLASES_PORTAL_AGENDA = `\$\{CLASES_MENU\} \$\{s\.tokensAgenda\}`/, "los portales no llevan CLASES_MENU + .tokensAgenda");
  const mover = leer("components/dashboard/agenda-nueva/confirmar-movimiento.tsx");
  assert.match(mover, /<Dialog\.Overlay className=\{`\$\{CLASES_PORTAL_AGENDA\} \$\{s\.velo\}`\}/, "el velo de «Mover cita» no monta los tokens");
  assert.match(mover, /className=\{`\$\{CLASES_PORTAL_AGENDA\} \$\{instrumentSans\.variable\} \$\{s\.modalMover\}`\}/, "la caja de «Mover cita» no monta los tokens");
});

test("no queda ningún color escrito a mano fuera del bloque de tokens", () => {
  // Fuera de los dos bloques de tokens, las reglas solo pueden LEER variables.
  // `#fff` sobre un fondo de color (morado, verde, el color del doctor) sí se
  // permite: es blanco en los dos modos.
  const reglas = CSS.replace(CLARO, "").replace(OSCURO, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const aMano = reglas.split("\n").filter((l) => /rgba?\(\s*26,\s*24,\s*38|#[0-9a-f]{6}\b|oklch\(/i.test(l) && !/var\(--/.test(l));
  assert.deepEqual(aMano, [], `colores a mano fuera de los tokens:\n${aMano.join("\n")}`);
  const semanaMes = archivosNuevos.find((a) => a.nombre === "vista-semana-mes.module.css")!.texto;
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(semanaMes.replace(/#fff\b/g, "")), "vista-semana-mes.module.css escribe un hex que no es blanco");
});

// Las pintas que calcula el JS (fondo, borde y chip de la tarjeta) acaban en
// un `style` inline: si fueran literales, la tarjeta seguiría blanca en oscuro.
test("las pintas de tokens.ts leen variables que la hoja declara en claro Y en oscuro", () => {
  const tokens = leer("lib/agenda-nueva/tokens.ts");
  const bloqueTokens = tokens.slice(tokens.indexOf("export const AGENDA_TOKENS"), tokens.indexOf("} as const;"));
  const valores = [...bloqueTokens.matchAll(/^\s*[a-zA-Z0-9]+:\s*"([^"]+)",/gm)].map((m) => m[1]);
  assert.ok(valores.length >= 25, `se esperaban ≥25 pintas, hay ${valores.length}`);
  const claras = new Set(declaradas(CLARO).map((d) => d.nombre));
  const oscuras = new Set(declaradas(OSCURO).map((d) => d.nombre));
  for (const v of valores) {
    const m = /^var\((--ag-[a-z0-9-]+),\s*.+\)$/.exec(v);
    assert.ok(m, `pinta sin var(--ag-…, respaldo): ${v}`);
    assert.ok(claras.has(m![1]), `${m![1]} no está declarada en el bloque claro`);
    assert.ok(oscuras.has(m![1]), `${m![1]} no está declarada en el bloque oscuro`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Hallazgo 9: las ventanas compartidas cambian de ropa SOLO con la agenda nueva
// ═══════════════════════════════════════════════════════════════════════════
test("«Editar cita»: sin ropa, cada nodo conserva su style de siempre y ninguna clase", () => {
  const modal = leer(MODAL);
  // Todo className es de la ropa, y todo style se apaga con ella. Nunca hay un
  // nodo con clase incondicional ni un style que cambie sin ropa.
  const clases = modal.match(/className=\{[^}]*\}/g) ?? [];
  assert.ok(clases.length >= 20, `se esperaban ≥20 className condicionales, hay ${clases.length}`);
  for (const c of clases) assert.match(c, /^className=\{ropa\?\./, `clase incondicional en el modal: ${c}`);
  const estilos = modal.match(/style=\{[^\n]*/g) ?? [];
  assert.ok(estilos.length >= 20, `se esperaban ≥20 style, hay ${estilos.length}`);
  for (const e of estilos) assert.match(e, /^style=\{ropa \? undefined :/, `style que no se apaga con la ropa: ${e}`);
  // La ropa es opcional: el panel de siempre la omite.
  assert.match(modal, /ropa\?: EditarCitaRopa;/);
  const panelViejo = leer("components/dashboard/agenda/agenda-detail-panel.tsx");
  const uso = panelViejo.slice(panelViejo.indexOf("<AgendaEditAppointmentModal"), panelViejo.indexOf("/>", panelViejo.indexOf("<AgendaEditAppointmentModal")));
  assert.ok(!uso.includes("ropa"), "el panel de siempre pasa ropa al modal");
  // El calendario del DateField sale a otro portal: recibe su propia clase.
  assert.match(modal, /popoverClassName=\{ropa\?\.calendario\}/, "el calendario no recibe la ropa");
});

test("«Pendientes de validar»: sin ropa usa el módulo de siempre, nodo por nodo", () => {
  const banner = leer(BANNER);
  assert.match(banner, /const c: ValidarRopa = ropa \?\? \(styles as ValidarRopa\);/, "sin ropa `c` tiene que ser el módulo de siempre");
  assert.ok(!/styles\.[a-zA-Z]/.test(banner), "quedan clases leídas directo de styles.* (no pasan por la ropa)");
  // Cada clave que el componente usa existe en la ropa de la agenda nueva.
  const ropa = leer("components/dashboard/agenda-nueva/ropa.ts");
  const usadas = new Set([...banner.matchAll(/\bc\.([a-zA-Z]+)/g)].map((m) => m[1]));
  assert.ok(usadas.size >= 18, `se esperaban ≥18 clases, hay ${usadas.size}`);
  const bloqueValidar = ropa.slice(ropa.indexOf("ROPA_VALIDAR"));
  for (const k of usadas) assert.match(bloqueValidar, new RegExp(`\\b${k}:\\s*s\\.`), `ROPA_VALIDAR no viste ${k}`);
  // La agenda de siempre lo monta sin ropa; la nueva, con ella.
  const clienteViejo = leer("app/dashboard/agenda/agenda-page-client.tsx");
  assert.ok(clienteViejo.includes("<AgendaValidateBanner />"), "el AgendaShell de siempre ya no monta el banner pelado");
  assert.ok(!clienteViejo.includes("ROPA_VALIDAR"), "el camino viejo conoce la ropa nueva");
  const raiz = leer("components/dashboard/agenda-nueva/agenda-nueva.tsx");
  assert.ok(raiz.includes("<AgendaValidateBanner ropa={ROPA_VALIDAR} />"), "la agenda nueva no viste el banner");
  const panel = leer("components/dashboard/agenda-nueva/panel-cita.tsx");
  assert.match(panel, /ropa=\{ROPA_EDITAR_CITA\}/, "la agenda nueva no viste «Editar cita»");
});

test("el DateField compartido no cambia: la ropa entra por props que ya tenía", () => {
  const df = leer("components/ui/date-field.tsx");
  assert.match(df, /popoverClassName\?: string;/, "DateField perdió popoverClassName");
  assert.match(df, /className=\{popoverClassName \? `df-pop \$\{popoverClassName\}` : "df-pop"\}/, "el popover ya no queda `df-pop` a secas sin clase extra");
  // Y la ropa del calendario redeclara los tokens que el popover lee por
  // `style` inline, en vez de pelearse con ellos.
  const cal = CSS.slice(CSS.indexOf(".calendario {"), CSS.indexOf("\n}", CSS.indexOf(".calendario {")));
  for (const v of ["--text-1", "--bg-elev", "--border-strong", "--brand", "--bg-hover"]) {
    assert.match(cal, new RegExp(`${v}:\\s*var\\(--ag-`), `.calendario no redeclara ${v}`);
  }
});
