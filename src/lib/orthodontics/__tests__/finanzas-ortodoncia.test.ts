// El bloque «Ortodoncia» de Finanzas (ws1-t5, ronda 6 — fila 90). Puras.
//
//   npx tsx --test src/lib/orthodontics/__tests__/finanzas-ortodoncia.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { carteraDeOrtodoncia, conteoDeCasos, filasPorDoctor, tramoDe } from "../finanzas-ortodoncia";
import { filasDeCobranza, resumenDeCobranza } from "../cobranza-modulo";
import { computeOverdueBalances, type OrthoCaseSummary } from "../specialty-kpis";
import type { CobranzaDelCaso } from "../cobranza-caso";

const HOY = "2026-09-28";

function cobranza(over: Partial<CobranzaDelCaso> = {}): CobranzaDelCaso {
  return { cuotaDeHoy: null, pagadas: [], vencidas: [], proximas: [], saldoTotal: 0, saldoAFavor: 0, proximoVencimiento: null, ...over };
}
const vencida = (vencimiento: string, falta: number, numero = 1) => ({
  numero, esEnganche: false, importe: falta, vencimiento, abonado: 0, falta, estado: "vencida" as const,
});
const proxima = (vencimiento: string, falta: number, numero = 9) => ({
  numero, esEnganche: false, importe: falta, vencimiento, abonado: 0, falta, estado: "porVencer" as const,
});

let n = 0;
function caso(over: Partial<OrthoCaseSummary> = {}): OrthoCaseSummary {
  n += 1;
  return {
    planId: `plan${n}`,
    patientId: `p${n}`,
    patientName: `Paciente ${n}`,
    treatingDoctorId: "d-ana",
    treatingDoctorName: "Dra. Ana",
    status: "IN_PROGRESS",
    installedAt: new Date("2026-01-01T00:00:00Z"),
    estimatedDurationMonths: 18,
    droppedOutAt: null,
    statusUpdatedAt: new Date("2026-01-01T00:00:00Z"),
    cobranza: null,
    ...over,
  };
}

describe("conteoDeCasos", () => {
  it("cuenta por estado; la pausa es un caso activo", () => {
    const r = conteoDeCasos([
      { status: "PLANNED" }, { status: "IN_PROGRESS" }, { status: "IN_PROGRESS" }, { status: "ON_HOLD" },
      { status: "RETENTION" }, { status: "COMPLETED" }, { status: "COMPLETED" }, { status: "COMPLETED" }, { status: "DROPPED_OUT" },
    ]);
    assert.deepEqual(r, { activos: 5, enPausa: 1, terminados: 3, abandonados: 1, total: 9, tasaDeAbandono: 25 });
  });

  it("sin ningún caso cerrado no hay tasa de abandono (no «0 %»)", () => {
    assert.equal(conteoDeCasos([{ status: "IN_PROGRESS" }, { status: "PLANNED" }]).tasaDeAbandono, null);
    assert.equal(conteoDeCasos([]).tasaDeAbandono, null);
  });

  it("si todos los que cerraron abandonaron, es 100 %", () => {
    assert.equal(conteoDeCasos([{ status: "DROPPED_OUT" }, { status: "IN_PROGRESS" }]).tasaDeAbandono, 100);
  });
});

describe("tramoDe", () => {
  it("reparte por días de atraso, con los bordes del lado correcto", () => {
    assert.equal(tramoDe(1), "1-30");
    assert.equal(tramoDe(30), "1-30");
    assert.equal(tramoDe(31), "31-60");
    assert.equal(tramoDe(60), "31-60");
    assert.equal(tramoDe(61), "61-90");
    assert.equal(tramoDe(90), "61-90");
    assert.equal(tramoDe(91), "90+");
    assert.equal(tramoDe(900), "90+");
    assert.equal(tramoDe(0), "1-30");
  });
});

