/**
 * Cita «Sin doctor» en lo que le llega al PACIENTE (ws1-t10 · fase 2 · P3).
 * Plan: ~/gerentes/trabajos/20261104-1815-cita-sin-doctor-opcion-sin-doctor-por-de/PLAN.md §2.6.
 *
 * Run: npm run test:cita-sin-doctor-mensajes
 *
 * Puro: sin base (la cola se carga con un `globalThis.prisma` vacío que nadie
 * llama), sin Meta, sin red.
 *  · Con doctor, el texto es EXACTAMENTE el de antes (se compara contra una
 *    copia del render viejo).
 *  · Sin doctor: la línea que solo habla del doctor se va —también en las
 *    plantillas que cada clínica ya personalizó— y una frase lo cambia por
 *    «nuestro equipo». Nunca «Te atiende: » vacío, ni «Dr/a. undefined».
 *  · Plantillas de Meta: {{5}} nunca vacío y el mismo número de variables.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

(globalThis as any).prisma = new Proxy({}, { get: () => { throw new Error("esta prueba no toca la base"); } });

import {
  DEFAULT_REMINDER_TEMPLATE,
  renderReminderTemplate,
  type ReminderTemplateVars,
} from "../config";
import { previewReminderMessage } from "../preview";
import { buildAppointmentReminderEmail } from "../email";
import {
  DOCTOR_NEUTRO,
  doctorConTitulo,
  doctorParaPlantilla,
  nombreDelDoctor,
  quitarDoctorDeLaPlantilla,
} from "../doctor-del-mensaje";
import { textoRecordatorioDeCita, LINEA_CONTROL_ORTO } from "@/lib/orthodontics/plantillas-mensaje";
import { plantillaDeFila } from "@/lib/whatsapp/plantilla-de-fila";
import { paramsDeAvisoCita, kindDeAvisoCita, envioDeResolucion } from "@/lib/whatsapp/avisos-cita-plantilla";
import { WA_TEMPLATE_CATALOG, countTemplateVariables } from "@/lib/whatsapp/templates-catalog";
import { motivoSinConstancia, MENSAJE_SIN_CONSTANCIA } from "@/lib/indicaciones/envio";
import { quienOcupaElHueco } from "@/lib/appointment-change/slots";

const LINK = "https://www.dalecontrol.com/cita/tok-1/confirmar";
const BASE: ReminderTemplateVars = {
  paciente: "María",
  clinica: "Centro Dental QA",
  fecha: "lunes 9 de noviembre",
  hora: "10:00",
  doctor: "Dr/a. Luis Ruiz",
  link: LINK,
};
const SIN: ReminderTemplateVars = { ...BASE, doctor: null };

/** La plantilla de fábrica de /dashboard/whatsapp (whatsapp-client.tsx). */
const PLANTILLA_WHATSAPP =
  "Hola {nombre} 👋, te recordamos tu cita en *{clinica}* el *{fecha}* a las *{hora}h*.\n\nDr/a. {doctor}\n\n_Responde este mensaje si necesitas cambiarla._";
/** El respaldo del recordatorio manual (api/whatsapp/send). */
const PLANTILLA_MANUAL =
  "Hola {paciente} 👋, te recordamos que tienes una cita en *{clinica}* el *{fecha}* a las *{hora}h*.\n\n" +
  "{doctor}\n\n" +
  "✅ Responde *CONFIRMAR* para confirmar tu cita\n" +
  "❌ Responde *CANCELAR* si no podrás asistir";
/** Las tres formas personalizadas del plan. */
const SOLA = "Hola {paciente}, tu cita es el {fecha} a las {hora}.\nTe atiende: {doctor}\nConfirma aquí: {link}";
const CON_TITULO = "Hola {paciente}.\n\nDr/a. {doctor}\n\nTe esperamos el {fecha} a las {hora}.";
const EN_FRASE = "Hola {paciente}, tu cita con {doctor} el {fecha} a las {hora}. {link}";

