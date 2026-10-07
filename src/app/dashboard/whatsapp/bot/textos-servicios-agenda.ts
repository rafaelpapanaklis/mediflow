// ws1-t9 — textos de «Servicios al agendar» en Configurar bot (las dos vistas los comparten).
import { useLocale } from "@/i18n/i18n-provider";

const es = {
  titulo: "Servicios al agendar",
  intro: "Estas son las opciones generales que el bot ofrece cuando un paciente pide una cita. «Otro tratamiento» siempre va al final, y «Control de ortodoncia» sale solo a pacientes con ortodoncia.",
  consulta: "Consulta o valoración",
  limpieza: "Limpieza",
  urgencia: "Urgencia o dolor",
  catalogoPregunta: "¿Quieres que el bot ofrezca TUS procedimientos? Ve a Catálogo de procedimientos y marca la casilla «Se agenda por WhatsApp» en cada uno.",
  irCatalogo: "Ir al catálogo",
  marcadosTitulo: "Procedimientos que hoy ofrece el bot",
  sinMarcados: "Ninguno marcado todavía.",
  nadaMarcado: "Si no dejas ninguna opción marcada (ni general ni procedimiento), el bot ofrece las generales de fábrica para no quedarse vacío.",
  pasaDelTope: (n: number, max: number) =>
    `Pediste ${n} opciones y el menú del bot admite ${max} antes de «Otro tratamiento»: las últimas (por orden alfabético) no aparecerán. Desmarca alguna.`,
  sqlPendiente: "Todavía no está activo en tu clínica: por ahora el bot ofrece las tres.",
};

const en: typeof es = {
  titulo: "Services when booking",
  intro: "These are the general options the bot offers when a patient asks for an appointment. “Other treatment” always comes last, and “Orthodontic check-up” only shows to patients in orthodontics.",
  consulta: "Consultation or assessment",
  limpieza: "Cleaning",
  urgencia: "Emergency or pain",
  catalogoPregunta: "Want the bot to offer YOUR procedures? Go to the Procedures catalog and tick “Booked via WhatsApp” on each one.",
  irCatalogo: "Go to the catalog",
  marcadosTitulo: "Procedures the bot offers today",
  sinMarcados: "None ticked yet.",
  nadaMarcado: "If nothing is ticked (no general option and no procedure), the bot offers the default general options so the menu is never empty.",
  pasaDelTope: (n: number, max: number) =>
    `You asked for ${n} options and the bot menu fits ${max} before “Other treatment”: the last ones (alphabetically) will not show. Untick some.`,
  sqlPendiente: "Not active in your clinic yet: for now the bot offers all three.",
};

export type TextosServiciosAgenda = typeof es;
export const TEXTOS_SERVICIOS_AGENDA = { es, en } as const;
export function useTextosServiciosAgenda(): TextosServiciosAgenda {
  return useLocale().startsWith("en") ? en : es;
}
