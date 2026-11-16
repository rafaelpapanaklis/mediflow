export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getBarberContext } from "@/lib/barber-auth";
import { requireBarberPaidAccess } from "@/lib/barber/paid-access";
import { hasBarberPermission } from "@/lib/barber/permissions";
import { getBranchScopeFromCookie, listBranchOptions } from "@/lib/barber/branches";
import { getBarberSeatLimit, listBarbers } from "@/lib/barber/team";
import { AdminDenied, AdminFrame } from "@/components/barber/team/admin-frame";
import { BarbersClient } from "@/components/barber/team/barbers-client";
import { prisma } from "@/lib/prisma";
import { salaryReady } from "@/lib/barber/sueldo";

/**
 * /barber/barberos — fichas del profesional.
 *
 * El guard de pantalla es cortesía; el candado real es del servidor: cada
 * endpoint de /api/barber/team/barbers llama assertBarberPermission.
 */
export default async function Page() {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/barber/entrar");
  await requireBarberPaidAccess(ctx);

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasBarberPermission(permUser, "barbers.manage")) {
    return <AdminDenied ctx={ctx} />;
  }

  const scope = await getBranchScopeFromCookie(ctx);
  const [barbers, seat, branches, sueldoListo] = await Promise.all([
    listBarbers(ctx, scope.branchIds),
    getBarberSeatLimit(ctx),
    listBranchOptions(ctx),
    // Sin sql/barber_sueldo.sql pegado, «Sueldo» se ve como hoy (sin monto).
    salaryReady(prisma),
  ]);

  return (
    <AdminFrame ctx={ctx} active="barberos">
      <BarbersClient
        initialBarbers={barbers}
        seat={seat}
        branches={branches}
        activeBranchId={scope.activeId}
        isConsolidated={scope.isConsolidated}
        salaryReady={sueldoListo}
        canManageTeam={hasBarberPermission(permUser, "team.manage")}
      />
    </AdminFrame>
  );
}
