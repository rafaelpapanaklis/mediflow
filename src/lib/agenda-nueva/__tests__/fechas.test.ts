/**
 * Navegación de fecha y títulos de periodo de la barra de herramientas.
 *
 * El objetivo de esta suite es que ningún salto de mes, de año o de horario de
 * verano corra la fecha un día. Todo se ancla al mediodía UTC justo para eso.
 *
 * Run: npm run test:agenda-nueva-fechas
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  diaAbreviado,
  esHoy,
  fechaCorta,
  inicioDeMes,
  inicioDeSemana,
  moverPeriodo,
  numeroDeDia,
  sumarDias,
  sumarMeses,
  tituloDePeriodo,
} from "../fechas";

/* ── Sumar días ────────────────────────────────────────────────────────── */

test("sumar días cruza meses, años y bisiestos sin perder uno", () => {
  assert.equal(sumarDias("2026-09-02", 1), "2026-09-03");
  assert.equal(sumarDias("2026-09-02", -1), "2026-09-01");
  assert.equal(sumarDias("2026-09-30", 1), "2026-10-01");
  assert.equal(sumarDias("2026-01-01", -1), "2025-12-31");
  assert.equal(sumarDias("2026-12-31", 1), "2027-01-01");
  // 2028 es bisiesto; 2026 no.
  assert.equal(sumarDias("2028-02-28", 1), "2028-02-29");
  assert.equal(sumarDias("2026-02-28", 1), "2026-03-01");
});

test("sumar 0 días no cambia nada, y ±n es reversible", () => {
  assert.equal(sumarDias("2026-09-02", 0), "2026-09-02");
  for (const n of [1, 7, 30, 365]) {
    assert.equal(sumarDias(sumarDias("2026-09-02", n), -n), "2026-09-02");
  }
});

test("un año entero de saltos de un día no pierde ni repite fecha", () => {
  const vistas = new Set<string>();
  let d = "2026-01-01";
  for (let i = 0; i < 365; i++) {
    assert.ok(!vistas.has(d), `fecha repetida: ${d}`);
    vistas.add(d);
    d = sumarDias(d, 1);
  }
  assert.equal(d, "2027-01-01");
});

/* ── Sumar meses ───────────────────────────────────────────────────────── */

test("sumar meses recorta el día al último del mes destino", () => {
  // Del 31 de enero, un mes adelante es el 28 de febrero, no el 3 de marzo.
  assert.equal(sumarMeses("2026-01-31", 1), "2026-02-28");
  assert.equal(sumarMeses("2028-01-31", 1), "2028-02-29"); // bisiesto
  assert.equal(sumarMeses("2026-03-31", -1), "2026-02-28");
  assert.equal(sumarMeses("2026-05-31", 1), "2026-06-30");
});

test("sumar meses cruza el año", () => {
  assert.equal(sumarMeses("2026-12-15", 1), "2027-01-15");
  assert.equal(sumarMeses("2026-01-15", -1), "2025-12-15");
});

/* ── Semanas ───────────────────────────────────────────────────────────── */

test("la semana empieza en lunes", () => {
  // 2026-09-02 es miércoles → su lunes es el 31 de agosto.
  assert.equal(inicioDeSemana("2026-09-02"), "2026-08-31");
  // Un lunes es su propio inicio.
  assert.equal(inicioDeSemana("2026-08-31"), "2026-08-31");
  // Un domingo pertenece a la semana que empezó el lunes anterior.
  assert.equal(inicioDeSemana("2026-09-06"), "2026-08-31");
});

test("inicioDeMes", () => {
  assert.equal(inicioDeMes("2026-09-17"), "2026-09-01");
  assert.equal(inicioDeMes("2026-01-01"), "2026-01-01");
});

/* ── Títulos ───────────────────────────────────────────────────────────── */

test("el título del Día es el del diseño", () => {
  assert.equal(tituloDePeriodo("dia", "2026-09-02"), "Miércoles 2 de septiembre");
  assert.equal(tituloDePeriodo("dia", "2026-09-16"), "Miércoles 16 de septiembre");
});

test("el título de la Semana es el del diseño, y cruza mes y año", () => {
  assert.equal(tituloDePeriodo("semana", "2026-09-02"), "31 ago – 6 sep 2026");
  // Una semana que cruza de año lleva los dos años.
  assert.equal(tituloDePeriodo("semana", "2026-12-31"), "28 dic 2026 – 3 ene 2027");
});

