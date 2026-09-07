export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { patientVisibilityAnd } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { BeforeAfterClient } from "./before-after-client";

export const metadata: Metadata = { title: "Antes y Después — DaleControl" };

export default async function BeforeAfterPage() {
  const user = await getCurrentUser();
  // La misma puerta que su hermana /dashboard/xrays, y por el mismo motivo:
  // esto es una galería TRANSVERSAL —todos los pacientes activos y sus fotos—
  // y hasta aquí entraba cualquiera con sesión. La visibilidad por paciente de
  // abajo filtra los expedientes restringidos, pero no comprueba ningún
  // permiso: un READONLY, a quien el default del rol le niega todo `xrays.*`,
  // no veía la pestaña Radiografías y sin embargo abría esta pantalla.
  //
  // Se pide "xrays.view" ("Ver radiografías y archivos del paciente") y no
  // "medicalRecord.view" por el criterio que ya fijó el módulo: una foto de
  // antes/después es un ARCHIVO del paciente —POST /api/before-after exige
  // "xrays.upload" y lo deja escrito— y `medicalRecord.*` no lo tiene
  // RECEPCIÓN por default, que es justo quien toma la foto.
  requirePermissionOrRedirect(user, "xrays.view");
  const clinicId = user.clinicId;
  const viewer = { userId: user.id, role: user.role, clinicId: user.clinicId };

  const patients = await prisma.patient.findMany({
    where: {
      clinicId,
      status: "ACTIVE",
      // Visibilidad por paciente: no listar/mostrar pacientes restringidos a quien no está en su visibleUserIds.
      AND: [...patientVisibilityAnd(viewer)],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      _count: { select: { beforeAfterPhotos: true } },
    },
    orderBy: { firstName: "asc" },
  });

  return <BeforeAfterClient patients={patients as any} />;
}
