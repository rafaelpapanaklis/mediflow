// Orthodontics — 7 plantillas WhatsApp para recordatorios y compliance financiera. SPEC §8.7.
// Las llaves entre `{}` no incluidas en la firma son sustituidas por el caller
// (clinicName, doctorName, methods, fecha, etc.).

export const ORTHO_WHATSAPP_TEMPLATES = {
  APPOINTMENT_REMINDER_24H: (patientName: string, hora: string) =>
    `Hola ${patientName}, te recordamos tu control ortodóntico mañana a las ${hora}. Recuerda cepillarte muy bien antes de venir.`.trim(),

  MISSED_APPOINTMENT: (patientName: string, hora: string) =>
    `Hola ${patientName}, te esperamos hoy a las ${hora}. ¿Todo bien? Reagenda fácil respondiendo este mensaje.`.trim(),

  INSTALLMENT_DUE_3_DAYS: (
    patientName: string,
    installmentNumber: number,
    fecha: string,
    amountMxn: number,
  ) =>
    `Hola ${patientName}, tu mensualidad #${installmentNumber} vence en 3 días (${fecha}) por $${amountMxn.toLocaleString("es-MX")} MXN. Métodos: {methods}.`.trim(),

  INSTALLMENT_OVERDUE_LIGHT: (
    patientName: string,
    installmentNumber: number,
    daysOverdue: number,
    pendingMxn: number,
  ) =>
    `Hola ${patientName}, tu mensualidad #${installmentNumber} venció hace ${daysOverdue} días. Saldo pendiente: $${pendingMxn.toLocaleString("es-MX")} MXN. ¿Podemos coordinar tu pago hoy?`.trim(),

  INSTALLMENT_OVERDUE_SEVERE: (
    patientName: string,
    installmentNumber: number,
  ) =>
    `Hola ${patientName}, notamos un retraso de más de un mes en tu mensualidad #${installmentNumber}. Es importante regularizar para no detener tu tratamiento. Llámanos al {clinicPhone} para platicar opciones.`.trim(),

  MONTHLY_PROGRESS: (
    patientName: string,
    monthInTreatment: number,
    phaseLabel: string,
  ) =>
    `Hola ${patientName}, llevas ${monthInTreatment} meses de tratamiento. Estás en fase ${phaseLabel}. ¡Vas excelente! Sigue así con tu higiene y elásticos. — {doctorName}`.trim(),

  PRE_INSTALLATION_INSTRUCTIONS: (patientName: string) =>
    `Hola ${patientName}, mañana es tu cita de instalación de aparatología. Llega con dientes muy bien lavados, ten 1 hora disponible y trae elásticos si te indicamos. — {clinicName}`.trim(),
} as const;

export type OrthoWhatsAppTemplateKey = keyof typeof ORTHO_WHATSAPP_TEMPLATES;