/** El render ANTES de esta tarea (copia literal): con doctor nada puede cambiar. */
function renderViejo(template: string, vars: { [k: string]: string }): string {
  let body = template
    .replaceAll("{paciente}", vars.paciente)
    .replaceAll("{nombre}", vars.paciente)
    .replaceAll("{clinica}", vars.clinica)
    .replaceAll("{clinicName}", vars.clinica)
    .replaceAll("{fecha}", vars.fecha)
    .replaceAll("{hora}", vars.hora)
    .replaceAll("{doctor}", vars.doctor)
    .replaceAll("{doctorName}", vars.doctor)
    .replaceAll("{link}", vars.link)
    .replaceAll("Dr/a. Dr/a.", "Dr/a.");
  if (vars.link && !body.includes(vars.link)) body += `\n\nConfirma tu asistencia aquí: ${vars.link}`;
  return body.trim();
}

/** Lo que nunca puede llegarle al paciente de una cita sin doctor. */
function sinRastroDelDoctor(texto: string): void {
  assert.doesNotMatch(texto, /undefined|null|\{doctor(Name)?\}/, texto);
  assert.doesNotMatch(texto, /Te atiende/i, texto);
  assert.doesNotMatch(texto, /Dr\/a\.|Dr\.|Dra\./, texto);
  assert.doesNotMatch(texto, /\n\s*\n\s*\n/, `sin líneas en blanco de más:\n${texto}`);
}

/* ═══════════════ 1 · Con doctor: exactamente lo de antes ═══════════════ */

test("con doctor, el recordatorio sale IGUAL que antes (fábrica, /dashboard/whatsapp, manual y las tres personalizadas)", () => {
  for (const t of [DEFAULT_REMINDER_TEMPLATE, PLANTILLA_WHATSAPP, PLANTILLA_MANUAL, SOLA, CON_TITULO, EN_FRASE, "Hola {nombre}"]) {
    assert.equal(renderReminderTemplate(t, BASE), renderViejo(t, BASE as any), t);
  }
  assert.match(renderReminderTemplate(DEFAULT_REMINDER_TEMPLATE, BASE), /Te atiende: Dr\/a\. Luis Ruiz/);
});

test("`doctorConTitulo` arma lo mismo que cada sitio armaba a mano", () => {
  assert.equal(doctorConTitulo({ firstName: "Luis", lastName: "Ruiz" }), "Dr/a. Luis Ruiz");
  assert.equal(doctorConTitulo({ firstName: "Ana", lastName: "" }), "Dr/a. Ana");
  assert.equal(doctorConTitulo(null), null);
  assert.equal(doctorConTitulo({ firstName: "", lastName: "" }), null, "sin nombre tampoco hay doctor que nombrar");
  assert.equal(nombreDelDoctor({ firstName: "Luis", lastName: "Ruiz" }), "Luis Ruiz");
  assert.equal(nombreDelDoctor(undefined), null);
});

/* ═══════════════ 2 · Sin doctor: la línea se va ═══════════════ */

test("plantilla de fábrica sin doctor: sin «Te atiende: », con fecha, hora y enlace (la foto 3 «después»)", () => {
  const t = renderReminderTemplate(DEFAULT_REMINDER_TEMPLATE, SIN);
  sinRastroDelDoctor(t);
  assert.equal(
    t,
    "Hola María 👋, te recordamos tu cita en *Centro Dental QA* el *lunes 9 de noviembre* a las *10:00*.\n\n" +
      `Confirma tu asistencia aquí: ${LINK}\n` +
      "También puedes responder *CONFIRMAR* o *CANCELAR* a este mensaje.",
  );
});

test("«Dr/a. {doctor}» sola en su línea (la de /dashboard/whatsapp) se quita", () => {
  const t = renderReminderTemplate(PLANTILLA_WHATSAPP, SIN);
  sinRastroDelDoctor(t);
  assert.match(t, /_Responde este mensaje si necesitas cambiarla\._/);
  assert.match(t, /10:00h\*\.\n\n_Responde/);
});

