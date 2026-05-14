export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TREATMENT_KINDS } from "@/lib/agenda/types";
import { ClinicLayoutClient } from "./layout-client";

export const metadata: Metadata = { title: "Mi Clínica Visual — MediFlow" };

export default async function ClinicLayoutPage() {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    // Solo admin/owner pueden editar el layout.
    redirect("/dashboard");
  }

  const [clinic, layout, chairs] = await Promise.all([
    prisma.clinic.findUnique({
      where: { id: user.clinicId },
      select: {
        id: true,
        name: true,
        category: true,
        liveModeSlug: true,
        liveModeEnabled: true,
        liveModeShowPatientNames: true,
      },
    }),
    prisma.clinicLayout.findUnique({
      where: { clinicId: user.clinicId },
    }),
    prisma.resource.findMany({
      where: { clinicId: user.clinicId, kind: { in: [...TREATMENT_KINDS] }, isActive: true },
      select: { id: true, name: true, color: true, orderIndex: true },
      orderBy: [{ orderIndex: "asc" }, { name: "asc" }],
    }),
  ]);

  return (
    <ClinicLayoutClient
      clinic={{
        id: clinic?.id ?? "",
        name: clinic?.name ?? "",
        category: clinic?.category ?? "DENTAL",
        liveModeSlug: clinic?.liveModeSlug ?? null,
        liveModeEnabled: clinic?.liveModeEnabled ?? false,
        liveModeShowPatientNames: clinic?.liveModeShowPatientNames ?? false,
      }}
      initialElements={(layout?.elements ?? []) as unknown as Array<{
        id: number;
        type: string;
        col: number;
        row: number;
        rotation: 0 | 90 | 180 | 270;
        resourceId?: string | null;
        name?: string | null;
      }>}
      initialMetadata={(layout?.metadata ?? null) as unknown as { zoom?: number; panOffset?: { x: number; y: number } } | null}
      chairs={chairs.map((c) => ({ ...c, color: c.color ?? null }))}
    />
  );
}
