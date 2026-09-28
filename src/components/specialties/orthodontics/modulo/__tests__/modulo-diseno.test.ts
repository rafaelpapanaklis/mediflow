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
 *  5. Cobranza y Controles son pantallas de verdad, no carteles
 *     «Próximamente» (H16 de la QA en vivo, 28-sep-2026), y sus textos le
 *     hablan a la clínica, no a quien programa.
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
  "src/components/specialties/orthodontics/modulo/vista-cobranza.tsx",
  "src/components/specialties/orthodontics/modulo/vista-controles.tsx",
  "src/components/specialties/orthodontics/modulo/agendar-control.tsx",
  "src/components/specialties/orthodontics/modulo/abrir-caso.tsx",
  "src/components/specialties/orthodontics/modulo/fechas.ts",
  "src/components/specialties/orthodontics/contratar/contratar.module.css",
  "src/components/specialties/orthodontics/contratar/vista-contratar.tsx",
  "src/components/specialties/orthodontics/contratar/TarjetaPrecio.tsx",
  "src/components/specialties/orthodontics/contratar/EsperandoActivacion.tsx",
  "src/app/dashboard/contratar/ortodoncia/page.tsx",
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

test("el layout pasa por el guardia del módulo y monta la raíz y el submenú", () => {
  // Las tres comprobaciones (clínica dental, permiso, módulo contratado) viven
  // en `exigirModuloOrtodoncia`, y sus tests en
  // src/lib/orthodontics/__tests__/contratar.test.ts. Aquí, que el layout
  // pase por él ANTES de pintar nada.
  const layout = leer("src/app/dashboard/orthodontics/layout.tsx");
  assert.match(layout, /await exigirModuloOrtodoncia\(\);/);
  // `apartados` es SUBMENU sin lo que la persona no puede abrir (submenu-permisos.ts).
  assert.match(layout, /<RaizModulo>\s*<SubmenuOrtodoncia apartados=\{apartados\} \/>\s*\{children\}\s*<\/RaizModulo>/);
  assert.ok(layout.indexOf("await exigirModuloOrtodoncia()") < layout.indexOf("<RaizModulo>"));
});

test("el submenú conserva los seis apartados, con su nombre, marca el abierto y en el teléfono usa nombres cortos", () => {
  const layout = leer("src/app/dashboard/orthodontics/layout.tsx");
  const apartados = Array.from(
    layout.matchAll(/\{ href: "(\/dashboard\/orthodontics\/[a-z]+)", label: "([^"]+)", corto: "([^"]+)" \}/g),
    (m) => [m[1].split("/").pop(), m[2], m[3]],
  );
  assert.deepEqual(apartados, [
    ["tablero", "Tablero", "Tablero"],
    ["pacientes", "Pacientes en tratamiento", "Pacientes"],
    ["cobranza", "Cobranza de mensualidades", "Cobranza"],
    ["controles", "Controles / agenda", "Controles"],
    ["alertas", "Alertas", "Alertas"],
    ["configuracion", "Configuración", "Ajustes"],
  ]);
  for (const [, largo, corto] of apartados) assert.ok((corto as string).length <= 10 && (corto as string).length <= (largo as string).length);

  const submenu = leer("src/components/specialties/orthodontics/modulo/submenu.tsx");
  assert.match(submenu, /^"use client";/, "lee la ruta: es de cliente");
  assert.match(submenu, /aria-current=\{activo \? "page" : undefined\}/);
  assert.match(submenu, /aria-label=\{a\.label\}/, "el lector de pantalla lee siempre el nombre completo");
  assert.match(submenu, /<span className=\{s\.submenuCorto\} aria-hidden>/);
  for (const [clave] of apartados) assert.match(submenu, new RegExp(`\\b${clave}: `), `ícono de ${clave}`);

  // SOLO en el teléfono: fuera de esa media query el corto no se ve.
  const css = leer(HOJA).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /\.submenuCorto \{\s*display: none;\s*\}/);
  assert.match(css, /@media \(max-width: 639\.98px\) \{\s*\.submenuLargo \{\s*display: none;\s*\}\s*\.submenuCorto \{\s*display: inline;\s*\}/);
});

