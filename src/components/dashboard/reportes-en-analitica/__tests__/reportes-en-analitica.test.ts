/**
 * CANDADOS DE «REPORTES SE VUELVE UNA PESTAÑA DE ANALÍTICA» (ws1-t3).
 *
 * Run: npx tsx --test src/components/dashboard/reportes-en-analitica/__tests__/reportes-en-analitica.test.ts
 *
 * Se prueba leyendo el código fuente, como `hoy-rediseno/__tests__/
 * hoy-rediseno.test.ts`, y llamando al filtro de verdad del menú. Lo que se
 * vigila: que con la bandera Reportes salga del menú SOLO para quien llega a
 * él por Analítica, que con ella apagada nada se entere, que las dos pantallas
 * lean las cifras de la misma fuente, y que aquí no se haya BORRADO nada.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MODULO_REPORTES, modulosSinReportes, puedeAbrirAnalitica } from "../menu";
import { NAV_ITEMS, shouldShowItem, type SidebarUser } from "@/components/dashboard/sidebar-nav";
import { opcionesVisibles } from "@/components/dashboard/menu-dos-niveles/estructura";
import { modulosParaMenuNuevo } from "@/components/dashboard/presupuestos-en-facturacion/menu";
import { PESTANAS } from "@/components/dashboard/analitica-rediseno/pestanas";

const SRC = join(__dirname, "..", "..", "..", "..");           // src/
const CARPETA = join(SRC, "components", "dashboard", "reportes-en-analitica");
const RUTA_PESTANA = join(SRC, "app", "dashboard", "analytics", "reports");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const archivosNuevos = [CARPETA, RUTA_PESTANA].flatMap((dir) =>
  readdirSync(dir)
    .filter((f) => /\.(tsx?|css)$/.test(f))
    .map((f) => ({ nombre: f, texto: readFileSync(join(dir, f), "utf8") })),
);

// La palabra prohibida se arma en trozos para que un grep sobre la carpeta
// (el gate de cierre: «cero letra de máquina») no se tope con este archivo.
const LETRA_DE_MAQUINA = new RegExp(["font-", "mono", "|", "ui-", "mono", "space", "|", "mono", "space"].join(""));

const LLAVES = ["ai-assistant", "inbox", "whatsapp", "marketplace", "analytics", "reports", "landing", "tv-modes"];
const DUENO: SidebarUser = { role: "SUPER_ADMIN" } as SidebarUser;
const ADMIN: SidebarUser = { role: "ADMIN", permissionsOverride: [] } as unknown as SidebarUser;
// Recepción con Reportes concedido a mano: hoy VE Reportes y NO puede abrir Analítica.
const RECEPCION_CON_REPORTES: SidebarUser = {
  role: "RECEPTIONIST",
  permissionsOverride: ["today.view", "reports.view"],
} as unknown as SidebarUser;

const ids = (user: SidebarUser, llaves: string[]) => opcionesVisibles(user, "DENTAL", llaves).map((i) => i.id);
const menuNuevo = (user: SidebarUser, llaves: string[]) =>
  ids(user, modulosSinReportes(modulosParaMenuNuevo(llaves), user, "DENTAL"));

// ═══════════════════════════════════════════════════════════════════════════
// Lenguaje visual
// ═══════════════════════════════════════════════════════════════════════════
test("sin letra de máquina, sin tokens propios y sin colores escritos a mano", () => {
  assert.ok(archivosNuevos.length >= 3, "hay paquete y pestaña");
  for (const a of archivosNuevos) {
    assert.ok(!LETRA_DE_MAQUINA.test(a.texto), `${a.nombre} usa letra de máquina`);
    const sueltos = a.texto.split("\n").filter((l) => /#[0-9a-f]{3,8}\b/i.test(l) && !/var\(--/.test(l));
    assert.deepEqual(sueltos, [], `${a.nombre} escribe un color a mano:\n${sueltos.join("\n")}`);
    assert.deepEqual(a.texto.match(/^\s*--[a-z0-9-]+\s*:/gim) ?? [], [], `${a.nombre} declara tokens propios`);
  }
  // La pestaña se viste con el marco de Analítica y con la pantalla de Reportes
  // ya rediseñada: no trae ropa propia.
  const vista = leer("app/dashboard/analytics/reports/reports-rediseno.tsx");
  assert.match(vista, /MarcoAnalitica/);
  assert.match(vista, /<ReportsClient \{\.\.\.datos\} rediseno enAnalitica \/>/);
});

// ═══════════════════════════════════════════════════════════════════════════
// Con la bandera: Reportes sale del menú y entra como pestaña
// ═══════════════════════════════════════════════════════════════════════════
test("quien puede abrir Analítica deja de ver Reportes en el menú nuevo, y nada más cambia", () => {
  for (const persona of [DUENO, ADMIN]) {
    const antes = ids(persona, modulosParaMenuNuevo(LLAVES));
    const ahora = menuNuevo(persona, LLAVES);
    assert.ok(antes.includes("reports") && antes.includes("analytics"));
    assert.deepEqual(ahora, antes.filter((id) => id !== "reports"), "solo se va Reportes");
  }
});

test("la pestaña Reportes existe en el marco nuevo y apunta a su ruta", () => {
  const pestana = PESTANAS.find((p) => p.id === "reports");
  assert.deepEqual(pestana, { id: "reports", labelKey: "analytics.layout.tabReports", href: "/dashboard/analytics/reports" });
  assert.ok(existsSync(join(RUTA_PESTANA, "page.tsx")));
  for (const dic of ["es", "en"]) {
    const d = JSON.parse(leer(`i18n/dictionaries/${dic}.json`));
    assert.equal(typeof d.analytics.layout.tabReports, "string", `${dic}.json tiene la etiqueta`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Nadie pierde un dato que hoy ve
// ═══════════════════════════════════════════════════════════════════════════
test("a quien NO puede abrir Analítica, Reportes le sigue saliendo en el menú nuevo", () => {
  // Alguien con reports.view a mano pero sin ser administrador.
  assert.equal(puedeAbrirAnalitica(RECEPCION_CON_REPORTES, "DENTAL", LLAVES), false);
  assert.ok(menuNuevo(RECEPCION_CON_REPORTES, LLAVES).includes("reports"));
  // Un plan que trae Reportes pero no Analytics.
  const sinAnalytics = LLAVES.filter((k) => k !== "analytics");
  assert.equal(puedeAbrirAnalitica(DUENO, "DENTAL", sinAnalytics), false);
  assert.ok(menuNuevo(DUENO, sinAnalytics).includes("reports"));
  assert.deepEqual(modulosSinReportes(null, DUENO, "DENTAL"), []);
});

test("la pestaña pide el mismo permiso que Reportes y lee las cifras de la misma fuente", () => {
  const pestana = leer("app/dashboard/analytics/reports/page.tsx");
  const vieja = leer("app/dashboard/reports/page.tsx");
  for (const [nombre, src] of [["pestaña", pestana], ["reports/page.tsx", vieja]] as const) {
    assert.match(src, /requirePermissionOrRedirect\(user, "reports\.view"\)/, `${nombre} pide reports.view`);
    assert.match(src, /await cargarReportes\(/, `${nombre} lee de cargarReportes`);
    assert.doesNotMatch(src, /prisma\./, `${nombre} no consulta por su cuenta: una sola fuente`);
  }
  // La fuente conserva el criterio de ingresos de siempre y no pasa a nadie por alto.
  const fuente = leer("app/dashboard/reports/cargar-reportes.ts");
  assert.match(fuente, /revenuePaymentWhere\(clinicId, \{ gte: r\.start, lte: r\.end \}\)/);
  assert.equal((fuente.match(/where: \{\s*clinicId\b|revenuePaymentWhere\(clinicId/g) ?? []).length,
    (fuente.match(/prisma\.[a-zA-Z]+\.(count|aggregate|groupBy|findMany)\(/g) ?? []).length,
    "cada consulta va aislada por clinicId");
});

// ═══════════════════════════════════════════════════════════════════════════
// Con la bandera apagada: nadie se entera
// ═══════════════════════════════════════════════════════════════════════════
test("el menú de siempre sigue enseñando Reportes", () => {
  const reportes = NAV_ITEMS.find((i) => i.id === "reports")!;
  assert.equal(reportes.href, "/dashboard/reports");
  assert.equal(reportes.moduleKey, MODULO_REPORTES);
  assert.ok(shouldShowItem(reportes, DUENO, "DENTAL", LLAVES));
  assert.equal(NAV_ITEMS.filter((i) => i.moduleKey === MODULO_REPORTES).length, 1, "la llave no se lleva otra opción");
});

test("el layout solo recorta las llaves del menú NUEVO", () => {
  const layout = leer("app/dashboard/layout.tsx");
  assert.equal((layout.match(/modulosSinReportes\(/g) ?? []).length, 1);
  const ramaNueva = layout.slice(layout.indexOf("<MenuDosNivelesServidor"), layout.indexOf("<Sidebar {...sidebarProps} />"));
  assert.match(ramaNueva, /modulosSinReportes\(/, "el recorte vive dentro de la rama del menú nuevo");
  assert.match(layout, /<Sidebar \{\.\.\.sidebarProps\} \/>/, "el menú de siempre recibe las props de siempre");
});

test("apagada, la URL de la pestaña lleva a los Reportes de siempre, sin calcular nada", () => {
  const pestana = leer("app/dashboard/analytics/reports/page.tsx");
  const corte = pestana.indexOf('redirect("/dashboard/reports")');
  assert.ok(corte > -1);
  assert.ok(pestana.indexOf("menuDosNivelesEncendido(") < corte && corte < pestana.indexOf("await cargarReportes("));
});

test("Reportes sin la prop nueva se pinta como siempre", () => {
  const cliente = leer("app/dashboard/reports/reports-client.tsx");
  assert.match(cliente, /enAnalitica = false/);
  assert.match(cliente, /style=\{enAnalitica \? undefined : \{ padding: "clamp\(14px, 1\.6vw, 28px\)", maxWidth: 1400, margin: "0 auto" \}\}/);
  assert.doesNotMatch(leer("app/dashboard/reports/page.tsx"), /enAnalitica/, "la pantalla de siempre no la pasa");
});

// ═══════════════════════════════════════════════════════════════════════════
// No se borró nada
// ═══════════════════════════════════════════════════════════════════════════
test("la ruta y el código de Reportes siguen en su sitio", () => {
  for (const rel of [
    "app/dashboard/reports/page.tsx",
    "app/dashboard/reports/reports-client.tsx",
    "components/dashboard/reportes-rediseno/raiz.tsx",
    "components/dashboard/analytics/analytics-layout.tsx",
  ]) assert.ok(existsSync(join(SRC, rel)), `${rel} sigue existiendo`);
  // El marco de hoy (bandera apagada) no gana ninguna pestaña.
  assert.doesNotMatch(leer("components/dashboard/analytics/analytics-layout.tsx"), /analytics\/reports|tabReports/);
});
