import { Scissors } from "lucide-react";
import SpecialtyPage, { buildSpecialtyMetadata } from "@/components/public/specialty-page";

export const metadata = buildSpecialtyMetadata({
  metaTitle: "Software para peluquerias y barberias | MediFlow",
  metaDescription: "Gestion completa para salones de belleza y barberias. Libro de formulas de color, historial de servicios, lista de espera walk-in y comisiones por estilista.",
});

const FEATURES = [
  { title: "Libro de formulas de color", desc: "Registro detallado de formulas de color por cliente: marca, linea, proporcion de mezcla, volumen de peroxido y tiempo de exposicion." },
  { title: "Historial por cliente", desc: "Timeline completo de servicios por cliente con fotos de cada visita, productos usados, estilista asignado y notas especiales." },
  { title: "Lista de espera walk-in", desc: "Cola digital de espera para clientes sin cita con tiempo estimado, asignacion de estilista disponible y notificacion por SMS." },
  { title: "Agenda por estilista", desc: "Vista de agenda individual por estilista con duracion estimada por servicio, descansos y capacidad de atencion diaria." },
  { title: "Productos usados por servicio", desc: "Registro de productos y cantidades utilizadas en cada servicio para control de inventario y calculo de costo real por atencion." },
  { title: "Repetir formula anterior", desc: "Acceso rapido a la ultima formula de color del cliente con un clic para replicar el servicio anterior sin busqueda manual." },
];

export default function PeluqueriasPage() {
  return (
    <SpecialtyPage
      name="Peluquerias y Barberias"
      slug="peluquerias"
      description="Gestion completa para salones de belleza y barberias. Libro de formulas de color, historial de servicios, lista de espera walk-in y comisiones por estilista."
      icon={Scissors}
      iconColor="text-cyan-400"
      bgColor="bg-cyan-900/30"
      features={FEATURES}
      metaTitle="Software para peluquerias y barberias | MediFlow"
      metaDescription="Gestion completa para salones de belleza y barberias."
    />
  );
}
