export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ResourceBookingsClient } from "./resource-bookings-client";

export const metadata: Metadata = { title: "Reservas legacy — MediFlow" };

export default async function ResourceBookingsPage() {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const bookings = await prisma.resourceBooking.findMany({
    where: {
      clinicId,
      startTime: { gte: today, lt: tomorrow },
    },
    orderBy: { startTime: "asc" },
  });

  return <ResourceBookingsClient initialBookings={bookings as any} />;
}
