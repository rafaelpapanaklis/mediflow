import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { adminListReviews } from "@/lib/reviews/service";

// GET /api/admin/reviews?filter=reported|hidden|all&page=<n> — moderación admin.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const filterParam = searchParams.get("filter");
  const filter = filterParam === "hidden" || filterParam === "all" ? filterParam : "reported";
  const pageRaw = parseInt(searchParams.get("page") ?? "1", 10);
  const page = Number.isFinite(pageRaw) ? Math.max(1, pageRaw) : 1;

  try {
    const data = await adminListReviews(filter, page);
    return NextResponse.json(data);
  } catch (err) {
    console.error("[admin/reviews:list]", err);
    return NextResponse.json({ error: "Error al cargar reseñas" }, { status: 500 });
  }
}