describe("carteraDeOrtodoncia", () => {
  const cases = [
    // Una cuota de hace 10 días y otra de hace 100: reparte en dos tramos.
    caso({ planId: "a", cobranza: cobranza({ vencidas: [vencida("2026-09-18", 1000), vencida("2026-06-20", 1500, 2)], proximas: [proxima("2026-10-18", 1000)], saldoTotal: 3500 }) }),
    // Abandonado que sigue debiendo: la deuda no se borra.
    caso({ planId: "b", status: "DROPPED_OUT", cobranza: cobranza({ vencidas: [vencida("2026-08-20", 2000.5)], saldoTotal: 2000.5 }) }),
    // Al corriente.
    caso({ planId: "c", cobranza: cobranza({ proximas: [proxima("2026-10-01", 900)], saldoTotal: 900 }) }),
    // Sin plan de pago.
    caso({ planId: "d", cobranza: null }),
  ];

  it("cada cuota vencida va al tramo de sus propios días", () => {
    const r = carteraDeOrtodoncia(cases, HOY);
    assert.deepEqual(r.tramos, [
      { clave: "1-30", etiqueta: "1 a 30 días", importe: 1000, casos: 1 },
      { clave: "31-60", etiqueta: "31 a 60 días", importe: 2000.5, casos: 1 },
      { clave: "61-90", etiqueta: "61 a 90 días", importe: 0, casos: 0 },
      { clave: "90+", etiqueta: "Más de 90 días", importe: 1500, casos: 1 },
    ]);
    assert.equal(r.vencido, 4500.5);
    assert.equal(r.porCobrar, 6400.5);
    assert.equal(r.casosConAtraso, 2);
  });

  it("el vencido es EL MISMO que dicen Cobranza y el Tablero del módulo", () => {
    const r = carteraDeOrtodoncia(cases, HOY);
    const cobranzaDelModulo = resumenDeCobranza(filasDeCobranza(cases, HOY));
    assert.equal(r.vencido, cobranzaDelModulo.vencido.importe);
    assert.equal(r.porCobrar, cobranzaDelModulo.porCobrar);
    assert.equal(Math.round(r.vencido), computeOverdueBalances(cases).amountMxn);
  });

  it("sin casos, todo en cero y los cuatro tramos presentes", () => {
    const r = carteraDeOrtodoncia([], HOY);
    assert.equal(r.vencido, 0);
    assert.equal(r.tramos.length, 4);
  });
});

describe("filasPorDoctor", () => {
  it("junta los casos abiertos de hoy con lo cobrado en el periodo", () => {
    const cases = [
      caso({ treatingDoctorId: "d-ana", treatingDoctorName: "Dra. Ana" }),
      caso({ treatingDoctorId: "d-ana", treatingDoctorName: "Dra. Ana", status: "ON_HOLD" }),
      caso({ treatingDoctorId: "d-ana", treatingDoctorName: "Dra. Ana", status: "COMPLETED" }), // cerrado: no cuenta como abierto
      caso({ treatingDoctorId: "d-luis", treatingDoctorName: "Dr. Luis" }),
      caso({ treatingDoctorId: null, treatingDoctorName: null }),
    ];
    const r = filasPorDoctor(cases, [
      { doctorId: "d-luis", doctorName: "Dr. Luis", amountMxn: 9000 },
      { doctorId: "d-ana", doctorName: "Dra. Ana", amountMxn: 4000 },
      { doctorId: "d-se-fue", doctorName: "Doctor que ya no está en la clínica", amountMxn: 500 },
    ]);
    assert.deepEqual(r, [
      { doctorId: "d-luis", doctor: "Dr. Luis", casosActivos: 1, ingresos: 9000 },
      { doctorId: "d-ana", doctor: "Dra. Ana", casosActivos: 2, ingresos: 4000 },
      { doctorId: "d-se-fue", doctor: "Doctor que ya no está en la clínica", casosActivos: 0, ingresos: 500 },
      { doctorId: null, doctor: "Sin doctor tratante", casosActivos: 1, ingresos: 0 },
    ]);
  });
});
