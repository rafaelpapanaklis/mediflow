import { Star } from "lucide-react";
import SpecialtyPage, { buildSpecialtyMetadata } from "@/components/public/specialty-page";

export const metadata = buildSpecialtyMetadata({
  metaTitle: "Software para centros de estetica | MediFlow",
  metaDescription: "Todo lo que necesitas para gestionar tu centro de estetica. Paquetes de sesiones, control de bonos, aparatologia y seguimiento de tratamientos.",
});

const FEATURES = [
  { title: "Paquetes de sesiones prepagadas", desc: "Vende paquetes de sesiones con control automatico de redenciones, vencimiento, transferencias y saldo restante del cliente." },
  { title: "Control de bonos y membresias", desc: "Gestiona membresias mensuales y anuales con beneficios, descuentos exclusivos y renovacion automatica con recordatorio." },
  { title: "Tratamientos faciales y corporales", desc: "Catalogo completo de tratamientos faciales y corporales con protocolos, duracion, productos necesarios y contraindicaciones." },
  { title: "Aparatologia con seguimiento", desc: "Registro de sesiones por tipo de aparato con parametros utilizados, reacciones observadas y progreso fotografico del tratamiento." },
  { title: "Checklist de contraindicaciones", desc: "Cuestionario obligatorio pre-tratamiento que valida contraindicaciones, alergias y condiciones medicas antes de cada sesion." },
  { title: "Retail y productos recomendados", desc: "Recomienda productos de cuidado en casa vinculados al tratamiento con seguimiento de compras y reabastecimiento." },
];

export default function CentrosEsteticaPage() {
  return (
    <SpecialtyPage
      name="Centros de Estetica"
      slug="centros-estetica"
      description="Todo lo que necesitas para gestionar tu centro de estetica. Paquetes de sesiones, control de bonos, aparatologia y seguimiento de tratamientos corporales y faciales."
      icon={Star}
      iconColor="text-pink-400"
      bgColor="bg-pink-900/30"
      features={FEATURES}
      metaTitle="Software para centros de estetica | MediFlow"
      metaDescription="Todo lo que necesitas para gestionar tu centro de estetica."
    />
  );
}
