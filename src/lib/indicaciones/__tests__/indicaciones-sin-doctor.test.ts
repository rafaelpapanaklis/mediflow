/**
 * Hojas de indicaciones de una cita «Sin doctor» (ws1-t11, unión · R1):
 * `[NOMBRE_DOCTOR]` sigue la regla de los recordatorios en vez de la raya
 * «________». La línea que solo habla del doctor se quita; en una frase queda
 * «nuestro equipo». Con doctor, nada cambia.
 *
 * Run: npm run test:cita-sin-doctor-mensajes
 *
 * PURO: sin base ni red.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { RAYA, rellenarHoja } from "../marcadores";
import { seccionesRellenas, valoresDeLaCita, type DatosParaHoja } from "../envio";
import { DOCTOR_NEUTRO } from "../../reminders/doctor-del-mensaje";

function datos(sinDoctor: boolean): DatosParaHoja {
  return {
    cita: {
      status: "COMPLETED", motivo: "Extracción", sinDoctor,
      startsAt: new Date("2031-03-11T16:00:00Z"), endsAt: new Date("2031-03-11T16:30:00Z"),
      checkedInAt: null, startedAt: null, completedAt: null,
    },
    paciente: { nombre: "Ana García" },
    doctor: sinDoctor ? { nombre: "", cedula: null } : { nombre: "Raquel Méndez", cedula: "12345678" },
    clinica: { nombre: "Centro Dental Salamanca QA", telefono: "4641234567", ciudad: "Salamanca", estado: "Guanajuato", timezone: "America/Mexico_City" },
    procedimientos: [],
  } as DatosParaHoja;
}

const HOJA = [
  "Hola [NOMBRE_PACIENTE]:",
  "Te atendió: Dr/a. [NOMBRE_DOCTOR]",
  "Si tienes dudas, el Dr. [NOMBRE_DOCTOR] te responde en el [TELEFONO_CLINICA].",
  "Muerde la gasa 30 minutos.",
].join("\n");

test("🔴 sin doctor: la línea que solo habla del doctor se quita y la frase dice «nuestro equipo» (nunca la raya)", () => {
  const ahora = new Date("2031-03-11T18:00:00Z");
  const [s] = seccionesRellenas([{ nombre: "Extracción", cuerpo: HOJA }], valoresDeLaCita(datos(true), ahora));
  assert.ok(!s.cuerpo.includes(RAYA), s.cuerpo);
  assert.ok(!s.cuerpo.includes("[NOMBRE_DOCTOR]"), s.cuerpo);
  assert.ok(!/Te atendió/.test(s.cuerpo), "la línea del doctor se va entera");
  assert.match(s.cuerpo, new RegExp(`Si tienes dudas, ${DOCTOR_NEUTRO} te responde en el 4641234567\\.`));
  assert.match(s.cuerpo, /^Hola Ana García:/);
  assert.match(s.cuerpo, /Muerde la gasa 30 minutos\.$/);
});

test("con doctor, la hoja sale como siempre", () => {
  const ahora = new Date("2031-03-11T18:00:00Z");
  const [s] = seccionesRellenas([{ nombre: "Extracción", cuerpo: HOJA }], valoresDeLaCita(datos(false), ahora));
  assert.match(s.cuerpo, /Te atendió: Dr\/a\. Raquel Méndez/);
  assert.match(s.cuerpo, /el Dr\. Raquel Méndez te responde/);
});

test("sin doctor y con otros marcadores en la línea, es frase: no se borra", () => {
  const t = rellenarHoja("Atendido por [NOMBRE_DOCTOR] el [FECHA_CITA].", { sinDoctor: true, fechaCita: "11 de marzo de 2031" });
  assert.equal(t, `Atendido por ${DOCTOR_NEUTRO} el 11 de marzo de 2031.`);
});

test("un dato vacío que no es el doctor sigue saliendo como raya", () => {
  assert.equal(rellenarHoja("Cédula: [CEDULA_DOCTOR]", { cedulaDoctor: null }), `Cédula: ${RAYA}`);
  assert.equal(rellenarHoja("Doctor: [NOMBRE_DOCTOR]", { nombreDoctor: "" }), `Doctor: ${RAYA}`, "sin la bandera, la raya de siempre");
});
