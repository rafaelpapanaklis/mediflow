// Implants — 6 plantillas WhatsApp pre-quirúrgico / post-quirúrgico /
// osteointegración / fase protésica / control vencido. Spec §8.7.
//
// Encolar con type='IMPLANT' (sigue el patrón de Endo type='ENDO',
// Perio type='PERIO'). El worker que procesa type='IMPLANT' es
// pendiente futuro — no bloquea MVP.

export type ImplantWhatsappTemplateKey =
  | "PRE_SURGERY_24H"
  | "POST_SURGERY_DAY_0"
  | "POST_SURGERY_DAY_7"
  | "MID_OSSEOINTEGRATION"
  | "PROSTHETIC_PHASE_START"
  | "POST_LOAD_FOLLOWUP_OVERDUE";

export type ImplantWhatsappTemplate = {
  key: ImplantWhatsappTemplateKey;
  label: string;
  /**
   * Texto con placeholders entre llaves. La capa de envío (worker
   * `dispatch_implant_reminders`) hace el reemplazo:
   *   {patient}, {time}, {weeks}, {milestone}, {N}, {slots}
   */
  body: string;
};

export const IMPLANT_WHATSAPP_TEMPLATES: Readonly<
  Record<ImplantWhatsappTemplateKey, ImplantWhatsappTemplate>
> = {
  PRE_SURGERY_24H: {
    key: "PRE_SURGERY_24H",
    label: "Recordatorio cirugía 24h",
    body:
      "Hola {patient}, te recordamos tu cirugía mañana a las {time}. " +
      "Recuerda: toma tu antibiótico (amoxicilina 2g) 1 h antes. " +
      "NO comas ni bebas 2 h previas. Cepilla y enjuaga con clorhexidina. " +
      "Trae acompañante adulto.",
  },
  POST_SURGERY_DAY_0: {
    key: "POST_SURGERY_DAY_0",
    label: "Cuidados post-cirugía día 0",
    body:
      "Tu cirugía terminó. Aplica frío 15 min cada hora primeras 24 h. " +
      "Antibiótico cada 12 h por 7 días sin saltarte dosis. " +
      "Antiinflamatorio cada 8 h por 3 días. " +
      "Inicia mañana clorhexidina cada 12 h por 14 días. " +
      "NO escupir, NO fumar, NO pajillas 7 días. " +
      "Dieta blanda y fría hoy y mañana. " +
      "Si dolor intenso, sangrado abundante, fiebre: contáctanos.",
  },
  POST_SURGERY_DAY_7: {
    key: "POST_SURGERY_DAY_7",
    label: "Recordatorio retiro de suturas (día 7)",
    body:
      "Recordatorio retiro de suturas mañana a las {time}. " +
      "Continúa clorhexidina hasta 14 días. " +
      "Higiene cuidadosa sin tocar suturas. " +
      "Evita alimentos duros.",
  },
  MID_OSSEOINTEGRATION: {
    key: "MID_OSSEOINTEGRATION",
    label: "Mitad de osteointegración (6-8 sem)",
    body:
      "¿Cómo va tu cicatrización? Tu implante está en osteointegración. " +
      "Faltan ~{weeks} semanas para iniciar tu prótesis. " +
      "Mantén excelente higiene. " +
      "Si notas movilidad, dolor o aspecto extraño en encía: avísanos.",
  },
  PROSTHETIC_PHASE_START: {
    key: "PROSTHETIC_PHASE_START",
    label: "Inicio fase protésica",
    body:
      "Tu implante ya cicatrizó correctamente. " +
      "Es momento de iniciar la corona definitiva. " +
      "Te agendaremos la toma de impresión.",
  },
  POST_LOAD_FOLLOWUP_OVERDUE: {
    key: "POST_LOAD_FOLLOWUP_OVERDUE",
    label: "Control post-carga vencido",
    body:
      "Tu control de {milestone} está atrasado por {N} mes(es). " +
      "Aunque no sientas molestias, este control es OBLIGATORIO para " +
      "verificar la salud de tu implante (revisión clínica + " +
      "radiografía). Te ofrezco estos horarios: {slots}.",
  },
};

/** Rellena los placeholders de un template con un mapa de variables. */
export function renderTemplate(
  key: ImplantWhatsappTemplateKey,
  vars: Record<string, string | number>,
): string {
  const template = IMPLANT_WHATSAPP_TEMPLATES[key];
  return template.body.replace(/\{(\w+)\}/g, (match, name) => {
    const v = vars[name];
    return v === undefined ? match : String(v);
  });
}
