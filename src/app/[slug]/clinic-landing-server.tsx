import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { LivePreviewBridge } from "./_shared/live-preview";
import { ClinicLandingClient } from "./landing-client";
import { TemplateFuturista } from "./templates/template-futurista";
import { TemplateHealthtech } from "./templates/template-healthtech";
import { TemplateCalido } from "./templates/template-calido";
import { TemplateEquipo } from "./templates/template-equipo";
import { TemplateSonrisa } from "./templates/template-sonrisa";
import { TemplateConsultorio } from "./templates/template-consultorio";
import { TemplateEspecialistas } from "./templates/template-especialistas";

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
 *
 * `live` solo lo enciende /landing-preview: monta el puente que recibe por
 * postMessage lo que la clínica lleva escrito en el editor. La página
 * pública NUNCA escucha mensajes de nadie.
 */
export async function ClinicLandingServer({
  slug,
  previewTpl,
  live = false,
}: {
  slug: string;
  previewTpl?: string;
  live?: boolean;
}) {
  /**
   * SEGURIDAD — `select` EXPLÍCITO, jamás `include` a secas.
   *
   * Esta fila viaja como prop a componentes CLIENTE (las 8 plantillas), así que
   * Next la serializa DENTRO del HTML público, cacheado por ISR y legible con
   * "ver código fuente" sin contraseña. Con `include` traía TODAS las columnas
   * de Clinic — incluidos waAccessToken, facturApiLiveKey, twilioAuthToken y
   * googleRefreshToken. Enumerar los campos (en vez de quitar los secretos con
   * stripClinicSecrets) es a prueba de futuro: una columna secreta nueva en
   * Clinic no se filtra sola, simplemente no se pide.
   *
   * La lista es exactamente `LandingClinic` (_shared/types.ts) más los tres
   * campos que solo usa este archivo: category, landingActive y landingTemplate.
   * Si una plantilla necesita un campo nuevo, hay que agregarlo AQUÍ y al type.
   */
  const clinic = await prisma.clinic.findUnique({
    where:  { slug },
    select: {
      id: true, name: true, slug: true, specialty: true, category: true,
      phone: true, email: true, address: true, city: true,
      logoUrl: true, description: true, googlePlaceId: true,
      landingActive: true, landingTemplate: true,
      landingThemeColor: true, landingCoverUrl: true, landingGallery: true,
      landingTestimonials: true, landingFaqs: true, landingServices: true,
      landingWhatsapp: true, landingInstagram: true, landingFacebook: true,
      landingTiktok: true, landingMapEmbed: true, landingTagline: true,
      landingYearsExperience: true, landingPatients: true,
      // Landing v2 (sql/landing-v2.sql)
      landingSections: true, landingPhotos: true,
      landingUrgentText: true, landingMsiPlazos: true,
      users:     { where: { isActive: true, role: { in: ["DOCTOR","ADMIN","SUPER_ADMIN"] } },
                   select: { id:true, firstName:true, lastName:true, specialty:true, color:true, avatarUrl:true, services:true } },
      schedules: { orderBy: { dayOfWeek: "asc" },
                   select: { dayOfWeek:true, enabled:true, openTime:true, closeTime:true } },
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
  const pagina =
    tpl === "futurista"     ? <TemplateFuturista clinic={c} highlights={highlights} /> :
    tpl === "healthtech"    ? <TemplateHealthtech clinic={c} highlights={highlights} /> :
    tpl === "calido"        ? <TemplateCalido clinic={c} highlights={highlights} /> :
    tpl === "equipo"        ? <TemplateEquipo clinic={c} highlights={highlights} /> :
    tpl === "sonrisa"       ? <TemplateSonrisa clinic={c} highlights={highlights} /> :
    tpl === "consultorio"   ? <TemplateConsultorio clinic={c} highlights={highlights} /> :
    tpl === "especialistas" ? <TemplateEspecialistas clinic={c} highlights={highlights} /> :
    <ClinicLandingClient clinic={c} highlights={highlights} />;

  // El puente NO cambia nada de lo que se pinta: sin mensajes, la plantilla
  // recibe exactamente la misma clínica que sin él.
  return live ? <LivePreviewBridge slug={c.slug}>{pagina}</LivePreviewBridge> : pagina;
}
