/**
 * CANDADOS DE «PRESUPUESTOS SE UNIFICA EN FACTURACIÓN, Y FUERA MARKETPLACE» (ws1-t1).
 *
 * Run: npx tsx --test src/components/dashboard/presupuestos-en-facturacion/__tests__/presupuestos-en-facturacion.test.ts
 *
 * Lo que se vigila: que con la bandera el menú NO enseñe Presupuestos ni
 * Marketplace, que con ella apagada el menú de siempre no se entere de nada,
 * que nadie se quede sin ver un presupuesto que ya existía, y que aquí no se
 * haya BORRADO nada.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { APARTADOS_FUERA_DEL_MENU, MODULOS_FUERA_DEL_MENU, modulosParaMenuNuevo } from "../menu";
import { buildPatientNavItems } from "@/components/dashboard/patient-detail/patient-nav-items";
import { construirMenuFicha } from "@/components/dashboard/pacientes-rediseno/menu-estructura";
import { NAV_ITEMS, type SidebarUser } from "@/components/dashboard/sidebar-nav";
import { armarMenu, opcionesVisibles } from "@/components/dashboard/menu-dos-niveles/estructura";

const SRC = join(__dirname, "..", "..", "..", "..");           // src/
const CARPETA = join(SRC, "components", "dashboard", "presupuestos-en-facturacion");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const archivosNuevos = readdirSync(CARPETA)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => ({ nombre: f, texto: readFileSync(join(CARPETA, f), "utf8") }));
const HOJA = archivosNuevos.find((a) => a.nombre === "aviso.module.css")!.texto;

// La palabra prohibida se arma en trozos para que un grep sobre la carpeta
// (el gate de cierre: «cero letra de máquina») no se tope con este archivo.
const LETRA_DE_MAQUINA = new RegExp(["font-", "mono", "|", "ui-", "mono", "space", "|", "mono", "space"].join(""));

const ADMIN: SidebarUser = { role: "SUPER_ADMIN" } as SidebarUser;
const LLAVES = ["ai-assistant", "inbox", "whatsapp", "marketplace", "analytics", "reports", "landing", "tv-modes"];
const FICHA_TODO = {
  pediatrics: { state: "hidden" as const, reason: "" },
  showPeriodontics: false, showEndodontics: false, showImplants: true, showOrthodontics: false,
  showBilling: true, showConsents: true, showXrays: true, showPrescriptions: true,
};

// ═══════════════════════════════════════════════════════════════════════════
// Lenguaje visual
// ═══════════════════════════════════════════════════════════════════════════
test("sin letra de máquina, sin tokens propios y sin hex sueltos", () => {
  for (const a of archivosNuevos) {
    assert.ok(!LETRA_DE_MAQUINA.test(a.texto), `${a.nombre} usa letra de máquina`);
    if (!a.nombre.endsWith(".css")) assert.doesNotMatch(a.texto, /#[0-9a-f]{6}\b/i, `${a.nombre} trae un color escrito a mano`);
  }
  assert.deepEqual(HOJA.match(/^\s*--[a-z0-9-]+\s*:/gim) ?? [], [], "la hoja declara tokens propios");
  assert.match(HOJA, /var\(--m2-/, "la hoja lee los tokens del menú");
  assert.match(HOJA, /font-variant-numeric:\s*tabular-nums/);
  const sinRespaldos = HOJA.replace(/var\(--[a-z0-9-]+,\s*[^)]*\)/g, "");
  assert.doesNotMatch(sinRespaldos, /#[0-9a-f]{3,8}\b/i, "un hex fuera de un respaldo var(--x, #hex)");
  assert.doesNotMatch(HOJA, /display:\s*none|@media|@container/, "algo se esconde por ancho");
  assert.match(leer("components/dashboard/presupuestos-en-facturacion/aviso.tsx"), /CLASES_MENU/);
});

// ═══════════════════════════════════════════════════════════════════════════
// Con la bandera: ni Presupuestos ni Marketplace
// ═══════════════════════════════════════════════════════════════════════════
test("el menú nuevo de la ficha no enseña Presupuestos, y no pierde nada más", () => {
  const items = buildPatientNavItems(FICHA_TODO);
  assert.ok(items.some((i) => i.id === "presupuestos"), "buildPatientNavItems ya no trae presupuestos: actualiza este candado");
  const menu = construirMenuFicha(items);
  const pintados = menu.fijos.map((i) => i.id).concat(...menu.grupos.map((g) => g.items.map((i) => i.id)));
  assert.ok(!pintados.includes("presupuestos"), "Presupuestos sigue en el menú nuevo de la ficha");
  assert.deepEqual(
    pintados.slice().sort(),
    items.map((i) => i.id).filter((id) => id !== "presupuestos").sort(),
    "al quitar Presupuestos se perdió (o se coló) otro apartado",
  );
  assert.ok(pintados.includes("facturacion"), "Facturación tiene que seguir en la barra");
  assert.deepEqual(APARTADOS_FUERA_DEL_MENU, ["presupuestos"]);
});

test("el menú lateral nuevo no enseña Marketplace, y no pierde nada más", () => {
  const con = opcionesVisibles(ADMIN, "DENTAL", LLAVES).map((i) => i.id);
  const sin = opcionesVisibles(ADMIN, "DENTAL", modulosParaMenuNuevo(LLAVES)).map((i) => i.id);
  assert.ok(con.includes("marketplace"), "con su llave, Marketplace salía: si ya no, actualiza este candado");
  assert.ok(!sin.includes("marketplace"), "Marketplace sigue saliendo en el menú nuevo");
  assert.deepEqual(sin, con.filter((id) => id !== "marketplace"), "se perdió otra opción además de Marketplace");
  const menu = armarMenu(opcionesVisibles(ADMIN, "DENTAL", modulosParaMenuNuevo(LLAVES)));
  const todo = menu.nivel1.concat(...menu.grupos.map((g) => g.items)).map((i) => i.id);
  assert.ok(!todo.includes("marketplace"));
});

test("la llave «marketplace» solo la declara la opción Marketplace", () => {
  // Si otra opción la declarase, quitarle la llave al menú nuevo se la llevaría por delante.
  for (const llave of MODULOS_FUERA_DEL_MENU) {
    const quienes = NAV_ITEMS.filter((i) => i.moduleKey === llave).map((i) => i.id);
    assert.deepEqual(quienes, ["marketplace"], `la llave ${llave} la usan: ${quienes.join(", ")}`);
  }
  assert.deepEqual(modulosParaMenuNuevo(null), []);
  assert.deepEqual(modulosParaMenuNuevo(["inbox", "marketplace", "reports"]), ["inbox", "reports"]);
});

// ═══════════════════════════════════════════════════════════════════════════
// Con la bandera apagada: el menú de siempre no se entera
// ═══════════════════════════════════════════════════════════════════════════
test("el layout solo le quita la llave al menú NUEVO; el <Sidebar> recibe las de siempre", () => {
  const layout = leer("app/dashboard/layout.tsx");
  // ws1-t3: Reportes también sale del menú nuevo (pestaña de Analítica), así que
  // las llaves ya filtradas pasan además por `modulosSinReportes(…)`.
  assert.equal((layout.match(/modulosParaMenuNuevo\(/g) ?? []).length, 1, "la llave se filtra en más de un sitio");
  assert.match(
    layout,
    /\{menuDosNiveles \? \(\s*<MenuDosNivelesServidor\s*\{\.\.\.sidebarProps\}[\s\S]*?clinicModuleKeys=\{(?:modulosSinReportes\(\s*)?modulosParaMenuNuevo\(clinicModuleKeys\)[\s\S]*?\/>\s*\) : \(\s*<Sidebar \{\.\.\.sidebarProps\} \/>\s*\)\}/,
    "el filtro no está en la rama de la bandera, o el <Sidebar> de siempre cambió",
  );
  // `sidebarProps` sigue armándose con las llaves enteras.
  assert.match(layout, /\n    clinicModuleKeys,\n/, "sidebarProps ya no lleva clinicModuleKeys tal cual");
});

test("lo compartido con el camino viejo no se tocó", () => {
  const nav = leer("components/dashboard/patient-detail/patient-nav-items.ts");
  assert.match(nav, /\{ id: "presupuestos", labelKey: "patients\.tabs\.presupuestos"/, "el menú de siempre de la ficha perdió Presupuestos");
  const sidebar = leer("components/dashboard/sidebar-nav.ts");
  assert.match(sidebar, /\{ id: "marketplace",[^\n]*moduleKey: "marketplace"/, "el menú de siempre perdió Marketplace");
  for (const rel of ["components/dashboard/patient-detail/patient-nav-items.ts", "components/dashboard/sidebar-nav.ts", "components/dashboard/sidebar.tsx", "components/quotes/quotes-tab.tsx"]) {
    assert.ok(!leer(rel).includes("presupuestos-en-facturacion"), `${rel} conoce la carpeta nueva`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Nadie se queda sin ver un presupuesto que ya existía
// ═══════════════════════════════════════════════════════════════════════════
test("la pestaña Presupuestos sigue viva, entera, y se llega por enlace", () => {
  const ficha = leer("app/dashboard/patients/[id]/patient-detail-client.tsx");
  // La pestaña se monta igual con y sin bandera, sin condición nueva.
  assert.match(ficha, /\{tab === "presupuestos" && \(\s*<QuotesTab/, "QuotesTab quedó detrás de una condición nueva");
  // `?tab=presupuestos` se valida contra buildPatientNavItems (que lo conserva), no contra el menú nuevo.
  assert.match(ficha, /const items = buildPatientNavItems\(\{[\s\S]*?\}\);\s*return \[\.\.\.items\.filter/);
  assert.match(ficha, /tabFromUrl && tabs\.some\(\(i\) => i\.id === tabFromUrl && !i\.disabled\)/);
  // El aviso y el enlace, solo con la bandera.
  assert.match(ficha, /\{tab === "presupuestos" && rediseno && \(\s*<AvisoPresupuestosMovidos/);
  assert.match(ficha, /\{tab === "facturacion" && canViewBilling && rediseno && \(\s*<EnlaceAPresupuestos[^\n]*setTab\("presupuestos"\)/);
  // El aviso no apaga nada: no envuelve a QuotesTab ni le pasa un «solo lectura».
  const aviso = leer("components/dashboard/presupuestos-en-facturacion/aviso.tsx");
  assert.ok(!aviso.includes("QuotesTab") && !/readOnly|soloLectura/.test(aviso));
  // El enlace cuenta con la MISMA lectura que la pestaña, y calla si no sabe.
  assert.match(aviso, /\/api\/quotes\?patientId=/);
  assert.match(aviso, /if \(!cuantos\) return null;/);
});

test("aquí no se borró nada: rutas, pantallas y SQL de Presupuestos y Marketplace siguen en su sitio", () => {
  const RAIZ = join(SRC, "..");
  for (const rel of [
    "src/app/api/quotes/route.ts", "src/app/api/quotes/[id]/route.ts", "src/app/api/quotes/[id]/pdf", "src/app/api/quotes/[id]/status",
    "src/app/api/quotes/[id]/invoice", "src/app/api/quotes/[id]/duplicate", "src/app/api/quotes/[id]/send-whatsapp", "src/app/api/quotes/[id]/treatment-plan",
    "src/app/presupuesto", "src/components/quotes/quotes-tab.tsx", "src/components/dashboard/presupuesto-nuevo/editor.tsx",
    "src/components/dashboard/presupuesto-nuevo/lista.tsx", "src/lib/quotes/condiciones-pago.ts", "sql/presupuesto-condiciones-pago.sql",
    "src/app/dashboard/marketplace/page.tsx",
  ]) assert.ok(existsSync(join(RAIZ, rel)), `falta ${rel}`);
});

test("las claves nuevas existen en los dos idiomas", () => {
  const usadas = new Set<string>();
  for (const a of archivosNuevos) for (const m of a.texto.matchAll(/"presupuestosEnFacturacion\.([a-zA-Z]+)"/g)) usadas.add(m[1]);
  assert.ok(usadas.size >= 5);
  for (const idioma of ["es", "en"]) {
    const dic = JSON.parse(leer(`i18n/dictionaries/${idioma}.json`)).presupuestosEnFacturacion ?? {};
    for (const k of usadas) assert.ok(dic[k], `${idioma}.json no tiene presupuestosEnFacturacion.${k}`);
  }
});
