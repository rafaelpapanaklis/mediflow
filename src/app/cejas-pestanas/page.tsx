import { Eye } from "lucide-react";
import SpecialtyPage, { buildSpecialtyMetadata } from "@/components/public/specialty-page";

export const metadata = buildSpecialtyMetadata({
  metaTitle: "Software para cejas y pestanas | MediFlow",
  metaDescription: "Gestion especializada para estudios de cejas y pestanas. Mapa de extensiones, historial de formulas, control de patch test y agendamiento de refills.",
});

const FEATURES = [
  { title: "Mapa de extensiones lash", desc: "Diagrama de ojo con mapeo de longitud, curvatura y grosor de extension por seccion para replicar el diseno en cada refill." },
  { title: "Historial de formulas de color", desc: "Registro de formulas de tinte utilizadas por cliente con marca, tiempo de exposicion y resultado obtenido para reproducibilidad." },
  { title: "Control de patch test obligatorio", desc: "Sistema de alerta que impide agendar servicios sin patch test vigente. Registro de fecha, resultado y vencimiento a 6 meses." },
  { title: "Agendamiento de refills", desc: "Programa refills automaticos a 2-3 semanas con recordatorio por WhatsApp y bloqueo de tiempo segun el tipo de servicio." },
  { title: "Forma de ojo del paciente", desc: "Clasificacion de forma de ojo del cliente para recomendar estilos de extension y tecnicas de aplicacion personalizadas." },
  { title: "Fotos de diseno antes/despues", desc: "Galeria fotografica por cliente con fotos de cada visita para documentar resultados y facilitar la consulta en el proximo servicio." },
];

export default function CejasPestanasPage() {
  return (
    <SpecialtyPage
      name="Cejas y Pestanas"
      slug="cejas-pestanas"
      description="Gestion especializada para estudios de cejas y pestanas. Mapa de extensiones, historial de formulas, control de patch test y agendamiento de refills automatico."
      icon={Eye}
      iconColor="text-fuchsia-400"
      bgColor="bg-fuchsia-900/30"
      features={FEATURES}
      metaTitle="Software para cejas y pestanas | MediFlow"
      metaDescription="Gestion especializada para estudios de cejas y pestanas."
    />
  );
}
