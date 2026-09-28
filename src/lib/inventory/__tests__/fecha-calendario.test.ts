// ws1-t5 — fechas de calendario de Inventario: caducidad de un lote y el
// «hoy» de la clínica. Correr: npm run test:inventario-arreglos

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  diaDeCompra,
  fechaCalendarioDe,
  formatearFechaCalendario,
  formatearFechaDeCompra,
  hoyEnZona,
  inicioDelDiaEnZona,
  parseFechaCalendario,
  parseFechaDeCompra,
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

describe("la fecha de una compra: el inicio de ese día en la zona de la clínica", () => {
  const CDMX = "America/Mexico_City";
  const TIJUANA = "America/Tijuana";

  it("Ciudad de México (UTC−6): igual que antes, las 06:00Z", () => {
    assert.equal(inicioDelDiaEnZona("2026-10-01", CDMX)?.toISOString(), "2026-10-01T06:00:00.000Z");
  });

  it("Tijuana no es México: UTC−7 en verano y UTC−8 en invierno", () => {
    assert.equal(inicioDelDiaEnZona("2026-07-15", TIJUANA)?.toISOString(), "2026-07-15T07:00:00.000Z");
    assert.equal(inicioDelDiaEnZona("2026-12-15", TIJUANA)?.toISOString(), "2026-12-15T08:00:00.000Z");
  });

  it("el día del cambio de horario empieza a la hora de ANTES del cambio", () => {
    // Tijuana adelanta el reloj el 8-mar-2026 a las 02:00: ese día empieza en invierno.
    assert.equal(inicioDelDiaEnZona("2026-03-08", TIJUANA)?.toISOString(), "2026-03-08T08:00:00.000Z");
    assert.equal(inicioDelDiaEnZona("2026-03-09", TIJUANA)?.toISOString(), "2026-03-09T07:00:00.000Z");
    // Y lo atrasa el 1-nov-2026 a las 02:00: ese día empieza en verano.
    assert.equal(inicioDelDiaEnZona("2026-11-01", TIJUANA)?.toISOString(), "2026-11-01T07:00:00.000Z");
    assert.equal(inicioDelDiaEnZona("2026-11-02", TIJUANA)?.toISOString(), "2026-11-02T08:00:00.000Z");
  });

  it("sin zona, o con una que no existe, la de por defecto", () => {
    assert.equal(inicioDelDiaEnZona("2026-10-01", null)?.toISOString(), "2026-10-01T06:00:00.000Z");
    assert.equal(inicioDelDiaEnZona("2026-10-01", "Marte/Olympus")?.toISOString(), "2026-10-01T06:00:00.000Z");
  });

  it("un día que no existe no tiene inicio", () => {
    assert.equal(inicioDelDiaEnZona("2026-02-31", CDMX), null);
    assert.equal(inicioDelDiaEnZona("ayer", CDMX), null);
  });
});

describe("parseFechaDeCompra: lo que manda «Registrar compra»", () => {
  const ahora = new Date("2026-09-28T04:50:00.000Z");

  it("solo fecha → el inicio de ese día en la clínica", () => {
    assert.equal(parseFechaDeCompra("2026-10-01", "America/Mexico_City", ahora)?.toISOString(), "2026-10-01T06:00:00.000Z");
    assert.equal(parseFechaDeCompra("2026-12-15", "America/Tijuana", ahora)?.toISOString(), "2026-12-15T08:00:00.000Z");
  });

  it("sin fecha → ahora mismo", () => {
    assert.equal(parseFechaDeCompra(undefined, "America/Mexico_City", ahora), ahora);
    assert.equal(parseFechaDeCompra("", "America/Mexico_City", ahora), ahora);
    assert.equal(parseFechaDeCompra(null, "America/Mexico_City", ahora), ahora);
  });

  it("un ISO con su hora se respeta tal cual", () => {
    assert.equal(parseFechaDeCompra("2026-10-01T15:30:00.000Z", "America/Tijuana", ahora)?.toISOString(), "2026-10-01T15:30:00.000Z");
  });

  it("una fecha ilegible es inválida (la ruta responde 400), no «hoy»", () => {
    assert.equal(parseFechaDeCompra("2026-02-31", "America/Mexico_City", ahora), null);
    assert.equal(parseFechaDeCompra("mañana", "America/Mexico_City", ahora), null);
    assert.equal(parseFechaDeCompra(20261001, "America/Mexico_City", ahora), null);
  });

  it("el GASTO de la compra cae en su mes: el 1-oct no se va a septiembre", () => {
    // Gastos consulta el mes desde su medianoche local. Guardada a medianoche
    // UTC (como una caducidad), esta compra caería el 30-sep a las 18:00.
    const guardada = parseFechaDeCompra("2026-10-01", "America/Mexico_City", ahora)!;
    const inicioDeOctubreEnMexico = new Date("2026-10-01T00:00:00.000-06:00");
    assert.ok(guardada.getTime() >= inicioDeOctubreEnMexico.getTime());
    assert.ok(new Date("2026-10-01T00:00:00.000Z").getTime() < inicioDeOctubreEnMexico.getTime());
  });
});

describe("pintar la fecha de una compra: en la zona de la clínica, no en la del navegador", () => {
  it("ida y vuelta: lo que se tecleó es lo que se lee, en cada zona", () => {
    for (const zona of ["America/Mexico_City", "America/Tijuana", "America/Cancun", "America/Hermosillo"]) {
      for (const dia of ["2026-01-01", "2026-03-08", "2026-07-15", "2026-11-01", "2026-12-31"]) {
        assert.equal(diaDeCompra(parseFechaDeCompra(dia, zona), zona), dia, `${dia} en ${zona}`);
      }
    }
  });

  it("una compra de Tijuana ya no sale un día antes", () => {
    const guardada = "2026-12-15T08:00:00.000Z"; // 15-dic 00:00 en Tijuana
    assert.equal(diaDeCompra(guardada, "America/Tijuana"), "2026-12-15");
    assert.match(formatearFechaDeCompra(guardada, "America/Tijuana"), /^15 dic\.? 2026$/);
  });

  it("tolera las compras ya guardadas con la hora de México fija (06:00Z)", () => {
    const anterior = "2026-09-27T06:00:00.000Z";
    assert.equal(diaDeCompra(anterior, "America/Mexico_City"), "2026-09-27");
    // También si la clínica es de otro huso: el día que se tecleó fue el 27.
    assert.equal(diaDeCompra(anterior, "America/Tijuana"), "2026-09-27");
  });

  it("una compra sin fecha (guardada con la hora real) se lee en la zona de la clínica", () => {
    // Registrada el 27-sep a las 22:50 de México = 28-sep 04:50 UTC.
    assert.equal(diaDeCompra("2026-09-28T04:50:00.000Z", "America/Mexico_City"), "2026-09-27");
  });

  it("sin fecha, una raya", () => {
    assert.equal(diaDeCompra(null, "America/Mexico_City"), null);
    assert.equal(formatearFechaDeCompra("no es fecha", "America/Mexico_City"), "—");
  });
});
