/**
 * Módulo de Ortodoncia — candados de diseño (ws1-t3).
 *
 * Run: npx tsx --test src/components/specialties/orthodontics/modulo/__tests__/modulo-diseno.test.ts
 *
 * Lo que fija:
 *  1. Ni un color suelto: nada de hex, rgb()/hsl() ni `var(--accent)` crudo
 *     (era un triplete HSL y dejó botones invisibles) en las pantallas del
 *     módulo ni en sus componentes.
 *  2. La hoja del módulo no declara tokens ni tipografías: solo lee los
 *     `--pr-*` del rediseño y hereda la letra.
 *  3. El diseño no tocó las guardas del layout (clínica dental, módulo
 *     contratado de verdad, permiso `specialties.orthodontics`).
 *  4. El submenú dice dónde estás (`aria-current`) y conserva los seis
 *     apartados con el nombre que decidió Rafael.
 *  5. Los carteles «Próximamente» le hablan a la clínica, no a quien programa.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(__dirname, "..", "..", "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

const HOJA = "src/components/specialties/orthodontics/modulo/modulo.module.css";

const ARCHIVOS = [
  HOJA,
  "src/components/specialties/orthodontics/modulo/piezas.tsx",
  "src/components/specialties/orthodontics/modulo/submenu.tsx",
  "src/components/specialties/orthodontics/modulo/vista-tablero.tsx",
  "src/components/specialties/orthodontics/modulo/vista-alertas.tsx",
  "src/components/specialties/orthodontics/contratar/contratar.module.css",
  "src/components/specialties/orthodontics/contratar/vista-contratar.tsx",
  "src/components/specialties/orthodontics/contratar/TarjetaPrecio.tsx",
  "src/components/specialties/orthodontics/contratar/EsperandoActivacion.tsx",
  "src/app/dashboard/orthodontics/contratar/page.tsx",
  "src/components/specialties/orthodontics/OrthoPacientesTable.tsx",
  "src/components/specialties/orthodontics/OrthoModulePlaceholder.tsx",
  "src/components/specialties/orthodontics/EnviarIndicacionesButton.tsx",
  "src/components/specialties/orthodontics/EnviarRecordatorioButton.tsx",
  "src/components/specialties/orthodontics/configuracion/OrthoConfiguracionClient.tsx",
  "src/app/dashboard/orthodontics/layout.tsx",
  "src/app/dashboard/orthodontics/page.tsx",
  "src/app/dashboard/orthodontics/tablero/page.tsx",
  "src/app/dashboard/orthodontics/pacientes/page.tsx",
  "src/app/dashboard/orthodontics/cobranza/page.tsx",
  "src/app/dashboard/orthodontics/controles/page.tsx",
  "src/app/dashboard/orthodontics/alertas/page.tsx",
  "src/app/dashboard/orthodontics/configuracion/page.tsx",
];

/** Sin comentarios: un hex en una explicación no pinta nada. */
function sinComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("ni un color suelto en el módulo: sin hex, sin rgb()/hsl() y sin var(--accent)", () => {
  for (const rel of ARCHIVOS) {
    const codigo = sinComentarios(leer(rel));
    // Un hex de color: # + 3, 4, 6 u 8 cifras hexadecimales, que no sea un ancla (`#${id}`, href="#x").
    const hex = codigo.match(/#[0-9a-fA-F]{3,8}\b(?![\w-])/g) ?? [];
    assert.deepEqual(hex, [], `${rel}: color hex suelto`);
    assert.ok(!/\b(?:rgba?|hsla?)\(/.test(codigo), `${rel}: color rgb()/hsl() suelto`);
    assert.ok(!/var\(--accent\b/.test(codigo), `${rel}: var(--accent) crudo`);
  }
});

test("la hoja solo lee los tokens del rediseño y hereda la tipografía", () => {
  const css = sinComentarios(leer(HOJA));
  const leidos = new Set(Array.from(css.matchAll(/var\((--[a-z0-9-]+)/g), (m) => m[1]));
  const ajenos = Array.from(leidos).filter((v) => !v.startsWith("--pr-") && !v.startsWith("--kpi-"));
  assert.deepEqual(ajenos, [], "solo `--pr-*` (y el acento que KpiCard pone en su tarjeta)");
  // Lo único que se DECLARA son las variables globales redirigidas en `.raiz`.
  const declarados = Array.from(css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm), (m) => m[1]);
  assert.ok(declarados.length > 0);
  for (const d of declarados) assert.ok(!d.startsWith("--pr-"), `${d}: los --pr-* no se redeclaran aquí`);
  const familias = Array.from(css.matchAll(/font-family:\s*([^;]+);/g), (m) => m[1].trim());
  assert.ok(familias.every((f) => f === "inherit"), "ninguna tipografía nueva");
  assert.match(css, /font-variant-numeric:\s*tabular-nums/, "cifras de ancho fijo");
});

test("el layout conserva sus tres comprobaciones y monta la raíz y el submenú del módulo", () => {
  // Desde el 28-sep-2026 la decisión (a dónde va cada quien) vive en
  // `decidirEntradaAlModulo`, con sus propios tests
  // (src/lib/orthodontics/__tests__/contratar.test.ts). Aquí, que el layout
  // le siga dando las tres cosas y que pinte después de decidir.
  const layout = leer("src/app/dashboard/orthodontics/layout.tsx");
  assert.match(layout, /esDental: user\.clinic\.category === "DENTAL",/);
  assert.match(layout, /const active = await hasActiveOrthodonticsModule\(user\.clinicId\);/);
  assert.match(layout, /hasPermission\(\s*\{ role: user\.role, permissionsOverride: user\.permissionsOverride \},\s*"specialties\.orthodontics",\s*\)/);
  assert.match(layout, /<RaizModulo>\s*\{entrada\.tipo === "modulo" && <SubmenuOrtodoncia apartados=\{SUBMENU\} \/>\}\s*\{children\}\s*<\/RaizModulo>/);
  assert.ok(layout.indexOf("redirect(entrada.a)") < layout.indexOf("<RaizModulo>"), "se decide ANTES de pintar nada");
});

test("el submenú conserva los seis apartados, con su nombre, y marca el abierto", () => {
  const layout = leer("src/app/dashboard/orthodontics/layout.tsx");
  const apartados = Array.from(
    layout.matchAll(/\{ href: "(\/dashboard\/orthodontics\/[a-z]+)", label: "([^"]+)" \}/g),
    (m) => [m[1].split("/").pop(), m[2]],
  );
  assert.deepEqual(apartados, [
    ["tablero", "Tablero"],
    ["pacientes", "Pacientes en tratamiento"],
    ["cobranza", "Cobranza de mensualidades"],
    ["controles", "Controles / agenda"],
    ["alertas", "Alertas"],
    ["configuracion", "Configuración"],
  ]);
  const submenu = leer("src/components/specialties/orthodontics/modulo/submenu.tsx");
  assert.match(submenu, /^"use client";/, "lee la ruta: es de cliente");
  assert.match(submenu, /aria-current=\{activo \? "page" : undefined\}/);
  for (const [clave] of apartados) assert.match(submenu, new RegExp(`\\b${clave}: `), `ícono de ${clave}`);
});

test("los carteles «Próximamente» no enseñan nombres de archivos ni de oleadas", () => {
  for (const rel of ["src/app/dashboard/orthodontics/cobranza/page.tsx", "src/app/dashboard/orthodontics/controles/page.tsx"]) {
    const m = /description="([^"]+)"/.exec(leer(rel));
    assert.ok(m, `${rel}: tiene descripción`);
    assert.ok(!/REPORTE|\.ts\b|\.md\b|Ola \d|ws\d/i.test(m[1]), `${rel}: la descripción es para la clínica`);
  }
});
