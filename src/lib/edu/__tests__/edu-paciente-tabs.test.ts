/**
 * LAS PESTAÑAS DE LA FICHA DEL PACIENTE.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-paciente-tabs.test.ts
 *
 * Dos cosas se fijan aquí, y las dos salieron de la misma auditoría:
 *
 *  1. QUE «PAGOS» ESTÉ EN LA LISTA. La ruta
 *     `/instituto/pacientes/[id]/pagos` existía, funcionaba y no estaba en
 *     las pestañas: caja abría la ficha de un paciente que paga a meses y
 *     no veía sus mensualidades por ningún lado. La única puerta en todo
 *     el panel era Caja → Pagos a meses → el plan → su recibo → «Ver al
 *     paciente». Y con `caja.view`, que es la misma key que exige la
 *     página: una pestaña con un permiso más flojo que su ruta es una
 *     pestaña que promete lo que no puede dar.
 *
 *  2. QUE EL ACTIVO POR PREFIJO NO ENCIENDA «RESUMEN» DE MÁS. El href de
 *     Resumen es la BASE de todos los demás, así que un `startsWith`
 *     suelto lo enciende en cualquier ruta hija. Con `/pagos` fuera de la
 *     lista eso ya pasaba —se veía «Resumen» encendido estando en Pagos— y
 *     volvería a pasar con la próxima ruta hija que alguien añada sin
 *     pestaña. La marca `exact` es lo que lo cierra, y aquí se comprueba
 *     con la MISMA función que usa el componente.
 *
 * Es una prueba de LÓGICA PURA y de FUENTE: no monta React (no hay DOM en
 * `tsx --test`), así que la resolución del activo se replica aquí a
 * partir del contrato, y un candado de fuente comprueba que el componente
 * y el layout siguen escritos como esta prueba supone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(__dirname, "..", "..", "..", "..");

function fuente(...tramos: string[]): string {
  return readFileSync(join(RAIZ, ...tramos), "utf8");
}

const LAYOUT = fuente(
  "src",
  "app",
  "instituto",
  "(panel)",
  "pacientes",
  "[id]",
  "layout.tsx",
);
const TABS = fuente("src", "components", "edu", "expediente", "paciente-tabs.tsx");

// ═══════════════════════════════════════════════════════════════════════
// 1 · LA RESOLUCIÓN DEL ACTIVO — el contrato, replicado
// ═══════════════════════════════════════════════════════════════════════

interface Pestana {
  key: string;
  href: string;
  label: string;
  exact?: boolean;
}

/** La misma regla que `EduPacienteTabs`: gana el href que coincide MÁS, y
 *  la pestaña `exact` solo cuenta con la ruta idéntica. */
function activo(tabs: Pestana[], pathname: string): string {
  let ganador = "";
  for (const t of tabs) {
    const coincide = t.exact
      ? pathname === t.href
      : pathname === t.href || pathname.startsWith(`${t.href}/`);
    if (coincide && t.href.length > ganador.length) ganador = t.href;
  }
  return ganador;
}

const BASE = "/instituto/pacientes/p1";
const TABS_COMPLETAS: Pestana[] = [
  { key: "resumen", href: BASE, label: "Resumen", exact: true },
  { key: "datos", href: `${BASE}/datos`, label: "Datos" },
  { key: "agenda", href: `${BASE}/agenda`, label: "Agenda" },
  { key: "casos", href: `${BASE}/casos`, label: "Casos" },
  { key: "expediente", href: `${BASE}/expediente`, label: "Expediente" },
  { key: "odontograma", href: `${BASE}/odontograma`, label: "Odontograma" },
  { key: "estudios", href: `${BASE}/estudios`, label: "Estudios" },
  { key: "consentimientos", href: `${BASE}/consentimientos`, label: "Consentimientos" },
  { key: "whatsapp", href: `${BASE}/whatsapp`, label: "WhatsApp" },
  { key: "recetas", href: `${BASE}/recetas`, label: "Recetas" },
  { key: "pagos", href: `${BASE}/pagos`, label: "Pagos" },
];

test("en /pagos se enciende Pagos, NO Resumen", () => {
  assert.equal(activo(TABS_COMPLETAS, `${BASE}/pagos`), `${BASE}/pagos`);
});

test("la portada solo se enciende en la ruta EXACTA", () => {
  assert.equal(activo(TABS_COMPLETAS, BASE), BASE);
  assert.equal(activo(TABS_COMPLETAS, `${BASE}/estudios`), `${BASE}/estudios`);
});

