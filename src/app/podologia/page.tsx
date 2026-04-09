import { Footprints } from "lucide-react";
import SpecialtyPage, { buildSpecialtyMetadata } from "@/components/public/specialty-page";

export const metadata = buildSpecialtyMetadata({
  metaTitle: "Software para podologos | MediFlow",
  metaDescription: "Herramientas especializadas para podologos. Diagrama interactivo del pie, evaluacion de riesgo diabetico, pipeline de ortesis y seguimiento de heridas.",
});

const FEATURES = [
  { title: "Diagrama interactivo del pie", desc: "Mapa digital del pie con zonas seleccionables para registrar patologias, callosidades, deformidades y puntos de presion." },
  { title: "Riesgo pie diabetico clasificado", desc: "Evaluacion de riesgo del pie diabetico con clasificacion de Wagner, escala de Texas y protocolo de seguimiento por nivel." },
  { title: "Pipeline de ortesis completo", desc: "Flujo de trabajo completo para ortesis: toma de molde, diseno, fabricacion, entrega y ajustes con trazabilidad de cada etapa." },
  { title: "Medicion y fotos de heridas", desc: "Registro fotografico de heridas con medicion de area, profundidad, tipo de tejido y seguimiento de cicatrizacion entre curaciones." },
  { title: "Evaluacion biomecanica", desc: "Documentacion de marcha, apoyo plantar, alineacion de miembros inferiores y recomendaciones de calzado basadas en hallazgos." },
  { title: "Recall automatico por riesgo", desc: "Sistema de recall que agenda automaticamente la proxima revision segun el nivel de riesgo del paciente con notificacion por WhatsApp." },
];

export default function PodologiaPage() {
  return (
    <SpecialtyPage
      name="Podologia"
      slug="podologia"
      description="Herramientas especializadas para podologos. Diagrama interactivo del pie, evaluacion de riesgo diabetico, pipeline de ortesis y seguimiento de heridas con mediciones."
      icon={Footprints}
      iconColor="text-orange-400"
      bgColor="bg-orange-900/30"
      features={FEATURES}
      metaTitle="Software para podologos | MediFlow"
      metaDescription="Herramientas especializadas para podologos."
    />
  );
}
