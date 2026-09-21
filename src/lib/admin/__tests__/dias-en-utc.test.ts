/**
 * EL CASO DE RAFAEL: «en actividad sigo viendo como si ya pasó al día 21 de
 * septiembre cuando todavía son las 11:00 pm en mi zona horaria, que es Mérida».
 *
 * Run: npx tsx --test src/lib/admin/__tests__/dias-en-utc.test.ts
 *      npm run test:dias-en-utc
 *
 * El instante es SIEMPRE el mismo: 23:00 del 20-sep-2026 en Mérida, que en UTC
 * son las 05:00 del 21. `toISOString()` devuelve UTC, así que ahí es donde
 * aparecía el día de más.
 *
 * Dos mitades:
 *  1. La REGLA sobre `diaAdmin`/`inicioDeHaceDias` — el eje y el agrupado.
 *  2. El CABLEADO — que los cuatro sitios que agrupaban por día ya no fechen
 *     en UTC, leyendo el código fuente.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { diaAdmin, inicioDeHaceDias } from "@/lib/admin/zona-horaria";
import { diaDePeriodo, esFechaDeCalendario } from "@/lib/admin/dia-de-periodo";

/** 23:00 del 20-sep-2026 en Mérida (UTC−6) = 05:00 UTC del 21. */
const LAS_11_DE_LA_NOCHE = new Date("2026-09-21T05:00:00.000Z");

const SRC = join(__dirname, "..", "..", ".."); // src/
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

/**
 * Los candados de abajo miran CÓDIGO, no prosa: estos archivos explican en sus
 * comentarios el bug que arreglan, y esa explicación cita `toISOString()` y el
 * nombre de la zona. Sin quitar comentarios, el candado se dispararía con su
 * propia documentación.
 */
