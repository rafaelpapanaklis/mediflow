// Implants — plantillas de receta NOM-024-SSA3-2012. Spec §8.6.
//
// 4 plantillas + 1 adicional pre-prótesis:
//   IMPL_RX_PROFILAXIS_PRE   profilaxis pre-cirugía estándar
//   IMPL_RX_POST_QUIRURGICA  post-cirugía estándar
//   IMPL_RX_POST_SENO        post-elevación de seno
//   IMPL_RX_ALERGIA_PCN      pacientes alérgicos a penicilina
//   IMPL_RX_PRE_PROTESIS     pre-toma de impresión / colocación final
//
// Cada plantilla devuelve un objeto con encabezado NOM-024 + cuerpo.
// El sistema de Prescription general reutiliza estos textos.

export type ImplantPrescriptionKey =
  | "IMPL_RX_PROFILAXIS_PRE"
  | "IMPL_RX_POST_QUIRURGICA"
  | "IMPL_RX_POST_SENO"
  | "IMPL_RX_ALERGIA_PCN"
  | "IMPL_RX_PRE_PROTESIS";

export type ImplantPrescriptionContext = {
  patientName: string;
  patientCurp?: string;
  doctorName: string;
  doctorCedula: string | null;
  clinicName: string;
  prescribedAt: Date;
  /** Fecha programada de cirugía o procedimiento, opcional. */
  scheduledAt?: Date;
  sutureRemovalAt?: Date;
};

export interface ImplantPrescriptionTemplate {
  key: ImplantPrescriptionKey;
  label: string;
  description: string;
  build: (ctx: ImplantPrescriptionContext) => {
    header: string;
    body: string;
    cautionsAndInstructions: string;
  };
}

