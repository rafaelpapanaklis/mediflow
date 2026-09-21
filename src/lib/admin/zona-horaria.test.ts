/**
 * La hora del panel /admin: formato y cortes. Sin base de datos.
 *
 *   npm run test:zona-admin
 *
 * Este archivo es la FUSIÓN de las dos pruebas que existían por duplicado (una
 * por cada pantalla del panel). No se perdió ningún caso.
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
  ZONA_ADMIN,
  fechaAdmin,
  fechaLargaAdmin,
  fechaConDiaSemanaAdmin,
  fechaHoraAdmin,
  horaAdmin,
  diaAdmin,
  diasDeCalendario,
  inicioDelDia,
  finDelDia,
  inicioDelMes,
  inicioDelMesAnterior,
  inicioDelAnio,
  inicioDeHaceDias,
  cortesAdmin,
} from "./zona-horaria";

/**
 * 20-sep-2026, 19:52 en Mérida = 21-sep-2026, 01:52 UTC.
 * El instante EXACTO en el que Rafael vio la fecha equivocada.
 */
const LA_QUEJA = new Date("2026-09-21T01:52:00.000Z");

/** Mérida es UTC−6 todo el año. */
const OFFSET_H = 6;

test("la zona es Mérida, está en un solo sitio y con un solo nombre", () => {
  assert.equal(ZONA_ADMIN, "America/Merida");
});

// ─────────────────────────────────────────────────────────────────────────────
// El caso exacto que reportó Rafael
// ─────────────────────────────────────────────────────────────────────────────

test("el momento de la queja se fecha el 20, no el 21", () => {
  // Esto es lo que hacía el panel: sin timeZone, en un runtime UTC.
  const sinZona = new Intl.DateTimeFormat("es-MX", {
    timeZone: "UTC", day: "numeric", month: "short", year: "numeric",
  }).format(LA_QUEJA);
  assert.match(sinZona, /21/, "el bug: en UTC ya es 21");
  assert.equal(LA_QUEJA.toISOString().slice(0, 10), "2026-09-21");

  // Y esto es lo que hace ahora.
  assert.match(fechaAdmin(LA_QUEJA) ?? "", /20/);
  assert.match(fechaLargaAdmin(LA_QUEJA) ?? "", /20 de septiembre de 2026/);
  assert.match(fechaConDiaSemanaAdmin(LA_QUEJA) ?? "", /20 de septiembre de 2026/);
  assert.equal(diaAdmin(LA_QUEJA), "2026-09-20");
  assert.equal(horaAdmin(LA_QUEJA), "19:52");
  assert.match(fechaHoraAdmin(LA_QUEJA) ?? "", /19:52/);
});

test("a las 19:00 de Mérida, «hoy» sigue siendo el día de Mérida y no el de mañana en UTC", () => {
  // 20-sep 19:00 Mérida = 21-sep 01:00 UTC: el reloj del servidor ya pasó de día.
  const lasSieteDeLaTarde = new Date("2026-09-21T01:00:00.000Z");
  assert.equal(lasSieteDeLaTarde.toISOString().slice(0, 10), "2026-09-21", "en UTC ya es 21");

  assert.equal(diaAdmin(lasSieteDeLaTarde), "2026-09-20");
  assert.equal(inicioDelDia(lasSieteDeLaTarde).toISOString(), "2026-09-20T06:00:00.000Z");
  assert.equal(finDelDia(lasSieteDeLaTarde).toISOString(), "2026-09-21T06:00:00.000Z");

  // Un cobro de esa hora cae DENTRO de hoy, no de mañana. Ése es el descuadre.
  const { hoy, finHoy } = cortesAdmin(lasSieteDeLaTarde);
  assert.ok(lasSieteDeLaTarde >= hoy && lasSieteDeLaTarde < finHoy);
});

test("el corte de 'hoy' no se adelanta por la tarde: 19:52 y 00:30 son días distintos", () => {
  const tarde = LA_QUEJA;                               // 20-sep 19:52 Mérida
  const manana = new Date("2026-09-21T06:30:00.000Z");  // 21-sep 00:30 Mérida

  const corteTarde = inicioDelDia(tarde);
  const corteManana = inicioDelDia(manana);

  // 20-sep 00:00 Mérida = 20-sep 06:00 UTC
  assert.equal(corteTarde.toISOString(), "2026-09-20T06:00:00.000Z");
  assert.equal(corteManana.toISOString(), "2026-09-21T06:00:00.000Z");
  assert.notEqual(corteTarde.getTime(), corteManana.getTime());
  assert.ok(tarde >= corteTarde, "las 19:52 pertenecen al día que empieza a las 06:00Z");
});

