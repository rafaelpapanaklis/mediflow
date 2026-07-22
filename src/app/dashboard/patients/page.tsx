export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
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
    />
  );
}
