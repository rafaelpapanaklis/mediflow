// Clinical-shared — seed de las 5 plantillas pediátricas.
//
// Se crea on-demand la primera vez que un usuario abre el picker para
// el módulo Pediatría. ensurePediatricDefaults() es idempotente vía
// upsert por (clinicId, module, name).

import { prisma } from "@/lib/prisma";
import type { SoapTemplateBody } from "./types";

interface SeedTemplate {
  name: string;
  isDefault: boolean;
  soap: SoapTemplateBody;
  procedures: string[];
  materials: string[];
}

export const PEDIATRIC_DEFAULT_TEMPLATES: readonly SeedTemplate[] = [
  {
    name: "Profilaxis pediátrica",
    isDefault: true,
    soap: {
      S: "Paciente acude para limpieza dental rutinaria. Sin molestias reportadas. Tutor refiere higiene oral 2 veces al día con cepillo infantil y pasta con flúor 1000 ppm.",
      O: "Higiene oral aceptable. Presencia de placa bacteriana en zonas posteriores y línea gingival. Encías sin signos de inflamación generalizada. Esmalte sano sin caries activas detectadas en exploración visual y táctil.",
      A: "Estado de salud bucal estable. Riesgo cariogénico bajo a moderado según CAMBRA. Continuar con visitas semestrales.",
      P: "Profilaxis con copa de hule y pasta profiláctica. Refuerzo de técnica de cepillado al tutor. Recomendación de uso de hilo dental supervisado. Próxima cita: 6 meses.",
    },
    procedures: ["profilaxis_pediatrica"],
    materials: ["pasta_profilactica", "copa_hule"],
  },
  {
    name: "Aplicación de sellantes",
    isDefault: false,
    soap: {
      S: "Paciente referido para colocación de sellantes en molares permanentes recién erupcionados. Sin dolor ni sensibilidad reportados. Cooperativo durante exploración previa.",
      O: "Molar(es) {{toothFdi}} con fosas y fisuras profundas, esmalte sano sin caries. Aislamiento posible con dique de hule o rollos de algodón. Conducta Frankl 3-4.",
      A: "Indicada técnica preventiva de sellante de fosas y fisuras. Bajo riesgo cariogénico actual con probabilidad de retención adecuada del material.",
      P: "Aislamiento absoluto/relativo. Profilaxis con piedra pómez. Grabado ácido 15 segundos, lavado y secado. Aplicación de sellante resinoso fotopolimerizable. Verificación oclusal. Control en 6 meses.",
    },
    procedures: ["sellantes_aplicacion"],
    materials: ["sellante_resina_fotocurada", "acido_grabador", "piedra_pomez"],
  },
  {
    name: "Fluoruro tópico (barniz)",
    isDefault: false,
    soap: {
      S: "Paciente acude para aplicación preventiva de fluoruro semestral. Tutor reporta uso de pasta dental con flúor 1000 ppm en casa.",
      O: "Dentición {{dentition}} sin lesiones cariogénicas activas detectadas. Higiene oral adecuada. Sin contraindicación sistémica para flúor tópico (NaF 5%).",
      A: "Aplicación de fluoruro indicada como medida preventiva en paciente con riesgo cariogénico moderado-alto. CAMBRA actualizado.",
      P: "Limpieza con copa de hule. Secado de superficies. Aplicación de barniz de fluoruro de sodio al 5% (NaF) con pincel. Indicaciones al tutor: no comer ni beber líquidos calientes en 30 min, evitar cepillado por 4 horas. Próxima aplicación: 6 meses.",
    },
    procedures: ["fluoruro_topico_aplicacion"],
    materials: ["barniz_naf_5pct", "copa_hule"],
  },
  {
    name: "Evaluación conductual (Frankl)",
    isDefault: false,
    soap: {
      S: "Cita inicial / control conductual. Tutor reporta {{conductReport}}. Paciente con experiencia previa odontológica {{previousVisits}}.",
      O: "Comportamiento durante la cita evaluado mediante escala de Frankl. Cooperación al subir al sillón, apertura bucal, tolerancia al espejo y explorador. Manejo conductual aplicado: técnica decir-mostrar-hacer / refuerzo positivo.",
      A: "Frankl {{franklScore}} ({{franklLabel}}). {{cambraCategory}} categoría de riesgo cariogénico. Plan conductual ajustado.",
      P: "Continuar técnicas de manejo conductual no farmacológico. Reforzar relación odontólogo-paciente-tutor. Próximas citas con incrementos graduales de complejidad. Considerar pre-medicación o sedación consciente si Frankl ≤ 2 en 3 visitas consecutivas.",
    },
    procedures: ["evaluacion_conductual_frankl"],
    materials: [],
  },
  {
    name: "Control de hábitos orales",
    isDefault: false,
    soap: {
      S: "Tutor consulta por hábito de {{habitType}}. Frecuencia reportada: {{habitFrequency}}. Edad de inicio aprox: {{habitStartAge}}. Intentos previos de eliminación: {{habitAttempts}}.",
      O: "Exploración intra y extraoral en busca de signos secundarios al hábito (mordida abierta anterior, protrusión de incisivos, paladar ojival, callosidad digital). Evaluación funcional respiratoria/deglutoria.",
      A: "Hábito oral {{habitType}} {{habitImpact}}. Recomendación de {{interventionLevel}} (consejería / refuerzo positivo / aparato disuasivo).",
      P: "Educación al tutor sobre origen y consecuencias del hábito. Plan de eliminación gradual con calendario de refuerzo. Cita de control en 4 semanas. Si no hay reducción en 8 semanas, considerar interconsulta con ortodoncia para aparato funcional.",
    },
    procedures: ["control_habitos_orales"],
    materials: [],
  },
];

/**
 * Crea las 5 plantillas pediátricas default si la clínica todavía no las
 * tiene. Idempotente vía upsert por (clinicId, module, name).
 * Retorna cuántas plantillas fueron creadas en esta llamada.
 */
export async function ensurePediatricDefaults(args: {
  clinicId: string;
  createdBy: string;
}): Promise<{ created: number; total: number }> {
  let created = 0;
  for (const t of PEDIATRIC_DEFAULT_TEMPLATES) {
    const result = await prisma.clinicalEvolutionTemplate.upsert({
      where: {
        clinicId_module_name: {
          clinicId: args.clinicId,
          module: "pediatrics",
          name: t.name,
        },
      },
      create: {
        clinicId: args.clinicId,
        module: "pediatrics",
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
  return { created, total: PEDIATRIC_DEFAULT_TEMPLATES.length };
}