test("el respaldo del recordatorio manual ({doctor} solo) queda sin la línea", () => {
  const t = renderReminderTemplate(PLANTILLA_MANUAL, SIN);
  sinRastroDelDoctor(t);
  assert.match(t, /CONFIRMAR/);
});

test("personalizada «Te atiende: {doctor}» sola en su línea: se quita y lo demás queda", () => {
  const t = renderReminderTemplate(SOLA, SIN);
  sinRastroDelDoctor(t);
  assert.equal(t, `Hola María, tu cita es el lunes 9 de noviembre a las 10:00.\nConfirma aquí: ${LINK}`);
});

test("personalizada con «Dr/a. {doctor}» en su línea: se quita", () => {
  const t = renderReminderTemplate(CON_TITULO, SIN);
  sinRastroDelDoctor(t);
  assert.ok(t.startsWith("Hola María.\n\nTe esperamos el lunes 9 de noviembre a las 10:00."), t);
});

test("«Tu cita con {doctor} el {fecha}»: la frase se conserva y se lee bien («nuestro equipo»)", () => {
  const t = renderReminderTemplate(EN_FRASE, SIN);
  assert.equal(t, `Hola María, tu cita con ${DOCTOR_NEUTRO} el lunes 9 de noviembre a las 10:00. ${LINK}`);
  assert.equal(DOCTOR_NEUTRO, "nuestro equipo");
});

test("«con el Dr/a. {doctor} el {fecha}» no deja «el Dr/a. nuestro equipo»", () => {
  const t = renderReminderTemplate("Tu cita con el Dr/a. {doctor} el {fecha}.", SIN);
  assert.equal(t, `Tu cita con nuestro equipo el lunes 9 de noviembre.\n\nConfirma tu asistencia aquí: ${LINK}`);
  const dra = renderReminderTemplate("Te espera la Dra. {doctor} el {fecha}.", SIN);
  assert.match(dra, /^Te espera nuestro equipo el lunes/);
});

test("una frase que SIGUE después del doctor no se pierde («… con {doctor}. ¡Te esperamos!»)", () => {
  const t = renderReminderTemplate("Tu cita será con {doctor}. ¡Te esperamos!", SIN);
  assert.match(t, /^Tu cita será con nuestro equipo\. ¡Te esperamos!/);
});

test("🔴 el texto de la clínica que va ANTES del doctor en la misma línea no se borra (revisión M2)", () => {
  const tel = renderReminderTemplate("Hola {paciente}.\nSi necesitas cambiarla llama al 999 123 4567. Te atiende {doctor}", SIN);
  assert.match(tel, /llama al 999 123 4567\. Te atiende nuestro equipo/);
  const ind = renderReminderTemplate("Recuerda traer tu identificación y llegar 10 min antes. Doctor: {doctor}.", SIN);
  assert.match(ind, /^Recuerda traer tu identificación y llegar 10 min antes\. Doctor: nuestro equipo\./);
  const larga = renderReminderTemplate("Te recordamos tu cita de mañana en Clínica X con {doctor}", SIN);
  assert.match(larga, /^Te recordamos tu cita de mañana en Clínica X con nuestro equipo/);
  // Corta pero dice qué es la cita: no es un rótulo (refutación).
  const tipo = renderReminderTemplate("Hola {paciente}.\nConsulta de ortodoncia con {doctor}\n{link}", SIN);
  assert.match(tipo, /\nConsulta de ortodoncia con nuestro equipo\n/);
  // …y el rótulo de siempre sí se va.
  assert.doesNotMatch(renderReminderTemplate("Hola {paciente}.\nAtendido por: {doctor}\n{link}", SIN), /Atendido|nuestro/);
});

test("una plantilla que quedaría vacía al quitar la línea usa la frase («nuestro equipo»)", () => {
  const t = renderReminderTemplate("Te atiende: {doctor}", SIN);
  assert.ok(t.startsWith("Te atiende: nuestro equipo"), t);
});

