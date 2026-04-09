import { Heart } from "lucide-react";
import SpecialtyPage, { buildSpecialtyMetadata } from "@/components/public/specialty-page";

export const metadata = buildSpecialtyMetadata({
  metaTitle: "Software para consultorios medicos | MediFlow",
  metaDescription: "Expediente clinico electronico completo para medicos generales. Diagnosticos CIE-10, signos vitales, prescripcion medica digital y notas de evolucion.",
});

const FEATURES = [
  { title: "Diagnosticos con CIE-10", desc: "Busqueda integrada del catalogo CIE-10 para codificar diagnosticos de forma estandarizada y compatible con sistemas de salud." },
  { title: "Signos vitales automatizados", desc: "Registro rapido de presion arterial, frecuencia cardiaca, temperatura, peso, talla e IMC con graficas de tendencia." },
  { title: "Prescripcion medica digital", desc: "Genera recetas medicas digitales con catalogo de medicamentos, dosis sugeridas, interacciones y envio por WhatsApp." },
  { title: "Notas de evolucion SOAP", desc: "Estructura tus consultas con el formato SOAP: Subjetivo, Objetivo, Analisis y Plan para documentacion clinica completa." },
  { title: "Referencias y contrarreferencias", desc: "Genera documentos de referencia a especialistas y recibe contrarreferencias digitales con seguimiento automatico." },
  { title: "Historial de medicamentos", desc: "Consulta el historial farmacologico completo del paciente con alergias, medicamentos activos y tratamientos previos." },
];

export default function MedicinaGeneralPage() {
  return (
    <SpecialtyPage
      name="Medicina General"
      slug="medicina-general"
      description="Expediente clinico electronico completo para medicos generales. Diagnosticos CIE-10, signos vitales, prescripcion medica digital, referencias y notas de evolucion."
      icon={Heart}
      iconColor="text-rose-400"
      bgColor="bg-rose-900/30"
      features={FEATURES}
      metaTitle="Software para consultorios medicos | MediFlow"
      metaDescription="Expediente clinico electronico completo para medicos generales."
    />
  );
}
