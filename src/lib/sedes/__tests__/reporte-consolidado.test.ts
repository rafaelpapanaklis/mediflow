/**
 * Reporte consolidado de sedes (ws1-t10, auditoría BEVADENT · M6). Pruebas
 * puras con números sobre `reporte-consolidado-core.ts`; con el código viejo no
 * existía ninguna pantalla ni cálculo que cruzara sedes (solo Sabina).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  csvDelReporte,
  diasEntre,
  esFechaISO,
  participacionPct,
  resolverPeriodo,
  sumarDiasISO,
  tasaPct,
  ticketPromedio,
  totalesDe,
  type FilaSedeReporte,
  type ReporteConsolidado,
} from "../reporte-consolidado-core";

const sede = (p: Partial<FilaSedeReporte> & { nombre: string }): FilaSedeReporte => ({
  clinicId: p.nombre.toLowerCase(),
  esActiva: false,
  suspendida: false,
  ingresos: { neto: 0, cobrado: 0, reembolsos: 0, numeroDeCobros: 0 },
  citas: { agendadas: 0, atendidas: 0, noShows: 0, tasaNoShowPct: null },
  pacientesNuevos: 0,
  ocupacion: { pct: null, minutosOcupados: 0, minutosDisponibles: 0 },
  ticketPromedio: null,
  ...p,
});

describe("periodo", () => {
  it("este mes, mes pasado, 30 días y este año salen del día de hoy en la zona de la sede", () => {
    assert.deepEqual(resolverPeriodo("este-mes", "2026-10-07"), { periodo: "este-mes", desdeISO: "2026-10-01", hastaISO: "2026-10-07" });
    assert.deepEqual(resolverPeriodo("mes-pasado", "2026-10-07"), { periodo: "mes-pasado", desdeISO: "2026-09-01", hastaISO: "2026-09-30" });
    assert.deepEqual(resolverPeriodo("mes-pasado", "2026-01-15"), { periodo: "mes-pasado", desdeISO: "2025-12-01", hastaISO: "2025-12-31" });
    assert.deepEqual(resolverPeriodo("mes-pasado", "2026-03-01"), { periodo: "mes-pasado", desdeISO: "2026-02-01", hastaISO: "2026-02-28" });
    assert.deepEqual(resolverPeriodo("30-dias", "2026-10-07"), { periodo: "30-dias", desdeISO: "2026-09-08", hastaISO: "2026-10-07" });
    assert.deepEqual(resolverPeriodo("este-anio", "2026-10-07"), { periodo: "este-anio", desdeISO: "2026-01-01", hastaISO: "2026-10-07" });
  });

  it("personalizado exige fechas válidas, en orden y de un año como mucho; si no, cae a este mes", () => {
    assert.deepEqual(resolverPeriodo("personalizado", "2026-10-07", "2026-08-01", "2026-08-31"), { periodo: "personalizado", desdeISO: "2026-08-01", hastaISO: "2026-08-31" });
    assert.equal(resolverPeriodo("personalizado", "2026-10-07", "2026-08-31", "2026-08-01").periodo, "este-mes");
    assert.equal(resolverPeriodo("personalizado", "2026-10-07", "2026-02-30", "2026-08-01").periodo, "este-mes");
    assert.equal(resolverPeriodo("personalizado", "2026-10-07", "2024-01-01", "2026-08-01").periodo, "este-mes");
    assert.equal(resolverPeriodo("personalizado", "2026-10-07", "x", null).periodo, "este-mes");
    assert.equal(resolverPeriodo("lo-que-sea", "2026-10-07").periodo, "este-mes");
    assert.equal(resolverPeriodo(null, "2026-10-07").periodo, "este-mes");
  });

  it("fechas: validación, suma de días y cuenta de días (ambos extremos)", () => {
    assert.equal(esFechaISO("2026-02-29"), false);
    assert.equal(esFechaISO("2028-02-29"), true);
    assert.equal(esFechaISO("2026-13-01"), false);
    assert.equal(sumarDiasISO("2026-10-07", 1), "2026-10-08");
    assert.equal(sumarDiasISO("2026-01-01", -1), "2025-12-31");
    assert.equal(diasEntre("2026-10-01", "2026-10-07"), 7);
    assert.equal(diasEntre("2026-01-01", "2026-12-31"), 365);
  });
});

describe("aritmética", () => {
  it("ticket promedio = cobrado bruto ÷ número de cobros; sin cobros no hay ticket", () => {
    assert.equal(ticketPromedio(12_345.5, 7), 1763.64);
    assert.equal(ticketPromedio(0, 0), null);
    assert.equal(ticketPromedio(500, 0), null);
  });

  it("tasa de no-show con un decimal, nula sin agendadas", () => {
    assert.equal(tasaPct(3, 40), 7.5);
    assert.equal(tasaPct(1, 3), 33.3);
    assert.equal(tasaPct(0, 0), null);
  });

  it("los totales suman todas las sedes con dato, la ocupación se pondera por minutos disponibles y la fallida no cuenta", () => {
    const sedes = [
      sede({ nombre: "Centro", esActiva: true, ingresos: { neto: 10_000.1, cobrado: 11_000.1, reembolsos: 1000, numeroDeCobros: 10 }, citas: { agendadas: 100, atendidas: 80, noShows: 5, tasaNoShowPct: 5 }, pacientesNuevos: 12, ocupacion: { pct: 60, minutosOcupados: 1800, minutosDisponibles: 3000 }, ticketPromedio: 1100.01 }),
      sede({ nombre: "Norte", ingresos: { neto: 5000.2, cobrado: 5000.2, reembolsos: 0, numeroDeCobros: 5 }, citas: { agendadas: 40, atendidas: 30, noShows: 4, tasaNoShowPct: 10 }, pacientesNuevos: 3, ocupacion: { pct: 20, minutosOcupados: 200, minutosDisponibles: 1000 }, ticketPromedio: 1000.04 }),
      sede({ nombre: "Sin horario", ingresos: { neto: 100, cobrado: 100, reembolsos: 0, numeroDeCobros: 1 }, citas: { agendadas: 10, atendidas: 10, noShows: 0, tasaNoShowPct: 0 }, pacientesNuevos: 1, ocupacion: { pct: null, minutosOcupados: 0, minutosDisponibles: 0 }, ticketPromedio: 100 }),
      sede({ nombre: "Caída", fallo: true, ingresos: { neto: 999_999, cobrado: 999_999, reembolsos: 0, numeroDeCobros: 9 }, citas: { agendadas: 999, atendidas: 1, noShows: 1, tasaNoShowPct: 1 }, pacientesNuevos: 99 }),
    ];
    const t = totalesDe(sedes);
    assert.equal(t.ingresosNeto, 15_100.3);
    assert.equal(t.cobrado, 16_100.3);
    assert.equal(t.reembolsos, 1000);
    assert.equal(t.numeroDeCobros, 16);
    assert.equal(t.citasAgendadas, 150);
    assert.equal(t.citasAtendidas, 120);
    assert.equal(t.noShows, 9);
    assert.equal(t.tasaNoShowPct, 6);
    assert.equal(t.pacientesNuevos, 16);
    assert.equal(t.ticketPromedio, 1006.27);
    assert.equal(t.ocupacionPct, 50, "(1800 + 200) ÷ (3000 + 1000) = 50 %; la sede sin horario no pondera");
    assert.equal(participacionPct(sedes[0], t), 66.2);
    assert.equal(participacionPct(sedes[1], t), 33.1);
    assert.equal(participacionPct(sedes[3], t), null, "la fallida no tiene parte");
  });

  it("sin sedes, todo en cero y los promedios nulos", () => {
    const t = totalesDe([]);
    assert.equal(t.ingresosNeto, 0);
    assert.equal(t.ticketPromedio, null);
    assert.equal(t.ocupacionPct, null);
    assert.equal(t.tasaNoShowPct, null);
  });

  it("la participación es nula con total cero o con ingresos negativos (más devuelto que cobrado)", () => {
    const negativa = sede({ nombre: "Devuelve", ingresos: { neto: -200, cobrado: 100, reembolsos: 300, numeroDeCobros: 1 } });
    const otra = sede({ nombre: "Cobra", ingresos: { neto: 1000, cobrado: 1000, reembolsos: 0, numeroDeCobros: 2 } });
    const t = totalesDe([negativa, otra]);
    assert.equal(t.ingresosNeto, 800);
    assert.equal(participacionPct(negativa, t), null);
    assert.equal(participacionPct(otra, t), 125, "una sede puede poner más del 100 % si otra devolvió dinero");
  });
});

describe("CSV", () => {
  it("lleva BOM, cabecera, una fila por sede, la fila de totales y escapa comas y comillas", () => {
    const sedes = [
      sede({ nombre: 'Clínica "Centro", Sur', esActiva: true, ingresos: { neto: 1500.5, cobrado: 1600.5, reembolsos: 100, numeroDeCobros: 3 }, citas: { agendadas: 10, atendidas: 8, noShows: 1, tasaNoShowPct: 10 }, pacientesNuevos: 2, ocupacion: { pct: 42.5, minutosOcupados: 85, minutosDisponibles: 200 }, ticketPromedio: 533.5 }),
      sede({ nombre: "Caída", fallo: true }),
      sede({ nombre: "Vencida", suspendida: true }),
    ];
    const r: ReporteConsolidado = { periodo: "este-mes", desdeISO: "2026-10-01", hastaISO: "2026-10-07", generadoEn: "2026-10-07T20:00:00.000Z", sedes, totales: totalesDe(sedes) };
    const csv = csvDelReporte(r);
    assert.ok(csv.startsWith("﻿"), "BOM para Excel");
    const lineas = csv.replace("﻿", "").trimEnd().split("\r\n");
    assert.equal(lineas.length, 2 + 3 + 1);
    assert.equal(lineas[0], "Reporte consolidado de sedes,2026-10-01 a 2026-10-07");
    assert.equal(lineas[1].split(",")[0], "Sede");
    assert.ok(lineas[2].startsWith('"Clínica ""Centro"", Sur",activa,1500.5,1600.5,100,3,533.5,10,8,1,10,2,42.5'));
    assert.equal(lineas[3], "Caída,sin datos (falló la consulta),,,,,,,,,,,");
    assert.ok(lineas[4].startsWith("Vencida,suspendida,0,0,0,0,,0,0,0,,0,"));
    assert.ok(lineas[5].startsWith("TOTAL,,1500.5,1600.5,100,3,533.5,10,8,1,10,2,42.5"));
  });
});
