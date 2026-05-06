/**
 * Plantillas SOAP de evolución (ClinicalEvolutionTemplate).
 *
 * El schema de pediatrics guarda `soapTemplate` como Json
 * `{ S: string; O: string; A: string; P: string }`. Aquí proveemos:
 *  - Tipos TS para esa estructura
 *  - Render con placeholders {{var}}
 *  - 6 plantillas builtin de implantes (no se persisten — se sirven en
 *    cliente para que el picker no dependa de DB)
 */
import { z } from "zod";
import type { ClinicalModule } from "./types";

export const soapTemplateSchema = z.object({
  S: z.string(),
  O: z.string(),
  A: z.string(),
  P: z.string(),
});

export type SoapTemplate = z.infer<typeof soapTemplateSchema>;

export interface EvolutionTemplateRecord {
  id: string;
  clinicId: string | null;
  module: ClinicalModule;
  name: string;
  /** key estable lógico, ej "colocacion_implante". No persiste en DB —
   *  útil para builtins que sí tienen identidad. */
  key?: string;
  soapTemplate: SoapTemplate;
  proceduresPrefilled: string[];
  materialsPrefilled: string[];
  isDefault: boolean;
}

/**
 * Renderiza una string con placeholders `{{var}}` reemplazándolos por
 * valores del contexto. Tokens desconocidos quedan literales.
 */
export function renderTemplateString(
  template: string,
  context: Record<string, string | number | null | undefined>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (raw, key: string) => {
    const v = context[key];
    if (v == null || v === "") return raw;
    return String(v);
  });
}

/**
 * Renderiza las 4 secciones SOAP de una plantilla.
 */
export function renderSoapTemplate(
  tpl: SoapTemplate,
  context: Record<string, string | number | null | undefined>,
): SoapTemplate {
  return {
    S: renderTemplateString(tpl.S, context),
    O: renderTemplateString(tpl.O, context),
    A: renderTemplateString(tpl.A, context),
    P: renderTemplateString(tpl.P, context),
  };
}

/**
 * 6 plantillas builtin de evolución del módulo Implantes. Pre-cargadas en
 * código para que el picker funcione sin DB roundtrip y para tener la
 * fuente de verdad versionada en el repo.
 */
export interface ImplantEvolutionTemplate {
  key:
    | "planificacion_quirurgica"
    | "colocacion_implante"
    | "segunda_fase"
    | "colocacion_pilar"
    | "instalacion_corona"
    | "control_oseointegracion";
  name: string;
  description: string;
  soapTemplate: SoapTemplate;
  /** Procedimientos sugeridos (catalog-keys que el picker mostrará). */
  proceduresPrefilled: string[];
  /** Materiales sugeridos. */
  materialsPrefilled: string[];
  /** Orden de presentación. */
  sortOrder: number;
}

