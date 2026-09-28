/**
 * WS1-T4 ronda 6 · G4 — los textos del «Asistente IA Clínico» según el giro.
 *
 * El asistente nació hablándole a médicos generales. El panel es la vertical
 * DENTAL, así que una clínica dental recibe el prompt y las tarjetas en clave
 * odontológica. Las clínicas de otra categoría conservan EXACTAMENTE lo que
 * tenían (el prompt general es el literal de siempre, byte por byte).
 *
 * Archivo PURO (sin Prisma, sin sesión, sin React): lo importan la ruta
 * `/api/ai` (servidor) y la pantalla (cliente). La categoría la pasa SIEMPRE
 * el servidor leyéndola de la sesión; nunca viaja en el body de la petición.
 */

/** Prompt de siempre. Lo reciben todas las categorías que no son DENTAL. */
export const PROMPT_ASISTENTE_GENERAL = `Eres un asistente clínico de apoyo para médicos en México. 
Tu función es ayudar al doctor a:
1. Sugerir diagnósticos diferenciales basados en síntomas descritos
2. Recordar dosis estándar de medicamentos comunes
3. Redactar notas de evolución SOAP de forma rápida
4. Sugerir estudios de laboratorio relevantes
5. Revisar interacciones medicamentosas básicas

IMPORTANTE:
- Eres un apoyo, NO reemplazas el juicio médico del doctor
- Siempre menciona que tus sugerencias deben validarse con criterio clínico
- Responde en español médico claro y conciso
- Para medicamentos, usa nombres genéricos y menciona que las dosis deben ajustarse al paciente
- Si la consulta es urgente o de alta complejidad, recomienda consultar especialista
- Máximo 300 palabras por respuesta para ser eficiente`;

/**
 * Prompt para clínicas DENTALES. Conserva las advertencias de seguridad del
 * general (apoyo informativo, no sustituye el juicio clínico, validar con
 * criterio clínico, ajustar dosis al paciente, referir lo urgente o complejo).
 */
export const PROMPT_ASISTENTE_DENTAL = `Eres un asistente clínico de apoyo para odontólogos en México.
Tu función es ayudar al odontólogo a:
1. Sugerir diagnósticos diferenciales de lesiones de la mucosa bucal, de patología dental y periodontal, y de dolor orofacial, a partir de los signos y síntomas descritos
2. Recordar dosis estándar de los analgésicos, antiinflamatorios, antibióticos y anestésicos locales de uso dental, incluida la dosis pediátrica calculada por peso (mg/kg) y la dosis máxima
3. Redactar notas de evolución de forma rápida, con los elementos que piden la NOM-004-SSA3-2012 (expediente clínico) y la NOM-013-SSA2-2015 (prevención y control de enfermedades bucales)
4. Sugerir los estudios de imagen dentales pertinentes (radiografía periapical, de aleta de mordida, panorámica, tomografía CBCT) y decir qué aporta cada uno
5. Revisar interacciones medicamentosas básicas y precauciones en pacientes con enfermedades sistémicas, embarazo o anticoagulantes

IMPORTANTE:
- Eres un apoyo informativo, NO reemplazas el juicio clínico del odontólogo
- Siempre menciona que tus sugerencias deben validarse con criterio clínico
- Responde en español clínico claro y conciso, con terminología odontológica
- Para medicamentos, usa nombres genéricos y menciona que las dosis deben ajustarse al paciente (peso, edad, alergias, función renal y hepática)
- Si el caso es urgente o de alta complejidad (infección que se extiende a espacios faciales, compromiso de la vía aérea, traumatismo, sospecha de lesión maligna), recomienda referir al especialista o a urgencias
- Máximo 300 palabras por respuesta para ser eficiente`;

/** ¿La clínica recibe la versión odontológica? Solo DENTAL exacto. */
export function asistenteEnClaveDental(categoria: string | null | undefined): boolean {
  return categoria === "DENTAL";
}

/** El prompt de sistema que le toca a la clínica según su categoría. */
export function promptAsistentePara(categoria: string | null | undefined): string {
  return asistenteEnClaveDental(categoria) ? PROMPT_ASISTENTE_DENTAL : PROMPT_ASISTENTE_GENERAL;
}

/** Las cuatro tarjetas de la bienvenida. El icono lo pone la pantalla por `id`. */
export type SugerenciaAsistenteId = "ddx" | "dose" | "soap" | "studies";

export interface SugerenciaAsistente {
  id: SugerenciaAsistenteId;
  titleKey: string;
  descKey: string;
  textKey: string;
}

const BASE = "pages.aiAssistant";

const SUGERENCIAS_GENERAL: readonly SugerenciaAsistente[] = [
  { id: "ddx", titleKey: `${BASE}.suggestDdxTitle`, descKey: `${BASE}.suggestDdxDesc`, textKey: `${BASE}.suggestDdxText` },
  { id: "dose", titleKey: `${BASE}.suggestDoseTitle`, descKey: `${BASE}.suggestDoseDesc`, textKey: `${BASE}.suggestDoseText` },
  { id: "soap", titleKey: `${BASE}.suggestSoapTitle`, descKey: `${BASE}.suggestSoapDesc`, textKey: `${BASE}.suggestSoapText` },
  { id: "studies", titleKey: `${BASE}.suggestStudiesTitle`, descKey: `${BASE}.suggestStudiesDesc`, textKey: `${BASE}.suggestStudiesText` },
];

const SUGERENCIAS_DENTAL: readonly SugerenciaAsistente[] = [
  { id: "ddx", titleKey: `${BASE}.suggestDdxTitleDental`, descKey: `${BASE}.suggestDdxDescDental`, textKey: `${BASE}.suggestDdxTextDental` },
  { id: "dose", titleKey: `${BASE}.suggestDoseTitleDental`, descKey: `${BASE}.suggestDoseDescDental`, textKey: `${BASE}.suggestDoseTextDental` },
  { id: "soap", titleKey: `${BASE}.suggestSoapTitleDental`, descKey: `${BASE}.suggestSoapDescDental`, textKey: `${BASE}.suggestSoapTextDental` },
  { id: "studies", titleKey: `${BASE}.suggestStudiesTitleDental`, descKey: `${BASE}.suggestStudiesDescDental`, textKey: `${BASE}.suggestStudiesTextDental` },
];

/** Las tarjetas (llaves de diccionario) que le tocan a la clínica. */
export function sugerenciasAsistentePara(categoria: string | null | undefined): readonly SugerenciaAsistente[] {
  return asistenteEnClaveDental(categoria) ? SUGERENCIAS_DENTAL : SUGERENCIAS_GENERAL;
}

/** La llave del texto de bienvenida que le toca a la clínica. */
export function bienvenidaAsistentePara(categoria: string | null | undefined): string {
  return asistenteEnClaveDental(categoria) ? `${BASE}.welcomeTextDental` : `${BASE}.welcomeText`;
}
