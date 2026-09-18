/**
 * CANDADOS DEL REDISEÑO DE "MI CLÍNICA VISUAL" (ws1-t1).
 *
 * Run: npx tsx --test src/components/dashboard/clinica-visual-rediseno/__tests__/clinica-visual-rediseno.test.ts
 *
 * A diferencia de Hoy o Agenda, este rediseño NO vive en una carpeta nueva
 * con un árbol de componentes aparte: el editor de plano
 * (`layout-client.tsx`) es un solo componente cliente con demasiado estado
 * propio para duplicarlo con seguridad, así que el MISMO archivo — y los
 * cuatro que lo acompañan (los tres modales y la sala de espera) — reciben
 * una prop `rediseno` y, cuando está encendida, añaden una clase marcador
 * (`pageRediseno`, `wrapRediseno`, `overlayRediseno`, `backdropRediseno`)
 * cuyas reglas viven al FINAL de cada `.module.css`, después de un
 * comentario con la palabra "REDISEÑO". Por eso los candados de tipografía
 * y de tokens se aplican solo a ese tramo final de cada hoja: el resto del
 * archivo es a propósito el camino viejo, intacto, y ahí SÍ puede haber
 * letra de máquina (folios, slugs) porque así se ve hoy.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..", "..");           // src/
const CLINIC = join(SRC, "app", "dashboard", "clinic-layout");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const HOJAS_TOCADAS = [
  "app/dashboard/clinic-layout/clinic-layout.module.css",
  "app/dashboard/clinic-layout/components/welcome-prompt.module.css",
  "app/dashboard/clinic-layout/components/optimizer-modal.module.css",
  "app/dashboard/clinic-layout/components/share-panel.module.css",
  "app/dashboard/clinic-layout/components/waiting-room.module.css",
];

const MARCADOR = "REDISEÑO";

/** Solo el tramo que este trabajo añadió: desde el comentario "REDISEÑO"
 *  hasta el final del archivo. Antes de ese punto vive el camino viejo,
 *  que no se toca y que SÍ puede traer letra de máquina o vivir sin marca. */
function bloqueNuevo(rutaRelativa: string): string {
  const texto = leer(rutaRelativa);
  const idx = texto.indexOf(MARCADOR);
  assert.ok(idx !== -1, `${rutaRelativa} no tiene el bloque de rediseño (falta "${MARCADOR}")`);
  return texto.slice(idx);
}

// ═══════════════════════════════════════════════════════════════════════
// Instrument Sans en el 100 %: ni una letra de máquina en lo NUEVO
// ═══════════════════════════════════════════════════════════════════════
// La palabra prohibida se arma en trozos para que un grep sobre esta
// carpeta (el gate de cierre: «cero letra de máquina») no se tope con este
// archivo.
const LETRA_DE_MAQUINA = new RegExp(["font-", "mono", "|", "ui-", "mono", "space", "|", "mono", "space"].join(""));

test("sin letra de máquina en el bloque de rediseño de cada hoja tocada", () => {
  for (const ruta of HOJAS_TOCADAS) {
    const nuevo = bloqueNuevo(ruta);
    assert.ok(
      !LETRA_DE_MAQUINA.test(nuevo),
      `${ruta}: el bloque de rediseño usa letra de máquina; las cifras van con tabular-nums sobre Instrument Sans`,
    );
  }
});

