// Cobro automático con tarjeta (ws1-t6) — textos de las tres pantallas, es/en.
//
// Viven aquí y no en los diccionarios a propósito (mismo motivo que
// textos-firma-control.ts): los diccionarios los tocan a la vez otras pantallas.
// Los motivos y errores que manda el servidor llegan ya en español (como el
// resto de las rutas de cobro).

import { useLocale } from "@/i18n/i18n-provider";

const es = {
  // Configuración → Anticipos
  configTitulo: "Cobro automático con tarjeta",
  configSubtitulo:
    "Opcional. Las mensualidades de un plan a plazos se cobran solas a la tarjeta que el paciente registra en Mercado Pago. DaleControl nunca ve ni guarda la tarjeta.",
  insigniaEncendido: "Encendido",
  insigniaApagado: "Apagado",
  interruptor: "Permitir el cobro automático con tarjeta",
  interruptorAyuda:
    "Apagado, todo se cobra a mano como siempre. Encendido, aparece «Activar cobro automático» en el cobro de cada caso a plazos; nada se activa solo.",
  sinSql: "Falta pegar el SQL de esta función (sql/ws1-t6-cobro-automatico-mp.sql). Mientras tanto queda oculta en toda la clínica.",
  vivos: (n: number) =>
    n === 1
      ? "1 paciente tiene el cobro automático vivo. Apagar el interruptor NO lo cancela: cancélalo desde su caso."
      : `${n} pacientes tienen el cobro automático vivo. Apagar el interruptor NO los cancela: cancélalos desde cada caso.`,
  avisoWebhook:
    "Mercado Pago avisa cada cobro al webhook de DaleControl. Si un aviso no llega, el caso se pone al día solo al abrirlo.",
  guardado: "✓ Guardado",
  // El bloque del caso
  titulo: "Cobro automático con tarjeta",
  activar: "Activar cobro automático",
  activando: "Activando…",
  correo: "Correo del paciente en Mercado Pago",
  correoPista: "Mercado Pago lo pide: con ese correo el paciente entra a registrar su tarjeta.",
  resumenPlan: (monto: string, desde: string, cuota: number, de: number) =>
    `Se cobrarían ${monto} en cada fecha del plan, empezando el ${desde} (mensualidad ${cuota} de ${de}). Lo vencido no se cobra solo.`,
  confirmar:
    "Se creará en Mercado Pago el cobro automático y te daremos el link para que el paciente registre su tarjeta. ¿Continuar?",
  estado: {
    creating: "Creándose…",
    pending: "Esperando la tarjeta",
    authorized: "Activo",
    paused: "Pausado",
    cancelled: "Cancelado",
  } as Record<string, string>,
  montoCada: (monto: string) => `${monto} por mensualidad`,
  proximo: (fecha: string) => `Próximo cobro: ${fecha}`,
  desde: (fecha: string) => `Desde el ${fecha}`,
  linkTitulo: "Link para registrar la tarjeta",
  linkPista: "Mándaselo al paciente. Lo abre, entra a Mercado Pago y registra su tarjeta; al aceptarla, el cobro queda activo.",
  copiar: "Copiar link",
  copiado: "Link copiado",
  whatsapp: "Enviar por WhatsApp",
  mensajeWhatsapp: (clinica: string, link: string) =>
    `Hola, te compartimos el link de ${clinica} para registrar tu tarjeta en Mercado Pago y que tus mensualidades se cobren solas: ${link}`,
  pausar: "Pausar",
  reanudar: "Reanudar",
  cancelar: "Cancelar cobro automático",
  confirmarCancelar: "¿Cancelar el cobro automático? Mercado Pago deja de cobrar y no se puede reanudar: habría que activarlo de nuevo.",
  confirmarPausar: "¿Pausar el cobro automático? Mercado Pago no cobrará hasta que lo reanudes.",
  canceladoPorque: (m: string) => `Cancelado: ${m}`,
  error: "No se pudo completar. Intenta de nuevo.",
  // Aviso de Caja
  avisoTitulo: (n: number) => (n === 1 ? "1 cobro automático por revisar" : `${n} cobros automáticos por revisar`),
  revisado: "Revisado",
  verFactura: "Ver factura",
};

