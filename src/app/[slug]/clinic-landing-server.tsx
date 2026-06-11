import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ClinicLandingClient } from "./landing-client";
import { TemplateFuturista } from "./templates/template-futurista";
import { TemplateHealthtech } from "./templates/template-healthtech";
import { TemplateCalido } from "./templates/template-calido";

const CATEGORY_HIGHLIGHTS: Record<string, string[]> = {
  DENTAL: ["Odontograma digital", "Radiografías", "Plan de tratamiento por pieza", "Evaluación periodontal"],
  MEDICINE: ["Signos vitales completos", "Diagnóstico CIE-10", "Prescripción digital", "Referidos"],
  NUTRITION: ["Cálculo IMC/TMB/GET", "Plan alimenticio", "Seguimiento de peso", "Laboratorios"],
  PSYCHOLOGY: ["Escalas PHQ-9 y GAD-7", "Notas SOAP/BIRP/DAP", "Plan terapéutico", "Metas por sesión"],
  DERMATOLOGY: ["Registro fotográfico", "Fotos antes/después", "Historial de procedimientos"],
  AESTHETIC_MEDICINE: ["Mapeo facial", "Fotos antes/después", "Paquetes de sesiones", "Trazabilidad de lotes"],
  HAIR_RESTORATION: ["Clasificación Norwood/Ludwig", "Conteo de grafts", "Seguimiento supervivencia"],
  BEAUTY_CENTER: ["Paquetes de tratamiento", "Fotos antes/después", "Control de productos"],
  BROW_LASH: ["Mapa de pestañas", "Fórmulas de color", "Historial de patch test"],
  MASSAGE: ["Mapeo corporal de dolor", "Notas SOAP", "Contraindicaciones"],
  LASER_HAIR_REMOVAL: ["Parámetros por sesión", "Seguimiento de reacciones", "Paquetes por zona"],
  HAIR_SALON: ["Fórmulas de color", "Historial de fórmulas", "Servicios y estilistas"],
  ALTERNATIVE_MEDICINE: ["Puntos de acupuntura", "Fórmulas herbales", "Diagnóstico TCM"],
  NAIL_SALON: ["Historial de servicios", "Condición de uñas", "Técnico asignado"],
  SPA: ["Cuestionario de salud", "Preferencias", "Paquetes de servicios"],
  PHYSIOTHERAPY: ["Escala VAS dolor", "Mediciones ROM", "Programa de ejercicios (HEP)"],
  PODIATRY: ["Riesgo pie diabético", "Pipeline de ortesis", "Evaluación biomecánica"],
  OTHER: ["Expediente clínico digital", "Agenda inteligente", "Facturación integrada"],
};

/**
 * Rama de landing de CLÍNICA compartida entre la ruta pública /[slug]
 * (estática/ISR — por eso aquí NO se leen searchParams ni cookies) y la
 * ruta /landing-preview/[slug] (dinámica, pasa previewTpl). Leer
 * searchParams en la ruta ISR lanzaba DYNAMIC_SERVER_USAGE al regenerar.
 */
export async function ClinicLandingServer({
  slug,
  previewTpl,
}: {
  slug: string;
  previewTpl?: string;
}) {
  const clinic = await prisma.clinic.findUnique({
    where:   { slug },
    include: {
      users:     { where: { isActive: true, role: { in: ["DOCTOR","ADMIN","SUPER_ADMIN"] } },
                   select: { id:true, firstName:true, lastName:true, specialty:true, color:true, avatarUrl:true, services:true } },
      schedules: { orderBy: { dayOfWeek: "asc" } },
    },
  });

  if (!clinic) notFound();
  const c = clinic as any;

  if (!c.landingActive) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-white text-center px-4">
        <div className="text-5xl mb-4">🏥</div>
        <h1 className="text-2xl font-bold mb-2">{c.name}</h1>
        <p className="text-slate-400 mb-6">Nuestro sitio web estará disponible pronto.</p>
        {c.phone && (
          <a href={`tel:${c.phone}`} className="bg-blue-600 text-white px-6 py-3 rounded-xl font-semibold">
            📞 Llamar para agendar
          </a>
        )}
      </div>
    );
  }

  const category = (clinic as any).category ?? "OTHER";
  const highlights = CATEGORY_HIGHLIGHTS[category] ?? CATEGORY_HIGHLIGHTS.OTHER;

  const tpl = (previewTpl ?? c.landingTemplate ?? "classic");
  if (tpl === "futurista")  return <TemplateFuturista clinic={c} highlights={highlights} />;
  if (tpl === "healthtech") return <TemplateHealthtech clinic={c} highlights={highlights} />;
  if (tpl === "calido")     return <TemplateCalido clinic={c} highlights={highlights} />;
  return <ClinicLandingClient clinic={c} highlights={highlights} />;
}
