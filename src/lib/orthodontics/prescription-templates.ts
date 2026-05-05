// Orthodontics — 3 plantillas NOM-024 para flujos comunes de orto. SPEC §8.6.
//
// Las plantillas son textuales: el componente de prescripción del repo las
// consume y arma la receta NOM-024. El usuario edita antes de firmar.

export const ORTHO_PRESCRIPTION_TEMPLATES = {
  /** Profilaxis post-extracción ortodóntica (premolares por ejemplo). */
  POST_EXTRACTION: {
    title: "Post-extracción ortodóntica",
    medications: [
      {
        name: "Ibuprofeno 400 mg",
        dosage: "1 tableta cada 8 horas",
        duration: "Por 3 días con alimentos",
        instructions: "Suspender si presenta acidez gástrica.",
      },
      {
        name: "Clorhexidina 0.12% colutorio",
        dosage: "15 mL puros, enjuagar 30 segundos",
        duration: "Cada 12 horas por 7 días iniciando a las 24 horas",
        instructions: "No comer ni beber durante los siguientes 30 minutos.",
      },
    ],
    indications: [
      "Aplicar frío externo 15 minutos cada hora durante las primeras 6 horas.",
      "Dieta blanda y fría 24-48 horas.",
      "NO escupir, fumar ni usar pajillas durante 48 horas.",
      "Reposo relativo el resto del día.",
      "Si presenta dolor intenso, sangrado abundante o fiebre, contactar a la clínica.",
    ],
  },

  /** Manejo del dolor post-ajuste mensual. */
  POST_ADJUSTMENT: {
    title: "Post-ajuste de brackets",
    medications: [
      {
        name: "Paracetamol 500 mg",
        dosage: "1 tableta cada 8 horas",
        duration: "Por 48 horas máximo según molestia",
        instructions: "Tomar con un vaso de agua.",
      },
    ],
    indications: [
      "Cera ortodóntica de protección sobre brackets que rocen.",
      "Dieta blanda 24-48 horas (puré, sopas, huevo, fruta blanda).",
      "Evitar alimentos duros (palomitas duras, hielo) y pegajosos (chicle, caramelos masticables).",
      "Si la molestia persiste >5 días o aparece bracket roto, agendar revisión.",
    ],
  },

  /** Aftas / lesiones por aparatología nueva. */
  ULCER_FROM_APPLIANCES: {
    title: "Aftas o lesiones por aparatología",
    medications: [
      {
        name: "Bencidamina 0.15% colutorio",
        dosage: "15 mL puros, enjuagar 30 segundos sin diluir",
        duration: "Cada 8 horas por 5 días",
        instructions: "Apto a partir de los 12 años.",
      },
      {
        name: "Triamcinolona 0.1% pomada bucal",
        dosage: "Aplicar localmente sobre la lesión con dedo limpio",
        duration: "Cada 12 horas",
        instructions: "Suspender al desaparecer la molestia. Máximo 7 días.",
      },
    ],
    indications: [
      "Cera ortodóntica de protección sobre el bracket o alambre que está rozando.",
      "Higiene exhaustiva alrededor de la lesión.",
      "Si la lesión persiste >10 días o aumenta de tamaño, acudir a revisión.",
    ],
  },
} as const;

export type OrthoPrescriptionTemplateKey = keyof typeof ORTHO_PRESCRIPTION_TEMPLATES;
