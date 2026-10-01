/**
 * Ejemplos de tono (ws1-t11): respuestas del equipo que la clínica marcó como
 * «así hablamos». Se le pasan al bot como ejemplos de ESTILO, no de contenido.
 *
 * PURO. El servicio guarda los textos ya anonimizados; aquí solo se arma el
 * bloque para el prompt. El enganche en `buildSystemPrompt` (bot/ai-prompt.ts)
 * lo hace la pantalla de la IA: va en la parte FIJA del system (cacheable),
 * después de la persona.
 */
import { motivoClinico, motivoPersonal, tieneMarcadores } from "./anonimizar";

/** Tope de ejemplos activos por clínica (decisión del gerente: ~5–8). */
export const MAX_EJEMPLOS_TONO = 8;
/** Un ejemplo de tono es un mensaje corto de WhatsApp, no un párrafo. */
export const MAX_CARACTERES_EJEMPLO = 280;
export const MIN_CARACTERES_EJEMPLO = 12;

export type MotivoTonoNoApto = "clinico" | "personal" | "corto" | "largo";

export const ETIQUETA_TONO_NO_APTO: Record<MotivoTonoNoApto, string> = {
  clinico: "Habla de la salud de un paciente",
  personal: "Es sobre el caso de un paciente",
  corto: "Muy corto para mostrar un estilo",
  largo: `Muy largo (máximo ${MAX_CARACTERES_EJEMPLO} caracteres)`,
};

/** ¿Este texto (ya anonimizado) puede ser ejemplo de tono? null = sí. */
export function motivoTonoNoApto(texto: string): MotivoTonoNoApto | null {
  const t = texto.trim();
  if (motivoClinico(t)) return "clinico";
  if (motivoPersonal(t)) return "personal";
  if (t.length < MIN_CARACTERES_EJEMPLO) return "corto";
  if (t.length > MAX_CARACTERES_EJEMPLO) return "largo";
  return null;
}

/**
 * El bloque para el system prompt, o "" si no hay ejemplos. Los marcadores
 * del anonimizado ([nombre]…) se dejan: le dicen al modelo que ahí iba un dato
 * y que no debe inventarlo.
 */
export function bloqueEjemplosDeTono(textos: string[]): string {
  const limpios = textos
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 0)
    .slice(0, MAX_EJEMPLOS_TONO);
  if (limpios.length === 0) return "";
  const lineas = limpios.map((t) => `- «${t}»`);
  const conMarcadores = limpios.some(tieneMarcadores);
  return [
    "EJEMPLOS DE TONO DE LA CLÍNICA",
    "Así le escribe el equipo a sus pacientes. Imita el ESTILO (saludo, trato de tú o de usted, largo de los mensajes, emojis), no el contenido: no repitas datos, precios ni promesas de estos ejemplos.",
    ...(conMarcadores ? ["Lo que va entre corchetes ([nombre], [fecha]…) es un dato quitado por privacidad: nunca lo inventes."] : []),
    ...lineas,
  ].join("\n");
}
