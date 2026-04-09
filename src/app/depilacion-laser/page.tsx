import { Zap } from "lucide-react";
import SpecialtyPage, { buildSpecialtyMetadata } from "@/components/public/specialty-page";

export const metadata = buildSpecialtyMetadata({
  metaTitle: "Software para depilacion laser | MediFlow",
  metaDescription: "Control total para clinicas de depilacion laser. Sesiones por zona corporal, parametros de maquina, fototipo Fitzpatrick y paquetes prepagados.",
});

const FEATURES = [
  { title: "Sesiones por zona corporal", desc: "Control de sesiones realizadas por cada zona corporal con fecha, parametros y foto de resultado para seguimiento completo." },
  { title: "Parametros de maquina registrados", desc: "Registro de fluencia, ancho de pulso, tamano de spot y sistema de enfriamiento utilizado en cada sesion por zona." },
  { title: "Fototipo Fitzpatrick del paciente", desc: "Clasificacion de fototipo de piel del paciente para determinar parametros seguros y protocolos de tratamiento adecuados." },
  { title: "Paquetes prepagados por zona", desc: "Venta de paquetes de sesiones por zona corporal con control de redenciones, vencimiento y opcion de agregar zonas." },
  { title: "Fotos antes y despues", desc: "Documentacion fotografica del area tratada antes de la primera sesion y despues de cada aplicacion para evidenciar reduccion." },
  { title: "Intervalos entre sesiones", desc: "Calculo automatico del intervalo recomendado entre sesiones segun zona y fase de tratamiento con agendamiento integrado." },
];

export default function DepilacionLaserPage() {
  return (
    <SpecialtyPage
      name="Depilacion Laser"
      slug="depilacion-laser"
      description="Control total para clinicas de depilacion laser. Sesiones por zona corporal, parametros de maquina, fototipo Fitzpatrick y paquetes prepagados con seguimiento automatico."
      icon={Zap}
      iconColor="text-yellow-400"
      bgColor="bg-yellow-900/30"
      features={FEATURES}
      metaTitle="Software para depilacion laser | MediFlow"
      metaDescription="Control total para clinicas de depilacion laser."
    />
  );
}
