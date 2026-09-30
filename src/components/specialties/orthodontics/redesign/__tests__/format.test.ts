// Tests de los helpers de formato del rediseño ortho.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fijarZonaDeLaClinica,
  fmtDate,
  fmtDateShort,
  fmtFechaHoraLarga,
  fmtTime,
  fmtDay,
  fmtDayLong,
  fmtMoney,
  fmtPct,
  fmtMm,
  avatarInitials,
  clinicalSeverityColor,
} from "../atoms/format";

describe("format helpers", () => {
  it("fmtMoney usa locale es-MX con $", () => {
    assert.equal(fmtMoney(33340), "$33,340");
    assert.equal(fmtMoney(0), "$0");
    assert.equal(fmtMoney(null), "—");
  });

  it("fmtPct redondea y agrega %", () => {
    assert.equal(fmtPct(78.4), "78%");
    assert.equal(fmtPct(100), "100%");
    assert.equal(fmtPct(null), "—");
  });

  it("fmtMm con un decimal", () => {
    assert.equal(fmtMm(3.5), "3.5 mm");
    assert.equal(fmtMm(0), "0.0 mm");
    assert.equal(fmtMm(null), "—");
  });

  it("avatarInitials toma 2 iniciales en upper", () => {
    assert.equal(avatarInitials("Gabriela Hernández Ruiz"), "GH");
    assert.equal(avatarInitials("juan pérez"), "JP");
    assert.equal(avatarInitials("Ana"), "A");
  });

  it("clinicalSeverityColor por umbrales", () => {
    assert.equal(clinicalSeverityColor(15), "emerald");
    assert.equal(clinicalSeverityColor(20), "amber");
    assert.equal(clinicalSeverityColor(29), "amber");
    assert.equal(clinicalSeverityColor(30), "rose");
    assert.equal(clinicalSeverityColor(60), "rose");
  });
  it("fmtDay pinta el día de calendario sin correrlo por la zona horaria", () => {
    // `new Date("2026-10-05")` es medianoche UTC: en México (UTC-6) se leía
    // como el 4 de octubre. El vencimiento de una mensualidad es un DÍA.
    const dia = fmtDay("2026-10-05");
    assert.match(dia, /^05/);
    assert.match(dia, /oct/i);
    assert.equal(fmtDay(null), "—");
    assert.equal(fmtDay(""), "—");
  });

  it("fmtDay/fmtDayLong toman el DÍA aunque llegue como datetime UTC (H8)", () => {
    // `installedAt`/`estimatedEndDate` viajan como
    // "2026-07-28T00:00:00.000Z" (un <input type="date"> pasado por
    // `new Date(v).toISOString()`), no como "2026-07-28" a secas. En una
    // zona negativa (México) esto se leía como "27 jul".
    const dia = fmtDay("2026-07-28T00:00:00.000Z");
    assert.match(dia, /^28/);
    assert.match(dia, /jul/i);

    const largo = fmtDayLong("2026-07-28T00:00:00.000Z");
    assert.match(largo, /^28/);
    assert.match(largo, /jul/i);
    assert.match(largo, /2026/);
    assert.equal(fmtDayLong(null), "—");
  });
});

describe("ws1-t6: las horas van en la zona de la clínica", () => {
  // 16:00 UTC = 10:00 en Ciudad de México (UTC-6) = 12:00 en Nueva York (UTC-4, horario de verano).
  const cita = "2026-10-06T16:00:00.000Z";

  it("con la zona de la clínica fijada, la hora no depende de la del navegador", () => {
    fijarZonaDeLaClinica("America/Mexico_City");
    try {
      assert.match(fmtTime(cita), /^10:00/);
      assert.match(fmtFechaHoraLarga(cita), /10:00/);
      assert.match(fmtFechaHoraLarga(cita), /martes/i);
    } finally {
      fijarZonaDeLaClinica(null);
    }
  });

  it("una cita de las 7:55 p.m. del 29 en México sigue siendo del 29 aunque en UTC ya sea el 30", () => {
    fijarZonaDeLaClinica("America/Mexico_City");
    try {
      const tarde = "2026-09-30T01:55:00.000Z";
      assert.match(fmtDate(tarde), /^29/);
      assert.match(fmtDateShort(tarde), /^29/);
    } finally {
      fijarZonaDeLaClinica(null);
    }
  });

  it("otra zona da otra hora (la zona fijada manda, no la del proceso)", () => {
    fijarZonaDeLaClinica("America/New_York");
    try {
      assert.match(fmtTime(cita), /^12:00/);
    } finally {
      fijarZonaDeLaClinica(null);
    }
  });

  it("una zona inválida se ignora sin romper nada", () => {
    fijarZonaDeLaClinica("No/Existe");
    assert.equal(fmtTime(null), "—");
    assert.notEqual(fmtTime(cita), "—");
  });

  it("un día de calendario suelto no se corre por la zona", () => {
    fijarZonaDeLaClinica("Pacific/Auckland");
    try {
      assert.match(fmtDate("2026-10-05"), /^5/);
      assert.match(fmtDateShort("2026-10-05"), /^05/);
    } finally {
      fijarZonaDeLaClinica(null);
    }
  });
});
