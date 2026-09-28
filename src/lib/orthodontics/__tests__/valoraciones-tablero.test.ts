// «Valoraciones» del Tablero: citas de valoración, no presupuestos
// (ws1-t4 ronda 6, fila 16 de la revisión de lógica de uso).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DIAS_VENTANA_VALORACIONES,
  TEXTO_TIPO_CITA_VALORACION,
  resumirValoraciones,
  textoDelTipoValoracion,
} from "../valoraciones-tablero";

const AHORA = new Date("2026-09-28T18:00:00.000Z");
const hace = (dias: number) => new Date(AHORA.getTime() - dias * 86_400_000);
const dentroDe = (dias: number) => new Date(AHORA.getTime() + dias * 86_400_000);

describe("resumirValoraciones", () => {
  it("sin citas, todo en cero y dice su ventana", () => {
    assert.deepEqual(resumirValoraciones([], [], AHORA), {
      total: 0,
      aceptadas: 0,
      pendientes: 0,
      agendadas: 0,
      dias: DIAS_VENTANA_VALORACIONES,
    });
  });

  it("cuenta pacientes, no citas: dos valoraciones del mismo paciente son una", () => {
    const r = resumirValoraciones(
      [
        { patientId: "a", startsAt: hace(20), status: "COMPLETED" },
        { patientId: "a", startsAt: hace(5), status: "COMPLETED" },
      ],
      [],
      AHORA,
    );
    assert.equal(r.total, 1);
    assert.equal(r.pendientes, 1);
  });

  it("abrió caso después de su valoración: convierte", () => {
    const r = resumirValoraciones(
      [
        { patientId: "a", startsAt: hace(30), status: "COMPLETED" },
        { patientId: "b", startsAt: hace(10), status: "CHECKED_OUT" },
      ],
      [{ patientId: "a", createdAt: hace(25) }],
      AHORA,
    );
    assert.deepEqual([r.total, r.aceptadas, r.pendientes], [2, 1, 1]);
  });

  it("el caso abierto el mismo día, un rato antes de la hora de la cita, también convierte", () => {
    const cita = hace(3);
    const r = resumirValoraciones(
      [{ patientId: "a", startsAt: cita, status: "SCHEDULED" }],
      [{ patientId: "a", createdAt: new Date(cita.getTime() - 20 * 60_000) }],
      AHORA,
    );
    assert.deepEqual([r.total, r.aceptadas], [1, 1]);
  });

  it("quien ya tenía caso desde antes no es un prospecto: no cuenta", () => {
    const r = resumirValoraciones(
      [{ patientId: "a", startsAt: hace(10), status: "COMPLETED" }],
      [{ patientId: "a", createdAt: hace(200) }],
      AHORA,
    );
    assert.deepEqual([r.total, r.aceptadas, r.pendientes], [0, 0, 0]);
  });

  it("canceladas y faltas no cuentan, ni hechas ni agendadas", () => {
    const r = resumirValoraciones(
      [
        { patientId: "a", startsAt: hace(10), status: "CANCELLED" },
        { patientId: "b", startsAt: hace(10), status: "NO_SHOW" },
        { patientId: "c", startsAt: dentroDe(3), status: "CANCELLED" },
      ],
      [],
      AHORA,
    );
    assert.deepEqual([r.total, r.agendadas], [0, 0]);
  });

  it("lo de fuera de la ventana no cuenta: ni una corona de 2024 ni una valoración de hace medio año", () => {
    const r = resumirValoraciones(
      [
        { patientId: "a", startsAt: hace(DIAS_VENTANA_VALORACIONES + 1), status: "COMPLETED" },
        { patientId: "b", startsAt: hace(DIAS_VENTANA_VALORACIONES - 1), status: "COMPLETED" },
      ],
      [],
      AHORA,
    );
    assert.equal(r.total, 1);
  });

  it("las que todavía no ocurren van aparte, como agendadas", () => {
    const r = resumirValoraciones(
      [
        { patientId: "a", startsAt: dentroDe(2), status: "SCHEDULED" },
        { patientId: "b", startsAt: dentroDe(9), status: "CONFIRMED" },
        { patientId: "c", startsAt: hace(2), status: "COMPLETED" },
      ],
      [],
      AHORA,
    );
    assert.deepEqual([r.total, r.agendadas], [1, 2]);
  });

  it("las tres cifras siempre cuadran: valoraciones = abrieron caso + por llamar", () => {
    const r = resumirValoraciones(
      [
        { patientId: "a", startsAt: hace(1), status: "COMPLETED" },
        { patientId: "b", startsAt: hace(2), status: "COMPLETED" },
        { patientId: "c", startsAt: hace(3), status: "COMPLETED" },
      ],
      [
        { patientId: "a", createdAt: hace(1) },
        { patientId: "c", createdAt: hace(400) },
      ],
      AHORA,
    );
    assert.equal(r.total, r.aceptadas + r.pendientes);
    assert.deepEqual([r.total, r.aceptadas, r.pendientes], [2, 1, 1]);
  });
});

describe("textoDelTipoValoracion", () => {
  it("usa el nombre que la clínica le puso en Configuración", () => {
    assert.equal(
      textoDelTipoValoracion([
        { id: "valoracion", label: "Primera visita de ortodoncia" },
        { id: "control", label: "Control de ortodoncia" },
      ]),
      "Primera visita de ortodoncia",
    );
  });

  it("si la clínica quitó la fila, busca por el texto de fábrica", () => {
    assert.equal(textoDelTipoValoracion([{ id: "control", label: "Control de ortodoncia" }]), TEXTO_TIPO_CITA_VALORACION);
    assert.equal(textoDelTipoValoracion([{ id: "valoracion", label: "   " }]), TEXTO_TIPO_CITA_VALORACION);
  });
});
