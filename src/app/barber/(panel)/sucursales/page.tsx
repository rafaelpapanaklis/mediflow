export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getBarberContext } from "@/lib/barber-auth";
import { hasBarberPermission } from "@/lib/barber/permissions";
import { getBranchLimit, getBranchScopeFromCookie, listBranches } from "@/lib/barber/branches";
import { BARBER_PUBLIC_BASE } from "@/lib/barber/types";
import { AdminDenied, AdminFrame } from "@/components/barber/team/admin-frame";
import { BranchesClient } from "@/components/barber/branches/branches-client";

/**
 * /barber/sucursales — sedes de la cadena.
 *
 * La pantalla se ve aunque el plan no traiga multiBranch: ahí explica qué se
 * gana con Profesional. Crear una sede sí se rechaza en el servidor.
 */
export default async function Page() {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasBarberPermission(permUser, "branches.manage")) {
    return <AdminDenied ctx={ctx} />;
  }

  const [branches, limit, scope] = await Promise.all([
    listBranches(ctx),
    getBranchLimit(ctx),
    getBranchScopeFromCookie(ctx),
  ]);

  return (
    <AdminFrame ctx={ctx} active="sucursales">
      <BranchesClient
        initialBranches={branches}
        limit={limit}
        activeBranchId={scope.activeId}
        isConsolidated={scope.isConsolidated}
        publicBase={BARBER_PUBLIC_BASE}
      />
    </AdminFrame>
  );
}
