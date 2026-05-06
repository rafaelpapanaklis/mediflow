// Clinical-shared — seed de las 6 plantillas de Ortodoncia.
//
// Se crea on-demand la primera vez que se abre el picker para Orto.
// Idempotente vía upsert por (clinicId, module, name).

import { prisma } from "@/lib/prisma";
import type { SoapTemplateBody } from "./types";

interface SeedTemplate {
  name: string;
  isDefault: boolean;
  soap: SoapTemplateBody;
  procedures: string[];
  materials: string[];
}

export const ORTHO_DEFAULT_TEMPLATES: readonly SeedTemplate[] = [
  {
    name: "Cementado de brackets",
    isDefault: true,
    soap: {
      S: "Paciente acude para cementado de aparatología fija en arcada {{arch}}. Refiere comprensión del consentimiento. Sin alergias conocidas a resinas dentales.",
      O: "Higiene aceptable. Profilaxis previa con piedra pómez. Aislamiento relativo. Esmalte sano sin caries activas en zonas a cementar.",
      A: "Caso indicado para inicio de fase activa con técnica {{technique}}. Tipo de bracket: {{bracketType}}. Slot: {{slot}}.",
      P: "Grabado ácido 30s, lavado y secado. Imprimación. Cementado de brackets de {{toothFdis}} con resina fotopolimerizable. Inserción de arco inicial NiTi {{archWire}}. Indicaciones de higiene con cepillo ortodóntico, hilo con enhebrador y enjuague con flúor 0.05% diario. Próximo control en 4 semanas.",
    },
    procedures: ["cementado_brackets"],
    materials: ["resina_ortodontica_fotocurada", "acido_grabador", "primer_orto", "arco_niti_inicial"],
  },
  {
    name: "Activación de arco",
    isDefault: false,
    soap: {
      S: "Paciente en mes {{monthInTreatment}} de tratamiento. Refiere {{patientReports}} desde último control. Aparatología íntegra / con incidencias.",
      O: "Aparatología fija sin desadaptaciones generalizadas. Brackets sueltos: {{bracketsLooseFdis}}. Higiene oral score: {{hygieneScore}}/100. Movimientos esperados verificados clínicamente.",
      A: "Progreso clínico {{progressAssessment}} acorde a lo planificado para fase {{currentPhase}}. Cumplimiento de elásticos: {{elasticCompliance}}.",
      P: "Cambio a arco {{newArchWire}}. Re-cementado de brackets sueltos. Cambio de ligaduras. Activación de mecánica de {{mechanics}}. Indicación de elásticos {{elasticPrescription}}. Próxima cita: 4 semanas.",
    },
    procedures: ["activacion_arco", "cambio_ligaduras"],
    materials: ["arco_niti", "ligaduras_elasticas", "elasticos_intermaxilares"],
  },
  {
    name: "Control mensual general",
    isDefault: true,
    soap: {
      S: "Control mensual rutinario. Paciente refiere {{patientReports}}. Sin urgencias entre citas.",
      O: "Aparatología íntegra. Higiene oral score: {{hygieneScore}}/100. Sin signos de descalcificación. Encías sin inflamación generalizada.",
      A: "Tratamiento progresando dentro de los tiempos estimados. Mes {{monthInTreatment}} de {{estimatedDurationMonths}}. Fase actual: {{currentPhase}}.",
      P: "Continuar con plan establecido. Refuerzo de higiene. Próxima cita en 4 semanas. Recordar al paciente la siguiente fase prevista.",
    },
    procedures: ["control_mensual_orto"],
    materials: [],
  },
  {
    name: "Cambio de alineador",
    isDefault: false,
    soap: {
      S: "Paciente acude para entrega de siguiente set de alineadores {{nextStageNumber}} de {{totalStages}}. Reporta uso ≥ {{wearHours}} horas/día y cumplimiento {{trackingCompliance}}.",
      O: "Tracking clínico {{trackingStatus}}. Sin debonding generalizado de attachments. Verificación de fit del último alineador del set previo.",
      A: "Avance acorde a setup digital. Refinamiento {{refinementDecision}} esperado en próximas etapas.",
      P: "Entrega de alineadores {{nextStageNumber}}-{{nextStageEnd}}. Indicación de uso 22h/día, recambio cada {{intervalDays}} días. Reforzar uso de chewies. Próximo control en {{controlIntervalWeeks}} semanas.",
    },
    procedures: ["entrega_alineadores"],
    materials: ["alineadores_polimerico", "attachments_resina"],
  },
  {
    name: "Retiro de brackets",
    isDefault: false,
    soap: {
      S: "Paciente acude a retiro de aparatología fija. Cumple criterios oclusales y estéticos del plan. Tutor / paciente informado del protocolo de retención.",
      O: "Oclusión Clase I funcional. Líneas medias coincidentes ±0.5mm. Overjet/overbite dentro de objetivo. Resaltes y diastemas cerrados.",
      A: "Caso terminado en fase activa. Proceder a fase de retención según plan establecido.",
      P: "Retiro de brackets de {{toothFdis}}. Eliminación de remanentes de resina con fresa. Pulido final. Toma de impresiones / scan digital para retenedores. Próxima cita en 3-7 días para entrega de retenedores. Educación al paciente sobre cumplimiento de retención permanente.",
    },
    procedures: ["retiro_brackets", "toma_impresiones_finales"],
    materials: ["fresa_remoción_resina", "pasta_pulido"],
  },
  {
    name: "Entrega de retenedor",
    isDefault: false,
    soap: {
      S: "Paciente acude para entrega de retenedor {{retainerType}}. Sin molestias post-retiro. Tutor / paciente comprende protocolo de retención.",
      O: "Verificación de adaptación del retenedor sobre arcadas. Sin puntos de presión excesiva. Movilidad dentaria normal post-retiro.",
      A: "Fase de retención iniciada. Estabilización oclusal pendiente de monitorear en próximos 6-12 meses.",
      P: "Entrega de retenedor {{retainerType}}. Indicación de uso: {{wearProtocol}}. Higiene del retenedor: cepillado diario sin pasta abrasiva, limpieza efervescente semanal. Próximo control en 1 mes, después cada 3 meses durante 1 año, después semestral.",
    },
    procedures: ["entrega_retenedor", "verificacion_retencion"],
    materials: ["retenedor_essix", "retenedor_hawley", "barra_lingual_3a3"],
  },
];

/**
 * Crea las 6 plantillas Orto default si no existen. Idempotente vía upsert.
 * Retorna cuántas fueron creadas en esta llamada.
 */
export async function ensureOrthoDefaults(args: {
  clinicId: string;
  createdBy: string;
}): Promise<{ created: number; total: number }> {
  let created = 0;
  for (const t of ORTHO_DEFAULT_TEMPLATES) {
    const result = await prisma.clinicalEvolutionTemplate.upsert({
      where: {
        clinicId_module_name: {
          clinicId: args.clinicId,
          module: "orthodontics",
          name: t.name,
        },
      },
      create: {
        clinicId: args.clinicId,
        module: "orthodontics",
        name: t.name,
        soapTemplate: t.soap as unknown as object,
        proceduresPrefilled: t.procedures,
        materialsPrefilled: t.materials,
        isDefault: t.isDefault,
        createdBy: args.createdBy,
      },
      update: {},
      select: { id: true, createdAt: true, updatedAt: true },
    });
    if (result.createdAt.getTime() === result.updatedAt.getTime()) {
      created++;
    }
  }
  return { created, total: ORTHO_DEFAULT_TEMPLATES.length };
}