test("sin letra de máquina en los .tsx tocados (props y clases nuevas)", () => {
  const archivos = [
    "app/dashboard/clinic-layout/page.tsx",
    "app/dashboard/clinic-layout/layout-client.tsx",
    "app/dashboard/clinic-layout/components/welcome-prompt.tsx",
    "app/dashboard/clinic-layout/components/optimizer-modal.tsx",
    "app/dashboard/clinic-layout/components/share-panel.tsx",
    "app/dashboard/clinic-layout/components/waiting-room.tsx",
    "components/dashboard/clinica-visual-rediseno/raiz.ts",
  ];
  for (const a of archivos) {
    assert.ok(!LETRA_DE_MAQUINA.test(leer(a)), `${a} usa letra de máquina`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Sin tokens nuevos: cada hoja tocada solo LEE los del menú (--m2-*)
// ═══════════════════════════════════════════════════════════════════════
test("ninguna hoja tocada declara una variable CSS propia", () => {
  for (const ruta of HOJAS_TOCADAS) {
    const css = leer(ruta);
    const declaraciones = css.match(/^\s*--[a-z0-9-]+\s*:/gim) ?? [];
    assert.deepEqual(declaraciones, [], `${ruta} declara tokens propios: ${declaraciones.join(", ")}`);
  }
});

test("el bloque de rediseño de cada hoja lee los tokens del menú", () => {
  for (const ruta of HOJAS_TOCADAS) {
    const nuevo = bloqueNuevo(ruta);
    assert.match(nuevo, /var\(--m2-/, `${ruta}: el bloque de rediseño no lee var(--m2-*)`);
  }
});

test("la raíz del rediseño monta CLASES_MENU (menu-dos-niveles/clases.ts)", () => {
  const raiz = leer("components/dashboard/clinica-visual-rediseno/raiz.ts");
  assert.match(raiz, /CLASES_MENU/, "raiz.ts no importa/monta CLASES_MENU");
  assert.match(raiz, /from "@\/components\/dashboard\/menu-dos-niveles\/clases"/, "no viene de menu-dos-niveles/clases.ts");
});

test("el marco (layout-client y los cuatro componentes) monta la raíz del rediseño, no el menú directo", () => {
  const archivos = [
    "app/dashboard/clinic-layout/layout-client.tsx",
    "app/dashboard/clinic-layout/components/welcome-prompt.tsx",
    "app/dashboard/clinic-layout/components/optimizer-modal.tsx",
    "app/dashboard/clinic-layout/components/share-panel.tsx",
    "app/dashboard/clinic-layout/components/waiting-room.tsx",
  ];
  for (const a of archivos) {
    const texto = leer(a);
    assert.match(texto, /CLASES_REDISENO_CLINICA/, `${a} no monta CLASES_REDISENO_CLINICA`);
    assert.doesNotMatch(
      texto,
      /menu-dos-niveles\/clases"/,
      `${a} importa el menú directamente en vez de pasar por clinica-visual-rediseno/raiz`,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════
// El camino viejo sigue vivo: nada se reemplaza, solo se añade
// ═══════════════════════════════════════════════════════════════════════
test("con `rediseno` sin pasar (o en false), las clases de siempre siguen puestas solas", () => {
  const layout = leer("app/dashboard/clinic-layout/layout-client.tsx");
  assert.match(layout, /rediseno\s*=\s*false/, "el prop `rediseno` no tiene default false en layout-client");
  // Las clases viejas siguen literalmente en el className: no se sustituyeron
  // por una rama nueva/vieja, se les AÑADE una cadena que es "" sin bandera.
  assert.match(layout, /\$\{styles\.page\}[^`]*\$\{clasesRediseno\}/s, "el .page ya no lleva su clase de siempre + la nueva");
  assert.match(layout, /\$\{styles\.welcomeWrap\}[^`]*\$\{clasesRediseno\}/s, "el .welcomeWrap ya no lleva su clase de siempre + la nueva");

  const modales: Array<[string, string]> = [
    ["app/dashboard/clinic-layout/components/welcome-prompt.tsx", "promptStyles.wrap"],
    ["app/dashboard/clinic-layout/components/optimizer-modal.tsx", "styles.overlay"],
    ["app/dashboard/clinic-layout/components/share-panel.tsx", "shareStyles.backdrop"],
    ["app/dashboard/clinic-layout/components/waiting-room.tsx", "waitingStyles.wrap"],
  ];
  for (const [archivo, claseVieja] of modales) {
    const texto = leer(archivo);
    assert.match(texto, /rediseno\s*=\s*false/, `${archivo}: el prop \`rediseno\` no tiene default false`);
    assert.ok(
      texto.includes(claseVieja),
      `${archivo}: perdió su clase de siempre (${claseVieja})`,
    );
    // La rama del ternario cuando NO hay rediseño devuelve exactamente la
    // clase vieja SOLA (sin CLASES_REDISENO_CLINICA ni el marcador nuevo).
    assert.match(
      texto,
      new RegExp(`:\\s*${claseVieja.replace(".", "\\.")}\\s*(?:;|\\}|,)`),
      `${archivo}: la rama "sin rediseño" del ternario no devuelve la clase vieja tal cual`,
    );
  }
});

test("la sala de espera solo cambia cuando el DASHBOARD se lo pide; /live/[slug] no le pasa la bandera", () => {
  const publico = leer("app/live/[slug]/live-public-client.tsx");
  assert.doesNotMatch(
    publico,
    /<WaitingRoom[^>]*rediseno/s,
    "la vista pública /live/[slug] pasa `rediseno` a WaitingRoom: el televisor de la sala de espera cambiaría para el paciente",
  );
});

test("page.tsx enciende el rediseño con el MISMO interruptor del menú, no uno propio", () => {
  const page = leer("app/dashboard/clinic-layout/page.tsx");
  assert.match(page, /from "@\/lib\/menu-dos-niveles\/interruptor"/, "no usa el interruptor compartido");
  assert.match(page, /menuDosNivelesEncendido\(user\.clinicId\)/, "no consulta el interruptor con el clinicId de la sesión");
  assert.match(page, /rediseno=\{rediseno\}/, "no baja la bandera al cliente");
  // Va DENTRO del mismo Promise.all que clinic/layout/chairs: no es un
  // viaje aparte a la base.
  const bloquePromiseAll = page.slice(page.indexOf("Promise.all"), page.indexOf("]);") + 3);
  assert.match(bloquePromiseAll, /menuDosNivelesEncendido/, "el interruptor no viaja en el mismo Promise.all que el resto de datos");
});


// ═══════════════════════════════════════════════════════════════════════════
// Modo oscuro (ws1-t2): dentro del bloque de rediseño, ningún fondo, borde ni
// color de letra va escrito a mano — si no sale de un token con versión oscura,
// la caja nace encendida sobre el modal oscuro (le pasó a «Pensando», al
// razonamiento, a «Regenerar» y al error del optimizador).
// ═══════════════════════════════════════════════════════════════════════════
test("el bloque de rediseño del optimizador viste sus cajas de estado con tokens", () => {
  const hoja = leer("app/dashboard/clinic-layout/components/optimizer-modal.module.css");
  const bloque = hoja.slice(hoja.indexOf(MARCADOR));
  for (const clase of ["thinking", "reasoning", "btnRegen", "error", "laneTick"]) {
    assert.match(bloque, new RegExp(`\\.overlayRediseno \\.${clase}\\b`), `falta vestir .${clase} en el rediseño`);
  }
  const aMano = bloque
    .split("\n")
    .filter((l) => /^\s*(background|color|border-color|border)\s*:/.test(l))
    .filter((l) => !l.includes("var(--") && !/rgba\(0, 0, 0/.test(l) && !/:\s*(none|transparent|inherit)/.test(l));
  assert.deepEqual(aMano, [], "color escrito a mano en el bloque de rediseño: no tendrá versión oscura");
});