function fmtDate(d?: Date): string {
  if (!d) return "—";
  return d.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function header(ctx: ImplantPrescriptionContext): string {
  return [
    "Receta — NOM-024-SSA3-2012",
    `Paciente: ${ctx.patientName}${ctx.patientCurp ? ` · CURP ${ctx.patientCurp}` : ""}`,
    `Fecha: ${fmtDate(ctx.prescribedAt)}`,
    `Dr/a. ${ctx.doctorName}${ctx.doctorCedula ? ` · Cédula ${ctx.doctorCedula}` : ""}`,
    `Clínica: ${ctx.clinicName}`,
  ].join("\n");
}

export const IMPLANT_PRESCRIPTION_TEMPLATES: Readonly<
  Record<ImplantPrescriptionKey, ImplantPrescriptionTemplate>
> = {
  IMPL_RX_PROFILAXIS_PRE: {
    key: "IMPL_RX_PROFILAXIS_PRE",
    label: "Profilaxis pre-cirugía estándar",
    description: "Tomar 1h antes de la cirugía. Dosis única.",
    build: (ctx) => ({
      header: header(ctx),
      body:
        "Amoxicilina 2 g VO. Dosis única — tomar 1 hora antes de la cirugía.",
      cautionsAndInstructions: [
        "Pre-operatorio:",
        "• No comer ni beber 2 horas previas a la cirugía.",
        "• Cepillado y enjuague con clorhexidina 0.12% antes de salir.",
        "• Acompañante adulto obligatorio.",
        ctx.scheduledAt ? `Cirugía programada: ${fmtDate(ctx.scheduledAt)}.` : "",
      ].filter(Boolean).join("\n"),
    }),
  },

  IMPL_RX_POST_QUIRURGICA: {
    key: "IMPL_RX_POST_QUIRURGICA",
    label: "Post-cirugía estándar",
    description: "Antibiótico + AINE + clorhexidina. 7-14 días.",
    build: (ctx) => ({
      header: header(ctx),
      body: [
        "1) Amoxicilina 875 mg + Ácido clavulánico 125 mg cada 12 h por 7 días, con alimentos.",
        "2) Ibuprofeno 600 mg cada 8 h por 3 días, con alimentos.",
        "3) Clorhexidina 0.12% colutorio 15 ml cada 12 h por 14 días, iniciando a las 24 h post-cirugía.",
      ].join("\n"),
      cautionsAndInstructions: [
        "Cuidados post-operatorios:",
        "• Frío local 15 min cada hora durante las primeras 24 h.",
        "• Dieta blanda y fría 3 días.",
        "• NO escupir, NO fumar, NO usar pajillas durante 7 días.",
        "• NO ejercicio durante 5 días.",
        ctx.sutureRemovalAt ? `• Cita de retiro de suturas: ${fmtDate(ctx.sutureRemovalAt)}.` : "",
        "Si dolor intenso, sangrado abundante o fiebre >38°C: contáctanos.",
      ].filter(Boolean).join("\n"),
    }),
  },

  IMPL_RX_POST_SENO: {
    key: "IMPL_RX_POST_SENO",
    label: "Post-elevación de seno",
    description: "Plantilla 2 + cuidados sinusales + descongestionante nasal.",
    build: (ctx) => ({
      header: header(ctx),
      body: [
        "1) Amoxicilina 875 mg + Ácido clavulánico 125 mg cada 12 h por 7 días, con alimentos.",
        "2) Ibuprofeno 600 mg cada 8 h por 3 días, con alimentos.",
        "3) Clorhexidina 0.12% colutorio 15 ml cada 12 h por 14 días, iniciando a las 24 h.",
        "4) Oximetazolina 0.05% spray nasal — 2 nebulizaciones cada 12 h por 5 días.",
      ].join("\n"),
      cautionsAndInstructions: [
        "Cuidados post-elevación de seno:",
        "• NO sonarse la nariz por 2 semanas.",
        "• Estornudar con boca abierta.",
        "• Evitar cambios bruscos de presión 2 semanas (vuelos, buceo).",
        "• Aplicar todos los cuidados generales post-cirugía: frío, dieta blanda, NO escupir/fumar/pajillas.",
        ctx.sutureRemovalAt ? `• Cita de retiro de suturas: ${fmtDate(ctx.sutureRemovalAt)}.` : "",
        "Si hemorragia nasal abundante o burbujas en la zona quirúrgica: contáctanos de inmediato.",
      ].filter(Boolean).join("\n"),
    }),
  },

  IMPL_RX_ALERGIA_PCN: {
    key: "IMPL_RX_ALERGIA_PCN",
    label: "Pacientes alérgicos a penicilina",
    description: "Sustituye amoxicilina por clindamicina.",
    build: (ctx) => ({
      header: header(ctx),
      body: [
        "1) Clindamicina 600 mg VO — dosis única 1 hora antes de la cirugía.",
        "2) Clindamicina 300 mg VO cada 8 h por 7 días post-op, con un vaso lleno de agua.",
        "3) Ibuprofeno 600 mg cada 8 h por 3 días, con alimentos.",
        "4) Clorhexidina 0.12% colutorio 15 ml cada 12 h por 14 días, iniciando a las 24 h post-cirugía.",
      ].join("\n"),
      cautionsAndInstructions: [
        "Suspender e informar de inmediato si presenta diarrea severa (riesgo de colitis pseudomembranosa).",
        "Cuidados post-operatorios estándar (frío, dieta blanda, NO escupir/fumar/pajillas).",
        ctx.sutureRemovalAt ? `Cita de retiro de suturas: ${fmtDate(ctx.sutureRemovalAt)}.` : "",
      ].filter(Boolean).join("\n"),
    }),
  },

  IMPL_RX_PRE_PROTESIS: {
    key: "IMPL_RX_PRE_PROTESIS",
    label: "Pre-prótesis (toma de impresión / colocación final)",
    description: "Sin antibiótico — solo enjuague + recomendaciones.",
    build: (ctx) => ({
      header: header(ctx),
      body:
        "Clorhexidina 0.12% colutorio 15 ml cada 12 h, comenzando 24 h antes de la cita y por 3 días después.",
      cautionsAndInstructions: [
        "Recomendaciones:",
        "• Cepillado normal del implante con cepillo suave.",
        "• Higiene interproximal con cepillo interdental o irrigador.",
        "• Evitar alimentos duros 24 h post-colocación final.",
        ctx.scheduledAt ? `Cita: ${fmtDate(ctx.scheduledAt)}.` : "",
      ].filter(Boolean).join("\n"),
    }),
  },
};
