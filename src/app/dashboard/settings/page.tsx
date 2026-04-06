export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SettingsClient } from "./settings-client";

export const metadata: Metadata = { title: "Configuración — MediFlow" };

export default async function SettingsPage() {
  const user = await getCurrentUser();

  const clinic = await prisma.clinic.findUnique({
    where: { id: user.clinicId },
    include: {
      schedules: { orderBy: { dayOfWeek: "asc" } },
    },
  });

  // Fetch Google Calendar status separately with explicit select
  // This ensures the fields are read even if Prisma client cache is stale
  const clinicGcalRaw = await prisma.clinic.findUnique({
    where:  { id: user.clinicId },
    select: {
      googleCalendarEnabled:  true,
      googleCalendarEmail:    true,
      googleClinicCalendarId: true,
    },
  });

  return (
    <SettingsClient
      user={user as any}
      clinic={clinic as any}
      clinicGcal={{
        enabled:    clinicGcalRaw?.googleCalendarEnabled  ?? false,
        email:      clinicGcalRaw?.googleCalendarEmail    ?? null,
        calendarId: clinicGcalRaw?.googleClinicCalendarId ?? null,
      }}
    />
  );
}