export const IMPLANT_EVOLUTION_TEMPLATES: ReadonlyArray<ImplantEvolutionTemplate> = [
  {
    key: "planificacion_quirurgica",
    name: "Planificación quirúrgica",
    description:
      "Evaluación pre-quirúrgica con CBCT y selección de implante.",
    sortOrder: 10,
    proceduresPrefilled: ["consulta_implantologica", "interpretacion_cbct"],
    materialsPrefilled: [],
    soapTemplate: {
      S: "Paciente acude para evaluación de implante en {{toothFdi}}. Refiere {{chiefComplaint}}. Antecedentes: {{medicalHistory}}.",
      O: "Examen clínico: encía {{gingivalStatus}}. Cresta ósea: ancho {{ridgeWidth}} mm, alto {{ridgeHeight}} mm. ASA {{asa}}. CBCT analizado.",
      A: "Edentulismo unitario en {{toothFdi}}. Hueso tipo {{lekholmZarb}}. Protocolo {{protocol}} planeado. Sin contraindicaciones.",
      P: "1) Solicitud CBCT (si pendiente).\n2) Cirugía con guía: implante {{brand}} {{diameter}}×{{length}} mm.\n3) Pre-medicación: amoxicilina+clavulánico 875/125 mg c/12 h por 5 días iniciando 24 h pre-cirugía.\n4) Programar cirugía.",
    },
  },
  {
    key: "colocacion_implante",
    name: "Colocación de implante (cirugía)",
    description:
      "Registro intraoperatorio: torque, ISQ, ficha técnica del implante.",
    sortOrder: 20,
    proceduresPrefilled: [
      "cirugia_colocacion_implante",
      "sutura_simple",
    ],
    materialsPrefilled: [
      "implante_dental",
      "pilar_cicatrizacion",
      "sutura_4_0",
      "anestesia_local",
    ],
    soapTemplate: {
      S: "Paciente acude para cirugía de colocación de implante en {{toothFdi}}. Tomó pre-medicación. Sin alergias agudas. Consentimiento firmado.",
      O: "Cirugía guiada bajo anestesia local. Torque inserción: {{torque}} Ncm. ISQ MD/VL: {{isqMd}}/{{isqVl}}. Pilar de cicatrización lote {{healingLot}}, {{healingDiameter}}×{{healingHeight}} mm. Sutura {{suture}}. Sin complicaciones intraoperatorias.",
      A: "Implante {{brand}} {{diameter}}×{{length}} mm colocado con éxito en {{toothFdi}}. Estabilidad primaria adecuada. Protocolo {{protocol}}.",
      P: "1) Indicaciones post-quirúrgicas escritas entregadas.\n2) Receta antibiótico/analgésico/clorhexidina.\n3) Cita retiro de sutura en {{sutureRemovalDays}} días.\n4) Control de oseointegración a 4 meses.",
    },
  },
  {
    key: "segunda_fase",
    name: "Segunda fase quirúrgica",
    description:
      "Descubrimiento del implante y colocación de pilar de cicatrización.",
    sortOrder: 30,
    proceduresPrefilled: ["cirugia_segunda_fase", "sutura_simple"],
    materialsPrefilled: ["pilar_cicatrizacion", "sutura_4_0"],
    soapTemplate: {
      S: "Paciente acude a segunda fase del implante {{toothFdi}}, colocado el {{placedAt}}. Asintomático. Higiene oral adecuada.",
      O: "Mucosa cubre el tornillo de cierre. Apertura de colgajo bajo anestesia local. Pilar de cicatrización lote {{healingAbutmentLot}}, {{healingDiameter}}×{{healingHeight}} mm. ISQ al descubrimiento: {{isq}}.",
      A: "Implante oseointegrado clínicamente. Mucosa peri-implantar a moldear durante 4 semanas.",
      P: "1) Sutura {{suture}}.\n2) Higiene con clorhexidina al 0.12% por 7 días.\n3) Cita en 4 semanas para inicio de fase protésica.",
    },
  },
  {
    key: "colocacion_pilar",
    name: "Colocación de pilar definitivo",
    description: "Conexión del pilar y registro de torque.",
    sortOrder: 40,
    proceduresPrefilled: ["colocacion_pilar_definitivo"],
    materialsPrefilled: ["pilar_definitivo", "torque_indicado"],
    soapTemplate: {
      S: "Paciente acude a colocación de pilar definitivo en implante {{toothFdi}}.",
      O: "Pilar {{abutmentType}} marca {{abutmentBrand}} lote {{abutmentLot}}. Torque {{abutmentTorque}} Ncm. Ajuste pasivo verificado radiográficamente.",
      A: "Pilar conectado correctamente. Encía periimplantar saludable.",
      P: "1) Toma de impresión definitiva.\n2) Color {{shade}}.\n3) Cita prueba de bizcocho en {{nextVisitDays}} días.",
    },
  },
  {
    key: "instalacion_corona",
    name: "Instalación de corona definitiva",
    description: "Entrega y atornillado/cementado de la corona.",
    sortOrder: 50,
    proceduresPrefilled: ["instalacion_corona_implante"],
    materialsPrefilled: [
      "corona_zirconia",
      "tornillo_protesico",
      "cemento_provisional",
    ],
    soapTemplate: {
      S: "Paciente acude a instalación de corona definitiva sobre implante {{toothFdi}}.",
      O: "Corona {{prosthesisType}} material {{prosthesisMaterial}}, laboratorio {{labName}} lote {{labLot}}. Tornillo lote {{screwLot}} torque {{screwTorque}} Ncm. Oclusión: {{occlusionScheme}}. Contactos proximales correctos.",
      A: "Rehabilitación implanto-soportada terminada en {{toothFdi}}. Carnet del implante generado.",
      P: "1) Indicaciones de higiene (cepillo interproximal Curaprox, hilo Super Floss).\n2) Control en 1 mes.\n3) Carnet entregado al paciente.",
    },
  },
  {
    key: "control_oseointegracion",
    name: "Control de oseointegración",
    description: "Visita de mantenimiento. Criterios Albrektsson 1986.",
    sortOrder: 60,
    proceduresPrefilled: ["control_implante", "radiografia_periapical"],
    materialsPrefilled: [],
    soapTemplate: {
      S: "Paciente acude a control de implante {{toothFdi}}. {{symptoms}}.",
      O: "BoP {{bop}}. PD máxima {{pdMax}} mm. Supuración {{suppuration}}. Movilidad {{mobility}}. Pérdida ósea radiográfica acumulada {{boneLoss}} mm. Oclusión estable {{occlusionStable}}.",
      A: "{{albrektsson}}. Estado periimplantar: {{periImplantStatus}}.",
      P: "1) {{maintenancePlan}}.\n2) {{referToPerio}}.\n3) Próximo control en {{nextControlMonths}} meses.",
    },
  },
];

export function getImplantEvolutionTemplate(
  key: ImplantEvolutionTemplate["key"],
): ImplantEvolutionTemplate {
  const t = IMPLANT_EVOLUTION_TEMPLATES.find((x) => x.key === key);
  if (!t) throw new Error(`Plantilla de evolución desconocida: ${key}`);
  return t;
}

/**
 * Convierte una plantilla builtin a EvolutionTemplateRecord — útil para
 * mostrarla en un picker que también lista plantillas de DB.
 */
export function builtinToRecord(
  tpl: ImplantEvolutionTemplate,
): EvolutionTemplateRecord {
  return {
    id: `builtin:${tpl.key}`,
    clinicId: null,
    module: "implants",
    name: tpl.name,
    key: tpl.key,
    soapTemplate: tpl.soapTemplate,
    proceduresPrefilled: tpl.proceduresPrefilled,
    materialsPrefilled: tpl.materialsPrefilled,
    isDefault: false,
  };
}

/**
 * Devuelve los builtins ordenados.
 */
export function listImplantEvolutionTemplates(): EvolutionTemplateRecord[] {
  return [...IMPLANT_EVOLUTION_TEMPLATES]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(builtinToRecord);
}
