// ═══════════════════════════════════════════════════════════════════════════
// Ortodoncia — las «Plantillas de mensaje» de Configuración, conectadas
// (ws1-t5, ronda 6 · fila 28 de la revisión de uso).
//
// Antes la clínica redactaba aquí sus dos mensajes, se guardaban, y ningún
// envío los leía: el paciente recibía el texto fijo. Ahora:
//
//   · «Recordatorio de control» → es el texto del recordatorio automático de
//     cita (src/lib/reminders/enqueue.ts) cuando la cita es un control de
//     ortodoncia. Vacío = el recordatorio general de la clínica con la línea
//     «Este es el recordatorio de tu control de ortodoncia».
//   · «Aviso de mensualidad vencida» → es el texto del botón «Recordar» de
//     Alertas y Cobranza (sendMensualidadReminder) cuando el caso tiene
//     mensualidades vencidas, y también lo que copia «Copiar texto». Vacío =
//     el texto de siempre (mensaje-mensualidad.ts).
//
// El aviso AUTOMÁTICO de mensualidad POR VENCER no sale de aquí: se redacta en
// Configuración → WhatsApp → Mensualidades (reminderSettings.cobranza). La
// pantalla lo dice para que nadie busque ese texto en dos sitios.
//
// PURO: sin Prisma, sin fetch, sin React (reminders/config también lo es).
// ═══════════════════════════════════════════════════════════════════════════

import { renderReminderTemplate, type ReminderTemplateVars } from "@/lib/reminders/config";

export const CLAVE_RECORDATORIO_CONTROL = "recordatorioControl";
export const CLAVE_MENSUALIDAD_VENCIDA = "avisoMensualidadVencida";

export type ClavePlantillaOrto = typeof CLAVE_RECORDATORIO_CONTROL | typeof CLAVE_MENSUALIDAD_VENCIDA;

/** Tope de caracteres: un WhatsApp de texto, no una carta. */
export const MAX_PLANTILLA = 1500;

export interface DefinicionPlantilla {
  clave: ClavePlantillaOrto;
  etiqueta: string;
  /** Dónde se usa, con las palabras de la pantalla. */
  ayuda: string;
  /** Variables que el envío sabe sustituir (sin llaves). */
  variables: readonly string[];
  /** Lo que sale si la clínica deja el campo vacío. */
  ejemplo: string;
}

export const PLANTILLAS_ORTO: readonly DefinicionPlantilla[] = [
  {
    clave: CLAVE_RECORDATORIO_CONTROL,
    etiqueta: "Recordatorio de control",
    ayuda:
      "Es el recordatorio automático de cita cuando la cita es un control de ortodoncia. Sale en los momentos que elegiste en Configuración → WhatsApp → Recordatorios. Si no escribes {link}, el enlace para confirmar se agrega al final.",
    variables: ["paciente", "fecha", "hora", "clinica", "doctor", "link"],
    ejemplo:
      "Hola {paciente}, te esperamos en tu control de ortodoncia el {fecha} a las {hora} en {clinica}. Confirma aquí: {link}",
  },
  {
    clave: CLAVE_MENSUALIDAD_VENCIDA,
    etiqueta: "Aviso de mensualidad vencida",
    ayuda:
      "Es el mensaje del botón «Recordar» de Alertas y Cobranza cuando el caso tiene mensualidades vencidas, y lo que copia «Copiar texto». {monto} es el total vencido y {fecha} el vencimiento más antiguo.",
    variables: ["paciente", "monto", "fecha", "clinica"],
    ejemplo:
      "Hola {paciente}, tu mensualidad de {monto} de tu tratamiento en {clinica} venció el {fecha}. Escríbenos para coordinar tu pago.",
  },
];

export function definicionDePlantilla(clave: string): DefinicionPlantilla | null {
  return PLANTILLAS_ORTO.find((p) => p.clave === clave) ?? null;
}

/**
 * La plantilla que guardó la clínica, o `null` si no guardó nada que sirva
 * (no hay fila, no es texto, está vacía o son solo espacios).
 */
export function plantillaGuardada(templates: unknown, clave: ClavePlantillaOrto): string | null {
  if (!templates || typeof templates !== "object" || Array.isArray(templates)) return null;
  const valor = (templates as Record<string, unknown>)[clave];
  if (typeof valor !== "string") return null;
  const limpio = valor.trim();
  return limpio ? limpio.slice(0, MAX_PLANTILLA) : null;
}

