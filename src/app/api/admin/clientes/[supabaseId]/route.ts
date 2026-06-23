import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getClienteDetalle } from "@/lib/admin/clientes";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { supabaseId: string } },
) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const cliente = await getClienteDetalle(params.supabaseId);
  if (!cliente) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  return NextResponse.json({ cliente });
}
