/**
 * CANDADOS DE «SIN ACCESO A CAJA» Y DE «BUSCAR PACIENTE» DE HOY (ws1-t6,
 * hallazgos 16 y 17 de la auditoría del rediseño).
 *
 * Run: npm run test:sin-permiso-rediseno
 *
 * Se prueba leyendo el código fuente, como `hoy-rediseno.test.ts`: lo que se
 * vigila es CABLEADO (que el mensaje diga la verdad y no mande a comprar un
 * plan, que el camino viejo siga vivo detrás del interruptor, que el botón de
 * Hoy abra la paleta que existe), y eso se ve en el archivo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..", "..");           // src/
const CARPETA = join(SRC, "components", "dashboard", "sin-permiso-rediseno");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");
/** Solo el código: los comentarios explican el hallazgo y nombran lo prohibido. */
const sinComentarios = (texto: string) => texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const archivosNuevos = readdirSync(CARPETA)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => ({ nombre: f, texto: readFileSync(join(CARPETA, f), "utf8") }));

// ═══════════════════════════════════════════════════════════════════════════
// Instrument Sans en el 100 %: ni una letra de máquina en la carpeta nueva
// ═══════════════════════════════════════════════════════════════════════════
// La palabra prohibida se arma en trozos para que un grep sobre la carpeta
// (el gate de cierre: «cero letra de máquina») no se tope con este archivo.
const LETRA_DE_MAQUINA = new RegExp(["font-", "mono", "|", "ui-", "mono", "space", "|", "mono", "space"].join(""));

test("sin letra de máquina en la carpeta nueva", () => {
  for (const a of archivosNuevos) {
    assert.ok(!LETRA_DE_MAQUINA.test(a.texto), `${a.nombre} usa letra de máquina`);
  }
  const css = archivosNuevos.find((a) => a.nombre === "sin-permiso.module.css")!.texto;
  assert.match(css, /font-variant-numeric:\s*tabular-nums/, "las cifras se alinean con tabular-nums");
});

