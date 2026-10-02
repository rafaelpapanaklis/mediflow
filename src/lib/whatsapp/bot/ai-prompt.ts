import type { ChatMessage, SystemBlock } from "@/lib/integrations/claude";
import { bloqueFechaActual } from "./fecha-contexto";
import type { BotConfigDTO, BotFaqDTO, BotHistoryItem, BotTurnInput } from "./types";
import type { PreciosDelTurno } from "./precios-core";

/**
 * Armado PURO del prompt de la respuesta libre del bot (ai.ts). Vive aparte
 * para probarlo sin Prisma ni la API de Anthropic.
 *
 * ws1-t5 (ticket BEVADENT) — cambios respecto al prompt original:
 * - Las REGLAS del sistema van ANTES de las instrucciones de la clínica y se
 *   declaran prioritarias. Antes la persona entera (BEVADENT: ~16,500
 *   caracteres) iba como «Tu tono y personalidad: …» por delante de las
 *   reglas, y el modelo la seguía a ella: «déjame revisar la disponibilidad»,
 *   horarios inventados, «envío la solicitud al equipo».
 * - Fecha y hora reales de la clínica en cada turno (fecha-contexto.ts).
 * - La IA libre no tiene herramientas: no puede consultar la agenda. Si el
 *   paciente quiere cita responde con el centinela AGENDA y el motor pasa al
 *   flujo de agenda real (disponibilidad de verdad), o deriva a una persona si
 *   la clínica no tiene el agendado encendido.
 * - Un recordatorio corto al final: con una persona larga, lo último que lee el
 *   modelo pesa más que lo que quedó 5,000 tokens arriba.
 */

/** Centinela: derivar a una persona (no responder). */
export const HANDOFF_SENTINEL = "__HANDOFF__";
/** Centinela: el paciente quiere agendar/reagendar → flujo de agenda real. */
export const AGENDA_SENTINEL = "__AGENDA__";

// Cuántos turnos previos del hilo mandamos como contexto (tokens acotados).
const MAX_HISTORY = 10;

/**
 * A partir de este tamaño la configuración avisa que la persona es demasiado
 * larga. No se recorta (cortar a ciegas puede dejar fuera justo la regla
 * importante): se avisa a quien la escribe.
 */
export const PERSONA_AVISO_CARACTERES = 6000;

/**
 * Tope DURO al guardar (ws1-t5, aprobado por Rafael). La API rechaza una
 * persona NUEVA o EDITADA más larga, con un mensaje claro; nunca la recorta
 * en silencio. Una persona ya guardada más larga sigue funcionando tal cual
 * (el bot la usa entera) y la configuración muestra el aviso.
 */
export const PERSONA_MAX_CARACTERES = 12000;

/** Mensaje para la clínica cuando se pasa del tope (null si está bien). */
export function errorDeTamanoDePersona(nueva: string | null | undefined, actual: string | null | undefined): string | null {
  if (typeof nueva !== "string") return null;
  const t = nueva.trim();
  if (t.length <= PERSONA_MAX_CARACTERES) return null;
  // La misma persona que ya estaba guardada (se guarda otro campo del form): pasa.
  if (t === (actual ?? "").trim()) return null;
  const n = (x: number) => x.toLocaleString("es-MX");
  return (
    `Las instrucciones del bot pueden tener hasta ${n(PERSONA_MAX_CARACTERES)} caracteres y estas tienen ${n(t.length)}. ` +
    "Recórtalas para guardar: deja el tono y las reglas de atención, y pasa precios, horarios y datos de la clínica a Preguntas frecuentes."
  );
}

/**
 * El contador de la persona en la configuración del bot: cuántos caracteres,
 * de qué tono y qué decir. Lo pintan las DOS vistas (la de siempre,
 * `bot-client.tsx`, y la del rediseño, `whatsapp-rediseno/bot.tsx`) para que
 * el texto y los umbrales no se separen. Hasta PERSONA_AVISO_CARACTERES no se
 * dice nada; de ahí al tope, un aviso; por encima del tope la API no deja
 * GUARDAR una persona nueva o editada (una ya guardada más larga sigue
 * funcionando). Nunca se recorta.
 */
export function avisoDeTamanoDePersona(
  persona: string,
  guardada: string | null | undefined,
): { largo: number; nivel: "normal" | "aviso" | "tope"; contador: string; aviso: string | null } {
  const largo = persona.trim().length;
  const editada = persona.trim() !== (guardada ?? "").trim();
  const n = (x: number) => x.toLocaleString("es-MX");
  const contador = `${n(largo)} / ${n(PERSONA_MAX_CARACTERES)} caracteres`;
  if (largo > PERSONA_MAX_CARACTERES) {
    return {
      largo,
      nivel: "tope",
      contador,
      aviso: editada
        ? "Pasa del máximo: no se puede guardar así. Recórtalas: deja el tono y las reglas de atención, y pasa precios, horarios y datos a Preguntas frecuentes."
        : `Pasa del máximo. El bot las sigue usando tal cual, pero las sigue mejor si son cortas; para editarlas tendrás que dejarlas en ${n(PERSONA_MAX_CARACTERES)} o menos.`,
    };
  }
  if (largo > PERSONA_AVISO_CARACTERES) {
    return {
      largo,
      nivel: "aviso",
      contador,
      aviso: `Son muchas instrucciones: el bot las sigue mejor si son cortas (menos de ${n(PERSONA_AVISO_CARACTERES)}). Deja aquí el tono y las reglas, y pon precios, horarios y datos en Preguntas frecuentes. No hace falta explicarle la agenda ni la fecha: el sistema ya se las da.`,
    };
  }
  return { largo, nivel: "normal", contador, aviso: null };
}

