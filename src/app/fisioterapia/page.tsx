import { Activity } from "lucide-react";
import SpecialtyPage, { buildSpecialtyMetadata } from "@/components/public/specialty-page";

export const metadata = buildSpecialtyMetadata({
  metaTitle: "Software para fisioterapeutas | MediFlow",
  metaDescription: "Expediente especializado para fisioterapeutas. Medicion de rangos de movimiento, escala de dolor VAS, programa de ejercicios en casa y seguimiento de rehabilitacion.",
});

const FEATURES = [
  { title: "Mediciones ROM por articulacion", desc: "Registra rangos de movimiento activos y pasivos por articulacion con goniometro digital y graficas de progreso entre sesiones." },
  { title: "Escala de dolor VAS/NRS", desc: "Evaluacion estandarizada de dolor con escalas visual analogica y numerica. Seguimiento de tendencia y correlacion con tratamiento." },
  { title: "Programa de ejercicios (HEP)", desc: "Biblioteca de ejercicios con video e instrucciones. Crea programas personalizados y envialos al paciente por WhatsApp." },
  { title: "Seguimiento de rehabilitacion", desc: "Timeline de rehabilitacion con fases, objetivos por etapa, criterios de progresion y porcentaje de avance general." },
  { title: "Scores funcionales LEFS/DASH", desc: "Aplica cuestionarios funcionales validados con puntuacion automatica para medir limitacion y documentar mejoria objetiva." },
  { title: "Sesiones autorizadas vs realizadas", desc: "Control de sesiones autorizadas por aseguradora versus realizadas con alertas de limite proximo y reportes para renovacion." },
];

export default function FisioterapiaPage() {
  return (
    <SpecialtyPage
      name="Fisioterapia"
      slug="fisioterapia"
      description="Expediente especializado para fisioterapeutas. Medicion de rangos de movimiento, escala de dolor VAS, programa de ejercicios en casa y seguimiento de rehabilitacion."
      icon={Activity}
      iconColor="text-teal-400"
      bgColor="bg-teal-900/30"
      features={FEATURES}
      metaTitle="Software para fisioterapeutas | MediFlow"
      metaDescription="Expediente especializado para fisioterapeutas."
    />
  );
}