test("redacción del texto neutro: «del», «tu doctor», «con el», y mayúscula al abrir la frase (revisión m4)", () => {
  assert.match(renderReminderTemplate("Tu cita del Dr. {doctor} el {fecha}", SIN), /^Tu cita de nuestro equipo el lunes/);
  assert.match(renderReminderTemplate("Pasa con tu doctor {doctor} el {fecha}", SIN), /^Pasa con nuestro equipo el lunes/);
  assert.match(renderReminderTemplate("Tu cita con el {doctor} el {fecha}", SIN), /^Tu cita con nuestro equipo el lunes/);
  assert.match(renderReminderTemplate("El Dr. {doctor} te espera el {fecha}", SIN), /^Nuestro equipo te espera el lunes/);
  assert.match(renderReminderTemplate("{doctor} te espera el {fecha}", SIN), /^Nuestro equipo te espera el lunes/);
  assert.match(renderReminderTemplate("Hola {paciente}. {doctor} te espera el {fecha}", SIN), /^Hola María\. Nuestro equipo te espera/);
});

test("sin lookbehind en la regla (corre en el navegador: Safari < 16.4 de los iPads lo rechaza) (revisión m3)", async () => {
  const { readFileSync } = await import("node:fs");
  const fuente = readFileSync(new URL("../doctor-del-mensaje.ts", import.meta.url), "utf8");
  assert.doesNotMatch(fuente.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, ""), /\(\?<[!=]/);
});

test("el rótulo que solo presentaba al doctor en la línea de arriba también se va", () => {
  const t = renderReminderTemplate("Hola {paciente}.\n\nTe atiende:\n{doctor}\n\nNos vemos el {fecha}", SIN);
  assert.equal(t, `Hola María.\n\nNos vemos el lunes 9 de noviembre\n\nConfirma tu asistencia aquí: ${LINK}`);
  // …pero un rótulo que presenta más cosas se queda.
  const t2 = renderReminderTemplate("Detalles:\n{doctor}\n📅 {fecha}", SIN);
  assert.match(t2, /^Detalles:\n📅 lunes/);
});

test("v2 · m1 (revisión t12): el rótulo en su línea se va si lo que sigue es otro rótulo con valor o solo el enlace", () => {
  const otro = renderReminderTemplate("Hola {paciente}.\nAtendido por:\n{doctor}\nFecha: {fecha}", SIN);
  assert.equal(otro, `Hola María.\nFecha: lunes 9 de noviembre\n\nConfirma tu asistencia aquí: ${LINK}`);
  const enlace = renderReminderTemplate("Hola {paciente}.\nAtentamente:\n{doctorName}\n{link}", SIN);
  assert.equal(enlace, `Hola María.\n${LINK}`);
  // Presenta datos sueltos ({fecha}, {hora}): el encabezado se queda.
  assert.match(renderReminderTemplate("Datos de tu cita:\n{doctor}\n{fecha}\n{hora}", SIN), /^Datos de tu cita:\nlunes 9 de noviembre\n10:00/);
  // Con doctor, todo igual.
  assert.equal(
    renderReminderTemplate("Atendido por:\n{doctor}\nFecha: {fecha}", BASE),
    `Atendido por:\nDr/a. Luis Ruiz\nFecha: lunes 9 de noviembre\n\nConfirma tu asistencia aquí: ${LINK}`,
  );
});