// ─────────────────────────────────────────────────────────────────────────────
// Cortes de día / mes / año
// ─────────────────────────────────────────────────────────────────────────────

test("«hoy» empieza a medianoche de Mérida, no a medianoche del servidor", () => {
  assert.equal(inicioDelDia(LA_QUEJA).toISOString(), "2026-09-20T06:00:00.000Z");
  assert.equal(finDelDia(LA_QUEJA).toISOString(),    "2026-09-21T06:00:00.000Z");
});

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

test("un cobro de las 19:52 del 20 cae DENTRO de «hoy», no en mañana", () => {
  const { hoy, finHoy } = cortesAdmin(LA_QUEJA);
  assert.ok(LA_QUEJA >= hoy && LA_QUEJA < finHoy, "es el fallo que notó Rafael");
});

test("un cobro de las 23:59 de Mérida sigue siendo de hoy", () => {
  const casiMedianoche = new Date("2026-09-21T05:59:00.000Z"); // 23:59 del 20
  const { hoy, finHoy } = cortesAdmin(casiMedianoche);
  assert.equal(diaAdmin(casiMedianoche), "2026-09-20");
  assert.ok(casiMedianoche >= hoy && casiMedianoche < finHoy);
});

test("y uno de las 00:01 de Mérida ya es del día siguiente", () => {
  const pasadaMedianoche = new Date("2026-09-21T06:01:00.000Z"); // 00:01 del 21
  assert.equal(diaAdmin(pasadaMedianoche), "2026-09-21");
  assert.equal(inicioDelDia(pasadaMedianoche).toISOString(), "2026-09-21T06:00:00.000Z");
});

test("el último milisegundo del día y el primero del siguiente caen en días distintos", () => {
  const ultimo = new Date("2026-09-21T05:59:59.999Z");
  const primero = new Date("2026-09-21T06:00:00.000Z");
  assert.equal(diaAdmin(ultimo), "2026-09-20");
  assert.equal(diaAdmin(primero), "2026-09-21");
});

test("el mes y el año cortan en la medianoche de Mérida", () => {
  assert.equal(inicioDelMes(LA_QUEJA).toISOString(),  "2026-09-01T06:00:00.000Z");
  assert.equal(inicioDelAnio(LA_QUEJA).toISOString(), "2026-01-01T06:00:00.000Z");
});

test("el último día del mes a las 19:00 de Mérida todavía es de ESE mes", () => {
  // 30-sep 19:00 Mérida = 1-oct 01:00 UTC. Sin zona, contaría en octubre.
  const finDeMes = new Date("2026-10-01T01:00:00.000Z");
  assert.equal(diaAdmin(finDeMes), "2026-09-30");
  assert.equal(inicioDelMes(finDeMes).toISOString(), "2026-09-01T06:00:00.000Z");

  // Y un rato después ya es octubre.
  const yaOctubre = new Date("2026-10-01T06:30:00.000Z");
  assert.equal(inicioDelMes(yaOctubre).toISOString(), "2026-10-01T06:00:00.000Z");
});

test("inicioDelMesAnterior, incluido el salto de año", () => {
  assert.equal(inicioDelMesAnterior(LA_QUEJA).toISOString(), "2026-08-01T06:00:00.000Z");
  // 5 de enero → diciembre del año pasado.
  assert.equal(
    inicioDelMesAnterior(new Date("2026-01-05T18:00:00.000Z")).toISOString(),
    "2025-12-01T06:00:00.000Z",
  );
});

test("el 31 de diciembre a las 19:00 de Mérida todavía es de ESE año", () => {
  // El caso que arruinaría un «ingresos del año» en Nochevieja.
  const nochevieja = new Date("2027-01-01T01:00:00.000Z");
  assert.equal(diaAdmin(nochevieja), "2026-12-31");
  assert.equal(inicioDelAnio(nochevieja).toISOString(), "2026-01-01T06:00:00.000Z");

  const anioNuevo = new Date("2027-01-01T07:00:00.000Z");
  assert.equal(inicioDelAnio(anioNuevo).toISOString(), "2027-01-01T06:00:00.000Z");
});

