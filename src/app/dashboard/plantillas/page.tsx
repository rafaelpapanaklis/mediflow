export const dynamic = "force-dynamic";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { listTemplates } from "@/lib/document-templates/service";
import { TEMPLATES_WRITE_PERMISSION } from "@/lib/document-templates/permissions";
import { PlantillasClient } from "./plantillas-client";

export default async function PlantillasPage() {
  const user = await getCurrentUser();
  // Mismo permiso que enseña la opción en el menú y que exige la API para
  // escribir: doctor o (super)admin. Ver src/lib/document-templates/permissions.ts.
  requirePermissionOrRedirect(user, TEMPLATES_WRITE_PERMISSION);

  const templates = await listTemplates(prisma, user.clinicId, { includeInactive: true });

  return (
    <PlantillasClient
      key={user.clinicId}
      initialTemplates={templates.map((t) => ({
        id: t.id,
        kind: t.kind,
        name: t.name,
        body: t.body,
        isActive: t.isActive,
        updatedAt: t.updatedAt.toISOString(),
      }))}
    />
  );
}