test("v3 · m1-v2 (revisión t12): si la línea del doctor trae su rótulo, el encabezado de sección de arriba se queda", () => {
  const datos = renderReminderTemplate("Datos de tu cita:\nDoctor: {doctor}\nFecha: {fecha}", SIN);
  assert.equal(datos, `Datos de tu cita:\nFecha: lunes 9 de noviembre\n\nConfirma tu asistencia aquí: ${LINK}`);
  const detalles = renderReminderTemplate("📋 *Detalles de tu cita:*\n👨‍⚕️ *Doctor:* {doctor}\n📅 *Fecha:* {fecha}\n🕐 *Hora:* {hora}", SIN);
  assert.equal(detalles, `📋 *Detalles de tu cita:*\n📅 *Fecha:* lunes 9 de noviembre\n🕐 *Hora:* 10:00\n\nConfirma tu asistencia aquí: ${LINK}`);
  const tuCita = renderReminderTemplate("Tu cita:\nTe atiende: {doctor}\nFecha: {fecha}", SIN);
  assert.equal(tuCita, `Tu cita:\nFecha: lunes 9 de noviembre\n\nConfirma tu asistencia aquí: ${LINK}`);
  // …pero si debajo no queda nada, el encabezado sí se va (la regla de antes).
  assert.equal(renderReminderTemplate("Hola {paciente}.\nTu cita:\nTe atiende: {doctor}", SIN), `Hola María.\n\nConfirma tu asistencia aquí: ${LINK}`);
  // Con doctor, letra por letra lo de antes.
  for (const t of ["Datos de tu cita:\nDoctor: {doctor}\nFecha: {fecha}", "📋 *Detalles de tu cita:*\n👨‍⚕️ *Doctor:* {doctor}\n📅 *Fecha:* {fecha}\n🕐 *Hora:* {hora}", "Tu cita:\nTe atiende: {doctor}\nFecha: {fecha}"]) {
    assert.equal(renderReminderTemplate(t, BASE), renderViejo(t, BASE as any), t);
  }
});

test("v2 · M1 (revisión t12): «el/la», «la/el» y las fórmulas con artículo se leen bien", () => {
  const casos: [string, string][] = [
    ["Tu cita será con el/la doctor(a) {doctor}.", "Tu cita será con nuestro equipo."],
    ["Te atenderá el/la Dr(a). {doctor} el {fecha}", "Te atenderá nuestro equipo el lunes 9 de noviembre"],
    ["Te atenderá la/el Dr(a). {doctor} el {fecha}", "Te atenderá nuestro equipo el lunes 9 de noviembre"],
    ["Tu cita con el/la Dr(a). {doctor} es el {fecha}", "Tu cita con nuestro equipo es el lunes 9 de noviembre"],
    ["Tu cita con la Dra. {doctor} es el {fecha}", "Tu cita con nuestro equipo es el lunes 9 de noviembre"],
    ["Tu cita con el Dr. {doctor} es el {fecha}", "Tu cita con nuestro equipo es el lunes 9 de noviembre"],
    ["Tu cita con el/la doctor(a) {doctor} es el {fecha}", "Tu cita con nuestro equipo es el lunes 9 de noviembre"],
    ["El/la Dr(a). {doctor} te espera el {fecha}", "Nuestro equipo te espera el lunes 9 de noviembre"],
  ];
  for (const [plantilla, esperado] of casos) {
    const t = renderReminderTemplate(plantilla, SIN);
    assert.ok(t.startsWith(esperado), `${plantilla}\n→ ${t}`);
    assert.doesNotMatch(t, /el\/|\/el|la\/|\/la|Dr|Dra|doctor\(a\)/i, t);
    // Con doctor, letra por letra lo de antes.
    assert.equal(renderReminderTemplate(plantilla, BASE), renderViejo(plantilla, BASE as any), plantilla);
  }
});

test("alias {doctorName} y emoji con negritas («👨‍⚕️ *Te atiende:* {doctorName}»)", () => {
  const t = renderReminderTemplate("Hola {nombre}\n👨‍⚕️ *Te atiende:* {doctorName}\n{link}", SIN);
  sinRastroDelDoctor(t);
  assert.equal(t, `Hola María\n${LINK}`);
});

test("\"\" (lo que mandaba P1 en el reagendado) cuenta como sin doctor: nunca «Te atiende: » vacío", () => {
  const t = renderReminderTemplate(DEFAULT_REMINDER_TEMPLATE, { ...BASE, doctor: "" });
  sinRastroDelDoctor(t);
});

test("una plantilla sin {doctor} sale igual con o sin doctor", () => {
  const t = "Hola {paciente}, nos vemos el {fecha} a las {hora}. {link}";
  assert.equal(renderReminderTemplate(t, SIN), renderReminderTemplate(t, BASE));
  assert.equal(quitarDoctorDeLaPlantilla(t), t);
});

