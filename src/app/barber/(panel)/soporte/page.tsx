export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getBarberContext } from "@/lib/barber-auth";
import { hasBarberPermission } from "@/lib/barber/permissions";
import { getBranchScopeFromCookie, listBranchOptions } from "@/lib/barber/branches";
import {
  BARBER_SUPPORT_LIMITS,
  getTicketDetail,
  listTickets,
  type BarberTicketDetail,
} from "@/lib/barber/support";
import { AdminDenied, AdminFrame } from "@/components/barber/team/admin-frame";
import { SupportClient } from "@/components/barber/support/support-client";

/**
 * /barber/soporte — tickets a DaleControl.
 *
 * Sin gate de plan: el soporte está en TODOS los planes. Sí con permiso:
 * support.view para leer, support.manage para abrir y responder (el candado
 * real vive en /api/barber/support/**).
 *
 * Abre de entrada el ticket con actividad más reciente para que nadie llegue
 * a una pantalla vacía teniendo conversación pendiente.
 */
export default async function Page() {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasBarberPermission(permUser, "support.view")) {
    return <AdminDenied ctx={ctx} />;
  }

  const [tickets, branches, scope] = await Promise.all([
    listTickets(ctx),
    listBranchOptions(ctx),
    getBranchScopeFromCookie(ctx),
  ]);

  let initialDetail: BarberTicketDetail | null = null;
  if (tickets.length > 0) {
    const first = tickets.find((x) => x.hasNewReply) ?? tickets[0];
    initialDetail = await getTicketDetail(ctx, first.id);
  }

  return (
    <AdminFrame ctx={ctx} active="soporte">
      <SupportClient
        initialTickets={tickets}
        initialDetail={initialDetail}
        canWrite={hasBarberPermission(permUser, "support.manage")}
        limits={{
          maxFiles: BARBER_SUPPORT_LIMITS.maxFiles,
          maxFileBytes: BARBER_SUPPORT_LIMITS.maxFileBytes,
          allowedMime: BARBER_SUPPORT_LIMITS.allowedMime,
          subjectMax: BARBER_SUPPORT_LIMITS.subjectMax,
          bodyMax: BARBER_SUPPORT_LIMITS.bodyMax,
        }}
        locale={ctx.barbershop.locale}
        branches={branches}
        activeBranchId={scope.activeId}
        isConsolidated={scope.isConsolidated}
      />
    </AdminFrame>
  );
}
