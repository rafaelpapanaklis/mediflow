import { Stethoscope } from "lucide-react";
import SpecialtyPage, { buildSpecialtyMetadata } from "@/components/public/specialty-page";

export const metadata = buildSpecialtyMetadata({
  metaTitle: "Software dental para clinicas | MediFlow",
  metaDescription: "Software especializado para consultorios dentales. Odontograma digital interactivo, periodontograma, planes de tratamiento por pieza y control de presupuestos dentales.",
});

const FEATURES = [
  { title: "Odontograma adulto e infantil", desc: "Registra tratamientos, hallazgos y estados por pieza dental en un diagrama interactivo para pacientes adultos y pediatricos." },
  { title: "Periodontograma digital", desc: "Evaluacion periodontal completa con profundidad de sondeo, sangrado, movilidad y nivel de insercion clinica por sextante." },
  { title: "Planes de tratamiento por pieza", desc: "Crea planes de tratamiento detallados vinculados a cada pieza dental con costos, prioridad y estado de avance." },
  { title: "Radiografias y fotos intraorales", desc: "Almacena radiografias panoramicas, periapicales y fotos intraorales directamente en el expediente del paciente." },
  { title: "Presupuestos dentales automaticos", desc: "Genera presupuestos profesionales a partir del plan de tratamiento con desglose por pieza y opcion de pago a plazos." },
  { title: "Historial clinico por diente", desc: "Consulta el historial completo de cada pieza dental: tratamientos previos, materiales usados, fechas y fotografias." },
];

export default function DentalPage() {
  return (
    <SpecialtyPage
      name="Odontologia"
      slug="dental"
      description="Software especializado para consultorios dentales. Odontograma digital interactivo, periodontograma, planes de tratamiento por pieza, radiografias digitales y control de presupuestos dentales."
      icon={Stethoscope}
      iconColor="text-blue-400"
      bgColor="bg-blue-900/30"
      features={FEATURES}
      metaTitle="Software dental para clinicas | MediFlow"
      metaDescription="Software especializado para consultorios dentales."
    />
  );
}