test("el título del Mes va en mayúscula", () => {
  assert.equal(tituloDePeriodo("mes", "2026-09-02"), "Septiembre 2026");
  assert.equal(tituloDePeriodo("mes", "2026-01-15"), "Enero 2026");
});

/* ── Las flechas ───────────────────────────────────────────────────────── */

test("las flechas mueven ±1 día, ±7 en semana y ±1 mes en mes", () => {
  assert.equal(moverPeriodo("dia", "2026-09-02", 1), "2026-09-03");
  assert.equal(moverPeriodo("dia", "2026-09-02", -1), "2026-09-01");
  assert.equal(moverPeriodo("semana", "2026-09-02", 1), "2026-09-09");
  assert.equal(moverPeriodo("semana", "2026-09-02", -1), "2026-08-26");
  // El prototipo no mueve el mes; el README dice «en producción ±1 mes».
  assert.equal(moverPeriodo("mes", "2026-09-02", 1), "2026-10-02");
  assert.equal(moverPeriodo("mes", "2026-09-30", 1), "2026-10-30");
  assert.equal(moverPeriodo("mes", "2026-01-31", 1), "2026-02-28");
});

/* ── «Hoy» es hoy EN LA CLÍNICA ────────────────────────────────────────── */

/**
 * Congela el reloj de verdad: `todayInTz` hace `new Date()`, y en V8 eso NO
 * pasa por `Date.now`, así que parchear `Date.now` no congela nada (se
 * descubrió aquí: el test pasaba «solo» sin estar midiendo nada). Hay que
 * sustituir el constructor.
 */
function conElRelojEn<T>(instanteISO: string, fn: () => T): T {
  const Real = globalThis.Date;
  const fijo = Real.parse(instanteISO);
  class Congelado extends Real {
    constructor(...args: ConstructorParameters<typeof Date>) {
      // @ts-expect-error — reenvío variádico al constructor nativo.
      super(...(args.length === 0 ? [fijo] : args));
    }
    static now() {
      return fijo;
    }
  }
  globalThis.Date = Congelado as unknown as DateConstructor;
  try {
    return fn();
  } finally {
    globalThis.Date = Real;
  }
}

test("el reloj congelado congela de verdad (si no, los dos tests de abajo mienten)", () => {
  conElRelojEn("2026-09-03T04:00:00.000Z", () => {
    assert.equal(new Date().toISOString(), "2026-09-03T04:00:00.000Z");
    assert.equal(Date.now(), Date.parse("2026-09-03T04:00:00.000Z"));
  });
  // Y lo devuelve al acabar.
  assert.ok(Math.abs(Date.now() - new Date().getTime()) < 1000);
});

test("esHoy compara contra el día de la clínica, no el del proceso", () => {
  // 2026-09-03 04:00 UTC: en México todavía es el 2; en Tokio y en UTC, el 3.
  conElRelojEn("2026-09-03T04:00:00.000Z", () => {
    assert.equal(esHoy("2026-09-02", "America/Mexico_City"), true);
    assert.equal(esHoy("2026-09-03", "America/Mexico_City"), false);
    assert.equal(esHoy("2026-09-03", "Asia/Tokyo"), true);
    assert.equal(esHoy("2026-09-03", "UTC"), true);
    assert.equal(esHoy("2026-09-02", "UTC"), false);
  });
});

test("el mismo instante es un día distinto según la clínica", () => {
  // Es la trampa que nos ha mordido antes: en Vercel el proceso corre en UTC,
  // así que una clínica mexicana vería «hoy» el día siguiente durante seis
  // horas cada noche si se comparara contra el reloj del servidor.
  conElRelojEn("2026-09-03T04:00:00.000Z", () => {
    const enMexico = esHoy("2026-09-02", "America/Mexico_City");
    const enUtc = esHoy("2026-09-02", "UTC");
    assert.notEqual(enMexico, enUtc, "el día tiene que depender de la zona de la clínica");
  });
});

/* ── Formatos cortos ───────────────────────────────────────────────────── */

test("fechaCorta y diaAbreviado", () => {
  assert.equal(fechaCorta("2026-09-02"), "Mié 2 sep");
  assert.equal(fechaCorta("2026-12-25"), "Vie 25 dic");
  assert.equal(diaAbreviado("2026-09-02"), "MIÉ");
  assert.equal(diaAbreviado("2026-09-07"), "LUN");
  assert.equal(numeroDeDia("2026-09-02"), 2);
  assert.equal(numeroDeDia("2026-09-30"), 30);
});
