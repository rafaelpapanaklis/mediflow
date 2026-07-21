export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TREATMENT_KINDS } from "@/lib/agenda/types";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { ClinicLayoutClient } from "./layout-client";

export const metadata: Metadata = { title: "Mi Clínica Visual — DaleControl" };

export default async function ClinicLayoutPage() {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    // Solo admin/owner pueden editar el layout.
    redirect("/dashboard");
  }

  try {
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

    // Doble red de seguridad: el try/catch atrapa fallos de carga server-side;
    // el ErrorBoundary atrapa crashes de render client-side del editor (datos
    // de layout legacy/malformados). Complementario al saneo en layout-client.
    return (
      <ErrorBoundary fallbackTitle="No se pudo cargar el editor de plano">
        <ClinicLayoutClient
          key={user.clinicId}
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
      </ErrorBoundary>
    );
  } catch (err) {
    console.error("[/dashboard/clinic-layout]", err);
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-violet-100 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-gray-900">
            Mi Clínica Visual no está disponible
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            No pudimos cargar el editor en este momento. Intenta de nuevo en unos
            minutos o contacta a soporte.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href="/dashboard/clinic-layout"
              className="inline-flex items-center justify-center rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
            >
              Reintentar
            </a>
            <a
              href="/dashboard"
              className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium text-violet-600 hover:text-violet-800"
            >
              Volver al dashboard
            </a>
          </div>
        </div>
      </div>
    );
  }
}