type Textos = typeof es;

const en: Textos = {
  configTitulo: "Automatic card charges",
  configSubtitulo:
    "Optional. Installments of a payment plan are charged automatically to the card the patient registers in Mercado Pago. DaleControl never sees or stores the card.",
  insigniaEncendido: "On",
  insigniaApagado: "Off",
  interruptor: "Allow automatic card charges",
  interruptorAyuda:
    "Off, everything is charged manually as always. On, «Turn on automatic charges» appears in each payment-plan case; nothing turns on by itself.",
  sinSql: "The SQL for this feature is not applied yet (sql/ws1-t6-cobro-automatico-mp.sql). Until then it stays hidden.",
  vivos: (n: number) =>
    n === 1
      ? "1 patient has automatic charges active. Turning this off does NOT cancel it: cancel it from the case."
      : `${n} patients have automatic charges active. Turning this off does NOT cancel them: cancel each one from its case.`,
  avisoWebhook: "Mercado Pago notifies each charge to DaleControl. If a notification is lost, the case catches up when opened.",
  guardado: "✓ Saved",
  titulo: "Automatic card charges",
  activar: "Turn on automatic charges",
  activando: "Turning on…",
  correo: "Patient's Mercado Pago email",
  correoPista: "Mercado Pago requires it: the patient signs in with it to register the card.",
  resumenPlan: (monto: string, desde: string, cuota: number, de: number) =>
    `${monto} would be charged on each plan date, starting ${desde} (installment ${cuota} of ${de}). Overdue amounts are not charged automatically.`,
  confirmar: "Automatic charges will be created in Mercado Pago and you'll get the link for the patient to register the card. Continue?",
  estado: {
    creating: "Creating…",
    pending: "Waiting for the card",
    authorized: "Active",
    paused: "Paused",
    cancelled: "Cancelled",
  },
  montoCada: (monto: string) => `${monto} per installment`,
  proximo: (fecha: string) => `Next charge: ${fecha}`,
  desde: (fecha: string) => `Starting ${fecha}`,
  linkTitulo: "Link to register the card",
  linkPista: "Send it to the patient. They open it, sign in to Mercado Pago and register the card; once accepted, charges are active.",
  copiar: "Copy link",
  copiado: "Link copied",
  whatsapp: "Send via WhatsApp",
  mensajeWhatsapp: (clinica: string, link: string) =>
    `Hi, here is the link from ${clinica} to register your card in Mercado Pago so your installments are charged automatically: ${link}`,
  pausar: "Pause",
  reanudar: "Resume",
  cancelar: "Cancel automatic charges",
  confirmarCancelar: "Cancel automatic charges? Mercado Pago stops charging and it can't be resumed: it would have to be turned on again.",
  confirmarPausar: "Pause automatic charges? Mercado Pago won't charge until you resume.",
  canceladoPorque: (m: string) => `Cancelled: ${m}`,
  error: "Could not complete. Try again.",
  avisoTitulo: (n: number) => (n === 1 ? "1 automatic charge to review" : `${n} automatic charges to review`),
  revisado: "Reviewed",
  verFactura: "View invoice",
};

/** Fuera del I18nProvider (`useLocale` lanza) se queda en español. */
export function useTextosCobroAutomatico(): Textos & { locale: "es" | "en" } {
  let locale = "es";
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    locale = useLocale();
  } catch {
    locale = "es";
  }
  return locale === "en" ? { ...en, locale: "en" } : { ...es, locale: "es" };
}

export function fechaLarga(iso: string | null, locale: "es" | "en"): string {
  if (!iso) return "—";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(locale === "en" ? "en-US" : "es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...( /^\d{4}-\d{2}-\d{2}$/.test(iso) ? { timeZone: "UTC" } : {}),
  });
}

export function pesos(n: number, locale: "es" | "en"): string {
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "es-MX", { style: "currency", currency: "MXN" }).format(n);
}
