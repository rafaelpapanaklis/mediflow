import { Brain } from "lucide-react";
import SpecialtyPage, { buildSpecialtyMetadata } from "@/components/public/specialty-page";

export const metadata = buildSpecialtyMetadata({
  metaTitle: "Software para psicologos | MediFlow",
  metaDescription: "Notas clinicas estructuradas para psicologos. Formatos SOAP, BIRP y DAP. Escalas estandarizadas PHQ-9 y GAD-7. Plan terapeutico con objetivos medibles.",
});

const FEATURES = [
  { title: "Notas SOAP BIRP y DAP", desc: "Elige entre tres formatos de nota clinica estandarizados segun tu enfoque terapeutico. Plantillas prellenadas para agilizar la documentacion." },
  { title: "Escalas PHQ-9 y GAD-7", desc: "Aplica escalas de depresion y ansiedad validadas con puntuacion automatica, interpretacion y graficas de evolucion entre sesiones." },
  { title: "Plan terapeutico con metas", desc: "Define objetivos terapeuticos medibles con indicadores de progreso, plazos estimados y revision periodica del plan." },
  { title: "Alerta de riesgo al paciente", desc: "Sistema de banderas de riesgo para ideacion suicida, autolesion o crisis que notifica y documenta la intervencion realizada." },
  { title: "Seguimiento entre sesiones", desc: "Asigna tareas terapeuticas entre sesiones con registro de cumplimiento y notas del paciente desde el portal." },
  { title: "Consentimiento informado digital", desc: "Plantillas de consentimiento informado personalizables con firma digital del paciente y almacenamiento seguro en el expediente." },
];

export default function PsicologiaPage() {
  return (
    <SpecialtyPage
      name="Psicologia"
      slug="psicologia"
      description="Notas clinicas estructuradas para psicologos. Formatos SOAP, BIRP y DAP. Escalas estandarizadas PHQ-9 y GAD-7. Plan terapeutico con objetivos medibles y seguimiento de progreso."
      icon={Brain}
      iconColor="text-violet-400"
      bgColor="bg-violet-900/30"
      features={FEATURES}
      metaTitle="Software para psicologos | MediFlow"
      metaDescription="Notas clinicas estructuradas para psicologos."
    />
  );
}
