/**
 * Rediseño de Caja (ws1-t4) — candados.
 *
 * Run: npx tsx --test src/components/dashboard/caja-rediseno/__tests__/caja-rediseno.test.ts
 *
 * Lo que fija:
 *  - Caja tiene DOS caminos en el mismo archivo, y la letra de los importes
 *    se vigila por separado en cada uno:
 *     · camino NUEVO (interruptor encendido): cero monoespaciada. Rafael pidió
 *       Instrument Sans en el 100 % del panel, importes, horas y folios
 *       incluidos, y las columnas se cuadran con `tabular-nums`.
 *     · camino VIEJO (interruptor apagado, las clínicas que pagan): la Caja de
 *       `main`, byte a byte. Las 16 monoespaciadas de siempre siguen ahí, cada
 *       una condicionada al interruptor. Un candado anterior prohibía la
 *       monoespaciada en todo `caja-client.tsx`, sin distinguir caminos, y eso
 *       cambió la letra del dinero a todas las clínicas sin la bandera.
 *  - El rediseño solo se viste con el interruptor: la raíz de `CajaClient`
 *    recibe `CLASES_CAJA_REDISENO` únicamente cuando `rediseno` es true, y
 *    `page.tsx` lo saca del MISMO interruptor que el menú de dos niveles.
 *  - La hoja del rediseño no inventa tokens ni trae hex: consume `--pr-*`
 *    (los del rediseño de Pacientes) y nada más, y toda regla cuelga de
 *    `.pagina` (o es una de las dos clases del encabezado).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(__dirname, "..", "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

const ARCHIVOS_CAJA = [
  "src/app/dashboard/caja/page.tsx",
  "src/app/dashboard/caja/caja-client.tsx",
  "src/components/dashboard/caja-rediseno/raiz.ts",
  "src/components/dashboard/caja-rediseno/caja-rediseno.module.css",
  "src/components/dashboard/caja-rediseno/caja-nueva.tsx",
  "src/components/dashboard/caja-rediseno/caja-nueva.module.css",
];

// Las dos palabras van partidas a propósito: el guardia de la tarea hace un
// grep literal sobre los archivos de Caja y este candado no debe saltar por
// nombrar lo que prohíbe.
const LETRA_DE_MAQUINA = new RegExp(["font-", "mono"].join("") + "|" + ["mono", "space"].join(""), "i");

// Cómo distingue el candado los dos caminos leyendo el archivo: la ÚNICA forma
// admitida de pedir la letra de máquina en `caja-client.tsx` es esta, literal,
// y siempre delante de `tabular-nums` (así estaban las 16 en main). Con el
// interruptor encendido vale `undefined` —React no escribe la propiedad— y con
// él apagado es la misma cadena, en la misma posición del objeto, que en main.
// `rediseno` es la prop de `CajaClient` o la de `SumRow`/`CloseLine` (lo fija
// el test de abajo); en cualquier otra función, tsc no la encontraría.
const LETRA_DE_SIEMPRE = ["var(--font-", "mono, ", "mono", "space)"].join("");
const SOLO_CAMINO_VIEJO = `fontFamily: rediseno ? undefined : "${LETRA_DE_SIEMPRE}", fontVariantNumeric: "tabular-nums"`;

/** Lo que cada monoespaciada de main viste, en el orden del archivo. */
const IMPORTES_DE_SIEMPRE: Array<[string, RegExp]> = [
  ["otros métodos del turno", /\{fmtMXNdec\(totals\.otherIncome\)\}/],
  ["importe de cada retiro", /−\{fmtMXNdec\(w\.amount\)\}/],
  ["movimientos del turno: importe", /\{signedAmount\(r\)\}/],
  ["movimientos del turno: descuento", /fmtMXNdec\(r\.discount\)/],
  ["historial de cortes: apertura", /fmtMXNdec\(h\.openingBalance\)/],
  ["historial de cortes: esperado", /fmtMXNdec\(h\.expectedCash\)/],
  ["historial de cortes: contado", /fmtMXNdec\(h\.countedClosingBalance\)/],
  ["abrir caja: PIN", /value=\{openPin\}/],
  ["abrir caja: confirmar PIN", /value=\{openPinConfirm\}/],
  ["abrir caja: apertura sugerida", /fmtMXNdec\(caja\.suggestedOpening\)/],
  ["retiro: PIN", /value=\{wPin\}/],
  ["cerrar caja: efectivo esperado", /fmtMXNdec\(totals\.expectedCash\)/],
  ["cerrar caja: PIN", /value=\{closePin\}/],
  ["resumen del corte: importe", /\{signedAmount\(r\)\}/],
  ["resumen del corte: SumRow", /strong \? 14\.5 : 13, .*\{value\}/],
  ["cerrar caja: CloseLine", /strong \? 14 : 13, .*\{value\}/],
];

