// Ortodoncia — las «Plantillas de mensaje» de Configuración sí se usan
// (ws1-t5, ronda 6 · fila 28 de la revisión de uso).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLAVE_MENSUALIDAD_VENCIDA,
  CLAVE_RECORDATORIO_CONTROL,
  MAX_PLANTILLA,
  PLANTILLAS_ORTO,
  motivoDeRechazoDePlantilla,
  motivoDeRechazoDePlantillas,
  normalizarPlantillas,
  plantillaGuardada,
  plantillaUsable,
  renderAvisoMensualidadVencida,
  textoRecordatorioDeCita,
  variablesUsadas,
} from "../plantillas-mensaje";
import { renderReminderTemplate } from "@/lib/reminders/config";

test("sin plantilla guardada no hay nada que usar", () => {
  assert.equal(plantillaGuardada(null, CLAVE_RECORDATORIO_CONTROL), null);
  assert.equal(plantillaGuardada({}, CLAVE_RECORDATORIO_CONTROL), null);
  assert.equal(plantillaGuardada([], CLAVE_RECORDATORIO_CONTROL), null);
  assert.equal(plantillaGuardada({ recordatorioControl: "   \n " }, CLAVE_RECORDATORIO_CONTROL), null);
  assert.equal(plantillaGuardada({ recordatorioControl: 7 }, CLAVE_RECORDATORIO_CONTROL), null);
});

test("la plantilla guardada sale recortada", () => {
  assert.equal(
    plantillaGuardada({ avisoMensualidadVencida: "  Hola {paciente}  " }, CLAVE_MENSUALIDAD_VENCIDA),
    "Hola {paciente}",
  );
});

test("el aviso de mensualidad vencida sale con la redacción de la clínica", () => {
  const texto = renderAvisoMensualidadVencida(
    "{paciente}: debes {monto} desde el {fecha}. — {clinica}. Total: {monto}",
    { paciente: "Luis Pérez", clinica: "Sonrisas", monto: "$2,000", fecha: "5 de marzo" },
  );
  assert.equal(texto, "Luis Pérez: debes $2,000 desde el 5 de marzo. — Sonrisas. Total: $2,000");
  assert.equal(texto.includes("{"), false);
});

test("el recordatorio de control usa las variables del recordatorio de cita y no pierde el enlace", () => {
  const vars = {
    paciente: "Luis",
    clinica: "Sonrisas",
    fecha: "martes 3 de marzo",
    hora: "17:00",
    doctor: "Dr/a. Ana Ruiz",
    link: "https://x.test/c/abc",
  };
  const conEnlace = renderReminderTemplate("Hola {paciente}, control el {fecha} a las {hora}. {link}", vars);
  assert.equal(conEnlace, "Hola Luis, control el martes 3 de marzo a las 17:00. https://x.test/c/abc");
  const sinEnlace = renderReminderTemplate("Hola {paciente}, control el {fecha} a las {hora}.", vars);
  assert.ok(sinEnlace.startsWith("Hola Luis, control el martes 3 de marzo a las 17:00."));
  assert.ok(sinEnlace.includes("https://x.test/c/abc"), "el enlace para confirmar se agrega al final");
});

test("todas las variables que anuncia cada plantilla las sabe sustituir su envío", () => {
  const control = PLANTILLAS_ORTO.find((p) => p.clave === CLAVE_RECORDATORIO_CONTROL)!;
  const textoControl = renderReminderTemplate(control.variables.map((v) => `{${v}}`).join(" "), {
    paciente: "P",
    clinica: "C",
    fecha: "F",
    hora: "H",
    doctor: "D",
    link: "L",
  });
  assert.equal(variablesUsadas(textoControl).length, 0, textoControl);

  const vencida = PLANTILLAS_ORTO.find((p) => p.clave === CLAVE_MENSUALIDAD_VENCIDA)!;
  const textoVencida = renderAvisoMensualidadVencida(vencida.variables.map((v) => `{${v}}`).join(" "), {
    paciente: "P",
    clinica: "C",
    monto: "M",
    fecha: "F",
  });
  assert.equal(variablesUsadas(textoVencida).length, 0, textoVencida);
});

test("los ejemplos de la pantalla pasan su propia validación", () => {
  for (const p of PLANTILLAS_ORTO) {
    assert.equal(motivoDeRechazoDePlantilla(p.clave, p.ejemplo), null, p.clave);
  }
});

