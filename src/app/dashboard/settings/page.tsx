export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SettingsClient } from "./settings-client";
import { ErrorBoundary } from "@/components/ui/error-boundary";

export const metadata: Metadata = { title: "Configuración — MediFlow" };

interface Props {
  searchParams: { tab?: string; gcal?: string };
}

export default async function SettingsPage({ searchParams }: Props) {
  const user = await getCurrentUser();

  const clinic = await prisma.clinic.findUnique({
    where:   { id: user.clinicId },
    include: { schedules: { orderBy: { dayOfWeek: "asc" } } },
  });

  const teamMembers = await prisma.user.findMany({
    where:   { clinicId: user.clinicId, isActive: true, role: { in: ["DOCTOR","ADMIN","SUPER_ADMIN"] } },
    select:  { id: true, firstName: true, lastName: true, role: true, services: true },
    orderBy: { firstName: "asc" },
  });

  return (
    <ErrorBoundary fallbackTitle="Error al cargar configuración">
      <SettingsClient
        user={user as any}
        clinic={clinic as any}
        initialTab={searchParams.tab}
        gcalStatus={searchParams.gcal}
        teamMembers={teamMembers as any}
      />
    </ErrorBoundary>
  );
}
