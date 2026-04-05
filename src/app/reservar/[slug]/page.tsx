import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { BookingClient } from "./booking-client";

interface Props { params: { slug: string } }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const clinic = await prisma.clinic.findUnique({
    where: { slug: params.slug },
    select: { name: true, specialty: true, city: true },
  });
  if (!clinic) return { title: "Clínica no encontrada" };
  return {
    title: `Agendar cita — ${clinic.name}`,
    description: `Agenda tu cita en ${clinic.name}. ${clinic.city ?? ""}`,
  };
}

export default async function ReservarPage({ params }: Props) {
  const clinic = await prisma.clinic.findUnique({
    where: { slug: params.slug },
    select: {
      id:       true,
      name:     true,
      slug:     true,
      specialty:true,
      phone:    true,
      address:  true,
      city:     true,
      logoUrl:  true,
      schedules:{ select: { dayOfWeek: true, enabled: true, openTime: true, closeTime: true } },
      users: {
        where:  { isActive: true, role: { in: ["DOCTOR","ADMIN"] } },
        select: { id: true, firstName: true, lastName: true, specialty: true, color: true },
      },
    },
  });

  if (!clinic) notFound();

  return <BookingClient clinic={clinic as any} />;
}
