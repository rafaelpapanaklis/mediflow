import { Scan } from "lucide-react";
import SpecialtyPage, { buildSpecialtyMetadata } from "@/components/public/specialty-page";

export const metadata = buildSpecialtyMetadata({
  metaTitle: "Software para dermatologos | MediFlow",
  metaDescription: "Registro fotografico profesional de lesiones cutaneas. Seguimiento visual de tratamientos dermatologicos, mapeo corporal de lunares y clasificacion de patologias.",
});

const FEATURES = [
  { title: "Registro fotografico de lesiones", desc: "Captura y almacena fotos de lesiones cutaneas con ubicacion anatomica, tamano medido y descripcion clinica estandarizada." },
  { title: "Mapeo corporal de lunares", desc: "Diagrama corporal interactivo para mapear y monitorear lunares con criterios ABCDE y alertas de cambio entre consultas." },
  { title: "Seguimiento visual de tratamientos", desc: "Compara fotos de antes y despues con vista lado a lado para documentar la efectividad de tratamientos dermatologicos." },
  { title: "Clasificacion de patologias", desc: "Catalogo de patologias dermatologicas con codigos CIE-10 especificos, guias de tratamiento y vinculacion al expediente." },
  { title: "Fotos antes y despues", desc: "Sistema estandarizado de fotografia clinica con angulos predefinidos, iluminacion consistente y comparacion temporal automatica." },
  { title: "Prescripcion dermatologica", desc: "Formulario de prescripcion especializado con magistrales, topicos, sistemicos y esquemas de tratamiento por patologia." },
];

export default function DermatologiaPage() {
  return (
    <SpecialtyPage
      name="Dermatologia"
      slug="dermatologia"
      description="Registro fotografico profesional de lesiones cutaneas. Seguimiento visual de tratamientos dermatologicos, mapeo corporal de lunares y clasificacion de patologias."
      icon={Scan}
      iconColor="text-amber-400"
      bgColor="bg-amber-900/30"
      features={FEATURES}
      metaTitle="Software para dermatologos | MediFlow"
      metaDescription="Registro fotografico profesional de lesiones cutaneas."
    />
  );
}
