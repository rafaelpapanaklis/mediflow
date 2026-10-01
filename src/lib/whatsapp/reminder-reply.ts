// Clasificación PURA de la respuesta del paciente a un recordatorio de cita.
// Importa solo los parsers puros de booking-parse (sin Prisma), así el webhook
// y los tests comparten exactamente la misma lógica.
//
// ws1-t3 (auditoría del bot, #1 BLOQUEA): antes cancelaba CUALQUIER frase con
// «no», «otro/otra» o «ya no» dentro («¿no tienen estacionamiento?» → cita
// cancelada, hueco liberado y «❌ Tu cita ha sido cancelada»). Cancelar de más
// no se deshace, así que ahora:
//   · cancel      — solo una intención CLARA: el verbo cancelar/anular sin
//                   negar y sin ser pregunta, o «2» exacto (contrato legacy).
//   · ask_cancel  — suena a que no va («no», «no puedo ir», «mejor no») o
//                   PREGUNTA por cancelar: el webhook pide que escriba CANCELAR.
//   · reschedule  — quiere moverla: pasa al flujo de agenda del bot.
//   · question    — una pregunta normal: pasa al bot (#15), no «no te entendí».
//   · confirm     — igual que antes (tolera erratas vía hasConfirmStem).
//   · none        — nada de lo anterior.

import { detectaIntencionDeAgenda, foldAccents, isAffirmative } from "./bot/booking-parse";

export type ReminderReply = "confirm" | "cancel" | "ask_cancel" | "reschedule" | "question" | "none";

/** Palabras de la respuesta, sin acentos ni puntuación. */
function palabras(folded: string): string[] {
  return folded.split(/[^a-z0-9ñ]+/).filter(Boolean);
}

// Verbo cancelar/anular en sus formas reales («cancélala», «cancelen», «anulen»).
// Lista CERRADA a propósito: sin tolerancia a erratas («cancelarr», «canselar»
// caen en «no te entendí»; cancelar de más no se deshace).
const VERBO_CANCELAR =
  /\b(cancel(ar|arla|arlo|a|ala|alo|o|e|en|enla|enlo|ada|ado|acion|ame|amela)|anul(ar|arla|a|ala|en|enla|e|o))\b/;
// «no» (o «sin») hasta cuatro palabras antes del verbo, SIN puntuación en medio:
// «no la cancelen» niega; «No, cancélala» no (la coma corta la negación).
const CANCELAR_NEGADO = /\b(no|sin|nunca)\s+([a-z0-9ñ]+\s+){0,4}?(cancel|anul)/;

const PREGUNTA_INICIO =
  /^(que|cual|cuales|donde|cuando|como|cuanto|cuanta|cuantos|cuantas|quien|quienes|por que|porque|puedo|podria|se puede|tienen|hay|aceptan|necesito|debo|a que|en que|de que|me pueden|me podrian)\b/;

/** ¿El paciente está PREGUNTANDO algo? */
export function esPregunta(folded: string): boolean {
  if (/[?¿]/.test(folded)) return true;
  return PREGUNTA_INICIO.test(folded.replace(/^[^a-z0-9]+/, ""));
}

// Quiere mover la cita. Además de lo que ya reconoce el bot (detectaIntencionDeAgenda),
// «otro día», «otra fecha/hora», «cambiarla/moverla de día».
const REAGENDAR =
  /\b(otro dia|otra fecha|otra hora|otro horario|reagend\w*|reprogram\w*|(cambiar|cambiarla|cambiarme|mover|moverla|recorrer|recorrerla)\s+(\w+\s+)?(de\s+)?(cita|dia|fecha|hora|horario)|(la|me la) (pueden|podemos|puedes|podrian) (cambiar|mover|recorrer))\b/;

// No va a ir, dicho de forma ambigua: se pregunta antes de tocar la cita.
const NO_ASISTE =
  /\b(no (puedo|podre|podremos|voy|vamos|ire|asistire|asistiremos|llego|alcanzo|me va|me queda|me acomoda|creo (que )?(pueda|podre|vaya))|ya no|mejor no|nel|imposible)\b/;

// Frases con «no» que SÍ son afirmativas.
const NO_AFIRMATIVO = /\bno (hay|habra) (problema|bronca|inconveniente)\b|\bno se preocupe\w*\b|\bno te preocupes\b/;

export function classifyReminderReply(text: string): ReminderReply {
  const folded = foldAccents(text);
  const limpio = folded.replace(/[^a-z0-9ñ\s]/g, " ").replace(/\s+/g, " ").trim();
  if (limpio === "1") return "confirm";
  if (limpio === "2") return "cancel";

  const pregunta = esPregunta(folded);
  const tokens = palabras(folded);

  // 1. Cancelar: el verbo, sin negar.
  if (VERBO_CANCELAR.test(folded) && !CANCELAR_NEGADO.test(folded)) {
    // Si además pide otra fecha, gana mover la cita sobre perderla.
    if (REAGENDAR.test(limpio) && !/\b(cancel|anul)\w*\s+(y|e)\b/.test(limpio)) return "reschedule";
    return pregunta ? "ask_cancel" : "cancel";
  }

  // 2. Moverla.
  if (REAGENDAR.test(limpio) || detectaIntencionDeAgenda(text) === "reschedule") return "reschedule";

  // 3. Suena a que no va. Una pregunta con «no» («¿no tienen…?») NO es esto.
  if (!pregunta && !NO_AFIRMATIVO.test(limpio)) {
    if (NO_ASISTE.test(limpio)) return "ask_cancel";
    // «no» suelto o casi suelto: «no», «no gracias».
    if (tokens[0] === "no" && tokens.length <= 2) return "ask_cancel";
  }

  if (pregunta) return "question";

  // 4. Confirmar. Una afirmación con un «no» suelto al lado («no sé, ok») es
  //    ambigua: no se confirma a ciegas.
  if (isAffirmative(folded)) {
    if (tokens.includes("no") && !NO_AFIRMATIVO.test(limpio)) return "none";
    return "confirm";
  }
  return "none";
}

/** ¿Respuesta corta (≤ 3 palabras)? Solo a esas se les pide aclarar. */
export function esRespuestaCorta(text: string): boolean {
  return palabras(foldAccents(text)).length <= 3;
}

/** Ventana en la que un texto corto todavía se lee como respuesta a una encuesta. */
export const VENTANA_ENCUESTA_MS = 48 * 60 * 60 * 1000;

const SALUDO = /^(hola|buen(os|as)? (dias|tardes|noches)|buenas|buen dia|que tal)\b/;

/**
 * #5 — ¿Este texto es la respuesta a la encuesta / aviso sin pregunta que se
 * le mandó (`sentAt`)? Solo si el aviso es RECIENTE (≤ 48 h) y el texto parece
 * una calificación: corto, sin pregunta, sin saludo y sin pedir cita. Todo lo
 * demás va al bot; antes se «comía» cualquier mensaje posterior, sin límite de
 * tiempo («hola, quiero una cita» tres meses después se quedaba sin respuesta).
 */
export function esRespuestaDeEncuesta(text: string, sentAt: Date | null | undefined, now: Date): boolean {
  if (!sentAt) return false;
  const edad = now.getTime() - sentAt.getTime();
  if (edad < 0 || edad > VENTANA_ENCUESTA_MS) return false;
  const folded = foldAccents(text);
  if (!folded) return false;
  if (esPregunta(folded)) return false;
  if (SALUDO.test(folded)) return false;
  if (detectaIntencionDeAgenda(text) !== null) return false;
  return palabras(folded).length <= 6;
}
