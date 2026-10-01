import type { Metadata } from "next";
import { getAdminSession } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { ArcoAdminClient } from "./arco-admin-client";

export const metadata: Metadata = { title: "Solicitudes ARCO — Admin DaleControl" };
export const dynamic = "force-dynamic";

/**
 * Solicitudes ARCO anónimas (sin clínica): las atiende la plataforma, no una
 * clínica (A3, auditoría 30-sep-2026). El layout de /admin ya exige sesión; la
 * comprobación de aquí es defensa en profundidad y la lista sale de la BD con
 * `clinicId: null` fijo.
 */
export default async function AdminArcoPage() {
  const ctx = await getAdminSession();
  if (!ctx) {
    return <div style={{ padding: 24, color: "var(--text-2)", fontSize: 14 }}>No autorizado.</div>;
  }

  const rows = await prisma.arcoRequest.findMany({
    where: { clinicId: null },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <ArcoAdminClient
      initial={rows.map((r) => ({
        id: r.id,
        type: r.type,
        email: r.email,
        reason: r.reason,
        status: r.status,
        resolvedNotes: r.resolvedNotes,
        createdAt: r.createdAt.toISOString(),
        resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
      }))}
    />
  );
}
