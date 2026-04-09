import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { BookingClient } from "./booking-client";

const CATEGORY_SERVICES: Record<string, string[]> = {
  DENTAL: ["Consulta general", "Limpieza dental", "Ortodoncia", "Implantes", "Endodoncia", "Extracción", "Blanqueamiento", "Coronas", "Resinas"],
  MEDICINE: ["Consulta general", "Check-up", "Certificado médico", "Control crónico", "Urgencia"],
  NUTRITION: ["Primera consulta", "Seguimiento", "Plan alimenticio", "Bioimpedancia"],
  PSYCHOLOGY: ["Sesión individual", "Sesión pareja", "Sesión familiar", "Evaluación inicial"],
  DERMATOLOGY: ["Consulta", "Limpieza facial", "Peeling", "Evaluación lunar"],
  AESTHETIC_MEDICINE: ["Botox", "Fillers", "PRP", "Mesoterapia", "Peeling", "Hilos tensores"],
  HAIR_RESTORATION: ["Consulta evaluación", "FUE", "PRP capilar", "Micropigmentación", "Seguimiento"],
  BEAUTY_CENTER: ["Facial", "Radiofrecuencia", "Cavitación", "Body wrap", "LED"],
  BROW_LASH: ["Extensiones clásicas", "Volumen", "Lash lift", "Microblading", "Laminado cejas", "Tinte"],
  MASSAGE: ["Sueco", "Tejido profundo", "Deportivo", "Drenaje linfático", "Piedras calientes", "Relajante"],
  LASER_HAIR_REMOVAL: ["Axilas", "Bikini", "Piernas", "Brazos", "Rostro", "Espalda", "Cuerpo completo"],
  HAIR_SALON: ["Corte", "Color", "Mechas", "Balayage", "Keratina", "Barba", "Tratamiento capilar"],
  ALTERNATIVE_MEDICINE: ["Acupuntura", "Ventosas", "Herbolaria", "Homeopatía", "Quiropráctica"],
  NAIL_SALON: ["Manicure", "Pedicure", "Gel", "Acrílico", "Nail art", "Manicure + Pedicure"],
  SPA: ["Circuito termal", "Masaje spa", "Facial spa", "Hidroterapia", "Paquete pareja"],
  PHYSIOTHERAPY: ["Evaluación", "Terapia manual", "Electroterapia", "Ejercicio terapéutico", "Punción seca"],
  PODIATRY: ["Consulta", "Cirugía ungueal", "Evaluación biomecánica", "Screening diabético", "Ortesis"],
  OTHER: ["Consulta", "Seguimiento", "Procedimiento", "Evaluación"],
};

interface Props {
  params:      { slug: string };
  searchParams:{ service?: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const clinic = await prisma.clinic.findUnique({
    where:  { slug: params.slug },
    select: { name: true, specialty: true, city: true },
  });
  if (!clinic) return { title: "Clínica no encontrada" };
  return {
    title:       `Agendar cita — ${clinic.name}`,
    description: `Agenda tu cita en ${clinic.name}${clinic.city ? `, ${clinic.city}` : ""}.`,
  };
}

export default async function ReservarPage({ params, searchParams }: Props) {
  const clinic = await prisma.clinic.findUnique({
    where: { slug: params.slug },
    select: {
      id:        true,
      name:      true,
      slug:      true,
      specialty: true,
      category:  true,
      phone:     true,
      address:   true,
      city:      true,
      logoUrl:   true,
      description: true,
      landingServices: true,
      schedules: {
        select: { dayOfWeek: true, enabled: true, openTime: true, closeTime: true },
      },
      users: {
        where:   { isActive: true, role: { in: ["DOCTOR","ADMIN","SUPER_ADMIN"] } },
        select:  { id: true, firstName: true, lastName: true, specialty: true, color: true, services: true },
        orderBy: { firstName: "asc" },
      },
    },
  });

  if (!clinic) notFound();

  const category = (clinic as any).category ?? "OTHER";
  // Use landing page services if configured, otherwise fall back to category defaults
  const landingServiceNames = Array.isArray((clinic as any).landingServices)
    ? (clinic as any).landingServices.map((s: any) => s.name).filter(Boolean)
    : [];
  const categoryServices = landingServiceNames.length > 0
    ? landingServiceNames
    : (CATEGORY_SERVICES[category] ?? CATEGORY_SERVICES.OTHER);

  return (
    <BookingClient
      clinic={clinic as any}
      preselectedService={searchParams.service ?? null}
      categoryServices={categoryServices}
    />
  );
}
