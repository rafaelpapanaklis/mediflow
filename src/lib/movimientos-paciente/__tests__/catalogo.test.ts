/**
 * Movimientos del paciente — la parte pura: cómo se cuenta cada fila de la
 * bitácora, en qué categoría cae y qué se enseña a quien no tiene permiso.
 *
 * Corre con: npm run test:movimientos-paciente
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aplicarPermisos,
  camposDeCambio,
  clasificarFila,
  deducirPatientId,
  nombrarCampos,
  patientIdEnCambios,
  redactarMovimiento,
  TEXTO_DINERO_OCULTO,
  TEXTO_EXPEDIENTE_OCULTO,
} from "../catalogo";
import { celdaCsv, movimientosACsv } from "../csv";
import { fechaHoraParaTexto, sustantivoDeArchivo, textoArchivo, textoCita } from "../textos";

describe("redactarMovimiento", () => {
  it("usa la frase que la fila trae de sí misma", () => {
    const t = redactarMovimiento({
      entityType: "appointment",
      action: "create",
      changes: { _mov: { before: null, after: { texto: "Agendó una cita para el 3 oct 2026 10:00" } } },
    });
    assert.equal(t, "Agendó una cita para el 3 oct 2026 10:00");
  });

  it("una fila vieja se redacta de entidad + acción, nombrando campos y NUNCA valores", () => {
    const t = redactarMovimiento({
      entityType: "patient",
      action: "update",
      changes: { phone: { before: "5511111111", after: "5522222222" }, email: { before: "a@b.mx", after: "c@d.mx" } },
    });
    assert.equal(t, "Actualizó los datos del paciente: teléfono y correo");
    assert.ok(!t.includes("5522222222"));
    assert.ok(!t.includes("c@d.mx"));
  });

  it("cubre crear, actualizar y borrar de las entidades principales", () => {
    const casos: Array<[string, string, string]> = [
      ["appointment", "create", "Agendó una cita"],
      ["appointment", "delete", "Eliminó una cita"],
      ["patient", "create", "Creó el perfil del paciente"],
      ["record", "create", "Creó una nota de consulta"],
      ["prescription", "create", "Emitió una receta"],
      ["prescription", "void", "Anuló una receta"],
      ["consent", "create", "Generó un consentimiento"],
      ["invoice", "create", "Creó una factura"],
      ["payment-plan", "create", "Creó un plan de pagos"],
      ["quote", "create", "Creó un presupuesto"],
      ["patient-file", "create", "Subió un archivo"],
      ["patient-file", "soft_delete", "Quitó un archivo"],
    ];
    for (const [entityType, action, esperado] of casos) {
      assert.equal(redactarMovimiento({ entityType, action, changes: null }), esperado, `${entityType}/${action}`);
    }
  });

  it("los campos desconocidos se cuentan, no se nombran", () => {
    const t = redactarMovimiento({
      entityType: "patient",
      action: "update",
      changes: { phone: {}, campoRaroUno: {}, campoRaroDos: {} },
    });
    assert.equal(t, "Actualizó los datos del paciente: teléfono y 2 datos más");
  });

  it("los campos internos del sistema no cuentan como dato que cambió", () => {
    assert.equal(nombrarCampos(["portalToken", "portalTokenExpiry", "deletedAt"]), "");
    assert.equal(
      redactarMovimiento({ entityType: "patient", action: "update", changes: { portalToken: {} } }),
      "Actualizó los datos del paciente",
    );
  });

  it("odontograma, cuestionario, referencia e invitación al portal, colgados del paciente, dicen lo que son", () => {
    assert.equal(redactarMovimiento({ entityType: "patient", action: "odontogram_sync", changes: { _odontogram: {} } }), "Guardó el odontograma completo");
    assert.equal(redactarMovimiento({ entityType: "patient", action: "odontogram_reset", changes: {} }), "Reinició el odontograma");
    assert.equal(redactarMovimiento({ entityType: "patient", action: "create", changes: { healthQuestionnaireId: "q1" } }), "Llenó el cuestionario de salud");
    assert.equal(redactarMovimiento({ entityType: "patient", action: "update", changes: { referralCreated: {} } }), "Creó una referencia");
    assert.equal(redactarMovimiento({ entityType: "patient", action: "update", changes: { portalInvite: {} } }), "Invitó al paciente a su portal");
  });

  it("las acciones de los módulos clínicos tienen su frase; las que no, una genérica con el módulo", () => {
    assert.equal(
      redactarMovimiento({ entityType: "OrthodonticTreatmentPlan", action: "ortho.treatmentPlan.created", changes: null }),
      "Creó el plan de tratamiento de ortodoncia",
    );
    assert.equal(
      redactarMovimiento({ entityType: "OrthoInstallment", action: "ortho.installment.paid", changes: null }),
      "Registró el pago de una mensualidad de ortodoncia",
    );
    assert.equal(
      redactarMovimiento({ entityType: "OrthodonticAligner", action: "ortho.aligner.algoNuevo", changes: null }),
      "Registró un cambio en ortodoncia",
    );
    assert.equal(
      redactarMovimiento({ entityType: "x", action: "perio.record.finalized", changes: null }),
      "Finalizó un dato en periodoncia",
    );
    assert.equal(
      redactarMovimiento({ entityType: "clinical-photo", action: "clinical-shared.photo.uploaded", changes: null }),
      "Subió una foto clínica",
    );
  });
});

describe("clasificarFila", () => {
  it("clasifica por entidad", () => {
    assert.equal(clasificarFila({ entityType: "appointment", action: "create", changes: null }), "citas");
    assert.equal(clasificarFila({ entityType: "patient", action: "update", changes: { phone: {} } }), "perfil");
    assert.equal(clasificarFila({ entityType: "record", action: "create", changes: null }), "expediente");
    assert.equal(clasificarFila({ entityType: "patient-file", action: "create", changes: null }), "archivos");
    assert.equal(clasificarFila({ entityType: "invoice", action: "update", changes: null }), "dinero");
    assert.equal(clasificarFila({ entityType: "algo-desconocido", action: "update", changes: null }), "otros");
  });

  it("las filas del paciente que son clínicas NO caen en «perfil» (de eso depende el permiso)", () => {
    assert.equal(clasificarFila({ entityType: "patient", action: "odontogram_write", changes: null }), "expediente");
    assert.equal(clasificarFila({ entityType: "patient", action: "create", changes: { healthQuestionnaireId: "q" } }), "expediente");
    assert.equal(clasificarFila({ entityType: "patient", action: "update", changes: { referralCreated: {} } }), "expediente");
  });

  it("la categoría que la fila dice de sí misma manda", () => {
    assert.equal(
      clasificarFila({ entityType: "patient", action: "update", changes: { _mov: { before: null, after: { categoria: "archivos" } } } }),
      "archivos",
    );
  });

  it("las acciones de módulo mandan sobre la entidad: dinero, fotos y expediente", () => {
    assert.equal(clasificarFila({ entityType: "OrthoInstallment", action: "ortho.installment.paid", changes: null }), "dinero");
    assert.equal(clasificarFila({ entityType: "OrthoPhotoSet", action: "ortho.photoSet.photoUploaded", changes: null }), "archivos");
    assert.equal(clasificarFila({ entityType: "OrthodonticDiagnosis", action: "ortho.diagnosis.created", changes: null }), "expediente");
    assert.equal(clasificarFila({ entityType: "clinical-photo", action: "clinical-shared.photo.uploaded", changes: null }), "archivos");
    assert.equal(clasificarFila({ entityType: "orthodontic_cobro", action: "registrar-promesa-de-pago", changes: null }), "dinero");
  });
});

describe("aplicarPermisos", () => {
  const todo = { verClinico: true, verDinero: true };
  it("con permiso, el texto real", () => {
    assert.deepEqual(aplicarPermisos("expediente", "Creó una nota de consulta", todo), {
      categoria: "expediente",
      texto: "Creó una nota de consulta",
      oculto: false,
    });
  });
  it("sin permiso clínico, lo clínico y los archivos dicen solo «Se actualizó el expediente»", () => {
    const sin = { verClinico: false, verDinero: true };
    for (const cat of ["expediente", "archivos"] as const) {
      const r = aplicarPermisos(cat, "Subió una radiografía", sin);
      assert.equal(r.texto, TEXTO_EXPEDIENTE_OCULTO);
      assert.equal(r.oculto, true);
      assert.ok(!r.texto.includes("radiografía"));
    }
    // citas y perfil no son clínicos
    assert.equal(aplicarPermisos("citas", "Agendó una cita", sin).texto, "Agendó una cita");
    assert.equal(aplicarPermisos("perfil", "Creó el perfil del paciente", sin).texto, "Creó el perfil del paciente");
  });
  it("sin permiso de facturación, el dinero dice «Se actualizó la facturación»", () => {
    const r = aplicarPermisos("dinero", "Registró un pago", { verClinico: true, verDinero: false });
    assert.equal(r.texto, TEXTO_DINERO_OCULTO);
    assert.equal(r.oculto, true);
  });
});

describe("deducir el paciente de una fila", () => {
  it("el propio paciente", () => {
    assert.equal(deducirPatientId({ entityType: "patient", entityId: "pat_1" }), "pat_1");
  });
  it("de lo que trae el cambio", () => {
    assert.equal(
      deducirPatientId({ entityType: "appointment", entityId: "a1", changes: { _created: { before: null, after: { patientId: "pat_2" } } } }),
      "pat_2",
    );
    assert.equal(
      deducirPatientId({ entityType: "appointment", entityId: "a1", changes: { _deleted: { before: { patientId: "pat_3" }, after: null } } }),
      "pat_3",
    );
    assert.equal(patientIdEnCambios({ _meta: { patientId: "pat_4" } }), "pat_4");
  });
  it("una entidad que no es del paciente NO se atribuye a nadie aunque el cambio traiga un patientId", () => {
    assert.equal(deducirPatientId({ entityType: "user", entityId: "u1", changes: { _created: { after: { patientId: "pat_9" } } } }), null);
  });
  it("sin nada que decir, null", () => {
    assert.equal(deducirPatientId({ entityType: "appointment", entityId: "a1", changes: { status: {} } }), null);
    assert.deepEqual(camposDeCambio({ status: {}, _mov: {} }), ["status"]);
  });
});

describe("textos compartidos", () => {
  it("la fecha se dice en la zona de la clínica", () => {
    const d = new Date("2026-10-03T16:00:00.000Z");
    assert.equal(fechaHoraParaTexto(d, "America/Mexico_City"), "3 oct 2026 10:00");
    assert.equal(fechaHoraParaTexto(d, "America/Tijuana"), "3 oct 2026 09:00");
    // zona inválida → la de México, no una excepción
    assert.equal(fechaHoraParaTexto(d, "Marte/Olimpo"), "3 oct 2026 10:00");
    assert.equal(fechaHoraParaTexto(null), "fecha sin definir");
  });
  it("las frases de cita", () => {
    const a = new Date("2026-10-03T16:00:00.000Z");
    const b = new Date("2026-10-04T17:30:00.000Z");
    assert.equal(textoCita.agendada(a), "Agendó una cita para el 3 oct 2026 10:00");
    assert.equal(textoCita.movida(a, b), "Movió una cita del 3 oct 2026 10:00 al 4 oct 2026 11:30");
    assert.equal(textoCita.cancelada(a), "Canceló la cita del 3 oct 2026 10:00");
    assert.equal(textoCita.estado(a, "SCHEDULED", "CONFIRMED"), "Cambió la cita del 3 oct 2026 10:00 de «Agendada» a «Confirmada»");
  });
  it("un archivo se nombra por su categoría, nunca por su nombre", () => {
    assert.equal(sustantivoDeArchivo("XRAY_PANORAMIC"), "una radiografía");
    assert.equal(sustantivoDeArchivo("XRAY_CBCT"), "una tomografía (CBCT)");
    assert.equal(sustantivoDeArchivo("SCAN_STL"), "un modelo 3D");
    assert.equal(sustantivoDeArchivo("PHOTO_FRONTAL"), "una foto");
    assert.equal(sustantivoDeArchivo("ORTHO_PHOTO_T0"), "una foto de ortodoncia");
    assert.equal(sustantivoDeArchivo("OTHER"), "un documento");
    assert.equal(sustantivoDeArchivo(undefined), "un documento");
    assert.equal(textoArchivo.subido("SCAN_STL"), "Subió un modelo 3D");
    assert.equal(textoArchivo.quitado("XRAY_PANORAMIC"), "Quitó una radiografía");
  });
});

describe("CSV", () => {
  it("una celda que empieza como fórmula no se ejecuta en Excel", () => {
    assert.equal(celdaCsv("=HYPERLINK(\"http://x\")"), '"\'=HYPERLINK(""http://x"")"');
    assert.equal(celdaCsv("+52 55"), "\"'+52 55\"");
    assert.equal(celdaCsv("@cmd"), "\"'@cmd\"");
    assert.equal(celdaCsv("normal"), '"normal"');
  });
  it("lleva BOM, encabezado y una fila por movimiento", () => {
    const csv = movimientosACsv(
      [{ id: "1", fecha: "2026-10-03T16:00:00.000Z", actor: "Ana \"la doctora\"", categoria: "citas", texto: "Agendó una cita", oculto: false }],
      "America/Mexico_City",
    );
    assert.ok(csv.startsWith("﻿"));
    const lineas = csv.trim().split("\r\n");
    assert.equal(lineas.length, 2);
    assert.equal(lineas[0].replace("﻿", ""), '"Fecha y hora","Quién","Tipo","Qué cambió"');
    assert.ok(lineas[1].includes('"03/10/2026, 10:00"') || lineas[1].includes("03/10/2026"));
    assert.ok(lineas[1].includes('"Ana ""la doctora"""'));
    assert.ok(lineas[1].includes('"Citas"'));
  });
});
