import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ClinicLandingClient } from "./landing-client";
import type { Metadata } from "next";
import {
  getSpecialty as getLegacySpecialty,
  isHealthSpecialty,
  SPECIALTY_SLUGS as LEGACY_SPECIALTY_SLUGS,
} from "@/lib/specialty-content";
import { SpecialtyPage as LegacySpecialtyPage } from "@/components/public/specialty/specialty-page";
import {
  getSpecialty as getNewSpecialty,
  SPECIALTY_SLUGS as NEW_SPECIALTY_SLUGS,
} from "@/lib/specialty-data";
import { SpecialtyPage } from "@/components/public/landing/specialty/specialty-page";
import {
  buildMetadata,
  softwareApplicationLd,
  medicalBusinessLd,
  SITE_URL,
} from "@/lib/seo";

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

/** Slugs reservados top-level que [slug] nunca intenta resolver. */
const NON_SPECIALTY_RESERVED = [
  "dashboard","admin","api","auth","login","register",
  "pricing","features","contact","consentimiento","portal",
  "reservar","pago","consent","clinicas","teleconsulta","roadmap",
];

interface Props { params: { slug: string } }

export function generateStaticParams() {
  const combined = new Set<string>([
    ...NEW_SPECIALTY_SLUGS,
    ...LEGACY_SPECIALTY_SLUGS,
  ]);
  return Array.from(combined).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  // 1) New specialty landing (Claude Design)
  const newSpec = getNewSpecialty(params.slug);
  if (newSpec) {
    return buildMetadata({
      title: `${newSpec.name} · MediFlow`,
      description: newSpec.heroSub,
      path: `/${newSpec.slug}`,
      ogImage: `/og/${newSpec.slug}.png`,
      keywords: [newSpec.name, newSpec.category, "software clínica México", "CFDI", "expediente electrónico"],
    });
  }

  // 2) Legacy specialty landing
  const legacySpec = getLegacySpecialty(params.slug);
  if (legacySpec) {
    return buildMetadata({
      title: legacySpec.seoTitle,
      description: legacySpec.seoDescription,
      path: `/${legacySpec.slug}`,
      ogImage: `/og/${legacySpec.slug}.png`,
    });
  }

  // 3) Clínica (landing pública)
  const clinic = await prisma.clinic.findUnique({
    where: { slug: params.slug },
    select: { name: true, description: true, logoUrl: true },
  });
  if (!clinic) return { title: "Clínica no encontrada" };
  return {
    title: `${clinic.name} — Agenda tu cita en línea`,
    description: clinic.description ?? `Agenda tu cita en ${clinic.name}`,
    openGraph: { images: clinic.logoUrl ? [clinic.logoUrl] : [] },
  };
}

export default async function ClinicLandingPage({ params }: Props) {
  // 1) Reserved slugs
  if (NON_SPECIALTY_RESERVED.includes(params.slug)) notFound();

  // 2) NEW specialty landing (Claude Design, 17 especialidades médicas)
  const newSpec = getNewSpecialty(params.slug);
  if (newSpec) {
    const url = `${SITE_URL}/${newSpec.slug}`;
    const ldBlocks: object[] = [
      softwareApplicationLd({
        name: `MediFlow para ${newSpec.name}`,
        description: newSpec.heroSub,
        url,
        category: "HealthApplication",
      }),
      medicalBusinessLd({
        name: `MediFlow — software para ${newSpec.name.toLowerCase()}`,
        description: newSpec.heroSub,
        url,
        medicalSpecialty: newSpec.category,
      }),
    ];
    return (
      <>
        {ldBlocks.map((ld, i) => (
          <script
            key={i}
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
          />
        ))}
        <SpecialtyPage slug={newSpec.slug} />
      </>
    );
  }

  // 3) Legacy specialty landing
  const legacySpec = getLegacySpecialty(params.slug);
  if (legacySpec) {
    const url = `${SITE_URL}/${legacySpec.slug}`;
    const ldBlocks: object[] = [
      softwareApplicationLd({
        name: `MediFlow para ${legacySpec.nombre}`,
        description: legacySpec.seoDescription,
        url,
        category: "BusinessApplication",
      }),
    ];
    if (isHealthSpecialty(legacySpec.slug)) {
      ldBlocks.push(
        medicalBusinessLd({
          name: `MediFlow — software para ${legacySpec.nombre.toLowerCase()}`,
          description: legacySpec.seoDescription,
          url,
        }),
      );
    }
    return (
      <>
        {ldBlocks.map((ld, i) => (
          <script
            key={i}
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
          />
        ))}
        <LegacySpecialtyPage content={legacySpec} />
      </>
    );
  }

  // 4) Landing pública de clínica
  const clinic = await prisma.clinic.findUnique({
    where:   { slug: params.slug },
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

  return <ClinicLandingClient clinic={c} highlights={highlights} />;
}
