// Plantillas usadas por el super-admin para enviar WhatsApp/Email manual
// a una clínica. Variables soportadas: {{clinicName}}, {{dueDate}}, {{amount}}.

export type TemplateChannel = "whatsapp" | "email";

export interface AdminTemplate {
  id: string;
  label: string;
  subject?: string; // solo email
  body: string;
}

export const WHATSAPP_TEMPLATES: AdminTemplate[] = [
  {
    id: "welcome",
    label: "Bienvenida",
    body:
      "Hola {{clinicName}}! 👋\n\nSoy del equipo de MediFlow. Vengo a darte la bienvenida y a confirmarte que tu cuenta ya está lista. Si necesitas ayuda configurando tu clínica, respóndeme por aquí y te agendo una demo gratis. 🚀",
  },
  {
    id: "payment_reminder",
    label: "Recordatorio de pago",
    body:
      "Hola {{clinicName}},\n\nTe escribo para recordarte que tu pago de MediFlow está pendiente. Monto: ${{amount}}. Vence el {{dueDate}}.\n\nSi ya hiciste el pago, ignora este mensaje. Si tienes alguna duda, responde a este WhatsApp y te ayudo. 🙌",
  },
  {
    id: "renewal_soon",
    label: "Renovación próxima",
    body:
      "Hola {{clinicName}}! Tu plan de MediFlow se renueva el {{dueDate}} por ${{amount}} MXN. Si quieres cambiar de plan o cancelar antes de esa fecha, escríbeme por aquí. 💳",
  },
  {
    id: "update_notice",
    label: "Aviso de actualización",
    body:
      "Hola {{clinicName}},\n\nActualizamos MediFlow con nuevas funciones. Entra al dashboard para verlas. Si algo no se ve bien, responde a este mensaje y lo revisamos juntos. 🛠️",
  },
];

export const EMAIL_TEMPLATES: AdminTemplate[] = [
  {
    id: "welcome",
    label: "Bienvenida",
    subject: "Bienvenido a MediFlow",
    body:
      "Hola {{clinicName}},\n\nSoy del equipo de MediFlow. Te doy la bienvenida y te confirmo que tu cuenta ya está lista. Si necesitas ayuda configurando tu clínica responde a este correo y te agendo una demo gratis.\n\nUn saludo,\nEquipo MediFlow",
  },
  {
    id: "payment_reminder",
    label: "Recordatorio de pago",
    subject: "Recordatorio de pago MediFlow — {{clinicName}}",
    body:
      "Hola {{clinicName}},\n\nTe escribo para recordarte que tu pago de MediFlow está pendiente. Monto: ${{amount}} MXN. Vence el {{dueDate}}.\n\nSi ya hiciste el pago, ignora este mensaje. Si tienes alguna duda, responde a este correo y te ayudo.\n\nSaludos,\nEquipo MediFlow",
  },
  {
    id: "renewal_soon",
    label: "Renovación próxima",
    subject: "Tu plan MediFlow se renueva el {{dueDate}}",
    body:
      "Hola {{clinicName}},\n\nTu plan de MediFlow se renueva el {{dueDate}} por ${{amount}} MXN. Si quieres cambiar de plan o cancelar antes de esa fecha, responde a este correo.\n\nUn saludo,\nEquipo MediFlow",
  },
  {
    id: "update_notice",
    label: "Aviso de actualización",
    subject: "Novedades en MediFlow",
    body:
      "Hola {{clinicName}},\n\nActualizamos MediFlow con nuevas funciones. Entra al dashboard para verlas. Si algo no se ve bien, responde a este correo y lo revisamos.\n\nSaludos,\nEquipo MediFlow",
  },
];

export function renderTemplate(
  body: string,
  vars: { clinicName?: string; amount?: string | number; dueDate?: string },
): string {
  return body
    .replace(/\{\{clinicName\}\}/g, vars.clinicName ?? "")
    .replace(/\{\{amount\}\}/g, vars.amount !== undefined ? String(vars.amount) : "")
    .replace(/\{\{dueDate\}\}/g, vars.dueDate ?? "");
}
