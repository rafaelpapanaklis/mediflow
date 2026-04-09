import { Apple } from "lucide-react";
import SpecialtyPage, { buildSpecialtyMetadata } from "@/components/public/specialty-page";

export const metadata = buildSpecialtyMetadata({
  metaTitle: "Software para nutriologos | MediFlow",
  metaDescription: "Herramientas especializadas para nutriologos. Calculo automatico de IMC, TMB y requerimientos caloricos. Planes de alimentacion personalizados.",
});

const FEATURES = [
  { title: "Calculo IMC y TMB automatico", desc: "Calcula automaticamente el Indice de Masa Corporal, Tasa Metabolica Basal y requerimientos caloricos diarios del paciente." },
  { title: "Planes de alimentacion personalizados", desc: "Disena planes alimenticios semanales con macronutrientes, porciones equivalentes y listas de intercambio por grupo alimenticio." },
  { title: "Seguimiento de peso y medidas", desc: "Registra peso, circunferencias y pliegues cutaneos con graficas de progreso y comparacion entre consultas." },
  { title: "Registro fotografico de progreso", desc: "Documenta la evolucion fisica del paciente con fotos estandarizadas por angulo y comparacion lado a lado." },
  { title: "Recetas y menus semanales", desc: "Biblioteca de recetas saludables organizadas por objetivo nutricional. Genera menus semanales con lista de compras." },
  { title: "Recordatorios de seguimiento", desc: "Programa recordatorios automaticos por WhatsApp para citas de control, mediciones y adherencia al plan alimenticio." },
];

export default function NutricionPage() {
  return (
    <SpecialtyPage
      name="Nutricion"
      slug="nutricion"
      description="Herramientas especializadas para nutriologos. Calculo automatico de IMC, TMB y requerimientos caloricos. Planes de alimentacion personalizados y seguimiento de composicion corporal."
      icon={Apple}
      iconColor="text-green-400"
      bgColor="bg-green-900/30"
      features={FEATURES}
      metaTitle="Software para nutriologos | MediFlow"
      metaDescription="Herramientas especializadas para nutriologos."
    />
  );
}
