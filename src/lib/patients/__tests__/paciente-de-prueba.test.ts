// ws1-t11 (11c/11d) — la regla de «Paciente de prueba / no contactar» y el
// interruptor de reseñas, sin base de datos.
// Correr: npm run test:paciente-de-prueba
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PacienteNoContactarError,
  esPacienteNoContactarError,
  debeBloquearse,
  sinPruebaEnPaciente,
  sinPruebaEnPago,
  sinPruebaPorPatientId,
  ultimos10,
  correoNormalizado,
  unirWhere,
  filtroSinPrueba,
  SIN_FILTRO_DE_PRUEBA,
  MOTIVO_NO_CONTACTAR,
} from "../paciente-de-prueba";
import { WhatsAppBlockedError } from "@/lib/whatsapp/errors";
import { getResenasSettings, sanitizeResenasSettings } from "@/lib/reminders/config";

describe("debeBloquearse", () => {
  it("con el paciente identificado manda SU marca, aunque el número lo comparta uno de prueba", () => {
    assert.equal(debeBloquearse({ delPaciente: false, delDestino: [true] }), false);
    assert.equal(debeBloquearse({ delPaciente: true, delDestino: [] }), true);
  });
  it("sin saber de quién es el envío, basta un dueño del número marcado", () => {
    assert.equal(debeBloquearse({ delPaciente: null, delDestino: [false, true] }), true);
    assert.equal(debeBloquearse({ delPaciente: null, delDestino: [false] }), false);
    assert.equal(debeBloquearse({ delPaciente: null, delDestino: [] }), false);
  });
});

describe("el error del freno", () => {
  it("es un WhatsAppBlockedError (los 19 callers que ya lo atrapan enseñan el motivo)", () => {
    const e = new PacienteNoContactarError();
    assert.ok(e instanceof WhatsAppBlockedError);
    assert.equal(e.message, MOTIVO_NO_CONTACTAR);
    assert.ok(esPacienteNoContactarError(e));
    assert.equal(esPacienteNoContactarError(new WhatsAppBlockedError("otra cosa")), false);
  });
});

describe("normalización del destino", () => {
  it("últimos 10 dígitos, como el Inbox", () => {
    assert.equal(ultimos10("+52 1 (999) 260-2093"), "9992602093");
    assert.equal(ultimos10(null), "");
  });
  it("correo sin espacios ni mayúsculas", () => {
    assert.equal(correoNormalizado("  Ana@Ejemplo.MX "), "ana@ejemplo.mx");
  });
});

describe("cláusulas de métricas", () => {
  it("sin pacientes de prueba no cambian nada", () => {
    assert.deepEqual(sinPruebaEnPaciente([]), {});
    assert.deepEqual(sinPruebaPorPatientId([]), {});
    const w = { invoice: { clinicId: "c1" }, paidAt: { gte: 1 } };
    assert.equal(sinPruebaEnPago(w, []), w);
  });
  it("con ids, notIn por paciente y por la factura del pago", () => {
    assert.deepEqual(sinPruebaEnPaciente(["p1"]), { id: { notIn: ["p1"] } });
    assert.deepEqual(sinPruebaPorPatientId(["p1"]), { patientId: { notIn: ["p1"] } });
    assert.deepEqual(sinPruebaEnPago({ invoice: { clinicId: "c1", status: { notIn: ["CANCELLED"] } }, method: { not: "refund" } }, ["p1"]), {
      invoice: { clinicId: "c1", status: { notIn: ["CANCELLED"] }, patientId: { notIn: ["p1"] } },
      method: { not: "refund" },
    });
  });
  it("unirWhere no pisa una clave que ya trae el where (va al AND)", () => {
    const r = unirWhere({ clinicId: "c1", patientId: "p9", AND: [{ x: 1 }] }, { patientId: { notIn: ["p1"] } });
    assert.deepEqual(r, { clinicId: "c1", patientId: "p9", AND: [{ x: 1 }, { patientId: { notIn: ["p1"] } }] });
  });
});

