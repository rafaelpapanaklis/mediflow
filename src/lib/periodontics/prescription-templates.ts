// Periodontics — 3 plantillas de receta NOM-024 para flujos perio. SPEC §10.
//
// Las plantillas son textuales: el componente de prescripción del repo
// las consume y arma la receta NOM-024. El usuario puede editar antes de
// firmar. Cualquier dato de paciente o doctor lo sustituye el caller.

export const PERIO_PRESCRIPTION_TEMPLATES = {
  /** Post-SRP — analgesia + colutorio + cepillo. */
  POST_SRP: {
    title: "Post-raspado y alisado radicular",
    medications: [
      {
        name: "Ibuprofeno 400 mg",
        dosage: "1 tableta cada 8 horas",
        duration: "Por 2 días o hasta que ceda el dolor",
        instructions: "Tomar con alimentos.",
      },
      {
        name: "Clorhexidina 0.12% colutorio",
        dosage: "15 mL puros, enjuagar 30 segundos",
        duration: "Cada 12 horas por 14 días",
        instructions: "No comer ni beber durante los siguientes 30 minutos. Evitar dentífricos con SLS justo antes.",
      },
    ],
    indications: [
      "Cepillo ultrasuave durante esta semana.",
      "Evitar alimentos duros, calientes o muy ácidos durante 24-48 horas.",
      "Si presenta sangrado abundante o dolor intenso, contactar a la clínica de inmediato.",
    ],
  },

  /** Cirugía periodontal — antibiótico profiláctico + analgesia + colutorio. */
  POST_SURGERY: {
    title: "Post-cirugía periodontal",
    medications: [
      {
        name: "Amoxicilina + ácido clavulánico 875/125 mg",
        dosage: "1 tableta cada 12 horas",
        duration: "Por 7 días",
        instructions: "Completar el ciclo aunque me sienta bien. Tomar con comida.",
      },
      {
        name: "Ibuprofeno 600 mg",
        dosage: "1 tableta cada 8 horas",
        duration: "Por 3 días o hasta que ceda el dolor",
        instructions: "Tomar con alimentos.",
      },
      {
        name: "Clorhexidina 0.12% colutorio",
        dosage: "15 mL puros, enjuagar 30 segundos sin escupir vigorosamente",
        duration: "Cada 12 horas por 14 días, comenzando 24 horas post-cirugía",
        instructions: "No comer ni beber durante los siguientes 30 minutos.",
      },
    ],
    indications: [
      "Compresas frías sobre la mejilla 15 minutos cada hora durante las primeras 24 horas.",
      "NO escupir, NO fumar, NO usar pajillas durante 7 días.",
      "Dieta blanda y fría 2-3 días.",
      "Reposo relativo 48 horas.",
      "Cita de retiro de suturas a los 7-14 días.",
    ],
  },

  /** Mantenimiento periodontal — refuerzo de higiene sin antibiótico. */
  MAINTENANCE_HYGIENE: {
    title: "Refuerzo de higiene oral",
    medications: [
      {
        name: "Clorhexidina 0.12% colutorio",
        dosage: "15 mL puros, enjuagar 30 segundos",
        duration: "Cada 12 horas durante 7 días tras cada limpieza",
        instructions: "Solo durante el periodo de control activo o tras una limpieza profesional.",
      },
    ],
    indications: [
      "Cepillado 3 veces al día con técnica de Bass modificada.",
      "Hilo dental o cepillos interproximales todos los días.",
      "Mantenimiento periodontal cada 3-6 meses según riesgo.",
    ],
  },
} as const;

export type PerioPrescriptionTemplateKey = keyof typeof PERIO_PRESCRIPTION_TEMPLATES;
