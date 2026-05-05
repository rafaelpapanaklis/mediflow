// Periodontics — plantillas WhatsApp para mantenimiento, post-SRP y post-quirúrgico.
// SPEC §8.7. Las llaves entre `{}` no incluidas en la firma son sustituidas
// por el caller (clinicName, doctorName, availableSlots, nextAppointmentDate, etc.).

export const PERIO_WHATSAPP_TEMPLATES = {
  PRE_MAINTENANCE: (months: number, patientName: string) =>
    `Hola ${patientName}, te escribo desde {clinicName}.

Es momento de tu mantenimiento periodontal. Tu última visita fue hace ${months} meses, y para mantener tus encías saludables es importante venir cada ${months} meses.

¿Te agendamos en los próximos días? Te ofrezco estos horarios: {availableSlots}.

— {doctorName}`.trim(),

  POST_SRP_DAY_0: (patientName: string) =>
    `Hola ${patientName}. Acabas de terminar tu primera sesión de raspado y alisado.

Recuerda:
• Toma tu ibuprofeno cada 8 horas por 2 días.
• Inicia los enjuagues con clorhexidina cada 12 horas por 14 días.
• Usa cepillo ultrasuave durante esta semana.
• Evita alimentos muy calientes o ácidos hoy.

Si tienes molestias intensas o sangrado abundante: escríbenos.

— {clinicName}`.trim(),

  POST_SRP_DAY_3: (patientName: string) =>
    `Hola ${patientName}, ¿cómo te sientes después de tu sesión de raspado?

Recuerda continuar con la clorhexidina cada 12 horas hasta completar 14 días.

Tu próxima cita es: {nextAppointmentDate}.

Si tienes dudas, escríbenos.

— {clinicName}`.trim(),

  POST_SURGERY_DAY_0: (patientName: string) =>
    `Hola ${patientName}. Tu cirugía periodontal terminó. Por favor sigue al pie de la letra:

• Aplica frío (compresas con hielo) sobre la mejilla 15 min cada hora durante las primeras 24 h.
• Toma tu medicamento como indicamos: amoxicilina cada 12 h, ibuprofeno cada 8 h.
• NO escupas, NO fumes, NO uses pajillas durante 7 días.
• NO te enjuagues vigorosamente por 24 h.
• Reposo relativo hoy y mañana.

Si presentas dolor intenso, sangrado abundante o fiebre: contáctanos de inmediato.

— {clinicName}`.trim(),

  POST_SURGERY_DAY_1: (patientName: string) =>
    `Buenos días ${patientName}. ¿Cómo amaneciste?

Recordatorio:
• Continúa con tu antibiótico (amoxicilina 875+125 cada 12 h).
• Inicia hoy los enjuagues con clorhexidina cada 12 h.
• Sigue con dieta blanda y fría 2-3 días más.

Cualquier duda, escríbenos.

— {clinicName}`.trim(),

  POST_SURGERY_DAY_7: (patientName: string, time: string) =>
    `Hola ${patientName}, te recordamos tu cita de retiro de suturas mañana a las ${time}.

Por favor, evita comer alimentos duros y sigue tu higiene cuidadosa hasta la cita.

— {clinicName}`.trim(),

  HYGIENE_INSTRUCTIONS: (patientName: string, items: string[]) =>
    `Hola ${patientName}, te comparto las recomendaciones de higiene oral personalizadas según lo que vimos hoy:

${items.map((s) => `• ${s}`).join("\n")}

Si tienes dudas, escríbenos.

— {clinicName}`.trim(),

  REEVAL_RESULT: (patientName: string, bopBefore: number, bopAfter: number) =>
    `Hola ${patientName}, tu reevaluación periodontal mostró excelentes resultados:

• Sangrado al sondaje (BoP): ${bopBefore}% → ${bopAfter}%
• {pocketImprovement}

¡Sigue así! Tu próximo mantenimiento es: {nextDate}.

— {clinicName}`.trim(),
} as const;

export type PerioWhatsAppTemplateKey = keyof typeof PERIO_WHATSAPP_TEMPLATES;
