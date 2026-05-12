export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { fetchResources } from "@/lib/agenda/server";
import {
  requirePermissionOrRedirect,
} from "@/lib/auth/require-permission";
import { hasPermission } from "@/lib/auth/permissions";
import { ResourcesManager } from "@/components/dashboard/resources/resources-manager";

export const metadata: Metadata = { title: "Recursos — MediFlow" };

export default async function ResourcesPage() {
  const user = await getCurrentUser();
  requirePermissionOrRedirect(user, "resources.view");
  const resources = await fetchResources(user.clinicId);
  const canEdit = hasPermission(user, "resources.edit");
  return (
    <div style={{ padding: "8px 4px 32px" }}>
      <ResourcesManager
        initialResources={resources}
        clinicId={user.clinicId}
        canEdit={canEdit}
        variant="page"
      />
    </div>
  );
}
