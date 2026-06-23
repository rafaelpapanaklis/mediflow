import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { adminModerateReview } from "@/lib/reviews/service";
import { ReviewError } from "@/lib/reviews/types";
import { prisma } from "@/lib/prisma";
import { logAdminClinicMutation } from "@/lib/admin-audit";

// POST /api/admin/reviews/[id]/moderate — { action: "hide" | "publish" }.
// "hide" oculta del perfil público; "publish" la restaura y limpia el reporte.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const action = body?.action;
  if (action !== "hide" && action !== "publish") {
    return NextResponse.json({ error: "action inválida (hide|publish)" }, { status: 400 });
  }

  try {
    // clinicId + estado previo para anclar la bitácora (la mutación real la hace
    // el servicio, que valida existencia/estado y lanza ReviewError si procede).
    const review = await prisma.clinicReview.findUnique({
      where: { id: params.id },
      select: { clinicId: true, status: true },
    });
    await adminModerateReview(params.id, action);
    if (review) {
      await logAdminClinicMutation({
        req, admin: admin.user, clinicId: review.clinicId,
        entityType: "review", entityId: params.id, action: "update",
        before: { status: review.status },
        after: { op: action, status: action === "hide" ? "hidden" : "published" },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ReviewError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[admin/reviews:moderate]", err);
    return NextResponse.json({ error: "Error al moderar" }, { status: 500 });
  }
}
