// Interruptores de IA por clínica — qué funciones de IA puede usar la clínica.
//
// La config vive en Clinic.aiSettings (Json), con el mismo patrón que
// Clinic.reminderSettings (src/lib/reminders/config.ts): un saneador que acepta
// cualquier cosa y devuelve la forma buena, y valores por defecto cuando falta.
//
// 🔴 TODO ENCENDIDO DE FÁBRICA. Se guarda la lista de lo APAGADO, no la de lo
// encendido: `null`, un Json roto o un id que no existe dejan todo como hoy.
// Una función nueva que se añada al catálogo nace encendida para todas las
// clínicas sin tocar la base. Solo se apaga algo que alguien apagó a propósito.
//
// Este archivo es puro (sin prisma, sin server-only): lo importan la pantalla
// de Saldo IA (cliente) y el lector del servidor (`interruptores.server.ts`),
// que es el que de verdad corta ANTES de llamar a la IA. Esconder el botón no
// frena el gasto; el corte en el servidor sí.

/** De dónde sale el dinero de cada función. Lo que la clínica lee en la pantalla. */
export type GastoIa = "saldo" | "cupo" | "ninguno";

export interface FuncionIa {
  id: string;
  nombre: string;
  gasta: GastoIa;
  /** Qué hace, en una línea, para que se reconozca. */
  queHace: string;
  /** Qué deja de pasar si la apagan: lo que evita que la vuelvan a encender mañana. */
  siLaApagas: string;
}

/**
 * Catálogo CERRADO de lo que se puede apagar. Los ids son los slugs de
 * `AiUsageEvent.feature` / del cupo (`@/lib/ai-tokens`), así el interruptor y
 * el registro del gasto hablan de la misma cosa.
 */
export const FUNCIONES_IA = [
  // ── Saldo IA (monedero prepago) ─────────────────────────────────────────────
  {
    id: "sabina",
    nombre: "Sabina",
    gasta: "saldo",
    queHace: "La asistente del panel que consulta y prepara acciones por ti.",
    siLaApagas: "Sabina deja de contestar en el panel.",
  },
  {
    id: "whatsapp_bot",
    nombre: "Respuesta libre del bot de WhatsApp",
    gasta: "saldo",
    queHace: "Cuando ninguna pregunta frecuente coincide, el bot redacta la respuesta con IA.",
    siLaApagas:
      "El bot sigue agendando y contestando tus preguntas frecuentes; lo demás se pasa a una persona de tu equipo.",
  },
  {
    id: "landing_copy",
    nombre: "Redacción de la página web",
    gasta: "saldo",
    queHace: "Escribe los textos de tu página web a partir de los datos de la clínica.",
    siLaApagas: "Los textos de la página web se escriben a mano.",
  },
  // ── Cupo mensual de IA del plan ─────────────────────────────────────────────
  {
    id: "chat",
    nombre: "Chat del asistente",
    gasta: "cupo",
    queHace: "El chat de IA del panel.",
    siLaApagas: "El chat del asistente deja de responder.",
  },
  {
    id: "xray_analysis",
    nombre: "Análisis de radiografías",
    gasta: "cupo",
    queHace: "Lee la radiografía y sugiere hallazgos.",
    siLaApagas: "Las radiografías se siguen subiendo y viendo, pero sin lectura de IA.",
  },
  {
    id: "dictation",
    nombre: "Dictado por voz",
    gasta: "cupo",
    queHace: "Convierte en texto lo que dictas en la consulta.",
    siLaApagas: "Las notas se escriben a mano.",
  },
  {
    id: "consult_assist",
    nombre: "Análisis de consulta",
    gasta: "cupo",
    queHace: "Resume el expediente y propone hallazgos y plan en la consulta.",
    siLaApagas: "La consulta sigue igual, sin el análisis de IA.",
  },
  {
    id: "contraindications",
    nombre: "Revisión de recetas",
    gasta: "cupo",
    queHace: "Revisa la receta contra alergias, medicamentos y padecimientos del paciente.",
    siLaApagas: "Las recetas se emiten sin la revisión de IA; la revisión queda a cargo del doctor.",
  },
  {
    id: "homeopathy",
    nombre: "Homeopatía",
    gasta: "cupo",
    queHace: "Sugiere remedios a partir de los síntomas de la repertorización.",
    siLaApagas: "La repertorización sigue, sin sugerencias de IA.",
  },
  {
    id: "ai_insight",
    nombre: "Análisis de datos",
    gasta: "cupo",
    queHace: "Explica en palabras lo que muestran tus reportes.",
    siLaApagas: "Los reportes se siguen viendo, sin la explicación de IA.",
  },
  {
    id: "no_show_prediction",
    nombre: "Predicción de inasistencias",
    gasta: "cupo",
    queHace: "Afina con IA el riesgo de que un paciente no llegue a su cita.",
    siLaApagas: "El riesgo se sigue calculando, solo con la regla básica (historial, día y hora).",
  },
  {
    id: "clinic_layout",
    nombre: "Distribución de la clínica",
    gasta: "cupo",
    queHace: "Propone cómo reacomodar las citas del día entre los sillones.",
    siLaApagas: "Las citas se acomodan a mano.",
  },
  // ── No gasta ni saldo ni cupo: lo paga DaleControl ──────────────────────────
  {
    id: "weekly_insights",
    nombre: "Resumen semanal",
    gasta: "ninguno",
    queHace: "Cada semana te deja en las notificaciones un resumen de cómo le fue a la clínica.",
    siLaApagas: "Dejas de recibir el resumen semanal.",
  },
] as const satisfies readonly FuncionIa[];

