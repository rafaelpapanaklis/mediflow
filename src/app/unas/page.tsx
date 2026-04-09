import { Palette } from "lucide-react";
import SpecialtyPage, { buildSpecialtyMetadata } from "@/components/public/specialty-page";

export const metadata = buildSpecialtyMetadata({
  metaTitle: "Software para salones de unas | MediFlow",
  metaDescription: "Software para salones de unas. Historial de disenos por cliente, galeria de nail art, lista de espera walk-in y control de materiales.",
});

const FEATURES = [
  { title: "Historial de disenos por cliente", desc: "Registro fotografico de cada diseno realizado por cliente con tecnica utilizada, colores, materiales y nivel de satisfaccion." },
  { title: "Galeria de nail art", desc: "Biblioteca visual de disenos disponibles organizados por estilo, temporada y tendencia para que los clientes elijan en consulta." },
  { title: "Lista de espera walk-in", desc: "Cola digital de espera para clientes sin cita con tiempo estimado por servicio, tecnico disponible y notificacion de turno." },
  { title: "Forma de una preferida", desc: "Registro de preferencia de forma de una del cliente (almendra, coffin, cuadrada, ovalada) para replicar en cada visita." },
  { title: "Control de materiales", desc: "Inventario de esmaltes, geles, acrilicos y decoraciones con control de uso por servicio, alertas de stock minimo y reposicion." },
  { title: "Agenda por tecnico", desc: "Vista de agenda individual por tecnico con duracion estimada por tipo de servicio, disponibilidad y productividad diaria." },
];

export default function UnasPage() {
  return (
    <SpecialtyPage
      name="Unas"
      slug="unas"
      description="Software para salones de unas. Historial de disenos por cliente, galeria de nail art, lista de espera walk-in y control de materiales usados por servicio."
      icon={Palette}
      iconColor="text-red-400"
      bgColor="bg-red-900/30"
      features={FEATURES}
      metaTitle="Software para salones de unas | MediFlow"
      metaDescription="Software para salones de unas."
    />
  );
}