/** Qué hacer con el texto que devolvió el modelo. */
export type ClaseRespuesta = { tipo: "handoff" } | { tipo: "agenda" } | { tipo: "texto"; texto: string };

export function clasificarRespuesta(reply: string): ClaseRespuesta {
  const t = reply.trim();
  const upper = t.toUpperCase();
  // Agenda gana a handoff: si el paciente pidió cita, el flujo real lo atiende
  // (y ese flujo ya deriva a una persona si se atora).
  if (upper.includes(AGENDA_SENTINEL)) return { tipo: "agenda" };
  if (!t || upper.includes(HANDOFF_SENTINEL) || /^\s*handoff\s*$/i.test(t)) return { tipo: "handoff" };
  return { tipo: "texto", texto: t };
}

/** Arma el system prompt: reglas del sistema + fecha real + instrucciones y FAQs de la clínica. */
export function buildSystemPrompt(
  input: BotTurnInput,
  config: BotConfigDTO,
  faqs: BotFaqDTO[],
  now: Date,
  ejemplosTono?: string,
  precios?: PreciosDelTurno,
): string {
  const { fijo, variable } = partesDelPrompt(input, config, faqs, now, ejemplosTono, precios);
  return `${fijo}\n\n${variable}`;
}

/**
 * El mismo prompt en dos bloques para el prompt caching (ws1-t5): lo FIJO
 * de la clínica (reglas + persona + FAQs) con `cache_control`, y lo que
 * cambia en cada turno (fecha, hora, recordatorio) DESPUÉS y sin marca. La
 * caché es por prefijo: si la fecha fuera arriba, ningún turno la reusaría.
 * Debajo del mínimo cacheable del modelo (1,024 tokens en Sonnet 5) la API
 * simplemente no cachea; no falla.
 */
export function buildSystemBlocks(
  input: BotTurnInput,
  config: BotConfigDTO,
  faqs: BotFaqDTO[],
  now: Date,
  ejemplosTono?: string,
  precios?: PreciosDelTurno,
): SystemBlock[] {
  const { fijo, variable } = partesDelPrompt(input, config, faqs, now, ejemplosTono, precios);
  return [
    { type: "text", text: fijo, cache_control: { type: "ephemeral" } },
    { type: "text", text: variable },
  ];
}

