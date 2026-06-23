import { getAdminSession } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAdminGlobalEvent } from "@/lib/admin-audit";


// Estados que el admin asigna a mano desde el panel. PENDING no se asigna
// manualmente: es el estado inicial con el que nace todo afiliado al registrarse.
const ASSIGNABLE_STATUSES = ["APPROVED", "REJECTED", "SUSPENDED"] as const;
type AssignableStatus = (typeof ASSIGNABLE_STATUSES)[number];

// PATCH /api/admin/affiliates/[id]  body: { status }
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const status = String(body?.status ?? "");
  if (!(ASSIGNABLE_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
  }

  const data: { status: AssignableStatus; approvedAt?: Date } = {
    status: status as AssignableStatus,
  };

  // Aprobar (también reactiva un rechazado/suspendido) sella la fecha de
  // aprobación. Affiliate no tiene rejectedReason, así que REJECTED/SUSPENDED
  // sólo cambian el status.
  if (status === "APPROVED") {
    data.approvedAt = new Date();
  }

  try {
    const updated = await prisma.affiliate.update({ where: { id: params.id }, data });
    logAdminGlobalEvent({
      req, admin: admin.user, entity: "affiliate", entityId: params.id,
      action: status === "APPROVED" ? "approve" : status === "REJECTED" ? "reject" : "suspend",
      after: { status: updated.status, approvedAt: updated.approvedAt ?? null },
    });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Afiliado no encontrado" }, { status: 404 });
  }
}