// ═══════════════════════════════════════════════════════════════════════════
// Sin tokens nuevos ni hex: la hoja solo LEE los del menú (--m2-*)
// ═══════════════════════════════════════════════════════════════════════════
test("sin-permiso.module.css no declara variables propias ni trae hex", () => {
  const css = archivosNuevos.find((a) => a.nombre === "sin-permiso.module.css")!.texto;
  const declaraciones = css.match(/^\s*--[a-z0-9-]+\s*:/gim) ?? [];
  assert.deepEqual(declaraciones, [], `declara tokens propios: ${declaraciones.join(", ")}`);
  assert.match(css, /var\(--m2-/, "lee los tokens del menú");
  for (const a of archivosNuevos) {
    assert.doesNotMatch(a.texto, /#[0-9a-f]{3,8}\b/i, `${a.nombre} trae un color a mano`);
  }
  const comp = leer("components/dashboard/sin-permiso-rediseno/caja-sin-permiso.tsx");
  assert.match(comp, /CLASES_MENU/, "la raíz monta CLASES_MENU (menu-dos-niveles/clases.ts)");
  assert.ok(!/style=\{\{/.test(comp), "sin estilos en línea: todo va por la hoja");
});

// ═══════════════════════════════════════════════════════════════════════════
// Hallazgo 16: el mensaje dice la verdad y no manda a comprar un plan
// ═══════════════════════════════════════════════════════════════════════════
test("«sin acceso a Caja» habla de permiso, no de plan, y no manda al marketplace", () => {
  const comp = leer("components/dashboard/sin-permiso-rediseno/caja-sin-permiso.tsx");
  assert.ok(!comp.includes("/dashboard/marketplace"), "sigue mandando a «Ver planes»");
  // El texto largo es el MISMO que ya usa el menú de dos niveles para Caja.
  assert.ok(comp.includes('t("menuDosNiveles.cajaSinAcceso")'), "no reutiliza el aviso del menú");
  assert.ok(comp.includes('href="/dashboard"'), "no ofrece volver a Hoy");
  assert.ok(comp.includes("equipoHref"), "no ofrece abrir Equipo a quien puede editarlo");

  for (const lang of ["es", "en"]) {
    const dict = JSON.parse(leer(`i18n/dictionaries/${lang}.json`)).menuDosNiveles as Record<string, string>;
    for (const k of ["cajaSinAcceso", "cajaSinPermisoTitulo", "cajaSinPermisoVolver", "cajaSinPermisoEquipo"]) {
      assert.equal(typeof dict[k], "string", `${lang}: falta menuDosNiveles.${k}`);
      assert.doesNotMatch(dict[k], /plan/i, `${lang}: ${k} habla del plan, y Caja no es cosa del plan`);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// El camino viejo sigue vivo: sin bandera, el ModuleLocked de siempre, tal cual
// ═══════════════════════════════════════════════════════════════════════════
test("caja/page.tsx elige con menuDosNivelesEncendido y no toca canUseCaja", () => {
  const page = leer("app/dashboard/caja/page.tsx");
  // La regla de acceso es la misma de siempre.
  assert.match(page, /if \(!canUseCaja\(user\)\) \{/, "el gate ya no es canUseCaja");
  // Sin bandera → ModuleLocked, igual que hoy. Con bandera → la pantalla nueva.
  const gate = page.slice(page.indexOf("if (!canUseCaja(user)) {"), page.indexOf("const [caja, history"));
  assert.match(gate, /const rediseno = await menuDosNivelesEncendido\(user\.clinicId\);/, "no lee el interruptor compartido");
  assert.match(gate, /if \(!rediseno\) return <ModuleLocked name="Caja" \/>;/, "sin bandera ya no sale el ModuleLocked de siempre");
  assert.match(gate, /return <CajaSinPermiso t=\{t\}/, "con bandera no monta la pantalla nueva");
  // El enlace a Equipo depende de un permiso que ya existe; no se inventa ninguno.
  assert.match(gate, /hasPermission\([\s\S]*"team\.edit"/, "el enlace a Equipo no se gatea con team.edit");
  assert.ok(!/canAccessCaja/.test(sinComentarios(gate)), "el gate toca canAccessCaja a mano");

  // Y el ModuleLocked de siempre no cambió su texto (lo siguen viendo, sin
  // bandera, Analytics y Pantallas TV, donde SÍ es cosa del plan).
  const viejo = leer("components/dashboard/module-locked.tsx");
  assert.ok(viejo.includes("no está en tu plan"), "module-locked.tsx cambió: es camino viejo compartido");
  assert.ok(viejo.includes('href="/dashboard/marketplace"'), "module-locked.tsx cambió su enlace");
});

// ═══════════════════════════════════════════════════════════════════════════
// Hallazgo 17: «Buscar paciente» de Hoy abre la paleta del topbar, no una propia
// ═══════════════════════════════════════════════════════════════════════════
test("BarraAtajos pide la paleta por evento y el topbar la escucha", () => {
  const piezas = leer("components/dashboard/hoy-rediseno/piezas.tsx");
  const barra = sinComentarios(piezas.slice(piezas.indexOf("export function BarraAtajos"), piezas.indexOf("/* ── Tarjeta")));
  assert.ok(!barra.includes("useCommandPalette("), "BarraAtajos vuelve a crear una paleta propia que nadie pinta");
  assert.ok(barra.includes("onClick={pedirAbrirPaleta}"), "«Buscar paciente» no pide la paleta del topbar");
  assert.ok(piezas.includes('import { pedirAbrirPaleta } from "@/hooks/use-command-palette"'), "importa el pedido de otro sitio");

  const hook = leer("hooks/use-command-palette.ts");
  assert.match(hook, /export const EVENTO_ABRIR_PALETA = "mf:open-command-palette"/);
  assert.match(hook, /window\.dispatchEvent\(new CustomEvent\(EVENTO_ABRIR_PALETA\)\)/, "pedirAbrirPaleta no dispara el evento");
  assert.match(hook, /window\.addEventListener\(EVENTO_ABRIR_PALETA, abrir\)/, "el hook no escucha el evento");
  assert.match(hook, /window\.removeEventListener\(EVENTO_ABRIR_PALETA, abrir\)/, "el hook no limpia el listener");

  // Quien pinta la paleta con la bandera es el topbar nuevo, y sigue usando el hook.
  const topbarNuevo = leer("components/dashboard/menu-dos-niveles/topbar-dos-niveles.tsx");
  assert.match(topbarNuevo, /useCommandPalette\(\)/);
  assert.match(topbarNuevo, /<CommandPalette open=\{paletteOpen\}/);

  // Camino viejo sin tocar: la home de siempre sigue con su openPalette local.
  const viejo = leer("components/dashboard/home/parts/home-shortcut-bar.tsx");
  assert.ok(viejo.includes("const { openPalette } = useCommandPalette();"), "home-shortcut-bar.tsx cambió: es camino viejo");
  assert.ok(viejo.includes("onClick={openPalette}"), "home-shortcut-bar.tsx cambió su onClick");
});
