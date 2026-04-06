export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SettingsClient } from "./settings-client";

export const metadata: Metadata = { title: "Configuración — MediFlow" };

export default async function SettingsPage() {
  const user = await getCurrentUser();

  // Get clinic with full data including AI usage and schedules
  const clinic = await prisma.clinic.findUnique({
    where: { id: user.clinicId },
    include: {
      schedules: { orderBy: { dayOfWeek: "asc" } },
    },
    // also fetch clinic-level google calendar status

  });

  return (
    <SettingsClient
      user={user as any}
      clinic={clinic as any}
      clinicGcal={{
        enabled:    clinic?.googleCalendarEnabled ?? false,
        email:      clinic?.googleCalendarEmail    ?? null,
        calendarId: clinic?.googleClinicCalendarId ?? null,
      }}
    />
  );
}
