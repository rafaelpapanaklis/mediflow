// Fila 12 — lo que una hoja de control NUEVA hereda del control anterior.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  arcoActualDelControl,
  bracketsPendientes,
  completarAHuecos,
  notaPrecargada,
  ultimoControlFirmado,
} from "../precarga-hoja-control";
import { huecosPorLlenar } from "../consulta-ortodoncia";

describe("ultimoControlFirmado", () => {
  it("toma la hoja FIRMADA de mayor número, ignorando borradores", () => {
    const cards = [
      { cardNumber: 1, status: "SIGNED", id: "a" },
      { cardNumber: 3, status: "DRAFT", id: "c" },
      { cardNumber: 2, status: "SIGNED", id: "b" },
    ];
    assert.equal(ultimoControlFirmado(cards)?.id, "b");
  });

  it("sin hojas firmadas → null", () => {
    assert.equal(ultimoControlFirmado([{ cardNumber: 1, status: "DRAFT" }]), null);
    assert.equal(ultimoControlFirmado([]), null);
  });
});

describe("arcoActualDelControl", () => {
  it("el arco que puso el control anterior", () => {
    assert.equal(arcoActualDelControl({ wireFromId: "w1", wireToId: "w2" }), "w2");
  });

  it("si el anterior no cambió de arco, el mismo con el que llegó", () => {
    assert.equal(arcoActualDelControl({ wireFromId: "w1", wireToId: null }), "w1");
  });

  it("sin control anterior o sin arcos → null", () => {
    assert.equal(arcoActualDelControl(null), null);
    assert.equal(arcoActualDelControl({ wireFromId: null, wireToId: null }), null);
  });
});

describe("bracketsPendientes", () => {
  it("solo los que no se recementaron, con la fecha en ISO", () => {
    const r = bracketsPendientes([
      { toothFdi: 25, brokenDate: new Date("2026-09-01T12:00:00Z"), reBondedDate: null, notes: "vestibular" },
      { toothFdi: 14, brokenDate: "2026-08-20T12:00:00.000Z", reBondedDate: "2026-08-25T12:00:00.000Z" },
      { toothFdi: 36, brokenDate: "2026-09-10T12:00:00.000Z", reBondedDate: null },
    ]);
    assert.deepEqual(r, [
      { toothFdi: 25, brokenDate: "2026-09-01T12:00:00.000Z", notes: "vestibular" },
      { toothFdi: 36, brokenDate: "2026-09-10T12:00:00.000Z", notes: null },
    ]);
  });
});

describe("completarAHuecos", () => {
  it("convierte los «[completar …]» de soap-prefill en huecos que la hoja cuenta", () => {
    assert.equal(completarAHuecos("Refiere [completar — dolor, molestia]."), "Refiere ____ (dolor, molestia).");
    assert.equal(completarAHuecos("Ajustes: [completar]."), "Ajustes: ____.");
    assert.equal(completarAHuecos("Sin marcas"), "Sin marcas");
  });
});

describe("notaPrecargada", () => {
  const base = {
    patientName: "Ana López",
    monthAt: 4,
    technique: "METAL_BRACKETS" as const,
    phaseKey: "LEVELING" as const,
    paymentStatus: "ON_TIME" as const,
    bracketsPendientesFdi: [] as number[],
  };

  it("llena S/O/A/P con los datos del caso y deja huecos por llenar", () => {
    const n = notaPrecargada(base);
    assert.match(n.s, /^Ana López en mes 4 de tratamiento con brackets metálicos\./);
    assert.match(n.o, /Aparatología íntegra\. Fase actual: Nivelación\./);
    assert.doesNotMatch(n.o, /Higiene: —/, "sin dato de higiene no se escribe «—/100»");
    assert.match(n.a, /Adeudo financiero: al corriente\./);
    assert.match(n.p, /^Próxima cita en 4 semanas\. Ajustes: ____\.$/);
    assert.equal(n.s.includes("[completar"), false);
    assert.equal(huecosPorLlenar(n), 2);
  });

  it("menciona los brackets que siguen caídos", () => {
    const n = notaPrecargada({ ...base, bracketsPendientesFdi: [25, 36] });
    assert.match(n.o, /Aparatología con incidencias, brackets sueltos en FDI 25, 36\./);
  });

  it("sin plan de pagos no escribe el adeudo; con atraso recuerda regularizar", () => {
    assert.doesNotMatch(notaPrecargada({ ...base, paymentStatus: null }).a, /Adeudo/);
    assert.match(notaPrecargada({ ...base, paymentStatus: "LIGHT_DELAY" }).p, /Recordar regularización/);
  });

  it("sin nombre ni técnica no se rompe", () => {
    const n = notaPrecargada({ ...base, patientName: "  ", technique: null, phaseKey: null });
    assert.match(n.s, /^Paciente en mes 4 de tratamiento con ortodoncia\./);
    assert.match(n.o, /Fase actual: —\./);
  });
});
