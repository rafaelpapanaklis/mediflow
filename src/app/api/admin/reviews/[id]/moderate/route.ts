import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { adminModerateReview } from "@/lib/reviews/service";
import { ReviewError } from "@/lib/reviews/types";

// POST /api/admin/reviews/[id]/moderate — { action: "hide" | "publish" }.
// "hide" oculta del perfil público; "publish" la restaura y limpia el reporte.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const action = body?.action;
  if (action !== "hide" && action !== "publish") {
    return NextResponse.json({ error: "action inválida (hide|publish)" }, { status: 400 });
  }

  try {
    await adminModerateReview(params.id, action);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ReviewError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[admin/reviews:moderate]", err);
    return NextResponse.json({ error: "Error al moderar" }, { status: 500 });
  }
}
