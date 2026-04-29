export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TeamClient } from "./team-client";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";

export const metadata: Metadata = { title: "Equipo — MediFlow" };

export default async function TeamPage() {
  const user = await getCurrentUser();
  // Reemplaza el gate ADMIN/SUPER_ADMIN por el permiso UI granular.
  // El boton "Permisos" del modal queda gated por isSuperAdmin en el
  // cliente, así un ADMIN puede ver/editar el equipo pero no asignar
  // permisos granulares.
  requirePermissionOrRedirect(user, "team.view");

  const team = await prisma.user.findMany({
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
  });

  return (
    <TeamClient
      team={team as any}
      currentUserId={user.id}
      currentUserRole={user.role}
      clinicName={user.clinic.name}
    />
  );
}
