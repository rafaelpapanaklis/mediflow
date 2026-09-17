/**
 * CANDADOS DE LOS ESQUELETOS DE CARGA DEL REDISEÑO (ws1-t3, hallazgo 19).
 *
 * Run: npx tsx --test src/components/dashboard/esqueletos-rediseno/__tests__/esqueletos-rediseno.test.ts
 *
 * Se prueba leyendo el código fuente, como `hoy-rediseno.test.ts`: lo que se
 * vigila es CABLEADO —que cada loading.tsx conserve su esqueleto de siempre
 * para la bandera apagada, que no espere a nada para pintarse, que la carpeta
 * nueva no invente tokens ni letra de máquina— y eso se ve en el archivo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..", "..");           // src/
const CARPETA = join(SRC, "components", "dashboard", "esqueletos-rediseno");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const archivosNuevos = readdirSync(CARPETA)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => ({ nombre: f, texto: readFileSync(join(CARPETA, f), "utf8") }));

/** Los nueve loading.tsx de /dashboard y el esqueleto de siempre de cada uno. */
const LOADINGS: Array<{ ruta: string; viejo: string; nuevo: string }> = [
  { ruta: "app/dashboard/loading.tsx",              viejo: "<DashboardSkeleton />",     nuevo: "<EsqueletoHoy />" },
  { ruta: "app/dashboard/agenda/loading.tsx",       viejo: "<AgendaSkeleton />",        nuevo: "<EsqueletoAgenda />" },
  { ruta: "app/dashboard/billing/loading.tsx",      viejo: "<ListSkeleton rows={8} />", nuevo: '<EsqueletoLista variante="caja" filas={8} />' },
  { ruta: "app/dashboard/inventory/loading.tsx",    viejo: "<ListSkeleton rows={10} />", nuevo: '<EsqueletoLista variante="inventario" filas={10} />' },
  { ruta: "app/dashboard/patients/loading.tsx",     viejo: "<ListSkeleton rows={10} />", nuevo: '<EsqueletoLista variante="pacientes" filas={10} />' },
  { ruta: "app/dashboard/patients/[id]/loading.tsx", viejo: "<PatientDetailSkeleton />", nuevo: "<EsqueletoExpediente />" },
  { ruta: "app/dashboard/inbox/loading.tsx",        viejo: "<EsqueletoViejo />",        nuevo: "<EsqueletoInbox />" },
  { ruta: "app/dashboard/team/loading.tsx",         viejo: "<EsqueletoViejo />",        nuevo: "<EsqueletoEquipo />" },
  { ruta: "app/dashboard/suspended/loading.tsx",    viejo: "<EsqueletoViejo />",        nuevo: "<EsqueletoCuenta />" },
];

// ═══════════════════════════════════════════════════════════════════════════
// Instrument Sans en el 100 %: ni una letra de máquina en la carpeta nueva
// ═══════════════════════════════════════════════════════════════════════════
const LETRA_DE_MAQUINA = new RegExp(["font-", "mono", "|", "ui-", "mono", "space", "|", "mono", "space"].join(""));

test("sin letra de máquina en la carpeta de los esqueletos", () => {
  assert.ok(archivosNuevos.length >= 4, "faltan archivos en la carpeta");
  for (const a of archivosNuevos) {
    assert.ok(!LETRA_DE_MAQUINA.test(a.texto), `${a.nombre} usa letra de máquina`);
  }
  const css = archivosNuevos.find((a) => a.nombre === "esqueletos.module.css")!.texto;
  assert.match(css, /font-variant-numeric:\s*tabular-nums/, "las cifras se alinean con tabular-nums");
});