describe("EL filtro de métricas (filtroSinPrueba): una pieza para todas las pantallas", () => {
  it("sin pacientes de prueba es identidad: la consulta queda como antes", () => {
    const f = filtroSinPrueba([]);
    assert.deepEqual(f.ids, []);
    assert.deepEqual(f.paciente, {});
    assert.deepEqual(f.porPatientId, {});
    const w = { invoice: { clinicId: "c1" }, paidAt: { gte: 1 } };
    assert.equal(f.pago(w), w);
    const c = { clinicId: "c1", startsAt: { gte: 1 } };
    assert.equal(f.cita(c), c);
    assert.equal(f.enPaciente(c), c);
    assert.equal(f.cuenta("p1"), true);
    assert.equal(f.clave, SIN_FILTRO_DE_PRUEBA.clave);
  });
  it("con ids saca a esos pacientes en cada forma", () => {
    const f = filtroSinPrueba(["p2", "p1", "p1", ""]);
    assert.deepEqual(f.ids, ["p1", "p2"], "únicos, sin vacíos y en orden (la clave de caché no depende del orden)");
    assert.deepEqual(f.paciente, { id: { notIn: ["p1", "p2"] } });
    assert.deepEqual(f.porPatientId, { patientId: { notIn: ["p1", "p2"] } });
    assert.deepEqual(f.pago({ invoice: { clinicId: "c1" }, method: { not: "refund" } }), {
      invoice: { clinicId: "c1", patientId: { notIn: ["p1", "p2"] } },
      method: { not: "refund" },
    });
    // Un where que ya filtra por paciente no se pisa: el filtro va al AND.
    assert.deepEqual(f.cita({ clinicId: "c1", patientId: "p9" }), {
      clinicId: "c1",
      patientId: "p9",
      AND: [{ patientId: { notIn: ["p1", "p2"] } }],
    });
    assert.deepEqual(f.enPaciente({ clinicId: "c1", id: { in: ["p1", "p3"] } }), {
      clinicId: "c1",
      id: { in: ["p1", "p3"] },
      AND: [{ id: { notIn: ["p1", "p2"] } }],
    });
    assert.equal(f.cuenta("p1"), false);
    assert.equal(f.cuenta("p3"), true);
    assert.equal(f.cuenta(null), true, "una fila sin paciente no es de prueba");
    assert.notEqual(f.clave, SIN_FILTRO_DE_PRUEBA.clave, "marcar a alguien cambia la llave de la caché");
    assert.equal(f.clave, filtroSinPrueba(["p1", "p2"]).clave);
  });
});

describe("11c · «Pedir reseña al terminar la cita»", () => {
  it("encendido si la clínica nunca lo tocó (es lo que ya pasaba)", () => {
    assert.equal(getResenasSettings({ reminderSettings: null }).alTerminar, true);
    assert.equal(getResenasSettings({ reminderSettings: { recall: { enabled: true } } }).alTerminar, true);
    assert.equal(getResenasSettings(null).alTerminar, true);
  });
  it("solo un false de verdad lo apaga", () => {
    assert.equal(getResenasSettings({ reminderSettings: { resenas: { alTerminar: false } } }).alTerminar, false);
    assert.equal(getResenasSettings({ reminderSettings: { resenas: { alTerminar: "false" } } }).alTerminar, true);
    assert.equal(getResenasSettings({ reminderSettings: { resenas: { alTerminar: 0 } } }).alTerminar, true);
  });
  it("el body que no es objeto es inválido (400)", () => {
    assert.equal(sanitizeResenasSettings("no"), null);
    assert.equal(sanitizeResenasSettings([]), null);
    assert.deepEqual(sanitizeResenasSettings({ alTerminar: false, otra: 1 }), { alTerminar: false });
  });
});