function soloCodigo(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

// ── 1. La regla ────────────────────────────────────────────────────────────

test("a las 23:00 de Mérida todavía es día 20, no 21", () => {
  // La prueba se cae si alguien vuelve a fechar en UTC.
  assert.equal(LAS_11_DE_LA_NOCHE.toISOString().slice(0, 10), "2026-09-21", "premisa del caso");
  assert.equal(diaAdmin(LAS_11_DE_LA_NOCHE), "2026-09-20");
});

test("el último día de la serie de 30 es el 20, no el 21", () => {
  // Mismo bucle que la gráfica «Actividad últimos 30 días».
  const serie: string[] = [];
  for (let i = 29; i >= 0; i--) {
    serie.push(diaAdmin(inicioDeHaceDias(i, LAS_11_DE_LA_NOCHE)));
  }
  assert.equal(serie.length, 30);
  assert.equal(serie.at(-1), "2026-09-20", "el eje NO puede terminar en el 21");
  assert.equal(serie[0], "2026-08-22", "30 días hacia atrás desde el 20");
  assert.equal(new Set(serie).size, 30, "ningún día repetido ni saltado");
});

test("un evento de las 22:30 de Mérida cae en el 20, no en el 21", () => {
  // 22:30 del 20 en Mérida = 04:30 UTC del 21.
  const evento = new Date("2026-09-21T04:30:00.000Z");
  assert.equal(evento.toISOString().slice(0, 10), "2026-09-21", "premisa");
  assert.equal(diaAdmin(evento), "2026-09-20");
});

test("el agrupado y el eje usan la MISMA clave", () => {
  // Si se arregla el eje y no el agrupado, las barras se mueven de columna.
  const evento = new Date("2026-09-21T04:30:00.000Z"); // 22:30 del 20 en Mérida
  const claveDelEvento = diaAdmin(evento);
  const claveDelEje = diaAdmin(inicioDeHaceDias(0, LAS_11_DE_LA_NOCHE));
  assert.equal(claveDelEvento, claveDelEje, "el evento tiene que caer en la última barra");
});

test("antes del mediodía UTC el día no cambia (no se arregló de más)", () => {
  // 10:00 de Mérida del 20 = 16:00 UTC del 20: aquí UTC y Mérida coinciden.
  const manana = new Date("2026-09-20T16:00:00.000Z");
  assert.equal(manana.toISOString().slice(0, 10), "2026-09-20");
  assert.equal(diaAdmin(manana), "2026-09-20");
});

// ── 2. El cableado: los cuatro sitios ──────────────────────────────────────

const ACTIVITY = leer(join("app", "api", "admin", "clinics", "[id]", "activity", "route.ts"));
const ACTIVITY_CODIGO = soloCodigo(ACTIVITY);
const ANALYTICS = leer(join("app", "admin", "analytics", "analytics-client.tsx"));
const ANALYTICS_CODIGO = soloCodigo(ANALYTICS);
const REPORTS_UI = leer(join("app", "admin", "reports", "reports-client.tsx"));
const REPORTS_UI_CODIGO = soloCodigo(REPORTS_UI);
const REPORTS_API = leer(join("app", "api", "admin", "reports", "route.ts"));
const REPORTS_API_CODIGO = soloCodigo(REPORTS_API);

test("la gráfica de actividad ya no agrupa ni pinta el eje en UTC", () => {
  assert.match(ACTIVITY, /from "@\/lib\/admin\/zona-horaria"/);
  assert.match(ACTIVITY, /diaAdmin\(new Date\(row\.createdAt\)\)/, "el agrupado");
  assert.match(ACTIVITY, /diaAdmin\(inicioDeHaceDias\(i\)\)/, "el eje");
  assert.equal(/toISOString\(\)\.slice\(0, ?10\)/.test(ACTIVITY_CODIGO), false, "queda un toISOString fechando");
});

test("analytics y reports (UI) derivan el día de la zona del panel", () => {
  for (const [nombre, texto, codigo] of [
    ["analytics", ANALYTICS, ANALYTICS_CODIGO],
    ["reports-client", REPORTS_UI, REPORTS_UI_CODIGO],
  ] as const) {
    assert.match(texto, /from "@\/lib\/admin\/zona-horaria"/, `${nombre} no importa el helper`);
    assert.equal(
      /toISOString\(\)\.slice\(0, ?10\)/.test(codigo),
      false,
      `${nombre} sigue fechando en UTC`,
    );
  }
});

test("el informe descargable no lleva un día de más en el nombre", () => {
  assert.match(REPORTS_API, /const fname = `dalecontrol-reporte-\$\{desde\}_\$\{hasta\}\.xlsx`/);
  assert.match(REPORTS_API, /Valor: `\$\{desde\} → \$\{hasta\}`/);
  assert.match(REPORTS_API, /Fecha: +diaAdmin\(inv\.createdAt\)/, "createdAt es un instante");
});

// ── La columna MIXTA: esto es lo que mueve dinero de un día a otro ────────

test("alta MANUAL: medianoche UTC es una FECHA, y no se retrasa al día anterior", () => {
  // `<input type="date">` con "2026-09-01" → new Date("2026-09-01") → 00:00 UTC.
  const manual = new Date("2026-09-01T00:00:00.000Z");
  assert.equal(esFechaDeCalendario(manual), true);
  assert.equal(
    diaAdmin(manual),
    "2026-08-31",
    "premisa: agruparla en Mérida la mandaría al 31 de agosto",
  );
  assert.equal(diaDePeriodo(manual), "2026-09-01", "el usuario escribió 1 de septiembre");
});

test("alta por STRIPE: un instante de madrugada UTC SÍ se fecha en Mérida", () => {
  // Corte a las 02:00 UTC del 20 = 20:00 del 19 en Mérida.
  const stripe = new Date("2026-09-20T02:00:00.000Z");
  assert.equal(esFechaDeCalendario(stripe), false);
  assert.equal(
    stripe.toISOString().slice(0, 10),
    "2026-09-20",
    "premisa: en UTC salía un día adelantado",
  );
  assert.equal(diaDePeriodo(stripe), "2026-09-19");
});

test("un instante de Stripe a media tarde no se mueve", () => {
  // 18:30 UTC del 20 = 12:30 del 20 en Mérida: mismo día por los dos caminos.
  const stripe = new Date("2026-09-20T18:30:00.000Z");
  assert.equal(diaDePeriodo(stripe), "2026-09-20");
  assert.equal(stripe.toISOString().slice(0, 10), "2026-09-20");
});

test("la marca es la medianoche UTC EXACTA, no «cerca de»", () => {
  assert.equal(esFechaDeCalendario(new Date("2026-09-01T00:00:00.000Z")), true);
  for (const casi of [
    "2026-09-01T00:00:00.001Z",
    "2026-09-01T00:00:01.000Z",
    "2026-09-01T00:01:00.000Z",
    "2026-09-01T01:00:00.000Z",
  ]) {
    assert.equal(esFechaDeCalendario(new Date(casi)), false, casi);
  }
});

test("el informe usa la regla de columna mixta, no un toISOString pelado", () => {
  assert.match(REPORTS_API, /PeriodoInicio: +diaDePeriodo\(inv\.periodStart\)/);
  assert.match(REPORTS_API, /PeriodoFin: +diaDePeriodo\(inv\.periodEnd\)/);
});

// ── Los dos cortes de MES que el añadido no nombraba ──────────────────────

const PORTADA = leer(join("app", "admin", "page.tsx"));
const PAGOS = leer(join("app", "admin", "payments", "page.tsx"));

test("la portada y /admin/payments cortan el mes en la zona del panel", () => {
  for (const [nombre, texto] of [["portada", PORTADA], ["payments", PAGOS]] as const) {
    assert.match(texto, /from "@\/lib\/admin\/zona-horaria"/, `${nombre} no importa el helper`);
    assert.match(texto, /inicioDelMes\(now\)/, `${nombre} no usa inicioDelMes`);
    assert.match(texto, /inicioDelMesAnterior\(now\)/, `${nombre} no usa inicioDelMesAnterior`);
    assert.equal(
      /new Date\(now\.getFullYear\(\), *now\.getMonth\(\)/.test(soloCodigo(texto)),
      false,
      `${nombre} sigue cortando el mes con la zona del runtime`,
    );
  }
});

test("el tramo del mes anterior no deja el hueco del último segundo", () => {
  // Antes: `lte: new Date(y, m, 0, 23,59,59)` — un pago a las 23:59:59.500 del
  // último día se perdía. Ahora es `lt: inicioDelMes`, el tramo entero.
  assert.match(PAGOS, /gte: firstOfPrevMonth, lt: firstOfMonth/);
  assert.equal(/lastOfPrevMonth/.test(soloCodigo(PAGOS)), false);
});

test("no se escribió otra versión de la zona horaria", () => {
  // El helper ya existía; duplicarlo costó una tarde una vez.
  for (const [nombre, codigo] of [
    ["activity", ACTIVITY_CODIGO],
    ["analytics", ANALYTICS_CODIGO],
    ["reports-client", REPORTS_UI_CODIGO],
    ["reports-api", REPORTS_API_CODIGO],
    ["portada", soloCodigo(PORTADA)],
    ["payments", soloCodigo(PAGOS)],
  ] as const) {
    assert.equal(
      /America\/(Merida|Mexico_City)/.test(codigo),
      false,
      `${nombre} declara la zona a mano en vez de usar el helper`,
    );
  }
});
