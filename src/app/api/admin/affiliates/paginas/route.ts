/**
 * GET /api/admin/affiliates/paginas — la cola de moderación.
 *
 * Devuelve dos listas: lo que espera revisión (con el borrador propuesto y lo
 * que hay publicado, para el antes y después) y lo que ya está publicado, que
 * es lo único que se puede retirar.
 */
import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { loadModerationQueue } from "@/lib/affiliates/page-moderation";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await loadModerationQueue());
  } catch (e) {
    console.error("[admin/affiliates/paginas] queue:", e);
    return NextResponse.json({ error: "No se pudo cargar la cola." }, { status: 500 });
  }
}