test("la ventana de N días también corta a medianoche de Mérida", () => {
  assert.equal(inicioDeHaceDias(30, LA_QUEJA).toISOString(), "2026-08-21T06:00:00.000Z");
  assert.equal(inicioDeHaceDias(0,  LA_QUEJA).toISOString(), inicioDelDia(LA_QUEJA).toISOString());
});

test("los cortes son coherentes entre sí", () => {
  const c = cortesAdmin(LA_QUEJA);
  assert.ok(c.anio <= c.mes, "el año empieza antes que el mes");
  assert.ok(c.mes  <= c.hoy, "el mes empieza antes que el día");
  assert.ok(c.hoy  <= c.ahora, "el día empieza antes que ahora");
  assert.ok(c.ahora < c.finHoy);
  assert.ok(inicioDelMesAnterior(LA_QUEJA) < c.mes);
});

test("Mérida no tiene horario de verano: el desfase es −6 en enero y en julio", () => {
  // Si Yucatán volviera a tenerlo, esto saltaría en vez de que el corte se
  // moviera una hora en silencio (la segunda pasada de instanteDeMedianoche ya
  // lo soporta, pero la documentación del módulo mentiría).
  for (const iso of ["2026-01-15T18:00:00.000Z", "2026-07-15T18:00:00.000Z"]) {
    const corte = inicioDelDia(new Date(iso));
    assert.equal(corte.getUTCHours(), OFFSET_H, `offset distinto en ${iso}`);
    assert.equal(corte.toISOString(), `${iso.slice(0, 10)}T06:00:00.000Z`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Formato
// ─────────────────────────────────────────────────────────────────────────────

test("los formateadores NO dependen de la zona de quien corre el proceso", () => {
  // `sept?` porque la abreviatura del mes depende de la versión de ICU del
  // runtime ("sep" aquí, "sept" en otros). Lo que se afirma es el DÍA y la
  // HORA, que es lo que el bug rompía; la ortografía del mes no es el gate.
  assert.match(fechaAdmin(LA_QUEJA) ?? "", /^20 sept?\.? 2026$/);
  assert.match(fechaHoraAdmin(LA_QUEJA) ?? "", /^20 sept?\.? 2026/);
  assert.match(fechaHoraAdmin(LA_QUEJA) ?? "", /19:52/);
});

test("fechaConDiaSemanaAdmin lleva el día de la semana y fechaLargaAdmin no", () => {
  // Las dos ramas llamaban `fechaLargaAdmin` a cosas distintas. Aquí queda
  // fijado cuál es cuál: la portada quiere el día de la semana, la ficha de
  // clínica no.
  const conSemana = fechaConDiaSemanaAdmin(LA_QUEJA) ?? "";
  const larga = fechaLargaAdmin(LA_QUEJA) ?? "";
  assert.match(conSemana, /^domingo/);
  assert.equal(conSemana[0], conSemana[0].toLowerCase(), "la mayúscula la pone la UI");
  assert.doesNotMatch(larga, /domingo/);
  assert.match(larga, /^20 de septiembre de 2026$/);
});

test("medianoche se formatea 00:00, nunca 24:00", () => {
  // Con hour12:false algunas versiones de ICU devuelven "24" para las 00:00.
  assert.equal(horaAdmin(new Date("2026-09-20T06:00:00.000Z")), "00:00");
  assert.equal(diaAdmin(new Date("2026-09-20T06:00:00.000Z")), "2026-09-20");
});

test("sin fecha se devuelve null y no una fecha inventada", () => {
  for (const v of [null, undefined, "", "no-es-fecha"]) {
    assert.equal(fechaAdmin(v as any), null);
    assert.equal(fechaLargaAdmin(v as any), null);
    assert.equal(fechaConDiaSemanaAdmin(v as any), null);
    assert.equal(fechaHoraAdmin(v as any), null);
    assert.equal(horaAdmin(v as any), null);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Días de calendario
// ─────────────────────────────────────────────────────────────────────────────

test("diasDeCalendario cuenta cambios de fecha, no tramos de 24 h", () => {
  // Ayer a las 23:00 y hoy a las 01:00: dos horas de diferencia, pero UN día.
  const ayerTarde = new Date("2026-09-21T05:00:00.000Z");    // 20-sep 23:00 Mérida
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
