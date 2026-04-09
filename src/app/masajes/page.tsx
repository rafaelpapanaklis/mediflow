import { Hand } from "lucide-react";
import SpecialtyPage, { buildSpecialtyMetadata } from "@/components/public/specialty-page";

export const metadata = buildSpecialtyMetadata({
  metaTitle: "Software para centros de masajes | MediFlow",
  metaDescription: "Software para centros de masajes y terapia corporal. Mapa corporal interactivo de dolor, preferencia de presion, notas SOAP y seguimiento de progresion.",
});

const FEATURES = [
  { title: "Mapa corporal de dolor", desc: "Diagrama corporal interactivo donde el terapeuta marca zonas de tension, dolor y contracturas con niveles de intensidad." },
  { title: "Preferencia de presion 1-5", desc: "Registro de preferencia de presion del cliente en escala 1-5 con notas de zonas sensibles y areas a evitar por sesion." },
  { title: "Notas SOAP por sesion", desc: "Documentacion estructurada de cada sesion con hallazgos subjetivos, observaciones, analisis de tejido y plan de tratamiento." },
  { title: "Progresion entre sesiones", desc: "Seguimiento de mejoria entre sesiones con comparacion de mapas de dolor, rango de movimiento y bienestar reportado." },
  { title: "Checklist contraindicaciones", desc: "Cuestionario de salud obligatorio que filtra contraindicaciones absolutas y relativas antes de cada sesion de masaje." },
  { title: "Tecnicas por zona corporal", desc: "Registro de tecnicas aplicadas por zona anatomica con duracion, presion e instrucciones de cuidado post-sesion para el cliente." },
];

export default function MasajesPage() {
  return (
    <SpecialtyPage
      name="Masajes"
      slug="masajes"
      description="Software para centros de masajes y terapia corporal. Mapa corporal interactivo de dolor, preferencia de presion, notas SOAP y seguimiento de progresion entre sesiones."
      icon={Hand}
      iconColor="text-emerald-400"
      bgColor="bg-emerald-900/30"
      features={FEATURES}
      metaTitle="Software para centros de masajes | MediFlow"
      metaDescription="Software para centros de masajes y terapia corporal."
    />
  );
}
