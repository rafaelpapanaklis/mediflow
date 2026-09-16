/**
 * El calendario de las vistas Semana y Mes (WS1-T2).
 *
 * Lo que defiende: que la rejilla que se PINTA es exactamente la que se PIDIÓ
 * a la API. `viewRangeUtc` es la única fuente de verdad de rangos de la
 * agenda; si el calendario de la vista se separa de ella aunque sea un día, el
 * Mes pinta una celda cuyas citas nadie pidió y sale vacía.
 *
 * Run: npm run test:agenda-calendario
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { viewRangeISO } from "@/lib/agenda/date-ranges";
import {
  diaDeLaSemana,
  diasDeLaSemana,
  filasDelMes,
  rejillaDelMes,
  sumaDias,
  tituloDeLaSemana,
  tituloDelMes,
} from "../calendario";

const TZ = "America/Mexico_City";

/* ── Lo que no se puede romper: cuadrar con viewRangeUtc ─────────────────── */

test("la semana que se pinta es la que se pide a la API", () => {
  for (const dayISO of ["2026-09-02", "2026-01-01", "2026-12-31", "2026-03-01", "2027-02-28"]) {
    const dias = diasDeLaSemana(dayISO);
    const rango = viewRangeISO("week", dayISO, TZ);
    assert.equal(dias[0]!.iso, rango.from, `lunes de ${dayISO}`);
    assert.equal(dias[6]!.iso, rango.to, `domingo de ${dayISO}`);
  }
});

test("la rejilla del mes es la que se pide a la API: 42 días, mismo arranque", () => {
  for (const dayISO of ["2026-09-02", "2026-02-15", "2026-03-01", "2026-11-30", "2028-02-29"]) {
    const celdas = rejillaDelMes(dayISO);
    const rango = viewRangeISO("month", dayISO, TZ);
    assert.equal(celdas.length, 42);
    assert.equal(celdas[0]!.iso, rango.from, `arranque de ${dayISO}`);
    assert.equal(celdas[41]!.iso, rango.to, `final de ${dayISO}`);
  }
});

test("la rejilla siempre arranca en lunes y no salta días", () => {
  const celdas = rejillaDelMes("2026-09-02");
  assert.equal(diaDeLaSemana(celdas[0]!.iso), 0);
  for (let i = 1; i < celdas.length; i++) {
    assert.equal(celdas[i]!.iso, sumaDias(celdas[i - 1]!.iso, 1));
  }
});

/* ── Filas: cinco cuando el mes cabe en cinco ────────────────────────────── */

test("septiembre 2026 se pinta en cinco filas, como el diseño", () => {
  const filas = filasDelMes("2026-09-02");
  assert.equal(filas.length, 5);
  assert.equal(filas[0]![0]!.iso, "2026-08-31"); // la cola de agosto
  assert.equal(filas[4]![6]!.iso, "2026-10-04"); // la cola de octubre
});

test("un mes que necesita seis filas las tiene (no se recorta ni un día del mes)", () => {
  // Agosto 2026 empieza en sábado y tiene 31 días → seis filas.
  const filas = filasDelMes("2026-08-15");
  assert.equal(filas.length, 6);
  const delMes = filas.flat().filter((c) => !c.fuera);
  assert.equal(delMes.length, 31);
  assert.equal(delMes[0]!.iso, "2026-08-01");
  assert.equal(delMes[30]!.iso, "2026-08-31");
});

test("ningún mes pierde un día por el recorte de filas", () => {
  for (let anio = 2026; anio <= 2028; anio++) {
    for (let mes = 1; mes <= 12; mes++) {
      const dayISO = `${anio}-${String(mes).padStart(2, "0")}-15`;
      const delMes = filasDelMes(dayISO).flat().filter((c) => !c.fuera);
      const esperados = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
      assert.equal(delMes.length, esperados, `${dayISO} pintó ${delMes.length} de ${esperados}`);
    }
  }
});

test("febrero de un año bisiesto que arranca en lunes cabe en cuatro filas y no se rompe", () => {
  // Febrero 2027 empieza en lunes y tiene 28 días: 4 filas exactas.
  const filas = filasDelMes("2027-02-10");
  assert.equal(filas.length, 4);
  assert.equal(filas.flat().filter((c) => !c.fuera).length, 28);
});

/* ── Títulos de periodo ──────────────────────────────────────────────────── */

test("el título del mes va con mayúscula inicial", () => {
  assert.equal(tituloDelMes("2026-09-02"), "Septiembre 2026");
  assert.equal(tituloDelMes("2026-12-31"), "Diciembre 2026");
});

test("el título de la semana repite el mes solo cuando la semana lo cruza", () => {
  assert.equal(tituloDeLaSemana("2026-09-02"), "31 ago – 6 sep 2026");
  assert.equal(tituloDeLaSemana("2026-09-09"), "7 – 13 sep 2026");
});

/* ── Aritmética ──────────────────────────────────────────────────────────── */

test("sumar días cruza meses y años sin desviarse", () => {
  assert.equal(sumaDias("2026-12-31", 1), "2027-01-01");
  assert.equal(sumaDias("2027-01-01", -1), "2026-12-31");
  assert.equal(sumaDias("2028-02-28", 1), "2028-02-29"); // bisiesto
  assert.equal(sumaDias("2027-02-28", 1), "2027-03-01");
});

test("lunes es 0 y domingo es 6 (la convención de ClinicSchedule)", () => {
  assert.equal(diaDeLaSemana("2026-08-31"), 0); // lunes
  assert.equal(diaDeLaSemana("2026-09-05"), 5); // sábado
  assert.equal(diaDeLaSemana("2026-09-06"), 6); // domingo
});
