export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SettingsClient } from "./settings-client";

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

  return (
    <SettingsClient
      user={user as any}
      clinic={clinic as any}
      initialTab={searchParams.tab}
      gcalStatus={searchParams.gcal}
    />
  );
}
