import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ClinicLandingClient } from "./landing-client";
import type { Metadata } from "next";

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
    title: `${clinic.name} — Agenda tu cita en línea`,
    description: clinic.description ?? `Agenda tu cita en ${clinic.name}`,
    openGraph: { images: clinic.logoUrl ? [clinic.logoUrl] : [] },
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

  return <ClinicLandingClient clinic={c} />;
}