/** Las variables `{asi}` que aparecen en un texto, sin repetir. */
export function variablesUsadas(texto: string): string[] {
  const vistas = new Set<string>();
  for (const m of texto.matchAll(/\{([^{}\s]+)\}/g)) vistas.add(m[1]);
  return [...vistas];
}

/**
 * Por qué no se puede guardar esta plantilla, o `null` si está bien. Lo
 * aplican la pantalla y el servidor: una variable mal escrita ({nombre},
 * {importe}) le llegaría al paciente tal cual, con todo y llaves.
 */
export function motivoDeRechazoDePlantilla(clave: string, texto: string): string | null {
  const def = definicionDePlantilla(clave);
  if (!def) return null;
  const limpio = texto.trim();
  if (!limpio) return null;
  if (limpio.length > MAX_PLANTILLA) {
    return `«${def.etiqueta}» pasa de ${MAX_PLANTILLA} caracteres. Acórtalo.`;
  }
  const desconocidas = variablesUsadas(limpio).filter((v) => !def.variables.includes(v));
  if (desconocidas.length > 0) {
    const lista = desconocidas.map((v) => `{${v}}`).join(", ");
    const validas = def.variables.map((v) => `{${v}}`).join(", ");
    return `«${def.etiqueta}» usa ${lista}, que no existe. Las variables de este mensaje son: ${validas}.`;
  }
  return null;
}

/**
 * La plantilla que de verdad se puede MANDAR: la guardada, siempre que pase
 * la validación. Una plantilla vieja con una variable mal escrita (se guardó
 * antes de que existiera la validación) no se manda con las llaves a la
 * vista: el envío cae al texto por defecto hasta que la clínica la corrija.
 */
export function plantillaUsable(templates: unknown, clave: ClavePlantillaOrto): string | null {
  const guardada = plantillaGuardada(templates, clave);
  if (!guardada) return null;
  return motivoDeRechazoDePlantilla(clave, guardada) ? null : guardada;
}

/** El primer rechazo entre todas las plantillas que manda la pantalla. */
export function motivoDeRechazoDePlantillas(templates: Record<string, string>): string | null {
  for (const def of PLANTILLAS_ORTO) {
    const rechazo = motivoDeRechazoDePlantilla(def.clave, templates[def.clave] ?? "");
    if (rechazo) return rechazo;
  }
  return null;
}

/**
 * Lo que se guarda: solo las claves conocidas, recortadas, y sin las vacías
 * (vacío = «usa el texto por defecto», y así no queda una cadena de espacios
 * que parezca una plantilla).
 */
export function normalizarPlantillas(templates: Record<string, string>): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const def of PLANTILLAS_ORTO) {
    const valor = plantillaGuardada(templates, def.clave);
    if (valor) salida[def.clave] = valor;
  }
  return salida;
}

export interface DatosAvisoVencida {
  paciente: string;
  clinica: string;
  /** Ya formateado: «$1,000». */
  monto: string;
  /** Ya en palabras: «5 de marzo». */
  fecha: string;
}

/** El aviso de mensualidad vencida con la redacción de la clínica. */
export function renderAvisoMensualidadVencida(plantilla: string, d: DatosAvisoVencida): string {
  return plantilla
    .replaceAll("{paciente}", d.paciente)
    .replaceAll("{clinica}", d.clinica)
    .replaceAll("{monto}", d.monto)
    .replaceAll("{fecha}", d.fecha)
    .trim();
}

/** La línea que distingue un control cuando la clínica no redactó su plantilla. */
export const LINEA_CONTROL_ORTO = "🦷 Este es el recordatorio de tu *control de ortodoncia*.";

/**
 * El texto del recordatorio automático de una cita.
 *   · Cita normal → la plantilla general de la clínica, tal cual.
 *   · Control con plantilla propia de Ortodoncia → esa redacción, con las
 *     mismas variables; si no trae {link}, el enlace se agrega al final.
 *   · Control sin plantilla propia → la general con la línea del control.
 */
export function textoRecordatorioDeCita(args: {
  esControl: boolean;
  plantillaGeneral: string;
  plantillaControl: string | null;
  vars: ReminderTemplateVars;
}): string {
  const { esControl, plantillaGeneral, plantillaControl, vars } = args;
  if (esControl && plantillaControl) return renderReminderTemplate(plantillaControl, vars);
  const general = renderReminderTemplate(plantillaGeneral, vars);
  return esControl ? `${LINEA_CONTROL_ORTO}\n\n${general}` : general;
}
