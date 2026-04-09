import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ClinicLandingClient } from "./landing-client";
import type { Metadata } from "next";

// Reserved slugs that should NOT render clinic landings
const RESERVED = [
  "dashboard","admin","api","auth","login","register",
  "pricing","features","contact","consentimiento","portal",
];

interface Props { params: { slug: string } }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const clinic = await prisma.clinic.findUnique({
    where: { slug: params.slug },
    select: { name: true, description: true, logoUrl: true },
  });
  if (!clinic) return { title: "Clínica no encontrada" };
  return {
    title: `${clinicData.name} — Agenda tu cita en línea`,
    description: clinic.description ?? `Agenda tu cita en ${clinicData.name}`,
    openGraph: { images: clinicData.logoUrl ? [clinicData.logoUrl] : [] },
  };
}

export default async function ClinicLandingPage({ params }: Props) {
  if (RESERVED.includes(params.slug)) notFound();

  const clinic = await prisma.clinic.findUnique({
    where:   { slug: params.slug },
    include: {
      users:     { where: { isActive: true, role: { in: ["DOCTOR","ADMIN"] } },
                   select: { id:true, firstName:true, lastName:true, specialty:true, color:true, avatarUrl:true, services:true } },
      schedules: { orderBy: { dayOfWeek: "asc" } },
    },
  });

  if (!clinic) notFound();
  const clinicData = clinic as any;
  if (!clinicData.landingActive) {
    // Show a simple "coming soon" instead of 404
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-white text-center px-4">
        <div className="text-5xl mb-4">{clinicData.logoUrl ? <img src={clinicData.logoUrl} alt={clinicData.name} className="h-16 mx-auto rounded-2xl" /> : "🏥"}</div>
        <h1 className="text-2xl font-bold mb-2">{clinicData.name}</h1>
        <p className="text-slate-400 mb-6">Nuestro sitio web estará disponible pronto.</p>
        {clinicData.phone && (
          <a href={`tel:${clinicData.phone}`} className="bg-blue-600 text-white px-6 py-3 rounded-xl font-semibold">
            📞 Llamar para agendar
          </a>
        )}
      </div>
    );
  }

  return <ClinicLandingClient clinic={clinicData} />;
}
