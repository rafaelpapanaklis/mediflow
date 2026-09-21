/**
 * La hora del panel /admin.
 *
 * Run: npm run test:admin-zona
 *
 * EL CASO QUE LO DESTAPÓ, y que estas pruebas impiden que vuelva: el 20 de
 * septiembre de 2026, a las 19:52 de Mérida, `/admin` decía «21 de septiembre».
 * La página fechaba sin `timeZone`, así que usaba la del runtime — y el de
 * producción corre en UTC, seis horas por delante.
 *
 * Lo que de verdad dolía no era el texto sino los CORTES: a partir de las 18:00
 * de Mérida, lo cobrado «hoy» se sumaba al día siguiente. Por eso la mitad de
 * estas pruebas son sobre `inicioDelDia` / `inicioDelMes` / `inicioDelAnio` y
 * atacan justo la franja 18:00–23:59, que es donde el bug vive.
 *
 * Todas las pruebas construyen los instantes en UTC explícito (`...Z`), nunca
 * con `new Date(y, m, d)`, que depende de la zona de quien corre el test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_TZ,
  diaAdmin,
  diasDeCalendario,
  fechaLargaAdmin,
  fechaCortaAdmin,
  fechaHoraAdmin,
  horaAdmin,
  inicioDelAnio,
  inicioDelDia,
  inicioDelMes,
  inicioDelMesAnterior,
} from "./zona-horaria";

// Mérida es UTC−6 todo el año.
const OFFSET_H = 6;

test("la zona del panel es Mérida", () => {
  assert.equal(ADMIN_TZ, "America/Merida");
});

// ─────────────────────────────────────────────────────────────────────────────
// El caso exacto que reportó Rafael
// ─────────────────────────────────────────────────────────────────────────────

test("a las 19:52 de Mérida del 20-sep, el panel dice 20 de septiembre (no 21)", () => {
  // 20-sep-2026 19:52 en Mérida = 21-sep-2026 01:52 UTC.
  const instante = new Date("2026-09-21T01:52:00.000Z");

  assert.equal(diaAdmin(instante), "2026-09-20");
  assert.match(fechaLargaAdmin(instante), /20 de septiembre de 2026/);
  assert.equal(horaAdmin(instante), "19:52");

  // Y la comparación que NO hay que hacer, para dejar constancia de por qué
  // existe este módulo: en UTC ese mismo instante ya es día 21.
  assert.equal(instante.toISOString().slice(0, 10), "2026-09-21");
});

test("el corte de 'hoy' no se adelanta por la tarde: 19:52 sigue siendo el mismo día", () => {
  const tarde = new Date("2026-09-21T01:52:00.000Z"); // 20-sep 19:52 Mérida
  const manana = new Date("2026-09-21T06:30:00.000Z"); // 21-sep 00:30 Mérida

  const corteTarde = inicioDelDia(tarde);
  const corteManana = inicioDelDia(manana);

  // 20-sep 00:00 Mérida = 20-sep 06:00 UTC
  assert.equal(corteTarde.toISOString(), "2026-09-20T06:00:00.000Z");
  assert.equal(corteManana.toISOString(), "2026-09-21T06:00:00.000Z");
  assert.notEqual(corteTarde.getTime(), corteManana.getTime());

  // Un cobro de las 19:52 cae DENTRO de hoy, no de mañana. Es el descuadre.
  assert.ok(tarde >= corteTarde, "las 19:52 pertenecen al día que empieza a las 06:00Z");
});

// ─────────────────────────────────────────────────────────────────────────────
// Cortes de día / mes / año
// ─────────────────────────────────────────────────────────────────────────────

test("inicioDelDia cae siempre en la medianoche de Mérida", () => {
  for (const iso of [
    "2026-09-20T06:00:00.000Z", // 00:00 Mérida, el borde exacto
    "2026-09-20T12:00:00.000Z", // 06:00
    "2026-09-21T05:59:59.999Z", // 23:59:59.999 del día 20
  ]) {
    const corte = inicioDelDia(new Date(iso));
    assert.equal(corte.toISOString(), "2026-09-20T06:00:00.000Z", `falla con ${iso}`);
    assert.equal(diaAdmin(corte), "2026-09-20");
  }
});

test("el último milisegundo del día y el primero del siguiente caen en días distintos", () => {
  const ultimo = new Date("2026-09-21T05:59:59.999Z");
  const primero = new Date("2026-09-21T06:00:00.000Z");
  assert.equal(diaAdmin(ultimo), "2026-09-20");
  assert.equal(diaAdmin(primero), "2026-09-21");
});

test("inicioDelMes: el día 1 a las 00:00 de Mérida", () => {
  // 30-sep 20:00 Mérida (= 1-oct 02:00 UTC) sigue siendo septiembre.
  const finDeMes = new Date("2026-10-01T02:00:00.000Z");
  assert.equal(inicioDelMes(finDeMes).toISOString(), "2026-09-01T06:00:00.000Z");
  assert.equal(diaAdmin(finDeMes), "2026-09-30");

  // Y un rato después ya es octubre.
  const yaOctubre = new Date("2026-10-01T06:30:00.000Z");
  assert.equal(inicioDelMes(yaOctubre).toISOString(), "2026-10-01T06:00:00.000Z");
});

test("inicioDelMesAnterior, incluido el salto de año", () => {
  assert.equal(
    inicioDelMesAnterior(new Date("2026-09-21T01:52:00.000Z")).toISOString(),
    "2026-08-01T06:00:00.000Z",
  );
  // 5 de enero → diciembre del año pasado.
  assert.equal(
    inicioDelMesAnterior(new Date("2026-01-05T18:00:00.000Z")).toISOString(),
    "2025-12-01T06:00:00.000Z",
  );
});

test("inicioDelAnio: 1 de enero a las 00:00 de Mérida", () => {
  // 31-dic 20:00 Mérida (= 1-ene 02:00 UTC) todavía es el año viejo. Este es el
  // caso que arruinaría un "ingresos del año" en Nochevieja.
  const nochevieja = new Date("2027-01-01T02:00:00.000Z");
  assert.equal(diaAdmin(nochevieja), "2026-12-31");
  assert.equal(inicioDelAnio(nochevieja).toISOString(), "2026-01-01T06:00:00.000Z");

  const anioNuevo = new Date("2027-01-01T07:00:00.000Z");
  assert.equal(inicioDelAnio(anioNuevo).toISOString(), "2027-01-01T06:00:00.000Z");
});

test("los tres cortes son coherentes entre sí", () => {
  const now = new Date("2026-09-21T01:52:00.000Z");
  const dia = inicioDelDia(now);
  const mes = inicioDelMes(now);
  const anio = inicioDelAnio(now);
  assert.ok(anio <= mes, "el año empieza antes que el mes");
  assert.ok(mes <= dia, "el mes empieza antes que el día");
  assert.ok(dia <= now, "el día empieza antes que ahora");
});

test("Mérida está en UTC−6 y no cambia en verano", () => {
  // Si Yucatán adoptara horario de verano, esto saltaría y habría que revisar
  // el comentario del módulo (la segunda pasada de instanteDeMedianoche ya lo
  // soporta, pero la documentación mentiría).
  for (const iso of ["2026-01-15T12:00:00.000Z", "2026-07-15T12:00:00.000Z"]) {
    const d = new Date(iso);
    const corte = inicioDelDia(d);
    const horasDesdeMedianocheUtc = corte.getUTCHours();
    assert.equal(horasDesdeMedianocheUtc, OFFSET_H, `offset distinto en ${iso}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Formato
// ─────────────────────────────────────────────────────────────────────────────

test("los formateadores NO dependen de la zona de quien corre el proceso", () => {
  // El mismo instante, formateado con el módulo, siempre da lo mismo — aunque
  // TZ del proceso sea UTC (que es como corre producción).
  const d = new Date("2026-09-21T01:52:00.000Z");
  // `sept?` porque la abreviatura del mes depende de la versión de ICU del
  // runtime ("sep" aquí, "sept" en otros). Lo que se afirma es el DÍA y la
  // HORA, que es lo que el bug rompía; la ortografía del mes no es el gate.
  assert.match(fechaCortaAdmin(d), /^20 sept?\.? 2026$/);
  assert.match(fechaHoraAdmin(d), /19:52/);
  assert.match(fechaHoraAdmin(d), /^20 sept?\.? 2026/);
});

test("fechaLargaAdmin sale en minúsculas, para que la UI ponga la mayúscula", () => {
  const texto = fechaLargaAdmin(new Date("2026-09-21T01:52:00.000Z"));
  assert.equal(texto[0], texto[0].toLowerCase());
  assert.match(texto, /^domingo/);
});

test("medianoche se formatea 00:00, nunca 24:00", () => {
  // Con hour12:false algunas versiones de ICU devuelven "24" para las 00:00.
  assert.equal(horaAdmin(new Date("2026-09-20T06:00:00.000Z")), "00:00");
  assert.equal(diaAdmin(new Date("2026-09-20T06:00:00.000Z")), "2026-09-20");
});

// ─────────────────────────────────────────────────────────────────────────────
// Días de calendario
// ─────────────────────────────────────────────────────────────────────────────

test("diasDeCalendario cuenta cambios de fecha, no tramos de 24 h", () => {
  // Ayer a las 23:00 y hoy a las 01:00: dos horas de diferencia, pero UN día.
  const ayerTarde = new Date("2026-09-21T05:00:00.000Z"); // 20-sep 23:00 Mérida
  const hoyMadrugada = new Date("2026-09-21T07:00:00.000Z"); // 21-sep 01:00 Mérida
  assert.equal(diasDeCalendario(ayerTarde, hoyMadrugada), 1);

  // Mismo día, doce horas de diferencia: cero días.
  assert.equal(
    diasDeCalendario(new Date("2026-09-20T12:00:00.000Z"), new Date("2026-09-21T00:00:00.000Z")),
    0,
  );
});

test("diasDeCalendario es negativo hacia el futuro y cero consigo mismo", () => {
  const a = new Date("2026-09-20T12:00:00.000Z");
  const b = new Date("2026-09-25T12:00:00.000Z");
  assert.equal(diasDeCalendario(a, b), 5);
  assert.equal(diasDeCalendario(b, a), -5);
  assert.equal(diasDeCalendario(a, a), 0);
});
