import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

function isAdminAuthed() {
  const token = cookies().get("admin_token")?.value;
  return !!token && token === process.env.ADMIN_SECRET_TOKEN;
}

// Estados que el admin asigna a mano desde el panel. PENDING no se asigna
// manualmente: es el estado inicial con el que nace todo proveedor al registrarse.
const ASSIGNABLE_STATUSES = ["APPROVED", "REJECTED", "SUSPENDED"] as const;
type AssignableStatus = (typeof ASSIGNABLE_STATUSES)[number];

// PATCH /api/admin/suppliers/[id]  body: { status, rejectedReason? }
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
    const updated = await prisma.supplier.update({ where: { id: params.id }, data });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
  }
}