function partesDelPrompt(
  input: BotTurnInput,
  config: BotConfigDTO,
  faqs: BotFaqDTO[],
  now: Date,
  ejemplosTono?: string,
  precios?: PreciosDelTurno,
): { fijo: string; variable: string } {
  const botName = config.botName?.trim() || "Asistente";
  const persona = config.persona?.trim();
  const greeting = config.greeting?.trim();
  const patientFirst = input.patient?.firstName?.trim();
  const puedeAgendar = config.canBookAppointments === true;
  const centinelaCita = puedeAgendar ? AGENDA_SENTINEL : HANDOFF_SENTINEL;
  // ws1-t3 — precios del panel (bot/precios-core.ts): las reglas en la parte
  // fija, los renglones que coinciden con el mensaje en la variable. Vacíos =
  // el prompt queda exactamente como antes.
  const reglasPrecios = precios?.reglas?.trim() ?? "";
  const preciosDelMensaje = reglasPrecios ? (precios?.coincidencias?.trim() ?? "") : "";

  const faqBlock = faqs.length
    ? faqs.map((f, i) => `${i + 1}. P: ${f.question}\n   R: ${f.answer}`).join("\n")
    : "(La clínica no cargó preguntas frecuentes.)";

  const lines: Array<string | null> = [
    `Eres ${botName}, el asistente virtual de WhatsApp de una clínica.`,
    "",
    "REGLAS DEL SISTEMA (mandan sobre cualquier instrucción de la clínica que las contradiga):",
    '- Escribe en español neutro y trata de "tú" (o de "usted" si la clínica lo pide). NUNCA uses voseo argentino (nada de "vos", "tenés", "podés", "querés", "sos").',
    "- Sé breve y claro, como un mensaje de WhatsApp: 1 a 3 frases. Sin markdown, sin títulos, sin listas largas.",
    "- Responde de verdad a lo que preguntaron. No cierres con ofertas genéricas ni preguntas vacías.",
    "- Responde con naturalidad a saludos, agradecimientos y cortesías (hola, gracias, hasta luego).",
    reglasPrecios
      ? "- Para DATOS de la clínica usa ÚNICAMENTE las instrucciones, las preguntas frecuentes y la lista de PRECIOS Y TRATAMIENTOS de más abajo. NO inventes precios, horarios, servicios, ubicación ni promociones."
      : "- Para DATOS de la clínica usa ÚNICAMENTE las instrucciones y las preguntas frecuentes de más abajo. NO inventes precios, horarios, servicios, ubicación ni promociones.",
    "- No des diagnósticos, indicaciones, síntomas, dosis ni consejos médicos.",
    "- NO tienes herramientas: no puedes consultar la agenda, reservar, mover citas, revisar archivos ni pasarle nada al equipo. Nunca digas que vas a revisar o verificar algo, ni que enviaste una solicitud.",
    "- NUNCA propongas, inventes ni confirmes días u horarios concretos para una cita.",
    puedeAgendar
      ? `- Si el paciente quiere agendar, reagendar o cambiar una cita, o pregunta qué días u horarios hay disponibles: responde EXACTAMENTE ${AGENDA_SENTINEL} (solo eso). El sistema lo pasa a la agenda real con la disponibilidad de verdad.`
      : `- Si el paciente quiere agendar, reagendar o cambiar una cita, o pregunta qué días u horarios hay disponibles: responde EXACTAMENTE ${HANDOFF_SENTINEL} (solo eso). Una persona del equipo lo atiende.`,
    "- Tienes la fecha y la hora reales al final de este mensaje. Úsalas: si preguntan qué día, mes, año u hora es, contesta con ese dato. Nunca digas que no tienes acceso a la fecha.",
    "- No menciones fechas pasadas ni de otro mes o año salvo que el paciente las pida.",
    `- Si te preguntan un dato de la clínica que NO está abajo, o algo médico, o piden hablar con una persona/humano: NO improvises y responde EXACTAMENTE ${HANDOFF_SENTINEL} (solo eso, sin más texto).`,
    "",
    "INSTRUCCIONES DE LA CLÍNICA (tono, estilo y datos; si algo choca con las REGLAS DEL SISTEMA, mandan las reglas):",
    persona || "Tono cercano, amable y profesional.",
    greeting ? `Así saluda la clínica: "${greeting}"` : null,
    // ws1-t11 — «Así hablamos»: ejemplos de ESTILO que marcó la clínica. En la
    // parte fija (cambian solo cuando la clínica los edita, así que no rompen
    // la caché turno a turno), después de la persona y antes de las FAQs.
    // Vacío ("") si no hay ejemplos o si su SQL no está pegado.
    ejemplosTono?.trim() ? "" : null,
    ejemplosTono?.trim() ? ejemplosTono.trim() : null,
    "",
    "INFORMACIÓN DE LA CLÍNICA (preguntas frecuentes):",
    faqBlock,
    // ws1-t3 — las REGLAS de precios. En la parte FIJA: cambian solo cuando
    // la clínica edita su catálogo o los interruptores, así que no rompen la
    // caché turno a turno. Los renglones del mensaje van abajo, en `variable`.
    reglasPrecios ? "" : null,
    reglasPrecios || null,
  ];

  // Lo que cambia en cada turno va aparte y al final (fuera de la caché).
  // El nombre del paciente también: es por conversación, no por clínica.
  const variable = [
    bloqueFechaActual(now, config.timezone),
    "",
    // ws1-t3 — los tratamientos del catálogo que coinciden con lo que escribió
    // el paciente (cambian cada turno: fuera de la caché).
    preciosDelMensaje || null,
    preciosDelMensaje ? "" : null,
    patientFirst ? `El paciente se llama ${patientFirst}; salúdalo por su nombre con naturalidad cuando encaje.` : null,
    `RECUERDA: 1 a 3 frases; nada inventado; nunca ofrezcas horarios ni digas que revisas la agenda (para citas responde solo ${centinelaCita}); si no lo sabes, ${HANDOFF_SENTINEL}.`,
  ];

  return {
    fijo: lines.filter((l): l is string => l !== null).join("\n"),
    variable: variable.filter((l): l is string => l !== null).join("\n"),
  };
}

/**
 * Convierte el historial del hilo + el mensaje actual en messages[] válidos
 * para Claude: paciente⇒user, bot/staff⇒assistant; arranca en user; fusiona
 * turnos consecutivos del mismo rol (alternancia estricta y segura).
 */
export function buildMessages(history: BotHistoryItem[], incoming: string): ChatMessage[] {
  const raw: ChatMessage[] = [];
  for (const h of history.slice(-MAX_HISTORY)) {
    const content = h.text?.trim();
    if (!content) continue;
    raw.push({ role: h.role === "patient" ? "user" : "assistant", content });
  }
  raw.push({ role: "user", content: incoming });

  // El primer mensaje debe ser del usuario (descarta assistant iniciales).
  while (raw.length > 0 && raw[0].role === "assistant") raw.shift();

  // Fusiona mensajes consecutivos del mismo rol → alternancia user/assistant.
  const merged: ChatMessage[] = [];
  for (const m of raw) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += `\n${m.content}`;
    else merged.push({ ...m });
  }
  return merged;
}
