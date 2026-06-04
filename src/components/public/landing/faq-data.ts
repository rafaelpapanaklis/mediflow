/**
 * FAQs de la home pública. Fuente única: la usa el acordeón <FAQ /> para
 * renderizar y page.tsx para el JSON-LD FAQPage. Así no divergen. Español MX.
 */
export type FaqItem = { q: string; a: string };

export const HOME_FAQS: FaqItem[] = [
  {
    q: "¿MediFlow cumple con CFDI 4.0 y la NOM-024?",
    a: "Sí. La facturación CFDI 4.0 está integrada y se timbra directo ante el SAT, y el expediente clínico cumple con la NOM-024-SSA3-2012. No necesitas un facturador aparte.",
  },
  {
    q: "¿Puedo migrar mis pacientes desde Dentrix, Excel u otro sistema?",
    a: "Sí. La migración está incluida: importamos tus pacientes, historia clínica y radiografías sin costo en los planes PRO y CLINIC, normalmente en menos de 48 horas.",
  },
  {
    q: "¿Necesito tarjeta para la prueba gratis?",
    a: "No. Son 14 días gratis sin tarjeta. Pruebas todo el sistema y decides después; no hay cobros automáticos al terminar la prueba.",
  },
  {
    q: "¿Sirve para mi especialidad?",
    a: "MediFlow cubre 17 especialidades en 4 categorías —dental, médicas, salud mental y bienestar— y cada una tiene expedientes, flujos y reportes propios, no un formato genérico.",
  },
  {
    q: "¿Los recordatorios por WhatsApp están incluidos?",
    a: "Sí. Las confirmaciones y recordatorios automáticos por WhatsApp están incluidos en todos los planes. Es lo que más reduce las faltas a citas de nuestras clínicas.",
  },
  {
    q: "¿Mis datos y los de mis pacientes están seguros?",
    a: "Sí. Los datos se cifran en tránsito y en reposo, con servidores en México y cumplimiento de la LFPDPPP y la NOM-024. Cada clínica solo ve su propia información.",
  },
  {
    q: "¿Puedo cancelar cuando quiera?",
    a: "Sí. No hay contratos forzosos ni penalizaciones: cancelas cuando quieras desde tu panel y conservas el acceso hasta el final del periodo pagado.",
  },
];
