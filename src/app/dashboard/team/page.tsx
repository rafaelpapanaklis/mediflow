export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TeamClient } from "./team-client";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";

export const metadata: Metadata = { title: "Equipo — DaleControl" };

export default async function TeamPage() {
  const user = await getCurrentUser();
  // Reemplaza el gate ADMIN/SUPER_ADMIN por el permiso UI granular.
  // El boton "Permisos" del modal queda gated por isSuperAdmin en el
  // cliente, así un ADMIN puede ver/editar el equipo pero no asignar
  // permisos granulares.
  requirePermissionOrRedirect(user, "team.view");

  // REDISEÑO DE EQUIPO — el MISMO interruptor por clínica que enciende el
  // menú de dos niveles y el rediseño de Pacientes (`clinic_feature_flags`,
  // bandera `menu-dos-niveles`), no uno propio. Falla cerrado (sin tabla,
  // sin fila o con error → false = la pantalla de hoy, tal cual). Va en el
  // mismo Promise.all que la lista de equipo para no añadir un viaje sin
  // superponer; la respuesta además vive 60 s en memoria por clínica.
  const [team, rediseno] = await Promise.all([
    prisma.user.findMany({
      where: { clinicId: user.clinicId },
      select: {
        id: true, firstName: true, lastName: true, email: true,
        role: true, specialty: true, color: true, avatarUrl: true,
        phone: true, isActive: true, createdAt: true, services: true,
        // Override granular del set default del role — visible solo en el
        // modal de Permisos del SUPER_ADMIN.
        permissionsOverride: true,
        _count: {
          select: {
            appointments: { where: { status: { not: "CANCELLED" } } },
            records: true,
          },
        },
      },
      orderBy: [{ role: "asc" }, { firstName: "asc" }],
    }),
    menuDosNivelesEncendido(user.clinicId),
  ]);

  return (
    <TeamClient
      key={user.clinicId}
      team={team as any}
      currentUserId={user.id}
      currentUserRole={user.role}
      clinicName={user.clinic.name}
      rediseno={rediseno}
    />
  );
}
