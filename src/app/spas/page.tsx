import { Waves } from "lucide-react";
import SpecialtyPage, { buildSpecialtyMetadata } from "@/components/public/specialty-page";

export const metadata = buildSpecialtyMetadata({
  metaTitle: "Software para spas | MediFlow",
  metaDescription: "Gestion integral para spas y centros de bienestar. Reserva de salas y cabinas, circuitos termales, paquetes de pareja, membresias y aromaterapia.",
});

const FEATURES = [
  { title: "Reserva de salas y cabinas", desc: "Sistema de reserva por sala o cabina con capacidad, equipamiento disponible, horarios de limpieza y estado en tiempo real." },
  { title: "Circuitos termales programados", desc: "Gestion de circuitos de agua con horarios, capacidad maxima, duracion por estacion y control de acceso por reserva." },
  { title: "Paquetes de pareja", desc: "Paquetes especiales para parejas con reserva simultanea de dos cabinas, servicios coordinados y facturacion unificada." },
  { title: "Membresias con limite de visitas", desc: "Planes de membresia con numero de visitas incluidas, servicios adicionales con descuento y renovacion automatica." },
  { title: "Preferencias de aromaterapia", desc: "Registro de preferencias de aromas por cliente con alergias conocidas, aceites esenciales favoritos e intensidad deseada." },
  { title: "Cuestionario de salud integrado", desc: "Formulario de salud obligatorio pre-servicio que detecta contraindicaciones para tratamientos termales, masajes y terapias." },
];

export default function SpasPage() {
  return (
    <SpecialtyPage
      name="Spas"
      slug="spas"
      description="Gestion integral para spas y centros de bienestar. Reserva de salas y cabinas, circuitos termales, paquetes de pareja, membresias y control de aromaterapia."
      icon={Waves}
      iconColor="text-sky-400"
      bgColor="bg-sky-900/30"
      features={FEATURES}
      metaTitle="Software para spas | MediFlow"
      metaDescription="Gestion integral para spas y centros de bienestar."
    />
  );
}
