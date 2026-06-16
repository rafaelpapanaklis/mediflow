// Biblioteca / Plantillas del módulo Marketing (WS-MKT-T6). Server component:
// trae las plantillas que la clínica guardó en DB y se las pasa al cliente, que
// las fusiona con el set integrado (src/lib/marketing/seed-templates.ts). Así la
// biblioteca es útil desde el primer día aunque nadie haya guardado nada y aunque
// no se haya aplicado el SQL semilla.

export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MarketingLibraryClient, type ClinicTemplate } from "./library-client";

export const metadata: Metadata = { title: "Biblioteca — Marketing — DaleControl" };

export default async function MarketingLibraryPage() {
  const user = await getCurrentUser();
  const clinicCategory: string = (user.clinic as any)?.category ?? "OTHER";

  let clinicTemplates: ClinicTemplate[] = [];
  try {
    const rows = await prisma.marketingTemplate.findMany({
      where: { clinicId: user.clinicId },
      orderBy: { createdAt: "desc" },
      take: 300,
    });
    clinicTemplates = rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      specialty: r.specialty ?? null,
      title: r.title,
      body: r.body,
      tags: Array.isArray(r.tags) ? r.tags : [],
    }));
  } catch (e) {
    // Tabla aún sin migrar → solo se muestra el set integrado.
    console.error("[marketing/library] fallo al cargar plantillas de la clínica", e);
  }

  return <MarketingLibraryClient clinicCategory={clinicCategory} clinicTemplates={clinicTemplates} />;
}
