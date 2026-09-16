export const dynamic = "force-dynamic";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ProceduresClient } from "./procedures-client";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";

export default async function ProceduresPage() {
  const user = await getCurrentUser();
  // Reemplaza el gate de ADMIN/SUPER_ADMIN por el permiso UI granular —
  // ahora un DOCTOR puede ver procedures.view si el SUPER_ADMIN se lo
  // marca, y un ADMIN puede perderlo si así se configura.
  requirePermissionOrRedirect(user, "procedures.view");

  // Mismo interruptor por clínica que enciende el menú de dos niveles
  // (`clinic_feature_flags` → `menu-dos-niveles`), no uno propio: Rafael
  // prueba "el diseño nuevo" como una sola cosa. Falla cerrado (sin tabla,
  // sin fila o con error → false = el catálogo de hoy, tal cual). En
  // paralelo con la consulta del catálogo, no en cascada: no añade un viaje
  // extra a la base y la respuesta vive 60 s en memoria por clínica.
  const [procedures, rediseno] = await Promise.all([
    prisma.procedureCatalog.findMany({
      where: { clinicId: user.clinicId },
      orderBy: [{ isActive: "desc" }, { category: "asc" }, { name: "asc" }],
    }),
    menuDosNivelesEncendido(user.clinicId),
  ]);

  return (
    <ProceduresClient
      key={user.clinicId}
      initialProcedures={procedures as any}
      rediseno={rediseno}
    />
  );
}