test("control de ortodoncia sin doctor: su línea y sin la del doctor", () => {
  const t = textoRecordatorioDeCita({ esControl: true, plantillaGeneral: DEFAULT_REMINDER_TEMPLATE, plantillaControl: null, vars: SIN });
  assert.ok(t.startsWith(LINEA_CONTROL_ORTO));
  sinRastroDelDoctor(t);
  const propia = textoRecordatorioDeCita({
    esControl: true,
    plantillaGeneral: DEFAULT_REMINDER_TEMPLATE,
    plantillaControl: "Hola {paciente}, tu control con {doctor} es el {fecha}.",
    vars: SIN,
  });
  assert.match(propia, /tu control con nuestro equipo es el lunes/);
});

test("vista previa de Configuración: la de siempre y la de «Cita sin doctor»", () => {
  const v = previewReminderMessage(DEFAULT_REMINDER_TEMPLATE, { clinica: "Centro Dental QA", fecha: "martes 10 de noviembre" });
  assert.match(v.preview, /Te atiende: Dr\/a\. García/);
  sinRastroDelDoctor(v.previewSinDoctor);
  assert.match(v.previewSinDoctor, /martes 10 de noviembre/);
  assert.deepEqual(v.unknown, []);
});

/* ═══════════════ 3 · Correo ═══════════════ */

test("correo del recordatorio sin doctor: sin la fila 👨‍⚕️; con doctor, la fila de siempre", () => {
  const base = { clinicName: "Centro Dental QA", patientName: "María", fecha: "lunes", hora: "10:00", confirmUrl: LINK, message: "Hola" };
  const sin = buildAppointmentReminderEmail({ ...base, doctorName: null });
  assert.doesNotMatch(sin.html, /👨‍⚕️/);
  assert.doesNotMatch(sin.html, /null|undefined/);
  const con = buildAppointmentReminderEmail({ ...base, doctorName: "Dr/a. Luis Ruiz" });
  assert.match(con.html, /👨‍⚕️ <strong style="color: #f5f5f7;">Dr\/a\. Luis Ruiz<\/strong>/);
});

/* ═══════════════ 4 · Plantillas de Meta: {{5}} nunca vacío ═══════════════ */

test("las plantillas aprobadas por Meta NO cambian: mismo texto y 5 variables", () => {
  const por = (kind: string) => WA_TEMPLATE_CATALOG.find((e) => e.kind === kind)!;
  assert.equal(
    por("reminder").body,
    "Hola {{1}}, te recordamos tu cita en {{2}} el {{3}} a las {{4}} con {{5}}. Si necesitas cambiarla, respóndenos por aquí.",
  );
  assert.equal(por("booking").body, "Hola {{1}}, tu cita en {{2}} quedó registrada para el {{3}} a las {{4}} con {{5}}. Te esperamos.");
  assert.equal(
    por("appointment_change").body,
    "Hola {{1}}, tu cita en {{2}} cambió al {{3}} a las {{4}} con {{5}}. Si no te queda bien, escríbenos por aquí.",
  );
  for (const k of ["reminder", "booking", "appointment_change"]) assert.equal(countTemplateVariables(por(k).body), 5, k);
});

test("cola (plantilla de la fila): sin doctor {{5}} = «nuestro equipo», con doctor el de siempre; nunca vacío", () => {
  const fila = { type: "APPT_AUTO", startsAt: new Date("2026-11-10T16:00:00Z"), firstName: "María", clinicName: "Centro Dental QA", timezone: "America/Mexico_City" };
  const sin = plantillaDeFila({ ...fila, doctor: null });
  assert.equal(sin.kind, "reminder");
  assert.equal(sin.params!.length, 5);
  assert.ok(sin.params!.every((p) => p.trim().length > 0), JSON.stringify(sin.params));
  assert.equal(sin.params![4], "nuestro equipo");
  const con = plantillaDeFila({ ...fila, doctor: { firstName: "Luis", lastName: "Ruiz" } });
  assert.equal(con.params![4], "Dr/a. Luis Ruiz");
  assert.equal(doctorParaPlantilla(undefined), "nuestro equipo");
});

