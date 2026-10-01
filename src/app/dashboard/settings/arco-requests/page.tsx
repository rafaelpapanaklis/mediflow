export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
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

  // Solo las solicitudes de ESTA clínica. Las anónimas (clinicId NULL) las
  // atiende el admin de plataforma en /admin/arco: aquí NO se consultan, ni
  // siquiera para SUPER_ADMIN (rol de todo dueño de clínica; A3, auditoría
  // 30-sep-2026). Sin clínica resuelta no se consulta nada: `clinicId:
  // undefined` haría que Prisma descartara el filtro y devolviera TODAS.
  const clinicId = user.clinicId;
  if (!clinicId) redirect("/dashboard");

  // La lista y el interruptor del rediseño (ws1-t2: el MISMO `menu-dos-niveles`
  // de la clínica) en UN Promise.all: el interruptor falla cerrado → false = la
  // pantalla de siempre.
  const [clinicRequests, rediseno] = await Promise.all([
    prisma.arcoRequest.findMany({
      where: { clinicId },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    menuDosNivelesEncendido(user.clinicId),
  ]);

  return (
    <ArcoRequestsClient
      clinicRequests={clinicRequests.map(serialize)}
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
