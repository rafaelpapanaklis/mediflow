export const dynamic = "force-dynamic";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ProceduresClient } from "./procedures-client";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";

export default async function ProceduresPage() {
  const user = await getCurrentUser();
  // Reemplaza el gate de ADMIN/SUPER_ADMIN por el permiso UI granular —
  // ahora un DOCTOR puede ver procedures.view si el SUPER_ADMIN se lo
  // marca, y un ADMIN puede perderlo si así se configura.
  requirePermissionOrRedirect(user, "procedures.view");

  const procedures = await prisma.procedureCatalog.findMany({
    where: { clinicId: user.clinicId },
    orderBy: [{ isActive: "desc" }, { category: "asc" }, { name: "asc" }],
  });

  return <ProceduresClient initialProcedures={procedures as any} />;
}