test("avisos de agendada / reprogramada: 5 datos, ninguno vacío; cancelada con sus 4", () => {
  const v = { paciente: "María", clinica: "Centro Dental QA", fecha: "lunes", hora: "10:00", doctor: doctorParaPlantilla(null) };
  for (const e of ["agendada", "reprogramada"] as const) {
    const p = paramsDeAvisoCita(e, v);
    assert.equal(p.length, countTemplateVariables(WA_TEMPLATE_CATALOG.find((x) => x.kind === kindDeAvisoCita(e))!.body));
    assert.ok(p.every((x) => x.trim()), JSON.stringify(p));
  }
  assert.equal(paramsDeAvisoCita("cancelada", v).length, 4);
  // La resolución de una solicitud del portal (reagendado aprobado) usa la misma.
  const r = envioDeResolucion({ status: "APPROVED", type: "RESCHEDULE" } as any, v);
  assert.equal((r.templateParams ?? []).length, 5);
  assert.ok((r.templateParams ?? []).every((x) => x.trim()));
});

test("aviso por WhatsApp (texto libre) de una cita sin doctor: sin «Te atiende»", async () => {
  const { textoAvisoCita } = await import("@/lib/whatsapp/avisos-cita");
  const v = { paciente: "María", clinica: "Centro Dental QA", fecha: "lunes", hora: "10:00", contacto: "999 111 2222" };
  for (const e of ["agendada", "reprogramada"] as const) {
    const sin = textoAvisoCita(e, { ...v, doctor: null });
    assert.doesNotMatch(sin, /Te atiende|undefined|null/, sin);
    assert.doesNotMatch(sin, /\n\n\n/, sin);
    const con = textoAvisoCita(e, { ...v, doctor: "Dr/a. Luis Ruiz" });
    assert.match(con, /Te atiende:\*? Dr\/a\. Luis Ruiz/);
  }
  // Con doctor, el texto de agendada es el de siempre, letra por letra.
  assert.equal(
    textoAvisoCita("agendada", { ...v, doctor: "Dr/a. Luis Ruiz" }),
    "✅ *Cita agendada en Centro Dental QA*\n\nHola María, tu cita quedó registrada:\n📅 *Fecha:* lunes\n🕐 *Hora:* 10:00\n👨‍⚕️ *Te atiende:* Dr/a. Luis Ruiz\n\nPara cambios o cancelaciones contáctanos 999 111 2222.",
  );
});

test("la cola: {doctorName} de una fila de una cita «Sin doctor» no deja «Dr/a.» suelto", async () => {
  const { renderMessage } = await import("@/lib/whatsapp/queue-worker");
  const base = {
    payload: null,
    patient: { firstName: "María", lastName: "G", phone: "+5215511112222" },
    clinic: { id: "c1", name: "Centro Dental QA", timezone: "America/Mexico_City", waPhoneNumberId: "x", waAccessToken: "x" },
    appointmentStartsAt: null,
  };
  const sin = renderMessage({ ...base, rawMessage: "Hola María, nos vemos pronto.\n— {doctorName}", doctorName: null, citaSinDoctor: true });
  assert.equal(sin, "Hola María, nos vemos pronto.");
  const frase = renderMessage({ ...base, rawMessage: "Te espera {doctorName} en {clinicName}.", doctorName: null, citaSinDoctor: true });
  assert.equal(frase, "Te espera nuestro equipo en Centro Dental QA.");
  const con = renderMessage({ ...base, rawMessage: "— {doctorName}", doctorName: "Luis Ruiz" });
  assert.equal(con, "— Dr/a. Luis Ruiz");
});

