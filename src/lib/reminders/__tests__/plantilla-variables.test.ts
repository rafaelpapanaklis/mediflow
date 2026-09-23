/**
 * Variables del texto de recordatorio — ws1-t4.
 *
 * Run: npm run test:wa-recordatorio-manual
 *
 * findUnknownReminderVars es lo que impide que un `{precio}` llegue literal al
 * paciente en el envío manual, y la pantalla de /dashboard/whatsapp enseña la
 * vista previa con el MISMO render que el envío.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_REMINDER_TEMPLATE,
  REMINDER_TEMPLATE_VARS,
  findUnknownReminderVars,
  renderReminderTemplate,
} from "../config";
import { REMINDER_VARS_HELP, previewReminderMessage } from "../preview";

const VARS = {
  paciente: "Ana",
  clinica: "BEVADENT",
  fecha: "lunes, 5 de octubre",
  hora: "10:30",
  doctor: "Dr/a. Luis Ruiz",
  link: "https://x.test/cita/t/confirmar",
};

test("toda variable que el render entiende sale en la lista de la pantalla, y ninguna más", () => {
  const enPantalla = REMINDER_VARS_HELP.flatMap((v) => v.vars).sort();
  const conocidas = REMINDER_TEMPLATE_VARS.map((v) => `{${v}}`).sort();
  assert.deepEqual(enPantalla, conocidas);
});

test("cada variable conocida la sustituye de verdad renderReminderTemplate", () => {
  for (const v of REMINDER_TEMPLATE_VARS) {
    const out = renderReminderTemplate(`x {${v}} y`, VARS);
    assert.doesNotMatch(out, /[{}]/, `{${v}} quedó sin sustituir: ${out}`);
  }
});

test("findUnknownReminderVars: nada que objetar en los textos por defecto", () => {
  assert.deepEqual(findUnknownReminderVars(DEFAULT_REMINDER_TEMPLATE), []);
  assert.deepEqual(
    findUnknownReminderVars("Hola {nombre} 👋 … *{fecha}* … *{hora}h* … Dr/a. {doctor}"),
    [],
  );
  assert.deepEqual(findUnknownReminderVars("Sin variables, ni llaves."), []);
});

test("findUnknownReminderVars: señala lo que llegaría literal, sin repetir", () => {
  assert.deepEqual(findUnknownReminderVars("{precio} y {precio} y {nombre}"), ["{precio}"]);
  assert.deepEqual(findUnknownReminderVars("{ nombre } {Nombre} {}"), ["{ nombre }", "{Nombre}", "{}"]);
  assert.deepEqual(findUnknownReminderVars("Hola {{1}}"), ["{{1}}"]);
});

test("findUnknownReminderVars: doble llave sobre una variable conocida y llaves sueltas", () => {
  // `{{fecha}}` contiene `{fecha}`, pero el render dejaría «{lunes, 5 de octubre}».
  assert.deepEqual(findUnknownReminderVars("Tu cita es el {{fecha}}."), ["{{fecha}}"]);
  assert.deepEqual(findUnknownReminderVars("{{paciente}} {doctor}}"), ["{{paciente}}", "{doctor}}"]);
  assert.deepEqual(findUnknownReminderVars("Hola {nombre, te esperamos"), ["{"]);
  assert.deepEqual(findUnknownReminderVars("Emoji :-} y {nombre}"), ["}"]);
  assert.deepEqual(findUnknownReminderVars("{nom\nbre}"), ["{", "}"]);
});

test("propiedad: si findUnknownReminderVars no objeta nada, el render no deja ni una llave", () => {
  const trozos = ["{", "}", "{{", "}}", "hola ", "\n", ...REMINDER_TEMPLATE_VARS.map((v) => `{${v}}`), "{precio}", "x"];
  let semilla = 7;
  const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let i = 0; i < 5000; i++) {
    let t = "";
    for (let j = 0, n = 1 + Math.floor(azar() * 6); j < n; j++) t += trozos[Math.floor(azar() * trozos.length)];
    if (findUnknownReminderVars(t).length > 0) continue;
    assert.doesNotMatch(renderReminderTemplate(t, VARS), /[{}]/, `pasó el detector y dejó llaves: ${JSON.stringify(t)}`);
  }
});

test("«Dr/a. {doctor}» no se lee «Dr/a. Dr/a.»", () => {
  assert.equal(renderReminderTemplate("Dr/a. {doctor}", { ...VARS, link: "" }), "Dr/a. Luis Ruiz");
  assert.equal(renderReminderTemplate("Te atiende: {doctor}", { ...VARS, link: "" }), "Te atiende: Dr/a. Luis Ruiz");
});

test("vista previa: el texto de la captura sale limpio y con el link añadido al final", () => {
  const { preview, unknown } = previewReminderMessage(
    "Hola {nombre} 👋, te recordamos tu cita en *BEVADENT* el *{fecha}* a las *{hora}h*.\n\nDr/a. {doctor}",
    { clinica: "BEVADENT", fecha: "lunes 28 de abril" },
  );
  assert.deepEqual(unknown, []);
  assert.doesNotMatch(preview, /[{}]/);
  assert.match(preview, /^Hola María 👋, te recordamos tu cita en \*BEVADENT\* el \*lunes 28 de abril\* a las \*10:00h\*\.\n\nDr\/a\. García\n\nConfirma tu asistencia aquí: \S+\/cita\/ejemplo\/confirmar$/);
});

test("vista previa: devuelve las variables desconocidas para avisar en pantalla", () => {
  const { unknown } = previewReminderMessage("Hola {nombre}, son {precio}", { clinica: "X", fecha: "f" });
  assert.deepEqual(unknown, ["{precio}"]);
});
