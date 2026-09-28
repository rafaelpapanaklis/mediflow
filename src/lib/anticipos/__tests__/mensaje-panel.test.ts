// Textos del anticipo pedido desde el panel — PUROS, sin base ni red.
// Correr: npm run test:anticipos-panel

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { textoAnticipoPanel, textoAnticipoTransferencia, textoRecibo } from "../mensaje-panel";

describe("textoAnticipoTransferencia", () => {
  it("con cita: dice «para apartar tu cita del…»", () => {
    const t = textoAnticipoTransferencia({
      paciente: "María",
      clinica: "Clínica Sonrisa",
      monto: 300,
      horas: 24,
      banco: "BBVA",
      beneficiario: "Clínica Sonrisa SC",
      clabeAgrupada: "012 180 001 234 567 899",
      referencia: null,
      fechaHumana: "lunes 11 de agosto",
      hora: "10:00",
    });
    assert.match(t, /para apartar tu cita del lunes 11 de agosto a las 10:00/);
  });

  it("SIN cita (factura suelta): NO dice «apartar» — una factura no se aparta", () => {
    const t = textoAnticipoTransferencia({
      paciente: "María",
      clinica: "Clínica Sonrisa",
      monto: 300,
      horas: 24,
      banco: "BBVA",
      beneficiario: "Clínica Sonrisa SC",
      clabeAgrupada: "012 180 001 234 567 899",
      referencia: null,
      fechaHumana: null,
      hora: null,
    });
    assert.doesNotMatch(t, /apartar/);
    assert.match(t, /^Hola María, en Clínica Sonrisa te pedimos un anticipo de \$300\.00 por transferencia\./);
  });

  it("incluye la referencia solo cuando viene", () => {
    const conRef = textoAnticipoTransferencia({
      paciente: "María", clinica: "C", monto: 300, horas: 24, banco: "BBVA", beneficiario: "X",
      clabeAgrupada: "012 180 001 234 567 899", referencia: "Escribe tu nombre", fechaHumana: null, hora: null,
    });
    assert.match(conRef, /Concepto: Escribe tu nombre/);
    const sinRef = textoAnticipoTransferencia({
      paciente: "María", clinica: "C", monto: 300, horas: 24, banco: "BBVA", beneficiario: "X",
      clabeAgrupada: "012 180 001 234 567 899", referencia: null, fechaHumana: null, hora: null,
    });
    assert.doesNotMatch(sinRef, /Concepto:/);
  });
});

describe("textoAnticipoPanel (Mercado Pago)", () => {
  it("con cita, incluye la fecha/hora y el link", () => {
    const t = textoAnticipoPanel({
      paciente: "María", clinica: "Clínica Sonrisa", monto: 300, horas: 24,
      url: "https://mpago.la/abc", fechaHumana: "lunes 11 de agosto", hora: "10:00",
    });
    assert.match(t, /de tu cita del lunes 11 de agosto a las 10:00/);
    assert.match(t, /https:\/\/mpago\.la\/abc/);
  });

  it("sin cita, no menciona ninguna fecha", () => {
    const t = textoAnticipoPanel({
      paciente: "María", clinica: "Clínica Sonrisa", monto: 300, horas: 24,
      url: "https://mpago.la/abc", fechaHumana: null, hora: null,
    });
    assert.doesNotMatch(t, /de tu cita/);
  });
});

describe("textoRecibo", () => {
  it("incluye paciente, clínica, monto y folio", () => {
    const t = textoRecibo({ paciente: "María", clinica: "Clínica Sonrisa", monto: 1200, folio: "MF-1042" });
    assert.match(t, /María/);
    assert.match(t, /Clínica Sonrisa/);
    assert.match(t, /\$1,200\.00/);
    assert.match(t, /MF-1042/);
  });
});
