import { Scissors } from "lucide-react";
import SpecialtyPage, { buildSpecialtyMetadata } from "@/components/public/specialty-page";

export const metadata = buildSpecialtyMetadata({
  metaTitle: "Software para clinicas capilares | MediFlow",
  metaDescription: "Software para clinicas de restauracion capilar. Clasificacion Norwood/Ludwig, registro de grafts implantados, mapa de cuero cabelludo.",
});

const FEATURES = [
  { title: "Escala Norwood y Ludwig", desc: "Clasificacion estandarizada de alopecia masculina y femenina con registro fotografico de progresion y comparacion temporal." },
  { title: "Conteo de grafts por zona", desc: "Registro detallado de unidades foliculares extraidas e implantadas por zona donadora y receptora con densidad calculada." },
  { title: "Mapa de cuero cabelludo", desc: "Diagrama interactivo del cuero cabelludo para planificar zonas de extraccion, implantacion y documentar cobertura lograda." },
  { title: "Seguimiento folicular 3/6/12 meses", desc: "Protocolo de seguimiento a 3, 6 y 12 meses con fotos estandarizadas para evaluar supervivencia y crecimiento folicular." },
  { title: "Fotos estandarizadas por angulo", desc: "Sistema de captura fotografica con angulos predefinidos (frontal, vertex, temporal) para documentacion y marketing consistentes." },
  { title: "Bitacora quirurgica completa", desc: "Registro detallado de cada procedimiento: equipo utilizado, duracion, tecnica, grafts por sesion y observaciones del cirujano." },
];

export default function ClinicasCapilaresPage() {
  return (
    <SpecialtyPage
      name="Clinicas Capilares"
      slug="clinicas-capilares"
      description="Software para clinicas de restauracion capilar. Clasificacion Norwood/Ludwig, registro de grafts implantados, mapa de cuero cabelludo y seguimiento de supervivencia folicular."
      icon={Scissors}
      iconColor="text-indigo-400"
      bgColor="bg-indigo-900/30"
      features={FEATURES}
      metaTitle="Software para clinicas capilares | MediFlow"
      metaDescription="Software para clinicas de restauracion capilar."
    />
  );
}
