import { getAdminSession } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAdminGlobalEvent } from "@/lib/admin-audit";


// Estados que el admin asigna a mano desde el panel. PENDING no se asigna
// manualmente: es el estado inicial con el que nace todo laboratorio al registrarse.
const ASSIGNABLE_STATUSES = ["APPROVED", "REJECTED", "SUSPENDED"] as const;
type AssignableStatus = (typeof ASSIGNABLE_STATUSES)[number];

// PATCH /api/admin/labs/[id]  body: { status, rejectedReason? }
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

  const data: {
    status: AssignableStatus;
    approvedAt?: Date | null;
    rejectedReason?: string | null;
  } = { status: status as AssignableStatus };

  if (status === "APPROVED") {
    // Aprobar (también reactiva un rechazado/suspendido): sella la fecha de
    // aprobación y limpia cualquier motivo de rechazo previo.
    data.approvedAt = new Date();
    data.rejectedReason = null;
  } else if (status === "REJECTED") {
    const reason = typeof body?.rejectedReason === "string" ? body.rejectedReason.trim() : "";
    data.rejectedReason = reason || null;
  }
  // SUSPENDED: solo cambia el status; conserva approvedAt y rejectedReason.

  try {
    const updated = await prisma.dentalLab.update({ where: { id: params.id }, data });
    logAdminGlobalEvent({
      req, admin: admin.user, entity: "lab", entityId: params.id,
      action: status === "APPROVED" ? "approve" : status === "REJECTED" ? "reject" : "suspend",
      after: { status: updated.status, rejectedReason: updated.rejectedReason ?? null },
    });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Laboratorio no encontrado" }, { status: 404 });
  }
}
