// ws1-t5 — fechas de calendario de Inventario: caducidad de un lote y el
// «hoy» de la clínica. Correr: npm run test:inventario-arreglos

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fechaCalendarioDe,
  formatearFechaCalendario,
  hoyEnZona,
  parseFechaCalendario,
} from "../fecha-calendario";

describe("guardar una caducidad: medianoche UTC del día escrito", () => {
  it("«2026-09-01» se guarda como 2026-09-01T00:00Z", () => {
    assert.equal(parseFechaCalendario("2026-09-01")?.toISOString(), "2026-09-01T00:00:00.000Z");
  });

  it("de un ISO con hora toma el día que trae escrito, sin convertir zonas", () => {
    assert.equal(parseFechaCalendario("2026-10-07T06:00:00.000Z")?.toISOString(), "2026-10-07T00:00:00.000Z");
    assert.equal(parseFechaCalendario("2026-10-07T23:30:00-06:00")?.toISOString(), "2026-10-07T00:00:00.000Z");
  });

  it("una fecha que no existe o un texto suelto no se guarda", () => {
    assert.equal(parseFechaCalendario("2026-02-31"), null);
    assert.equal(parseFechaCalendario("2026-13-01"), null);
    assert.equal(parseFechaCalendario("mañana"), null);
    assert.equal(parseFechaCalendario(""), null);
    assert.equal(parseFechaCalendario(null), null);
    assert.equal(parseFechaCalendario(20260901), null);
  });

  it("el 29 de febrero vale en bisiesto y no en año normal", () => {
    assert.equal(parseFechaCalendario("2028-02-29")?.toISOString(), "2028-02-29T00:00:00.000Z");
    assert.equal(parseFechaCalendario("2027-02-29"), null);
  });
});

describe("pintar una caducidad: el mismo día con las DOS formas ya guardadas", () => {
  // Las dos filas reales de la clínica de prueba (dev.108, 28-sep-2026).
  const altaDeLote = "2026-09-01T00:00:00.000Z"; // se pintaba «31 ago 2026»
  const deUnaCompra = "2026-10-07T06:00:00.000Z"; // se pintaba bien

  it("la guardada a las 00:00Z ya no sale un día antes", () => {
    assert.equal(fechaCalendarioDe(altaDeLote), "2026-09-01");
    assert.match(formatearFechaCalendario(altaDeLote), /^01 sep\.? 2026$/);
  });

  it("la guardada a las 06:00Z sigue saliendo igual", () => {
    assert.equal(fechaCalendarioDe(deUnaCompra), "2026-10-07");
    assert.match(formatearFechaCalendario(deUnaCompra), /^07 oct\.? 2026$/);
  });

  it("acepta un Date igual que su ISO", () => {
    assert.equal(fechaCalendarioDe(new Date(altaDeLote)), "2026-09-01");
  });

  it("lo que se guarda y lo que se pinta son el mismo día (ida y vuelta)", () => {
    for (const dia of ["2026-01-01", "2026-09-01", "2026-12-31", "2028-02-29"]) {
      assert.equal(fechaCalendarioDe(parseFechaCalendario(dia)), dia);
    }
  });

  it("sin fecha, una raya; nunca «Invalid Date»", () => {
    assert.equal(formatearFechaCalendario(null), "—");
    assert.equal(formatearFechaCalendario("no es fecha"), "—");
    assert.equal(fechaCalendarioDe(undefined), null);
    assert.equal(fechaCalendarioDe("no es fecha"), null);
  });
});

describe("hoy en la zona de la clínica", () => {
  // 27-sep-2026 a las 22:50 de Ciudad de México = 28-sep 04:50 UTC. Es la hora
  // a la que «Registrar compra» proponía el 28.
  const nocheEnMexico = new Date("2026-09-28T04:50:00.000Z");

  it("de noche en México sigue siendo HOY, no mañana", () => {
    assert.equal(hoyEnZona("America/Mexico_City", nocheEnMexico), "2026-09-27");
    // Lo que hacía antes (`toISOString().slice(0, 10)`): el día en UTC.
    assert.equal(nocheEnMexico.toISOString().slice(0, 10), "2026-09-28");
  });

  it("justo antes y justo después de las 18:00 de México (medianoche UTC)", () => {
    assert.equal(hoyEnZona("America/Mexico_City", new Date("2026-09-27T23:59:00.000Z")), "2026-09-27");
    assert.equal(hoyEnZona("America/Mexico_City", new Date("2026-09-28T00:01:00.000Z")), "2026-09-27");
  });

  it("cada clínica en su zona: Tijuana va una o dos horas detrás", () => {
    // 28-sep 06:30 UTC = 00:30 del 28 en CDMX, 23:30 del 27 en Tijuana.
    const instante = new Date("2026-09-28T06:30:00.000Z");
    assert.equal(hoyEnZona("America/Mexico_City", instante), "2026-09-28");
    assert.equal(hoyEnZona("America/Tijuana", instante), "2026-09-27");
  });

  it("sin zona, o con una que no existe, cae en la de por defecto", () => {
    assert.equal(hoyEnZona(null, nocheEnMexico), "2026-09-27");
    assert.equal(hoyEnZona("", nocheEnMexico), "2026-09-27");
    assert.equal(hoyEnZona("   ", nocheEnMexico), "2026-09-27");
    assert.equal(hoyEnZona("Marte/Olympus", nocheEnMexico), "2026-09-27");
  });

  it("siempre devuelve AAAA-MM-DD, que es lo que pide un <input type=date>", () => {
    assert.match(hoyEnZona("America/Mexico_City", new Date("2026-01-05T12:00:00.000Z")), /^\d{4}-\d{2}-\d{2}$/);
  });
});
