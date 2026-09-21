/**
 * La zona del panel /admin. Sin base de datos.
 *
 *   npm run test:zona-admin
 *
 * El caso que las motiva es real: el 20-sep-2026 a las 19:52 de Mérida el panel
 * decía «21 de septiembre», porque formateaba sin `timeZone`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ZONA_ADMIN, fechaAdmin, fechaLargaAdmin, fechaHoraAdmin, horaAdmin,
  diaAdmin, inicioDeHoy, finDeHoy, inicioDeMes, inicioDeAnio,
  inicioDeHaceDias, cortesAdmin,
} from "./zona-horaria";

/**
 * 20-sep-2026, 19:52 en Mérida = 21-sep-2026, 01:52 UTC.
 * El instante EXACTO en el que Rafael vio la fecha equivocada.
 */
const LA_QUEJA = new Date("2026-09-21T01:52:00.000Z");

test("la zona es Mérida y está en un solo sitio", () => {
  assert.equal(ZONA_ADMIN, "America/Merida");
});

test("el momento de la queja se fecha el 20, no el 21", () => {
  // Esto es lo que hacía el panel: sin timeZone, en un runtime UTC.
  const sinZona = new Intl.DateTimeFormat("es-MX", {
    timeZone: "UTC", day: "numeric", month: "short", year: "numeric",
  }).format(LA_QUEJA);
  assert.match(sinZona, /21/, "el bug: en UTC ya es 21");

  // Y esto es lo que hace ahora.
  assert.match(fechaAdmin(LA_QUEJA) ?? "", /20/);
  assert.match(fechaLargaAdmin(LA_QUEJA) ?? "", /20 de septiembre de 2026/);
  assert.equal(diaAdmin(LA_QUEJA), "2026-09-20");
  assert.equal(horaAdmin(LA_QUEJA), "19:52");
  assert.match(fechaHoraAdmin(LA_QUEJA) ?? "", /19:52/);
});

test("sin fecha se devuelve null y no una fecha inventada", () => {
  for (const v of [null, undefined, "", "no-es-fecha"]) {
    assert.equal(fechaAdmin(v as any), null);
    assert.equal(fechaHoraAdmin(v as any), null);
    assert.equal(horaAdmin(v as any), null);
  }
});

// ── Los cortes: el fallo que descuadraba los ingresos ──────────────────────

test("«hoy» empieza a medianoche de Mérida, no a medianoche del servidor", () => {
  // Medianoche del 20 en Mérida = 06:00 UTC del 20.
  assert.equal(inicioDeHoy(LA_QUEJA).toISOString(), "2026-09-20T06:00:00.000Z");
  assert.equal(finDeHoy(LA_QUEJA).toISOString(),    "2026-09-21T06:00:00.000Z");
});

test("un cobro de las 19:52 del 20 cae DENTRO de «hoy», no en mañana", () => {
  const { hoy, finHoy } = cortesAdmin(LA_QUEJA);
  const cobro = LA_QUEJA; // 19:52 de Mérida
  assert.ok(cobro >= hoy && cobro < finHoy, "es el fallo que notó Rafael");
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
  assert.equal(inicioDeHoy(pasadaMedianoche).toISOString(), "2026-09-21T06:00:00.000Z");
});

test("el mes y el año cortan en la medianoche de Mérida", () => {
  assert.equal(inicioDeMes(LA_QUEJA).toISOString(),  "2026-09-01T06:00:00.000Z");
  assert.equal(inicioDeAnio(LA_QUEJA).toISOString(), "2026-01-01T06:00:00.000Z");
});

test("el último día del mes a las 19:00 de Mérida todavía es de ESE mes", () => {
  // 30-sep 19:00 Mérida = 1-oct 01:00 UTC. Sin zona, contaría en octubre.
  const finDeMes = new Date("2026-10-01T01:00:00.000Z");
  assert.equal(diaAdmin(finDeMes), "2026-09-30");
  assert.equal(inicioDeMes(finDeMes).toISOString(), "2026-09-01T06:00:00.000Z");
});

test("el 31 de diciembre a las 19:00 de Mérida todavía es de ESE año", () => {
  const finDeAnio = new Date("2027-01-01T01:00:00.000Z");
  assert.equal(diaAdmin(finDeAnio), "2026-12-31");
  assert.equal(inicioDeAnio(finDeAnio).toISOString(), "2026-01-01T06:00:00.000Z");
});

test("la ventana de N días también corta a medianoche de Mérida", () => {
  assert.equal(inicioDeHaceDias(30, LA_QUEJA).toISOString(), "2026-08-21T06:00:00.000Z");
  assert.equal(inicioDeHaceDias(0,  LA_QUEJA).toISOString(), inicioDeHoy(LA_QUEJA).toISOString());
});

test("Mérida no tiene horario de verano: el desfase es −6 en enero y en julio", () => {
  // Si algún día volviera a tenerlo, este test lo cantaría en vez de que el
  // corte se moviera una hora en silencio.
  assert.equal(inicioDeHoy(new Date("2026-01-15T18:00:00.000Z")).toISOString(), "2026-01-15T06:00:00.000Z");
  assert.equal(inicioDeHoy(new Date("2026-07-15T18:00:00.000Z")).toISOString(), "2026-07-15T06:00:00.000Z");
});

test("cortesAdmin devuelve los tres cortes coherentes entre sí", () => {
  const c = cortesAdmin(LA_QUEJA);
  assert.ok(c.anio <= c.mes);
  assert.ok(c.mes  <= c.hoy);
  assert.ok(c.hoy  <= c.ahora);
  assert.ok(c.ahora < c.finHoy);
});