test("🔴 la cola: una fila SIN cita (mantenimiento periodontal, progreso de ortodoncia) firma como siempre «tu doctor/a» (revisión M1)", async () => {
  const { renderMessage } = await import("@/lib/whatsapp/queue-worker");
  const base = {
    payload: { months: 6 },
    patient: { firstName: "María", lastName: "G", phone: "+5215511112222" },
    clinic: { id: "c1", name: "Centro Dental QA", timezone: "America/Mexico_City", waPhoneNumberId: "x", waAccessToken: "x" },
    appointmentStartsAt: null,
    doctorName: null,
  };
  const perio = renderMessage({ ...base, rawMessage: "PERIO_PRE_MAINTENANCE" });
  assert.ok(perio, "el cuerpo no queda vacío");
  assert.match(perio!, /— tu doctor\/a$/, perio!);
  const orto = renderMessage({ ...base, rawMessage: "ORTHO_MONTHLY_PROGRESS", payload: { monthInTreatment: 3, phaseLabel: "alineación" } });
  assert.ok(orto && orto.length > 0, "nunca FAILED por cuerpo vacío");
  assert.match(orto!, /tu doctor\/a/);
});

/* ═══════════════ 5 · Constancia y huecos ═══════════════ */

test("la constancia de asistencia no se emite sin doctor (no hay nombre ni cédula que poner)", () => {
  const cita = {
    status: "COMPLETED", motivo: "Limpieza",
    startsAt: new Date("2026-10-03T16:00:00Z"), endsAt: new Date("2026-10-03T16:30:00Z"),
    checkedInAt: new Date("2026-10-03T15:55:00Z"), startedAt: new Date("2026-10-03T16:00:00Z"), completedAt: new Date("2026-10-03T16:30:00Z"),
  };
  const ahora = new Date("2026-10-03T18:00:00Z");
  assert.equal(motivoSinConstancia(cita, "America/Mexico_City", ahora), null, "con doctor, como siempre");
  assert.equal(motivoSinConstancia({ ...cita, sinDoctor: true }, "America/Mexico_City", ahora), "SIN_DOCTOR");
  assert.match(MENSAJE_SIN_CONSTANCIA.SIN_DOCTOR, /Asigna el doctor/);
});

test("portal: contra qué choca un hueco — el doctor; sin doctor, su sillón; sin nada, con nada", () => {
  assert.deepEqual(quienOcupaElHueco("clx9doc0a000108l4aaaa0001", "res_sillon_1"), { doctorId: "clx9doc0a000108l4aaaa0001" });
  assert.deepEqual(quienOcupaElHueco(null, "res_sillon_1"), { resourceId: "res_sillon_1" });
  assert.equal(quienOcupaElHueco(null, null), null, "nunca `{ doctorId: null }` (IS NULL empataría con todas las «Sin doctor»)");
});

/* ═══════════════ v2 · m3: el portal no promete «al instante» ═══════════════ */

test("v2 · m3 (revisión t12): reagendar una «Sin doctor» no se anuncia como «al instante» en el portal; cancelar sigue la política", async () => {
  const { reagendarSeAutoAprueba } = await import("@/lib/patient-portal/auto-aprobado");
  assert.equal(reagendarSeAutoAprueba(true, { doctorName: null }), false, "Sin doctor: siempre solicitud (D6)");
  assert.equal(reagendarSeAutoAprueba(true, { doctorName: "Luis Ruiz" }), true, "con doctor, como siempre");
  assert.equal(reagendarSeAutoAprueba(false, { doctorName: "Luis Ruiz" }), false);
  const { readFileSync } = await import("node:fs");
  const pagina = readFileSync(new URL("../../../app/paciente/(panel)/citas/page.tsx", import.meta.url), "utf8");
  const reagendar = pagina.slice(pagina.indexOf("<ReagendarModal"), pagina.indexOf("/>", pagina.indexOf("<ReagendarModal")));
  const cancelar = pagina.slice(pagina.indexOf("<CancelarModal"), pagina.indexOf("/>", pagina.indexOf("<CancelarModal")));
  assert.match(reagendar, /autoApprove=\{reagendarSeAutoAprueba\(selAutoApprove, sel\.cita\)\}/);
  assert.match(cancelar, /autoApprove=\{selAutoApprove\}/, "cancelar no depende del doctor");
});
