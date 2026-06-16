import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getClientesList } from "@/lib/admin/clientes";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const clientes = await getClientesList();
  return NextResponse.json({ clientes });
}