test("una variable que no existe se rechaza diciendo cuáles sí", () => {
  const rechazo = motivoDeRechazoDePlantilla(CLAVE_MENSUALIDAD_VENCIDA, "Hola {nombre}, debes {importe}");
  assert.ok(rechazo);
  assert.ok(rechazo!.includes("{nombre}"));
  assert.ok(rechazo!.includes("{importe}"));
  assert.ok(rechazo!.includes("{monto}"));
  assert.ok(rechazo!.includes("Aviso de mensualidad vencida"));
});

test("{hora} no existe en el aviso de mensualidad y sí en el recordatorio", () => {
  assert.ok(motivoDeRechazoDePlantilla(CLAVE_MENSUALIDAD_VENCIDA, "a las {hora}"));
  assert.equal(motivoDeRechazoDePlantilla(CLAVE_RECORDATORIO_CONTROL, "a las {hora}"), null);
});

test("vacío se acepta: significa «usa el texto por defecto»", () => {
  assert.equal(motivoDeRechazoDePlantilla(CLAVE_RECORDATORIO_CONTROL, ""), null);
  assert.equal(motivoDeRechazoDePlantilla(CLAVE_RECORDATORIO_CONTROL, "   "), null);
  assert.equal(motivoDeRechazoDePlantillas({}), null);
});

test("una plantilla vieja con una variable mal escrita no se manda: cae al texto por defecto", () => {
  assert.equal(plantillaUsable({ avisoMensualidadVencida: "Hola {nombre}" }, CLAVE_MENSUALIDAD_VENCIDA), null);
  assert.equal(
    plantillaUsable({ avisoMensualidadVencida: "Hola {paciente}" }, CLAVE_MENSUALIDAD_VENCIDA),
    "Hola {paciente}",
  );
  assert.equal(plantillaUsable({}, CLAVE_RECORDATORIO_CONTROL), null);
});

test("un texto demasiado largo se rechaza", () => {
  assert.ok(motivoDeRechazoDePlantilla(CLAVE_RECORDATORIO_CONTROL, "a".repeat(MAX_PLANTILLA + 1)));
});

test("llaves que no son variables no estorban", () => {
  assert.deepEqual(variablesUsadas("Trae tu {paciente} y {no es variable} y {}"), ["paciente"]);
});

test("al guardar se quitan las vacías y las claves que no son del módulo", () => {
  assert.deepEqual(
    normalizarPlantillas({
      recordatorioControl: "  Hola {paciente} ",
      avisoMensualidadVencida: "   ",
      otraCosa: "x",
    }),
    { recordatorioControl: "Hola {paciente}" },
  );
});

test("el primer rechazo entre varias plantillas", () => {
  const rechazo = motivoDeRechazoDePlantillas({
    recordatorioControl: "Hola {paciente}",
    avisoMensualidadVencida: "Debes {saldo}",
  });
  assert.ok(rechazo?.includes("{saldo}"));
});

const VARS = {
  paciente: "Luis",
  clinica: "Sonrisas",
  fecha: "martes 3 de marzo",
  hora: "17:00",
  doctor: "Dr/a. Ana Ruiz",
  link: "https://x.test/c/abc",
};

test("recordatorio de una cita normal: la plantilla general, sin mencionar ortodoncia", () => {
  const texto = textoRecordatorioDeCita({
    esControl: false,
    plantillaGeneral: "Hola {paciente}, cita el {fecha}. {link}",
    plantillaControl: "CONTROL {paciente}",
    vars: VARS,
  });
  assert.equal(texto, "Hola Luis, cita el martes 3 de marzo. https://x.test/c/abc");
});

test("recordatorio de un control CON plantilla de Ortodoncia: sale esa redacción y nada más", () => {
  const texto = textoRecordatorioDeCita({
    esControl: true,
    plantillaGeneral: "Hola {paciente}, cita el {fecha}. {link}",
    plantillaControl: "{paciente}, tu control es el {fecha} a las {hora} con {doctor}.",
    vars: VARS,
  });
  assert.ok(texto.startsWith("Luis, tu control es el martes 3 de marzo a las 17:00 con Dr/a. Ana Ruiz."));
  assert.ok(texto.includes("https://x.test/c/abc"));
  assert.equal(texto.includes("Este es el recordatorio"), false);
  assert.equal(texto.includes("Hola Luis, cita"), false);
});

test("recordatorio de un control SIN plantilla propia: la general con la línea del control", () => {
  const texto = textoRecordatorioDeCita({
    esControl: true,
    plantillaGeneral: "Hola {paciente}, cita el {fecha}. {link}",
    plantillaControl: null,
    vars: VARS,
  });
  assert.ok(texto.startsWith("🦷 Este es el recordatorio de tu *control de ortodoncia*."));
  assert.ok(texto.endsWith("Hola Luis, cita el martes 3 de marzo. https://x.test/c/abc"));
});
