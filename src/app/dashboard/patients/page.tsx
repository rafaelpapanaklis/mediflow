export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { hasPermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { PatientsClient } from "./patients-client";

export const metadata: Metadata = { title: "Pacientes — DaleControl" };

/**
 * /dashboard/patients — server component minimal.
 * El cliente hace fetch a /api/patients?v=2 con todos los filtros y
 * paginación. Aquí solo cargamos:
 *  - currentUser para context (no sensitive).
 *  - Lista de doctores de la clínica (filter "Doctor asignado").
 */
export default async function PatientsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Gate de página (P1-3/P2): misma regla que analytics/caja/team — quitar
  // "Ver pacientes" en /dashboard/team ahora sí bloquea la pantalla, no solo
  // esconde el link del sidebar.
  requirePermissionOrRedirect(user, "patients.view");

  // Booleans de permiso para que la UI esconda lo que la API va a rechazar.
  const canCreatePatients = hasPermission(user, "patients.create");
  const canDeletePatients = hasPermission(user, "patients.delete");
  // El import exige patients.create Y rol ADMIN/RECEPTIONIST (espejo del
  // POST /api/patients/import). Calculado aquí: el cliente no deduce roles.
  const canImportPatients =
    canCreatePatients && ["ADMIN", "RECEPTIONIST", "SUPER_ADMIN"].includes(user.role);

  const doctors = await prisma.user.findMany({
    where: {
      clinicId: user.clinicId,
      isActive: true,
      role: { in: ["DOCTOR", "ADMIN", "SUPER_ADMIN"] },
    },
    select: { id: true, firstName: true, lastName: true, color: true },
    orderBy: { firstName: "asc" },
  });

  return (
    // key por clínica: al cambiar de sucursal el switcher hace router.refresh()
    // (soft), que reconcilia en vez de re-montar; sin key, el estado cliente
    // (lista cacheada, filtros, selección) sobrevive y muestra pacientes de la
    // sede anterior. Ver lección clinic-switch-stale-client-state.
    <PatientsClient
      key={user.clinicId}
      currentUser={{ id: user.id, role: user.role }}
      doctors={doctors}
      canCreatePatients={canCreatePatients}
      canDeletePatients={canDeletePatients}
      canImportPatients={canImportPatients}
    />
  );
}
