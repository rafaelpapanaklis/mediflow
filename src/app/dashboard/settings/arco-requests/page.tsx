export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/lib/auth";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { ArcoRequestsClient } from "./arco-requests-client";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";

export default async function ArcoRequestsPage() {
  const user = await getCurrentUser();
  // ISO-03: la misma puerta que GET/PATCH /api/arco/[id] — el interruptor "Ver
  // y atender solicitudes ARCO" del modal (por default SUPER_ADMIN y ADMIN,
  // que son exactamente los roles que esta página dejaba pasar a mano). Así
  // el dueño que le apaga ARCO a un administrador le apaga también la pantalla,
  // no solo el botón de guardar.
  requirePermissionOrRedirect(user, "arco.manage");

  // Las dos listas y el interruptor del rediseño (ws1-t2: el MISMO
  // `menu-dos-niveles` de la clínica) en UN Promise.all: antes iban en
  // cascada, y el interruptor no añade viaje (falla cerrado → false = la
  // pantalla de siempre).
  const [clinicRequests, anonymousRequests, rediseno] = await Promise.all([
    // Solicitudes scoped a la clínica
    prisma.arcoRequest.findMany({
      where: { clinicId: user.clinicId },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    // Solicitudes anónimas (clinicId NULL) — solo SUPER_ADMIN.
    user.role === "SUPER_ADMIN"
      ? prisma.arcoRequest.findMany({
          where: { clinicId: null },
          orderBy: { createdAt: "desc" },
          take: 100,
        })
      : Promise.resolve([]),
    menuDosNivelesEncendido(user.clinicId),
  ]);

  return (
    <ArcoRequestsClient
      clinicRequests={clinicRequests.map(serialize)}
      anonymousRequests={anonymousRequests.map(serialize)}
      isSuperAdmin={user.role === "SUPER_ADMIN"}
      rediseno={rediseno}
    />
  );
}

function serialize<T extends { createdAt: Date; resolvedAt: Date | null }>(r: T) {
  return {
    ...r,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
  };
}
