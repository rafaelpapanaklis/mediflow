// ws1-t3 (auditoría del bot, #1 BLOQUEA, #5 y #15) — qué hace la respuesta del
// paciente a un recordatorio de cita.
//
// El fallo que esto protege: con el clasificador anterior CUALQUIER «no»,
// «otro/otra» o «ya no» dentro de una frase cancelaba la cita al instante
// («¿no tienen estacionamiento?» → «❌ Tu cita ha sido cancelada»). Ahora solo
// cancela una intención CLARA; lo negativo pero ambiguo pide confirmación, una
// pregunta pasa al bot y reagendar va al flujo de agenda.
//
// Correr: npm run test:wa-reminder-intencion

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyReminderReply, esRespuestaDeEncuesta } from "../reminder-reply";
import { resolveReminderReply } from "../reminder-pick";
import { APPT_AUTO_TYPE } from "../../reminders/config";

const asWebhook = (raw: string): string => raw.trim().toLowerCase();
const c = (raw: string) => classifyReminderReply(asWebhook(raw));

describe("#1 — una frase con «no» ya NO cancela la cita", () => {
  it("los casos exactos de la auditoría no cancelan", () => {
    for (const raw of [
      "¿no tienen estacionamiento?",
      "no sé dónde queda",
      "¿puedo llevar a mi hijo? no tengo con quién dejarlo",
      "confirmo pero no a esa hora",
      "no, sí voy",
      "¿puedo llevar a otra persona?",
      "ya no me duele pero sí voy",
      "no me va a dar tiempo de comer antes, ¿importa?",
    ]) {
      assert.notEqual(c(raw), "cancel", `texto: "${raw}"`);
    }
  });

  it("una intención clara SÍ cancela", () => {
    for (const raw of [
      "cancelar", "CANCELAR", "Cancelar por favor", "cancela mi cita", "quiero cancelar mi cita",
      "cancélenla por favor", "no voy a poder ir, cancela por favor", "No, cancélala", "2",
    ]) {
      assert.equal(c(raw), "cancel", `texto: "${raw}"`);
    }
  });

  it("cancelar negado no cancela", () => {
    for (const raw of ["no la cancelen", "no quiero cancelar", "no cancelo, sí voy", "no me la vayan a cancelar"]) {
      assert.notEqual(c(raw), "cancel", `texto: "${raw}"`);
    }
  });

  it("«no» suelto o «no puedo ir» → se pregunta antes de cancelar", () => {
    for (const raw of ["no", "No.", "nel", "mejor no", "no puedo ir", "no voy a poder asistir", "ya no voy", "no podré", "no me va", "no puedo confirmar"]) {
      assert.equal(c(raw), "ask_cancel", `texto: "${raw}"`);
    }
  });

  it("una pregunta que menciona cancelar también se pregunta, no se ejecuta", () => {
    assert.equal(c("¿puedo cancelar mi cita?"), "ask_cancel");
    assert.equal(c("¿cómo cancelo?"), "ask_cancel");
  });

  it("reagendar es su propia intención y nunca cancela", () => {
    for (const raw of [
      "quiero reagendar", "¿la puedo reprogramar?", "no puedo ir, ¿podemos cambiar la cita?",
      "mejor otro día", "¿me la pueden mover de día?", "no la cancelen, quiero cambiarla de fecha",
    ]) {
      assert.equal(c(raw), "reschedule", `texto: "${raw}"`);
    }
  });

  it("confirmar sigue funcionando igual", () => {
    for (const raw of ["1", "confirmo", "sí", "Sí, confirmo", "ok", "va", "Confirmarr", "sí, no hay problema", "sí voy pero llego tarde"]) {
      assert.equal(c(raw), "confirm", `texto: "${raw}"`);
    }
  });

  it("una afirmación con negación en medio no confirma a ciegas", () => {
    assert.notEqual(c("no me va"), "confirm");
    assert.notEqual(c("no sé, ok"), "confirm");
  });
});

describe("#15 — una pregunta con recordatorio pendiente pasa al bot", () => {
  it("preguntas normales clasifican como «question»", () => {
    for (const raw of [
      "¿dónde están?", "¿no tienen estacionamiento?", "cuánto cuesta la limpieza", "¿a qué hora abren?",
      "qué necesito llevar", "¿puedo llevar a mi hijo? no tengo con quién dejarlo",
    ]) {
      assert.equal(c(raw), "question", `texto: "${raw}"`);
    }
  });

  it("solo un texto CORTO que no se entiende pide aclarar", () => {
    const cita = [{ id: "a", type: APPT_AUTO_TYPE, appointment: { status: "SCHEDULED" } }];
    assert.equal(resolveReminderReply(cita, "canselar").unclear, true);
    assert.equal(resolveReminderReply(cita, "¿dónde están?").unclear, false);
    assert.equal(resolveReminderReply(cita, "voy con mi mamá y mi hermano, llegamos juntos").unclear, false);
  });
});

describe("#5 — un aviso que no pedía nada no se «come» el siguiente mensaje", () => {
  const ahora = new Date("2026-10-01T18:00:00Z");
  const hace = (h: number) => new Date(ahora.getTime() - h * 3_600_000);

  it("respuesta corta a una encuesta reciente → es respuesta a la encuesta", () => {
    for (const raw of ["excelente", "todo bien, gracias", "5", "muy buena atención"]) {
      assert.equal(esRespuestaDeEncuesta(asWebhook(raw), hace(3), ahora), true, `texto: "${raw}"`);
    }
  });

  it("encuesta vieja (más de 48 h) → el mensaje va al bot", () => {
    assert.equal(esRespuestaDeEncuesta("excelente", hace(24 * 90), ahora), false);
    assert.equal(esRespuestaDeEncuesta("excelente", null, ahora), false);
  });

  it("saludo, pedir cita o una pregunta → al bot aunque la encuesta sea reciente", () => {
    for (const raw of ["hola", "buenas tardes", "quiero una cita", "hola, quiero agendar otra cita", "¿cuánto cuesta un blanqueamiento?"]) {
      assert.equal(esRespuestaDeEncuesta(asWebhook(raw), hace(3), ahora), false, `texto: "${raw}"`);
    }
  });

  it("un texto largo tampoco se toma como calificación", () => {
    assert.equal(
      esRespuestaDeEncuesta("me quedó una duda sobre el tratamiento que me dejaron hacer en casa", hace(3), ahora),
      false,
    );
  });
});
