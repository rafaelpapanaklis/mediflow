export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TREATMENT_KINDS } from "@/lib/agenda/types";
import { sanitizeElements, sanitizeMetadata } from "@/lib/floor-plan/sanitize";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { Clinic3DMount } from "./Clinic3DMount";

export const metadata: Metadata = { title: "Mi Clínica 3D — DaleControl" };

// Vista 3D en primera persona de la clínica diseñada en Mi Clínica Visual.
// Misma auth que el editor (ADMIN/SUPER_ADMIN). El layout se lee aquí (server)
// y se sanea; el estado vivo de sillones lo refresca el cliente por polling a
// /api/clinic-layout/3d-state. El bundle de three se carga client-only.
export default async function ClinicLayout3DPage() {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    redirect("/dashboard");
  }

  try {
    const [clinic, layout, chairs] = await Promise.all([
      prisma.clinic.findUnique({
        where: { id: user.clinicId },
        select: { id: true, name: true, category: true },
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
      <ErrorBoundary fallbackTitle="No se pudo cargar Mi Clínica 3D">
        <Clinic3DMount
          clinic={{
            id: clinic?.id ?? "",
            name: clinic?.name ?? "Mi clínica",
            category: clinic?.category ?? "DENTAL",
          }}
          initialElements={sanitizeElements(layout?.elements)}
          initialMetadata={sanitizeMetadata(layout?.metadata)}
          initialChairs={chairs.map((c) => ({ id: c.id, name: c.name, color: c.color ?? null }))}
        />
      </ErrorBoundary>
    );
  } catch (err) {
    console.error("[/dashboard/clinic-layout/3d]", err);
    return (
      <div className="flex min-h-[70vh] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-violet-100 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-gray-900">Mi Clínica 3D no está disponible</h1>
          <p className="mt-2 text-sm text-gray-500">
            No pudimos cargar la vista 3D en este momento. Intenta de nuevo en unos minutos.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href="/dashboard/clinic-layout/3d" className="inline-flex items-center justify-center rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700">
              Reintentar
            </a>
            <a href="/dashboard/clinic-layout" className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium text-violet-600 hover:text-violet-800">
              Volver al editor
            </a>
          </div>
        </div>
      </div>
    );
  }
}