// ═══════════════════════════════════════════════════════════════════════════
// Sin tokens propios ni colores a mano: la hoja solo LEE los del menú
// ═══════════════════════════════════════════════════════════════════════════
test("esqueletos.module.css no declara variables ni escribe un solo color", () => {
  const css = archivosNuevos.find((a) => a.nombre === "esqueletos.module.css")!.texto;
  const declaraciones = css.match(/^\s*--[a-z0-9-]+\s*:/gim) ?? [];
  assert.deepEqual(declaraciones, [], `declara tokens propios: ${declaraciones.join(", ")}`);
  assert.match(css, /var\(--m2-/, "lee los tokens del menú");
  for (const a of archivosNuevos) {
    assert.ok(!/#[0-9a-f]{3,8}\b/i.test(a.texto.replace(/\/\*[\s\S]*?\*\//g, "")), `${a.nombre} trae un color escrito a mano`);
    assert.ok(!/rgba?\(/.test(a.texto), `${a.nombre} trae un rgb() a mano`);
  }
  for (const raiz of ["esqueletos.tsx", "esqueleto-inbox.tsx"]) {
    assert.match(leer(`components/dashboard/esqueletos-rediseno/${raiz}`), /CLASES_MENU/, `${raiz} no monta CLASES_MENU`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// El gris, el radio y el ritmo son los de las pantallas nuevas
// ═══════════════════════════════════════════════════════════════════════════
test("el hueso copia el esqueleto de Hoy y el ritmo del .skel-new de globals", () => {
  const css = archivosNuevos.find((a) => a.nombre === "esqueletos.module.css")!.texto;
  const hueso = css.slice(css.indexOf(".hueso {"), css.indexOf(".hueso::after"));
  assert.match(hueso, /border-radius:\s*10px/, "el radio del hueso es el del .esqueleto de Hoy (10px)");
  assert.match(hueso, /background:\s*var\(--m2-buscador-fondo\);\s*background:\s*color-mix\(in srgb, var\(--m2-texto\) 7%, transparent\)/, "el gris del hueso sale de la tinta del menú, con el gris de Hoy de respaldo");
  const hoy = leer("components/dashboard/hoy-rediseno/hoy.module.css");
  assert.match(hoy, /\.esqueleto \{\s*border-radius: 10px;/, "Hoy cambió el radio de su esqueleto: actualiza el hueso");
  assert.match(css, /animation:\s*esqueletoBrillo 1\.6s/, "el brillo dura lo mismo que .skel-new (1,6 s)");
  assert.match(leer("app/globals.css"), /animation: shimmer-new 1\.6s infinite/, "globals cambió el ritmo del .skel-new: revisa el brillo");
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*animation: none/, "sin movimiento cuando el sistema lo pide");
});

// ═══════════════════════════════════════════════════════════════════════════
// Cada loading.tsx conserva su esqueleto de siempre y elige con la bandera
// ═══════════════════════════════════════════════════════════════════════════
test("los nueve loading.tsx pasan el esqueleto de siempre como `viejo` y el nuevo como `nuevo`", () => {
  for (const l of LOADINGS) {
    const texto = leer(l.ruta);
    assert.match(texto, /export default function Loading\(\)/, `${l.ruta} perdió su default export`);
    assert.ok(texto.includes(`<EsqueletoSegunBandera viejo={${l.viejo}} nuevo={${l.nuevo}} />`),
      `${l.ruta} no monta <EsqueletoSegunBandera viejo={${l.viejo}} nuevo={${l.nuevo}} />`);
    // Un solo montaje del interruptor, y el default no hace nada más.
    assert.equal((texto.match(/<EsqueletoSegunBandera/g) ?? []).length, 1, `${l.ruta} monta el interruptor más de una vez`);
  }
  // Los tres con el esqueleto escrito dentro: la función de siempre sigue ahí,
  // solo cambió de nombre, y el default nuevo la pasa tal cual.
  for (const ruta of ["app/dashboard/inbox/loading.tsx", "app/dashboard/team/loading.tsx", "app/dashboard/suspended/loading.tsx"]) {
    const texto = leer(ruta);
    assert.match(texto, /^function EsqueletoViejo\(\) \{$/m, `${ruta} perdió el esqueleto de siempre`);
  }
  // Los seis que importan de loading-skeletons: el import de siempre sigue vivo.
  assert.match(leer("app/dashboard/loading.tsx"), /import \{ DashboardSkeleton \} from "@\/components\/dashboard\/loading-skeletons"/);
  assert.match(leer("app/dashboard/agenda/loading.tsx"), /import \{ AgendaSkeleton \} from "@\/components\/dashboard\/loading-skeletons"/);
  assert.match(leer("app/dashboard/patients/[id]/loading.tsx"), /import \{ PatientDetailSkeleton \} from "@\/components\/dashboard\/loading-skeletons"/);
  for (const ruta of ["billing", "inventory", "patients"]) {
    assert.match(leer(`app/dashboard/${ruta}/loading.tsx`), /import \{ ListSkeleton \} from "@\/components\/dashboard\/loading-skeletons"/);
  }
  // Y los esqueletos compartidos de siempre no se tocaron: siguen exportando lo mismo.
  const compartidos = leer("components/dashboard/loading-skeletons.tsx");
  for (const n of ["DashboardSkeleton", "AgendaSkeleton", "ListSkeleton", "PatientDetailSkeleton"]) {
    assert.match(compartidos, new RegExp(`export function ${n}\\(`), `loading-skeletons perdió ${n}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Sin esperar a nada: ningún loading.tsx consulta, es asíncrono ni retrasa
// ═══════════════════════════════════════════════════════════════════════════
test("ningún loading.tsx es asíncrono ni lee la bandera del servidor", () => {
  const prohibido = [/\basync\b/, /\bawait\b/, /getCurrentUser/, /menuDosNivelesEncendido/, /setTimeout/, /"use client"/, /cookies\(\)/, /headers\(\)/];
  for (const l of LOADINGS) {
    const texto = leer(l.ruta);
    for (const p of prohibido) assert.ok(!p.test(texto), `${l.ruta} contiene ${p}`);
  }
  // Sin comentarios: la explicación de por qué NO se consulta nombra las funciones.
  const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const a of archivosNuevos) {
    assert.ok(!/setTimeout|setInterval|\bawait\b|menuDosNivelesEncendido|getCurrentUser/.test(sinComentarios(a.texto)), `${a.nombre} espera o consulta algo`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// De dónde sale la bandera: del proveedor que el layout ya cablea
// ═══════════════════════════════════════════════════════════════════════════
test("el interruptor lee `apariencia` del NewAppointmentProvider y el layout la sigue cableando con menuDosNiveles", () => {
  const sw = leer("components/dashboard/esqueletos-rediseno/segun-bandera.tsx");
  assert.match(sw, /^"use client";/, "el interruptor es de cliente (lee un contexto)");
  assert.match(sw, /useNewAppointmentDialog\(\)\.apariencia === "nueva"/, "no lee la bandera del contexto");
  assert.match(sw, /try \{[\s\S]*useNewAppointmentDialog\(\)[\s\S]*\} catch \{[\s\S]*return false;/, "fuera del proveedor (minimalShell) tiene que caer al esqueleto de siempre");

  const layout = leer("app/dashboard/layout.tsx");
  assert.match(layout, /<NewAppointmentProvider apariencia=\{menuDosNiveles \? "nueva" : "clasica"\}>/, "el layout dejó de cablear apariencia con menuDosNiveles");
  assert.match(layout, /menuDosNivelesEncendido\(clinic\.id\)/, "el layout ya no resuelve el interruptor por clínica");
  assert.match(layout, /const minimalShell = \(/, "el minimalShell ya no existe: revisa si el try/catch sigue haciendo falta");

  const proveedor = leer("components/dashboard/new-appointment/new-appointment-provider.tsx");
  assert.match(proveedor, /\(\) => \(\{ open, close, apariencia \}\)/, "el proveedor dejó de exponer apariencia en su contexto");
});