test("una ruta hija SIN pestaña propia no enciende Resumen", () => {
  // El fallo original, en su forma general: cualquier ruta que viva dentro
  // del layout y no tenga pestaña. Antes encendía «Resumen» y el usuario
  // leía que estaba en una pantalla en la que no estaba.
  const sinPagos = TABS_COMPLETAS.filter((t) => t.key !== "pagos");
  assert.equal(activo(sinPagos, `${BASE}/pagos`), "");
});

test("una subruta más honda enciende su pestaña, no la de arriba", () => {
  assert.equal(activo(TABS_COMPLETAS, `${BASE}/estudios/abc`), `${BASE}/estudios`);
});

test("sin la marca `exact`, Resumen volvería a ganar — la prueba de que hace falta", () => {
  const sinMarca = TABS_COMPLETAS.map(({ exact: _exact, ...resto }) => resto);
  const sinPagos = sinMarca.filter((t) => t.key !== "pagos");
  assert.equal(
    activo(sinPagos, `${BASE}/pagos`),
    BASE,
    "si esto deja de ser BASE, la marca `exact` ya no es lo que arregla el fallo",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 2 · CANDADOS DE FUENTE — que lo de arriba siga siendo lo que corre
// ═══════════════════════════════════════════════════════════════════════

/** Los ~400 caracteres que siguen a `key: "<x>"` en el layout. No se
 *  intenta casar la llave de cierre: el href es una plantilla con
 *  `${base}`, o sea que el bloque tiene llaves dentro. */
function trasLaKey(clave: string): string {
  const i = LAYOUT.indexOf(`key: "${clave}"`);
  assert.notEqual(i, -1, `el layout de la ficha debe declarar la pestaña key: "${clave}"`);
  return LAYOUT.slice(i, i + 400);
}

test("candado · la pestaña Pagos está en el layout y exige caja.view", () => {
  const bloque = trasLaKey("pagos");
  assert.ok(
    bloque.includes("${base}/pagos"),
    "la pestaña Pagos debe apuntar a `${base}/pagos`",
  );
  assert.ok(
    bloque.includes('permission: "caja.view"'),
    'la pestaña Pagos debe exigir "caja.view" — la misma key que su página',
  );
});

test("candado · la pestaña Resumen va marcada `exact`", () => {
  assert.ok(
    /exact:\s*true/.test(trasLaKey("resumen")),
    "Resumen tiene que ir con `exact: true`: su href es el prefijo de todas las demás",
  );
});

test("candado · el layout pasa `exact` al componente", () => {
  assert.ok(
    /\.map\(\(\{[^}]*\bexact\b[^}]*\}\)\s*=>/.test(LAYOUT),
    "el .map que arma `tabs` tiene que llevarse `exact`; si se pierde ahí, la marca no llega",
  );
});

test("candado · el componente respeta `exact` al resolver el activo", () => {
  assert.ok(
    TABS.includes("t.exact"),
    "paciente-tabs.tsx debe mirar `t.exact` al calcular la pestaña activa",
  );
});

test("candado · el «Más ▾» es código propio, sin una sola importación de dental", () => {
  const mas = fuente("src", "components", "edu", "expediente", "paciente-tabs-mas.tsx");
  // Se miran las RUTAS IMPORTADAS, no el texto suelto: los dos archivos
  // nombran a `src/components/dashboard/` en un comentario, justamente
  // para decir que no se toca.
  const importes = (src: string) =>
    Array.from(src.matchAll(/\bfrom\s+["']([^"']+)["']/g)).map((m) => m[1]);
  for (const archivo of [TABS, mas]) {
    for (const ruta of importes(archivo)) {
      assert.ok(
        !ruta.includes("components/dashboard") &&
          !ruta.includes("components/patient-3d") &&
          !ruta.includes("lib/patients"),
        `instituto no importa de dental: sobra "${ruta}". El patrón se copia, el archivo no ` +
          "(y el edu-guard sale con exit 1 si se cuela).",
      );
    }
  }
});

test("candado · la tira mide la FILA, no la ventana", () => {
  assert.ok(
    TABS.includes("ResizeObserver"),
    "el colapso se calcula con un ResizeObserver sobre la fila real",
  );
  assert.ok(
    !/ResizeObserver[\s\S]{0,200}observe\(\s*window/.test(TABS),
    "medir `window` es exactamente el error que empezó esta ola: el ancho útil " +
      "depende del cajón y del padding, y la ventana no sabe nada de eso",
  );
});