test("camino nuevo: ni una letra de máquina que no dependa del interruptor", () => {
  for (const rel of ARCHIVOS_CAJA) {
    // Quitada la forma condicionada, que con el interruptor encendido no pinta
    // nada, no puede quedar ni una: eso sería monoespaciada en el rediseño.
    const texto = leer(rel).split(SOLO_CAMINO_VIEJO).join("");
    assert.doesNotMatch(texto, LETRA_DE_MAQUINA, `${rel} pide una letra de máquina que también sale con el rediseño`);
  }
  // Y fuera de caja-client.tsx no hay camino viejo que proteger: ahí, cero.
  for (const rel of ARCHIVOS_CAJA.filter(r => !r.endsWith("caja-client.tsx"))) {
    assert.ok(!leer(rel).includes(SOLO_CAMINO_VIEJO), `${rel} no tiene camino viejo`);
  }
});

test("camino viejo: las 16 monoespaciadas de main siguen ahí, cada una detrás del interruptor", () => {
  const cliente = leer("src/app/dashboard/caja/caja-client.tsx");
  const lineas = cliente.split("\n");
  const usos: number[] = [];
  for (let i = 0; i < lineas.length; i++) {
    const veces = lineas[i].split(SOLO_CAMINO_VIEJO).length - 1;
    assert.ok(veces <= 1, `línea ${i + 1}: más de una monoespaciada en la misma línea`);
    if (veces === 1) usos.push(i);
  }
  assert.equal(
    usos.length,
    IMPORTES_DE_SIEMPRE.length,
    `con el interruptor apagado Caja lleva ${IMPORTES_DE_SIEMPRE.length} importes en monoespaciada, como main; hay ${usos.length}`,
  );
  usos.forEach((i, n) => {
    const [que, ancla] = IMPORTES_DE_SIEMPRE[n];
    // El PIN lleva el estilo en una línea y el valor en la siguiente.
    const contexto = `${lineas[i]}\n${lineas[i + 1] ?? ""}`;
    assert.match(contexto, ancla, `la monoespaciada nº ${n + 1} (línea ${i + 1}) debería vestir «${que}»`);
  });
});

test("SumRow y CloseLine reciben el interruptor, obligatorio, en todas sus llamadas", () => {
  const cliente = leer("src/app/dashboard/caja/caja-client.tsx");
  for (const nombre of ["SumRow", "CloseLine"]) {
    // Obligatorio (sin `?`): una llamada que lo olvide no compila.
    assert.match(
      cliente,
      new RegExp(`function ${nombre}\\(\\{[^}]*\\brediseno\\b[^}]*\\}: \\{[^}]*\\brediseno: boolean[^}]*\\}\\)`),
      `${nombre} tiene que recibir \`rediseno: boolean\``,
    );
    const llamadas = cliente.match(new RegExp(`<${nombre}\\b[^>]*/>`, "g")) ?? [];
    assert.ok(llamadas.length > 0, `${nombre} se usa`);
    for (const llamada of llamadas) {
      assert.match(llamada, /\brediseno=\{rediseno\}/, `${nombre} sin el interruptor de la pantalla: ${llamada.trim()}`);
    }
  }
});

test("los importes de Caja llevan tabular-nums (así se cuadran las columnas)", () => {
  const cliente = leer("src/app/dashboard/caja/caja-client.tsx");
  const usos = cliente.match(/fontVariantNumeric:\s*"tabular-nums"/g) ?? [];
  assert.ok(usos.length >= 12, `esperaba al menos 12 importes con tabular-nums, hay ${usos.length}`);
  const hoja = leer("src/components/dashboard/caja-rediseno/caja-rediseno.module.css");
  assert.match(hoja, /\.pagina\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s);
});