// Rafael, 28-sep-2026: «Alertas» y «Pacientes en tratamiento» salían como
// botones en la cabecera del Tablero y repetían el submenú. Para moverse por el
// módulo solo queda el submenú. Los botones de ACCIÓN («Abrir caso», «Cobrar»,
// «Agendar control») y los enlaces que salen del módulo (la Agenda, la ficha
// del paciente) se quedan: no repiten ninguna entrada.
//
// ws1-t4 ronda 6 (fila 14 de la revisión de lógica de uso): los INDICADORES del
// Tablero llevan a la lista que los explica. No son atajos que repitan el
// submenú: cada uno lleva su FILTRO o su ANCLA (los casos con vencido, los
// colocados este mes, los controles de hoy). Un enlace pelado a un apartado
// sigue prohibido, también en el Tablero.
const ENLACES_DE_INDICADOR = [
  "/dashboard/orthodontics/pacientes?estado=activos",
  "/dashboard/orthodontics/controles#controles-de-hoy",
  "/dashboard/orthodontics/cobranza?filtro=vencido",
  "/dashboard/orthodontics/pacientes?ver=colocados-este-mes",
  "/dashboard/orthodontics/pacientes?ver=retirados-este-mes",
];

test("los indicadores del Tablero llevan a su lista, siempre con filtro o ancla", () => {
  const tablero = sinComentarios(leer("src/components/specialties/orthodontics/modulo/vista-tablero.tsx"));
  const destinos = Array.from(tablero.matchAll(/<Indicador\s+href="([^"]+)"/g), (m) => m[1]);
  assert.deepEqual(destinos, ENLACES_DE_INDICADOR, "cada indicador, con su lista");
  for (const enlace of destinos) {
    assert.match(enlace, /[?#]/, `${enlace}: sin filtro ni ancla sería un atajo al submenú`);
  }
  const tarjetas = tablero.match(/<KpiCard\s/g) ?? [];
  assert.equal(tarjetas.length, destinos.length, "ningún indicador se queda sin salida");
});

test("sin atajos duplicados: ninguna vista del módulo enlaza a otro apartado del submenú", () => {
  const layout = leer("src/app/dashboard/orthodontics/layout.tsx");
  const apartados = Array.from(layout.matchAll(/\{ href: "(\/dashboard\/orthodontics\/[a-z]+)"/g), (m) => m[1]);
  assert.equal(apartados.length, 6);

  const vistas = [
    "src/components/specialties/orthodontics/modulo/vista-tablero.tsx",
    "src/components/specialties/orthodontics/modulo/vista-alertas.tsx",
    "src/components/specialties/orthodontics/modulo/vista-cobranza.tsx",
    "src/components/specialties/orthodontics/modulo/vista-controles.tsx",
    "src/components/specialties/orthodontics/modulo/abrir-caso.tsx",
    "src/components/specialties/orthodontics/modulo/agendar-control.tsx",
    "src/components/specialties/orthodontics/modulo/piezas.tsx",
    "src/components/specialties/orthodontics/OrthoPacientesTable.tsx",
    "src/components/specialties/orthodontics/configuracion/OrthoConfiguracionClient.tsx",
    ...apartados.map((a) => `src/app${a}/page.tsx`),
  ];
  for (const rel of vistas) {
    let codigo = sinComentarios(leer(rel));
    // Los indicadores del Tablero, y solo ellos, llevan a su lista filtrada.
    if (rel.endsWith("modulo/vista-tablero.tsx")) {
      for (const enlace of ENLACES_DE_INDICADOR) codigo = codigo.split(`"${enlace}"`).join('""');
    }
    for (const a of apartados) {
      assert.ok(!codigo.includes(`"${a}"`) && !codigo.includes(`\`${a}`), `${rel}: atajo a ${a}, que ya está en el submenú`);
    }
    assert.doesNotMatch(codigo, /["`]\/dashboard\/orthodontics["`/]/, `${rel}: enlace suelto al módulo`);
  }

  // El único sitio que los enlaza es el submenú, que los recibe del layout.
  const submenu = leer("src/components/specialties/orthodontics/modulo/submenu.tsx");
  assert.match(submenu, /href=\{a\.href\}/);
});

test("sin atajos duplicados: el Tablero no lleva botones en la cabecera", () => {
  const tablero = sinComentarios(leer("src/components/specialties/orthodontics/modulo/vista-tablero.tsx"));
  assert.doesNotMatch(tablero, /acciones=/);
  assert.doesNotMatch(tablero, /BellRing|\bUsers\b/, "ni sus íconos, que ya no usa nadie");
  // Fila 15 (ws1-t4 ronda 6, decisión del gerente): «Controles de hoy» lleva a
  // «Ver controles» dentro del módulo; a la Agenda se sale desde Controles.
  assert.match(tablero, /<Link href="\/dashboard\/orthodontics\/controles#controles-de-hoy" className=\{s\.enlace\}>\s*Ver controles/);
  assert.doesNotMatch(tablero, /\/dashboard\/agenda/);
});

test("los botones de acción se quedan", () => {
  assert.match(leer("src/app/dashboard/orthodontics/pacientes/page.tsx"), /acciones=\{puedeAbrirCaso \? <AbrirCasoBoton \/> : undefined\}/);
  assert.match(leer("src/components/specialties/orthodontics/modulo/vista-cobranza.tsx"), /<ListaMensualidades alCobrar=/);
  assert.match(leer("src/components/specialties/orthodontics/modulo/vista-controles.tsx"), /<AgendarControlBoton /);
});

test("H16: ningún apartado del submenú es un cartel «Próximamente»", () => {
  const layout = leer("src/app/dashboard/orthodontics/layout.tsx");
  const apartados = Array.from(layout.matchAll(/\{ href: "\/dashboard\/orthodontics\/([a-z]+)"/g), (m) => m[1]);
  assert.equal(apartados.length, 6);
  for (const a of apartados) {
    const pagina = leer(`src/app/dashboard/orthodontics/${a}/page.tsx`);
    assert.doesNotMatch(pagina, /OrthoModulePlaceholder/, `${a}: es una pantalla de verdad`);
    assert.match(pagina, /await exigirModuloOrtodoncia\(\);/, `${a}: pasa por el guardia del módulo`);
  }
});

test("los textos de Cobranza y Controles no enseñan nombres de archivos, de oleadas ni claves internas", () => {
  for (const rel of [
    "src/components/specialties/orthodontics/modulo/vista-cobranza.tsx",
    "src/components/specialties/orthodontics/modulo/vista-controles.tsx",
    "src/components/specialties/orthodontics/modulo/abrir-caso.tsx",
    "src/components/specialties/orthodontics/modulo/agendar-control.tsx",
  ]) {
    const codigo = sinComentarios(leer(rel));
    // Lo que se lee en pantalla: el texto entre etiquetas y los títulos/pistas.
    const textos = [
      ...Array.from(codigo.matchAll(/>\s*([^<>{}\n]*[a-záéíóúñ]{4,}[^<>{}\n]*)\s*</g), (m) => m[1]),
      ...Array.from(codigo.matchAll(/(?:titulo|pista|sub|placeholder|etiqueta|aria-label)=\{?"([^"]+)"/g), (m) => m[1]),
    ];
    assert.ok(textos.length > 0, rel);
    for (const t of textos) {
      assert.ok(!/REPORTE|\.tsx?\b|\.md\b|Ola \d|ws\d|NO_SHOW|PAGO_POR_CONTROL|billing\.|Próximamente|todavía no está lista/i.test(t), `${rel}: «${t}»`);
    }
  }
});

test("las vistas nuevas no calculan fechas con la zona del servidor", () => {
  for (const rel of [
    "src/components/specialties/orthodontics/modulo/vista-cobranza.tsx",
    "src/components/specialties/orthodontics/modulo/vista-controles.tsx",
  ]) {
    const codigo = sinComentarios(leer(rel));
    assert.doesNotMatch(codigo, /toLocale(Date|Time)String\(/, `${rel}: las fechas pasan por fechas.ts`);
    assert.doesNotMatch(codigo, /new Date\(/, `${rel}: «hoy» lo decide el servidor, en la zona de la clínica`);
  }
});
