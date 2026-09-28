/**
 * WS1-T4 ronda 6 — `formatDate` no corre un día las fechas sin hora.
 *
 * Run: npm run test:format-date
 *      (o `TZ=America/Mexico_City npx tsx --test src/lib/__tests__/format-date.test.ts`)
 *
 * La pestaña «Citas» de la ficha manda `date: "2026-09-28"` (día de calendario en la
 * zona de la clínica). `new Date("2026-09-28")` es medianoche UTC, y en México (UTC−6)
 * `toLocaleDateString` pintaba «27 sep 2026»: cada cita salía un día antes.
 *
 * La zona se fija ANTES de cargar el módulo y el módulo se carga con `import()`
 * dinámico: un `import` estático se iza por encima de la asignación.
 */
process.env.TZ = "America/Mexico_City";

import { test } from "node:test";
import assert from "node:assert/strict";

const cargar = () => import("../utils");

/** Quita puntos y espacios raros (NBSP) para comparar sin depender de la versión de ICU. */
function limpio(s: string): string {
  return s.replace(/[  ]/g, " ").replace(/\./g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

test("la prueba corre de verdad en horario de México", () => {
  // Si esto falla, el resto del archivo no prueba nada: en UTC el fallo no se ve.
  assert.equal(new Date("2026-09-28T00:00:00.000Z").getDate(), 27);
});

test("«2026-09-28» se pinta como 28, no como 27", async () => {
  const { formatDate } = await cargar();
  const salida = limpio(formatDate("2026-09-28"));
  assert.match(salida, /\b28\b/);
  assert.doesNotMatch(salida, /\b27\b/);
  assert.equal(salida, "28 sep 2026");
});

test("«2026-01-01» es 1 ene 2026, no 31 dic 2025", async () => {
  const { formatDate } = await cargar();
  const salida = limpio(formatDate("2026-01-01"));
  assert.equal(salida, "1 ene 2026");
  assert.doesNotMatch(salida, /dic|2025/);
});

test("fin de mes y año bisiesto no se corren", async () => {
  const { formatDate } = await cargar();
  assert.equal(limpio(formatDate("2026-03-01")), "1 mar 2026");
  assert.equal(limpio(formatDate("2028-02-29")), "29 feb 2028");
  assert.equal(limpio(formatDate("2026-12-31")), "31 dic 2026");
});

test("un ISO con hora conserva su comportamiento: se pinta en la zona local", async () => {
  const { formatDate } = await cargar();
  const referencia = (v: string) =>
    new Date(v).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });

  // 02:00 UTC del 28 son las 20:00 del 27 en México: sigue saliendo 27, como antes.
  const deMadrugadaUtc = "2026-09-28T02:00:00.000Z";
  assert.equal(formatDate(deMadrugadaUtc), referencia(deMadrugadaUtc));
  assert.equal(limpio(formatDate(deMadrugadaUtc)), "27 sep 2026");

  // 18:00 UTC del 28 son las 12:00 del 28 en México.
  const deMediodia = "2026-09-28T18:00:00.000Z";
  assert.equal(formatDate(deMediodia), referencia(deMediodia));
  assert.equal(limpio(formatDate(deMediodia)), "28 sep 2026");
});

test("un objeto Date conserva su comportamiento", async () => {
  const { formatDate } = await cargar();
  const d = new Date("2026-09-28T02:00:00.000Z");
  assert.equal(
    formatDate(d),
    d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }),
  );
  assert.equal(limpio(formatDate(d)), "27 sep 2026");
});

test("solo casa la fecha exacta: con espacios o con hora no entra por la vía de calendario", async () => {
  const { formatDate } = await cargar();
  const referencia = (v: string) =>
    new Date(v).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
  for (const v of ["2026-09-28T00:00:00", "2026-09-28 10:30", "2026-09-28T00:00:00.000Z"]) {
    assert.equal(formatDate(v), referencia(v), v);
  }
});
