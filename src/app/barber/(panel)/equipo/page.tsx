export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getBarberContext } from "@/lib/barber-auth";
import { requireBarberPaidAccess } from "@/lib/barber/paid-access";
import { hasBarberPermission } from "@/lib/barber/permissions";
import { getBranchScopeFromCookie, listBranchOptions } from "@/lib/barber/branches";
import { getTeamContext, listMembers } from "@/lib/barber/team";
import { AdminDenied, AdminFrame } from "@/components/barber/team/admin-frame";
import { TeamClient } from "@/components/barber/team/team-client";

/**
 * /barber/equipo — usuarios del panel, roles y matriz de permisos.
 *
 * Ojo: esconder esta pantalla NO es el permiso. El candado está en cada
 * endpoint de /api/barber/team/** (assertBarberPermission("team.manage")).
 */
export default async function Page() {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/login");
  await requireBarberPaidAccess(ctx);

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasBarberPermission(permUser, "team.manage")) {
    return <AdminDenied ctx={ctx} />;
  }

  const scope = await getBranchScopeFromCookie(ctx);
  const [members, team, branches, barbers] = await Promise.all([
    listMembers(ctx, scope.branchIds),
    getTeamContext(ctx),
    listBranchOptions(ctx),
    // Solo lo necesario para el selector "ligar a un barbero": id, nombre y
    // sede. Nada del esquema de pago sale a esta pantalla.
    prisma.barber.findMany({
      where: { barbershopId: { in: scope.branchIds }, isActive: true },
      select: { id: true, name: true, barbershopId: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);

  return (
    <AdminFrame ctx={ctx} active="equipo">
      <TeamClient
        initialMembers={members}
        team={team}
        barbers={barbers}
        branches={branches}
        activeBranchId={scope.activeId}
        isConsolidated={scope.isConsolidated}
      />
    </AdminFrame>
  );
}