test("la raíz solo lleva el rediseño con el interruptor encendido", () => {
  const cliente = leer("src/app/dashboard/caja/caja-client.tsx");
  assert.match(cliente, /rediseno\s*=\s*false\s*\}:\s*Props/, "el valor por defecto de `rediseno` es false");
  assert.match(cliente, /className=\{rediseno \? CLASES_CAJA_REDISENO : undefined\}/);
  // Y no se cuela por otro sitio: una sola raíz con las clases.
  assert.equal((cliente.match(/CLASES_CAJA_REDISENO/g) ?? []).length, 2, "import + una raíz");
});

test("page.tsx lee el MISMO interruptor que el menú de dos niveles", () => {
  const pagina = leer("src/app/dashboard/caja/page.tsx");
  assert.match(pagina, /from "@\/lib\/menu-dos-niveles\/interruptor"/);
  assert.match(pagina, /menuDosNivelesEncendido\(user\.clinicId\)/);
  assert.match(pagina, /rediseno=\{rediseno\}/);
});

test("la hoja del rediseño no declara tokens nuevos ni trae hex", () => {
  const hoja = leer("src/components/dashboard/caja-rediseno/caja-rediseno.module.css");
  assert.doesNotMatch(hoja, /#[0-9a-f]{3,8}\b/i, "un color en hex: eso vive en los tokens, no aquí");
  assert.doesNotMatch(hoja, /--pr-[a-z0-9-]+\s*:/, "declara un token --pr-*: los tokens son de la raíz del rediseño");
  assert.ok((hoja.match(/var\(--pr-/g) ?? []).length >= 40, "consume los tokens --pr-*");
});

test("toda regla de la hoja cuelga de .pagina (o es el encabezado)", () => {
  const hoja = leer("src/components/dashboard/caja-rediseno/caja-rediseno.module.css");
  const sinComentarios = hoja.replace(/\/\*[\s\S]*?\*\//g, "");
  // Selectores: lo que precede a cada `{` fuera de un bloque @media.
  const selectores = [...sinComentarios.matchAll(/(^|\})\s*([^{}@]+?)\s*\{/g)].map(m => m[2].trim());
  assert.ok(selectores.length > 30, "la hoja tiene reglas");
  for (const sel of selectores) {
    const ok = sel.split(",").every(parte => /\.pagina\b/.test(parte) || /^\.(titulo|subtitulo)$/.test(parte.trim()));
    assert.ok(ok, `regla fuera de .pagina: «${sel}»`);
  }
});

/* ══════════════════════════════════════════════════════════════════════
 * Caja reestructurada (ws1-t6): menos cuadros, nada escondido.
 * ══════════════════════════════════════════════════════════════════════ */

test("con el interruptor encendido, Caja monta la pantalla reestructurada y con él apagado el árbol de siempre", () => {
  const cliente = leer("src/app/dashboard/caja/caja-client.tsx");
  assert.match(cliente, /from "@\/components\/dashboard\/caja-rediseno\/caja-nueva"/);
  // Una sola bifurcación, y ANTES del árbol de siempre (el `else` es el de main).
  const bifurcacion = cliente.indexOf("{rediseno ? (");
  const cabeceraVieja = cliente.indexOf("{/* Header + tabs */}");
  assert.ok(bifurcacion > 0 && cabeceraVieja > bifurcacion, "el camino nuevo va delante y la cabecera vieja queda en el else");
  assert.match(cliente, /<CajaNueva\b/);
  // El motor sigue aquí: los modales y los manejadores no se mudaron.
  for (const fn of ["function startOpen", "async function openRegister", "async function recordWithdrawal", "async function closeRegister", "function downloadVentasCsv"]) {
    assert.ok(cliente.includes(fn), `${fn} sigue en caja-client.tsx`);
  }
  const nueva = leer("src/components/dashboard/caja-rediseno/caja-nueva.tsx");
  assert.doesNotMatch(nueva, /fetch\(|\/api\/caja/, "la pantalla nueva no llama a la red");
  assert.doesNotMatch(nueva, /useState\(/, "la pantalla nueva no tiene estado propio: todo viene de CajaClient");
});

test("ley 1: cada cifra que hoy se ve sin clic sigue a la vista en la pantalla reestructurada", () => {
  const nueva = leer("src/components/dashboard/caja-rediseno/caja-nueva.tsx");
  const cifras: Array<[string, RegExp]> = [
    ["facturado hoy",        /fmtMXNdec\(caja\.billedToday\)/],
    ["cobrado hoy",          /fmtMXNdec\(p\.collectedToday\)/],
    ["por cobrar",           /fmtMXNdec\(caja\.pendingToday\)/],
    ["vencido",              /fmtMXNdec\(caja\.overdueToday\)/],
    ["apertura",             /fmtMXNdec\(totals\.openingBalance\)/],
    ["ingresos del turno",   /fmtMXNdec\(totals\.totalIncome\)/],
    ["efectivo",             /fmtMXNdec\(totals\.cashIncome\)/],
    ["débito",               /fmtMXNdec\(totals\.cardDebitIncome\)/],
    ["crédito",              /fmtMXNdec\(totals\.cardCreditIncome\)/],
    ["otros métodos (si >0)", /totals\.otherIncome > 0 &&[\s\S]{0,200}fmtMXNdec\(totals\.otherIncome\)/],
    ["reembolsos (si >0)",   /totals\.refunds > 0 &&[\s\S]{0,200}−\$\{fmtMXNdec\(totals\.refunds\)\}/],
    ["descuentos",           /fmtMXNdec\(totals\.discounts\)/],
    ["IVA cobrado",          /fmtMXNdec\(totals\.tax\)/],
    ["retiros",              /fmtMXNdec\(totals\.withdrawals\)/],
    ["efectivo esperado",    /fmtMXNdec\(totals\.expectedCash\)/],
    ["cada retiro: motivo, hora, quién e importe", /\{w\.reason\}[\s\S]{0,120}fmtTime\(w\.recordedAt\)[\s\S]{0,60}\{w\.recordedByName\}[\s\S]{0,120}−\{fmtMXNdec\(w\.amount\)\}/],
    ["ventas: importe con signo", /p\.signedAmount\(r\)/],
    ["ventas: descuento",    /−\$\{fmtMXNdec\(r\.discount\)\}/],
    ["apertura sugerida (caja cerrada)", /fmtMXNdec\(caja\.suggestedOpening\)/],
    ["historial: apertura",  /fmtMXNdec\(h\.openingBalance\)/],
    ["historial: esperado",  /fmtMXNdec\(h\.expectedCash\)/],
    ["historial: contado",   /fmtMXNdec\(h\.countedClosingBalance\)/],
    ["historial: diferencia", /fmtMXNdec\(h\.variance\)/],
  ];
  for (const [que, ancla] of cifras) assert.match(nueva, ancla, `falta «${que}»`);
});

test("ley 2: las cuatro acciones y el historial cuestan los mismos clics que hoy", () => {
  const nueva = leer("src/components/dashboard/caja-rediseno/caja-nueva.tsx");
  for (const accion of ["onClick={p.onOpen}", "onClick={p.onWithdrawal}", "onClick={p.onClose}", "onClick={p.onDownloadCsv}", "onClick={p.onToggleHistory}"]) {
    assert.ok(nueva.includes(accion), `${accion} directo, sin menú intermedio`);
  }
  // Historial: colapsado por defecto y con UN clic, como hoy (no dos, no cero).
  const cliente = leer("src/app/dashboard/caja/caja-client.tsx");
  assert.match(cliente, /useState\(false\);\s*$/m);
  assert.match(cliente, /onToggleHistory=\{\(\) => setShowHistory\(s => !s\)\}/);
});

test("ley 3: nada se esconde por ancho — las rejillas se apilan por contenedor y no hay puntos suspensivos", () => {
  const hoja = leer("src/components/dashboard/caja-rediseno/caja-nueva.module.css");
  assert.match(hoja, /\.cuerpo\s*\{[^}]*container-type:\s*inline-size/s);
  assert.ok((hoja.match(/@container caja \(max-width:/g) ?? []).length >= 3, "apila la tira, la rejilla y el arqueo");
  assert.doesNotMatch(hoja, /text-overflow:\s*ellipsis/, "un motivo o un nombre largo salta de línea, no se corta");
  assert.doesNotMatch(hoja, /#[0-9a-f]{3,8}\b/i, "sin hex: los colores se leen de los tokens");
  assert.doesNotMatch(hoja, /--pr-[a-z0-9-]+\s*:/, "no declara tokens: los hereda de la raíz");
  assert.ok((hoja.match(/var\(--pr-/g) ?? []).length >= 40, "consume los tokens --pr-*");
});
