export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { fetchResources } from "@/lib/agenda/server";
import {
  requirePermissionOrRedirect,
} from "@/lib/auth/require-permission";
import { hasPermission } from "@/lib/auth/permissions";
import { ResourcesManager } from "@/components/dashboard/resources/resources-manager";
import { ResourcesManagerRediseno } from "@/components/dashboard/recursos-rediseno/resources-manager-rediseno";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";

export const metadata: Metadata = { title: "Recursos — DaleControl" };

export default async function ResourcesPage() {
  const user = await getCurrentUser();
  requirePermissionOrRedirect(user, "resources.view");
  const canEdit = hasPermission(user, "resources.edit");
  // REDISEÑO DE RECURSOS — el MISMO interruptor por clínica que enciende el
  // menú de dos niveles (`clinic_feature_flags`, bandera `menu-dos-niveles`),
  // no uno propio: Rafael prueba «el diseño nuevo» como una sola cosa. Falla
  // cerrado (sin tabla, sin fila o con error → false = la pantalla de hoy,
  // tal cual). Va en el mismo Promise.all que la carga de recursos para no
  // añadir un viaje extra a la base.
  const [resources, rediseno] = await Promise.all([
    fetchResources(user.clinicId),
    menuDosNivelesEncendido(user.clinicId),
  ]);
  return (
    <div style={{ padding: "8px 4px 32px" }}>
      {rediseno ? (
        <ResourcesManagerRediseno
          key={user.clinicId}
          initialResources={resources}
          clinicId={user.clinicId}
          canEdit={canEdit}
        />
      ) : (
        <ResourcesManager
          key={user.clinicId}
          initialResources={resources}
          clinicId={user.clinicId}
          canEdit={canEdit}
          variant="page"
        />
      )}
    </div>
  );
}