export type FuncionIaId = (typeof FUNCIONES_IA)[number]["id"];

const IDS: readonly string[] = FUNCIONES_IA.map((f) => f.id);

export function esFuncionIa(id: unknown): id is FuncionIaId {
  return typeof id === "string" && IDS.includes(id);
}

/** Forma guardada en Clinic.aiSettings. */
export interface AiSettings {
  /** Funciones que la clínica apagó a propósito. Lo que no esté aquí, encendido. */
  apagadas: FuncionIaId[];
}

/** Lo que tiene una clínica que nunca tocó nada: todo encendido. */
export const AI_SETTINGS_POR_DEFECTO: AiSettings = { apagadas: [] };

/**
 * Valida/normaliza un aiSettings crudo (Json de la base). NUNCA devuelve null:
 * cualquier cosa que no se entienda cae al defecto, que es TODO ENCENDIDO. Así
 * un Json roto no puede apagar nada por accidente. Los ids desconocidos se
 * descartan y los repetidos se juntan; el orden es el del catálogo.
 */
export function sanitizeAiSettings(raw: unknown): AiSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { apagadas: [] };
  const lista = (raw as Record<string, unknown>).apagadas;
  if (!Array.isArray(lista)) return { apagadas: [] };
  const pedidas = new Set(lista.filter(esFuncionIa));
  return { apagadas: FUNCIONES_IA.map((f) => f.id).filter((id) => pedidas.has(id)) };
}

/** ¿La función está encendida para esta config? Sin config, sí. */
export function funcionIaEncendida(settings: unknown, id: FuncionIaId): boolean {
  return !sanitizeAiSettings(settings).apagadas.includes(id);
}

/** Devuelve la config con una función encendida o apagada. No muta la entrada. */
export function conFuncionIa(settings: unknown, id: FuncionIaId, encendida: boolean): AiSettings {
  const actuales = new Set(sanitizeAiSettings(settings).apagadas);
  if (encendida) actuales.delete(id);
  else actuales.add(id);
  return sanitizeAiSettings({ apagadas: Array.from(actuales) });
}

/** Nombre visible de una función (para mensajes de error). */
export function nombreFuncionIa(id: FuncionIaId): string {
  return FUNCIONES_IA.find((f) => f.id === id)?.nombre ?? id;
}

/**
 * Mensaje que devuelve el servidor cuando la función está apagada. Dice DÓNDE
 * se enciende para que nadie lo tome por una falla.
 */
export function mensajeFuncionIaApagada(id: FuncionIaId): string {
  return `${nombreFuncionIa(id)} está apagada para tu clínica. Un administrador puede encenderla en Saldo de IA → Funciones de IA.`;
}

/** La línea «qué gasta» de cada función, tal como la lee la clínica. */
export const GASTO_IA_TEXTO: Record<GastoIa, string> = {
  saldo: "Gasta tu Saldo de IA (se descuenta en pesos).",
  cupo: "Gasta el cupo mensual de IA incluido en tu plan.",
  ninguno: "No gasta tu Saldo de IA ni tu cupo.",
};

/** Encabezado de cada grupo de la pantalla. */
export const GASTO_IA_GRUPO: Record<GastoIa, string> = {
  saldo: "Gastan tu Saldo de IA",
  cupo: "Gastan el cupo de IA de tu plan",
  ninguno: "No gastan ni saldo ni cupo",
};
