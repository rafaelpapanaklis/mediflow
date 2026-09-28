export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { exigirCategoriaParaPagina } from "@/lib/dashboard/guardia-categoria.server";
import { prisma } from "@/lib/prisma";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { ResourceBookingsClient } from "./resource-bookings-client";

export const metadata: Metadata = { title: "Reservas legacy — DaleControl" };

export default async function ResourceBookingsPage() {
  // Guardia de categoría EN LA PÁGINA (no en un layout): esta pantalla solo abre
  // para las clínicas cuyo giro la tiene. La categoría sale de la sesión.
  const user = await exigirCategoriaParaPagina("/dashboard/resource-bookings");
  const clinicId = user.clinicId;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // REDISEÑO — el MISMO interruptor por clínica que enciende el menú de dos
  // niveles (`clinic_feature_flags`, bandera `menu-dos-niveles`), no uno
  // propio. Falla cerrado (→ false = la pantalla de hoy, tal cual). Va en el
  // mismo Promise.all que las reservas para no añadir un viaje a la base; la
  // respuesta además vive 60 s en memoria por clínica.
  const [bookings, rediseno] = await Promise.all([
    prisma.resourceBooking.findMany({
      where: {
        clinicId,
        startTime: { gte: today, lt: tomorrow },
      },
      orderBy: { startTime: "asc" },
    }),
    menuDosNivelesEncendido(clinicId),
  ]);

  return <ResourceBookingsClient key={clinicId} initialBookings={bookings as any} rediseno={rediseno} />;
}
