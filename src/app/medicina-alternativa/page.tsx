import { Leaf } from "lucide-react";
import SpecialtyPage, { buildSpecialtyMetadata } from "@/components/public/specialty-page";

export const metadata = buildSpecialtyMetadata({
  metaTitle: "Software para medicina alternativa | MediFlow",
  metaDescription: "Expediente para terapeutas alternativos. Mapa de meridianos y puntos de acupuntura, formulas herbales, diagnostico TCM y seguimiento multi-sesion.",
});

const FEATURES = [
  { title: "Mapa de puntos de acupuntura", desc: "Diagrama corporal con meridianos y puntos de acupuntura seleccionables para registrar cada sesion con tecnica y estimulacion aplicada." },
  { title: "Formulas herbales por paciente", desc: "Registro de formulas herbales personalizadas con ingredientes, proporciones, metodo de preparacion e instrucciones de consumo." },
  { title: "Diagnostico TCM completo", desc: "Formulario de diagnostico de Medicina Tradicional China con patrones de desarreglo, principio de tratamiento y estrategia terapeutica." },
  { title: "Observacion de lengua y pulso", desc: "Registro estructurado de diagnostico por lengua (color, forma, saburra) y pulso (frecuencia, fuerza, calidad) con fotos de referencia." },
  { title: "Seguimiento multi-sesion", desc: "Plan de tratamiento con numero de sesiones programadas, objetivos por fase y evaluacion de progreso con cuestionarios." },
  { title: "Recetas de herbolaria", desc: "Genera recetas de herbolaria digitales con dosis, frecuencia, duracion del tratamiento y precauciones especiales para el paciente." },
];

export default function MedicinaAlternativaPage() {
  return (
    <SpecialtyPage
      name="Medicina Alternativa"
      slug="medicina-alternativa"
      description="Expediente para terapeutas alternativos. Mapa de meridianos y puntos de acupuntura, formulas herbales, diagnostico TCM y seguimiento de tratamientos multi-sesion."
      icon={Leaf}
      iconColor="text-lime-400"
      bgColor="bg-lime-900/30"
      features={FEATURES}
      metaTitle="Software para medicina alternativa | MediFlow"
      metaDescription="Expediente para terapeutas alternativos."
    />
  );
}
