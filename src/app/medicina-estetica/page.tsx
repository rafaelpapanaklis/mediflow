import { Sparkles } from "lucide-react";
import SpecialtyPage, { buildSpecialtyMetadata } from "@/components/public/specialty-page";

export const metadata = buildSpecialtyMetadata({
  metaTitle: "Software para medicina estetica | MediFlow",
  metaDescription: "Gestion completa para clinicas de medicina estetica. Mapa facial de aplicacion, trazabilidad de productos por lote, fotos antes/despues estandarizadas.",
});

const FEATURES = [
  { title: "Mapa facial de aplicacion", desc: "Diagrama facial interactivo para registrar puntos exactos de inyeccion, unidades aplicadas y producto utilizado por zona." },
  { title: "Trazabilidad de producto por lote", desc: "Registro completo de lotes de toxina botulinica, fillers y PRP con fecha de caducidad, proveedor y pacientes tratados." },
  { title: "Fotos antes y despues", desc: "Sistema de fotografia estandarizada con angulos predefinidos, iluminacion controlada y comparacion automatica temporal." },
  { title: "Unidades por zona registradas", desc: "Historial detallado de unidades aplicadas por zona facial en cada sesion con dosis acumulada y fecha de proximo retoque." },
  { title: "Consentimiento por procedimiento", desc: "Plantillas de consentimiento informado especificas para cada procedimiento estetico con firma digital y almacenamiento legal." },
  { title: "Historial completo del paciente", desc: "Timeline visual de todos los procedimientos realizados con fotos, productos, unidades y resultados documentados." },
];

export default function MedicinaEsteticaPage() {
  return (
    <SpecialtyPage
      name="Medicina Estetica"
      slug="medicina-estetica"
      description="Gestion completa para clinicas de medicina estetica. Mapa facial de aplicacion, trazabilidad de productos por lote, fotos antes/despues estandarizadas y consentimientos digitales."
      icon={Sparkles}
      iconColor="text-purple-400"
      bgColor="bg-purple-900/30"
      features={FEATURES}
      metaTitle="Software para medicina estetica | MediFlow"
      metaDescription="Gestion completa para clinicas de medicina estetica."
    />
  );
}
